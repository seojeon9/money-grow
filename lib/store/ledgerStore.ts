import type { LedgerEntry, LedgerEntryStatus, NetWorthSnapshot } from "@/lib/excel/importBankExport";
import { ledgerEntryStableKey } from "@/lib/excel/importBankExport";
import {
  DEFAULT_BUDGET_ITEM_LABELS,
  type BudgetItemKey,
  type BudgetPlan,
  type SavedBudgetPlan,
  type Trip,
  type CategoryRule,
  applyCategoryRules,
  emptyBudgetPlan,
} from "@/lib/budget";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { DatabaseSync } from "node:sqlite";
import path from "path";
import { readMembers } from "@/lib/members";

export type ImportRecord = {
  at: string;
  kind: "sync" | "upload";
  sourceLabel: string;
  file?: string;
  dateRange: { min: string; max: string } | null;
  /** 이번 파일에서 읽은 행 수 */
  rowCount: number;
  /** 저장소에 실제로 새로 붙은 행 수(이미 있던 키는 제외) */
  addedCount?: number;
};

export type SettlementGroup = {
  id: string;
  createdAt: string;
  memberIds: string[];
  /** 연결된 달력 일정(약속·여행) id. 없으면 날짜가 겹치는 일정에 보여줍니다. */
  eventId?: string;
};

export type CategorySettings = {
  categories: string[];
  budgetItemLabels: Record<BudgetItemKey, string>;
  /** 여행 기간. 기간 안의 지출은 화면에서 여행/숙박으로 집계합니다(원본 대분류는 그대로). */
  trips?: Trip[];
  /** 자동 분류 규칙. 동기화·업로드로 새로 들어오는 거래에 적용합니다. */
  rules?: CategoryRule[];
  /** 달력 보기 필터에서 끈 대분류. 없으면 화면 기본값을 씁니다. */
  calendarHidden?: string[];
};

export type LedgerStoreV1 = {
  version: 1;
  updatedAt: string;
  entries: LedgerEntry[];
  netWorth: NetWorthSnapshot | null;
  importLog: ImportRecord[];
  budgetPlans: SavedBudgetPlan[];
  activeBudgetPlanId: string | null;
  categorySettings: CategorySettings;
  settlementGroups: SettlementGroup[];
};

