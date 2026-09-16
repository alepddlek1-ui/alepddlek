'use strict';
/**
 * naver_draft.js — 초안 JSON → 네이버 스마트에디터 자동 입력 → 임시저장 → 검증
 *
 *   node scripts/naver_draft.js drafts/2026-09-15-sample.json --dry-run
 *   node scripts/naver_draft.js drafts/2026-09-15-sample.json
 *
 * 플래그: --dry-run(저장 클릭만 생략) --headless(비권장) --keep-open(끝나도 브라우저 유지)
 *
 * 절대 규칙 2: 발행 금지. 발행 차단 가드는 어떤 경우에도 제거하지 않는다.
 */
const fs = require('fs');
const path = require('path');
const B = require('./lib/browser');
const { log } = B;

/* ══ 실행 로그를 파일로도 남긴다 (사용자가 캡처 없이 파일만 보내면 되게) ══ */
const LOG_LINES = [];
for (const m of ['log', 'warn', 'error']) {
  const orig = console[m].bind(console);
  console[m] = (...args) => {
    LOG_LINES.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
    orig(...args);
  };
}

const BUILD = '2026-09-16.1';   // 로그만 보고도 어느 버전이 돌았는지 알 수 있게 한다

/* ══ 자동 처리 결과 집계 ══════════════════════════════════ */
const RESULT = {
  photos: { total: 0, ok: 0, fail: [] },
  captions: { total: 0, ok: 0, fail: [] },
  subtitles: { total: 0, ok: 0, fail: [] },
  quotes: { total: 0, ok: 0, fail: [] },
  dividers: { total: 0, ok: 0, fail: [] },
  tags: { total: 0, ok: 0, note: '' },
  place: { requested: false, ok: false, note: '해당 없음' },
  video: { requested: false, ok: false, note: '해당 없음' },
  title: { ok: false, note: '' },
  save: { ok: false, note: '' },
  verify: { ok: false, missing: [] },
};

