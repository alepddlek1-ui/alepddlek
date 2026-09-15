'use strict';
/**
 * lint_draft.js — 초안을 글쓰기 공식에 대조한다 (에디터에 넣기 전 검수용)
 *
 *   node scripts/lint_draft.js drafts/2026-09-15-example.json
 *
 * CLAUDE.md 「4. 글쓰기 공식」의 수치 기준을 눈대중이 아니라 숫자로 확인한다.
 * 경고가 떠도 실행은 막지 않는다 — 판단은 사람이 한다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// data/blogger-profile.md 의 금칙어
const BANNED = ['충격', '발칵', '경악', '소름', '역대급', '대박', '오열', '폭로', '속보', '단독', '최고', '완벽'];
const TITLE_BANNED_CHARS = /[★♥※!?~]/;

const ok = (m) => console.log(`  ✔ ${m}`);
const warn = (m) => console.log(`  ! ${m}`);
const bad = (m) => console.log(`  ✘ ${m}`);

const file = process.argv[2];
if (!file) { console.error('사용법: node scripts/lint_draft.js <초안.json>'); process.exit(1); }
const draft = JSON.parse(fs.readFileSync(path.resolve(ROOT, file), 'utf8'));

const blocks = draft.blocks || [];
const textOf = (b) => (b.type === 'divider' ? '' : String(b.text || ''));
const body = blocks.map(textOf).join('\n');
const bodyNoSpace = body.replace(/\s+/g, '');
let issues = 0;

console.log(`\n초안: ${file}\n`);

/* 제목 */
console.log('[제목]');
const title = String(draft.title || '');
const tlen = title.length;
if (tlen >= 25 && tlen <= 32) ok(`${tlen}자 (기준 25~32자)`);
else { warn(`${tlen}자 — 기준 25~32자를 벗어남`); issues++; }
if (TITLE_BANNED_CHARS.test(title)) { bad('제목에 특수문자가 있습니다'); issues++; }
else ok('특수문자 없음');
const titleBanned = BANNED.filter((w) => title.includes(w));
if (titleBanned.length) { bad(`제목 금칙어: ${titleBanned.join(', ')}`); issues++; }
else ok('제목 금칙어 없음');
const mk = String(draft.mainKeyword || '');
if (mk) {
  const pos = title.indexOf(mk);
  if (pos === 0) ok(`메인 키워드가 제목 맨 앞에 있음`);
  else if (pos > 0 && pos <= 8) ok(`메인 키워드가 제목 앞쪽(${pos}번째 글자)에 있음`);
  else { warn('메인 키워드가 제목 앞쪽에 없습니다'); issues++; }
}

/* 키워드 */
console.log('\n[키워드]');
const countOf = (hay, needle) => (needle ? hay.split(needle).length - 1 : 0);
const exact = countOf(body, mk);                                  // 띄어쓰기까지 동일
const loose = countOf(bodyNoSpace, mk.replace(/\s+/g, ''));        // 공백 무시
if (exact >= 1) ok(`메인 "${mk}" 띄어쓰기까지 동일한 형태: ${exact}회 (최소 1회)`);
else { bad(`메인 "${mk}" 를 검색어와 동일한 형태로 한 번도 안 씀`); issues++; }
if (loose >= 5 && loose <= 7) ok(`메인 키워드 총 등장: ${loose}회 (기준 5~7회)`);
else { warn(`메인 키워드 총 등장: ${loose}회 — 기준 5~7회`); issues++; }

const firstText = blocks.find((b) => b.type === 'text');
const lastText = [...blocks].reverse().find((b) => b.type === 'text');
const inFirst = firstText && firstText.text.replace(/\s+/g, '').includes(mk.replace(/\s+/g, ''));
const inLast = lastText && lastText.text.replace(/\s+/g, '').includes(mk.replace(/\s+/g, ''));
inFirst ? ok('첫 문단에 메인 키워드 있음') : warn('첫 문단에 메인 키워드 없음');
inLast ? ok('마지막 문단에 메인 키워드 있음') : warn('마지막 문단에 메인 키워드 없음');

