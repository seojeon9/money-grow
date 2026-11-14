"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  type LedgerEntry,
  type LedgerEntryStatus,
  type NetWorthSnapshot,
  isLedgerEntryCounted,
  ledgerEntryStableKey,
} from "@/lib/excel/importBankExport";
import {
  BUDGET_ITEM_KEYS,
  DEFAULT_BUDGET_ITEM_LABELS,
  type BudgetItemKey,
  type BudgetPlan,
  type SavedBudgetPlan,
  budgetPlanEndDate,
  budgetPlanForMonth,
  refundedPairIds,
  flowKindOf,
  HOUSEHOLD_MEMBERS,
  mainCategoryOf,
  applyTrips,
  type Trip,
  type CategoryRule,
} from "@/lib/budget";
import type { CategorySettings, NetWorthPoint, SettlementGroup } from "@/lib/store/ledgerStore";
import BudgetSettings from "./BudgetSettings";
import CalendarTab from "./CalendarTab";
import InfoBadge from "./InfoBadge";

type LedgerApiPayload = {
  ledger?: LedgerEntry[];
  netWorth?: NetWorthSnapshot | null;
  summaryLabel?: string;
  updatedAt?: string;
  persistPath?: string;
  settlementGroups?: SettlementGroup[];
  budgetPlans?: SavedBudgetPlan[];
  categorySettings?: CategorySettings;
  netWorthHistory?: NetWorthPoint[];
  error?: string;
};

const DEFAULT_HIDDEN_MAIN_CATEGORIES: string[] = [];
/** 가계부(달력) 기본 필터: 고정비·자산 이동·일회성 목돈·수입은 빼고 생활 지출만 봅니다. */
const DEFAULT_CALENDAR_HIDDEN: string[] = [
  "주거/통신", "금융", "세금", "주택자금", "증여", "투자", "저축",
  "내계좌이체", "카드대금", "목적자금", "가구/가전", "급여", "금융수입",
];
const MONTHLY_BUDGET_KEYS: BudgetItemKey[] = [
  "living",
  "housing",
  "investmentSavings",
  "fixedCosts",
];
const ROLLOVER_BUDGET_KEYS: BudgetItemKey[] = ["personal", "emergency"];

function inclusiveMonthCount(startDate: string, endDate: string): number {
  if (!startDate || !endDate || startDate > endDate) return 0;
  const [startYear, startMonth] = startDate.slice(0, 7).split("-").map(Number);
  const [endYear, endMonth] = endDate.slice(0, 7).split("-").map(Number);
  return (endYear - startYear) * 12 + endMonth - startMonth + 1;
}