/* ══ 초안 로드 · 검증 ════════════════════════════════════ */
function loadDraft(file) {
  const abs = path.resolve(B.ROOT, file);
  if (!fs.existsSync(abs)) throw new Error(`초안 파일이 없습니다: ${abs}`);
  const draft = JSON.parse(fs.readFileSync(abs, 'utf8'));

  if (!draft.title || !String(draft.title).trim()) throw new Error('title 이 비어 있습니다.');
  if (!Array.isArray(draft.blocks) || draft.blocks.length === 0) throw new Error('blocks 가 비어 있습니다.');

  const VALID = new Set(['text', 'subtitle', 'image', 'quote', 'divider']);
  draft.blocks.forEach((b, i) => {
    if (!VALID.has(b.type)) throw new Error(`blocks[${i}].type 이 올바르지 않습니다: ${b.type}`);
    if (b.type !== 'divider' && b.type !== 'image' && !String(b.text || '').trim())
      throw new Error(`blocks[${i}] (${b.type}) 의 text 가 비어 있습니다.`);
    if (b.type === 'image') {
      if (!b.path) throw new Error(`blocks[${i}] (image) 의 path 가 없습니다.`);
      const p = path.resolve(B.ROOT, b.path);
      if (!fs.existsSync(p)) throw new Error(`사진 파일이 없습니다: ${p}`);
      b._abs = p;
    }
  });

  if (draft.video && draft.video.path) {
    const vp = path.resolve(B.ROOT, draft.video.path);
    if (!fs.existsSync(vp)) throw new Error(`동영상 파일이 없습니다: ${vp}`);
    draft.video._abs = vp;
    let t = String(draft.video.title || draft.title || '동영상').trim();
    if (t.length > 40) t = t.slice(0, 40); // 제목 40자 제한
    draft.video._title = t;
  }

  if (Array.isArray(draft.tags)) {
    draft.tags = draft.tags
      .map((t) => String(t).trim().replace(/^#+/, '')) // 입력 전 앞의 # 제거
      .filter(Boolean)
      .slice(0, 30); // 최대 30개
  } else {
    draft.tags = [];
  }

  draft._file = abs;
  draft._base = abs.replace(/\.json$/i, '');
  return draft;
}

/* ══ 한글/이모지 입력 ════════════════════════════════════ */
// 한글은 반드시 insertText(). type()은 IME 조합이 꼬여 오탈자가 난다.
// 이모지는 반드시 별도 호출로 분리한다(함께 넣으면 이모지 뒤 텍스트가 유실된다).
function splitRuns(s) {
  const runs = [];
  const isPict = (ch) => /\p{Extended_Pictographic}/u.test(ch);
  const isJoin = (ch) => ch === '‍' || ch === '️' || ch === '︎' || /\p{Emoji_Modifier}/u.test(ch);
  let buf = '';
  for (const ch of s) {
    const prev = runs.length ? runs[runs.length - 1] : null;
    const openSeq = !buf && prev && prev.kind === 'emoji' && prev.v.endsWith('\u200D');
    if (isPict(ch)) {
      // ZWJ 로 이어지는 조합 이모지(👨‍👩‍👧)는 쪼개지 않고 한 run 으로 묶는다
      if (openSeq) { prev.v += ch; continue; }
      if (buf) { runs.push({ kind: 'text', v: buf }); buf = ''; }
      runs.push({ kind: 'emoji', v: ch });
    } else if (isJoin(ch) && !buf && prev && prev.kind === 'emoji') {
      prev.v += ch;
    } else {
      buf += ch;
    }
  }
  if (buf) runs.push({ kind: 'text', v: buf });
  return runs;
}

async function insertText(page, s) {
  for (const run of splitRuns(s)) {
    await page.keyboard.insertText(run.v);
    await page.waitForTimeout(run.kind === 'emoji' ? 120 : 40);
  }
}

/* ══ 캐럿 이동 ═══════════════════════════════════════════ */
const BODY_PARA = '.se-section-text p.se-text-paragraph'; // 절대 범위를 넓히지 말 것(제목 오염)

async function focusEnd(frame, page) {
  const paras = frame.locator(BODY_PARA);
  const n = await paras.count();
  if (n > 0) await paras.nth(n - 1).click();
  await page.keyboard.press('Control+End');

  // Control+End 가 사진 캡션 안으로 들어가는 경우가 있다 → 마지막 본문 문단으로 되돌린다
  const inCaption = await frame.evaluate(() => {
    const sel = document.getSelection();
    if (!sel || !sel.anchorNode) return false;
    const el = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
    return !!(el && el.closest && (el.closest('.se-caption') || el.closest('.se-documentTitle')));
  }).catch(() => false);

  if (inCaption && n > 0) {
    await paras.nth(n - 1).click();
    await page.keyboard.press('End');
    log.info('캐럿이 캡션/제목으로 들어가 마지막 본문 문단으로 되돌렸습니다.');
  }
}

/* ══ 툴바 버튼 찾기 ══════════════════════════════════════ */
// 네이버가 클래스명을 바꿔도 라벨/텍스트로 찾아낼 수 있게 여러 경로를 둔다.
async function findToolbarButton(frame, { classes = [], labels = [] }) {
  for (const c of classes) {
    const loc = frame.locator(`button.${c}, .${c}`).first();
    if (await loc.isVisible({ timeout: 1500 }).catch(() => false)) return { loc, how: `class .${c}` };
  }
  for (const l of labels) {
    for (const sel of [`button[aria-label*="${l}"]`, `button[title*="${l}"]`, `button:has-text("${l}")`]) {
      const loc = frame.locator(sel).first();
      if (await loc.isVisible({ timeout: 800 }).catch(() => false)) return { loc, how: sel };
    }
  }
  return null;
}

/* ══ 툴바 클릭(후보 셀렉터 순차 시도) ════════════════════ */
async function clickFirst(frame, selectors, { timeout = 4000 } = {}) {
  for (const sel of selectors) {
    const loc = frame.locator(sel).first();
    if (await loc.isVisible({ timeout }).catch(() => false)) {
      await loc.click();
      return sel;
    }
  }
  return null;
}

/* ══ 문단 서식 · 글자 크기 ═══════════════════════════════ */
// 소제목은 볼드 토글로 하지 않는다(선택 영역이 안 잡혀 실패).
// 문단 서식 드롭다운을 쓰면 캐럿만 놓여도 문단 전체에 적용된다.
const FORMAT_BTN = ['button.se-text-format-toolbar-button', '.se-text-format-toolbar-button'];
const FONTSIZE_BTN = ['button.se-font-size-code-toolbar-button', '.se-font-size-code-toolbar-button'];

// 클래스가 바뀌어도 라벨로 찾아낸다. 한 번 찾으면 재사용한다.
const _btnCache = {};
async function getFormatBtn(frame) {
  if (_btnCache.fmt) return _btnCache.fmt;
  _btnCache.fmt = await findToolbarButton(frame, {
    classes: ['se-text-format-toolbar-button'],
    labels: ['문단 서식', '본문', '서식'],
  });
  return _btnCache.fmt;
}
async function getSizeBtn(frame) {
  if (_btnCache.size) return _btnCache.size;
  _btnCache.size = await findToolbarButton(frame, {
    classes: ['se-font-size-code-toolbar-button'],
    labels: ['글자 크기', '크기'],
  });
  return _btnCache.size;
}

async function pickOptionByText(frame, label) {
  const opts = frame.locator('button:visible, li:visible > button, [role="option"]:visible');
  const n = await opts.count();
  for (let i = 0; i < n; i++) {
    const o = opts.nth(i);
    const t = (await o.innerText().catch(() => '')).replace(/\s+/g, '');
    if (t === label) { await o.click(); return true; }
  }
  return false;
}

async function setParagraphFormat(frame, page, label) {
  const btn = await getFormatBtn(frame);
  if (!btn) return { ok: false, reason: '문단 서식 드롭다운 버튼을 찾지 못함' };
  await btn.loc.click();
  await page.waitForTimeout(300);
  const picked = await pickOptionByText(frame, label);
  await page.waitForTimeout(300);
  if (!picked) {
    await page.keyboard.press('Escape').catch(() => {});
    return { ok: false, reason: `"${label}" 옵션을 찾지 못함` };
  }
  // 드롭다운 라벨을 다시 읽어 적용 여부 검증
  const shown = await btn.loc.innerText().catch(() => '');
  return { ok: true, label: shown.replace(/\s+/g, '') };
}

async function setFontSize(frame, page, code = 'fs19', label = '19') {
  const btn = await getSizeBtn(frame);
  if (!btn) return { ok: false, reason: '글자 크기 드롭다운 버튼을 찾지 못함' };
  await btn.loc.click();
  await page.waitForTimeout(250);
  const direct = frame.locator(`button[data-value="${code}"], .se-toolbar-option-font-size-code-${code}-button`).first();
  if (await direct.isVisible({ timeout: 1500 }).catch(() => false)) {
    await direct.click();
    await page.waitForTimeout(200);
    return { ok: true };
  }
  const picked = await pickOptionByText(frame, label);
  await page.waitForTimeout(200);
  if (!picked) { await page.keyboard.press('Escape').catch(() => {}); return { ok: false, reason: `크기 ${label} 옵션 없음` }; }
  return { ok: true };
}

/* ══ 블록 삽입 ═══════════════════════════════════════════ */
// 소제목 뒤 "본문 복귀"가 한 번이라도 실패하면 그 뒤 문단이 소제목 크기로 남는다.
// 그래서 text 블록마다 서식과 크기를 명시적으로 다시 지정해 글 전체 폰트를 일정하게 유지한다.
async function ensureBodyFormat(frame, page, fontSize) {
  const fb = await getFormatBtn(frame);
  const cur = fb ? await fb.loc.innerText().catch(() => '') : '';
  if (cur.replace(/\s+/g, '') !== '본문') {
    const r = await setParagraphFormat(frame, page, '본문');
    if (!r.ok) log.warn(`본문 서식 복귀 실패: ${r.reason}`);
  }
  if (fontSize) await setFontSize(frame, page, `fs${fontSize}`, String(fontSize));
}

async function insertTextBlock(frame, page, text, addTrailingEnter, fontSize) {
  await focusEnd(frame, page);
  await ensureBodyFormat(frame, page, fontSize);
  const lines = String(text).split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim()) await insertText(page, lines[i]);
    if (i < lines.length - 1) await page.keyboard.press('Enter');
  }
  // 다음 블록도 text 일 때만 빈 줄을 하나 더 준다(사진·소제목·인용구 앞은 에디터가 자체 여백을 준다)
  if (addTrailingEnter) await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
}

