import fs from "node:fs";
import path from "node:path";

/**
 * 모든 산출물은 ./data 아래에만 쓴다(2-2 완전 로컬).
 * ⚠️ 경로 비교는 반드시 NFC 정규화한 값끼리 한다 → 7-23.
 *    macOS 의 process.cwd() 는 한글을 NFD(자모 분해)로 주는데
 *    브라우저가 보내는 URL 파라미터는 NFC(완성형)이라, 같은 폴더인데도
 *    startsWith 가 false 가 되어 한글 경로에서 이미지 미리보기가 전부 403 이 된다.
 */
export const DATA_ROOT = path.join(process.cwd(), "data");

export const DIRS = {
  root: DATA_ROOT,
  images: path.join(DATA_ROOT, "images"),
  shots: path.join(DATA_ROOT, "shots"),
  session: path.join(DATA_ROOT, "session"),
  db: path.join(DATA_ROOT, "app.db"),
  storageState: path.join(DATA_ROOT, "session", "naver.json"),
};

export function ensureDirs() {
  for (const d of [DIRS.root, DIRS.images, DIRS.shots, DIRS.session]) {
    fs.mkdirSync(d, { recursive: true });
  }
}

/** 경로 비교용 정규화. NFC + (윈도우는) 대소문자 무시 → 7-23, 11장 5번 */
export function normPath(x: string): string {
  const n = path.resolve(x).normalize("NFC");
  return process.platform === "win32" ? n.toLowerCase() : n;
}

/** ./data 안쪽 파일인지 검사. 경로 탈출(../) 방지. */
export function isInsideData(p: string): boolean {
  const root = normPath(DATA_ROOT);
  const target = normPath(p);
  return target === root || target.startsWith(root + path.sep);
}

/**
 * 실제로 존재하는 파일 경로를 찾아 돌려준다(없으면 null).
 *
 * ⚠️ 7-23 의 짝 문제다. 경로 "비교"는 NFC 로 정규화해서 맞췄지만, 파일을 "읽을" 때는
 *    파일시스템이 저장한 바이트와 정확히 같아야 하는 경우가 있다.
 *    실측: 리눅스에서 NFD 로 인코딩된 한글 경로를 보내면 접두사 검사는 통과하는데
 *    fs.existsSync 가 false 라 404 가 났다. (macOS 는 파일시스템이 알아서 맞춰준다)
 *    → 받은 그대로 → NFC → NFD 순으로 시도한다.
 */
export function resolveExisting(p: string): string | null {
  for (const cand of [p, p.normalize("NFC"), p.normalize("NFD")]) {
    if (fs.existsSync(cand)) return cand;
  }
  return null;
}

/** `~` 를 $HOME 으로 확장 */
export function expandHome(p: string): string {
  if (p === "~") return process.env.HOME || process.env.USERPROFILE || p;
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return path.join(process.env.HOME || process.env.USERPROFILE || "", p.slice(2));
  }
  return p;
}
