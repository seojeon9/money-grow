"use client";

import { useMemo, useState } from "react";
import type { Trip } from "@/lib/budget";
import { isLedgerEntryCounted, type LedgerEntry } from "@/lib/excel/importBankExport";
import type { SettlementGroup } from "@/lib/store/ledgerStore";

type FlowKind = "internal" | "asset" | "income" | "spend";

/** 친구가 돈을 늦게 보내는 경우가 많아, 받은 돈은 일정 끝난 뒤 며칠까지 후보로 보여줍니다. */
const INCOME_GRACE_DAYS = 7;
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function InfoBadge({ text }: { text: string }) {
  return (
    <span className="group relative ml-1.5 inline-flex align-middle">
      <span
        tabIndex={0}
        aria-label="설명 보기"
        className="flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-zinc-300 text-[10px] font-semibold text-zinc-500 hover:border-emerald-600 hover:text-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-600"
      >
        ?
      </span>
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute left-1/2 top-full z-30 mt-2 w-64 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-lg bg-zinc-900 px-3 py-2 text-left text-xs font-normal leading-relaxed text-white opacity-0 shadow-lg transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}

export default function CalendarTab({
  ledger,
  dayEntries,
  settlementGroups,
  events,
  flowKind,
  busy,
  onAddEvent,
  onDeleteEvent,
  onGroup,
  onUngroup,
}: {
  /** 여행 분류가 적용된 원본 거래(정산 후보용) */
  ledger: LedgerEntry[];
  /** 집계에 쓰는 거래(정산 묶음은 합친 한 줄) — 날짜별 지출 표시용 */
  dayEntries: LedgerEntry[];
  settlementGroups: SettlementGroup[];
  events: Trip[];
  flowKind: (entry: LedgerEntry) => FlowKind;
  busy: boolean;
  onAddEvent: (draft: { name: string; kind: string; startDate: string; endDate: string }) => void;
  onDeleteEvent: (id: string) => void;
  onGroup: (memberIds: string[]) => Promise<boolean>;
  onUngroup: (groupId: string) => void;
}) {
  const [month, setMonth] = useState(() => todayIso().slice(0, 7));
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [draft, setDraft] = useState({ name: "", kind: "약속", startDate: "", endDate: "" });

  const kindOf = (event: Trip) => event.kind ?? "여행";

  const days = useMemo(() => {
    const first = `${month}-01`;
    const start = addDays(first, -new Date(`${first}T00:00:00Z`).getUTCDay());
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [month]);

  const spendByDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of dayEntries) {
      if (flowKind(e) === "spend") m.set(e.date, (m.get(e.date) ?? 0) - e.amount);
    }
    return m;
  }, [dayEntries, flowKind]);

  const selectedEvent = events.find((e) => e.id === selectedEventId) ?? null;

  const panel = useMemo(() => {
    if (!selectedEvent) return null;
    const { startDate, endDate } = selectedEvent;
    const incomeEnd = addDays(endDate, INCOME_GRACE_DAYS);
    const byId = new Map(ledger.filter((e) => e.id).map((e) => [e.id as string, e]));
    const grouped = new Set(settlementGroups.flatMap((g) => g.memberIds));
    const groups = settlementGroups
      .map((g) => ({ id: g.id, members: g.memberIds.map((id) => byId.get(id)).filter((e): e is LedgerEntry => !!e) }))
      .filter((g) => g.members.some((e) => startDate <= e.date && e.date <= incomeEnd));
    const free = ledger.filter((e) => e.id && isLedgerEntryCounted(e) && !grouped.has(e.id));
    const expenses = free.filter(
      (e) => e.amount < 0 && flowKind(e) === "spend" && startDate <= e.date && e.date <= endDate
    );
    const incomes = free.filter(
      (e) =>
        e.amount > 0 &&
        (flowKind(e) === "income" || flowKind(e) === "spend") &&
        startDate <= e.date &&
        e.date <= incomeEnd
    );
    return { groups, expenses, incomes };
  }, [selectedEvent, ledger, settlementGroups, flowKind]);

  const pickedEntries = useMemo(
    () => ledger.filter((e) => e.id && picked.includes(e.id)),
    [ledger, picked]
  );
  const pickedSpend = pickedEntries.filter((e) => e.amount < 0).reduce((s, e) => s - e.amount, 0);
  const pickedIncome = pickedEntries.filter((e) => e.amount > 0).reduce((s, e) => s + e.amount, 0);

  const selectEvent = (id: string | null) => {
    setSelectedEventId(id);
    setPicked([]);
  };

  const shiftMonth = (delta: number) => {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    setMonth(d.toISOString().slice(0, 7));
  };

  const entryRow = (e: LedgerEntry, selectable: boolean) => (
    <label
      key={e.id}
      className={`flex items-center gap-2 rounded px-2 py-1.5 text-sm ${selectable ? "cursor-pointer hover:bg-zinc-50" : ""}`}
    >
      {selectable ? (
        <input
          type="checkbox"
          checked={picked.includes(e.id as string)}
          onChange={(ev) =>
            setPicked((prev) =>
              ev.target.checked ? [...prev, e.id as string] : prev.filter((id) => id !== e.id)
            )
          }
        />
      ) : null}
      <span className="w-12 shrink-0 tabular-nums text-zinc-500">{e.date.slice(5)}</span>
      <span className="w-8 shrink-0 text-zinc-500">{e.sourceLabel}</span>
      <span className="min-w-0 flex-1 truncate text-zinc-800">{e.description}</span>
      <span className={`shrink-0 tabular-nums ${e.amount < 0 ? "text-zinc-900" : "text-emerald-700"}`}>
        {e.amount > 0 ? "+" : ""}
        {won(e.amount)}
      </span>
    </label>
  );

  return (
    <>
      <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-zinc-800">
            캘린더
            <InfoBadge text="여행·약속을 적어두고, 내가 먼저 계산한 돈과 친구들에게 받은 돈을 묶으면 실제로 내가 쓴 돈만 지출로 잡혀요. 여행 기간 지출은 여행/숙박으로 따로 계산돼요." />
          </h2>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => shiftMonth(-1)} className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm">
              ‹
            </button>
            <span className="w-24 text-center text-sm font-semibold tabular-nums text-zinc-800">
              {month.replace("-", "년 ")}월
            </span>
            <button type="button" onClick={() => shiftMonth(1)} className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm">
              ›
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-zinc-200 bg-zinc-200 text-xs">
          {WEEKDAYS.map((w) => (
            <div key={w} className="bg-zinc-50 py-1.5 text-center font-medium text-zinc-500">
              {w}
            </div>
          ))}
          {days.map((date) => {
            const dayEvents = events.filter((e) => e.startDate <= date && date <= e.endDate);
            const spend = spendByDate.get(date) ?? 0;
            const inMonth = date.startsWith(month);
            return (
              <button
                key={date}
                type="button"
                onClick={() => {
                  setDraft((prev) => ({ ...prev, startDate: date, endDate: date }));
                  selectEvent(dayEvents[0]?.id ?? null);
                }}
                className={`flex min-h-[72px] flex-col items-stretch gap-0.5 bg-white p-1 text-left hover:bg-emerald-50 ${
                  inMonth ? "" : "opacity-40"
                } ${date === draft.startDate ? "ring-2 ring-inset ring-emerald-600" : ""}`}
              >
                <span className={`tabular-nums ${date === todayIso() ? "font-bold text-emerald-700" : "text-zinc-600"}`}>
                  {Number(date.slice(8))}
                </span>
                {dayEvents.map((e) => (
                  <span
                    key={e.id}
                    className={`truncate rounded px-1 text-[11px] ${
                      kindOf(e) === "여행" ? "bg-sky-100 text-sky-800" : "bg-amber-100 text-amber-800"
                    } ${e.id === selectedEventId ? "font-semibold" : ""}`}
                  >
                    {e.name}
                  </span>
                ))}
                {spend > 0 ? (
                  <span className="mt-auto text-right tabular-nums text-[11px] text-zinc-500">
                    −{spend >= 10000 ? `${(spend / 10000).toFixed(1)}만` : spend.toLocaleString("ko-KR")}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <select
            value={draft.kind}
            onChange={(e) => setDraft((prev) => ({ ...prev, kind: e.target.value }))}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
          >
            <option value="약속">약속</option>
            <option value="여행">여행</option>
          </select>
          <input
            type="text"
            value={draft.name}
            onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
            placeholder="일정 이름 (예: 대학 동기 모임)"
            className="min-w-0 flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm"
          />
          <input
            type="date"
            value={draft.startDate}
            onChange={(e) => setDraft((prev) => ({ ...prev, startDate: e.target.value }))}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
          />
          <input
            type="date"
            value={draft.endDate}
            min={draft.startDate || undefined}
            onChange={(e) => setDraft((prev) => ({ ...prev, endDate: e.target.value }))}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={busy || !draft.name.trim() || !draft.startDate || !draft.endDate || draft.startDate > draft.endDate}
            onClick={() => {
              onAddEvent(draft);
              setDraft((prev) => ({ ...prev, name: "" }));
            }}
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            일정 추가
          </button>
        </div>
      </section>

      {selectedEvent && panel ? (
        <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-zinc-800">
              {selectedEvent.name}
              <span className="ml-2 text-sm font-normal text-zinc-500">
                {kindOf(selectedEvent)} · {selectedEvent.startDate}
                {selectedEvent.endDate !== selectedEvent.startDate ? ` ~ ${selectedEvent.endDate}` : ""}
              </span>
            </h2>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`'${selectedEvent.name}' 일정을 삭제할까요? 묶어둔 정산은 그대로 남아요.`)) {
                  onDeleteEvent(selectedEvent.id);
                  selectEvent(null);
                }
              }}
              className="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-red-50 hover:text-red-700"
            >
              일정 삭제
            </button>
          </div>

          {panel.groups.length > 0 ? (
            <div className="mt-4 space-y-2">
              <h3 className="text-sm font-semibold text-zinc-800">묶어둔 정산</h3>
              {panel.groups.map((g) => {
                const net = g.members.reduce((s, e) => s + e.amount, 0);
                return (
                  <details key={g.id} className="rounded-lg border border-blue-200 bg-blue-50/40">
                    <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm">
                      <span className="flex-1 text-zinc-700">{g.members.length}건 묶음</span>
                      <span className="font-semibold tabular-nums text-zinc-900">실제 지출 {won(-net)}</span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={(ev) => {
                          ev.preventDefault();
                          if (window.confirm("이 정산 묶음을 풀까요? 원래 거래로 돌아가요.")) onUngroup(g.id);
                        }}
                        className="rounded px-2 py-0.5 text-xs text-zinc-400 hover:bg-red-50 hover:text-red-700"
                      >
                        풀기
                      </button>
                    </summary>
                    <div className="border-t border-blue-100 px-1 py-1">{g.members.map((e) => entryRow(e, false))}</div>
                  </details>
                );
              })}
            </div>
          ) : null}

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold text-zinc-800">
                내가 계산한 돈 ({panel.expenses.length})
                <InfoBadge text="일정 기간에 결제한 지출이에요. 친구들과 나눈 것만 골라 주세요." />
              </h3>
              <div className="mt-2 max-h-80 overflow-y-auto rounded-lg border border-zinc-200 p-1">
                {panel.expenses.length === 0 ? (
                  <p className="py-6 text-center text-sm text-zinc-400">이 기간에 묶지 않은 지출이 없어요.</p>
                ) : (
                  panel.expenses.map((e) => entryRow(e, true))
                )}
              </div>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-zinc-800">
                받은 돈 ({panel.incomes.length})
                <InfoBadge text={`일정 기간부터 끝난 뒤 ${INCOME_GRACE_DAYS}일까지 들어온 돈이에요. 친구들이 보내준 것만 골라 주세요.`} />
              </h3>
              <div className="mt-2 max-h-80 overflow-y-auto rounded-lg border border-zinc-200 p-1">
                {panel.incomes.length === 0 ? (
                  <p className="py-6 text-center text-sm text-zinc-400">이 기간에 들어온 돈이 없어요.</p>
                ) : (
                  panel.incomes.map((e) => entryRow(e, true))
                )}
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-end gap-3 text-sm">
            <span className="text-zinc-600">
              계산 {won(pickedSpend)} − 받음 {won(pickedIncome)} ={" "}
              <span className="font-semibold text-zinc-900">실제 지출 {won(pickedSpend - pickedIncome)}</span>
            </span>
            <button
              type="button"
              disabled={busy || picked.length < 2 || pickedSpend === 0}
              onClick={() => {
                void onGroup(picked).then((ok) => ok && setPicked([]));
              }}
              className="rounded-lg bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800 disabled:opacity-50"
            >
              정산 묶기 ({picked.length})
            </button>
          </div>
        </section>
      ) : null}
    </>
  );
}
