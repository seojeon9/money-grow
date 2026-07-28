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
  monthlyFlowsFromLedger,
} from "@/lib/excel/importBankExport";
import {
  BUDGET_ITEM_KEYS,
  DEFAULT_BUDGET_ITEM_LABELS,
  type BudgetItemKey,
  type BudgetPlan,
  type SavedBudgetPlan,
  emptyBudgetPlan,
} from "@/lib/budget";
import type { CategorySettings, SettlementGroup } from "@/lib/store/ledgerStore";

type LedgerApiPayload = {
  ledger?: LedgerEntry[];
  netWorth?: NetWorthSnapshot | null;
  summaryLabel?: string;
  updatedAt?: string;
  persistPath?: string;
  budgetPlan?: BudgetPlan;
  settlementGroups?: SettlementGroup[];
  budgetPlans?: SavedBudgetPlan[];
  activeBudgetPlanId?: string | null;
  categorySettings?: CategorySettings;
  error?: string;
};

const DEFAULT_HIDDEN_MAIN_CATEGORIES: string[] = [];
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

function reusedPeriodDates(plan: SavedBudgetPlan): { startDate: string; endDate: string } {
  const sourceStart = new Date(`${plan.startDate}T00:00:00`);
  const sourceEnd = new Date(`${plan.endDate}T00:00:00`);
  const durationDays = Math.max(
    0,
    Math.round((sourceEnd.getTime() - sourceStart.getTime()) / 86400000)
  );
  const startDate = localTodayIso();
  const nextEnd = new Date(`${startDate}T00:00:00`);
  nextEnd.setDate(nextEnd.getDate() + durationDays);
  const endDate = `${nextEnd.getFullYear()}-${String(nextEnd.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(nextEnd.getDate()).padStart(2, "0")}`;
  return { startDate, endDate };
}

const won = new Intl.NumberFormat("ko-KR", {
  style: "currency",
  currency: "KRW",
  maximumFractionDigits: 0,
});

function formatWon(n: number) {
  return won.format(n);
}

