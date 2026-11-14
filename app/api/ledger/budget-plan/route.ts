import {
  readLedgerStore,
  storeToResponse,
  writeLedgerStore,
} from "@/lib/store/ledgerStore";
import {
  BUDGET_ITEM_KEYS,
  type BudgetItemKey,
  type BudgetPlan,
  type SavedBudgetPlan,
} from "@/lib/budget";
import { NextResponse } from "next/server";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const itemKeys = new Set<string>(BUDGET_ITEM_KEYS);

export async function POST(req: Request) {
  let body: Partial<BudgetPlan> & { id?: string };
  try {
    body = (await req.json()) as Partial<BudgetPlan> & { id?: string };
  } catch {
    return NextResponse.json({ error: "JSON 본문이 필요합니다." }, { status: 400 });
  }

  const startDate = typeof body.startDate === "string" ? body.startDate : "";
  // 종료일은 두지 않습니다. 다음 예산이 시작되기 전날까지 이어집니다.
  const endDate = "";
  if (!DATE_RE.test(startDate)) {
    return NextResponse.json({ error: "올바른 시작일을 입력해 주세요." }, { status: 400 });
  }

  const fixedSalary = Number(body.fixedSalary ?? 0);
  if (!Number.isFinite(fixedSalary) || fixedSalary < 0) {
    return NextResponse.json({ error: "고정 급여는 0 이상의 숫자여야 합니다." }, { status: 400 });
  }

  const rawAmounts = (body.amounts ?? {}) as Partial<Record<BudgetItemKey, number>>;
  const amounts = Object.fromEntries(
    BUDGET_ITEM_KEYS.map((key) => [key, Number(rawAmounts[key] ?? 0)])
  ) as Record<BudgetItemKey, number>;
  if (Object.values(amounts).some((amount) => !Number.isFinite(amount) || amount < 0)) {
    return NextResponse.json({ error: "예산은 0 이상의 숫자여야 합니다." }, { status: 400 });
  }

  const rawMappings = body.categoryMappings ?? {};
  const categoryMappings: Record<string, BudgetItemKey> = {};
  for (const [category, item] of Object.entries(rawMappings)) {
    const normalizedCategory = category.trim();
    if (!normalizedCategory || !itemKeys.has(item)) continue;
    categoryMappings[normalizedCategory] = item as BudgetItemKey;
  }

  const store = await readLedgerStore();
  if (store.budgetPlans.some((plan) => plan.startDate === startDate && plan.id !== body.id)) {
    return NextResponse.json({ error: "같은 날 시작하는 예산이 이미 있어요." }, { status: 400 });
  }
  const now = new Date().toISOString();
  const existing = body.id
    ? store.budgetPlans.find((plan) => plan.id === body.id)
    : undefined;
  const plan: SavedBudgetPlan = {
    startDate,
    endDate,
    fixedSalary,
    amounts,
    categoryMappings,
    id: existing?.id ?? crypto.randomUUID(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  const budgetPlans = existing
    ? store.budgetPlans.map((item) => (item.id === plan.id ? plan : item))
    : [...store.budgetPlans, plan];
  const saved = await writeLedgerStore({
    ...store,
    budgetPlans,
    activeBudgetPlanId: plan.id,
  });
  return NextResponse.json(storeToResponse(saved));
}

export async function DELETE(req: Request) {
  let body: { id?: string };
  try {
    body = (await req.json()) as { id?: string };
  } catch {
    return NextResponse.json({ error: "JSON 본문이 필요합니다." }, { status: 400 });
  }
  const store = readLedgerStore();
  const budgetPlans = store.budgetPlans.filter((plan) => plan.id !== body.id);
  if (budgetPlans.length === store.budgetPlans.length) {
    return NextResponse.json({ error: "예산을 찾을 수 없습니다." }, { status: 404 });
  }
  const saved = writeLedgerStore({
    ...store,
    budgetPlans,
    activeBudgetPlanId: store.activeBudgetPlanId === body.id ? null : store.activeBudgetPlanId,
  });
  return NextResponse.json(storeToResponse(saved));
}
