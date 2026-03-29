import * as XLSX from "xlsx";

export type LedgerEntryStatus = "visible" | "hidden";

export type LedgerEntry = {
  date: string;
  time: string;
  txType: string;
  categoryMain: string;
  categorySub: string;
  description: string;
  amount: number;
  currency: string;
  paymentMethod: string;
  note: string;
  /** 가계부 출처(예: 서정, 상윤). 단일 업로드는 빈 문자열. */
  sourceLabel: string;
  /**
   * visible: 합계·차트·목록에 포함.
   * hidden: 사용자가 숨김 — 집계·차트·일반 목록에서 제외(저장은 유지).
   */
  status?: LedgerEntryStatus;
  /** 동일 키 거래가 여러 줄일 때 구분(파싱 시 부여). */
  id?: string;
};

export type MonthlyFlow = {
  month: string;
  income: number;
  expense: number;
  netCashFlow: number;
};

export type BalanceLine = {
  category: string;
  name: string;
  amount: number;
  sourceLabel?: string;
};

export type NetWorthSnapshot = {
  totalAssets: number;
  totalDebt: number;
  netWorth: number;
  assets: BalanceLine[];
  debts: BalanceLine[];
};

function sheetNames(book: XLSX.WorkBook): string[] {
  return book.SheetNames ?? [];
}

function getSheet(book: XLSX.WorkBook, name: string): XLSX.WorkSheet | null {
  return book.Sheets[name] ?? null;
}

function toMatrix(sheet: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    raw: false,
  });
}

function asNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  const s = String(v).replace(/,/g, "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseDateCell(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === "number") {
    const epoch = Date.UTC(1899, 11, 30);
    const ms = epoch + Math.round(v * 86400000);
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }
  const str = String(v).trim();
  if (!str) return null;
  const d = new Date(str);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

export function findLedgerSheetName(names: string[]): string | null {
  return (
    names.find((n) => n.includes("가계부")) ??
    names.find((n) => n.toLowerCase().includes("ledger")) ??
    null
  );
}

export function findBankSheetName(names: string[]): string | null {
  return (
    names.find((n) => n.includes("뱅샐") || n.includes("뱅크")) ??
    null
  );
}

const LEDGER_DEDUPE_SEP = "\x1e";

/** 집계·목록에 넣을지 — hidden 이면 제외(undefined 는 visible 과 동일). */
export function isLedgerEntryCounted(e: LedgerEntry): boolean {
  return e.status !== "hidden";
}

/** 저장·병합 시 같은 거래로 볼지 판별하는 키(status 제외 — 숨김 토글해도 동일 건으로 취급). */
export function ledgerEntryStableKey(e: LedgerEntry): string {
  return [
    e.sourceLabel,
    e.date,
    e.time,
    e.txType,
    e.categoryMain,
    e.categorySub,
    e.description,
    String(e.amount),
    e.currency,
    e.paymentMethod,
    e.note,
  ].join(LEDGER_DEDUPE_SEP);
}

