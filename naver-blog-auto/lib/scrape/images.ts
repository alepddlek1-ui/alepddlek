import fs from "node:fs";
import path from "node:path";
import { newContext, closeQuietly } from "@/lib/playwright";
import { DIRS, ensureDirs } from "@/lib/paths";
import { SEARCH } from "@/lib/scrape/selectors";
import { judgeCrawled } from "@/lib/ai/vision";
import type { VisionVerdict } from "@/lib/types";

export type Candidate = { url: string; site: "naver" | "google" };
export type Adopted = {
  localPath: string;
  srcUrl: string;
  site: "naver" | "google";
  verdict: VisionVerdict;
};
export type Rejected = { srcUrl: string; site: "naver" | "google"; verdict: VisionVerdict };

/** 후보 이미지 URL 수집. lazy 로딩 유도를 위해 한 번 스크롤한다. */
async function collectCandidates(
  query: string,
  site: "naver" | "google",
  limit: number,
  showBrowser: boolean,
): Promise<Candidate[]> {
  let browser = null;
  try {
    const r = await newContext({ headless: !showBrowser, useNaverSession: false });
    browser = r.browser;
    const page = await r.context.newPage();
    const url = site === "naver" ? SEARCH.image(query) : SEARCH.googleImage(query);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(1200);
    await page.mouse.wheel(0, 2200);
    await page.waitForTimeout(1500);

    const urls = await page.evaluate(() => {
      const out: string[] = [];
      for (const img of Array.from(document.querySelectorAll("img"))) {
        const el = img as HTMLImageElement;
        // 아이콘·스프라이트·로고를 걸러낸다
        if (el.naturalWidth < 120) continue;
        const src = el.currentSrc || el.src;
        if (!src || !/^https?:/.test(src)) continue;
        if (/sprite|logo|icon|blank|\.svg/i.test(src)) continue;
        out.push(src);
      }
      return out;
    });

    const seen = new Set<string>();
    const uniq: Candidate[] = [];
    for (const u of urls) {
      if (seen.has(u)) continue;
      seen.add(u);
      uniq.push({ url: u, site });
      if (uniq.length >= limit) break;
    }
    return uniq;
  } catch {
    return [];
  } finally {
    await closeQuietly(browser);
  }
}

/**
 * 한 자리(query)당: 네이버 이미지 검색 → 실패 시 구글 → 후보를 하나씩 내려받아
 * AI 가 직접 보고 판정 → 첫 통과 이미지를 채택한다(6-6).
 *
 * ⚠️ 채택률은 생각보다 훨씬 낮다. 한 실측에서 네이버 후보 3장이 전부 워터마크로 탈락했다
 *    (네이버페이 배너 / 손글씨 서명 / 브랜드 로고 합성 썸네일).
 *    imageCandidates 를 낮추면 그 자리는 그냥 빈다 — 실사용에서는 10 이상을 권한다.
 */
export async function findImageFor(args: {
  jobId: number;
  query: string;
  title: string;
  caption?: string;
  candidates: number;
  showBrowser: boolean;
  onLog?: (msg: string, level?: "info" | "warn") => void;
}): Promise<{ adopted: Adopted | null; rejected: Rejected[] }> {
  ensureDirs();
  const rejected: Rejected[] = [];

  let cands = await collectCandidates(args.query, "naver", args.candidates, args.showBrowser);
  if (!cands.length) {
    args.onLog?.(`네이버 이미지에서 "${args.query}" 후보를 못 찾아 구글로 넘어갑니다.`, "warn");
    cands = await collectCandidates(args.query, "google", args.candidates, args.showBrowser);
  }
  if (!cands.length) return { adopted: null, rejected };

  let browser = null;
  try {
    const r = await newContext({ headless: true, useNaverSession: false });
    browser = r.browser;
    const ctx = r.context;

    for (const c of cands) {
      let buf: Buffer;
      try {
        const resp = await ctx.request.get(c.url, { timeout: 20_000 });
        if (!resp.ok()) continue;
        buf = Buffer.from(await resp.body());
      } catch {
        continue;
      }
      // 3000바이트 미만은 아이콘/깨진 이미지다.
      if (buf.length < 3000) continue;

      const ext = /\.png(\?|$)/i.test(c.url) ? ".png" : /\.webp(\?|$)/i.test(c.url) ? ".webp" : ".jpg";
      const file = path.join(
        DIRS.images,
        `job${args.jobId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}${ext}`,
      );
      fs.writeFileSync(file, buf);

      const verdict = await judgeCrawled(file, {
        title: args.title,
        caption: args.caption,
        query: args.query,
      });
      if (verdict.fit) {
        return { adopted: { localPath: file, srcUrl: c.url, site: c.site, verdict }, rejected };
      }
      // ⚠️ 탈락한 이미지도 기록한다 — 워터마크·초상권 필터가 실제로 동작하는지
      //    사용자가 확인할 수 있는 유일한 통로다(6-6).
      rejected.push({ srcUrl: c.url, site: c.site, verdict });
      try {
        fs.rmSync(file, { force: true });
      } catch {
        /* 지우기 실패는 무시 */
      }
    }
    return { adopted: null, rejected };
  } finally {
    await closeQuietly(browser);
  }
}
