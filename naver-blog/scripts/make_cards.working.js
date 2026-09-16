'use strict';
/**
 * make_cards.js — 글에 넣을 정리 이미지(카드)를 만든다
 *
 *   node scripts/make_cards.js drafts/cards-example.json
 *
 * 남의 사진을 쓸 수 없는 소재(스포츠 이슈 등)에서 사진 자리를 메우는 용도.
 * 직접 생성한 이미지라 저작권 문제가 없다.
 *
 * 렌더링은 Chromium(Playwright)으로 한다 — 한글 폰트와 줄바꿈을 브라우저가 처리해 주기 때문에
 * 이미지 라이브러리로 글자를 그리는 것보다 결과가 안정적이다.
 *
 * 결과: input/photos/_cards/NN-이름.png   (초안 JSON 에 이 경로를 쓰면 된다)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'input', 'photos', '_cards');

const FONT = `'Pretendard','Malgun Gothic','맑은 고딕','Apple SD Gothic Neo','NanumGothic','Noto Sans KR',sans-serif`;

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* ── 카드 종류별 HTML ─────────────────────────────────── */
function renderCard(c) {
  switch (c.type) {
    case 'score':
      return `
        <div class="kicker">${esc(c.tournament || '')}</div>
        <div class="score">
          <div class="team">
            <div class="tname">${esc(c.home && c.home.name)}</div>
            <div class="tnum win">${esc(c.home && c.home.score)}</div>
          </div>
          <div class="vs">:</div>
          <div class="team">
            <div class="tname">${esc(c.away && c.away.name)}</div>
            <div class="tnum">${esc(c.away && c.away.score)}</div>
          </div>
        </div>
        <div class="meta">${(c.meta || []).map((m) => `<span>${esc(m)}</span>`).join('')}</div>`;

    case 'timeline':
      return `
        <div class="title">${esc(c.title || '')}</div>
        <ul class="tl">
          ${(c.items || []).map((it) => `
            <li>
              <span class="k">${esc(it.k)}</span>
              <span class="v">${esc(it.v)}</span>
            </li>`).join('')}
        </ul>
        ${c.foot ? `<div class="foot">${esc(c.foot)}</div>` : ''}`;

    case 'list':
      return `
        <div class="title">${esc(c.title || '')}</div>
        <ul class="ls">
          ${(c.items || []).map((it) => `<li>${esc(it)}</li>`).join('')}
        </ul>
        ${c.foot ? `<div class="foot">${esc(c.foot)}</div>` : ''}`;

    case 'quote':
      return `
        <div class="qmark">"</div>
        <div class="quote">${esc(c.text || '')}</div>
        <div class="by">${esc(c.by || '')}</div>`;

    default:
      throw new Error(`알 수 없는 카드 type: ${c.type}`);
  }
}

function buildHtml(cards, size) {
  const W = 1080;
  const H = size === 'tall' ? 1350 : 1080;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { background:#fff; font-family:${FONT}; -webkit-font-smoothing:antialiased; }
    .card {
      width:${W}px; height:${H}px; padding:96px 88px;
      display:flex; flex-direction:column; justify-content:center;
      background:#10151f; color:#f2f5f8; position:relative; overflow:hidden;
    }
    .card::after {
      content:''; position:absolute; left:88px; bottom:64px;
      width:92px; height:6px; background:#3d8bfd; border-radius:3px;
    }
    .kicker { font-size:34px; line-height:1.45; color:#8fa3bd; font-weight:600; margin-bottom:56px; word-break:keep-all; }
    .title  { font-size:62px; line-height:1.3; font-weight:800; margin-bottom:56px; word-break:keep-all; }

    .score { display:flex; align-items:center; justify-content:center; gap:56px; margin:16px 0 64px; }
    .team  { text-align:center; }
    .tname { font-size:48px; font-weight:700; color:#c8d4e3; margin-bottom:20px; }
    .tnum  { font-size:200px; font-weight:800; line-height:1; color:#5c6c82; }
    .tnum.win { color:#fff; }
    .vs    { font-size:96px; font-weight:800; color:#46536a; padding-bottom:28px; }
    .meta  { display:flex; flex-direction:column; gap:14px; font-size:34px; color:#8fa3bd; }

    .tl { list-style:none; display:flex; flex-direction:column; gap:30px; }
    .tl li { display:flex; gap:32px; align-items:flex-start; font-size:40px; line-height:1.45; }
    .tl .k { flex:0 0 220px; color:#3d8bfd; font-weight:800; }
    .tl .v { flex:1; color:#e8eef6; word-break:keep-all; }

    .ls { list-style:none; display:flex; flex-direction:column; gap:28px; }
    .ls li { font-size:40px; line-height:1.5; color:#e8eef6; padding-left:52px; position:relative; word-break:keep-all; }
    .ls li::before { content:'✔'; position:absolute; left:0; color:#3d8bfd; font-weight:800; }

    .qmark { font-size:120px; font-weight:800; color:#3d8bfd; line-height:0.8; margin-bottom:24px; }
    .quote { font-size:62px; font-weight:700; line-height:1.45; word-break:keep-all; }
    .by    { margin-top:44px; font-size:34px; color:#8fa3bd; }

    .foot  { margin-top:52px; font-size:30px; color:#7b8ca5; word-break:keep-all; }
  </style></head><body>
  ${cards.map((c) => `<div class="card">${renderCard(c)}</div>`).join('')}
  </body></html>`;
}

(async () => {
  const specFile = process.argv[2];
  if (!specFile) { console.error('사용법: node scripts/make_cards.js <cards.json>'); process.exit(1); }
  const specPath = path.resolve(ROOT, specFile);
  if (!fs.existsSync(specPath)) { console.error(`spec 파일이 없습니다: ${specPath}`); process.exit(1); }

  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  const cards = spec.cards || [];
  if (!cards.length) { console.error('spec.cards 가 비어 있습니다.'); process.exit(1); }

  const { chromium } = require('playwright');
  const launchOpts = { headless: true };
  if (process.env.CHROMIUM_PATH) launchOpts.executablePath = process.env.CHROMIUM_PATH;
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });

  await page.setContent(buildHtml(cards, spec.size), { waitUntil: 'load' });
  await page.waitForTimeout(400); // 폰트 적용 대기

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const made = [];
  for (let i = 0; i < cards.length; i++) {
    const name = cards[i].name || `card-${i + 1}`;
    const file = path.join(OUT_DIR, `${String(i + 1).padStart(2, '0')}-${name}.png`);
    await page.locator('.card').nth(i).screenshot({ path: file });
    made.push(path.relative(ROOT, file).replace(/\\/g, '/'));
    console.log(`  ✔ ${path.relative(ROOT, file)}`);
  }
  await browser.close();

  console.log('\n' + '─'.repeat(56));
  console.log(`  ${made.length}장 생성  (1080 x ${spec.size === 'tall' ? 1350 : 1080})`);
  console.log('  ❗생성된 이미지를 Read 로 열어 글자가 깨지지 않았는지 확인하세요.');
  console.log('  초안 JSON 의 image 블록에 아래 경로를 쓰면 됩니다:');
  made.forEach((m) => console.log(`    "${m}"`));
  console.log('─'.repeat(56) + '\n');
})();
