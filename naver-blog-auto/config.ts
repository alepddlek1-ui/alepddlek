/**
 * 전역 기본값. 환경변수로 오버라이드할 수 있지만,
 * ⚠️ 앱이 한 번 켜진 뒤에는 DB(settings 테이블) 값이 우선한다. 여기 값은 "최초 기본값"일 뿐이다.
 */
const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const bool = (v: string | undefined, d: boolean) =>
  v === undefined ? d : /^(1|true|yes|on)$/i.test(v);

export type Visibility = "public" | "neighbor" | "both" | "private";

export const CONFIG = {
  port: 4123,

  // ── 발행 안전장치 ────────────────────────────────
  // ⚠️ dryRun 기본값은 반드시 true. 실제 발행은 사용자가 명시적으로 꺼야만 일어난다.
  dryRun: bool(process.env.DRY_RUN, true),
  killSwitch: bool(process.env.KILL_SWITCH, false),
  // ⚠️ visibility 기본값은 반드시 private.
  //    네이버 발행 레이어의 기본값이 "전체공개"이므로(7-19), 앱 기본값까지 공개면
  //    "첫 실발행은 비공개로"라는 지시를 지킬 방법이 없어진다.
  visibility: (process.env.VISIBILITY as Visibility) || ("private" as Visibility),
  dailyPublishLimit: num(process.env.DAILY_PUBLISH_LIMIT, 3),
  minPublishIntervalMin: num(process.env.MIN_PUBLISH_INTERVAL_MIN, 30),

  // ── 수집·이미지 ──────────────────────────────────
  scrapeTopN: num(process.env.SCRAPE_TOP_N, 8),
  imageCandidates: num(process.env.IMAGE_CANDIDATES, 10),
  cfImageSteps: num(process.env.CF_IMAGE_STEPS, 6),

  // ── 실행 방식 ────────────────────────────────────
  showBrowser: bool(process.env.SHOW_BROWSER, false),
  claudeTimeoutSec: num(process.env.CLAUDE_TIMEOUT_SEC, 180),
  claudeConcurrency: num(process.env.CLAUDE_CONCURRENCY, 2),

  // ── 외부 ─────────────────────────────────────────
  claudeBin: process.env.CLAUDE_BIN || "claude",
  cfAccountId: process.env.CLOUDFLARE_ACCOUNT_ID || "",
  cfApiToken: process.env.CLOUDFLARE_API_TOKEN || "",

  // ── 발행 단계 상한 (파이프라인이 영원히 publishing 으로 남는 걸 막는다) ──
  publishStageTimeoutMs: 15 * 60 * 1000,
} as const;

export const CF_MODEL = "@cf/black-forest-labs/flux-1-schnell";

/**
 * 이 코드가 언제 판인지 나타내는 표시.
 *
 * ⚠️ 왜 필요한가: 사용자가 새 버전을 받아 덮어썼는지 확인할 방법이 없어서
 *    "고쳤다는데 왜 똑같냐 / 정말 새 버전이 맞냐" 로 시간을 크게 썼다.
 *    작업 로그 첫 줄과 점검 화면에 찍어, 어느 판이 돌고 있는지 한눈에 보이게 한다.
 *    코드를 고칠 때마다 이 값을 올린다.
 */
export const APP_BUILD = "2026-09-10a";
