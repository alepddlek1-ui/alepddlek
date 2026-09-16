'use strict';
/**
 * verify_facts.js — 초안의 사실이 원문에 실제로 있는지 대조한다
 *
 *   node scripts/verify_facts.js drafts/초안.json drafts/source-xxx.txt [추가출처.txt ...]
 *
 * 자동화에서 가장 위험한 것은 "AI 가 그럴듯하게 지어낸 문장"이다.
 * 사람이 검수하지 않고 네이버로 넘어가기 전에, 기계적으로 걸러낸다.
 *
 * 하드 실패(= 네이버로 보내지 않는다)
 *   1. 인용구가 원문에 없다            ← 가짜 발언은 명예훼손이 된다
 *   2. sources 가 비어 있다
 *   3. 제목에 금칙어가 있다
 *   4. "내돈내산" 같은 거짓 부인 표현   ← 공정위 위반
 *   5. 외부링크가 2개 이상
 *
 * 경고(= 진행하되 기록에 남긴다)
 *   6. 원문에 없는 숫자
 *   7. 원문에 없는 인물(OOO 감독/해설위원/기자/선수)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BANNED_TITLE = ['충격', '발칵', '경악', '소름', '역대급', '대박', '오열', '폭로', '속보', '단독'];
const FALSE_DENIAL = ['내돈내산', '광고 아님', '대가 없이'];

const squash = (s) => String(s || '').replace(/\s+/g, '');
const stripQuotes = (s) => squash(s).replace(/["'“”‘’]/g, '');

function draftText(draft) {
  return (draft.blocks || [])
    .filter((b) => b.type !== 'divider' && b.type !== 'image')
    .map((b) => String(b.text || ''))
    .join('\n');
}

function verify(draft, sourceText) {
  const src = stripQuotes(sourceText);
  const srcNums = new Set((String(sourceText).match(/\d+/g) || []));
  const body = draftText(draft);
  const hard = [];
  const warn = [];

  // 1. 인용구는 원문에 있어야 한다
  for (const b of draft.blocks || []) {
    if (b.type !== 'quote') continue;
    const q = stripQuotes(b.text);
    if (!q) continue;
    if (src.includes(q)) continue;
    // 원문이 인용문을 줄여 쓴 경우를 감안해 12자 이상 겹치면 통과
    let overlapped = false;
    for (let len = q.length; len >= 12 && !overlapped; len--) {
      for (let i = 0; i + len <= q.length; i++) {
        if (src.includes(q.slice(i, i + len))) { overlapped = true; break; }
      }
    }
    if (!overlapped) hard.push(`인용구가 원문에 없습니다: "${b.text.slice(0, 40)}"`);
  }

  // 2. 출처
  if (!Array.isArray(draft.sources) || draft.sources.length === 0) {
    hard.push('sources 가 비어 있습니다 (출처 없는 글은 내보내지 않습니다)');
  }

  // 3. 제목 금칙어
  const tHit = BANNED_TITLE.filter((w) => String(draft.title || '').includes(w));
  if (tHit.length) hard.push(`제목 금칙어: ${tHit.join(', ')}`);

  // 4. 거짓 부인 표현
  const fHit = FALSE_DENIAL.filter((w) => body.includes(w));
  if (fHit.length) hard.push(`거짓 부인 표현: ${fHit.join(', ')}`);

  // 5. 외부링크
  const links = body.match(/https?:\/\/\S+/g) || [];
  if (links.length > 1) hard.push(`외부링크가 ${links.length}개입니다 (1개까지)`);

  // 6. 숫자
  const missingNums = [...new Set((body.match(/\d+/g) || []))].filter((n) => !srcNums.has(n));
  missingNums.forEach((n) => warn.push(`원문에 없는 숫자: ${n}`));

  // 7. 인물
  const people = new Set();
  const re = /([가-힣]{2,4})\s?(감독|해설위원|기자|선수|위원장)/g;
  let m;
  while ((m = re.exec(body))) people.add(m[1]);
  [...people].filter((p) => !src.includes(p)).forEach((p) => warn.push(`원문에 없는 인물: ${p}`));

  return { hard, warn, ok: hard.length === 0 };
}

module.exports = { verify };

if (require.main === module) {
  const [draftPath, ...sourcePaths] = process.argv.slice(2);
  if (!draftPath || !sourcePaths.length) {
    console.error('사용법: node scripts/verify_facts.js <초안.json> <원문.txt> [추가원문.txt ...]');
    process.exit(1);
  }
  const draft = JSON.parse(fs.readFileSync(path.resolve(ROOT, draftPath), 'utf8'));
  const source = sourcePaths.map((p) => fs.readFileSync(path.resolve(ROOT, p), 'utf8')).join('\n');
  const r = verify(draft, source);

  console.log('\n[사실 대조]');
  if (r.hard.length === 0) console.log('  ✔ 하드 검증 통과 (인용구·출처·금칙어·링크)');
  r.hard.forEach((h) => console.log(`  ✘ ${h}`));
  if (r.warn.length === 0) console.log('  ✔ 경고 없음');
  r.warn.forEach((w) => console.log(`  ! ${w}`));
  console.log('');
  process.exit(r.ok ? 0 : 3);
}