async function insertSubtitle(frame, page, text) {
  RESULT.subtitles.total++;
  await focusEnd(frame, page);
  await page.keyboard.press('Enter');

  // 순서가 핵심: 서식 → 크기 → 텍스트 입력 (입력 후 바꾸면 이미 쓴 글자에 적용 안 됨)
  const f1 = await setParagraphFormat(frame, page, '소제목');
  if (!f1.ok) { RESULT.subtitles.fail.push(`${text} — ${f1.reason}`); }
  const sz = await setFontSize(frame, page, 'fs19', '19');
  if (!sz.ok) log.warn(`소제목 크기 조정 실패: ${sz.reason}`);

  await insertText(page, text);
  await page.keyboard.press('Enter');

  // 다음 문단은 "본문"으로 명시 복귀
  const f2 = await setParagraphFormat(frame, page, '본문');
  if (!f2.ok) {
    RESULT.subtitles.fail.push(`${text} — 본문 복귀 실패: ${f2.reason}`);
  } else if (f1.ok) {
    RESULT.subtitles.ok++;
  }
  await page.waitForTimeout(150);
}

async function insertQuote(frame, page, text) {
  RESULT.quotes.total++;
  await focusEnd(frame, page);
  const qb = await findToolbarButton(frame, {
    classes: ['se-insert-quotation-default-toolbar-button'],
    labels: ['인용구'],
  });
  if (!qb) { RESULT.quotes.fail.push(text); log.fail('인용구 버튼을 찾지 못했습니다.'); await dumpButtons(frame, 'quot'); return; }
  await qb.loc.click();
  await page.waitForTimeout(400);
  await insertText(page, text);

  // 인용구 밖으로 빠져나온다
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    const still = await frame.evaluate(() => {
      const s = document.getSelection();
      if (!s || !s.anchorNode) return false;
      const el = s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement;
      return !!(el && el.closest && el.closest('.se-section-quotation'));
    }).catch(() => false);
    if (!still) break;
  }
  RESULT.quotes.ok++;
}

async function insertDivider(frame, page) {
  RESULT.dividers.total++;
  await focusEnd(frame, page);
  const hb = await findToolbarButton(frame, {
    classes: ['se-insert-horizontal-line-default-toolbar-button'],
    labels: ['구분선'],
  });
  if (!hb) { RESULT.dividers.fail.push('divider'); log.fail('구분선 버튼을 찾지 못했습니다.'); await dumpButtons(frame, 'horizontal'); return; }
  await hb.loc.click();
  await page.waitForTimeout(400);
  RESULT.dividers.ok++;
}

async function countImages(frame) {
  return frame.evaluate(() => {
    const a = document.querySelectorAll('.se-section-image').length;
    const b = document.querySelectorAll('img.se-image-resource').length;
    return Math.max(a, b);
  }).catch(() => 0);
}

async function insertImage(frame, page, block, idx) {
  RESULT.photos.total++;
  await focusEnd(frame, page);
  const before = await countImages(frame);

  const btn = await findToolbarButton(frame, {
    classes: ['se-image-toolbar-button'],
    labels: ['사진', '이미지'],
  });
  if (!btn) {
    RESULT.photos.fail.push(`${block.path} — 사진 버튼 없음`);
    log.fail('사진 버튼을 찾지 못했습니다. 실제 DOM 을 실측합니다.');
    await dumpButtons(frame, 'image');
    return;
  }
  log.info(`사진 버튼: ${btn.how}`);

  // 1순위: 파일 선택창을 가로채는 정석 경로
  let delivered = false;
  try {
    const chooserPromise = page.waitForEvent('filechooser', { timeout: 15000 });
    await btn.loc.click();
    const chooser = await chooserPromise;
    await chooser.setFiles(block._abs);
    delivered = true;
  } catch {
    log.warn('파일 선택창이 열리지 않았습니다 → 숨은 파일 입력란에 직접 넣어봅니다.');
  }

  // 2순위: 에디터가 숨겨 둔 input[type=file] 에 직접 주입
  if (!delivered) {
    const inputs = frame.locator('input[type="file"]');
    const n = await inputs.count().catch(() => 0);
    for (let i = 0; i < n && !delivered; i++) {
      try {
        await inputs.nth(i).setInputFiles(block._abs, { timeout: 8000 });
        delivered = true;
        log.info(`숨은 파일 입력란(${i + 1}/${n})으로 전달했습니다.`);
      } catch { /* 다음 후보 */ }
    }
  }

  if (!delivered) {
    RESULT.photos.fail.push(`${block.path} — 파일 전달 실패`);
    log.fail('사진 파일을 에디터에 전달하지 못했습니다. 실제 DOM 을 실측합니다.');
    await dumpButtons(frame, 'image');
    await dumpFileInputs(frame);
    return;
  }

  // 업로드 완료 대기
  const deadline = Date.now() + 120000;
  let ok = false;
  while (Date.now() < deadline) {
    if ((await countImages(frame)) > before) { ok = true; break; }
    await page.waitForTimeout(700);
  }
  if (!ok) {
    RESULT.photos.fail.push(`${block.path} — 업로드 확인 실패`);
    log.fail(`사진 업로드 확인 실패(2분 대기): ${block.path}`);
    const seen = await frame.evaluate(() => ({
      sectionImage: document.querySelectorAll('.se-section-image').length,
      imgResource: document.querySelectorAll('img.se-image-resource').length,
      anyImg: document.querySelectorAll('.se-component img').length,
    })).catch(() => ({}));
    log.info(`[실측] 이미지 요소 수: ${JSON.stringify(seen)}`);
    return;
  }
  await page.waitForTimeout(800);
  RESULT.photos.ok++;
  log.ok(`사진 ${idx + 1}: ${path.basename(block.path)}`);

  if (block.caption && String(block.caption).trim()) {
    RESULT.captions.total++;
    const done = await writeCaption(frame, page, String(block.caption).trim());
    if (done) RESULT.captions.ok++;
    else { RESULT.captions.fail.push(block.path); log.warn(`캡션 입력 실패(수동 필요): ${block.path}`); }
  }
}

