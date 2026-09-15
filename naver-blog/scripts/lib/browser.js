'use strict';
/**
 * 공통 브라우저 유틸 — 세션 유지 · 발행 차단 가드 · 에디터 프레임 획득
 *
 * 절대 규칙 2: 발행 금지. installPublishGuard()는 어떤 경우에도 제거하지 않는다.
 */
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..', '..');
const PROFILE_DIR = path.join(ROOT, 'naver-profile');

const WRITE_URL = 'https://blog.naver.com/GoBlogWrite.naver';

/** 진짜 발행 버튼 — 이 선택자 클릭만 원천 차단한다(패널 여는 버튼은 아님) */
const PUBLISH_BTN = 'button[data-testid="seOnePublishBtn"]';

/* ── 로그 ─────────────────────────────────────────────── */
const log = {
  step: (m) => console.log(`\n▶ ${m}`),
  ok: (m) => console.log(`  ✔ ${m}`),
  warn: (m) => console.log(`  ! ${m}`),
  fail: (m) => console.log(`  ✘ ${m}`),
  info: (m) => console.log(`    ${m}`),
};

/* ── 플래그 파싱 ───────────────────────────────────────── */
function parseFlags(argv) {
  const args = argv.slice(2);
  const flags = {
    dryRun: args.includes('--dry-run'),
    headless: args.includes('--headless'),
    keepOpen: args.includes('--keep-open'),
  };
  flags._ = args.filter((a) => !a.startsWith('--'));
  return flags;
}

/* ── 발행 차단 가드 ────────────────────────────────────── */
// 캡처 단계에서 진짜 발행 버튼 클릭을 삼킨다. 페이지/프레임의 모든 새 문서에 주입된다.
const GUARD_SOURCE = `(() => {
  if (window.__naverPublishGuardInstalled) return;
  window.__naverPublishGuardInstalled = true;
  window.__naverPublishBlockedCount = 0;
  var SEL = 'button[data-testid="seOnePublishBtn"]';
  var block = function (e) {
    var el = (e.target && e.target.nodeType === 1) ? e.target : null;
    var hit = el && el.closest ? el.closest(SEL) : null;
    if (!hit) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    window.__naverPublishBlockedCount++;
    console.warn('[PUBLISH GUARD] 발행 버튼 클릭을 차단했습니다. 이 툴은 임시저장까지만 합니다.');
  };
  ['pointerdown', 'mousedown', 'mouseup', 'pointerup', 'click', 'dblclick'].forEach(function (t) {
    document.addEventListener(t, block, true);
  });
  document.addEventListener('keydown', function (e) {
    // 발행 패널에서 Enter로 발행되는 경로 차단
    var a = document.activeElement;
    if (e.key === 'Enter' && a && a.closest && a.closest(SEL)) {
      e.preventDefault();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      window.__naverPublishBlockedCount++;
    }
  }, true);
})();`;

async function installPublishGuard(context) {
  await context.addInitScript(GUARD_SOURCE);
}

/** 이미 로드된 문서에도 가드를 덧씌운다(네비게이션 이후 보강용) */
async function ensureGuard(frameOrPage) {
  try {
    await frameOrPage.evaluate(GUARD_SOURCE);
  } catch (e) {
    log.warn(`가드 재주입 실패(무시 가능): ${e.message}`);
  }
}

/** 가드가 실제로 붙었는지 확인한다. 안 붙었으면 진행하지 않는다. */
async function verifyGuard(frameOrPage) {
  const installed = await frameOrPage.evaluate(() => window.__naverPublishGuardInstalled === true);
  if (!installed) {
    throw new Error('발행 차단 가드가 주입되지 않았습니다. 절대 규칙 2 위반 위험 — 실행을 중단합니다.');
  }
  return true;
}

async function blockedCount(frameOrPage) {
  try {
    return await frameOrPage.evaluate(() => window.__naverPublishBlockedCount || 0);
  } catch {
    return 0;
  }
}