function mainCategoryOf(e: LedgerEntry): string {
  const c = e.categoryMainOverride?.trim() || e.categoryMain?.trim();
  return c || "기타";
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
  const [activeTab, setActiveTab] = useState<"home" | "ledger" | "analysis" | "settings">("home");
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [netWorth, setNetWorth] = useState<NetWorthSnapshot | null>(null);
  const [fileLabel, setFileLabel] = useState<string | null>(null);
  const [persistInfo, setPersistInfo] = useState<{ updatedAt: string | null; path: string | null }>(
    { updatedAt: null, path: null }
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
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
  const [budgetPlan, setBudgetPlan] = useState<BudgetPlan>(emptyBudgetPlan);
  const [budgetPlans, setBudgetPlans] = useState<SavedBudgetPlan[]>([]);
  const [activeBudgetPlanId, setActiveBudgetPlanId] = useState<string | null>(null);
  const [configuredCategories, setConfiguredCategories] = useState<string[]>([
    "목적자금",
    "세금",
    "가구/가전",
  ]);
  const [budgetItemLabels, setBudgetItemLabels] = useState<Record<BudgetItemKey, string>>({
    ...DEFAULT_BUDGET_ITEM_LABELS,
  });
  const [budgetBusy, setBudgetBusy] = useState(false);
  const [budgetSaved, setBudgetSaved] = useState(false);
  const [budgetMonth, setBudgetMonth] = useState<string>(currentMonthKey);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [expandedBudgetPlanId, setExpandedBudgetPlanId] = useState<string | null>(null);
  const [reusePlanId, setReusePlanId] = useState<string | null>(null);
  const [reuseDates, setReuseDates] = useState({ startDate: "", endDate: "" });

  /** 서버 디스크 누적본 — 새로고침 후에도 유지 */
  useEffect(() => {
    fetch("/api/ledger/state")
      .then((r) => r.json() as Promise<LedgerApiPayload>)
      .then((j) => {
        if (j.ledger && j.ledger.length > 0) {
          setLedger(j.ledger);
          setNetWorth(j.netWorth ?? null);
          setPersistInfo({ updatedAt: j.updatedAt ?? null, path: j.persistPath ?? null });
          setBudgetPlan(j.budgetPlan ?? emptyBudgetPlan());
          setSettlementGroups(j.settlementGroups ?? []);
          setBudgetPlans(j.budgetPlans ?? []);
          setActiveBudgetPlanId(j.activeBudgetPlanId ?? null);
          setConfiguredCategories(j.categorySettings?.categories ?? []);
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
    fd.append("sourceLabel", "업로드");
    fetch("/api/ledger/upload", { method: "POST", body: fd })
      .then(async (res) => {
        const j = (await res.json()) as LedgerApiPayload;
        if (!res.ok) throw new Error(j.error ?? res.statusText);
        setError(null);
        setHiddenMainCategories([...DEFAULT_HIDDEN_MAIN_CATEGORIES]);
        setTxMonth(currentMonthKey());
        setLedger(j.ledger ?? []);
        setNetWorth(j.netWorth ?? null);
        setFileLabel(j.summaryLabel ?? f.name);
        setPersistInfo({ updatedAt: j.updatedAt ?? null, path: j.persistPath ?? null });
        setBudgetPlan(j.budgetPlan ?? emptyBudgetPlan());
        setSettlementGroups(j.settlementGroups ?? []);
        setBudgetPlans(j.budgetPlans ?? []);
        setActiveBudgetPlanId(j.activeBudgetPlanId ?? null);
        setConfiguredCategories(j.categorySettings?.categories ?? []);
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
  }, []);

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
        setFileLabel(j.summaryLabel ?? "동기화");
        setPersistInfo({ updatedAt: j.updatedAt ?? null, path: j.persistPath ?? null });
        setBudgetPlan(j.budgetPlan ?? emptyBudgetPlan());
        setSettlementGroups(j.settlementGroups ?? []);
        setBudgetPlans(j.budgetPlans ?? []);
        setActiveBudgetPlanId(j.activeBudgetPlanId ?? null);
        setConfiguredCategories(j.categorySettings?.categories ?? []);
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

  const settlementView = useMemo(() => {
    const entriesById = new Map(
      ledger.filter((entry) => entry.id).map((entry) => [entry.id as string, entry])
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
  }, [ledger, settlementGroups]);

  const ledgerWithSettlements = useMemo(
    () => [
      ...ledger.filter((entry) => !entry.id || !settlementView.groupedIds.has(entry.id)),
      ...settlementView.syntheticEntries,
    ],
    [ledger, settlementView]
  );

  /** 숨김(status) + 대분류 필터 통과분만 집계·차트·일반 목록에 사용 */
  const visibleEntries = useMemo(() => {
    return ledgerWithSettlements
      .filter(isLedgerEntryCounted)
      .filter((e) => !hiddenSet.has(mainCategoryOf(e)));
  }, [ledgerWithSettlements, hiddenSet]);

  const isInvestmentSavingEntry = useCallback(
    (entry: LedgerEntry) => {
      const category = mainCategoryOf(entry);
      return (
        category === "투자" ||
        category === "저축" ||
        budgetPlan.categoryMappings[category] === "investmentSavings"
      );
    },
    [budgetPlan.categoryMappings]
  );

  const cashFlowEntries = useMemo(
    () =>
      visibleEntries.map((entry) =>
        entry.amount < 0 && isInvestmentSavingEntry(entry)
          ? { ...entry, amount: Math.abs(entry.amount) }
          : entry
      ),
    [isInvestmentSavingEntry, visibleEntries]
  );

  const monthly = useMemo(() => monthlyFlowsFromLedger(cashFlowEntries), [cashFlowEntries]);

  const chartData = useMemo(
    () =>
      monthly.map((m) => ({
        월: m.month.slice(2),
        수입: Math.round(m.income),
        지출: Math.round(m.expense),
        순현금흐름: Math.round(m.netCashFlow),
      })),
    [monthly]
  );

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

  const budgetMonthOptions = useMemo(() => {
    if (!budgetPlan.startDate || !budgetPlan.endDate) return [budgetMonth];
    const startMonth = budgetPlan.startDate.slice(0, 7);
    const endMonth = budgetPlan.endDate.slice(0, 7);
    const months: string[] = [];
    const cursor = new Date(`${startMonth}-01T00:00:00`);
    const end = new Date(`${endMonth}-01T00:00:00`);
    while (cursor <= end && months.length < 240) {
      months.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`);
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return months.reverse();
  }, [budgetMonth, budgetPlan.endDate, budgetPlan.startDate]);

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
    if (budgetPlan.startDate && budgetPlan.endDate) {
      for (const entry of ledgerWithSettlements) {
        if (!isLedgerEntryCounted(entry) || entry.amount >= 0) continue;
        if (entry.date < budgetPlan.startDate || entry.date > budgetPlan.endDate) continue;
        if (!entry.date.startsWith(budgetMonth)) continue;
        const item = budgetPlan.categoryMappings[mainCategoryOf(entry)];
        if (item) spent[item] += Math.abs(entry.amount);
      }
    }
    return MONTHLY_BUDGET_KEYS.map((key) => {
      const budget = budgetPlan.amounts[key];
      const used = spent[key];
      return {
        key,
        budget,
        spent: used,
        remaining: budget - used,
        rate: budget > 0 ? (used / budget) * 100 : 0,
      };
    });
  }, [budgetMonth, budgetPlan, ledgerWithSettlements]);

  const rolloverBudgetProgress = useMemo(() => {
    const today = localTodayIso();
    const cutoff =
      !budgetPlan.endDate || today < budgetPlan.endDate ? today : budgetPlan.endDate;
    const totalMonths = inclusiveMonthCount(budgetPlan.startDate, budgetPlan.endDate);
    const elapsedMonths =
      cutoff >= budgetPlan.startDate
        ? Math.min(totalMonths, inclusiveMonthCount(budgetPlan.startDate, cutoff))
        : 0;
    const spent = Object.fromEntries(ROLLOVER_BUDGET_KEYS.map((key) => [key, 0])) as Record<
      BudgetItemKey,
      number
    >;

    if (elapsedMonths > 0) {
      for (const entry of ledgerWithSettlements) {
        if (!isLedgerEntryCounted(entry) || entry.amount >= 0) continue;
        if (entry.date < budgetPlan.startDate || entry.date > cutoff) continue;
        const item = budgetPlan.categoryMappings[mainCategoryOf(entry)];
        if (item === "personal" || item === "emergency") {
          spent[item] += Math.abs(entry.amount);
        }
      }
    }

    return ROLLOVER_BUDGET_KEYS.map((key) => {
      const monthlyBudget = budgetPlan.amounts[key];
      const available = monthlyBudget * elapsedMonths;
      const used = spent[key];
      return {
        key,
        monthlyBudget,
        planTotal: monthlyBudget * totalMonths,
        available,
        spent: used,
        carryover: available - used,
        rate: available > 0 ? (used / available) * 100 : 0,
        elapsedMonths,
        totalMonths,
        cutoff,
      };
    });
  }, [budgetPlan, ledgerWithSettlements]);

  const salaryAllocation = useMemo(() => {
    const allocated = BUDGET_ITEM_KEYS.reduce(
      (sum, key) => sum + (budgetPlan.amounts[key] || 0),
      0
    );
    return {
      allocated,
      remaining: budgetPlan.fixedSalary - allocated,
      rate: budgetPlan.fixedSalary > 0 ? (allocated / budgetPlan.fixedSalary) * 100 : 0,
    };
  }, [budgetPlan.amounts, budgetPlan.fixedSalary]);

  const saveBudgetPlan = useCallback(() => {
    setBudgetBusy(true);
    setBudgetSaved(false);
    setError(null);
    fetch("/api/ledger/budget-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...budgetPlan, id: activeBudgetPlanId }),
    })
      .then(async (res) => {
        const j = (await res.json()) as LedgerApiPayload;
        if (!res.ok) throw new Error(j.error ?? res.statusText);
        setBudgetPlan(j.budgetPlan ?? budgetPlan);
        setBudgetPlans(j.budgetPlans ?? []);
        setActiveBudgetPlanId(j.activeBudgetPlanId ?? null);
        setPersistInfo({ updatedAt: j.updatedAt ?? null, path: j.persistPath ?? null });
        setBudgetSaved(true);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setBudgetBusy(false));
  }, [activeBudgetPlanId, budgetPlan]);

  const applySettingsPayload = useCallback((j: LedgerApiPayload) => {
    if (j.ledger) setLedger(j.ledger);
    if (j.budgetPlan) setBudgetPlan(j.budgetPlan);
    setBudgetPlans(j.budgetPlans ?? []);
    setActiveBudgetPlanId(j.activeBudgetPlanId ?? null);
    if (j.categorySettings) {
      setConfiguredCategories(j.categorySettings.categories);
      setBudgetItemLabels(j.categorySettings.budgetItemLabels);
    }
    setPersistInfo({ updatedAt: j.updatedAt ?? null, path: j.persistPath ?? null });
  }, []);

  const updateCategorySettings = useCallback(
    (body: Record<string, string>) => {
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

  const reuseBudgetPlan = useCallback(() => {
    if (!reusePlanId) return;
    setBudgetBusy(true);
    setError(null);
    fetch("/api/ledger/budget-plan/reuse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourcePlanId: reusePlanId, ...reuseDates }),
    })
      .then(async (res) => {
        const j = (await res.json()) as LedgerApiPayload;
        if (!res.ok) throw new Error(j.error ?? res.statusText);
        applySettingsPayload(j);
        setReusePlanId(null);
        setReuseDates({ startDate: "", endDate: "" });
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setBudgetBusy(false));
  }, [applySettingsPayload, reuseDates, reusePlanId]);

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

  const saveSettlementGroup = useCallback(() => {
    setMergeBusyRow("settlement-save");
    setError(null);
    fetch("/api/ledger/settlement-group", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberIds: selectedSettlementIds }),
    })
      .then(async (res) => {
        const j = (await res.json()) as LedgerApiPayload;
        if (!res.ok) throw new Error(j.error ?? res.statusText);
        setLedger(j.ledger ?? []);
        setSettlementGroups(j.settlementGroups ?? []);
        setSelectedSettlementIds([]);
        setSettlementMode(false);
        setPersistInfo({ updatedAt: j.updatedAt ?? null, path: j.persistPath ?? null });
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setMergeBusyRow(null));
  }, [selectedSettlementIds]);

  const topCategories = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of visibleEntries) {
      if (e.amount >= 0 || isInvestmentSavingEntry(e)) continue;
      const key = mainCategoryOf(e);
      m.set(key, (m.get(key) ?? 0) + Math.abs(e.amount));
    }
    return Array.from(m.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
  }, [isInvestmentSavingEntry, visibleEntries]);

  const toggleCategoryVisible = useCallback((cat: string) => {
    setHiddenMainCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  }, []);

  const filterActive = hiddenMainCategories.length > 0;

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">
              MoneyGrow · 부부 공동 대시보드
            </p>
            <h1 className="text-2xl font-semibold text-zinc-900">{householdLabel}</h1>
            {fileLabel ? (
              <p className="mt-1 text-sm text-zinc-500">데이터: {fileLabel}</p>
            ) : (
              <p className="mt-1 text-sm text-zinc-500">
                동기화로 폴더 엑셀을 반영(누적)하거나, 파일을 업로드하세요.
              </p>
            )}
            {persistInfo.updatedAt ? (
              <p className="mt-1 text-xs text-zinc-400">
                서버 저장 {persistInfo.path ?? "data/.moneygrow/ledger-state.json"} · 마지막 반영{" "}
                {new Date(persistInfo.updatedAt).toLocaleString("ko-KR", {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </p>
            ) : null}
            <p className="mt-1 text-xs text-zinc-400">
              새 엑셀에서는 저장소에 없던 거래만 붙습니다. 예전에 쌓인 행·앱에서만 넣은 메모(추후)는 같은
              키가 아니면 유지되며, 엑셀에서 사라진 거래는 자동으로 지우지 않습니다.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
              ["ledger", "가계부"],
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
              <h2 className="text-lg font-semibold text-zinc-800">분류 설정</h2>
              <p className="text-sm text-zinc-500">
                거래에서 사용할 대분류와 예산 항목의 표시 이름을 관리합니다.
              </p>
              <div className="mt-5 flex gap-2">
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
                  className="min-w-0 flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  disabled={settingsBusy || !newCategoryName.trim()}
                  onClick={() => {
                    void updateCategorySettings({ action: "add", name: newCategoryName.trim() });
                    setNewCategoryName("");
                  }}
                  className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  대분류 추가
                </button>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {allMainCategories.map((category) => (
                  <div key={category} className="flex items-center gap-2 rounded-lg border border-zinc-200 p-2">
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
                      className="min-w-0 flex-1 rounded border border-transparent px-2 py-1 text-sm hover:border-zinc-300 focus:border-emerald-600 focus:outline-none"
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
              <h3 className="mt-6 text-sm font-semibold text-zinc-800">예산 항목 이름</h3>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {BUDGET_ITEM_KEYS.map((key) => (
                  <label key={key} className="text-xs text-zinc-500">
                    {key}
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
                      className="mt-1 block w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900"
                    />
                  </label>
                ))}
              </div>
            </section>

            <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-zinc-800">대분류 표시</h2>
                  <p className="text-sm text-zinc-500">
                    체크 해제한 대분류는 차트·지출 TOP·거래내역 집계에서 제외됩니다. 순자산 카드는 엑셀
                    스냅샷이라 그대로입니다.
                  </p>
                </div>
                {filterActive ? (
                  <button
                    type="button"
                    onClick={() => setHiddenMainCategories([])}
                    className="shrink-0 text-sm font-medium text-emerald-700 hover:text-emerald-900"
                  >
                    전체 다시 표시
                  </button>
                ) : null}
              </div>
              <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
                {allMainCategories.map((cat) => {
                  const visible = !hiddenSet.has(cat);
                  return (
                    <label
                      key={cat}
                      className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-sm hover:bg-zinc-100"
                    >
                      <input
                        type="checkbox"
                        className="rounded border-zinc-300 text-emerald-700 focus:ring-emerald-600"
                        checked={visible}
                        onChange={() => toggleCategoryVisible(cat)}
                      />
                      <span className={visible ? "text-zinc-900" : "text-zinc-400 line-through"}>
                        {cat}
                      </span>
                    </label>
                  );
                })}
              </div>
            </section>

            <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
                <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:items-end">
                  <label className="text-sm font-semibold text-emerald-950">
                    월 고정 급여
                    <span className="mt-2 flex items-center rounded-lg border border-emerald-300 bg-white px-3">
                      <span className="text-zinc-400">₩</span>
                      <input
                        type="number"
                        min={0}
                        step={10000}
                        value={budgetPlan.fixedSalary || ""}
                        placeholder="매월 세후 급여"
                        onChange={(e) => {
                          setBudgetSaved(false);
                          setBudgetPlan((prev) => ({
                            ...prev,
                            fixedSalary: Math.max(0, Number(e.target.value) || 0),
                          }));
                        }}
                        className="w-full bg-transparent px-2 py-2.5 text-right font-semibold tabular-nums outline-none"
                      />
                    </span>
                  </label>
                  <div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-emerald-900">
                        월 예산 배분 {formatWon(salaryAllocation.allocated)}
                      </span>
                      <span
                        className={`font-semibold ${
                          salaryAllocation.rate > 100 ? "text-red-700" : "text-emerald-900"
                        }`}
                      >
                        급여의 {salaryAllocation.rate.toFixed(1)}%
                      </span>
                    </div>
                    <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-emerald-100">
                      <div
                        className={`h-full rounded-full ${
                          salaryAllocation.rate > 100 ? "bg-red-500" : "bg-emerald-600"
                        }`}
                        style={{ width: `${Math.min(salaryAllocation.rate, 100)}%` }}
                      />
                    </div>
                    <p
                      className={`mt-2 text-xs ${
                        salaryAllocation.remaining < 0 ? "text-red-700" : "text-emerald-800"
                      }`}
                    >
                      {salaryAllocation.remaining < 0
                        ? `급여보다 ${formatWon(Math.abs(salaryAllocation.remaining))} 많이 배분됨`
                        : `미배분 급여 ${formatWon(salaryAllocation.remaining)}`}
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-zinc-800">예산 계획</h2>
                  <p className="text-sm text-zinc-500">
                    월 예산과 기간 누적 예산을 정하고, 각 가계부 대분류를 예산 항목에 연결합니다.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={saveBudgetPlan}
                  disabled={budgetBusy || !budgetPlan.startDate || !budgetPlan.endDate}
                  className="shrink-0 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {budgetBusy ? "저장 중…" : budgetSaved ? "저장됨" : "예산 저장"}
                </button>
              </div>

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <label className="text-sm text-zinc-600">
                  시작일
                  <input
                    type="date"
                    value={budgetPlan.startDate}
                    onChange={(e) => {
                      setBudgetSaved(false);
                      setBudgetPlan((prev) => ({ ...prev, startDate: e.target.value }));
                    }}
                    className="mt-1 block w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900"
                  />
                </label>
                <label className="text-sm text-zinc-600">
                  종료일
                  <input
                    type="date"
                    value={budgetPlan.endDate}
                    onChange={(e) => {
                      setBudgetSaved(false);
                      setBudgetPlan((prev) => ({ ...prev, endDate: e.target.value }));
                    }}
                    className="mt-1 block w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900"
                  />
                </label>
              </div>

              <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-800">월 예산 범위</h3>
                  <p className="mt-1 text-xs text-zinc-500">
                    적용 기간 동안 매달 사용할 항목별 예산을 입력합니다.
                  </p>
                </div>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {monthlyBudgetProgress.map(({ key, budget }) => (
                  <div key={key} className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                    <label className="text-sm font-semibold text-zinc-800">
                      {budgetItemLabels[key]}
                      <span className="mt-2 flex items-center rounded-md border border-zinc-300 bg-white px-2">
                        <span className="text-sm text-zinc-400">₩</span>
                        <input
                          type="number"
                          min={0}
                          step={10000}
                          value={budget || ""}
                          placeholder="월 예산 금액"
                          onChange={(e) => {
                            setBudgetSaved(false);
                            setBudgetPlan((prev) => ({
                              ...prev,
                              amounts: {
                                ...prev.amounts,
                                [key]: Math.max(0, Number(e.target.value) || 0),
                              },
                            }));
                          }}
                          className="w-full bg-transparent px-2 py-2 text-right text-sm tabular-nums outline-none"
                        />
                      </span>
                    </label>
                    <p className="mt-2 text-xs text-emerald-700">
                      고정 급여의{" "}
                      {budgetPlan.fixedSalary > 0
                        ? `${((budget / budgetPlan.fixedSalary) * 100).toFixed(1)}%`
                        : "—"}
                    </p>
                  </div>
                ))}
              </div>

              <div className="mt-7">
                <h3 className="text-sm font-semibold text-zinc-800">누적·이월 예산</h3>
                <p className="mt-1 text-xs text-zinc-500">
                  월 예산을 시작월부터 현재월까지 누적합니다. 사용하지 않은 금액은 다음 달로 이월됩니다.
                </p>
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {rolloverBudgetProgress.map(
                  ({
                    key,
                    monthlyBudget,
                    planTotal,
                  }) => (
                    <div key={key} className="rounded-lg border border-violet-200 bg-violet-50/40 p-4">
                      <label className="text-sm font-semibold text-zinc-800">
                        {budgetItemLabels[key]}
                        <span className="ml-2 text-xs font-normal text-zinc-500">월 예산</span>
                        <span className="mt-2 flex items-center rounded-md border border-zinc-300 bg-white px-2">
                          <span className="text-sm text-zinc-400">₩</span>
                          <input
                            type="number"
                            min={0}
                            step={10000}
                            value={monthlyBudget || ""}
                            placeholder="매월 예산"
                            onChange={(e) => {
                              setBudgetSaved(false);
                              setBudgetPlan((prev) => ({
                                ...prev,
                                amounts: {
                                  ...prev.amounts,
                                  [key]: Math.max(0, Number(e.target.value) || 0),
                                },
                              }));
                            }}
                            className="w-full bg-transparent px-2 py-2 text-right text-sm tabular-nums outline-none"
                          />
                        </span>
                      </label>
                      <p className="mt-2 text-xs text-violet-700">
                        고정 급여의{" "}
                        {budgetPlan.fixedSalary > 0
                          ? `${((monthlyBudget / budgetPlan.fixedSalary) * 100).toFixed(1)}%`
                          : "—"}
                        {" · "}전체 기간 계획 {formatWon(planTotal)}
                      </p>
                    </div>
                  )
                )}
              </div>

              <div className="mt-6">
                <h3 className="text-sm font-semibold text-zinc-800">대분류 매핑</h3>
                <p className="mt-1 text-xs text-zinc-500">
                  매핑하지 않은 대분류는 예산 달성률 계산에 포함되지 않습니다.
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {allMainCategories.map((category) => (
                    <label
                      key={category}
                      className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                    >
                      <span className="min-w-0 truncate text-zinc-700" title={category}>
                        {category}
                      </span>
                      <select
                        value={budgetPlan.categoryMappings[category] ?? ""}
                        onChange={(e) => {
                          const value = e.target.value as BudgetItemKey | "";
                          setBudgetSaved(false);
                          setBudgetPlan((prev) => {
                            const categoryMappings = { ...prev.categoryMappings };
                            if (value) categoryMappings[category] = value;
                            else delete categoryMappings[category];
                            return { ...prev, categoryMappings };
                          });
                        }}
                        className="max-w-[130px] rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-800"
                      >
                        <option value="">미지정</option>
                        {BUDGET_ITEM_KEYS.map((key) => (
                          <option key={key} value={key}>
                            {budgetItemLabels[key]}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
              <h2 className="text-lg font-semibold text-zinc-800">저장된 예산</h2>
              <p className="text-sm text-zinc-500">
                기간별 예산을 열어보거나 기존 설정을 새 기간에 복제해 재사용할 수 있습니다.
              </p>
              <div className="mt-4 space-y-3">
                {[...budgetPlans]
                  .sort((a, b) => b.startDate.localeCompare(a.startDate))
                  .map((plan) => {
                    const expanded = expandedBudgetPlanId === plan.id;
                    const reusing = reusePlanId === plan.id;
                    return (
                      <div
                        key={plan.id}
                        className={`rounded-lg border ${
                          activeBudgetPlanId === plan.id
                            ? "border-emerald-400 bg-emerald-50/40"
                            : "border-zinc-200"
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3 p-3">
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedBudgetPlanId((prev) => (prev === plan.id ? null : plan.id))
                            }
                            className="text-left"
                          >
                            <span className="text-sm font-semibold text-zinc-900">
                              {plan.startDate} ~ {plan.endDate}
                            </span>
                            {activeBudgetPlanId === plan.id ? (
                              <span className="ml-2 rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">
                                현재 적용
                              </span>
                            ) : null}
                            <span className="ml-2 text-xs text-zinc-400">
                              {expanded ? "접기" : "상세 보기"}
                            </span>
                          </button>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setBudgetPlan({
                                  startDate: plan.startDate,
                                  endDate: plan.endDate,
                                  fixedSalary: plan.fixedSalary,
                                  amounts: { ...plan.amounts },
                                  categoryMappings: { ...plan.categoryMappings },
                                });
                                setActiveBudgetPlanId(plan.id);
                                setBudgetSaved(false);
                              }}
                              className="rounded border border-zinc-300 px-2.5 py-1.5 text-xs text-zinc-700"
                            >
                              편집
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setReusePlanId(plan.id);
                                setReuseDates(reusedPeriodDates(plan));
                              }}
                              className="rounded border border-blue-300 px-2.5 py-1.5 text-xs font-medium text-blue-700"
                            >
                              예산 재사용
                            </button>
                          </div>
                        </div>
                        {expanded ? (
                          <div className="border-t border-zinc-200 px-3 py-3">
                            <p className="text-xs text-zinc-500">
                              월 고정 급여 {formatWon(plan.fixedSalary)}
                            </p>
                            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                              {BUDGET_ITEM_KEYS.map((key) => (
                                <div key={key} className="rounded bg-zinc-50 px-3 py-2 text-xs">
                                  <span className="text-zinc-500">{budgetItemLabels[key]}</span>
                                  <span className="float-right font-semibold tabular-nums text-zinc-900">
                                    {formatWon(plan.amounts[key])}
                                  </span>
                                </div>
                              ))}
                            </div>
                            <p className="mt-3 text-xs text-zinc-500">
                              대분류 매핑 {Object.keys(plan.categoryMappings).length}개
                            </p>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {Object.entries(plan.categoryMappings).map(([category, key]) => (
                                <span
                                  key={category}
                                  className="rounded-full border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-600"
                                >
                                  {category} → {budgetItemLabels[key]}
                                </span>
                              ))}
                            </div>
                          </div>
                        ) : null}
                        {reusing ? (
                          <div className="border-t border-blue-100 bg-blue-50/50 p-3">
                            <p className="text-xs font-medium text-blue-900">새 적용 기간</p>
                            <div className="mt-2 flex flex-wrap items-end gap-2">
                              <label className="text-xs text-zinc-600">
                                시작일
                                <input
                                  type="date"
                                  value={reuseDates.startDate}
                                  onChange={(event) =>
                                    setReuseDates((prev) => ({
                                      ...prev,
                                      startDate: event.target.value,
                                    }))
                                  }
                                  className="ml-2 rounded border border-zinc-300 bg-white px-2 py-1.5"
                                />
                              </label>
                              <label className="text-xs text-zinc-600">
                                종료일
                                <input
                                  type="date"
                                  value={reuseDates.endDate}
                                  onChange={(event) =>
                                    setReuseDates((prev) => ({
                                      ...prev,
                                      endDate: event.target.value,
                                    }))
                                  }
                                  className="ml-2 rounded border border-zinc-300 bg-white px-2 py-1.5"
                                />
                              </label>
                              <button
                                type="button"
                                disabled={budgetBusy || !reuseDates.startDate || !reuseDates.endDate}
                                onClick={reuseBudgetPlan}
                                className="rounded bg-blue-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                              >
                                새 기간으로 적용
                              </button>
                              <button
                                type="button"
                                onClick={() => setReusePlanId(null)}
                                className="px-2 py-1.5 text-xs text-zinc-500"
                              >
                                취소
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                {budgetPlans.length === 0 ? (
                  <p className="rounded-lg bg-zinc-50 px-4 py-6 text-center text-sm text-zinc-400">
                    저장된 예산이 없습니다.
                  </p>
                ) : null}
              </div>
            </section>

            </div>
            <div className={activeTab === "home" ? "contents" : "hidden"}>
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label="엑셀 기준 순자산"
                value={netWorth ? formatWon(netWorth.netWorth) : "—"}
                hint="재무현황 합산 · 동기화 시 서정+상윤 스냅샷 합침"
              />
              <StatCard
                label="자산 합계"
                value={netWorth ? formatWon(netWorth.totalAssets) : "—"}
                hint="뱅크샐 시트 파싱"
              />
              <StatCard
                label="부채 합계"
                value={netWorth ? formatWon(netWorth.totalDebt) : "—"}
                hint="부채 금액 컬럼"
              />
              <StatCard
                label="거래 건수"
                value={`${visibleEntries.length.toLocaleString("ko-KR")}건`}
                hint={
                  filterActive
                    ? `숨김·제외 대분류 반영 · 저장소 ${ledger.length.toLocaleString("ko-KR")}건`
                    : `숨김 거래 제외 · 저장소 ${ledger.length.toLocaleString("ko-KR")}건`
                }
              />
            </section>

            <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-zinc-800">예산 집행률</h2>
                  <p className="text-sm text-zinc-500">
                    {budgetPlan.startDate && budgetPlan.endDate
                      ? `${budgetPlan.startDate} ~ ${budgetPlan.endDate} 적용 예산`
                      : "설정에서 예산 기간과 금액을 먼저 저장해 주세요."}
                  </p>
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
                  ({ key, available, spent, carryover, rate, elapsedMonths, totalMonths, cutoff }) => (
                    <div key={key} className="rounded-lg border border-violet-200 bg-violet-50/40 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-zinc-800">{budgetItemLabels[key]}</p>
                          <p className="mt-1 text-xs text-zinc-500">
                            {elapsedMonths}/{totalMonths || 0}개월 · {cutoff || "—"} 기준
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
                표시할 거래가 없습니다. 대분류 표시를 확인하거나, 아래에서 숨김을 해제해 보세요.
              </div>
            ) : null}

            <section className="grid gap-8 lg:grid-cols-3">
              <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm lg:col-span-2">
                <h2 className="text-lg font-semibold text-zinc-800">월별 입금 · 지출</h2>
                <p className="text-sm text-zinc-500">
                  입금(+) / 출금(−) · 투자·저축 출금은 자산 형성액으로 보고 입금에 합산
                  {filterActive ? " · 숨긴 대분류 제외" : ""}
                </p>
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
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
                <h2 className="text-lg font-semibold text-zinc-800">지출 대분류 TOP</h2>
                <p className="text-xs text-zinc-400">
                  {filterActive ? "숨긴 대분류 제외" : "표시 중인 거래만"}
                </p>
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
              <h2 className="text-lg font-semibold text-zinc-800">월별 순현금흐름</h2>
              <p className="text-sm text-zinc-500">
                해당 월 입금·투자·저축 합 − 소비 지출 합
                {filterActive ? " · 숨긴 대분류 제외" : ""}
              </p>
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

            {netWorth && netWorth.assets.length > 0 ? (
              <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
                <h2 className="text-lg font-semibold text-zinc-800">재무 스냅샷 — 자산 라인</h2>
                <p className="text-sm text-zinc-500">엑셀보낸 시점 기준(라인 합산)</p>
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
            <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-zinc-800">거래내역</h2>
                  <p className="text-sm text-zinc-500">
                    표시 대분류·숨기지 않은 거래만 집계에 포함 · 기본 월은 현재 달
                  </p>
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
                    이 달에 표시 조건에 맞는 거래가 없습니다. 월을 바꾸거나 대분류 표시를 확인해 보세요.
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
                    숨긴 거래 ({hiddenRowsForMonth.length}건) — 합계·차트 미포함
                  </h3>
                  <p className="mt-1 text-xs text-zinc-500">
                    동일 달·동일 대분류 필터 기준입니다. 복구하면 집계에 다시 포함됩니다.
                  </p>
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
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-2 text-xl font-semibold tabular-nums text-zinc-900">{value}</p>
      <p className="mt-1 text-xs text-zinc-400">{hint}</p>
    </div>
  );
}