const subtitles = blocks.filter((b) => b.type === 'subtitle').map((b) => b.text);
(draft.subKeywords || []).forEach((sk) => {
  const hit = subtitles.some((s) => s.replace(/\s+/g, '').includes(sk.replace(/\s+/g, '')));
  hit ? ok(`서브 "${sk}" 소제목에 배치됨`) : warn(`서브 "${sk}" 가 소제목에 없음`);
});

/* 분량 */
console.log('\n[분량]');
const withSpace = body.replace(/\n/g, '').length;
if (withSpace >= 1800 && withSpace <= 3000) ok(`본문 ${withSpace}자 (기준 1,800~2,500 / 정보성 3,000까지)`);
else { warn(`본문 ${withSpace}자 — 기준 1,800~2,500`); issues++; }
console.log(`    공백 제외 ${bodyNoSpace.length}자`);

/* 리듬 */
console.log('\n[리듬 · 가독성]');
const quotes = blocks.filter((b) => b.type === 'quote').length;
if (quotes >= 2 && quotes <= 4) ok(`인용구 ${quotes}개 (기준 2~4개)`);
else { warn(`인용구 ${quotes}개 — 기준 2~4개`); issues++; }
console.log(`    소제목 ${subtitles.length}개 / 구분선 ${blocks.filter((b) => b.type === 'divider').length}개 / 사진 ${blocks.filter((b) => b.type === 'image').length}장`);

// 리듬 파괴 장치(사진/소제목/인용구/구분선) 사이에 텍스트가 얼마나 연속되는가
let run = 0, worst = 0;
for (const b of blocks) {
  if (b.type === 'text') run += textOf(b).replace(/\n/g, '').length;
  else { worst = Math.max(worst, run); run = 0; }
}
worst = Math.max(worst, run);
if (worst <= 400) ok(`장치 없이 이어지는 최대 텍스트: ${worst}자 (기준 300~400자마다 장치)`);
else if (worst < 500) warn(`장치 없이 이어지는 최대 텍스트: ${worst}자 — 400자 초과`);
else { bad(`장치 없이 ${worst}자 연속 — 500자 넘으면 실패작`); issues++; }

const longBlocks = blocks.filter((b) => b.type === 'text' && textOf(b).split('\n').length > 5);
longBlocks.length ? warn(`6줄 넘는 text 블록 ${longBlocks.length}개 (기준 3~5줄)`) : ok('모든 text 블록이 5줄 이하');

/* 금칙어 · 링크 */
console.log('\n[톤 · 규칙]');
const hits = BANNED.filter((w) => body.includes(w));
hits.length ? (bad(`본문 금칙어: ${hits.join(', ')}`), issues++) : ok('본문 금칙어 없음');
const links = body.match(/https?:\/\/\S+/g) || [];
if (links.length <= 1) ok(`외부링크 ${links.length}개 (기준 1개 이하)`);
else { bad(`외부링크 ${links.length}개 — 1개로 줄이세요`); issues++; }

/* 태그 */
console.log('\n[태그]');
const tags = draft.tags || [];
if (tags.length >= 5 && tags.length <= 10) ok(`${tags.length}개 (기준 5~10개)`);
else warn(`${tags.length}개 — 기준 5~10개`);

/* 출처 */
console.log('\n[출처]');
(draft.sources && draft.sources.length)
  ? ok(`${draft.sources.length}건 기재됨`)
  : (bad('sources 가 비어 있습니다 — 스포츠 이슈 글에서는 출처 없이 쓰지 않습니다'), issues++);

console.log(`\n${issues === 0 ? '  검수 통과 — 걸린 항목 없음' : `  확인 필요 ${issues}건 (경고는 판단해서 넘어가도 됩니다)`}\n`);
