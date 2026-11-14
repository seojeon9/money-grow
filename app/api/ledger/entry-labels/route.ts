import { ENTRY_LABELS } from "@/lib/budget";
import { readLedgerStore, storeToResponse, writeLedgerStore } from "@/lib/store/ledgerStore";
import { NextResponse } from "next/server";

const ALLOWED = new Set<string>(ENTRY_LABELS.map((l) => l.name));

/** 거래 라벨 저장. 빈 배열이면 "라벨 없음"으로 저장(소분류 추정도 끔). */
export async function POST(req: Request) {
  let body: { id?: unknown; labels?: unknown };
  try {
    body = (await req.json()) as { id?: unknown; labels?: unknown };
  } catch {
    return NextResponse.json({ error: "JSON 본문이 필요합니다." }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id : "";
  if (!id || !Array.isArray(body.labels) || body.labels.some((l) => typeof l !== "string" || !ALLOWED.has(l))) {
    return NextResponse.json({ error: "거래 ID와 올바른 라벨이 필요합니다." }, { status: 400 });
  }
  const labels = Array.from(new Set(body.labels as string[]));
  const store = readLedgerStore();
  if (!store.entries.some((entry) => entry.id === id)) {
    return NextResponse.json({ error: "해당 거래를 찾을 수 없습니다." }, { status: 404 });
  }
  const saved = writeLedgerStore({
    ...store,
    entries: store.entries.map((entry) => (entry.id === id ? { ...entry, labels } : entry)),
  });
  return NextResponse.json(storeToResponse(saved));
}