/* ── 브라우저 기동 ─────────────────────────────────────── */
async function launch({ headless = false } = {}) {
  const { chromium } = require('playwright');
  if (!fs.existsSync(PROFILE_DIR)) fs.mkdirSync(PROFILE_DIR, { recursive: true });

  // 뷰포트 1600x1000 미만이면 패널이 열릴 때 속성 툴바가 잘려 서식 버튼 클릭이 불안정해진다.
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless,
    viewport: { width: 1600, height: 1000 },
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    args: ['--window-size=1680,1060', '--disable-blink-features=AutomationControlled'],
  });
  await installPublishGuard(context);

  const page = context.pages()[0] || (await context.newPage());
  await page.setViewportSize({ width: 1600, height: 1000 });
  return { context, page };
}

/* ── 로그인 상태 확인 ──────────────────────────────────── */
async function isLoggedIn(page) {
  const url = page.url();
  if (/nid\.naver\.com/.test(url)) return false;
  const cookies = await page.context().cookies('https://blog.naver.com');
  return cookies.some((c) => c.name === 'NID_AUT' || c.name === 'NID_SES');
}

/** 사용자가 브라우저에서 직접 로그인할 때까지 기다린다(비밀번호는 받지 않는다) */
async function waitForLogin(page, minutes = 5) {
  const deadline = Date.now() + minutes * 60 * 1000;
  let dots = 0;
  while (Date.now() < deadline) {
    if (await isLoggedIn(page).catch(() => false)) return true;
    await page.waitForTimeout(2000);
    if (++dots % 15 === 0) {
      const left = Math.ceil((deadline - Date.now()) / 60000);
      log.info(`로그인 대기 중... (남은 시간 약 ${left}분)`);
    }
  }
  return false;
}

/* ── 에디터 프레임 ─────────────────────────────────────── */
/** 에디터는 iframe#mainFrame 안에 있다. 프레임이 없으면 페이지 자체가 에디터다. */
async function getEditorFrame(page, { timeout = 30000 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const el = await page.$('iframe#mainFrame');
    if (el) {
      const frame = await el.contentFrame();
      if (frame) {
        const hasEditor = await frame
          .$('.se-title-text, .se-section-text')
          .then((h) => !!h)
          .catch(() => false);
        if (hasEditor) return frame;
      }
    }
    const direct = await page
      .$('.se-title-text, .se-section-text')
      .then((h) => !!h)
      .catch(() => false);
    if (direct) return page.mainFrame();
    await page.waitForTimeout(500);
  }
  throw new Error('에디터를 찾지 못했습니다. probe_selectors.js 로 실제 DOM을 확인하세요.');
}

/* ── 진입 팝업 정리 ────────────────────────────────────── */
async function dismissStartupPopups(frame) {
  const results = [];
  // "작성 중인 글" 팝업 → 새로 쓰기(취소 버튼)
  try {
    const cancel = frame.locator('.se-popup-button-cancel').first();
    if (await cancel.isVisible({ timeout: 4000 }).catch(() => false)) {
      await cancel.click();
      results.push('작성 중인 글 팝업 → 새로 쓰기');
      await frame.waitForTimeout(600);
    }
  } catch { /* 팝업이 없으면 정상 */ }

  // 도움말 패널
  try {
    const help = frame.locator('.se-help-panel-close-button').first();
    if (await help.isVisible({ timeout: 3000 }).catch(() => false)) {
      await help.click();
      results.push('도움말 패널 닫기');
      await frame.waitForTimeout(400);
    }
  } catch { /* 없으면 정상 */ }

  return results;
}

/** 장소/동영상 팝업이 남긴 dim 레이어를 확인한다(남으면 이후 클릭이 전부 실패한다) */
async function dimLayerPresent(frame) {
  return frame.evaluate(() => {
    const dims = document.querySelectorAll('.se-popup-dim, .se-dim, .se-popup-dimmed');
    for (const d of dims) {
      const st = window.getComputedStyle(d);
      if (st.display !== 'none' && st.visibility !== 'hidden') return true;
    }
    return false;
  }).catch(() => false);
}

module.exports = {
  GUARD_SOURCE,
  ROOT,
  PROFILE_DIR,
  WRITE_URL,
  PUBLISH_BTN,
  log,
  parseFlags,
  installPublishGuard,
  ensureGuard,
  verifyGuard,
  blockedCount,
  launch,
  isLoggedIn,
  waitForLogin,
  getEditorFrame,
  dismissStartupPopups,
  dimLayerPresent,
};
