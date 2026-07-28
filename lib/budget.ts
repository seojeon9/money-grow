export const BUDGET_ITEM_KEYS = [
  "living",
  "housing",
  "personal",
  "emergency",
  "investmentSavings",
  "fixedCosts",
] as const;
export type BudgetItemKey = (typeof BUDGET_ITEM_KEYS)[number];

export const DEFAULT_BUDGET_ITEM_LABELS: Record<BudgetItemKey, string> = {
  living: "생활비",
  housing: "주거비",
  personal: "품위유지비",
  emergency: "비상금",
  investmentSavings: "투자·적금·저금",
  fixedCosts: "고정비(보험·구독료)",
};

export type BudgetPlan = {
  startDate: string;
  endDate: string;
  /** 매월 반복되는 세후 기준 급여 */
  fixedSalary: number;
  amounts: Record<BudgetItemKey, number>;
  /** 가계부 대분류 → 예산 항목 */
  categoryMappings: Record<string, BudgetItemKey>;
};

export type SavedBudgetPlan = BudgetPlan & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export function emptyBudgetPlan(): BudgetPlan {
  return {
    startDate: "",
    endDate: "",
    fixedSalary: 0,
    amounts: {
      living: 0,
      housing: 0,
      personal: 0,
      emergency: 0,
      investmentSavings: 0,
      fixedCosts: 0,
    },
    categoryMappings: {},
  };
}
