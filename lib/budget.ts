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
  categoryMappings: BudgetPlan["categoryMappings"],
  /** 가구 구성원 이름(data/members.json). 서로 주고받은 이체는 가구 내부 이동으로 봅니다. */
  members: readonly string[] = []
): "internal" | "asset" | "income" | "spend" {
  const category = mainCategoryOf(e);
  if (INTERNAL_CATEGORIES.has(category)) return "internal";
  if (category === "이체" && members.some((name) => e.description.includes(name))) {
    return "internal";
  }
  if (ASSET_CATEGORIES.has(category) || categoryMappings[category] === "investmentSavings") {
    return "asset";
  }
  if (e.txType === "지출") return "spend";
  return e.amount >= 0 ? "income" : "spend";
}

/**
 * 예산 달(월급 기준 기간, payPeriodOf)에 적용할 예산.
 * 기간 시작일까지 시작한 예산 중 가장 늦은 것. 예산이 기간 중간에 시작하면 다음 월급 기간부터 적용합니다
 * (수입이 바뀌는 건 월급날이라서). 그런 예산도 없으면 기간 안에 시작한 첫 예산을 씁니다(가장 처음 예산).
 */
export function budgetPlanForMonth(plans: SavedBudgetPlan[], month: string): SavedBudgetPlan | null {
  const { start, end } = payPeriodOf(month);
  const sorted = plans
    .filter((p) => p.startDate)
    .sort((a, b) => b.startDate.localeCompare(a.startDate) || b.createdAt.localeCompare(a.createdAt));
  return (
    sorted.find((p) => p.startDate <= start) ??
    [...sorted].reverse().find((p) => p.startDate <= end) ??
    null
  );
}

