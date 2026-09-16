import { newContext, closeQuietly } from "@/lib/playwright";
import { SEARCH } from "@/lib/scrape/selectors";

export type Source = { type: "news" | "blog"; title: string; summary: string; url: string };

/**
 * ⚠️ 네이버 검색 DOM 은 자주 바뀐다. 셀렉터에 의존하지 말고
 *    page.evaluate 안에서 모든 a[href] 를 훑는 "일반 추출"로 구현한다(6-4).
 */
export async function extract(
  kind: "news" | "blog",
  url: string,
  showBrowser = false,
): Promise<Source[]> {
  let browser = null;
  try {
    const r = await newContext({ headless: !showBrowser, useNaverSession: false });
    browser = r.browser;
    const page = await r.context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(1500);

    const raw = await page.evaluate((kind) => {
      const out: { title: string; summary: string; url: string }[] = [];
      for (const a of Array.from(document.querySelectorAll("a[href]"))) {
        const href = (a as HTMLAnchorElement).href;
        if (!href) continue;

        if (kind === "news") {
          const isNews =
            href.includes("news.naver.com") || href.includes("/news/") || href.includes("n.news");
          if (!isNews) continue;
          // ⚠️ 6-4 — `/news/` 부분일치에 네이버 고객센터가 걸린다(7-1·7-2와 같은 계열).
          //    https://help.naver.com/alias/news/news_21.naver 의 안내문이 AI 자료로 들어간 적이 있다.
          if (href.includes("help.naver.com") || href.includes("/alias/")) continue;
        } else {
          // 블로그는 "게시글" 패턴에 정확히 매칭해 블로그 홈 링크를 걸러낸다.
          if (!/blog\.naver\.com\/[^/]+\/\d{6,}/.test(href)) continue;
        }

        // ⚠️ 6-4 — 스크린리더용 보조 텍스트 `새 창 열림` 을 "먼저" 제거한다.
        //    11자라서 길이 필터를 그냥 통과해 "네이버뉴스새 창 열림" 같은 항목이 남는다.
        const title = (a.textContent || "").replace(/새 ?창 ?열림/g, "").replace(/\s+/g, " ").trim();
        if (title.length < 8) continue;
        if (/광고|로그인|더보기|바로가기|언론사 선정|구독/.test(title)) continue;

        const box = a.closest("li, div");
        const summary = ((box?.textContent || "").replace(/\s+/g, " ").replace(title, "").trim()).slice(0, 260);
        out.push({ title, summary, url: href });
      }
      return out;
    }, kind);

    // ⚠️ 6-4 — 같은 기사가 [제목 링크] + [본문 스니펫 링크] 로 두 번 잡힌다.
    //    URL 당 하나만 남기되 "제목이 더 짧은 쪽"을 고른다(스니펫은 길고 문장형).
    //    두 번 들어가면 AI 프롬프트가 오염된다.
    const byUrl = new Map<string, Source>();
    for (const it of raw) {
      const prev = byUrl.get(it.url);
      if (!prev || it.title.length < prev.title.length) {
        byUrl.set(it.url, { type: kind, ...it });
      }
    }

    // 제목 앞 40자를 키로 중복 제거
    const byTitle = new Map<string, Source>();
    for (const s of byUrl.values()) {
      const key = s.title.slice(0, 40);
      if (!byTitle.has(key)) byTitle.set(key, s);
    }
    return [...byTitle.values()];
  } finally {
    await closeQuietly(browser);
  }
}

export async function collectSources(
  keyword: string,
  topN: number,
  showBrowser = false,
): Promise<Source[]> {
  const [news, blogs] = await Promise.all([
    extract("news", SEARCH.news(keyword), showBrowser).catch(() => [] as Source[]),
    extract("blog", SEARCH.blog(keyword), showBrowser).catch(() => [] as Source[]),
  ]);
  // 뉴스와 블로그를 섞어서 상위 topN
  const merged: Source[] = [];
  const a = [...news];
  const b = [...blogs];
  while (merged.length < topN && (a.length || b.length)) {
    if (a.length) merged.push(a.shift()!);
    if (merged.length < topN && b.length) merged.push(b.shift()!);
  }
  return merged.slice(0, topN);
}

/** 수집 자료를 번호 매긴 텍스트 블록(각 400자)으로 압축한다 */
export function sourcesToPromptBlock(sources: Source[]): string {
  return sources
    .map((s, i) => `[${i + 1}] (${s.type}) ${s.title}\n${(s.summary || "").slice(0, 400)}`)
    .join("\n\n");
}
