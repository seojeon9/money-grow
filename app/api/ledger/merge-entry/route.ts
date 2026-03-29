import { type LedgerEntry, ledgerEntryStableKey } from "@/lib/excel/importBankExport";
import { readLedgerStore, storeToResponse, writeLedgerStore } from "@/lib/store/ledgerStore";
import { NextResponse } from "next/server";

type MergeBody = {
  fromKey?: string;
  fromId?: string;
  toKey?: string;
  toId?: string;
};

function findEntryIndex(
  entries: LedgerEntry[],
  stableKey: string,
  id?: string
): number {
  return entries.findIndex((entry) => {
    if (ledgerEntryStableKey(entry) !== stableKey) return false;
    if (id && entry.id !== id) return false;
    return true;
  });
}

export async function POST(req: Request) {
  let body: MergeBody;
  try {
    body = (await req.json()) as MergeBody;
  } catch {
    return NextResponse.json({ error: "JSON 본문이 필요합니다." }, { status: 400 });
  }

  const fromKey = typeof body.fromKey === "string" ? body.fromKey : "";
  const toKey = typeof body.toKey === "string" ? body.toKey : "";
  const fromId = typeof body.fromId === "string" && body.fromId ? body.fromId : undefined;
  const toId = typeof body.toId === "string" && body.toId ? body.toId : undefined;

  if (!fromKey || !toKey) {
    return NextResponse.json({ error: "fromKey, toKey가 필요합니다." }, { status: 400 });
  }

  const store = await readLedgerStore();
  const entries = [...store.entries];
  const fromIdx = findEntryIndex(entries, fromKey, fromId);
  const toIdx = findEntryIndex(entries, toKey, toId);

  if (fromIdx < 0 || toIdx < 0) {
    return NextResponse.json({ error: "합칠 거래를 찾을 수 없습니다." }, { status: 404 });
  }
  if (fromIdx === toIdx) {
    return NextResponse.json({ error: "같은 거래끼리는 합칠 수 없습니다." }, { status: 400 });
  }

  const from = entries[fromIdx];
  const to = entries[toIdx];
  if (from.amount <= 0) {
    return NextResponse.json({ error: "합치기 기준 거래는 입금(+)이어야 합니다." }, { status: 400 });
  }

  entries[toIdx] = {
    ...to,
    amount: to.amount + from.amount,
  };
  entries[fromIdx] = {
    ...from,
    status: "hidden",
  };

  const saved = await writeLedgerStore({ ...store, entries });
  return NextResponse.json(storeToResponse(saved));
}
