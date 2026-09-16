'use strict';
/**
 * fetch_article.js — 기사 링크에서 본문을 뽑아낸다
 *
 *   node scripts/fetch_article.js "https://m.sports.naver.com/..." [출력경로.txt]
 *
 * 로그인된 브라우저(naver-profile)로 실제 페이지를 열어 읽는다.
 * 네이버는 외부 도구의 요청을 막지만, 사용자의 브라우저로 여는 것은 사람이 보는 것과 같다.
 *
 * 추출 실패를 조용히 넘기지 않는다 — 본문이 너무 짧으면 실패로 처리한다.
 * (짧은 본문으로 글을 쓰면 AI 가 나머지를 지어내게 된다. 그게 이 블로그에서 가장 위험하다.)
 */
const fs = require('fs');
const path = require('path');
const B = require('./lib/browser');
const { log } = B;

const MIN_CHARS = 300;   // 이보다 짧으면 추출 실패로 본다

// 알려진 본문 컨테이너부터 시도하고, 없으면 "글자가 가장 많은 덩어리"를 찾는다.
const KNOWN = [
  '#dic_area',                       // news.naver.com
  '#comp_news_article ._article_content',
  '._article_content',
  '#newsEndContents',
  '.newsct_article',
  'div[class*="NewsEndMain_article"]',
  'div[class*="ArticleContent"]',
  'article',
];

async function extract(page) {
  return page.evaluate(({ known }) => {
    const clean = (s) => (s || '')
      .replace(/​/g, '')
      .split('\n').map((l) => l.trim()).filter(Boolean).join('\n');

    const noise = /광고|구독|댓글|기사제보|저작권자|무단 전재|재배포 금지|관련기사|많이 본|추천\s*기사|이시각|핫뉴스/;

    const scoreOf = (el) => {
      if (!el) return 0;
      const t = el.innerText || '';
      return t.length;
    };

    let body = '';
    let how = '';
    for (const sel of known) {
      const el = document.querySelector(sel);
      if (el && scoreOf(el) > 200) { body = clean(el.innerText); how = sel; break; }
    }

    if (!body) {
      // 폴백: 본문처럼 보이는 가장 큰 블록
      const cands = Array.from(document.querySelectorAll('div, section, article'))
        .filter((el) => !el.closest('nav, header, footer, aside'))
        .map((el) => ({ el, len: scoreOf(el), kids: el.querySelectorAll('div,section,article').length }))
        .filter((c) => c.len > 300)
        .sort((a, b) => (a.len === b.len ? a.kids - b.kids : b.len - a.len));
      // 글자 수가 비슷하면 자식이 적은(=더 안쪽) 쪽을 고른다
      const best = cands.find((c, i) => !cands.slice(0, i).some((p) => p.el.contains(c.el) && p.len < c.len * 1.15))
        || cands[0];
      if (best) { body = clean(best.el.innerText); how = '휴리스틱(가장 큰 텍스트 블록)'; }
    }

    // 잡음 줄 제거
    body = body.split('\n').filter((l) => !(l.length < 40 && noise.test(l))).join('\n');

    const meta = (n) => {
      const el = document.querySelector(`meta[property="${n}"], meta[name="${n}"]`);
      return el ? el.getAttribute('content') : '';
    };
    const title = clean(
      meta('og:title') ||
      (document.querySelector('h2, h3, h1') || {}).innerText ||
      document.title
    ).split('\n')[0];

    // 날짜: time 요소 → 본문에서 YYYY.MM.DD 패턴
    let date = '';
    const timeEl = document.querySelector('time, [class*="date"], [class*="time"]');
    if (timeEl) date = clean(timeEl.innerText).split('\n')[0];
    if (!date) {
      const m = document.body.innerText.match(/20\d{2}[.\-/]\s?\d{1,2}[.\-/]\s?\d{1,2}[^\n]{0,20}/);
      if (m) date = m[0].trim();
    }

    const press = meta('og:site_name') || meta('dable:author') || '';

    return { title, body, date, press, how, url: location.href };
  }, { known: KNOWN });
}

async function fetchArticle(url, { headless = true } = {}) {
  const { context, page } = await B.launch({ headless });
  try {
    log.step(`기사를 엽니다: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);

    // 더보기/펼치기 버튼이 있으면 눌러 본문을 전개한다
    for (const sel of ['button:has-text("더보기")', 'button:has-text("본문 더보기")', 'a:has-text("더보기")']) {
      const b = page.locator(sel).first();
      if (await b.isVisible({ timeout: 800 }).catch(() => false)) {
        await b.click().catch(() => {});
        await page.waitForTimeout(800);
        break;
      }
    }

    const r = await extract(page);
    r.chars = r.body.replace(/\s/g, '').length;
    return r;
  } finally {
    await context.close().catch(() => {});
  }
}

module.exports = { fetchArticle, MIN_CHARS };

if (require.main === module) {
  (async () => {
    const url = process.argv[2];
    const out = process.argv[3];
    if (!url) { console.error('사용법: node scripts/fetch_article.js <기사 URL> [출력.txt]'); process.exit(1); }
    const flags = B.parseFlags(process.argv);
    try {
      const r = await fetchArticle(url, { headless: !flags.keepOpen });
      console.log(`\n  제목: ${r.title}`);
      console.log(`  매체: ${r.press || '(확인 안 됨)'}   날짜: ${r.date || '(확인 안 됨)'}`);
      console.log(`  추출 방법: ${r.how}`);
      console.log(`  본문 길이: ${r.chars}자\n`);
      if (r.chars < MIN_CHARS) {
        log.fail(`본문이 너무 짧습니다(${r.chars}자). 추출에 실패한 것으로 보고 중단합니다.`);
        log.info('이 상태로 글을 쓰면 없는 사실을 지어내게 됩니다. 본문을 직접 붙여넣어 주세요.');
        process.exit(2);
      }
      const text = [`# ${r.title}`, `출처: ${r.press}  ${r.date}`, `URL: ${r.url}`, '', r.body].join('\n');
      if (out) {
        fs.writeFileSync(path.resolve(B.ROOT, out), text, 'utf8');
        log.ok(`저장: ${out}`);
      } else {
        console.log(text);
      }
    } catch (e) {
      log.fail(e.message);
      process.exit(1);
    }
  })();
}