const DATA_DIR = path.join(process.cwd(), "..", "data", ".moneygrow");
const DB_PATH = path.join(DATA_DIR, "moneygrow.db");
/** SQLite 도입 전 저장 파일. DB가 비어 있을 때 한 번만 가져옵니다. */
const LEGACY_JSON_PATH = path.join(DATA_DIR, "ledger-state.json");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS entries (
  seq INTEGER PRIMARY KEY,
  id TEXT UNIQUE,
  stable_key TEXT NOT NULL,
  source_label TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  tx_type TEXT NOT NULL,
  category_main TEXT NOT NULL,
  category_sub TEXT NOT NULL,
  description TEXT NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL,
  payment_method TEXT NOT NULL,
  note TEXT NOT NULL,
  category_main_override TEXT,
  note_override TEXT,
  status TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'hidden')),
  labels TEXT
);
CREATE INDEX IF NOT EXISTS entries_stable_key ON entries(stable_key);
CREATE INDEX IF NOT EXISTS entries_date ON entries(date);
CREATE TABLE IF NOT EXISTS settlement_groups (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settlement_members (
  group_id TEXT NOT NULL REFERENCES settlement_groups(id) ON DELETE CASCADE,
  entry_id TEXT NOT NULL UNIQUE,
  ord INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS budget_plans (
  id TEXT PRIMARY KEY,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  fixed_salary REAL NOT NULL,
  amounts TEXT NOT NULL,
  category_mappings TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS import_log (
  seq INTEGER PRIMARY KEY,
  record TEXT NOT NULL
);
-- 순자산 기록: 사람별·내려받은 시각별 재무현황. 전체 저장(saveStore)이 지우지 않는 테이블입니다.
CREATE TABLE IF NOT EXISTS net_worth_snapshots (
  exported_at TEXT NOT NULL,
  source_label TEXT NOT NULL,
  file TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  PRIMARY KEY (exported_at, source_label)
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

let db: DatabaseSync | null = null;

function getDb(): DatabaseSync {
  if (db) return db;
  mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  // 라벨(외식·배달 등) 칸은 나중에 추가됐습니다. 예전 DB에는 칸을 붙입니다.
  const cols = db.prepare("PRAGMA table_info(entries)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "labels")) db.exec("ALTER TABLE entries ADD COLUMN labels TEXT");
  const groupCols = db.prepare("PRAGMA table_info(settlement_groups)").all() as { name: string }[];
  if (!groupCols.some((c) => c.name === "event_id")) db.exec("ALTER TABLE settlement_groups ADD COLUMN event_id TEXT");
  // 예전 버전에서 들어온 거래는 id가 없어 화면에서 분류·메모·정산을 할 수 없었습니다.
  db.exec("UPDATE entries SET id = lower(hex(randomblob(16))) WHERE id IS NULL");
  const initialized = db.prepare("SELECT 1 FROM meta WHERE key = 'updatedAt'").get();
  if (!initialized) {
    const legacy = existsSync(LEGACY_JSON_PATH)
      ? normalizeLegacyStore(JSON.parse(readFileSync(LEGACY_JSON_PATH, "utf8")))
      : emptyStore();
    saveStore(db, legacy);
  }
  return db;
}

function inTransaction(d: DatabaseSync, fn: () => void) {
  d.exec("BEGIN IMMEDIATE");
  try {
    fn();
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}

// ponytail: 변경마다 전체 테이블을 다시 씀(수천 건 기준 수 ms). 거래가 10만 건 단위로 늘면 행 단위 UPDATE로 전환.
function saveStore(d: DatabaseSync, store: LedgerStoreV1) {
  inTransaction(d, () => {
    d.exec(
      "DELETE FROM settlement_members; DELETE FROM settlement_groups; DELETE FROM entries; DELETE FROM budget_plans; DELETE FROM import_log; DELETE FROM meta;"
    );
    const insEntry = d.prepare(
      `INSERT INTO entries (id, stable_key, source_label, date, time, tx_type, category_main, category_sub,
        description, amount, currency, payment_method, note, category_main_override, note_override, status, labels)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const e of store.entries) {
      insEntry.run(
        e.id ?? null,
        ledgerEntryStableKey(e),
        e.sourceLabel,
        e.date,
        e.time,
        e.txType,
        e.categoryMain,
        e.categorySub,
        e.description,
        e.amount,
        e.currency,
        e.paymentMethod,
        e.note,
        e.categoryMainOverride ?? null,
        e.noteOverride ?? null,
        e.status === "hidden" ? "hidden" : "visible",
        e.labels ? JSON.stringify(e.labels) : null
      );
    }
    const insGroup = d.prepare("INSERT INTO settlement_groups (id, created_at, event_id) VALUES (?, ?, ?)");
    const insMember = d.prepare(
      "INSERT INTO settlement_members (group_id, entry_id, ord) VALUES (?, ?, ?)"
    );
    for (const g of store.settlementGroups) {
      insGroup.run(g.id, g.createdAt, g.eventId ?? null);
      g.memberIds.forEach((entryId, i) => insMember.run(g.id, entryId, i));
    }
    const insPlan = d.prepare(
      `INSERT INTO budget_plans (id, start_date, end_date, fixed_salary, amounts, category_mappings, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const p of store.budgetPlans) {
      insPlan.run(
        p.id,
        p.startDate,
        p.endDate,
        p.fixedSalary,
        JSON.stringify(p.amounts),
        JSON.stringify(p.categoryMappings),
        p.createdAt,
        p.updatedAt
      );
    }
    const insLog = d.prepare("INSERT INTO import_log (record) VALUES (?)");
    for (const r of store.importLog) insLog.run(JSON.stringify(r));
    const insMeta = d.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
    insMeta.run("updatedAt", JSON.stringify(store.updatedAt));
    insMeta.run("netWorth", JSON.stringify(store.netWorth));
    insMeta.run("activeBudgetPlanId", JSON.stringify(store.activeBudgetPlanId));
    insMeta.run("categorySettings", JSON.stringify(store.categorySettings));
  });
}

type Row = Record<string, string | number | null>;

function loadStore(d: DatabaseSync): LedgerStoreV1 {
  const meta = Object.fromEntries(
    (d.prepare("SELECT key, value FROM meta").all() as Row[]).map((r) => [
      r.key as string,
      JSON.parse(r.value as string),
    ])
  );
  const entries = (d.prepare("SELECT * FROM entries ORDER BY seq").all() as Row[]).map((r) => {
    const e: LedgerEntry = {
      date: r.date as string,
      time: r.time as string,
      txType: r.tx_type as string,
      categoryMain: r.category_main as string,
      categorySub: r.category_sub as string,
      description: r.description as string,
      amount: Number(r.amount),
      currency: r.currency as string,
      paymentMethod: r.payment_method as string,
      note: r.note as string,
      sourceLabel: r.source_label as string,
      status: r.status as LedgerEntryStatus,
    };
    if (r.category_main_override !== null) e.categoryMainOverride = r.category_main_override as string;
    if (r.id !== null) e.id = r.id as string;
    if (r.note_override !== null) e.noteOverride = r.note_override as string;
    if (r.labels) e.labels = JSON.parse(r.labels as string);
    return e;
  });
  const members = d
    .prepare("SELECT group_id, entry_id FROM settlement_members ORDER BY group_id, ord")
    .all() as Row[];
  const settlementGroups = (
    d.prepare("SELECT id, created_at, event_id FROM settlement_groups ORDER BY rowid").all() as Row[]
  ).map((g) => ({
    id: g.id as string,
    createdAt: g.created_at as string,
    memberIds: members.filter((m) => m.group_id === g.id).map((m) => m.entry_id as string),
    ...(g.event_id ? { eventId: g.event_id as string } : {}),
  }));
  const budgetPlans = (
    d.prepare("SELECT * FROM budget_plans ORDER BY rowid").all() as Row[]
  ).map((p) => ({
    id: p.id as string,
    startDate: p.start_date as string,
    endDate: p.end_date as string,
    fixedSalary: Number(p.fixed_salary),
    amounts: JSON.parse(p.amounts as string),
    categoryMappings: JSON.parse(p.category_mappings as string),
    createdAt: p.created_at as string,
    updatedAt: p.updated_at as string,
  }));
  const importLog = (d.prepare("SELECT record FROM import_log ORDER BY seq").all() as Row[]).map(
    (r) => JSON.parse(r.record as string) as ImportRecord
  );
  return {
    version: 1,
    updatedAt: meta.updatedAt,
    entries,
    netWorth: meta.netWorth ?? null,
    importLog,
    budgetPlans,
    activeBudgetPlanId: meta.activeBudgetPlanId ?? null,
    categorySettings: meta.categorySettings,
    settlementGroups,
  };
}

function normalizeEntryStatus(e: LedgerEntry): LedgerEntry {
  const status: LedgerEntryStatus = e.status === "hidden" ? "hidden" : "visible";
  return { ...e, status };
}

function emptyStore(): LedgerStoreV1 {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    entries: [],
    netWorth: null,
    importLog: [],
    budgetPlans: [],
    activeBudgetPlanId: null,
    categorySettings: {
      categories: ["목적자금", "세금", "가구/가전"],
      budgetItemLabels: { ...DEFAULT_BUDGET_ITEM_LABELS },
    },
    settlementGroups: [],
  };
}

/** 예전 JSON 저장 형식(구버전 예산 키·대분류 이름 포함)을 현재 형식으로 정리합니다. */
function normalizeLegacyStore(j: LedgerStoreV1): LedgerStoreV1 {
  {
    if (j.version !== 1 || !Array.isArray(j.entries)) return emptyStore();
    const rawBudget = (j as unknown as { budgetPlan?: unknown }).budgetPlan as
      | {
          startDate?: string;
          endDate?: string;
          fixedSalary?: number;
          amounts?: Record<string, number>;
          categoryMappings?: Record<string, string>;
        }
      | undefined;
    const rawAmounts = rawBudget?.amounts ?? {};
    const categoryMappings = Object.fromEntries(
      Object.entries(rawBudget?.categoryMappings ?? {}).map(([category, item]) => [
        category,
        item === "investment" || item === "installmentSavings" || item === "savings"
          ? "investmentSavings"
          : item,
      ])
    ) as BudgetPlan["categoryMappings"];
    const normalizedBudget: BudgetPlan = {
      ...emptyBudgetPlan(),
      ...(rawBudget ?? {}),
      fixedSalary: Number(rawBudget?.fixedSalary ?? 0),
      amounts: {
        ...emptyBudgetPlan().amounts,
        ...rawAmounts,
        investmentSavings:
          rawAmounts.investmentSavings ??
          (Number(rawAmounts.investment ?? 0) +
            Number(rawAmounts.installmentSavings ?? 0) +
            Number(rawAmounts.savings ?? 0)),
      },
      categoryMappings,
    };
    const now = new Date().toISOString();
    const rawPlans = Array.isArray(j.budgetPlans) ? j.budgetPlans : [];
    const budgetPlans: SavedBudgetPlan[] =
      rawPlans.length > 0
        ? rawPlans.map((plan) => ({
            ...emptyBudgetPlan(),
            ...plan,
            amounts: { ...emptyBudgetPlan().amounts, ...(plan.amounts ?? {}) },
            categoryMappings: plan.categoryMappings ?? {},
          }))
        : normalizedBudget.startDate && normalizedBudget.endDate
          ? [
              {
                ...normalizedBudget,
                id: "legacy-budget-plan",
                createdAt: now,
                updatedAt: now,
              },
            ]
          : [];
    const categories = Array.from(
      new Set([
        "목적자금",
        "세금",
        "가구/가전",
        ...((j.categorySettings?.categories ?? []) as string[]).map((category) =>
          category === "가구가전" ? "가구/가전" : category
        ),
      ])
    ).filter(Boolean);
    return {
      ...emptyStore(),
      ...j,
      entries: j.entries.map(normalizeEntryStatus),
      importLog: Array.isArray(j.importLog) ? j.importLog : [],
      settlementGroups: Array.isArray(j.settlementGroups) ? j.settlementGroups : [],
      budgetPlans,
      activeBudgetPlanId:
        j.activeBudgetPlanId ??
        (budgetPlans.length === 1 && budgetPlans[0].id === "legacy-budget-plan"
          ? "legacy-budget-plan"
          : null),
      categorySettings: {
        categories,
        budgetItemLabels: {
          ...DEFAULT_BUDGET_ITEM_LABELS,
          ...(j.categorySettings?.budgetItemLabels ?? {}),
        },
      },
    };
  }
}

export function readLedgerStore(): LedgerStoreV1 {
  return loadStore(getDb());
}

export function writeLedgerStore(store: LedgerStoreV1): LedgerStoreV1 {
  const next: LedgerStoreV1 = { ...store, updatedAt: new Date().toISOString() };
  saveStore(getDb(), next);
  return next;
}

export type NetWorthSnapshotRecord = {
  exportedAt: string;
  sourceLabel: string;
  file: string;
  snapshot: NetWorthSnapshot;
};

/** 같은 파일(내려받은 시각·사람)을 다시 넣으면 덮어쓰고, 다른 시점 기록은 그대로 둡니다. */
export function recordNetWorthSnapshots(records: NetWorthSnapshotRecord[]) {
  const d = getDb();
  const ins = d.prepare(
    "INSERT OR REPLACE INTO net_worth_snapshots (exported_at, source_label, file, snapshot) VALUES (?, ?, ?, ?)"
  );
  inTransaction(d, () => {
    for (const r of records) ins.run(r.exportedAt, r.sourceLabel, r.file, JSON.stringify(r.snapshot));
  });
}

export type NetWorthPoint = {
  date: string;
  netWorth: number;
  totalAssets: number;
  totalDebt: number;
  byPerson: Record<string, number>;
};

const kstDate = (iso: string) => new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(0, 10);

/**
 * 날짜(한국 시간)별 가구 순자산. 그날까지 각 사람이 가장 최근에 내려받은 재무현황을 합칩니다.
 * 한 사람만 내려받은 날은 다른 사람의 직전 기록을 이어 씁니다.
 */
export function netWorthHistory(): NetWorthPoint[] {
  const rows = getDb()
    .prepare("SELECT exported_at, source_label, snapshot FROM net_worth_snapshots ORDER BY exported_at")
    .all() as Row[];
  const latest = new Map<string, NetWorthSnapshot>();
  const points = new Map<string, NetWorthPoint>();
  for (const r of rows) {
    latest.set(r.source_label as string, JSON.parse(r.snapshot as string));
    const parts = Array.from(latest.entries());
    const totalAssets = parts.reduce((s, [, x]) => s + x.totalAssets, 0);
    const totalDebt = parts.reduce((s, [, x]) => s + x.totalDebt, 0);
    points.set(kstDate(r.exported_at as string), {
      date: kstDate(r.exported_at as string),
      netWorth: totalAssets - totalDebt,
      totalAssets,
      totalDebt,
      byPerson: Object.fromEntries(parts.map(([label, x]) => [label, x.netWorth])),
    });
  }
  return Array.from(points.values());
}

/** ISO 날짜 문자열(YYYY-MM-DD) 최소·최대 */
export function minMaxIsoDates(dates: string[]): { min: string; max: string } | null {
  const ok = dates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  if (ok.length === 0) return null;
  let min = ok[0];
  let max = ok[0];
  for (const d of ok) {
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return { min, max };
}

/**
 * 기존 저장소에 이미 있는 키와 같은 행만 빼고, 이번 파일의 나머지는 그대로 붙입니다.
 * 같은 파일 안의 동일 중복 행은 둘 다 유지됩니다(저장소에 그 키가 아직 없을 때).
 */
export function mergeLedgerAdditive(existing: LedgerEntry[], incoming: LedgerEntry[]): LedgerEntry[] {
  if (incoming.length === 0) return existing;
  const existingKeys = new Set(existing.map(ledgerEntryStableKey));
  const toAdd = incoming.filter((e) => !existingKeys.has(ledgerEntryStableKey(e)));
  return existing.concat(toAdd);
}

/** 현재 적용 중인 예산(budgetPlans 안의 activeBudgetPlanId)을 화면용 BudgetPlan으로 꺼냅니다. */
function activeBudgetPlan(store: LedgerStoreV1): BudgetPlan {
  const plan = store.budgetPlans.find((p) => p.id === store.activeBudgetPlanId);
  if (!plan) return emptyBudgetPlan();
  const { startDate, endDate, fixedSalary, amounts, categoryMappings } = plan;
  return { startDate, endDate, fixedSalary, amounts, categoryMappings };
}

export function storeToResponse(store: LedgerStoreV1) {
  return {
    ledger: store.entries,
    netWorth: store.netWorth,
    updatedAt: store.updatedAt,
    importLog: store.importLog.slice(-30).reverse(),
    budgetPlan: activeBudgetPlan(store),
    budgetPlans: store.budgetPlans,
    activeBudgetPlanId: store.activeBudgetPlanId,
    categorySettings: store.categorySettings,
    settlementGroups: store.settlementGroups,
    netWorthHistory: netWorthHistory(),
    /** 구성원 라벨(업로드 대상·부부 간 이체 판별) */
    members: readMembers().map((m) => m.label),
    persistPath: "data/.moneygrow/moneygrow.db",
  };
}

export function applySyncToStore(
  prev: LedgerStoreV1,
  parts: Array<{ label: string; ledger: LedgerEntry[]; file: string }>,
  netWorth: NetWorthSnapshot | null
): LedgerStoreV1 {
  let entries = prev.entries;
  const at = new Date().toISOString();
  const log = [...prev.importLog];

  for (const part of parts) {
    const before = entries.length;
    entries = mergeLedgerAdditive(entries, applyCategoryRules(part.ledger, prev.categorySettings.rules));
    const dr = minMaxIsoDates(part.ledger.map((e) => e.date));
    log.push({
      at,
      kind: "sync",
      sourceLabel: part.label,
      file: part.file,
      dateRange: dr,
      rowCount: part.ledger.length,
      addedCount: entries.length - before,
    });
  }

  return {
    version: 1,
    updatedAt: at,
    entries,
    netWorth,
    importLog: log.slice(-200),
    budgetPlans: prev.budgetPlans,
    activeBudgetPlanId: prev.activeBudgetPlanId,
    categorySettings: prev.categorySettings,
    settlementGroups: prev.settlementGroups,
  };
}

export function applyUploadToStore(
  prev: LedgerStoreV1,
  ledger: LedgerEntry[],
  sourceLabel: string,
  fileName: string
): LedgerStoreV1 {
  const before = prev.entries.length;
  const entries = mergeLedgerAdditive(prev.entries, applyCategoryRules(ledger, prev.categorySettings.rules));
  const dr = minMaxIsoDates(ledger.map((e) => e.date));
  const at = new Date().toISOString();
  const log = [
    ...prev.importLog,
    {
      at,
      kind: "upload" as const,
      sourceLabel,
      file: fileName,
      dateRange: dr,
      rowCount: ledger.length,
      addedCount: entries.length - before,
    },
  ];
  return {
    version: 1,
    updatedAt: at,
    entries,
    netWorth: prev.netWorth,
    importLog: log.slice(-200),
    budgetPlans: prev.budgetPlans,
    activeBudgetPlanId: prev.activeBudgetPlanId,
    categorySettings: prev.categorySettings,
    settlementGroups: prev.settlementGroups,
  };
}
