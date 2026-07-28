import { BUDGET_ITEM_KEYS, type BudgetItemKey } from "@/lib/budget";
import { readLedgerStore, storeToResponse, writeLedgerStore } from "@/lib/store/ledgerStore";
import { NextResponse } from "next/server";

type Body =
  | { action: "add"; name?: string }
  | { action: "rename"; oldName?: string; newName?: string }
  | { action: "delete"; name?: string }
  | { action: "budget-label"; key?: string; label?: string };

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "JSON 본문이 필요합니다." }, { status: 400 });
  }
  const store = await readLedgerStore();

  if (body.action === "budget-label") {
    const key = clean(body.key);
    const label = clean(body.label);
    if (!BUDGET_ITEM_KEYS.includes(key as BudgetItemKey) || !label) {
      return NextResponse.json({ error: "예산 항목과 이름이 필요합니다." }, { status: 400 });
    }
    const saved = await writeLedgerStore({
      ...store,
      categorySettings: {
        ...store.categorySettings,
        budgetItemLabels: {
          ...store.categorySettings.budgetItemLabels,
          [key]: label,
        },
      },
    });
    return NextResponse.json(storeToResponse(saved));
  }

  if (body.action === "add") {
    const name = clean(body.name);
    if (!name) return NextResponse.json({ error: "대분류 이름이 필요합니다." }, { status: 400 });
    const categories = Array.from(new Set([...store.categorySettings.categories, name]));
    const saved = await writeLedgerStore({
      ...store,
      categorySettings: { ...store.categorySettings, categories },
    });
    return NextResponse.json(storeToResponse(saved));
  }

  if (body.action === "delete") {
    const name = clean(body.name);
    const used = store.entries.some(
      (entry) => (entry.categoryMainOverride?.trim() || entry.categoryMain.trim()) === name
    );
    if (used) {
      return NextResponse.json(
        { error: "사용 중인 대분류는 삭제할 수 없습니다. 먼저 다른 대분류로 변경해 주세요." },
        { status: 400 }
      );
    }
    const categories = store.categorySettings.categories.filter((category) => category !== name);
    const saved = await writeLedgerStore({
      ...store,
      categorySettings: { ...store.categorySettings, categories },
    });
    return NextResponse.json(storeToResponse(saved));
  }

  if (body.action === "rename") {
    const oldName = clean(body.oldName);
    const newName = clean(body.newName);
    if (!oldName || !newName) {
      return NextResponse.json({ error: "기존 이름과 새 이름이 필요합니다." }, { status: 400 });
    }
    const renameMappings = <T extends { categoryMappings: Record<string, BudgetItemKey> }>(plan: T): T => {
      if (!(oldName in plan.categoryMappings)) return plan;
      const categoryMappings = { ...plan.categoryMappings };
      categoryMappings[newName] = categoryMappings[oldName];
      delete categoryMappings[oldName];
      return { ...plan, categoryMappings };
    };
    const entries = store.entries.map((entry) => {
      const current = entry.categoryMainOverride?.trim() || entry.categoryMain.trim();
      return current === oldName ? { ...entry, categoryMainOverride: newName } : entry;
    });
    const categories = Array.from(
      new Set(
        store.categorySettings.categories.map((category) =>
          category === oldName ? newName : category
        )
      )
    );
    const budgetPlan = renameMappings(store.budgetPlan);
    const budgetPlans = store.budgetPlans.map(renameMappings);
    const saved = await writeLedgerStore({
      ...store,
      entries,
      budgetPlan,
      budgetPlans,
      categorySettings: { ...store.categorySettings, categories },
    });
    return NextResponse.json(storeToResponse(saved));
  }

  return NextResponse.json({ error: "지원하지 않는 작업입니다." }, { status: 400 });
}
