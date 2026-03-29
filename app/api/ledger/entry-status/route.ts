import {
  type LedgerEntry,
  type LedgerEntryStatus,
  ledgerEntryStableKey,
} from "@/lib/excel/importBankExport";
import {
  readLedgerStore,
  storeToResponse,
  writeLedgerStore,
} from "@/lib/store/ledgerStore";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  let body: { key?: string; status?: string; id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON 본문이 필요합니다." }, { status: 400 });
  }

  const key = typeof body.key === "string" ? body.key : "";
  const rowId = typeof body.id === "string" && body.id ? body.id : null;
  const status = body.status as LedgerEntryStatus;
  if (!key || (status !== "hidden" && status !== "visible")) {
    return NextResponse.json(
      { error: "key와 status(visible | hidden)가 필요합니다." },
      { status: 400 }
    );
  }

  const store = await readLedgerStore();
  let found = false;
  const entries = store.entries.map((e) => {
    if (ledgerEntryStableKey(e) !== key) return e;
    if (rowId !== null && e.id !== rowId) return e;
    found = true;
    return { ...e, status } as LedgerEntry;
  });

  if (!found) {
    return NextResponse.json({ error: "해당 거래를 찾을 수 없습니다." }, { status: 404 });
  }

  const saved = await writeLedgerStore({ ...store, entries });
  return NextResponse.json(storeToResponse(saved));
}
