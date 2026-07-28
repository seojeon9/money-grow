import {
  readLedgerStore,
  storeToResponse,
  writeLedgerStore,
} from "@/lib/store/ledgerStore";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  let body: { memberIds?: string[] };
  try {
    body = (await req.json()) as { memberIds?: string[] };
  } catch {
    return NextResponse.json({ error: "JSON 본문이 필요합니다." }, { status: 400 });
  }

  const memberIds = Array.from(
    new Set((body.memberIds ?? []).filter((id): id is string => typeof id === "string" && !!id))
  );
  if (memberIds.length < 2) {
    return NextResponse.json({ error: "두 건 이상의 거래를 선택해 주세요." }, { status: 400 });
  }

  const store = await readLedgerStore();
  const alreadyGrouped = new Set(store.settlementGroups.flatMap((group) => group.memberIds));
  if (memberIds.some((id) => alreadyGrouped.has(id))) {
    return NextResponse.json({ error: "이미 합쳐진 거래가 포함되어 있습니다." }, { status: 400 });
  }
  const members = store.entries.filter((entry) => entry.id && memberIds.includes(entry.id));
  if (members.length !== memberIds.length) {
    return NextResponse.json({ error: "선택한 거래 일부를 찾을 수 없습니다." }, { status: 404 });
  }
  if (!members.some((entry) => entry.amount < 0)) {
    return NextResponse.json({ error: "지출 거래를 한 건 이상 선택해 주세요." }, { status: 400 });
  }

  const now = new Date().toISOString();
  const group = {
    id: crypto.randomUUID(),
    createdAt: now,
    memberIds,
  };
  const saved = await writeLedgerStore({
    ...store,
    settlementGroups: [...store.settlementGroups, group],
  });
  return NextResponse.json(storeToResponse(saved));
}
