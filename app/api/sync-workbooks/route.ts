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

export const dynamic = "force-dynamic";

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
  // 파일명 `시작일~종료일.xlsx`의 종료일이 가장 늦은 파일을 고르고, 같거나 없으면 수정 시각으로 비교합니다.
  // 수정 시각만 보면 옛 기간 파일을 나중에 넣었을 때 그 파일이 "최신"으로 잡힙니다.
  const endDateOf = (n: string) => n.match(/~(\d{4}-\d{2}-\d{2})/)?.[1] ?? "";
  let best = xlsx[0];
  let bestEnd = "";
  let bestT = 0;
  for (const n of xlsx) {
    const full = path.join(dir, n);
    try {
      const st = await stat(full);
      const end = endDateOf(n);
      if (end > bestEnd || (end === bestEnd && st.mtimeMs >= bestT)) {
        bestEnd = end;
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
  // 자산 현황 시트가 없는 파일이면 기존 순자산을 유지합니다.
  const merged = applySyncToStore(prev, parts, netWorth ?? prev.netWorth);
  const saved = await writeLedgerStore(merged);

  return NextResponse.json({
    ...storeToResponse(saved),
    sources,
    summaryLabel,
  });
}
