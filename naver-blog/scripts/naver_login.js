'use strict';
/**
 * naver_login.js — 로그인 세션 1회 저장
 *
 * 사용자가 브라우저에서 "직접" 로그인한다. 이 스크립트는 아이디/비밀번호를 받지도, 저장하지도 않는다.
 * 세션은 naver-profile/ 에 남고, 이후 모든 스크립트가 그 세션을 재사용한다.
 *
 *   node scripts/naver_login.js
 */
const { launch, isLoggedIn, log, PROFILE_DIR, WRITE_URL, verifyGuard } = require('./lib/browser');

const LOGIN_URL = 'https://nid.naver.com/nidlogin.login?mode=form&url=https%3A%2F%2Fwww.naver.com';
const TIMEOUT_MS = 10 * 60 * 1000; // 10분

(async () => {
  log.step('브라우저를 엽니다');
  const { context, page } = await launch({ headless: false });

  try {
    await page.goto('https://www.naver.com', { waitUntil: 'domcontentloaded', timeout: 60000 });

    if (await isLoggedIn(page)) {
      log.ok('이미 로그인된 세션이 있습니다.');
      log.step('글쓰기 페이지 접근을 확인합니다');
      await page.goto(WRITE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(3000);
      if (/nid\.naver\.com/.test(page.url())) {
        log.warn('세션이 만료됐습니다. 다시 로그인해 주세요.');
      } else {
        await verifyGuard(page).catch((e) => log.warn(e.message));
        log.ok(`글쓰기 페이지 접근 OK — ${page.url()}`);
        log.ok(`세션 위치: ${PROFILE_DIR}  (외부 공유·커밋 금지)`);
        return;
      }
    }

    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

    console.log('\n' + '─'.repeat(64));
    console.log('  브라우저 창에서 직접 로그인해 주세요.');
    console.log('  (이 스크립트는 아이디·비밀번호를 받지도 저장하지도 않습니다)');
    console.log('  2단계 인증·기기 등록이 있으면 그것까지 끝내 주세요.');
    console.log('  로그인이 확인되면 자동으로 다음 단계로 넘어갑니다. 최대 10분 대기.');
    console.log('─'.repeat(64) + '\n');

    const deadline = Date.now() + TIMEOUT_MS;
    let done = false;
    while (Date.now() < deadline) {
      if (await isLoggedIn(page).catch(() => false)) { done = true; break; }
      await page.waitForTimeout(2000);
    }
    if (!done) throw new Error('10분 안에 로그인이 확인되지 않았습니다. 다시 실행해 주세요.');

    log.ok('로그인 확인');

    log.step('글쓰기 페이지 접근을 확인합니다');
    await page.goto(WRITE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);
    if (/nid\.naver\.com/.test(page.url())) {
      throw new Error('글쓰기 페이지에서 다시 로그인 화면으로 넘어갔습니다. 세션 저장에 실패했습니다.');
    }
    await verifyGuard(page).catch((e) => log.warn(e.message));

    log.ok(`글쓰기 페이지 접근 OK — ${page.url()}`);
    log.ok(`세션 저장 완료: ${PROFILE_DIR}`);
    console.log('\n  ❗ naver-profile/ 폴더는 로그인 세션입니다. 외부 공유·커밋 금지.\n');
  } catch (err) {
    log.fail(err.message);
    process.exitCode = 1;
  } finally {
    await context.close().catch(() => {});
  }
})();
