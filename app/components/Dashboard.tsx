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

type LedgerApiPayload = {
  ledger?: LedgerEntry[];
  netWorth?: NetWorthSnapshot | null;
  summaryLabel?: string;
  updatedAt?: string;
  persistPath?: string;
  error?: string;
};

type MergeTarget = {
  entry: LedgerEntry;
  rowKey: string;
};

const DEFAULT_HIDDEN_MAIN_CATEGORIES = ["카드대금", "내계좌이체"] as const;

const won = new Intl.NumberFormat("ko-KR", {
  style: "currency",
  currency: "KRW",
  maximumFractionDigits: 0,
});

function formatWon(n: number) {
  return won.format(n);
}

function mainCategoryOf(e: LedgerEntry): string {
  const c = e.categoryMain?.trim();
  return c || "기타";
}

function currentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

type Props = {
  householdLabel?: string;
};

export default function Dashboard({ householdLabel = "우리 가구" }: Props) {
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
  const [mergePickerRow, setMergePickerRow] = useState<string | null>(null);
  const [mergeBusyRow, setMergeBusyRow] = useState<string | null>(null);

  /** 서버 디스크 누적본 — 새로고침 후에도 유지 */
  useEffect(() => {
    fetch("/api/ledger/state")
      .then((r) => r.json() as Promise<LedgerApiPayload>)
      .then((j) => {
        if (j.ledger && j.ledger.length > 0) {
          setLedger(j.ledger);
          setNetWorth(j.netWorth ?? null);
          setPersistInfo({ updatedAt: j.updatedAt ?? null, path: j.persistPath ?? null });
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

  /** 숨김(status) + 대분류 필터 통과분만 집계·차트·일반 목록에 사용 */
  const visibleEntries = useMemo(() => {
    return ledger
      .filter(isLedgerEntryCounted)
      .filter((e) => !hiddenSet.has(mainCategoryOf(e)));
  }, [ledger, hiddenSet]);

  const monthly = useMemo(() => monthlyFlowsFromLedger(visibleEntries), [visibleEntries]);

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

  const mergeTargetsByRow = useMemo<MergeTarget[][]>(() => {
    return ledgerRowsForMonth.map((_, idx) =>
      ledgerRowsForMonth
        .slice(idx + 1)
        .filter((candidate) => candidate.amount < 0)
        .slice(0, 10)
        .map((candidate) => ({
          entry: candidate,
          rowKey: ledgerEntryStableKey(candidate),
        }))
    );
  }, [ledgerRowsForMonth]);

  const mergeEntryIntoExpense = useCallback(
    (args: {
      from: { key: string; id?: string; busyId: string };
      to: { key: string; id?: string };
    }) => {
      setMergeBusyRow(args.from.busyId);
      setError(null);
      fetch("/api/ledger/merge-entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromKey: args.from.key,
          fromId: args.from.id,
          toKey: args.to.key,
          toId: args.to.id,
        }),
      })
        .then(async (res) => {
          const j = (await res.json()) as LedgerApiPayload & { error?: string };
          if (!res.ok) throw new Error(j.error ?? res.statusText);
          setLedger(j.ledger ?? []);
          setPersistInfo({ updatedAt: j.updatedAt ?? null, path: j.persistPath ?? null });
          setMergePickerRow(null);
        })
        .catch((err: Error) => setError(err.message))
        .finally(() => setMergeBusyRow(null));
    },
    []
  );

  /** 해당 월·대분류 필터에 맞는 숨김 거래(합계 제외, 목록에서만 토글) */
  const hiddenRowsForMonth = useMemo(() => {
    return ledger
      .filter((e) => e.status === "hidden")
      .filter((e) => !hiddenSet.has(mainCategoryOf(e)))
      .filter((e) => e.date.startsWith(txMonth))
      .sort((a, b) => {
        if (a.date !== b.date) return a.date < b.date ? 1 : -1;
        return (b.time || "").localeCompare(a.time || "");
      });
  }, [ledger, hiddenSet, txMonth]);

  const allMainCategories = useMemo(() => {
    const s = new Set<string>();
    for (const e of ledger) s.add(mainCategoryOf(e));
    return Array.from(s).sort((a, b) => a.localeCompare(b, "ko"));
  }, [ledger]);

  const topCategories = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of visibleEntries) {
      if (e.amount >= 0) continue;
      const key = mainCategoryOf(e);
      m.set(key, (m.get(key) ?? 0) + Math.abs(e.amount));
    }
    return Array.from(m.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
  }, [visibleEntries]);

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
      </header>

      <main className="mx-auto max-w-6xl space-y-8 px-4 py-8">
        {error ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {error}
          </div>
        ) : null}

        {ledger.length > 0 ? (
          <>
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

            {visibleEntries.length === 0 && ledger.filter(isLedgerEntryCounted).length > 0 ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                표시할 거래가 없습니다. 대분류 표시를 확인하거나, 아래에서 숨김을 해제해 보세요.
              </div>
            ) : null}

            <section className="grid gap-8 lg:grid-cols-3">
              <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm lg:col-span-2">
                <h2 className="text-lg font-semibold text-zinc-800">월별 입금 · 지출</h2>
                <p className="text-sm text-zinc-500">
                  가계부 금액 부호 기준: 입금(+) / 출금(−)
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
                해당 월 입금 합 − 지출 합 (계좌 간 이체는 부호에 따라 반영됩니다)
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

            <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-zinc-800">거래내역</h2>
                  <p className="text-sm text-zinc-500">
                    표시 대분류·숨기지 않은 거래만 집계에 포함 · 기본 월은 현재 달
                  </p>
                </div>
                <div className="flex items-center gap-2">
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
                  <table className="w-full min-w-[1020px] text-left text-sm">
                    <thead className="text-xs text-zinc-500">
                      <tr>
                        <th className="pb-2 font-medium">라벨</th>
                        <th className="pb-2 font-medium">날짜</th>
                        <th className="pb-2 font-medium">시간</th>
                        <th className="pb-2 font-medium">타입</th>
                        <th className="pb-2 font-medium">대분류</th>
                        <th className="pb-2 font-medium">내용</th>
                        <th className="pb-2 text-right font-medium">금액</th>
                        <th className="pb-2 pl-2 text-right font-medium whitespace-nowrap border-l border-zinc-200">
                          합치기(정산)
                        </th>
                        <th className="pb-2 pl-2 text-right font-medium whitespace-nowrap border-l border-zinc-200">
                          숨기기
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledgerRowsForMonth.map((e, rowIdx) => {
                        const rowKey = ledgerEntryStableKey(e);
                        const rowId = `${rowKey}::${rowIdx}`;
                        const statusBusy = statusBusyKey === rowId;
                        const mergeBusy = mergeBusyRow === rowId;
                        const mergeTargets = mergeTargetsByRow[rowIdx] ?? [];
                        const mergeOpen = mergePickerRow === rowId;
                        const canMerge = e.amount > 0 && mergeTargets.length > 0;
                        return (
                          <Fragment key={rowId}>
                            <tr className="border-t border-zinc-100">
                              <td className="py-2 text-zinc-500">{e.sourceLabel || "—"}</td>
                              <td className="py-2 tabular-nums text-zinc-600">{e.date}</td>
                              <td className="py-2 tabular-nums text-zinc-500">{e.time || "—"}</td>
                              <td className="py-2 text-zinc-700">{e.txType}</td>
                              <td className="py-2 text-zinc-700">{mainCategoryOf(e)}</td>
                              <td className="py-2 truncate max-w-[200px] text-zinc-900" title={e.description}>
                                {e.description}
                              </td>
                              <td
                                className={`py-2 text-right tabular-nums font-medium ${
                                  e.amount >= 0 ? "text-emerald-700" : "text-red-700"
                                }`}
                              >
                                {formatWon(e.amount)}
                              </td>
                              <td className="py-2 pl-2 text-right border-l border-zinc-100">
                                <button
                                  type="button"
                                  disabled={!canMerge || mergeBusy}
                                  onClick={() =>
                                    setMergePickerRow((prev) => (prev === rowId ? null : rowId))
                                  }
                                  className="rounded border border-blue-300 bg-white px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                                  title={
                                    canMerge
                                      ? "이전 10개 지출 중 합칠 대상을 고릅니다"
                                      : "입금(+) 거래에서만, 이전 지출이 있을 때 사용 가능"
                                  }
                                >
                                  {mergeBusy ? "처리중…" : mergeOpen ? "닫기" : "합치기"}
                                </button>
                              </td>
                              <td className="py-2 pl-2 text-right border-l border-zinc-100">
                                <button
                                  type="button"
                                  disabled={statusBusy || mergeBusy}
                                  onClick={() =>
                                    patchEntryStatus(rowKey, "hidden", {
                                      id: e.id,
                                      busyId: rowId,
                                    })
                                  }
                                  className="rounded border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                                  title="목록·합계·차트에서 제외"
                                >
                                  {statusBusy ? "…" : "숨기기"}
                                </button>
                              </td>
                            </tr>
                            {mergeOpen ? (
                              <tr className="border-t border-zinc-100 bg-blue-50/40">
                                <td className="py-2 pl-3 pr-2 text-xs text-zinc-600" colSpan={9}>
                                  <p className="mb-2 font-medium text-blue-900">
                                    합칠 지출 선택 (이전 10개 지출 중)
                                  </p>
                                  <div className="flex flex-wrap gap-2">
                                    {mergeTargets.map((target, targetIdx) => (
                                      <button
                                        key={`${target.rowKey}::${targetIdx}`}
                                        type="button"
                                        disabled={mergeBusy}
                                        onClick={() =>
                                          mergeEntryIntoExpense({
                                            from: { key: rowKey, id: e.id, busyId: rowId },
                                            to: { key: target.rowKey, id: target.entry.id },
                                          })
                                        }
                                        className="rounded-md border border-blue-200 bg-white px-2.5 py-1.5 text-left text-xs text-zinc-700 hover:bg-blue-50 disabled:opacity-50"
                                        title={`${target.entry.date} ${target.entry.description}`}
                                      >
                                        {target.entry.date} · {target.entry.description || "내용 없음"} ·{" "}
                                        <span className="font-semibold text-red-700">
                                          {formatWon(target.entry.amount)}
                                        </span>
                                      </button>
                                    ))}
                                  </div>
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
