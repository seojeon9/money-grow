import { BUDGET_ITEM_KEYS, applyCategoryRules, type BudgetItemKey } from "@/lib/budget";
import { readLedgerStore, storeToResponse, writeLedgerStore } from "@/lib/store/ledgerStore";
import { NextResponse } from "next/server";

type Body =
  | { action: "add"; name?: string }
  | { action: "rename"; oldName?: string; newName?: string }
  | { action: "delete"; name?: string }
  | { action: "budget-label"; key?: string; label?: string }
  | { action: "trip-add"; name?: string; kind?: string; startDate?: string; endDate?: string }
  | { action: "trip-delete"; id?: string }
  | { action: "rule-add"; match?: string; category?: string }
  | { action: "rule-delete"; match?: string }
  | { action: "calendar-hidden"; categories?: unknown };

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
    const budgetPlans = store.budgetPlans.map(renameMappings);
    // 자동 분류 규칙과 달력 필터도 새 이름을 따라가야 다음 동기화에서 옛 이름이 되살아나지 않습니다.
    const rules = store.categorySettings.rules?.map((r) => (r.category === oldName ? { ...r, category: newName } : r));
    const calendarHidden = store.categorySettings.calendarHidden?.map((c) => (c === oldName ? newName : c));
    const saved = await writeLedgerStore({
      ...store,
      entries,
      budgetPlans,
      categorySettings: {
        ...store.categorySettings,
        categories,
        ...(rules ? { rules } : {}),
        ...(calendarHidden ? { calendarHidden } : {}),
      },
    });
    return NextResponse.json(storeToResponse(saved));
  }

  if (body.action === "calendar-hidden") {
    const calendarHidden = Array.isArray(body.categories)
      ? Array.from(new Set(body.categories.filter((c): c is string => typeof c === "string" && !!c.trim())))
      : [];
    const saved = await writeLedgerStore({ ...store, categorySettings: { ...store.categorySettings, calendarHidden } });
    return NextResponse.json(storeToResponse(saved));
  }

  if (body.action === "rule-add") {
    const match = clean(body.match);
    const category = clean(body.category);
    if (!match || !category) {
      return NextResponse.json({ error: "내용에 들어갈 글자와 대분류가 필요합니다." }, { status: 400 });
    }
    const rules = [...(store.categorySettings.rules ?? []).filter((r) => r.match !== match), { match, category }];
    // 이미 있는 거래 중 직접 바꾸지 않은 것에도 바로 적용합니다.
    const saved = await writeLedgerStore({
      ...store,
      entries: applyCategoryRules(store.entries, [{ match, category }]),
      categorySettings: { ...store.categorySettings, rules },
    });
    return NextResponse.json(storeToResponse(saved));
  }

  if (body.action === "rule-delete") {
    const rules = (store.categorySettings.rules ?? []).filter((r) => r.match !== clean(body.match));
    const saved = await writeLedgerStore({ ...store, categorySettings: { ...store.categorySettings, rules } });
    return NextResponse.json(storeToResponse(saved));
  }

  if (body.action === "trip-add" || body.action === "trip-delete") {
    let trips = store.categorySettings.trips ?? [];
    if (body.action === "trip-add") {
      const name = clean(body.name);
      const startDate = clean(body.startDate);
      const endDate = clean(body.endDate);
      const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
      if (!name || !isDate(startDate) || !isDate(endDate) || startDate > endDate) {
        return NextResponse.json(
          { error: "일정 이름과 올바른 시작일·종료일이 필요합니다." },
          { status: 400 }
        );
      }
      const kind: "여행" | "약속" = body.kind === "약속" ? "약속" : "여행";
      trips = [...trips, { id: crypto.randomUUID(), name, kind, startDate, endDate }].sort((a, b) =>
        b.startDate.localeCompare(a.startDate)
      );
    } else {
      trips = trips.filter((trip) => trip.id !== clean(body.id));
    }
    const saved = await writeLedgerStore({
      ...store,
      categorySettings: { ...store.categorySettings, trips },
    });
    return NextResponse.json(storeToResponse(saved));
  }

  return NextResponse.json({ error: "지원하지 않는 작업입니다." }, { status: 400 });
}
