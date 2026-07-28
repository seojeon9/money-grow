import { readLedgerStore, storeToResponse, writeLedgerStore } from "@/lib/store/ledgerStore";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  let body: { id?: string; categoryMain?: string };
  try {
    body = (await req.json()) as { id?: string; categoryMain?: string };
  } catch {
    return NextResponse.json({ error: "JSON 본문이 필요합니다." }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id : "";
  const categoryMain = typeof body.categoryMain === "string" ? body.categoryMain.trim() : "";
  if (!id || !categoryMain) {
    return NextResponse.json({ error: "거래와 대분류를 입력해 주세요." }, { status: 400 });
  }

  const store = await readLedgerStore();
  let found = false;
  const entries = store.entries.map((entry) => {
    if (entry.id !== id) return entry;
    found = true;
    return { ...entry, categoryMainOverride: categoryMain };
  });
  if (!found) {
    return NextResponse.json({ error: "해당 거래를 찾을 수 없습니다." }, { status: 404 });
  }

  const saved = await writeLedgerStore({ ...store, entries });
  return NextResponse.json(storeToResponse(saved));
}
