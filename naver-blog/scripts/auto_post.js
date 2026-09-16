'use strict';
/**
 * auto_post.js — 기사 링크(또는 본문) 하나로 초안 작성부터 네이버 임시저장까지 끝낸다
 *
 *   node scripts/auto_post.js "https://m.sports.naver.com/..."
 *   node scripts/auto_post.js drafts/원문.txt
 *   node scripts/auto_post.js "기사 본문을 그대로 붙여넣어도 됩니다"
 *
 * 플래그
 *   --dry-run   네이버에 넣되 저장 클릭만 생략
 *   --no-save   네이버를 아예 건드리지 않고 초안·카드까지만
 *   --force     하루 발행 한도 무시
 *
 * 순서: 원문 수집 → AI 집필 → 검증 3종 → 카드 생성 → 네이버 임시저장
 * 검증에서 하드 실패가 나면 네이버로 넘어가지 않는다. 발행은 어떤 경우에도 하지 않는다.
 */
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const B = require('./lib/browser');
const { log } = B;
const { verify } = require('./verify_facts');

const ROOT = B.ROOT;
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const DAILY_LIMIT = Number(process.env.NB_DAILY_LIMIT || 2);   // 네이버 약관상 하루 1~2건 권장
const STATE = path.join(ROOT, 'state', 'posted.json');
const MIN_SOURCE = 300;

const stamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
};
const today = () => new Date().toISOString().slice(0, 10);

/* ── 하루 한도 ─────────────────────────────────────────── */
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return {}; }
}
function saveState(s) {
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(s, null, 2), 'utf8');
}
function checkDaily(force) {
  const s = loadState();
  const n = (s[today()] || []).length;
  if (n >= DAILY_LIMIT && !force) {
    throw new Error(
      `오늘 이미 ${n}건 만들었습니다. 브라우저 자동화는 하루 1~2건이 권장됩니다.\n` +
      `   그래도 진행하려면 --force 를 붙이세요.`
    );
  }
  return n;
}
function recordPost(slug) {
  const s = loadState();
  s[today()] = (s[today()] || []).concat([{ slug, at: new Date().toISOString() }]);
  saveState(s);
}

/* ── 1. 원문 수집 ──────────────────────────────────────── */
async function collectSource(input, flags) {
  const isUrl = /^https?:\/\//i.test(input.trim());
  const asPath = path.resolve(ROOT, input);

  if (isUrl) {
    const { fetchArticle } = require('./fetch_article');
    const r = await fetchArticle(input.trim(), { headless: !flags.keepOpen });
    if (r.chars < MIN_SOURCE) {
      throw new Error(
        `기사 본문을 ${r.chars}자밖에 못 읽었습니다. 추출 실패로 보고 중단합니다.\n` +
        `   이대로 쓰면 AI 가 나머지를 지어냅니다. 본문을 직접 붙여넣어 주세요.`
      );
    }
    return {
      text: [`# ${r.title}`, `출처: ${r.press}  ${r.date}`, `URL: ${r.url}`, '', r.body].join('\n'),
      title: r.title, press: r.press, date: r.date, how: `링크 추출(${r.how})`,
    };
  }

  if (fs.existsSync(asPath) && fs.statSync(asPath).isFile()) {
    const text = fs.readFileSync(asPath, 'utf8');
    if (text.replace(/\s/g, '').length < MIN_SOURCE) throw new Error(`원문 파일이 너무 짧습니다: ${input}`);
    return { text, how: `파일(${input})` };
  }

  if (input.replace(/\s/g, '').length >= MIN_SOURCE) {
    return { text: input, how: '직접 입력한 본문' };
  }

  throw new Error(`원문이 너무 짧습니다(${input.replace(/\s/g, '').length}자). 링크·파일 경로·기사 본문 중 하나를 주세요.`);
}

