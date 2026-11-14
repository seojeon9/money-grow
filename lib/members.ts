import { existsSync, readFileSync } from "fs";
import path from "path";

/** 가구 구성원: 화면·데이터의 출처 라벨과 data/ 아래 엑셀 폴더 이름 */
export type Member = { label: string; folder: string };

/**
 * 구성원 설정은 git에 올리지 않는 `data/members.json`에서 읽습니다(공개 저장소에 이름이 남지 않게).
 * 예: [{ "label": "구성원1", "folder": "member1" }, { "label": "구성원2", "folder": "member2" }]
 */
const MEMBERS_PATH = path.join(process.cwd(), "..", "data", "members.json");

const DEFAULT_MEMBERS: Member[] = [
  { label: "구성원1", folder: "member1" },
  { label: "구성원2", folder: "member2" },
];

export function readMembers(): Member[] {
  try {
    if (!existsSync(MEMBERS_PATH)) return DEFAULT_MEMBERS;
    const raw = JSON.parse(readFileSync(MEMBERS_PATH, "utf8")) as unknown;
    if (!Array.isArray(raw)) return DEFAULT_MEMBERS;
    const members = raw.filter(
      (m): m is Member =>
        !!m && typeof m.label === "string" && !!m.label.trim() && typeof m.folder === "string" && !!m.folder.trim()
    );
    return members.length > 0 ? members : DEFAULT_MEMBERS;
  } catch {
    return DEFAULT_MEMBERS;
  }
}
