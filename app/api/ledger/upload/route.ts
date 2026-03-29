import { parseWorkbookNodeBuffer } from "@/lib/excel/importBankExport";
import {
  applyUploadToStore,
  readLedgerStore,
  storeToResponse,
  writeLedgerStore,
} from "@/lib/store/ledgerStore";
import { NextResponse } from "next/server";

/**
 * 엑셀 업로드 → 저장소에 없는 거래만 추가(기존 행 유지).
 * 순자산(netWorth)은 변경하지 않습니다(동기화 API에서만 갱신).
 */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "multipart 요청이 아닙니다." }, { status: 400 });
  }

  const file = form.get("file");
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: "file 필드가 필요합니다." }, { status: 400 });
  }

  const sourceLabel = String(form.get("sourceLabel") || "업로드").trim() || "업로드";
  const fileName = file instanceof File && file.name ? file.name : "upload.xlsx";

  const buf = Buffer.from(await file.arrayBuffer());
  const { ledger } = parseWorkbookNodeBuffer(buf, sourceLabel);
  if (ledger.length === 0) {
    return NextResponse.json(
      { error: "가계부 시트를 찾지 못했거나 데이터가 없습니다." },
      { status: 400 }
    );
  }

  const prev = await readLedgerStore();
  const merged = applyUploadToStore(prev, ledger, sourceLabel, fileName);
  const saved = await writeLedgerStore(merged);

  return NextResponse.json({
    ...storeToResponse(saved),
    summaryLabel: `${sourceLabel} ← 업로드: ${fileName}`,
  });
}
