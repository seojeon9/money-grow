import type { LedgerEntry, LedgerEntryStatus, NetWorthSnapshot } from "@/lib/excel/importBankExport";
import { ledgerEntryStableKey } from "@/lib/excel/importBankExport";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

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

export type LedgerStoreV1 = {
  version: 1;
  updatedAt: string;
  entries: LedgerEntry[];
  netWorth: NetWorthSnapshot | null;
  importLog: ImportRecord[];
};

export function getLedgerStorePath(): string {
  return path.join(process.cwd(), "..", "data", ".moneygrow", "ledger-state.json");
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
  };
}

export async function readLedgerStore(): Promise<LedgerStoreV1> {
  const p = getLedgerStorePath();
  try {
    const raw = await readFile(p, "utf8");
    const j = JSON.parse(raw) as LedgerStoreV1;
    if (j.version !== 1 || !Array.isArray(j.entries)) return emptyStore();
    return {
      ...emptyStore(),
      ...j,
      entries: j.entries.map(normalizeEntryStatus),
      importLog: Array.isArray(j.importLog) ? j.importLog : [],
    };
  } catch {
    return emptyStore();
  }
}

export async function writeLedgerStore(store: LedgerStoreV1): Promise<LedgerStoreV1> {
  const p = getLedgerStorePath();
  await mkdir(path.dirname(p), { recursive: true });
  const next: LedgerStoreV1 = {
    ...store,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(p, JSON.stringify(next, null, 2), "utf8");
  return next;
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

export function storeToResponse(store: LedgerStoreV1) {
  return {
    ledger: store.entries,
    netWorth: store.netWorth,
    updatedAt: store.updatedAt,
    importLog: store.importLog.slice(-30).reverse(),
    persistPath: "data/.moneygrow/ledger-state.json",
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
    entries = mergeLedgerAdditive(entries, part.ledger);
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
  };
}

export function applyUploadToStore(
  prev: LedgerStoreV1,
  ledger: LedgerEntry[],
  sourceLabel: string,
  fileName: string
): LedgerStoreV1 {
  const before = prev.entries.length;
  const entries = mergeLedgerAdditive(prev.entries, ledger);
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
  };
}
