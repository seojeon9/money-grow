import {
  type LedgerEntry,
  type NetWorthSnapshot,
  mergeNetWorthSnapshots,
  parseWorkbookNodeBuffer,
} from "@/lib/excel/importBankExport";
import {
  applySyncToStore,
  readLedgerStore,
  storeToResponse,
  writeLedgerStore,
} from "@/lib/store/ledgerStore";
import { readdir, readFile, stat } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

const SOURCE_DIRS: { folder: string; label: string }[] = [
  { folder: "seojeong", label: "서정" },
  { folder: "sangyun", label: "상윤" },
];

async function pickLatestXlsx(dir: string): Promise<{ name: string; full: string } | null> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return null;
  }
  const xlsx = names.filter((n) => n.endsWith(".xlsx"));
  if (xlsx.length === 0) return null;
  let best = xlsx[0];
  let bestT = 0;
  for (const n of xlsx) {
    const full = path.join(dir, n);
    try {
      const st = await stat(full);
      if (st.mtimeMs >= bestT) {
        bestT = st.mtimeMs;
        best = n;
      }
    } catch {
      continue;
    }
  }
  return { name: best, full: path.join(dir, best) };
}

/**
 * 디스크 최신 xlsx(서정·상윤)를 읽어, 저장소에 없는 거래만 추가합니다.
 * 순자산은 이번 동기화 결과로 갱신합니다.
 */
export async function GET() {
  const dataRoot = path.join(process.cwd(), "..", "data");
  const sources: { label: string; folder: string; file: string }[] = [];
  const parts: Array<{ label: string; ledger: LedgerEntry[]; file: string }> = [];
  const nwParts: Array<{ snapshot: NetWorthSnapshot | null; sourceLabel: string }> = [];

  for (const { folder, label } of SOURCE_DIRS) {
    const dir = path.join(dataRoot, folder);
    const picked = await pickLatestXlsx(dir);
    if (!picked) continue;
    const buf = await readFile(picked.full);
    const parsed = parseWorkbookNodeBuffer(buf, label);
    parts.push({ label, ledger: parsed.ledger, file: `${folder}/${picked.name}` });
    nwParts.push({ snapshot: parsed.netWorth, sourceLabel: label });
    sources.push({ label, folder, file: picked.name });
  }

  if (sources.length === 0) {
    return NextResponse.json(
      {
        error:
          "동기화할 파일이 없습니다. money-grow/data/seojeong 과 data/sangyun 에 .xlsx 가 있는지 확인하세요.",
      },
      { status: 404 }
    );
  }

  const netWorth = mergeNetWorthSnapshots(nwParts);
  const summaryLabel = sources.map((s) => `${s.label} ← ${s.folder}/${s.file}`).join(" · ");

  const prev = await readLedgerStore();
  const merged = applySyncToStore(prev, parts, netWorth);
  const saved = await writeLedgerStore(merged);

  return NextResponse.json({
    ...storeToResponse(saved),
    sources,
    summaryLabel,
  });
}