export function parseLedger(book: XLSX.WorkBook, sourceLabel = ""): LedgerEntry[] {
  const name = findLedgerSheetName(sheetNames(book));
  if (!name) return [];
  const sheet = getSheet(book, name);
  if (!sheet) return [];

  const rows = toMatrix(sheet);
  if (rows.length < 2) return [];

  const header = rows[0].map((c) => String(c ?? "").trim());
  const idx = (label: string) =>
    header.findIndex((h) => h === label || h.replace(/\s/g, "") === label.replace(/\s/g, ""));

  const iDate = idx("날짜");
  const iTime = idx("시간");
  const iType = idx("타입");
  const iMain = idx("대분류");
  const iSub = idx("소분류");
  const iDesc = idx("내용");
  const iAmt = idx("금액");
  const iCur = idx("화폐");
  const iPay = idx("결제수단");
  const iMemo = idx("메모");

  if (iDate < 0 || iAmt < 0) return [];

  const out: LedgerEntry[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const dateStr = parseDateCell(row[iDate]);
    if (!dateStr) continue;
    const amount = asNum(row[iAmt]);
    if (amount === null) continue;

    const id =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `row-${sourceLabel}-${r}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    out.push({
      id,
      date: dateStr,
      time: iTime >= 0 ? String(row[iTime] ?? "") : "",
      txType: iType >= 0 ? String(row[iType] ?? "").trim() : "",
      categoryMain: iMain >= 0 ? String(row[iMain] ?? "").trim() : "",
      categorySub: iSub >= 0 ? String(row[iSub] ?? "").trim() : "",
      description: iDesc >= 0 ? String(row[iDesc] ?? "").trim() : "",
      amount,
      currency: iCur >= 0 ? String(row[iCur] ?? "KRW").trim() || "KRW" : "KRW",
      paymentMethod: iPay >= 0 ? String(row[iPay] ?? "").trim() : "",
      note: iMemo >= 0 ? String(row[iMemo] ?? "").trim() : "",
      sourceLabel,
      status: "visible",
    });
  }
  return out;
}

export function monthlyFlowsFromLedger(entries: LedgerEntry[]): MonthlyFlow[] {
  const map = new Map<string, { income: number; expense: number }>();
  for (const e of entries) {
    const month = e.date.slice(0, 7);
    if (!map.has(month)) map.set(month, { income: 0, expense: 0 });
    const b = map.get(month)!;
    if (e.amount >= 0) b.income += e.amount;
    else b.expense += -e.amount;
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({
      month,
      income: v.income,
      expense: v.expense,
      netCashFlow: v.income - v.expense,
    }));
}

/** 뱅크샐(또는 유사) 시트에서 '3.재무현황' 블록의 라인별 자산·부채를 읽습니다. */
export function parseNetWorthSnapshot(book: XLSX.WorkBook): NetWorthSnapshot | null {
  const name = findBankSheetName(sheetNames(book));
  if (!name) return null;
  const sheet = getSheet(book, name);
  if (!sheet) return null;

  const rows = toMatrix(sheet);
  let financeStart = -1;
  for (let i = 0; i < rows.length; i++) {
    const a = rows[i]?.[1];
    if (typeof a === "string" && a.includes("3.재무현황")) {
      financeStart = i;
      break;
    }
  }
  if (financeStart < 0) return null;

  let headerRow = -1;
  for (let i = financeStart; i < Math.min(financeStart + 15, rows.length); i++) {
    const c1 = String(rows[i]?.[1] ?? "").trim();
    const c2 = String(rows[i]?.[2] ?? "").trim();
    if (c1 === "항목" && c2 === "상품명") {
      headerRow = i;
      break;
    }
  }
  if (headerRow < 0) return null;

  const assets: BalanceLine[] = [];
  const debts: BalanceLine[] = [];

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    const c1 = row?.[1];
    const label1 = typeof c1 === "string" ? c1.trim() : "";
    if (label1 === "총자산") break;

    const category = String(row?.[1] ?? "").trim() || "";
    const product = String(row?.[2] ?? "").trim() || "";
    const assetAmt = asNum(row?.[4]);
    const debtAmt = asNum(row?.[8]);

    if (assetAmt !== null && assetAmt !== 0) {
      assets.push({
        category,
        name: product || category,
        amount: assetAmt,
      });
    }
    if (debtAmt !== null && debtAmt !== 0) {
      debts.push({
        category: String(row?.[5] ?? "").trim(),
        name: String(row?.[6] ?? "").trim(),
        amount: debtAmt,
      });
    }
  }

  const totalAssets = assets.reduce((s, x) => s + x.amount, 0);
  const totalDebt = debts.reduce((s, x) => s + x.amount, 0);

  return {
    totalAssets,
    totalDebt,
    netWorth: totalAssets - totalDebt,
    assets,
    debts,
  };
}

/** 여러 스냅샷을 합산(자산·부채 라인에는 출처 라벨 부여). */
export function mergeNetWorthSnapshots(
  parts: Array<{ snapshot: NetWorthSnapshot | null; sourceLabel: string }>
): NetWorthSnapshot | null {
  const ok = parts.filter((p): p is { snapshot: NetWorthSnapshot; sourceLabel: string } => p.snapshot != null);
  if (ok.length === 0) return null;
  let totalAssets = 0;
  let totalDebt = 0;
  const assets: BalanceLine[] = [];
  const debts: BalanceLine[] = [];
  for (const { snapshot: s, sourceLabel } of ok) {
    totalAssets += s.totalAssets;
    totalDebt += s.totalDebt;
    for (const a of s.assets) {
      assets.push({ ...a, sourceLabel });
    }
    for (const d of s.debts) {
      debts.push({ ...d, sourceLabel });
    }
  }
  return {
    totalAssets,
    totalDebt,
    netWorth: totalAssets - totalDebt,
    assets,
    debts,
  };
}

export type ParsedWorkbook = {
  ledger: LedgerEntry[];
  monthly: MonthlyFlow[];
  netWorth: NetWorthSnapshot | null;
};

export function parseWorkbookBuffer(buf: ArrayBuffer, sourceLabel = ""): ParsedWorkbook {
  const book = XLSX.read(buf, { type: "array", cellDates: true });
  const ledger = parseLedger(book, sourceLabel);
  const monthly = monthlyFlowsFromLedger(ledger);
  const netWorth = parseNetWorthSnapshot(book);
  return { ledger, monthly, netWorth };
}

/** Node `Buffer`용 (API 라우트). */
export function parseWorkbookNodeBuffer(buf: Buffer, sourceLabel = ""): ParsedWorkbook {
  const book = XLSX.read(buf, { type: "buffer", cellDates: true });
  const ledger = parseLedger(book, sourceLabel);
  const monthly = monthlyFlowsFromLedger(ledger);
  const netWorth = parseNetWorthSnapshot(book);
  return { ledger, monthly, netWorth };
}