/** 셀렉터가 실패했을 때, 추측하지 말고 그 자리에서 실제 버튼 목록을 로그에 남긴다 */
async function dumpButtons(frame, hint) {
  const list = await frame.evaluate(() => {
    return Array.from(document.querySelectorAll('button')).map((el) => ({
      cls: String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || ''),
      testid: el.getAttribute('data-testid') || '',
      text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 24),
      vis: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length),
    }));
  }).catch(() => []);
  const hit = list.filter((b) => (b.cls + b.text + b.testid).toLowerCase().includes(hint.toLowerCase()));
  log.info(`[실측] "${hint}" 관련 버튼 ${hit.length}개 / 전체 ${list.length}개`);
  (hit.length ? hit : list.filter((b) => b.vis).slice(0, 40)).forEach((b) => {
    log.info(`   ${b.vis ? 'V' : ' '} "${b.text}" class="${b.cls}"${b.testid ? ` testid="${b.testid}"` : ''}`);
  });
}

async function dumpFileInputs(frame) {
  const list = await frame.evaluate(() =>
    Array.from(document.querySelectorAll('input[type="file"]')).map((el) => ({
      id: el.id || '', cls: String(el.className || ''), accept: el.getAttribute('accept') || '',
      multiple: el.multiple, hidden: el.offsetParent === null,
    }))).catch(() => []);
  log.info(`[실측] input[type=file] ${list.length}개`);
  list.forEach((f) => log.info(`   id="${f.id}" class="${f.cls}" accept="${f.accept}" hidden=${f.hidden}`));
}

async function writeCaption(frame, page, caption) {
  const candidates = [
    '.se-section-image .se-caption [contenteditable="true"]',
    '.se-section-image .se-caption p.se-text-paragraph',
    '.se-caption p.se-text-paragraph',
    '.se-caption [data-placeholder*="설명"]',
    '[data-placeholder*="사진 설명"]',
  ];
  for (const sel of candidates) {
    const loc = frame.locator(sel).last();
    if (await loc.isVisible({ timeout: 2000 }).catch(() => false)) {
      await loc.click();
      await page.waitForTimeout(200);
      await insertText(page, caption);
      await page.waitForTimeout(200);
      return true;
    }
  }
  return false;
}

/* ══ 동영상 ══════════════════════════════════════════════ */
// 항상 첫 text 블록 직후에 삽입한다(D.I.A.+ 가산 요소). 업로드에 수 분 걸릴 수 있다.
async function insertVideo(frame, page, video) {
  RESULT.video.requested = true;
  log.step(`동영상 업로드 (수 분 걸릴 수 있습니다): ${path.basename(video._abs)}`);
  await focusEnd(frame, page);

  const clicked = await clickFirst(frame, ['button.se-video-toolbar-button', '.se-video-toolbar-button']);
  if (!clicked) { RESULT.video.note = '동영상 툴바 버튼을 찾지 못함 — 수동 첨부 필요'; log.fail(RESULT.video.note); return; }

  const popup = frame.locator('.se-popup-video-upload').first();
  if (!(await popup.isVisible({ timeout: 15000 }).catch(() => false))) {
    RESULT.video.note = '동영상 업로드 팝업이 열리지 않음 — 수동 첨부 필요';
    log.fail(RESULT.video.note);
    await forceClosePopup(frame, page);
    return;
  }

  try {
    const chooserPromise = page.waitForEvent('filechooser', { timeout: 20000 });
    await frame.locator('button.nvu_btn_append.nvu_local, .nvu_btn_append').first().click();
    const chooser = await chooserPromise;
    await chooser.setFiles(video._abs);
  } catch (e) {
    RESULT.video.note = `파일 선택 실패: ${e.message} — 수동 첨부 필요`;
    log.fail(RESULT.video.note);
    await forceClosePopup(frame, page);
    return;
  }

  // 제목 입력(필수, 40자 제한)
  const titleInput = frame.locator('.se-popup-video-upload input[placeholder*="제목"]').first();
  if (await titleInput.isVisible({ timeout: 120000 }).catch(() => false)) {
    await titleInput.click();
    await titleInput.fill('');
    await insertText(page, video._title);
    await page.waitForTimeout(300);
  } else {
    log.warn('동영상 제목 입력란을 찾지 못했습니다. 업로드 진행 상황을 확인하세요.');
  }

  // 업로드 완료 대기(최대 10분)
  const deadline = Date.now() + 10 * 60 * 1000;
  let finished = false;
  while (Date.now() < deadline) {
    const gone = !(await popup.isVisible().catch(() => false));
    if (gone) { finished = true; break; }
    const confirm = frame.locator('.se-popup-video-upload button:has-text("확인"), .se-popup-video-upload button:has-text("완료")').first();
    if (await confirm.isEnabled({ timeout: 500 }).catch(() => false)) {
      await confirm.click().catch(() => {});
      await page.waitForTimeout(1500);
    }
    await page.waitForTimeout(3000);
  }

  await forceClosePopup(frame, page);
  RESULT.video.ok = finished;
  RESULT.video.note = finished ? '삽입됨' : '업로드 완료를 확인하지 못함 — 에디터에서 직접 확인 필요';
  if (finished) log.ok('동영상 삽입 완료'); else log.warn(RESULT.video.note);
}

