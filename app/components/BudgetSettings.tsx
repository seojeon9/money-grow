"use client";

import { useState } from "react";
import {
  BUDGET_ITEM_KEYS,
  budgetPlanEndDate,
  budgetPlanForMonth,
  emptyBudgetPlan,
  type BudgetItemKey,
  type BudgetPlan,
  type SavedBudgetPlan,
} from "@/lib/budget";
import InfoBadge from "./InfoBadge";

/** 남은 돈이 다음 달로 넘어가는 항목 */
const ROLLOVER_KEYS = new Set<BudgetItemKey>(["personal", "emergency"]);

const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toDraft(plan: BudgetPlan): BudgetPlan {
  return {
    ...plan,
    endDate: "",
    amounts: { ...plan.amounts },
    categoryMappings: { ...plan.categoryMappings },
  };
}

export default function BudgetSettings({
  plans,
  labels,
  categories,
  busy,
  onSave,
  onDelete,
}: {
  plans: SavedBudgetPlan[];
  labels: Record<BudgetItemKey, string>;
  categories: string[];
  busy: boolean;
  onSave: (plan: BudgetPlan, id: string | null) => Promise<boolean>;
  onDelete: (id: string) => void;
}) {
  const sorted = [...plans].sort((a, b) => b.startDate.localeCompare(a.startDate));
  const current = budgetPlanForMonth(plans, todayIso().slice(0, 7));
  // undefined: 편집 안 함 · null: 새 예산 · string: 그 예산 편집
  const [editingId, setEditingId] = useState<string | null | undefined>(undefined);
  const [draft, setDraft] = useState<BudgetPlan>(emptyBudgetPlan);

  const startEdit = (plan: SavedBudgetPlan) => {
    setEditingId(plan.id);
    setDraft(toDraft(plan));
  };
  const startNew = () => {
    setEditingId(null);
    setDraft({ ...toDraft(sorted[0] ?? emptyBudgetPlan()), startDate: todayIso() });
  };

  const allocated = BUDGET_ITEM_KEYS.reduce((sum, key) => sum + (draft.amounts[key] || 0), 0);
  const pct = (n: number) => (draft.fixedSalary > 0 ? `${((n / draft.fixedSalary) * 100).toFixed(1)}%` : "—");
  const setAmount = (key: BudgetItemKey, value: string) =>
    setDraft((prev) => ({ ...prev, amounts: { ...prev.amounts, [key]: Math.max(0, Number(value) || 0) } }));

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-zinc-800">
          예산
          <InfoBadge text="예산은 시작일부터 다음 예산이 시작되기 전날까지 계속 적용돼요. 수입이 바뀌면 '새 예산 시작'으로 새로 만들어 주세요." />
        </h2>
        <button
          type="button"
          disabled={busy}
          onClick={startNew}
          className="rounded-lg border border-emerald-600 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
        >
          새 예산 시작
        </button>
      </div>

      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {sorted.map((plan) => {
          const end = budgetPlanEndDate(plans, plan);
          const isCurrent = current?.id === plan.id;
          return (
            <li
              key={plan.id}
              className={`flex items-center gap-2 rounded-lg border p-2 text-sm ${
                editingId === plan.id ? "border-emerald-500 bg-emerald-50/50" : "border-zinc-200"
              }`}
            >
              <span className="min-w-0 flex-1 truncate text-zinc-800">
                {plan.startDate} ~ {end || "진행 중"}
                {isCurrent ? (
                  <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800">지금</span>
                ) : null}
                <span className="ml-2 text-xs text-zinc-500">급여 {won(plan.fixedSalary)}</span>
              </span>
              <button
                type="button"
                onClick={() => startEdit(plan)}
                className="rounded px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100"
              >
                편집
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`${plan.startDate}부터 시작한 예산을 삭제할까요?`)) {
                    onDelete(plan.id);
                    if (editingId === plan.id) setEditingId(undefined);
                  }
                }}
                className="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-red-50 hover:text-red-700"
              >
                삭제
              </button>
            </li>
          );
        })}
      </ul>
      {sorted.length === 0 ? (
        <p className="mt-3 rounded-lg bg-zinc-50 px-4 py-4 text-center text-sm text-zinc-500">
          등록된 예산이 없어요. &lsquo;새 예산 시작&rsquo;으로 만들어 주세요.
        </p>
      ) : null}

      {editingId !== undefined ? (
        <div className="mt-4 rounded-lg border border-zinc-200 p-3">
          <div className="flex flex-wrap items-end gap-3 text-sm">
            <label className="text-xs text-zinc-500">
              시작일
              <input
                type="date"
                value={draft.startDate}
                onChange={(e) => setDraft((prev) => ({ ...prev, startDate: e.target.value }))}
                className="mt-1 block rounded border border-zinc-300 px-2 py-1 text-sm text-zinc-900"
              />
            </label>
            <label className="text-xs text-zinc-500">
              월 급여(세후)
              <input
                type="number"
                min={0}
                step={10000}
                value={draft.fixedSalary || ""}
                onChange={(e) => setDraft((prev) => ({ ...prev, fixedSalary: Math.max(0, Number(e.target.value) || 0) }))}
                className="mt-1 block w-36 rounded border border-zinc-300 px-2 py-1 text-right text-sm tabular-nums text-zinc-900"
              />
            </label>
            <span className={`pb-1 text-xs ${allocated > draft.fixedSalary ? "text-red-700" : "text-zinc-500"}`}>
              배분 {won(allocated)} · 급여의 {pct(allocated)}
            </span>
          </div>

          <h3 className="mt-4 text-sm font-semibold text-zinc-800">
            항목별 월 예산
            <InfoBadge text="'누적' 항목은 덜 쓴 돈이 다음 달로 넘어가요. 나머지는 매달 새로 시작해요." />
          </h3>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {BUDGET_ITEM_KEYS.map((key) => (
              <label key={key} className="flex items-center gap-2 rounded-lg border border-zinc-200 p-2 text-sm">
                <span className="min-w-0 flex-1 truncate text-zinc-800">
                  {labels[key]}
                  {ROLLOVER_KEYS.has(key) ? (
                    <span className="ml-1 rounded bg-violet-100 px-1 text-[11px] text-violet-800">누적</span>
                  ) : null}
                </span>
                <input
                  type="number"
                  min={0}
                  step={10000}
                  value={draft.amounts[key] || ""}
                  onChange={(e) => setAmount(key, e.target.value)}
                  className="w-28 rounded border border-zinc-300 px-2 py-1 text-right text-sm tabular-nums"
                />
                <span className="w-12 text-right text-xs text-zinc-400">{pct(draft.amounts[key] || 0)}</span>
              </label>
            ))}
          </div>

          <h3 className="mt-4 text-sm font-semibold text-zinc-800">
            예산에 넣을 대분류
            <InfoBadge text="고르지 않은 대분류(여행/숙박·목적자금·가구/가전·주택자금 등)는 예산 집행률에서 빠져요." />
          </h3>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {categories.map((category) => (
              <label key={category} className="flex items-center gap-2 rounded-lg border border-zinc-200 p-2 text-sm">
                <span className="min-w-0 flex-1 truncate text-zinc-700" title={category}>
                  {category}
                </span>
                <select
                  value={draft.categoryMappings[category] ?? ""}
                  onChange={(e) => {
                    const value = e.target.value as BudgetItemKey | "";
                    setDraft((prev) => {
                      const categoryMappings = { ...prev.categoryMappings };
                      if (value) categoryMappings[category] = value;
                      else delete categoryMappings[category];
                      return { ...prev, categoryMappings };
                    });
                  }}
                  className={`max-w-[110px] rounded border border-zinc-300 px-1 py-0.5 text-xs ${
                    draft.categoryMappings[category] ? "text-zinc-900" : "text-zinc-400"
                  }`}
                >
                  <option value="">빼기</option>
                  {BUDGET_ITEM_KEYS.map((key) => (
                    <option key={key} value={key}>
                      {labels[key]}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditingId(undefined)}
              className="rounded-lg px-3 py-1.5 text-sm text-zinc-500 hover:bg-zinc-100"
            >
              취소
            </button>
            <button
              type="button"
              disabled={busy || !draft.startDate}
              onClick={() => {
                void onSave(draft, editingId).then((ok) => ok && setEditingId(undefined));
              }}
              className="rounded-lg bg-emerald-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              {editingId ? "저장" : "이 날부터 새 예산 시작"}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
