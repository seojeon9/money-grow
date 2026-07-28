import type { SavedBudgetPlan } from "@/lib/budget";
import { readLedgerStore, storeToResponse, writeLedgerStore } from "@/lib/store/ledgerStore";
import { NextResponse } from "next/server";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: Request) {
  let body: { sourcePlanId?: string; startDate?: string; endDate?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "JSON 본문이 필요합니다." }, { status: 400 });
  }
  const startDate = body.startDate ?? "";
  const endDate = body.endDate ?? "";
  if (!body.sourcePlanId || !DATE_RE.test(startDate) || !DATE_RE.test(endDate) || startDate > endDate) {
    return NextResponse.json({ error: "원본 예산과 새 적용 기간이 필요합니다." }, { status: 400 });
  }

  const store = await readLedgerStore();
  const source = store.budgetPlans.find((plan) => plan.id === body.sourcePlanId);
  if (!source) {
    return NextResponse.json({ error: "재사용할 예산을 찾을 수 없습니다." }, { status: 404 });
  }
  const now = new Date().toISOString();
  const plan: SavedBudgetPlan = {
    ...source,
    id: crypto.randomUUID(),
    startDate,
    endDate,
    createdAt: now,
    updatedAt: now,
    amounts: { ...source.amounts },
    categoryMappings: { ...source.categoryMappings },
  };
  const saved = await writeLedgerStore({
    ...store,
    budgetPlan: {
      startDate: plan.startDate,
      endDate: plan.endDate,
      fixedSalary: plan.fixedSalary,
      amounts: plan.amounts,
      categoryMappings: plan.categoryMappings,
    },
    budgetPlans: [...store.budgetPlans, plan],
    activeBudgetPlanId: plan.id,
  });
  return NextResponse.json(storeToResponse(saved));
}
