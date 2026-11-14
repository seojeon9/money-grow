import {
  type LedgerEntry,
  type NetWorthSnapshot,
  mergeNetWorthSnapshots,
  parseWorkbookNodeBuffer,
} from "@/lib/excel/importBankExport";
import {
  applySyncToStore,
  type NetWorthSnapshotRecord,
  readLedgerStore,
  recordNetWorthSnapshots,
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

/**
 * data 폴더(서정·상윤)의 xlsx를 모두 읽어, 저장소에 없는 거래만 추가합니다(겹치는 기간은 키로 걸러짐).
 * 순자산은 파일마다 기록으로 남기고, 현재 순자산은 사람별로 가장 최근에 내려받은 파일 기준입니다.
 */
export async function GET() {
  const dataRoot = path.join(process.cwd(), "..", "data");
  const sources: { label: string; folder: string; file: string }[] = [];
  const parts: Array<{ label: string; ledger: LedgerEntry[]; file: string }> = [];
  const nwParts: Array<{ snapshot: NetWorthSnapshot | null; sourceLabel: string }> = [];
  const history: NetWorthSnapshotRecord[] = [];

  for (const { folder, label } of SOURCE_DIRS) {
    const dir = path.join(dataRoot, folder);
    const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith(".xlsx")).sort();
    let latest: { name: string; exportedAt: string; snapshot: NetWorthSnapshot | null } | null = null;
    for (const name of names) {
      const full = path.join(dir, name);
      const parsed = parseWorkbookNodeBuffer(await readFile(full), label);
      const exportedAt = parsed.exportedAt ?? new Date((await stat(full)).mtimeMs).toISOString();
      parts.push({ label, ledger: parsed.ledger, file: `${folder}/${name}` });
      if (parsed.netWorth) {
        history.push({ exportedAt, sourceLabel: label, file: `${folder}/${name}`, snapshot: parsed.netWorth });
      }
      if (!latest || exportedAt > latest.exportedAt) latest = { name, exportedAt, snapshot: parsed.netWorth };
    }
    if (!latest) continue;
    nwParts.push({ snapshot: latest.snapshot, sourceLabel: label });
    sources.push({ label, folder, file: latest.name });
  }
  recordNetWorthSnapshots(history);

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
