import { readLedgerStore, storeToResponse, writeLedgerStore } from "@/lib/store/ledgerStore";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  let body: { id?: string; note?: string };
  try {
    body = (await req.json()) as { id?: string; note?: string };
  } catch {
    return NextResponse.json({ error: "JSON 본문이 필요합니다." }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id : "";
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!id) {
    return NextResponse.json({ error: "거래 ID가 필요합니다." }, { status: 400 });
  }

  const store = await readLedgerStore();
  let found = false;
  const entries = store.entries.map((entry) => {
    if (entry.id !== id) return entry;
    found = true;
    return { ...entry, noteOverride: note };
  });
  if (!found) {
    return NextResponse.json({ error: "해당 거래를 찾을 수 없습니다." }, { status: 404 });
  }

  const saved = await writeLedgerStore({ ...store, entries });
  return NextResponse.json(storeToResponse(saved));
}