// 팝업을 확실히 닫지 않으면 dim 잔류로 이후 클릭이 전부 실패한다.
async function forceClosePopup(frame, page) {
  await frame.locator('button.nvu_btn_close, .se-popup-close-button, button[class*="close"]')
    .first().click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(600);
  if (await B.dimLayerPresent(frame)) {
    log.warn('dim 레이어가 남아 있어 DOM에서 강제 제거합니다.');
    await frame.evaluate(() => {
      document.querySelectorAll('.se-popup-video-upload, .se-popup-dim, .se-dim, .se-popup-dimmed')
        .forEach((el) => el.remove());
    }).catch(() => {});
    await page.waitForTimeout(300);
  }
}

/* ══ 지도(플레이스) ══════════════════════════════════════ */
async function insertPlace(frame, page, place) {
  RESULT.place.requested = true;
  log.step(`지도 첨부: ${place.query}`);
  await focusEnd(frame, page);

  const clicked = await clickFirst(frame, ['button.se-map-toolbar-button', '.se-map-toolbar-button', 'button[data-name="map"]']);
  if (!clicked) { RESULT.place.note = '지도 툴바 버튼을 찾지 못함 — ❗수동 첨부 필요'; log.fail(RESULT.place.note); return; }
  await page.waitForTimeout(1200);

  const search = frame.locator('.se-popup input[placeholder*="검색"], .se-popup input[type="text"]').first();
  if (!(await search.isVisible({ timeout: 8000 }).catch(() => false))) {
    RESULT.place.note = '장소 검색창을 찾지 못함 — ❗수동 첨부 필요';
    log.fail(RESULT.place.note);
    await closePlacePopup(frame, page);
    return;
  }
  await search.click();
  await insertText(page, place.query);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);

  const items = frame.locator('.se-popup li');
  const n = await items.count();
  if (n === 0) {
    RESULT.place.note = `검색 결과 0건("${place.query}") — ❗수동 첨부 필요`;
    log.fail(RESULT.place.note);
    await closePlacePopup(frame, page);
    return;
  }

  // 공백 제거 정확 일치 → 부분 포함 → 첫 결과
  const want = String(place.name || place.query).replace(/\s+/g, '');
  let target = 0, mode = '첫 결과';
  const texts = [];
  for (let i = 0; i < n; i++) texts.push((await items.nth(i).innerText().catch(() => '')).replace(/\s+/g, ''));
  let idx = texts.findIndex((t) => t === want);
  if (idx >= 0) { target = idx; mode = '정확 일치'; }
  else { idx = texts.findIndex((t) => t.includes(want)); if (idx >= 0) { target = idx; mode = '부분 포함'; } }

  // "추가" 버튼은 hover 전에는 not visible → 반드시 hover 후 클릭(폴백 DOM 직접 click)
  const item = items.nth(target);
  await item.hover().catch(() => {});
  await page.waitForTimeout(400);
  const addBtn = item.locator('button:has-text("추가")').first();
  let added = false;
  if (await addBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await addBtn.click().catch(() => {});
    added = true;
  }
  if (!added) {
    added = await item.evaluate((el) => {
      const btns = Array.from(el.querySelectorAll('button'));
      const b = btns.find((x) => (x.innerText || '').replace(/\s+/g, '') === '추가') || btns[0];
      if (b) { b.click(); return true; }
      return false;
    }).catch(() => false);
  }
  await page.waitForTimeout(800);

  if (!added) {
    RESULT.place.note = '"추가" 버튼 클릭 실패 — ❗수동 첨부 필요';
    log.fail(RESULT.place.note);
    await closePlacePopup(frame, page);
    return;
  }

  // "추가" 전까지 확인 버튼은 disabled 상태다
  const confirm = frame.locator('.se-popup button:has-text("확인")').first();
  if (await confirm.isEnabled({ timeout: 5000 }).catch(() => false)) {
    await confirm.click().catch(() => {});
    await page.waitForTimeout(1500);
    RESULT.place.ok = true;
    RESULT.place.note = `삽입됨 (${mode})`;
    log.ok(RESULT.place.note);
  } else {
    RESULT.place.note = '확인 버튼이 활성화되지 않음 — ❗수동 첨부 필요';
    log.fail(RESULT.place.note);
  }
  await closePlacePopup(frame, page);
}

// 장소 팝업은 Escape로 안 닫힌다 → 반드시 닫기 버튼. 안 닫으면 dim 레이어가 남아 이후 클릭이 전부 실패한다.
async function closePlacePopup(frame, page) {
  await frame.locator('.se-popup-close-button, .se-popup button[class*="close"]')
    .first().click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(600);
  if (await B.dimLayerPresent(frame)) {
    log.warn('장소 팝업 dim 레이어가 남아 DOM에서 강제 제거합니다.');
    await frame.evaluate(() => {
      document.querySelectorAll('.se-popup, .se-popup-dim, .se-dim, .se-popup-dimmed').forEach((el) => el.remove());
    }).catch(() => {});
    await page.waitForTimeout(300);
  }
}