function localTodayIso(): string {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
    today.getDate()
  ).padStart(2, "0")}`;
}

const won = new Intl.NumberFormat("ko-KR", {
  style: "currency",
  currency: "KRW",
  maximumFractionDigits: 0,
});

function formatWon(n: number) {
  return won.format(n);
}

function noteOf(e: LedgerEntry): string {
  return e.noteOverride ?? e.note ?? "";
}

function currentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

type Props = {
  householdLabel?: string;
};

export default function Dashboard({ householdLabel = "우리 가구" }: Props) {
  const [activeTab, setActiveTab] = useState<"home" | "ledger" | "calendar" | "analysis" | "settings">("home");
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [netWorth, setNetWorth] = useState<NetWorthSnapshot | null>(null);
  const [netWorthHistory, setNetWorthHistory] = useState<NetWorthPoint[]>([]);
  const [fileLabel, setFileLabel] = useState<string | null>(null);
  const [persistInfo, setPersistInfo] = useState<{ updatedAt: string | null; path: string | null }>(
    { updatedAt: null, path: null }
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploadLabel, setUploadLabel] = useState<string>(HOUSEHOLD_MEMBERS[0]);
  const [hiddenMainCategories, setHiddenMainCategories] = useState<string[]>([
    ...DEFAULT_HIDDEN_MAIN_CATEGORIES,
  ]);
  const [txMonth, setTxMonth] = useState<string>(currentMonthKey);
  const [statusBusyKey, setStatusBusyKey] = useState<string | null>(null);
  const [mergeBusyRow, setMergeBusyRow] = useState<string | null>(null);
  const [settlementGroups, setSettlementGroups] = useState<SettlementGroup[]>([]);
  const [settlementMode, setSettlementMode] = useState(false);
  const [selectedSettlementIds, setSelectedSettlementIds] = useState<string[]>([]);
  const [expandedSettlementId, setExpandedSettlementId] = useState<string | null>(null);
  const [categoryPickerId, setCategoryPickerId] = useState<string | null>(null);
  const [categoryPickerPosition, setCategoryPickerPosition] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const [categoryBusyId, setCategoryBusyId] = useState<string | null>(null);
  const [noteBusyId, setNoteBusyId] = useState<string | null>(null);
  const [budgetPlans, setBudgetPlans] = useState<SavedBudgetPlan[]>([]);
  const [configuredCategories, setConfiguredCategories] = useState<string[]>([
    "목적자금",
    "세금",
    "가구/가전",
  ]);
  const [budgetItemLabels, setBudgetItemLabels] = useState<Record<BudgetItemKey, string>>({
    ...DEFAULT_BUDGET_ITEM_LABELS,
  });
  const [budgetBusy, setBudgetBusy] = useState(false);
  const [budgetMonth, setBudgetMonth] = useState<string>(currentMonthKey);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [trips, setTrips] = useState<Trip[]>([]);
  const [rules, setRules] = useState<CategoryRule[]>([]);
  const [calendarHidden, setCalendarHidden] = useState<string[]>(DEFAULT_CALENDAR_HIDDEN);
  const [ruleDraft, setRuleDraft] = useState({ match: "", category: "" });
  const [settingsBusy, setSettingsBusy] = useState(false);

  /** 서버 디스크 누적본 — 새로고침 후에도 유지 */
  useEffect(() => {
    fetch("/api/ledger/state")
      .then((r) => r.json() as Promise<LedgerApiPayload>)
      .then((j) => {
        if (j.ledger && j.ledger.length > 0) {
          setLedger(j.ledger);
          setNetWorth(j.netWorth ?? null);
        setNetWorthHistory(j.netWorthHistory ?? []);
          setPersistInfo({ updatedAt: j.updatedAt ?? null, path: j.persistPath ?? null });
          setSettlementGroups(j.settlementGroups ?? []);
          setBudgetPlans(j.budgetPlans ?? []);
          setConfiguredCategories(j.categorySettings?.categories ?? []);
        setTrips(j.categorySettings?.trips ?? []);
        setRules(j.categorySettings?.rules ?? []);
        setCalendarHidden(j.categorySettings?.calendarHidden ?? DEFAULT_CALENDAR_HIDDEN);
          setBudgetItemLabels(j.categorySettings?.budgetItemLabels ?? DEFAULT_BUDGET_ITEM_LABELS);
          setFileLabel((prev) => prev ?? "저장된 누적 데이터");
        }
      })
      .catch(() => {});
  }, []);

  const onFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setLoading(true);
    const fd = new FormData();
    fd.append("file", f);
    fd.append("sourceLabel", uploadLabel);
    fetch("/api/ledger/upload", { method: "POST", body: fd })
      .then(async (res) => {
        const j = (await res.json()) as LedgerApiPayload;
        if (!res.ok) throw new Error(j.error ?? res.statusText);
        setError(null);
        setHiddenMainCategories([...DEFAULT_HIDDEN_MAIN_CATEGORIES]);
        setTxMonth(currentMonthKey());
        setLedger(j.ledger ?? []);
        setNetWorth(j.netWorth ?? null);
        setNetWorthHistory(j.netWorthHistory ?? []);
        setFileLabel(j.summaryLabel ?? f.name);
        setPersistInfo({ updatedAt: j.updatedAt ?? null, path: j.persistPath ?? null });
        setSettlementGroups(j.settlementGroups ?? []);
        setBudgetPlans(j.budgetPlans ?? []);
        setConfiguredCategories(j.categorySettings?.categories ?? []);
        setTrips(j.categorySettings?.trips ?? []);
        setRules(j.categorySettings?.rules ?? []);
        setCalendarHidden(j.categorySettings?.calendarHidden ?? DEFAULT_CALENDAR_HIDDEN);
        setBudgetItemLabels(j.categorySettings?.budgetItemLabels ?? DEFAULT_BUDGET_ITEM_LABELS);
        if (!j.ledger?.length) {
          setError("가계부 시트를 찾지 못했거나 데이터가 없습니다. 엑셀 형식을 확인해 주세요.");
        }
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => {
        setLoading(false);
        e.target.value = "";
      });
  }, [uploadLabel]);

  const syncFromDataFolders = useCallback(() => {
    setLoading(true);
    fetch("/api/sync-workbooks")
      .then(async (res) => {
        const j = (await res.json()) as LedgerApiPayload;
        if (!res.ok) {
          throw new Error(j.error ?? res.statusText);
        }
        setError(null);
        setHiddenMainCategories([...DEFAULT_HIDDEN_MAIN_CATEGORIES]);
        setTxMonth(currentMonthKey());
        setLedger(j.ledger ?? []);
        setNetWorth(j.netWorth ?? null);
        setNetWorthHistory(j.netWorthHistory ?? []);
        setFileLabel(j.summaryLabel ?? "동기화");
        setPersistInfo({ updatedAt: j.updatedAt ?? null, path: j.persistPath ?? null });
        setSettlementGroups(j.settlementGroups ?? []);
        setBudgetPlans(j.budgetPlans ?? []);
        setConfiguredCategories(j.categorySettings?.categories ?? []);
        setTrips(j.categorySettings?.trips ?? []);
        setRules(j.categorySettings?.rules ?? []);
        setCalendarHidden(j.categorySettings?.calendarHidden ?? DEFAULT_CALENDAR_HIDDEN);
        setBudgetItemLabels(j.categorySettings?.budgetItemLabels ?? DEFAULT_BUDGET_ITEM_LABELS);
        if (!j.ledger?.length) {
          setError("가계부 시트를 찾지 못했거나 데이터가 없습니다. 엑셀 형식을 확인해 주세요.");
        }
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const patchEntryStatus = useCallback(
    (key: string, status: LedgerEntryStatus, opts?: { id?: string; busyId?: string }) => {
      const busy = opts?.busyId ?? key;
      setStatusBusyKey(busy);
      setError(null);
      fetch("/api/ledger/entry-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key,
          status,
          ...(opts?.id ? { id: opts.id } : {}),
        }),
      })
      .then(async (res) => {
        const j = (await res.json()) as LedgerApiPayload & { error?: string };
        if (!res.ok) throw new Error(j.error ?? res.statusText);
        setLedger(j.ledger ?? []);
        setPersistInfo({ updatedAt: j.updatedAt ?? null, path: j.persistPath ?? null });
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setStatusBusyKey(null));
    },
    []
  );

  const hiddenSet = useMemo(() => new Set(hiddenMainCategories), [hiddenMainCategories]);

  /** 홈 카드용 자산 분류별 합계. 현금성 = 부동산·연금을 뺀 나머지(입출금·적금·투자). */
  const assetSum = useMemo(() => {
    const byCategory = (category: string) =>
      (netWorth?.assets ?? []).filter((a) => a.category === category).reduce((sum, a) => sum + a.amount, 0);
    const cash = (netWorth?.totalAssets ?? 0) - byCategory("부동산") - byCategory("연금 자산");
    return { byCategory, cash };
  }, [netWorth]);

  /** 여행 기간 안의 지출은 여행/숙박으로 본 가계부. 집계·목록은 모두 이걸 씁니다. */
  const tripLedger = useMemo(() => applyTrips(ledger, trips), [ledger, trips]);

  const settlementView = useMemo(() => {
    const entriesById = new Map(
      tripLedger.filter((entry) => entry.id).map((entry) => [entry.id as string, entry])
    );
    const groupedIds = new Set<string>();
    const detailsByGroupId = new Map<string, LedgerEntry[]>();
    const syntheticEntries: LedgerEntry[] = [];

    for (const group of settlementGroups) {
      const members = group.memberIds
        .map((id) => entriesById.get(id))
        .filter((entry): entry is LedgerEntry => !!entry);
      if (members.length < 2) continue;
      members.forEach((entry) => entry.id && groupedIds.add(entry.id));
      detailsByGroupId.set(group.id, members);
      const expenses = members.filter((entry) => entry.amount < 0);
      const incomes = members.filter((entry) => entry.amount > 0);
      const latest = [...members].sort((a, b) =>
        `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`)
      )[0];
      const descriptions = Array.from(
        new Set(expenses.map((entry) => entry.description.trim()).filter(Boolean))
      );
      const baseExpense = expenses[0] ?? latest;
      syntheticEntries.push({
        id: group.id,
        date: latest.date,
        time: latest.time,
        txType: "정산",
        categoryMain: baseExpense.categoryMain,
        categoryMainOverride: baseExpense.categoryMainOverride,
        categorySub: "",
        description: descriptions.join(" · ") || "합친 지출",
        amount: members.reduce((sum, entry) => sum + entry.amount, 0),
        currency: "KRW",
        paymentMethod: "",
        note: `${incomes.length}명 정산`,
        sourceLabel: baseExpense.sourceLabel,
        status: "visible",
      });
    }
    return { groupedIds, detailsByGroupId, syntheticEntries };
  }, [tripLedger, settlementGroups]);

  const ledgerWithSettlements = useMemo(
    () => [
      ...tripLedger.filter((entry) => !entry.id || !settlementView.groupedIds.has(entry.id)),
      ...settlementView.syntheticEntries,
    ],
    [tripLedger, settlementView]
  );

  /** 숨김(status) + 대분류 필터 통과분만 집계·차트·일반 목록에 사용 */
  const visibleEntries = useMemo(() => {
    return ledgerWithSettlements
      .filter(isLedgerEntryCounted)
      .filter((e) => !hiddenSet.has(mainCategoryOf(e)));
  }, [ledgerWithSettlements, hiddenSet]);

  const calendarHiddenSet = useMemo(() => new Set(calendarHidden), [calendarHidden]);
  /** 가계부(달력)용 거래: 숨김 거래, 가계부 필터에서 끈 대분류, 전액 환불된 결제와 그 환불을 뺍니다. */
  const calendarEntries = useMemo(() => {
    const refunded = refundedPairIds(ledgerWithSettlements.filter(isLedgerEntryCounted));
    return ledgerWithSettlements
      .filter(isLedgerEntryCounted)
      .filter((e) => !(e.id && refunded.has(e.id)))
      .filter((e) => !calendarHiddenSet.has(mainCategoryOf(e)));
  }, [ledgerWithSettlements, calendarHiddenSet]);

  const flowKind = useCallback(
    (entry: LedgerEntry) =>
      flowKindOf(entry, budgetPlanForMonth(budgetPlans, entry.date.slice(0, 7))?.categoryMappings ?? {}),
    [budgetPlans]
  );

  const chartData = useMemo(() => {
    const byMonth = new Map<string, { income: number; spend: number; asset: number }>();
    for (const entry of visibleEntries) {
      const kind = flowKind(entry);
      if (kind === "internal") continue;
      const month = entry.date.slice(0, 7);
      const b = byMonth.get(month) ?? { income: 0, spend: 0, asset: 0 };
      byMonth.set(month, b);
      if (kind === "income") b.income += entry.amount;
      else if (kind === "spend") b.spend -= entry.amount;
      else b.asset -= entry.amount;
    }
    return Array.from(byMonth.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, b]) => ({
        월: month.slice(2),
        수입: Math.round(b.income),
        지출: Math.round(b.spend),
        자산형성: Math.round(b.asset),
        순현금흐름: Math.round(b.income - b.spend),
      }));
  }, [flowKind, visibleEntries]);

  const monthsInData = useMemo(() => {
    const s = new Set<string>();
    for (const e of ledger) {
      if (e.date.length >= 7) s.add(e.date.slice(0, 7));
    }
    return Array.from(s).sort((a, b) => b.localeCompare(a));
  }, [ledger]);

  /** 선택 중인 월이 데이터에 없어도 드롭다운에 나오도록 포함 */
  const monthSelectOptions = useMemo(() => {
    const s = new Set(monthsInData);
    s.add(txMonth);
    return Array.from(s).sort((a, b) => b.localeCompare(a));
  }, [monthsInData, txMonth]);

  const ledgerRowsForMonth = useMemo(() => {
    return visibleEntries
      .filter((e) => e.date.startsWith(txMonth))
      .sort((a, b) => {
        if (a.date !== b.date) return a.date < b.date ? 1 : -1;
        return (b.time || "").localeCompare(a.time || "");
      });
  }, [visibleEntries, txMonth]);

  /** 해당 월·대분류 필터에 맞는 숨김 거래(합계 제외, 목록에서만 토글) */
  const hiddenRowsForMonth = useMemo(() => {
    return ledger
      .filter((e) => !e.id || !settlementView.groupedIds.has(e.id))
      .filter((e) => e.status === "hidden")
      .filter((e) => !hiddenSet.has(mainCategoryOf(e)))
      .filter((e) => e.date.startsWith(txMonth))
      .sort((a, b) => {
        if (a.date !== b.date) return a.date < b.date ? 1 : -1;
        return (b.time || "").localeCompare(a.time || "");
      });
  }, [ledger, hiddenSet, settlementView.groupedIds, txMonth]);

  const allMainCategories = useMemo(() => {
    const s = new Set<string>(configuredCategories);
    for (const e of ledger) s.add(mainCategoryOf(e));
    return Array.from(s).sort((a, b) => a.localeCompare(b, "ko"));
  }, [configuredCategories, ledger]);

  /** 첫 예산 시작월부터 이번 달까지 */
  const budgetMonthOptions = useMemo(() => {
    const first = budgetPlans.map((p) => p.startDate.slice(0, 7)).filter(Boolean).sort()[0];
    if (!first) return [budgetMonth];
    const months: string[] = [];
    const last = currentMonthKey();
    for (let m = first; m <= last && months.length < 600; ) {
      months.push(m);
      const [y, mo] = m.split("-").map(Number);
      m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
    }
    return months.reverse();
  }, [budgetMonth, budgetPlans]);

  /** 조회 월이 속한 예산 계획(월마다 그 달에 적용된 예산으로 평가) */
  const monthPlan = useMemo(
    () => budgetPlanForMonth(budgetPlans, budgetMonth),
    [budgetMonth, budgetPlans]
  );
  /** monthPlan이 끝나는 날(다음 예산 전날). ""이면 진행 중. */
  const monthPlanEnd = useMemo(
    () => (monthPlan ? budgetPlanEndDate(budgetPlans, monthPlan) : ""),
    [budgetPlans, monthPlan]
  );

  useEffect(() => {
    if (budgetMonthOptions.length > 0 && !budgetMonthOptions.includes(budgetMonth)) {
      setBudgetMonth(budgetMonthOptions[0]);
    }
  }, [budgetMonth, budgetMonthOptions]);

  const monthlyBudgetProgress = useMemo(() => {
    const spent = Object.fromEntries(BUDGET_ITEM_KEYS.map((key) => [key, 0])) as Record<
      BudgetItemKey,
      number
    >;
    if (monthPlan) {
      for (const entry of ledgerWithSettlements) {
        if (!isLedgerEntryCounted(entry)) continue;
        if (entry.date < monthPlan.startDate || (monthPlanEnd && entry.date > monthPlanEnd)) continue;
        if (!entry.date.startsWith(budgetMonth)) continue;
        const item = monthPlan.categoryMappings[mainCategoryOf(entry)];
        if (!item) continue;
        // 투자·적금·저금은 납입액만, 소비 항목은 환불·취소(+금액)를 빼서 순사용액으로 계산합니다.
        if (item === "investmentSavings" && entry.amount >= 0) continue;
        spent[item] -= entry.amount;
      }
    }
    return MONTHLY_BUDGET_KEYS.map((key) => {
      const budget = monthPlan?.amounts[key] ?? 0;
      const used = spent[key];
      return {
        key,
        budget,
        spent: used,
        remaining: budget - used,
        rate: budget > 0 ? (used / budget) * 100 : 0,
      };
    });
  }, [budgetMonth, monthPlan, monthPlanEnd, ledgerWithSettlements]);

  /** 누적 예산: 조회 월의 예산 시작부터 그 달 말(또는 오늘·예산 끝)까지 쌓인 금액과 사용액 */
  const rolloverBudgetProgress = useMemo(() => {
    const monthEnd = `${budgetMonth}-31`;
    const cutoff = [localTodayIso(), monthEnd, monthPlanEnd || monthEnd].sort()[0];
    const elapsedMonths = monthPlan && cutoff >= monthPlan.startDate ? inclusiveMonthCount(monthPlan.startDate, cutoff) : 0;
    const spent = Object.fromEntries(ROLLOVER_BUDGET_KEYS.map((key) => [key, 0])) as Record<
      BudgetItemKey,
      number
    >;
    if (monthPlan && elapsedMonths > 0) {
      for (const entry of ledgerWithSettlements) {
        if (!isLedgerEntryCounted(entry)) continue;
        if (entry.date < monthPlan.startDate || entry.date > cutoff) continue;
        const item = monthPlan.categoryMappings[mainCategoryOf(entry)];
        if (item === "personal" || item === "emergency") spent[item] -= entry.amount;
      }
    }
    return ROLLOVER_BUDGET_KEYS.map((key) => {
      const available = (monthPlan?.amounts[key] ?? 0) * elapsedMonths;
      const used = spent[key];
      return {
        key,
        available,
        spent: used,
        carryover: available - used,
        rate: available > 0 ? (used / available) * 100 : 0,
        elapsedMonths,
        cutoff,
      };
    });
  }, [budgetMonth, monthPlan, monthPlanEnd, ledgerWithSettlements]);

  const applySettingsPayload = useCallback((j: LedgerApiPayload) => {
    if (j.ledger) setLedger(j.ledger);
    setBudgetPlans(j.budgetPlans ?? []);
    if (j.categorySettings) {
      setConfiguredCategories(j.categorySettings.categories);
      setTrips(j.categorySettings.trips ?? []);
      setRules(j.categorySettings.rules ?? []);
      setCalendarHidden(j.categorySettings.calendarHidden ?? DEFAULT_CALENDAR_HIDDEN);
      setBudgetItemLabels(j.categorySettings.budgetItemLabels);
    }
    setPersistInfo({ updatedAt: j.updatedAt ?? null, path: j.persistPath ?? null });
  }, []);

  /** 예산 저장(id 있으면 수정, 없으면 새 예산). 성공하면 true. */
  const saveBudgetPlan = useCallback((plan: BudgetPlan, id: string | null) => {
    setBudgetBusy(true);
    setError(null);
    return fetch("/api/ledger/budget-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...plan, id }),
    })
      .then(async (res) => {
        const j = (await res.json()) as LedgerApiPayload;
        if (!res.ok) throw new Error(j.error ?? res.statusText);
        applySettingsPayload(j);
        return true;
      })
      .catch((err: Error) => {
        setError(err.message);
        return false;
      })
      .finally(() => setBudgetBusy(false));
  }, [applySettingsPayload]);

  const deleteBudgetPlan = useCallback((id: string) => {
    setBudgetBusy(true);
    setError(null);
    fetch("/api/ledger/budget-plan", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    })
      .then(async (res) => {
        const j = (await res.json()) as LedgerApiPayload;
        if (!res.ok) throw new Error(j.error ?? res.statusText);
        applySettingsPayload(j);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setBudgetBusy(false));
  }, [applySettingsPayload]);


  const updateCategorySettings = useCallback(
    (body: Record<string, unknown>) => {
      setSettingsBusy(true);
      setError(null);
      return fetch("/api/ledger/category-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
        .then(async (res) => {
          const j = (await res.json()) as LedgerApiPayload;
          if (!res.ok) throw new Error(j.error ?? res.statusText);
          applySettingsPayload(j);
          return j;
        })
        .catch((err: Error) => {
          setError(err.message);
        })
        .finally(() => setSettingsBusy(false));
    },
    [applySettingsPayload]
  );

  const saveCalendarHidden = useCallback(
    (categories: string[]) => {
      setCalendarHidden(categories);
      void updateCategorySettings({ action: "calendar-hidden", categories });
    },
    [updateCategorySettings]
  );

  const updateEntryCategory = useCallback((entry: LedgerEntry, categoryMain: string) => {
    if (!entry.id || settlementView.detailsByGroupId.has(entry.id)) return;
    setCategoryBusyId(entry.id);
    setError(null);
    fetch("/api/ledger/entry-category", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: entry.id, categoryMain }),
    })
      .then(async (res) => {
        const j = (await res.json()) as LedgerApiPayload;
        if (!res.ok) throw new Error(j.error ?? res.statusText);
        setLedger(j.ledger ?? []);
        setPersistInfo({ updatedAt: j.updatedAt ?? null, path: j.persistPath ?? null });
        setCategoryPickerId(null);
        setCategoryPickerPosition(null);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setCategoryBusyId(null));
  }, [settlementView.detailsByGroupId]);

  const categoryPickerEntry = useMemo(
    () => ledgerRowsForMonth.find((entry) => entry.id === categoryPickerId) ?? null,
    [categoryPickerId, ledgerRowsForMonth]
  );

  const updateEntryNote = useCallback((entry: LedgerEntry, note: string) => {
    if (!entry.id || settlementView.detailsByGroupId.has(entry.id)) return;
    setNoteBusyId(entry.id);
    setError(null);
    fetch("/api/ledger/entry-note", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: entry.id, note }),
    })
      .then(async (res) => {
        const j = (await res.json()) as LedgerApiPayload;
        if (!res.ok) throw new Error(j.error ?? res.statusText);
        setLedger(j.ledger ?? []);
        setPersistInfo({ updatedAt: j.updatedAt ?? null, path: j.persistPath ?? null });
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setNoteBusyId(null));
  }, [settlementView.detailsByGroupId]);

  /** 정산 묶기(POST)·풀기(DELETE). 성공하면 true. */
  const requestSettlement = useCallback(
    (method: "POST" | "DELETE", body: { memberIds?: string[]; groupId?: string }) => {
      setMergeBusyRow("settlement-save");
      setError(null);
      return fetch("/api/ledger/settlement-group", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
        .then(async (res) => {
          const j = (await res.json()) as LedgerApiPayload;
          if (!res.ok) throw new Error(j.error ?? res.statusText);
          setLedger(j.ledger ?? []);
          setSettlementGroups(j.settlementGroups ?? []);
          setPersistInfo({ updatedAt: j.updatedAt ?? null, path: j.persistPath ?? null });
          return true;
        })
        .catch((err: Error) => {
          setError(err.message);
          return false;
        })
        .finally(() => setMergeBusyRow(null));
    },
    []
  );

  const saveSettlementGroup = useCallback(() => {
    void requestSettlement("POST", { memberIds: selectedSettlementIds }).then((ok) => {
      if (!ok) return;
      setSelectedSettlementIds([]);
      setSettlementMode(false);
    });
  }, [requestSettlement, selectedSettlementIds]);

  const topCategories = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of visibleEntries) {
      if (flowKind(e) !== "spend") continue;
      const key = mainCategoryOf(e);
      m.set(key, (m.get(key) ?? 0) - e.amount);
    }
    return Array.from(m.entries())
      .filter(([, amount]) => amount > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
  }, [flowKind, visibleEntries]);


  const filterActive = hiddenMainCategories.length > 0;

  /** 대분류 체크 목록(보기 필터). 가계부·상세내역이 각자 다른 상태를 넘깁니다. */
  const renderFilter = (opts: {
    hint: string;
    hidden: Set<string>;
    onChange: (hidden: string[]) => void;
  }) => (
    <details className="group/filter rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
        <span className="text-zinc-400 transition-transform group-open/filter:rotate-90">▸</span>
        <h2 className="text-lg font-semibold text-zinc-800">
          보기 필터
          <InfoBadge text={opts.hint} />
        </h2>
        <span className="text-sm text-zinc-500">
          {opts.hidden.size > 0 ? `${opts.hidden.size}개 대분류 꺼짐` : "전체 보기"}
        </span>
      </summary>
      {opts.hidden.size > 0 ? (
        <button
          type="button"
          onClick={() => opts.onChange([])}
          className="mt-3 text-sm font-medium text-emerald-700 hover:text-emerald-900"
        >
          전체 다시 표시
        </button>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {allMainCategories.map((cat) => {
          const visible = !opts.hidden.has(cat);
          return (
            <label
              key={cat}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-sm hover:bg-zinc-100"
            >
              <input
                type="checkbox"
                className="rounded border-zinc-300 text-emerald-700 focus:ring-emerald-600"
                checked={visible}
                onChange={() =>
                  opts.onChange(
                    visible ? [...Array.from(opts.hidden), cat] : Array.from(opts.hidden).filter((c) => c !== cat)
                  )
                }
              />
              <span className={visible ? "text-zinc-900" : "text-zinc-400 line-through"}>{cat}</span>
            </label>
          );
        })}
      </div>
    </details>
  );

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">
              MoneyGrow · 부부 공동 대시보드
            </p>
            <h1 className="text-2xl font-semibold text-zinc-900">{householdLabel}</h1>
            <p className="mt-1 text-sm text-zinc-500">
              {persistInfo.updatedAt
                ? `마지막 반영 ${new Date(persistInfo.updatedAt).toLocaleString("ko-KR", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}`
                : "동기화하거나 엑셀을 올려 주세요"}
              <InfoBadge
                text={
                  <>
                    동기화하면 뱅크샐러드 엑셀에서 새 거래만 더해요. 직접 고친 분류·메모는 그대로이고, 엑셀에서
                    빠진 거래도 지우지 않아요.
                    {fileLabel ? <span className="mt-1 block text-zinc-300">불러온 파일: {fileLabel}</span> : null}
                  </>
                }
              />
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={uploadLabel}
              onChange={(event) => setUploadLabel(event.target.value)}
              aria-label="업로드할 엑셀의 주인"
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800"
            >
              {HOUSEHOLD_MEMBERS.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <label className="cursor-pointer rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-800">
              엑셀 업로드
              <input
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={onFile}
                disabled={loading}
              />
            </label>
            <button
              type="button"
              onClick={syncFromDataFolders}
              disabled={loading}
              className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
            >
              {loading ? "동기화 중…" : "동기화"}
            </button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4" aria-label="주요 메뉴">
          {(
            [
              ["home", "홈"],
              ["calendar", "가계부"],
              ["ledger", "상세내역"],
              ["analysis", "분석"],
              ["settings", "설정"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTab(key)}
              className={`border-b-2 px-4 py-3 text-sm font-medium ${
                activeTab === key
                  ? "border-emerald-700 text-emerald-800"
                  : "border-transparent text-zinc-500 hover:text-zinc-900"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl space-y-8 px-4 py-8">
        {error ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {error}
          </div>
        ) : null}

        {ledger.length > 0 ? (
          <>
            {activeTab === "analysis" ? (
              <section className="rounded-xl border border-zinc-200 bg-white px-6 py-20 text-center shadow-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">
                  MoneyGrow Analysis
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-zinc-900">분석 기능 준비 중</h2>
                <p className="mt-2 text-sm text-zinc-500">
                  기간 비교, 소비 패턴, 예산 예측 기능을 이곳에 추가할 예정입니다.
                </p>
              </section>
            ) : null}
            <div className={activeTab === "settings" ? "contents" : "hidden"}>
            <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
              <h2 className="text-lg font-semibold text-zinc-800">
                분류 설정
                <InfoBadge text="거래에 쓸 대분류를 추가하거나 이름을 바꿔요. 예산 항목 이름도 여기서 바꿔요." />
              </h2>
              <div className="mt-3 flex gap-2">
                <input
                  type="text"
                  value={newCategoryName}
                  onChange={(event) => setNewCategoryName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && newCategoryName.trim()) {
                      void updateCategorySettings({ action: "add", name: newCategoryName.trim() });
                      setNewCategoryName("");
                    }
                  }}
                  placeholder="새 대분류 이름"
                  className="min-w-0 flex-1 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm"
                />
                <button
                  type="button"
                  disabled={settingsBusy || !newCategoryName.trim()}
                  onClick={() => {
                    void updateCategorySettings({ action: "add", name: newCategoryName.trim() });
                    setNewCategoryName("");
                  }}
                  className="rounded-lg bg-emerald-700 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  대분류 추가
                </button>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {allMainCategories.map((category) => (
                  <div key={category} className="flex items-center gap-2 rounded-lg border border-zinc-200 p-2 text-sm">
                    <input
                      type="text"
                      defaultValue={category}
                      disabled={settingsBusy}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                      }}
                      onBlur={(event) => {
                        const newName = event.currentTarget.value.trim();
                        if (newName && newName !== category) {
                          void updateCategorySettings({
                            action: "rename",
                            oldName: category,
                            newName,
                          });
                        }
                      }}
                      className="min-w-0 flex-1 rounded border border-transparent px-1 py-0.5 text-sm hover:border-zinc-300 focus:border-emerald-600 focus:outline-none"
                    />
                    <button
                      type="button"
                      disabled={settingsBusy}
                      onClick={() => {
                        if (window.confirm(`'${category}' 대분류를 삭제할까요?`)) {
                          void updateCategorySettings({ action: "delete", name: category });
                        }
                      }}
                      className="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-red-50 hover:text-red-700"
                    >
                      삭제
                    </button>
                  </div>
                ))}
              </div>
              <h3 className="mt-6 text-sm font-semibold text-zinc-800">
                자동 분류 규칙
                <InfoBadge text="내용에 이 글자가 들어간 거래를 항상 이 대분류로 분류해요. 추가하면 기존 거래에도 바로 적용되고, 동기화로 새로 들어오는 거래에도 적용돼요. 직접 바꾼 분류는 건드리지 않아요." />
              </h3>
              <div className="mt-3 flex flex-wrap gap-2">
                <input
                  type="text"
                  value={ruleDraft.match}
                  onChange={(event) => setRuleDraft((prev) => ({ ...prev, match: event.target.value }))}
                  placeholder="내용에 들어가는 글자 (예: KT통신요금)"
                  className="min-w-0 flex-1 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm"
                />
                <select
                  value={ruleDraft.category}
                  onChange={(event) => setRuleDraft((prev) => ({ ...prev, category: event.target.value }))}
                  className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm"
                >
                  <option value="">대분류 선택</option>
                  {allMainCategories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={settingsBusy || !ruleDraft.match.trim() || !ruleDraft.category}
                  onClick={() => {
                    void updateCategorySettings({ action: "rule-add", ...ruleDraft });
                    setRuleDraft({ match: "", category: "" });
                  }}
                  className="rounded-lg bg-emerald-700 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  규칙 추가
                </button>
              </div>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {rules.map((rule) => (
                  <li key={rule.match} className="flex items-center gap-2 rounded-lg border border-zinc-200 p-2 text-sm">
                    <span className="min-w-0 flex-1 truncate text-zinc-800">
                      &ldquo;{rule.match}&rdquo; → <span className="font-medium">{rule.category}</span>
                    </span>
                    <button
                      type="button"
                      disabled={settingsBusy}
                      onClick={() => void updateCategorySettings({ action: "rule-delete", match: rule.match })}
                      className="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-red-50 hover:text-red-700"
                    >
                      삭제
                    </button>
                  </li>
                ))}
              </ul>
              <h3 className="mt-6 text-sm font-semibold text-zinc-800">예산 항목 이름</h3>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {BUDGET_ITEM_KEYS.map((key) => (
                  <label key={key} className="flex items-center gap-2 rounded-lg border border-zinc-200 p-2 text-sm">
                    <span className="shrink-0 text-xs text-zinc-400">{DEFAULT_BUDGET_ITEM_LABELS[key]} →</span>
                    <input
                      type="text"
                      defaultValue={budgetItemLabels[key]}
                      disabled={settingsBusy}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                      }}
                      onBlur={(event) => {
                        const label = event.currentTarget.value.trim();
                        if (label && label !== budgetItemLabels[key]) {
                          void updateCategorySettings({ action: "budget-label", key, label });
                        }
                      }}
                      className="min-w-0 flex-1 rounded border border-transparent px-1 py-0.5 text-sm text-zinc-900 hover:border-zinc-300 focus:border-emerald-600 focus:outline-none"
                    />
                  </label>
                ))}
              </div>
            </section>


            <BudgetSettings
              plans={budgetPlans}
              labels={budgetItemLabels}
              categories={allMainCategories}
              busy={budgetBusy}
              onSave={saveBudgetPlan}
              onDelete={deleteBudgetPlan}
            />

            </div>
            <div className={activeTab === "calendar" ? "contents" : "hidden"}>
              {renderFilter({
                hint: "가계부는 직접 조절할 수 있는 생활 지출만 보도록 걸러요. 체크를 끈 대분류와 전액 환불된 결제(결제·환불 둘 다)는 달력과 날짜별 거래에서 빠지고, 이 설정은 저장돼요.",
                hidden: calendarHiddenSet,
                onChange: saveCalendarHidden,
              })}
              <CalendarTab
                ledger={tripLedger}
                dayEntries={calendarEntries}
                settlementGroups={settlementGroups}
                events={trips}
                flowKind={flowKind}
                busy={settingsBusy || mergeBusyRow === "settlement-save"}
                onAddEvent={(draft) => void updateCategorySettings({ action: "trip-add", ...draft })}
                onDeleteEvent={(id) => void updateCategorySettings({ action: "trip-delete", id })}
                onGroup={(memberIds) => requestSettlement("POST", { memberIds })}
                onUngroup={(groupId) => void requestSettlement("DELETE", { groupId })}
              />
            </div>
            <div className={activeTab === "home" ? "contents" : "hidden"}>
            <section className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
              <StatCard
                label="순자산"
                value={netWorth ? formatWon(netWorth.netWorth) : "—"}
                hint="뱅크샐러드 자산 현황(서정+상윤)의 전체 자산 − 부채예요. 마지막 동기화 시점 기준이에요."
              />
              <StatCard
                label="현금성 자산"
                value={netWorth ? formatWon(assetSum.cash) : "—"}
                hint={`입출금 ${formatWon(assetSum.byCategory("자유입출금 자산") + assetSum.byCategory("전자금융 자산"))} · 적금·예금 ${formatWon(assetSum.byCategory("저축성 자산"))} · 투자 ${formatWon(assetSum.byCategory("투자성 자산"))}`}
              />
              <StatCard
                label="부동산"
                value={netWorth ? formatWon(assetSum.byCategory("부동산")) : "—"}
                hint="뱅크샐러드에 등록된 시세예요."
              />
              <StatCard
                label="부채"
                value={netWorth ? formatWon(netWorth.totalDebt) : "—"}
                hint="뱅크샐러드 자산 현황의 대출 합계예요."
              />
              <StatCard
                label="연금"
                value={netWorth ? formatWon(assetSum.byCategory("연금 자산")) : "—"}
                hint="당장 쓸 수 없는 돈이라 현금성 자산과 따로 봐요."
              />
            </section>

            <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-zinc-800">
                    예산 집행률
                    {monthPlan ? (
                      <InfoBadge
                        text={`${monthPlan.startDate} ~ ${monthPlanEnd || "진행 중"} 예산 기준이에요. 환불은 쓴 돈에서 빼고, 투자·적금은 넣은 금액만 세요.`}
                      />
                    ) : null}
                  </h2>
                  {monthPlan ? null : (
                    <p className="text-sm text-zinc-500">
                      {budgetPlans.length > 0
                        ? "이 달에 적용된 예산이 없어요. 설정에서 기간을 추가해 주세요."
                        : "설정에서 예산을 먼저 만들어 주세요."}
                    </p>
                  )}
                </div>
                <label className="text-sm text-zinc-600">
                  조회 월
                  <select
                    value={budgetMonth}
                    onChange={(event) => setBudgetMonth(event.target.value)}
                    className="ml-2 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-900"
                  >
                    {budgetMonthOptions.map((month) => (
                      <option key={month} value={month}>
                        {month.replace("-", "년 ")}월
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {monthlyBudgetProgress.map(({ key, budget, spent, remaining, rate }) => (
                  <div key={key} className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold text-zinc-800">{budgetItemLabels[key]}</p>
                      <span className={`text-xs font-semibold ${rate > 100 ? "text-red-700" : "text-zinc-700"}`}>
                        {budget > 0 ? `${rate.toFixed(1)}%` : "미설정"}
                      </span>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-200">
                      <div
                        className={`h-full rounded-full ${
                          rate > 100 ? "bg-red-500" : rate >= 80 ? "bg-amber-500" : "bg-emerald-600"
                        }`}
                        style={{ width: `${Math.min(rate, 100)}%` }}
                      />
                    </div>
                    <p className="mt-2 text-xs text-zinc-500">
                      {formatWon(spent)} 사용 / {formatWon(budget)}
                    </p>
                    <p className={`mt-1 text-xs ${remaining < 0 ? "text-red-700" : "text-zinc-400"}`}>
                      {remaining < 0
                        ? `${formatWon(Math.abs(remaining))} 초과`
                        : `${formatWon(remaining)} 남음`}
                    </p>
                  </div>
                ))}
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {rolloverBudgetProgress.map(
                  ({ key, available, spent, carryover, rate, elapsedMonths }) => (
                    <div key={key} className="rounded-lg border border-violet-200 bg-violet-50/40 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-zinc-800">{budgetItemLabels[key]}</p>
                          <p className="mt-1 text-xs text-zinc-500">
                            {elapsedMonths}개월째 누적
                          </p>
                        </div>
                        <span className={`text-xs font-semibold ${rate > 100 ? "text-red-700" : "text-violet-800"}`}>
                          {available > 0 ? `${rate.toFixed(1)}%` : "미설정"}
                        </span>
                      </div>
                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-200">
                        <div
                          className={`h-full rounded-full ${
                            rate > 100 ? "bg-red-500" : rate >= 80 ? "bg-amber-500" : "bg-violet-600"
                          }`}
                          style={{ width: `${Math.min(rate, 100)}%` }}
                        />
                      </div>
                      <p className="mt-2 text-xs text-zinc-500">
                        누적 {formatWon(spent)} 사용 / 현재까지 {formatWon(available)}
                      </p>
                      <p className={`mt-1 text-xs ${carryover < 0 ? "text-red-700" : "text-violet-700"}`}>
                        {carryover < 0
                          ? `${formatWon(Math.abs(carryover))} 초과`
                          : `${formatWon(carryover)} 이월 가능`}
                      </p>
                    </div>
                  )
                )}
              </div>
            </section>

            {visibleEntries.length === 0 && ledger.filter(isLedgerEntryCounted).length > 0 ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                표시할 거래가 없습니다. 상세내역의 보기 필터를 확인하거나, 숨김을 해제해 보세요.
              </div>
            ) : null}

            <section className="grid gap-8 lg:grid-cols-3">
              <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm lg:col-span-2">
                <h2 className="text-lg font-semibold text-zinc-800">
                  월별 수입 · 지출
                  <InfoBadge
                    text={
                      <>
                        <span className="block font-semibold">빼고 계산하는 것</span>
                        <span className="block">· 내 계좌끼리 옮긴 돈(내계좌이체)</span>
                        <span className="block">· 서정 ↔ 상윤 사이 이체</span>
                        <span className="block">· 카드대금 (카드 쓴 날 지출로 이미 잡혀요)</span>
                        {filterActive ? <span className="block">· 보기 필터에서 꺼둔 대분류</span> : null}
                        <span className="mt-1 block">지출은 환불을 뺀 금액이에요.</span>
                        <span className="block">자산형성 = 투자·저축·집에 넣은 돈 − 찾은 돈·받은 증여</span>
                      </>
                    }
                  />
                </h2>
                <div className="mt-4 h-72 w-full min-w-0">
                  {chartData.length === 0 ? (
                    <p className="flex h-full items-center justify-center text-sm text-zinc-400">
                      차트로 표시할 월 데이터가 없습니다.
                    </p>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%" minHeight={288}>
                      <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
                        <XAxis dataKey="월" tick={{ fill: "#71717a", fontSize: 12 }} />
                        <YAxis
                          tick={{ fill: "#71717a", fontSize: 11 }}
                          tickFormatter={(v) => `${(v / 10000).toFixed(0)}만`}
                        />
                        <Tooltip
                          formatter={(value) =>
                            typeof value === "number" ? formatWon(value) : String(value ?? "")
                          }
                          labelFormatter={(l) => `20${l}`}
                          contentStyle={{ borderRadius: 8 }}
                        />
                        <Legend />
                        <Bar dataKey="수입" fill="#059669" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="지출" fill="#dc2626" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="자산형성" fill="#2563eb" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
                <h2 className="text-lg font-semibold text-zinc-800">
                  지출 대분류 TOP
                  <InfoBadge
                    text={`이체·카드대금·투자·저축을 뺀 실제 지출을, 환불을 빼고 큰 순서로 보여줘요.${filterActive ? " 꺼둔 대분류는 빠져요." : ""}`}
                  />
                </h2>
                <ul className="mt-4 space-y-2">
                  {topCategories.map(([name, amt]) => (
                    <li
                      key={name}
                      className="flex justify-between gap-2 border-b border-zinc-100 py-2 text-sm last:border-0"
                    >
                      <span className="text-zinc-700">{name}</span>
                      <span className="font-medium tabular-nums text-zinc-900">
                        {formatWon(amt)}
                      </span>
                    </li>
                  ))}
                  {topCategories.length === 0 ? (
                    <li className="text-sm text-zinc-400">지출 데이터 없음</li>
                  ) : null}
                </ul>
              </div>
            </section>

            <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
              <h2 className="text-lg font-semibold text-zinc-800">
                월별 남은 돈
                <InfoBadge text="그 달 수입 − 지출이에요. 투자·저축에 넣기 전, 모을 수 있었던 돈이에요." />
              </h2>
              <div className="mt-4 h-64 w-full min-w-0">
                {chartData.length === 0 ? (
                  <p className="flex h-full items-center justify-center text-sm text-zinc-400">
                    차트로 표시할 월 데이터가 없습니다.
                  </p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%" minHeight={256}>
                    <LineChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
                      <XAxis dataKey="월" tick={{ fill: "#71717a", fontSize: 12 }} />
                      <YAxis
                        tick={{ fill: "#71717a", fontSize: 11 }}
                        tickFormatter={(v) => `${(v / 10000).toFixed(0)}만`}
                      />
                      <Tooltip
                        formatter={(value) =>
                          typeof value === "number" ? formatWon(value) : String(value ?? "")
                        }
                        labelFormatter={(l) => `20${l}`}
                      />
                      <Line
                        type="monotone"
                        dataKey="순현금흐름"
                        stroke="#2563eb"
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </section>

            <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
              <h2 className="text-lg font-semibold text-zinc-800">
                순자산 추이
                <InfoBadge text="엑셀을 내려받은 날마다 뱅크샐러드 자산 현황(서정+상윤)을 기록해요. 동기화하면 data 폴더의 엑셀이 모두 반영돼요." />
              </h2>
              <div className="mt-4 h-64 w-full min-w-0">
                {netWorthHistory.length === 0 ? (
                  <p className="flex h-full items-center justify-center text-sm text-zinc-400">
                    아직 순자산 기록이 없습니다. 동기화를 눌러 주세요.
                  </p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%" minHeight={256}>
                    <LineChart data={netWorthHistory} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
                      <XAxis dataKey="date" tick={{ fill: "#71717a", fontSize: 12 }} />
                      <YAxis
                        domain={["auto", "auto"]}
                        tick={{ fill: "#71717a", fontSize: 11 }}
                        tickFormatter={(v) => `${(v / 100000000).toFixed(2)}억`}
                      />
                      <Tooltip
                        content={({ active, payload }) => {
                          const point = payload?.[0]?.payload as NetWorthPoint | undefined;
                          if (!active || !point) return null;
                          return (
                            <div className="rounded-lg border border-zinc-200 bg-white p-2 text-xs shadow">
                              <p className="font-medium text-zinc-800">{point.date}</p>
                              <p>순자산 {formatWon(point.netWorth)}</p>
                              <p className="text-zinc-500">
                                자산 {formatWon(point.totalAssets)} · 부채 {formatWon(point.totalDebt)}
                              </p>
                              {Object.entries(point.byPerson).map(([label, value]) => (
                                <p key={label} className="text-zinc-500">
                                  {label} {formatWon(value)}
                                </p>
                              ))}
                            </div>
                          );
                        }}
                      />
                      <Line type="monotone" dataKey="netWorth" stroke="#047857" strokeWidth={2} dot />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </section>

            {netWorth && netWorth.assets.length > 0 ? (
              <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
                <h2 className="text-lg font-semibold text-zinc-800">
                  자산 상세
                  <InfoBadge text="마지막으로 동기화한 뱅크샐러드 자산 현황의 계좌·상품별 금액이에요." />
                </h2>
                <div className="mt-4 max-h-64 overflow-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="sticky top-0 bg-white text-xs text-zinc-500">
                      <tr>
                        <th className="pb-2 pr-4 font-medium">라벨</th>
                        <th className="pb-2 pr-4 font-medium">구분</th>
                        <th className="pb-2 pr-4 font-medium">상품</th>
                        <th className="pb-2 text-right font-medium">금액</th>
                      </tr>
                    </thead>
                    <tbody>
                      {netWorth.assets.slice(0, 50).map((a, i) => (
                        <tr
                          key={`${a.sourceLabel ?? ""}-${a.name}-${i}`}
                          className="border-t border-zinc-100"
                        >
                          <td className="py-2 pr-4 text-zinc-500">{a.sourceLabel || "—"}</td>
                          <td className="py-2 pr-4 text-zinc-600">{a.category || "—"}</td>
                          <td className="py-2 pr-4 text-zinc-900">{a.name}</td>
                          <td className="py-2 text-right tabular-nums font-medium">
                            {formatWon(a.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}

            </div>
            <div className={activeTab === "ledger" ? "contents" : "hidden"}>
            {renderFilter({
              hint: "상세내역에는 모든 거래가 들어가요. 체크를 끈 대분류는 상세내역과 홈 차트에서 잠깐 빠지고, 새로고침하면 다시 모두 보여요.",
              hidden: hiddenSet,
              onChange: setHiddenMainCategories,
            })}
            <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-zinc-800">
                    거래내역
                    <InfoBadge text="숨긴 거래와 꺼둔 대분류는 합계에서 빠져요." />
                  </h2>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {settlementMode ? (
                    <>
                      <button
                        type="button"
                        onClick={saveSettlementGroup}
                        disabled={selectedSettlementIds.length < 2 || mergeBusyRow === "settlement-save"}
                        className="rounded-lg bg-blue-700 px-3 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50"
                      >
                        {mergeBusyRow === "settlement-save"
                          ? "저장 중…"
                          : `합치기 저장 (${selectedSettlementIds.length})`}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSettlementMode(false);
                          setSelectedSettlementIds([]);
                        }}
                        className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm"
                      >
                        취소
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setSettlementMode(true)}
                      className="rounded-lg border border-blue-300 bg-white px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50"
                    >
                      거래 합치기
                    </button>
                  )}
                  <label htmlFor="tx-month" className="text-sm text-zinc-600">
                    조회 월
                  </label>
                  <select
                    id="tx-month"
                    value={txMonth}
                    onChange={(e) => setTxMonth(e.target.value)}
                    className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-900 shadow-sm focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600"
                  >
                    {monthSelectOptions.map((m) => (
                      <option key={m} value={m}>
                        {m.replace("-", "년 ")}월
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <p className="mt-2 text-sm text-zinc-600">
                <span className="font-medium tabular-nums text-zinc-900">
                  {ledgerRowsForMonth.length.toLocaleString("ko-KR")}
                </span>
                건 · {txMonth.replace("-", "년 ")}월
              </p>
              <div className="mt-4 overflow-x-auto">
                {ledgerRowsForMonth.length === 0 ? (
                  <p className="py-8 text-center text-sm text-zinc-400">
                    이 달에 표시 조건에 맞는 거래가 없습니다. 월을 바꾸거나 보기 필터를 확인해 보세요.
                  </p>
                ) : (
                  <table className="w-full min-w-[1040px] table-fixed text-left text-sm">
                    <thead className="text-xs text-zinc-500">
                      <tr>
                        {settlementMode ? <th className="pb-2 pr-2 font-medium">선택</th> : null}
                        <th className="w-14 pb-2 font-medium">라벨</th>
                        <th className="w-24 pb-2 font-medium">날짜</th>
                        <th className="w-16 pb-2 font-medium">시간</th>
                        <th className="w-14 pb-2 font-medium">타입</th>
                        <th className="w-32 pb-2 font-medium">대분류 수정</th>
                        <th className="pb-2 font-medium">내용</th>
                        <th className="w-36 pb-2 font-medium">메모</th>
                        <th className="w-28 pb-2 text-right font-medium">금액</th>
                        <th className="w-12 whitespace-nowrap border-l border-zinc-200 pb-2 pl-2 text-center font-medium">
                          관리
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledgerRowsForMonth.map((e, rowIdx) => {
                        const rowKey = ledgerEntryStableKey(e);
                        const rowId = `${rowKey}::${rowIdx}`;
                        const statusBusy = statusBusyKey === rowId;
                        const settlementDetails = e.id
                          ? settlementView.detailsByGroupId.get(e.id)
                          : undefined;
                        const isSettlement = !!settlementDetails;
                        const settlementExpanded = expandedSettlementId === e.id;
                        const isSelected = !!e.id && selectedSettlementIds.includes(e.id);
                        return (
                          <Fragment key={rowId}>
                            <tr
                              className={`border-t border-zinc-100 ${
                                isSettlement ? "cursor-pointer bg-blue-50/40 hover:bg-blue-50" : ""
                              }`}
                              onClick={() => {
                                if (isSettlement && e.id) {
                                  setExpandedSettlementId((prev) => (prev === e.id ? null : e.id!));
                                }
                              }}
                            >
                              {settlementMode ? (
                                <td className="py-2 pr-2">
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    disabled={isSettlement || !e.id}
                                    onClick={(event) => event.stopPropagation()}
                                    onChange={() => {
                                      if (!e.id) return;
                                      setSelectedSettlementIds((prev) =>
                                        prev.includes(e.id!)
                                          ? prev.filter((id) => id !== e.id)
                                          : [...prev, e.id!]
                                      );
                                    }}
                                    className="h-4 w-4 rounded border-zinc-300 text-blue-700"
                                  />
                                </td>
                              ) : null}
                              <td className="py-2 text-zinc-500">{e.sourceLabel || "—"}</td>
                              <td className="py-2 tabular-nums text-zinc-600">{e.date}</td>
                              <td className="py-2 tabular-nums text-zinc-500">{e.time || "—"}</td>
                              <td className="py-2 text-zinc-700">{e.txType}</td>
                              <td className="py-2 text-zinc-700" onClick={(event) => event.stopPropagation()}>
                                {isSettlement ? (
                                  <span>{mainCategoryOf(e)}</span>
                                ) : (
                                  <button
                                    type="button"
                                    disabled={categoryBusyId === e.id}
                                    onClick={(event) => {
                                      if (categoryPickerId === e.id) {
                                        setCategoryPickerId(null);
                                        setCategoryPickerPosition(null);
                                        return;
                                      }
                                      const rect = event.currentTarget.getBoundingClientRect();
                                      const width = Math.min(440, window.innerWidth - 24);
                                      const left = Math.max(
                                        12,
                                        Math.min(rect.left, window.innerWidth - width - 12)
                                      );
                                      const estimatedHeight = 300;
                                      const top =
                                        rect.bottom + estimatedHeight <= window.innerHeight
                                          ? rect.bottom + 6
                                          : Math.max(12, rect.top - estimatedHeight - 6);
                                      setCategoryPickerId(e.id ?? null);
                                      setCategoryPickerPosition({ top, left, width });
                                    }}
                                    className="inline-flex min-w-28 items-center justify-between gap-2 rounded border border-zinc-200 bg-white px-2 py-1 text-left text-xs hover:border-emerald-500 hover:bg-emerald-50 disabled:opacity-50"
                                  >
                                    <span>{mainCategoryOf(e)}</span>
                                    <span className="text-zinc-400">
                                      {categoryPickerId === e.id ? "▴" : "▾"}
                                    </span>
                                  </button>
                                )}
                              </td>
                              <td className="max-w-[160px] truncate py-2 pr-2 text-zinc-900" title={e.description}>
                                {isSettlement ? (
                                  <span>
                                    {settlementExpanded ? "▾" : "▸"} {e.description}
                                  </span>
                                ) : e.description}
                              </td>
                              <td className="py-2 pr-2" onClick={(event) => event.stopPropagation()}>
                                {isSettlement ? (
                                  <span className="text-xs text-zinc-500">{e.note || "—"}</span>
                                ) : (
                                  <input
                                    type="text"
                                    defaultValue={noteOf(e)}
                                    disabled={noteBusyId === e.id}
                                    placeholder="상세 내역 메모"
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter") event.currentTarget.blur();
                                    }}
                                    onBlur={(event) => {
                                      const next = event.currentTarget.value.trim();
                                      if (next !== noteOf(e)) updateEntryNote(e, next);
                                    }}
                                    className="w-32 rounded border border-zinc-200 bg-white px-2 py-1 text-xs focus:border-emerald-600 focus:outline-none disabled:opacity-50"
                                  />
                                )}
                              </td>
                              <td
                                className={`whitespace-nowrap py-2 text-right tabular-nums font-medium ${
                                  e.amount >= 0 ? "text-emerald-700" : "text-red-700"
                                }`}
                              >
                                {formatWon(e.amount)}
                              </td>
                              <td className="border-l border-zinc-100 py-2 pl-2 text-center">
                                {isSettlement ? (
                                  <span className="text-xs text-zinc-400" title="정산 묶음">묶음</span>
                                ) : <button
                                  type="button"
                                  disabled={statusBusy}
                                  onClick={() =>
                                    patchEntryStatus(rowKey, "hidden", {
                                      id: e.id,
                                      busyId: rowId,
                                    })
                                  }
                                  className="inline-flex h-7 w-7 items-center justify-center rounded border border-zinc-300 bg-white text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800 disabled:opacity-50"
                                  title="목록·합계·차트에서 제외"
                                  aria-label="거래 숨기기"
                                >
                                  {statusBusy ? (
                                    "…"
                                  ) : (
                                    <svg
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="1.8"
                                      className="h-4 w-4"
                                      aria-hidden="true"
                                    >
                                      <path d="M3 3l18 18" />
                                      <path d="M10.6 10.7a2 2 0 002.7 2.7" />
                                      <path d="M9.9 4.3A10.7 10.7 0 0112 4c5.5 0 9 5 9 5a16.4 16.4 0 01-2.1 2.6M6.6 6.7C4.3 8.2 3 10 3 10s3.5 5 9 5a10 10 0 003.4-.6" />
                                    </svg>
                                  )}
                                </button>}
                              </td>
                            </tr>
                            {settlementExpanded && settlementDetails ? (
                              <tr className="border-t border-zinc-100 bg-blue-50/40">
                                <td
                                  className="py-3 pl-3 pr-2 text-xs text-zinc-600"
                                  colSpan={settlementMode ? 10 : 9}
                                >
                                  <p className="mb-2 font-medium text-blue-900">정산 상세</p>
                                  <ul className="space-y-1.5">
                                    {settlementDetails.map((detail) => (
                                      <li
                                        key={detail.id}
                                        className="flex flex-wrap justify-between gap-2 rounded bg-white px-3 py-2"
                                      >
                                        <span>
                                          {detail.amount < 0 ? "지출" : "받은 금액"} ·{" "}
                                          {detail.description || detail.sourceLabel || "내용 없음"}
                                          {detail.amount > 0 && detail.sourceLabel
                                            ? ` · ${detail.sourceLabel}`
                                            : ""}
                                        </span>
                                        <span
                                          className={`font-semibold tabular-nums ${
                                            detail.amount < 0 ? "text-red-700" : "text-emerald-700"
                                          }`}
                                        >
                                          {formatWon(detail.amount)}
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                  <p className="mt-3 text-right text-sm font-semibold text-zinc-900">
                                    내가 쓴 금액 {formatWon(Math.abs(e.amount))}
                                  </p>
                                </td>
                              </tr>
                            ) : null}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              {categoryPickerEntry && categoryPickerPosition ? (
                <>
                  <button
                    type="button"
                    aria-label="대분류 선택 닫기"
                    className="fixed inset-0 z-40 cursor-default bg-transparent"
                    onClick={() => {
                      setCategoryPickerId(null);
                      setCategoryPickerPosition(null);
                    }}
                  />
                  <div
                    role="dialog"
                    aria-label="대분류 선택"
                    className="fixed z-50 rounded-xl border border-zinc-200 bg-white p-3 shadow-2xl"
                    style={{
                      top: categoryPickerPosition.top,
                      left: categoryPickerPosition.left,
                      width: categoryPickerPosition.width,
                    }}
                  >
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold text-zinc-800">대분류 선택</p>
                      <button
                        type="button"
                        onClick={() => {
                          setCategoryPickerId(null);
                          setCategoryPickerPosition(null);
                        }}
                        className="rounded px-1.5 py-0.5 text-xs text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                      >
                        닫기
                      </button>
                    </div>
                    <div className="grid max-h-64 grid-cols-4 gap-1.5 overflow-y-auto">
                      {allMainCategories.map((category) => (
                        <button
                          key={category}
                          type="button"
                          disabled={categoryBusyId === categoryPickerEntry.id}
                          onClick={() => updateEntryCategory(categoryPickerEntry, category)}
                          className={`truncate rounded-md border px-2 py-2 text-xs ${
                            category === mainCategoryOf(categoryPickerEntry)
                              ? "border-emerald-600 bg-emerald-600 font-semibold text-white"
                              : "border-zinc-200 bg-white text-zinc-700 hover:border-emerald-400 hover:bg-emerald-50"
                          }`}
                          title={category}
                        >
                          {category}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              ) : null}

              {hiddenRowsForMonth.length > 0 ? (
                <div className="mt-6 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3">
                  <h3 className="text-sm font-semibold text-zinc-700">
                    숨긴 거래 ({hiddenRowsForMonth.length}건)
                    <InfoBadge text="합계·차트에서 빠진 거래예요. 복구하면 다시 들어가요." />
                  </h3>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[820px] text-left text-sm text-zinc-600">
                      <thead className="text-xs text-zinc-500">
                        <tr>
                          <th className="pb-2 font-medium">라벨</th>
                          <th className="pb-2 font-medium">날짜</th>
                          <th className="pb-2 font-medium">시간</th>
                          <th className="pb-2 font-medium">대분류</th>
                          <th className="pb-2 font-medium">내용</th>
                          <th className="pb-2 text-right font-medium">금액</th>
                          <th className="pb-2 pl-2 text-right font-medium whitespace-nowrap border-l border-zinc-300">
                            복구
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {hiddenRowsForMonth.map((e, rowIdx) => {
                          const rowKey = ledgerEntryStableKey(e);
                          const busy = statusBusyKey === `${rowKey}::h${rowIdx}`;
                          return (
                            <tr key={`${rowKey}::h${rowIdx}`} className="border-t border-zinc-200">
                              <td className="py-2">{e.sourceLabel || "—"}</td>
                              <td className="py-2 tabular-nums">{e.date}</td>
                              <td className="py-2 tabular-nums">{e.time || "—"}</td>
                              <td className="py-2">{mainCategoryOf(e)}</td>
                              <td className="py-2 truncate max-w-[200px]" title={e.description}>
                                {e.description}
                              </td>
                              <td
                                className={`py-2 text-right tabular-nums font-medium ${
                                  e.amount >= 0 ? "text-emerald-700" : "text-red-700"
                                }`}
                              >
                                {formatWon(e.amount)}
                              </td>
                              <td className="py-2 pl-2 text-right border-l border-zinc-200">
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() =>
                                    patchEntryStatus(rowKey, "visible", {
                                      id: e.id,
                                      busyId: `${rowKey}::h${rowIdx}`,
                                    })
                                  }
                                  className="rounded border border-emerald-600 bg-white px-2.5 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
                                  title="집계·목록에 다시 포함"
                                >
                                  {busy ? "…" : "복구"}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </section>
            </div>
          </>
        ) : !error ? (
          <p className="text-center text-sm text-zinc-500">
            시작하려면 동기화를 누르거나 엑셀을 업로드하세요.
          </p>
        ) : null}
      </main>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium text-zinc-500">
        {label}
        <InfoBadge text={hint} />
      </p>
      <p className="mt-2 text-xl font-semibold tabular-nums text-zinc-900">{value}</p>
    </div>
  );
}
