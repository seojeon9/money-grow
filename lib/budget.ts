import type { LedgerEntry } from "@/lib/excel/importBankExport";

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

/** 가구 구성원(동기화 라벨). 서로 주고받은 이체는 가구 내부 이동으로 봅니다. */
export const HOUSEHOLD_MEMBERS = ["서정", "상윤"] as const;

/** 내 계좌 사이 이동·카드값 결제: 실제 소비는 카드 사용 건에 이미 잡혀 있으므로 집계에서 뺍니다. */
const INTERNAL_CATEGORIES = new Set(["내계좌이체", "카드대금"]);

export function mainCategoryOf(e: LedgerEntry): string {
  return e.categoryMainOverride?.trim() || e.categoryMain?.trim() || "기타";
}

/**
 * 가구 관점의 돈 흐름 분류.
 * - internal: 내 계좌끼리·부부끼리 이동, 카드대금 → 수입·지출 모두에서 제외
 * - asset: 투자·저축(또는 투자·적금·저금 예산에 매핑된 대분류) → 자산형성으로 따로 집계
 * - income / spend: 나머지. 지출 유형의 +금액(환불·취소)은 spend로 두어 지출을 줄입니다.
 */
export function flowKindOf(
  e: LedgerEntry,
  categoryMappings: BudgetPlan["categoryMappings"]
): "internal" | "asset" | "income" | "spend" {
  const category = mainCategoryOf(e);
  if (INTERNAL_CATEGORIES.has(category)) return "internal";
  if (category === "이체" && HOUSEHOLD_MEMBERS.some((name) => e.description.includes(name))) {
    return "internal";
  }
  if (category === "투자" || category === "저축" || categoryMappings[category] === "investmentSavings") {
    return "asset";
  }
  if (e.txType === "지출") return "spend";
  return e.amount >= 0 ? "income" : "spend";
}

/** 해당 월(YYYY-MM)을 기간에 포함하는 예산 중 가장 최근에 만든 것. */
export function budgetPlanForMonth(plans: SavedBudgetPlan[], month: string): SavedBudgetPlan | null {
  return (
    plans
      .filter((p) => p.startDate.slice(0, 7) <= month && month <= p.endDate.slice(0, 7))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
  );
}

/** 캘린더 일정. 여행은 기간 지출을 여행/숙박으로 보고, 약속은 정산(n빵) 묶기용으로만 씁니다. kind가 없으면 예전 데이터라 여행입니다. */
export type Trip = { id: string; name: string; kind?: "여행" | "약속"; startDate: string; endDate: string };

export const TRAVEL_CATEGORY = "여행/숙박";

/** 여행 기간이어도 여행비로 보지 않는 대분류(고정비·자산 이동·일회성 목돈). */
const NON_TRAVEL_CATEGORIES = new Set([
  "주거/통신",
  "금융",
  "저축",
  "투자",
  "세금",
  "목적자금",
  "가구/가전",
  "내계좌이체",
  "카드대금",
]);

/**
 * 등록한 여행 기간 안의 지출(환불 포함)을 여행/숙박으로 봅니다.
 * 사용자가 직접 바꾼 대분류(categoryMainOverride)가 있으면 그걸 그대로 둡니다.
 */
export function applyTrips(entries: LedgerEntry[], trips: Trip[]): LedgerEntry[] {
  trips = trips.filter((t) => (t.kind ?? "여행") === "여행");
  if (trips.length === 0) return entries;
  return entries.map((e) => {
    if (e.categoryMainOverride?.trim() || e.txType !== "지출") return e;
    if (NON_TRAVEL_CATEGORIES.has(e.categoryMain.trim())) return e;
    const trip = trips.find((t) => t.startDate <= e.date && e.date <= t.endDate);
    return trip ? { ...e, categoryMainOverride: TRAVEL_CATEGORY } : e;
  });
}
