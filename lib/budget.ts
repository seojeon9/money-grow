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
  /** 예전 형식의 고정 종료일. 지금은 쓰지 않고 다음 예산 시작일로 끝을 정합니다(budgetPlanEndDate). */
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

/**
 * 자산 쪽 흐름: 투자·저축, 집 매매·전세금(주택자금), 부모님 증여.
 * 수입·지출이 아니라 자산형성(넣은 돈 − 받은 돈)으로만 계산합니다.
 */
const ASSET_CATEGORIES = new Set(["투자", "저축", "주택자금", "증여"]);

export function mainCategoryOf(e: LedgerEntry): string {
  return e.categoryMainOverride?.trim() || e.categoryMain?.trim() || "기타";
}

/**
 * 가구 관점의 돈 흐름 분류.
 * - internal: 내 계좌끼리·부부끼리 이동, 카드대금 → 수입·지출 모두에서 제외
 * - asset: 투자·저축·주택자금·증여(또는 투자·적금·저금 예산에 매핑된 대분류) → 자산형성으로 따로 집계
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
  if (ASSET_CATEGORIES.has(category) || categoryMappings[category] === "investmentSavings") {
    return "asset";
  }
  if (e.txType === "지출") return "spend";
  return e.amount >= 0 ? "income" : "spend";
}

/**
 * 예산은 시작일부터 다음 예산 시작 전날까지 이어집니다(수입이 바뀔 때 새 예산을 시작).
 * 해당 월(YYYY-MM)에 적용되는 예산 = 그 달 말일까지 시작한 예산 중 가장 늦게 시작한 것.
 */
export function budgetPlanForMonth(plans: SavedBudgetPlan[], month: string): SavedBudgetPlan | null {
  return (
    plans
      .filter((p) => p.startDate && p.startDate.slice(0, 7) <= month)
      .sort((a, b) => b.startDate.localeCompare(a.startDate) || b.createdAt.localeCompare(a.createdAt))[0] ?? null
  );
}

/** 예산이 끝나는 날(다음 예산 시작 전날). 다음 예산이 없으면 ""(진행 중). */
export function budgetPlanEndDate(plans: SavedBudgetPlan[], plan: SavedBudgetPlan): string {
  const next = plans
    .filter((p) => p.startDate > plan.startDate)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
  if (!next) return "";
  const d = new Date(`${next.startDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
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

/** 자동 분류 규칙: 내용(description)에 match가 들어 있으면 그 대분류로 봅니다. */
export type CategoryRule = { match: string; category: string };

/** 직접 바꾼 대분류가 없는 거래에만 규칙을 적용해 categoryMainOverride로 남깁니다. 먼저 등록한 규칙이 우선입니다. */
export function applyCategoryRules(entries: LedgerEntry[], rules: CategoryRule[] = []): LedgerEntry[] {
  if (rules.length === 0) return entries;
  return entries.map((e) => {
    if (e.categoryMainOverride?.trim()) return e;
    const rule = rules.find((r) => e.description.includes(r.match));
    return rule && rule.category !== e.categoryMain ? { ...e, categoryMainOverride: rule.category } : e;
  });
}
