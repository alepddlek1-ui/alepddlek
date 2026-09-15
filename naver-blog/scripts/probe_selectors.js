'use strict';
/**
 * probe_selectors.js — 셀렉터 진단용 DOM 덤프 (읽기 전용)
 *
 *   node scripts/probe_selectors.js
 *
 * 아무것도 클릭하지 않는다. 글도 쓰지 않는다. 저장도 하지 않는다.
 * 셀렉터가 깨졌을 때 "추측으로 고치지 말고" 이걸로 실제 DOM을 떠서 실측한다.
 * 결과: drafts/probe-<타임스탬프>.txt  +  .json
 */
const fs = require('fs');
const path = require('path');
const B = require('./lib/browser');
const { log } = B;

const KNOWN = [
  ['제목', '.se-title-text'],
  ['본문 문단', '.se-section-text p.se-text-paragraph'],
  ['본문 섹션', '.se-section-text'],
  ['인용구 섹션', '.se-section-quotation'],
  ['사진 섹션', '.se-section-image'],
  ['캡션', '.se-caption'],
  ['사진 버튼', 'button.se-image-toolbar-button'],
  ['동영상 버튼', 'button.se-video-toolbar-button'],
  ['지도 버튼', 'button.se-map-toolbar-button'],
  ['인용구 버튼', '.se-insert-quotation-default-toolbar-button'],
  ['구분선 버튼', '.se-insert-horizontal-line-default-toolbar-button'],
  ['문단 서식 드롭다운', '.se-text-format-toolbar-button'],
  ['글자 크기 드롭다운', '.se-font-size-code-toolbar-button'],
  ['도움말 닫기', '.se-help-panel-close-button'],
  ['작성중 팝업 취소', '.se-popup-button-cancel'],
  ['임시저장', 'button[class*="save_btn"]'],
  ['진짜 발행 버튼(차단 대상)', 'button[data-testid="seOnePublishBtn"]'],
  ['태그 입력', 'input#tag-input'],
  ['동영상 팝업', '.se-popup-video-upload'],
];

(async () => {
  const flags = B.parseFlags(process.argv);
  const { context, page } = await B.launch({ headless: flags.headless });

  try {
    log.step('글쓰기 페이지로 이동합니다 (읽기 전용 — 클릭하지 않습니다)');
    await page.goto(B.WRITE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4000);
    if (/nid\.naver\.com/.test(page.url())) throw new Error('로그인이 필요합니다. `node scripts/naver_login.js` 먼저 실행하세요.');

    const hasFrame = !!(await page.$('iframe#mainFrame'));
    const frame = await B.getEditorFrame(page);
    await B.verifyGuard(frame).catch((e) => log.warn(e.message));

    const known = [];
    for (const [name, sel] of KNOWN) {
      const count = await frame.locator(sel).count().catch(() => -1);
      known.push({ name, sel, count });
    }

    const dom = await frame.evaluate(() => {
      const brief = (el) => ({
        tag: el.tagName.toLowerCase(),
        cls: el.className && el.className.baseVal !== undefined ? el.className.baseVal : String(el.className || ''),
        id: el.id || '',
        testid: el.getAttribute('data-testid') || '',
        name: el.getAttribute('data-name') || '',
        value: el.getAttribute('data-value') || '',
        text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40),
        visible: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length),
      });
      const buttons = Array.from(document.querySelectorAll('button')).map(brief);
      const inputs = Array.from(document.querySelectorAll('input, textarea')).map((el) => ({
        ...brief(el),
        placeholder: el.getAttribute('placeholder') || '',
        type: el.getAttribute('type') || '',
      }));
      const classes = {};
      document.querySelectorAll('[class*="se-"]').forEach((el) => {
        String(el.className.baseVal !== undefined ? el.className.baseVal : el.className)
          .split(/\s+/)
          .filter((c) => c.startsWith('se-'))
          .forEach((c) => { classes[c] = (classes[c] || 0) + 1; });
      });
      return { url: location.href, buttons, inputs, classes };
    });

    if (!fs.existsSync(path.join(B.ROOT, 'drafts'))) fs.mkdirSync(path.join(B.ROOT, 'drafts'), { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = path.join(B.ROOT, 'drafts', `probe-${stamp}`);

    fs.writeFileSync(`${base}.json`, JSON.stringify({ hasFrame, known, ...dom }, null, 2), 'utf8');

    const lines = [];
    lines.push(`# 셀렉터 실측 — ${new Date().toISOString()}`);
    lines.push(`URL: ${dom.url}`);
    lines.push(`iframe#mainFrame: ${hasFrame ? '있음' : '없음(페이지 자체가 에디터)'}`);
    lines.push('', '## 알려진 셀렉터 (count 0 이면 깨진 것)');
    known.forEach((k) => lines.push(`  ${k.count === 0 ? '✘' : '✔'} ${String(k.count).padStart(3)}  ${k.name}  —  ${k.sel}`));
    lines.push('', `## 버튼 (${dom.buttons.length})`);
    dom.buttons.forEach((b) => lines.push(`  [${b.visible ? 'V' : ' '}] ${b.text || '(no text)'}  | class="${b.cls}"${b.testid ? ` | testid="${b.testid}"` : ''}${b.value ? ` | data-value="${b.value}"` : ''}`));
    lines.push('', `## 입력란 (${dom.inputs.length})`);
    dom.inputs.forEach((i) => lines.push(`  [${i.visible ? 'V' : ' '}] id="${i.id}" placeholder="${i.placeholder}" class="${i.cls}"`));
    lines.push('', '## se- 클래스 빈도 (상위 120)');
    Object.entries(dom.classes).sort((a, b) => b[1] - a[1]).slice(0, 120)
      .forEach(([c, n]) => lines.push(`  ${String(n).padStart(4)}  ${c}`));
    fs.writeFileSync(`${base}.txt`, lines.join('\n'), 'utf8');

    console.log('\n' + '─'.repeat(56));
    known.forEach((k) => console.log(`  ${k.count === 0 ? '✘' : '✔'} ${String(k.count).padStart(3)}  ${k.name}  —  ${k.sel}`));
    console.log('─'.repeat(56));
    log.ok(`덤프: ${path.relative(B.ROOT, base)}.txt / .json`);
    console.log('  ✘ 로 찍힌 셀렉터를 실제 DOM 값으로 고치고, 원인·해결을 CLAUDE.md 「11. 문제 해결 기록」에 남기세요.\n');
  } catch (err) {
    log.fail(err.message);
    process.exitCode = 1;
  } finally {
    await context.close().catch(() => {});
  }
})();
