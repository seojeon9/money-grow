import { readLedgerStore, storeToResponse } from "@/lib/store/ledgerStore";
import { NextResponse } from "next/server";

/** 누적 저장된 가계부·순자산 스냅샷 조회 (디스크). */
export async function GET() {
  const store = await readLedgerStore();
  return NextResponse.json(storeToResponse(store));
}