/* ── 2. AI 집필 ────────────────────────────────────────── */
function buildPrompt(sourceText) {
  const read = (p) => { try { return fs.readFileSync(path.join(ROOT, p), 'utf8'); } catch { return ''; } };
  const trends = read('data/trends.md').split('\n').filter((l) => l.startsWith('|')).slice(0, 14).join('\n');
  return read('prompts/write-draft.md')
    .replace('{{BLOGGER}}', read('data/blogger-profile.md').slice(0, 3000))
    .replace('{{AUTHORITY}}', read('data/authority-lines.md').slice(0, 2000))
    .replace('{{TRENDS}}', trends || '(이력 없음)')
    .replace('{{TODAY}}', today())
    .replace('{{ARTICLE}}', sourceText);
}

function extractJson(out) {
  const fenced = out.match(/```json\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : (out.match(/\{[\s\S]*\}/) || [])[0];
  if (!raw) throw new Error('응답에서 JSON 을 찾지 못했습니다');
  return JSON.parse(raw);
}

function runClaude(context, instruction) {
  // CLAUDE_BIN 에 공백이 있으면 "명령 + 앞쪽 인자"로 본다 (테스트에서 node 스크립트를 끼울 때 쓴다)
  const parts = CLAUDE_BIN.trim().split(/\s+/);
  const cmd = parts[0];
  const preArgs = parts.slice(1);
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, [...preArgs, '-p', instruction], {
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => reject(new Error(`claude 실행 실패: ${e.message} (CLAUDE_BIN=${CLAUDE_BIN})`)));
    child.on('close', (code) => {
      if (code !== 0 && !out.trim()) reject(new Error(`claude 종료 코드 ${code}: ${err.slice(0, 500)}`));
      else resolve(out);
    });
    child.stdin.write(context);
    child.stdin.end();
  });
}

function validateShape(parsed) {
  const errs = [];
  const d = parsed && parsed.draft;
  const c = parsed && parsed.cards;
  if (!d) errs.push('draft 가 없습니다');
  if (!c || !Array.isArray(c.cards)) errs.push('cards.cards 배열이 없습니다');
  if (d) {
    if (!d.title) errs.push('draft.title 이 비었습니다');
    if (!Array.isArray(d.blocks) || !d.blocks.length) errs.push('draft.blocks 가 비었습니다');
    if (!Array.isArray(d.sources) || !d.sources.length) errs.push('draft.sources 가 비었습니다');
    const VALID = new Set(['text', 'subtitle', 'image', 'quote', 'divider']);
    (d.blocks || []).forEach((b, i) => {
      if (!VALID.has(b.type)) errs.push(`blocks[${i}].type 이 올바르지 않습니다: ${b.type}`);
      if (b.type === 'image' && !b.card) errs.push(`blocks[${i}] 이미지에 card 이름이 없습니다`);
    });
    const names = new Set((c && c.cards || []).map((x) => x.name));
    (d.blocks || []).forEach((b, i) => {
      if (b.type === 'image' && b.card && !names.has(b.card)) {
        errs.push(`blocks[${i}] 의 card "${b.card}" 가 cards 에 없습니다`);
      }
    });
  }
  return errs;
}

async function writeDraft(sourceText) {
  const base = buildPrompt(sourceText);
  let feedback = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    log.step(`AI 집필 (${attempt}/3)`);
    const instruction = feedback
      ? `stdin 의 지시를 따라 다시 작성하십시오. 직전 출력에 다음 문제가 있었습니다:\n${feedback}\n반드시 \`\`\`json 코드블록 하나만 출력하십시오.`
      : 'stdin 의 지시를 그대로 따라 JSON 을 작성하십시오. 설명 없이 ```json 코드블록 하나만 출력하십시오.';
    let parsed;
    try {
      const out = await runClaude(base, instruction);
      parsed = extractJson(out);
    } catch (e) {
      feedback = e.message;
      log.warn(`실패: ${e.message}`);
      continue;
    }
    const errs = validateShape(parsed);
    if (!errs.length) return parsed;
    feedback = errs.join('\n');
    log.warn(`형식 오류 ${errs.length}건 → 다시 요청합니다`);
    errs.slice(0, 5).forEach((e) => log.info(`- ${e}`));
  }
  throw new Error('AI 집필이 3회 모두 형식 검증을 통과하지 못했습니다.');
}