/* ══ 태그 ════════════════════════════════════════════════ */
// 발행 패널을 열어야 태그를 넣을 수 있다 → 발행 차단 가드가 전제(절대 규칙 2).
async function inputTags(frame, page, tags) {
  RESULT.tags.total = tags.length;
  if (!tags.length) { RESULT.tags.note = '태그 없음'; return; }

  await B.verifyGuard(frame); // 가드 없이는 패널을 열지 않는다

  const opener = frame.locator(
    `button[class*="publish_btn"]:not([data-testid="seOnePublishBtn"]), button:has-text("발행"):not([data-testid="seOnePublishBtn"])`
  ).first();
  if (!(await opener.isVisible({ timeout: 6000 }).catch(() => false))) {
    RESULT.tags.note = '발행 패널 버튼을 찾지 못함 — ❗태그 수동 입력 필요';
    log.fail(RESULT.tags.note);
    return;
  }
  await opener.click();
  await page.waitForTimeout(1500);

  const input = frame.locator('input#tag-input').first();
  if (!(await input.isVisible({ timeout: 8000 }).catch(() => false))) {
    RESULT.tags.note = 'input#tag-input 을 찾지 못함 — ❗태그 수동 입력 필요';
    log.fail(RESULT.tags.note);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
    return;
  }

  for (const tag of tags) {
    await input.click();
    await insertText(page, tag);
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter'); // 칩 확정
    await page.waitForTimeout(350);
  }

  // 칩 클래스는 해시가 바뀌므로 의존하지 않는다 → 태그 영역 텍스트를 #로 쪼개 센다
  const areaText = await frame.evaluate(() => {
    const input = document.querySelector('input#tag-input');
    if (!input) return '';
    const box = input.closest('div');
    return box ? box.innerText : '';
  }).catch(() => '');
  const counted = areaText.split('#').map((s) => s.trim()).filter(Boolean).length;
  RESULT.tags.ok = counted;
  RESULT.tags.note = counted >= tags.length ? '전부 입력됨' : `${counted}/${tags.length} 확인됨 — ❗부족분 수동 확인 필요`;

  // Escape 로 패널만 닫는다(발행 아님)
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1200);
  const blocked = await B.blockedCount(frame);
  if (blocked > 0) log.warn(`발행 가드가 ${blocked}회 발행 클릭을 차단했습니다.`);
}

/* ══ 제목 ════════════════════════════════════════════════ */
// 제목은 반드시 맨 마지막. 제목 직후 본문을 치면 레이스 컨디션으로 섞인다.
async function typeTitle(frame, page, title) {
  const t = frame.locator('.se-title-text').first();
  await t.click();
  await page.waitForTimeout(300);
  await insertText(page, title);
  await page.waitForTimeout(600);

  const readBack = async () =>
    (await frame.locator('.se-title-text').first().innerText().catch(() => '')).replace(/​/g, '').trim();

  let got = await readBack();
  if (got.replace(/\s+/g, '') !== title.replace(/\s+/g, '')) {
    log.warn(`제목 불일치 → 재입력합니다. (읽은 값: "${got}")`);
    await t.click({ clickCount: 3 });
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(300);
    await insertText(page, title);
    await page.waitForTimeout(600);
    got = await readBack();
  }
  RESULT.title.ok = got.replace(/\s+/g, '') === title.replace(/\s+/g, '');
  RESULT.title.note = RESULT.title.ok ? '일치' : `❗불일치 — 에디터: "${got}"`;
  if (RESULT.title.ok) log.ok(`제목 확인: ${got}`); else log.fail(RESULT.title.note);
}

/* ══ 본문 첫 줄 보정 ═════════════════════════════════════ */
async function ensureFirstLine(frame, page, firstLine) {
  const head = firstLine.replace(/\s+/g, '').slice(0, 12);
  if (!head) return;
  const firstPara = await frame.locator(BODY_PARA).first().innerText().catch(() => '');
  if (firstPara.replace(/\s+/g, '').includes(head)) { log.ok('본문 첫 줄 확인'); return; }

  log.warn('본문 첫 줄이 누락됐습니다 → 맨 앞에 보정 삽입합니다.');
  await frame.locator(BODY_PARA).first().click();
  await page.keyboard.press('Control+Home');
  await insertText(page, firstLine);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const after = await frame.locator(BODY_PARA).first().innerText().catch(() => '');
  if (after.replace(/\s+/g, '').includes(head)) log.ok('본문 첫 줄 보정 완료');
  else log.fail('❗본문 첫 줄 보정 실패 — 수동 확인 필요');
}

/* ══ 문서 덤프 · 전문 대조 ═══════════════════════════════ */
async function dumpDocument(frame) {
  return frame.evaluate((bodySel) => {
    const clean = (s) => (s || '').replace(/​/g, '').trim();
    const title = clean(document.querySelector('.se-title-text')?.innerText);
    const paragraphs = Array.from(document.querySelectorAll(bodySel)).map((p) => clean(p.innerText));
    const quotes = Array.from(document.querySelectorAll('.se-section-quotation')).map((q) => clean(q.innerText));
    const captions = Array.from(document.querySelectorAll('.se-caption')).map((c) => clean(c.innerText));
    const container = document.querySelector('.se-canvas, .se-container, .se-viewer') || document.body;
    return { title, paragraphs, quotes, captions, full: clean(container.innerText) };
  }, BODY_PARA);
}

function verifyAgainstDraft(draft, dump) {
  const norm = (s) => String(s).replace(/\s+/g, '');
  const hay = norm(dump.full);
  const missing = [];

  if (norm(dump.title) !== norm(draft.title)) missing.push(`제목: "${draft.title}" ≠ "${dump.title}"`);

  draft.blocks.forEach((b, i) => {
    if (b.type === 'divider' || b.type === 'image') return;
    for (const line of String(b.text).split('\n')) {
      const needle = norm(line);
      if (needle && !hay.includes(needle)) missing.push(`blocks[${i}] (${b.type}): ${line.slice(0, 40)}`);
    }
  });

  draft.blocks.forEach((b, i) => {
    if (b.type === 'image' && b.caption && !hay.includes(norm(b.caption)))
      missing.push(`blocks[${i}] 캡션: ${b.caption.slice(0, 30)}`);
  });

  return missing;
}