/** 이 예산이 처음 적용되는 예산 달 이름 */
export function budgetPlanFirstMonth(plans: SavedBudgetPlan[], plan: SavedBudgetPlan): string {
  const label = payPeriodLabelOf(plan.startDate);
  return budgetPlanForMonth(plans, label)?.id === plan.id ? label : shiftMonth(label, 1);
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

/** 환불을 원 결제와 짝지을 때 거슬러 올라가는 최대 일수 */
const REFUND_LOOKBACK_DAYS = 60;

/**
 * 전액 환불·취소된 결제와 그 환불(지출 타입의 +금액)을 짝지어 둘의 id를 돌려줍니다.
 * 같은 사람·같은 금액·환불일 이전 60일 안의 결제 중 내용이 같은 것, 없으면 결제수단이 같은 것 중 가장 가까운 날짜.
 * 금액이 다른 부분 환불은 짝짓지 않습니다(지출을 줄이는 줄로 남김).
 */
export function refundedPairIds(entries: LedgerEntry[]): Set<string> {
  const paired = new Set<string>();
  const purchases = entries.filter((e) => e.id && e.txType === "지출" && e.amount < 0);
  const refunds = entries
    .filter((e) => e.id && e.txType === "지출" && e.amount > 0)
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  for (const r of refunds) {
    const from = new Date(Date.parse(`${r.date}T00:00:00Z`) - REFUND_LOOKBACK_DAYS * 86400000).toISOString().slice(0, 10);
    const candidates = purchases
      .filter(
        (p) =>
          !paired.has(p.id as string) &&
          p.sourceLabel === r.sourceLabel &&
          p.amount === -r.amount &&
          from <= p.date &&
          p.date <= r.date
      )
      .sort((a, b) => b.date.localeCompare(a.date));
    const match =
      candidates.find((p) => p.description === r.description) ??
      candidates.find((p) => p.paymentMethod === r.paymentMethod);
    if (match) {
      paired.add(match.id as string);
      paired.add(r.id as string);
    }
  }
  return paired;
}

/** 가계부 라벨. 외식·배달은 달력에 스티커로 보여줍니다(CalendarTab의 STICKERS). */
export const ENTRY_LABELS = [
  { name: "외식" },
  { name: "배달" },
  { name: "점심" },
  { name: "커피" },
  { name: "디저트" },
  { name: "편의점" },
] as const;

const EATING_OUT_SUBS = new Set(["한식", "일식", "중식", "양식", "고기", "아시아음식", "뷔페", "피자", "치킨", "패스트푸드"]);
const DESSERT_SUBS = new Set(["베이커리", "디저트/떡", "아이스크림/빙수", "도넛/핫도그"]);

/**
 * 거래의 라벨. 직접 단 라벨이 있으면(빈 배열 포함) 그것을, 없으면 뱅크샐러드 소분류로 추정합니다.
 * ponytail: 소분류 → 라벨 고정 매핑, 맞지 않으면 직접 고치면 됨.
 */
export function entryLabelsOf(e: LedgerEntry): string[] {
  if (e.labels) return e.labels;
  if (e.amount >= 0) return [];
  const sub = e.categorySub;
  if (sub === "배달") return ["배달"];
  if (sub === "커피/음료") return ["커피"];
  if (sub === "편의점") return ["편의점"];
  if (DESSERT_SUBS.has(sub)) return ["디저트"];
  if (e.categoryMain === "식비" && EATING_OUT_SUBS.has(sub)) return ["외식"];
  return [];
}

/**
 * 한국 공휴일(대체공휴일·선거일 포함). 월급일 계산에만 씁니다.
 * ponytail: 연도별 하드코딩, 2028년부터는 목록을 추가해야 함(없으면 주말만 피함).
 */
const KR_HOLIDAYS = new Set([
  // 2025
  "2025-01-01", "2025-01-27", "2025-01-28", "2025-01-29", "2025-01-30", "2025-03-01", "2025-03-03",
  "2025-05-05", "2025-05-06", "2025-06-03", "2025-06-06", "2025-08-15", "2025-10-03", "2025-10-05",
  "2025-10-06", "2025-10-07", "2025-10-08", "2025-10-09", "2025-12-25",
  // 2026
  "2026-01-01", "2026-02-16", "2026-02-17", "2026-02-18", "2026-03-01", "2026-03-02", "2026-05-05",
  "2026-05-24", "2026-05-25", "2026-06-03", "2026-06-06", "2026-08-15", "2026-08-17", "2026-09-24",
  "2026-09-25", "2026-09-26", "2026-10-03", "2026-10-05", "2026-10-09", "2026-12-25",
  // 2027
  "2027-01-01", "2027-02-06", "2027-02-07", "2027-02-08", "2027-02-09", "2027-03-01", "2027-05-05",
  "2027-05-13", "2027-06-06", "2027-08-15", "2027-08-16", "2027-09-14", "2027-09-15", "2027-09-16",
  "2027-10-03", "2027-10-04", "2027-10-09", "2027-10-11", "2027-12-25", "2027-12-27",
]);

const PAYDAY = 25;

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 그 달 월급일: 25일, 주말·공휴일이면 그 앞 영업일. */
export function paydayOf(month: string): string {
  let day = `${month}-${PAYDAY}`;
  for (;;) {
    const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6 && !KR_HOLIDAYS.has(day)) return day;
    day = addDaysIso(day, -1);
  }
}

/**
 * 예산 한 달 = 월급일부터 다음 월급 전날까지.
 * 이름(YYYY-MM)은 기간이 끝나는 달로 붙입니다. 예: "2026-11" = 10/23(10월 월급) ~ 11/24.
 */
export function payPeriodOf(month: string): { start: string; end: string } {
  return { start: paydayOf(shiftMonth(month, -1)), end: addDaysIso(paydayOf(month), -1) };
}

/** 날짜가 속한 예산 달 이름 */
export function payPeriodLabelOf(date: string): string {
  const month = date.slice(0, 7);
  return date >= paydayOf(month) ? shiftMonth(month, 1) : month;
}