/* ── 3. 하위 스크립트 실행 ─────────────────────────────── */
function runNode(args, { inherit = true } = {}) {
  const r = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: inherit ? ['ignore', 'pipe', 'pipe'] : 'pipe',
    maxBuffer: 20 * 1024 * 1024,
  });
  const out = (r.stdout || '') + (r.stderr || '');
  if (inherit) process.stdout.write(out);
  return { code: r.status, out };
}

/* ── 메인 ──────────────────────────────────────────────── */
(async () => {
  const flags = B.parseFlags(process.argv);
  const input = flags._.join(' ').trim();
  if (!input) {
    console.error('사용법: node scripts/auto_post.js "<기사 URL | 원문파일 | 기사 본문>" [--dry-run] [--no-save] [--force]');
    process.exit(1);
  }

  const S = stamp();
  const logLines = [];
  const say = (s) => { logLines.push(s); console.log(s); };
  const origLog = console.log;
  console.log = (...a) => { logLines.push(a.join(' ')); origLog(...a); };

  let slug = S;
  let result = { ok: false, msg: '' };
  try {
    console.log(`\n  auto_post  ${S}\n`);
    const already = checkDaily(flags._.includes('--force') || process.argv.includes('--force'));
    log.info(`오늘 만든 글: ${already}건 (한도 ${DAILY_LIMIT}건)`);

    /* 1) 원문 */
    const src = await collectSource(input, flags);
    const srcPath = path.join(ROOT, 'drafts', `source-${S}.txt`);
    fs.writeFileSync(srcPath, src.text, 'utf8');
    log.ok(`원문 확보 (${src.how}) — ${src.text.replace(/\s/g, '').length}자 → drafts/source-${S}.txt`);

    /* 2) 집필 */
    const parsed = await writeDraft(src.text);
    const draft = parsed.draft;
    const cards = parsed.cards;
    log.ok(`초안 작성됨: "${draft.title}" (블록 ${draft.blocks.length}개, 카드 ${cards.cards.length}장)`);

    /* 3) 카드 생성 — 이름을 이번 글 전용으로 바꿔 사진 재사용을 막는다 */
    cards.cards.forEach((c, i) => { c.name = `${S}-${String(c.name || 'card').replace(/[^a-z0-9-]/gi, '')}`; });
    const cardsPath = path.join(ROOT, 'drafts', `cards-${S}.json`);
    fs.writeFileSync(cardsPath, JSON.stringify(cards, null, 2), 'utf8');
    const mk = runNode([path.join('scripts', 'make_cards.js'), path.relative(ROOT, cardsPath)]);
    if (mk.code !== 0) throw new Error('카드 이미지 생성에 실패했습니다.');

    const cardPath = {};
    cards.cards.forEach((c, i) => {
      cardPath[c.name] = `input/photos/_cards/${String(i + 1).padStart(2, '0')}-${c.name}.png`;
    });

    /* 4) 이미지 블록에 실제 경로를 넣는다 (AI 가 경로를 만들지 않게 한 이유) */
    const dropped = [];
    draft.blocks = draft.blocks.filter((b) => {
      if (b.type !== 'image') return true;
      const key = `${S}-${String(b.card || '').replace(/[^a-z0-9-]/gi, '')}`;
      const p = cardPath[key];
      if (!p || !fs.existsSync(path.join(ROOT, p))) { dropped.push(b.card); return false; }
      b.path = p;
      delete b.card;
      return true;
    });
    if (dropped.length) log.warn(`카드를 찾지 못해 뺀 이미지 블록: ${dropped.join(', ')}`);

    const draftPath = path.join(ROOT, 'drafts', `${S}.json`);
    fs.writeFileSync(draftPath, JSON.stringify(draft, null, 2), 'utf8');
    slug = S;

    /* 5) 검증 */
    const srcChars = src.text.replace(/\s/g, '').length;
    const draftChars = draft.blocks.filter((b) => b.type !== 'divider' && b.type !== 'image')
      .map((b) => String(b.text || '')).join('').replace(/\s/g, '').length;
    if (draftChars < 1400 && srcChars < 1200) {
      log.info(`원문이 ${srcChars}자라 글도 ${draftChars}자로 짧습니다. 없는 내용을 채우지 않은 결과입니다.`);
      log.info('분량을 늘리려면 같은 사안의 기사를 한 건 더 넣어 주세요.');
    }

    log.step('검증 1/2 — 글쓰기 공식 대조');
    runNode([path.join('scripts', 'lint_draft.js'), path.relative(ROOT, draftPath)]);

    log.step('검증 2/2 — 사실 대조 (원문에 없는 내용 색출)');
    const v = verify(draft, src.text);
    v.warn.forEach((w) => log.warn(w));
    if (!v.ok) {
      v.hard.forEach((h) => log.fail(h));
      throw new Error('사실 대조에서 하드 실패가 나왔습니다. 네이버로 보내지 않습니다.');
    }
    log.ok('사실 대조 통과 (인용구·출처·금칙어·링크)');

    /* 6) 네이버 */
    if (flags._.includes('--no-save') || process.argv.includes('--no-save')) {
      log.warn('--no-save: 네이버는 건드리지 않았습니다.');
    } else {
      log.step('네이버 임시저장');
      const args = [path.join('scripts', 'naver_draft.js'), path.relative(ROOT, draftPath)];
      if (flags.dryRun) args.push('--dry-run');
      if (flags.headless) args.push('--headless');
      if (flags.keepOpen) args.push('--keep-open');
      const nd = runNode(args);

      // 하위 스크립트의 실패를 성공으로 넘기지 않는다
      const saved = /임시저장\s+임시저장 클릭 완료/.test(nd.out);
      const matched = /전문대조\s+✔/.test(nd.out);
      if (nd.code === 0 && (saved || flags.dryRun) && matched) {
        result = { ok: true, msg: flags.dryRun ? '에디터 입력까지 성공 (--dry-run 이라 저장은 생략)' : '임시저장까지 성공' };
        recordPost(slug);
      } else {
        const why = [];
        if (nd.code !== 0) why.push(`naver_draft 종료 코드 ${nd.code}`);
        if (!saved && !flags.dryRun) why.push('임시저장이 확인되지 않음');
        if (!matched) why.push('전문 대조 불일치');
        result = { ok: false, msg: why.join(' / ') };
      }
    }

    /* 7) 한 줄 판정 */
    console.log('\n' + '='.repeat(60));
    if (result.ok) {
      console.log(`  ✅ 완료 — ${result.msg}`);
      console.log('     네이버 블로그 "저장 글"에서 어투를 손질한 뒤 직접 발행하세요.');
    } else if (result.msg) {
      console.log(`  ❌ 네이버 단계 실패 — ${result.msg}`);
      console.log(`     초안은 남아 있습니다: drafts/${S}.json`);
      console.log(`     다시 시도: node scripts\\naver_draft.js drafts\\${S}.json`);
      process.exitCode = 1;
    } else {
      console.log('  ⏸  초안까지만 만들었습니다 (--no-save)');
    }
    console.log(`     초안 drafts/${S}.json   원문 drafts/source-${S}.txt`);
    console.log('='.repeat(60) + '\n');
  } catch (e) {
    log.fail(e.message);
    process.exitCode = 1;
  } finally {
    console.log = origLog;
    try {
      fs.writeFileSync(path.join(ROOT, 'drafts', `auto-${S}.log.txt`), logLines.join('\n') + '\n', 'utf8');
      console.log(`  실행 기록: drafts/auto-${S}.log.txt`);
    } catch { /* 무시 */ }
  }
})();
