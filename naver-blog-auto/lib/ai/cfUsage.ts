import { CONFIG } from "@/config";
import { getDb } from "@/lib/db";
import { neuronsPerImage, FREE_NEURONS_PER_DAY } from "@/lib/ai/neurons";
import { cfConfigured } from "@/lib/ai/imagegen";

export type Usage = {
  neurons: number;
  limit: number;
  /** 실측(Cloudflare 조회)인지 자체 로그 기반 추정인지 */
  measured: boolean;
  note: string;
};

/**
 * 실측 조회에는 API 토큰에 `Account Analytics: Read` 권한이 필요하다(7-12).
 * ⚠️ 권한이 없으면 401 이 아니라 "not authorized" GraphQL 에러로 온다.
 *    그때는 자체 생성 로그로 추정치를 계산하고 화면에 "추정치"라고 표시한다.
 *    (토큰 권한을 나중에 추가할 땐 대시보드에서 Edit — Roll 은 키를 재발급해 .env.local 이 무효가 된다)
 */
async function fetchMeasured(): Promise<number | null> {
  if (!cfConfigured()) return null;
  const today = new Date().toISOString().slice(0, 10);
  const query = `
    query Usage($accountTag: string!, $date: string!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          aiInferenceAdaptiveGroups(limit: 100, filter: { date: $date }) {
            sum { totalNeurons }
          }
        }
      }
    }`;
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 15_000);
    const resp = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CONFIG.cfApiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        variables: { accountTag: CONFIG.cfAccountId, date: today },
      }),
      signal: ac.signal,
    });
    clearTimeout(t);
    const j = (await resp.json()) as {
      errors?: { message: string }[];
      data?: {
        viewer?: {
          accounts?: { aiInferenceAdaptiveGroups?: { sum?: { totalNeurons?: number } }[] }[];
        };
      };
    };
    if (j.errors?.length) return null; // "not authorized" 포함 — 추정으로 넘어간다
    const groups = j.data?.viewer?.accounts?.[0]?.aiInferenceAdaptiveGroups ?? [];
    const total = groups.reduce((a, g) => a + (g.sum?.totalNeurons ?? 0), 0);
    return total;
  } catch {
    return null;
  }
}

/** 자체 생성 로그로 추정. 오늘(로컬 날짜) 생성한 이미지 수 × 스텝 단가 → 7-22 */
function estimate(steps: number): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM images
        WHERE source_site = 'ai'
          AND date(created_at, 'localtime') = date('now', 'localtime')`,
    )
    .get() as { n: number };
  return (row?.n ?? 0) * neuronsPerImage(steps);
}

export async function getUsage(steps: number): Promise<Usage> {
  const measured = await fetchMeasured();
  if (measured !== null) {
    return { neurons: measured, limit: FREE_NEURONS_PER_DAY, measured: true, note: "실측" };
  }
  return {
    neurons: estimate(steps),
    limit: FREE_NEURONS_PER_DAY,
    measured: false,
    note: cfConfigured()
      ? "추정치 — 실측을 보려면 토큰에 Account Analytics: Read 권한이 필요합니다"
      : "추정치 — Cloudflare 열쇠가 없습니다",
  };
}
