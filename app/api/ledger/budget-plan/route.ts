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
  const endDate = typeof body.endDate === "string" ? body.endDate : "";
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate) || startDate > endDate) {
    return NextResponse.json(
      { error: "올바른 시작일과 종료일을 입력해 주세요." },
      { status: 400 }
    );
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
    budgetPlan: { startDate, endDate, fixedSalary, amounts, categoryMappings },
    budgetPlans,
    activeBudgetPlanId: plan.id,
  });
  return NextResponse.json(storeToResponse(saved));
}