/* ══ 임시저장 ════════════════════════════════════════════ */
async function saveDraft(frame, page) {
  // 클래스가 save_btn__ + 해시라 부분 일치로 잡고, "저장" 텍스트를 폴백으로 둔다
  const btn = frame.locator('button[class*="save_btn"]').first();
  let clicked = false;
  if (await btn.isVisible({ timeout: 5000 }).catch(() => false)) { await btn.click(); clicked = true; }
  if (!clicked) {
    const fb = frame.locator('button:has-text("저장")').first();
    if (await fb.isVisible({ timeout: 5000 }).catch(() => false)) { await fb.click(); clicked = true; }
  }
  if (!clicked) { RESULT.save.note = '❗임시저장 버튼을 찾지 못함'; return false; }
  await page.waitForTimeout(3500);
  RESULT.save.ok = true;
  RESULT.save.note = '임시저장 클릭 완료';
  return true;
}

/* ══ 결과 출력 ═══════════════════════════════════════════ */
function printResult(dryRun, blocked) {
  const mark = (ok) => (ok ? '✔ 성공' : '❗수동 필요');
  console.log('\n' + '═'.repeat(60));
  console.log('  자동 처리 결과');
  console.log('═'.repeat(60));
  console.log(`  사진      ${RESULT.photos.ok}/${RESULT.photos.total}   ${mark(RESULT.photos.ok === RESULT.photos.total)}`);
  if (RESULT.photos.fail.length) RESULT.photos.fail.forEach((f) => console.log(`             - ${f}`));
  console.log(`  캡션      ${RESULT.captions.ok}/${RESULT.captions.total}   ${mark(RESULT.captions.ok === RESULT.captions.total)}`);
  if (RESULT.captions.fail.length) RESULT.captions.fail.forEach((f) => console.log(`             - ${f}`));
  console.log(`  소제목    ${RESULT.subtitles.ok}/${RESULT.subtitles.total}   ${mark(RESULT.subtitles.ok === RESULT.subtitles.total)}`);
  if (RESULT.subtitles.fail.length) RESULT.subtitles.fail.forEach((f) => console.log(`             - ${f}`));
  console.log(`  인용구    ${RESULT.quotes.ok}/${RESULT.quotes.total}   ${mark(RESULT.quotes.ok === RESULT.quotes.total)}`);
  console.log(`  구분선    ${RESULT.dividers.ok}/${RESULT.dividers.total}   ${mark(RESULT.dividers.ok === RESULT.dividers.total)}`);
  console.log(`  태그      ${RESULT.tags.ok}/${RESULT.tags.total}   ${RESULT.tags.note}`);
  console.log(`  지도      ${RESULT.place.requested ? RESULT.place.note : '해당 없음'}`);
  console.log(`  동영상    ${RESULT.video.requested ? RESULT.video.note : '해당 없음'}`);
  console.log(`  제목      ${RESULT.title.note}`);
  console.log(`  임시저장  ${dryRun ? '건너뜀 (--dry-run)' : RESULT.save.note}`);
  console.log(`  전문대조  ${RESULT.verify.ok ? '✔ 초안과 일치' : `❗불일치 ${RESULT.verify.missing.length}건`}`);
  RESULT.verify.missing.slice(0, 20).forEach((m) => console.log(`             - ${m}`));
  console.log(`  발행가드  차단 ${blocked}회 (가드 정상 작동)`);
  console.log('═'.repeat(60));
  console.log('  ❗수동 필요 항목만 사용자에게 안내하세요.');
  console.log('  ❗디버깅 재실행으로 네이버 "저장 글"에 실패본이 쌓였다면 직접 정리해 주세요.');
  console.log('═'.repeat(60) + '\n');
}

