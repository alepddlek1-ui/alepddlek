/**
 * 설정의 "모양"만 담은 순수 모듈 — 서버·클라이언트 공용.
 *
 * ⚠️ 여기에 DB·파일시스템(node:*) 을 import 하지 마라.
 *    UI(page.tsx / SettingsDrawer.tsx)가 이 파일을 불러오는데, lib/settings.ts 를 직접 부르면
 *    lib/db.ts → lib/paths.ts → node:path 가 클라이언트 번들로 딸려 들어가 빌드가 깨진다.
 *    (실제로 첫 빌드가 "Reading from node:path is not handled" 로 실패했다)
 */
import type { Visibility } from "@/config";

export type Settings = {
  dryRun: boolean;
  killSwitch: boolean;
  visibility: Visibility;
  dailyPublishLimit: number;
  minPublishIntervalMin: number;
  scrapeTopN: number;
  imageCandidates: number;
  cfImageSteps: number;
  showBrowser: boolean;
  claudeTimeoutSec: number;
  claudeConcurrency: number;
};

/** UI 와 서버가 같은 규칙을 쓰도록 API 로 내려보낸다 */
export const LIMITS = {
  dailyPublishLimit: { min: 1, max: 50 },
  minPublishIntervalMin: { min: 0, max: 720 },
  scrapeTopN: { min: 3, max: 30 },
  imageCandidates: { min: 3, max: 20 },
  cfImageSteps: { min: 1, max: 8 },
  claudeTimeoutSec: { min: 30, max: 900 },
  claudeConcurrency: { min: 1, max: 6 },
} as const;

export const VISIBILITIES: Visibility[] = ["public", "neighbor", "both", "private"];

export const VISIBILITY_LABEL: Record<Visibility, string> = {
  public: "전체공개",
  neighbor: "이웃공개",
  both: "서로이웃공개",
  private: "비공개",
};