/* ══ 메인 ════════════════════════════════════════════════ */
async function main() {
  const flags = B.parseFlags(process.argv);
  if (!flags._[0]) {
    console.error('사용법: node scripts/naver_draft.js <초안.json> [--dry-run] [--headless] [--keep-open]');
    process.exit(1);
  }

  console.log(`\n  naver_draft.js  build ${BUILD}`);
  const draft = loadDraft(flags._[0]);
  log.ok(`초안 로드: ${path.basename(draft._file)} (블록 ${draft.blocks.length}개)`);
  if (flags.dryRun) log.warn('--dry-run: 임시저장 클릭을 생략합니다.');

  const { context, page } = await B.launch({ headless: flags.headless });
  let frame;
  try {
    log.step('글쓰기 페이지로 이동합니다');
    await page.goto(B.WRITE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);

    // 로그인 화면으로 튕기면 바로 죽지 않고, 그 자리에서 로그인할 시간을 준다
    if (/^https:\/\/blog\.naver\.com/.test(B.WRITE_URL) && /nid\.naver\.com/.test(page.url())) {
      log.warn('로그인 세션이 없거나 만료됐습니다.');
      console.log('\n' + '─'.repeat(64));
      console.log('  지금 열려 있는 브라우저 창에서 직접 로그인해 주세요.');
      console.log('  (아이디·비밀번호는 받지도 저장하지도 않습니다)');
      console.log('  로그인이 확인되면 창을 닫지 말고 그대로 두시면 자동으로 이어서 진행합니다.');
      console.log('  최대 5분 기다립니다.');
      console.log('─'.repeat(64) + '\n');

      const loggedIn = await B.waitForLogin(page, 5);
      if (!loggedIn) {
        throw new Error('5분 안에 로그인이 확인되지 않았습니다. `node scripts/naver_login.js` 를 먼저 실행해 주세요.');
      }
      log.ok('로그인 확인 — 글쓰기 페이지로 다시 이동합니다');
      await page.goto(B.WRITE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(3000);
      if (/nid\.naver\.com/.test(page.url())) {
        throw new Error('로그인 후에도 글쓰기 페이지 접근이 막혔습니다. naver-profile 폴더를 지우고 다시 시도해 주세요.');
      }
    }

    frame = await B.getEditorFrame(page);
    await B.ensureGuard(frame);
    await B.verifyGuard(frame); // 가드 미설치면 여기서 중단(절대 규칙 2)
    log.ok('발행 차단 가드 확인');

    const popups = await B.dismissStartupPopups(frame);
    popups.forEach((p) => log.ok(p));

    /* ── 본문 입력 (제목은 맨 마지막) ── */
    log.step('본문을 입력합니다');
    let firstTextDone = false;
    for (let i = 0; i < draft.blocks.length; i++) {
      const b = draft.blocks[i];
      const next = draft.blocks[i + 1];
      log.info(`[${i + 1}/${draft.blocks.length}] ${b.type}${b.path ? ' ' + path.basename(b.path) : ''}`);

      if (b.type === 'text') {
        await insertTextBlock(frame, page, b.text, next && next.type === 'text', draft.fontSize);
        if (!firstTextDone) {
          firstTextDone = true;
          // 동영상은 항상 첫 text 블록 직후
          if (draft.video && draft.video._abs) await insertVideo(frame, page, draft.video);
        }
      } else if (b.type === 'subtitle') {
        await insertSubtitle(frame, page, b.text);
      } else if (b.type === 'quote') {
        await insertQuote(frame, page, b.text);
      } else if (b.type === 'divider') {
        await insertDivider(frame, page);
      } else if (b.type === 'image') {
        await insertImage(frame, page, b, i);
      }
    }

    /* ── 지도는 글 맨 끝 ── */
    if (draft.place && draft.place.query) await insertPlace(frame, page, draft.place);

    /* ── 본문 첫 줄 보정 ── */
    const firstText = draft.blocks.find((b) => b.type === 'text');
    if (firstText) await ensureFirstLine(frame, page, String(firstText.text).split('\n')[0]);

    /* ── 제목은 맨 마지막 ── */
    log.step('제목을 입력합니다 (맨 마지막)');
    await typeTitle(frame, page, draft.title);

    /* ── 태그 (발행 패널 → Escape) ── */
    log.step('태그를 입력합니다');
    await inputTags(frame, page, draft.tags);

    /* ── 임시저장 ── */
    if (!flags.dryRun) {
      log.step('임시저장');
      await saveDraft(frame, page);
    } else {
      RESULT.save.note = '건너뜀 (--dry-run)';
    }

    /* ── 이중 검증 ── */
    log.step('검증: 스크린샷 + 전문 덤프');
    const shot = `${draft._base}.screenshot.png`;
    await page.screenshot({ path: shot, fullPage: false }).catch(() => {});
    const dump = await dumpDocument(frame);
    const dumpPath = `${draft._base}.dump.txt`;
    fs.writeFileSync(
      dumpPath,
      [
        `# 에디터 실제 내용 덤프 — ${new Date().toISOString()}`,
        `## 제목`, dump.title, '',
        `## 본문 문단 (${dump.paragraphs.length})`, ...dump.paragraphs, '',
        `## 인용구 (${dump.quotes.length})`, ...dump.quotes, '',
        `## 캡션 (${dump.captions.length})`, ...dump.captions, '',
        `## 전체 텍스트`, dump.full,
      ].join('\n'),
      'utf8'
    );
    RESULT.verify.missing = verifyAgainstDraft(draft, dump);
    RESULT.verify.ok = RESULT.verify.missing.length === 0;
    log.ok(`스크린샷: ${path.relative(B.ROOT, shot)}`);
    log.ok(`전문 덤프: ${path.relative(B.ROOT, dumpPath)}  ← 이게 본검증입니다`);

    const blocked = await B.blockedCount(frame);
    printResult(flags.dryRun, blocked);

    if (!RESULT.verify.ok) {
      console.log('  ❗초안과 불일치가 있습니다. 성공으로 보고하지 말고 원인을 찾으세요.');
      process.exitCode = 2;
    }
  } catch (err) {
    log.fail(err.message);
    console.error(err.stack);
    // 3회 이상 실패 시 수동 붙여넣기용 원고를 출력하라는 규칙에 대비한 힌트
    console.log('\n  → 셀렉터 문제로 보이면 `node scripts/probe_selectors.js` 로 실제 DOM을 실측하세요.');
    console.log('  → 반복 실패 시 수동 붙여넣기용 원고를 출력하고, 원인·해결을 CLAUDE.md 「11. 문제 해결 기록」에 남기세요.\n');
    process.exitCode = 1;
  } finally {
    try {
      const logPath = `${draft._base}.log.txt`;
      fs.writeFileSync(logPath, LOG_LINES.join('\n') + '\n', 'utf8');
      console.log(`\n  실행 기록을 파일로 저장했습니다: ${path.relative(B.ROOT, logPath)}`);
      console.log('  ❗문제가 있으면 이 파일을 그대로 보내주시면 됩니다. (캡처 안 하셔도 됩니다)\n');
    } catch (e) {
      console.error(`로그 파일 저장 실패: ${e.message}`);
    }
    if (flags.keepOpen) {
      log.warn('--keep-open: 브라우저를 열어 둡니다. 창을 직접 닫으세요.');
    } else {
      await context.close().catch(() => {});
    }
  }
}

// 테스트에서 순수 함수만 가져다 쓸 수 있게 분리한다(require 해도 브라우저가 뜨지 않는다).
module.exports = { loadDraft, splitRuns, verifyAgainstDraft, RESULT };

if (require.main === module) {
  main();
}
