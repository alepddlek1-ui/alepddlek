'use strict';
/**
 * tests/run.js — 스크립트 자가 검증
 *
 *   npm test
 *
 * 브라우저 없이 도는 순수 로직 테스트 + 실제 Chromium으로 도는 발행 차단 가드 테스트.
 * 가드 테스트는 절대 규칙 2가 "코드로도" 지켜지는지 확인하는 것이므로 지우지 않는다.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const D = require(path.join(ROOT, 'scripts', 'naver_draft.js'));
const { GUARD_SOURCE } = require(path.join(ROOT, 'scripts', 'lib', 'browser.js'));

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); console.log('  ✔ ' + name); pass++; }
  catch (e) { console.log('  ✘ ' + name + ' → ' + e.message); fail++; }
};
const tmp = (name, obj) => {
  const p = path.join(os.tmpdir(), name);
  fs.writeFileSync(p, JSON.stringify(obj), 'utf8');
  return p;
};

(async () => {
  console.log('\n[1] 초안 파싱 · 검증');

  await t('예시 초안이 스키마 검증을 통과한다', () => {
    const d = D.loadDraft('examples/sample-draft.json');
    assert.ok(d.blocks.length > 0);
    assert.ok(d.title);
  });

  await t('태그: 앞의 # 제거 · 공백 정리 · 30개 상한', () => {
    const p = tmp('nb-t1.json', {
      title: 'x',
      tags: ['#가', ' 나 ', '#다'].concat(Array.from({ length: 40 }, (_, i) => 't' + i)),
      blocks: [{ type: 'text', text: 'a' }],
    });
    const d = D.loadDraft(p);
    assert.strictEqual(d.tags[0], '가');
    assert.strictEqual(d.tags[1], '나');
    assert.strictEqual(d.tags.length, 30);
  });

  await t('동영상 제목: 40자 절단 + 글 제목 폴백', () => {
    const vid = path.join(ROOT, 'input', 'videos', '_test.mp4');
    fs.writeFileSync(vid, 'x');
    try {
      const p = tmp('nb-t2.json', {
        title: '가'.repeat(60),
        video: { path: 'input/videos/_test.mp4' },
        blocks: [{ type: 'text', text: 'a' }],
      });
      assert.strictEqual(D.loadDraft(p).video._title.length, 40);
    } finally { fs.unlinkSync(vid); }
  });

  await t('없는 사진 경로는 실행 전에 에러', () => {
    const p = tmp('nb-t3.json', { title: 'x', blocks: [{ type: 'image', path: 'input/photos/nope.jpg' }] });
    assert.throws(() => D.loadDraft(p), /사진 파일이 없습니다/);
  });

  await t('허용되지 않은 블록 타입은 실행 전에 에러', () => {
    const p = tmp('nb-t4.json', { title: 'x', blocks: [{ type: 'table', text: 'a' }] });
    assert.throws(() => D.loadDraft(p), /type 이 올바르지 않습니다/);
  });

  console.log('\n[2] 한글/이모지 입력 분리');

  await t('이모지는 텍스트와 분리된 run 으로 쪼개진다', () => {
    const runs = D.splitRuns('오늘 경기👏 끝');
    assert.deepStrictEqual(runs.map((r) => r.kind), ['text', 'emoji', 'text']);
  });

  await t('ZWJ 조합 이모지는 한 run 으로 유지된다', () => {
    const emo = D.splitRuns('a👨‍👩‍👧b').filter((r) => r.kind === 'emoji');
    assert.strictEqual(emo.length, 1);
    assert.strictEqual(emo[0].v, '👨‍👩‍👧');
  });

  await t('이모지 없는 한글 문장은 run 1개', () => {
    assert.strictEqual(D.splitRuns('평범한 한글 문장입니다.').length, 1);
  });

  console.log('\n[3] 전문 대조 (본검증 로직)');

  await t('전부 들어있으면 불일치 0', () => {
    const draft = { title: '제목입니다', blocks: [
      { type: 'text', text: '첫 줄\n둘째 줄' },
      { type: 'quote', text: '인용구 문장' },
      { type: 'divider' },
    ] };
    assert.deepStrictEqual(D.verifyAgainstDraft(draft, { title: '제목입니다', full: '제목입니다 첫 줄 둘째 줄 인용구 문장' }), []);
  });

  await t('제목 깨짐 + 본문 누락을 잡아낸다', () => {
    const draft = { title: '진짜 제목', blocks: [{ type: 'text', text: '있는 줄\n없는 줄' }] };
    const m = D.verifyAgainstDraft(draft, { title: '깨진 제목', full: '깨진 제목 있는 줄' });
    assert.strictEqual(m.length, 2);
  });

  await t('캡션 누락도 잡아낸다', () => {
    const draft = { title: 'T', blocks: [{ type: 'image', path: 'p', caption: '캡션문구' }] };
    assert.strictEqual(D.verifyAgainstDraft(draft, { title: 'T', full: 'T' }).length, 1);
  });

  console.log('\n[4] 발행 차단 가드 (절대 규칙 2 — 코드 보장)');

  let browser;
  try {
    const { chromium } = require('playwright');
    const opts = { headless: true };
    if (process.env.CHROMIUM_PATH) opts.executablePath = process.env.CHROMIUM_PATH;
    browser = await chromium.launch(opts);
  } catch (e) {
    console.log('  ! Chromium 을 띄우지 못해 가드 테스트를 건너뜁니다: ' + e.message.split('\n')[0]);
    console.log('    → `npx playwright install chromium` 후 다시 실행하세요.');
  }

  if (browser) {
    const ctx = await browser.newContext();
    await ctx.addInitScript(GUARD_SOURCE);
    const page = await ctx.newPage();
    await page.goto('file://' + path.join(__dirname, 'fixtures', 'guard.html'));

    await t('가드가 주입돼 있다', async () => {
      assert.strictEqual(await page.evaluate(() => window.__naverPublishGuardInstalled), true);
    });
    await t('발행 버튼 클릭이 차단된다', async () => {
      await page.locator('button[data-testid="seOnePublishBtn"]').click();
      assert.strictEqual(await page.evaluate(() => window.publishedCalled), undefined);
      assert.ok(await page.evaluate(() => window.__naverPublishBlockedCount) > 0);
    });
    await t('발행 버튼 안쪽 요소 클릭도 차단된다 (closest)', async () => {
      const before = await page.evaluate(() => window.__naverPublishBlockedCount);
      await page.locator('#inner').click();
      assert.strictEqual(await page.evaluate(() => window.publishedCalled), undefined);
      assert.ok(await page.evaluate(() => window.__naverPublishBlockedCount) > before);
    });
    await t('임시저장 버튼은 정상 동작한다 (과잉 차단 아님)', async () => {
      await page.locator('#save').click();
      assert.strictEqual(await page.evaluate(() => window.savedCalled), true);
    });
    await t('iframe 안의 발행 버튼도 차단된다', async () => {
      const f = page.frame({ url: /frame\.html/ });
      assert.ok(f, 'iframe 을 찾지 못했습니다');
      assert.strictEqual(await f.evaluate(() => window.__naverPublishGuardInstalled), true);
      await f.locator('button[data-testid="seOnePublishBtn"]').click();
      assert.strictEqual(await f.evaluate(() => window.publishedCalled), undefined);
    });
    await t('발행 버튼 포커스 상태의 Enter 도 차단된다', async () => {
      await page.evaluate(() => {
        window.publishedCalled = undefined;
        document.querySelector('button[data-testid="seOnePublishBtn"]').focus();
      });
      await page.keyboard.press('Enter');
      assert.strictEqual(await page.evaluate(() => window.publishedCalled), undefined);
    });
    await browser.close();
  }

  console.log('\n[5] 모의 에디터 통합 테스트 (스크립트를 처음부터 끝까지 실제로 돌린다)');

  const { start } = require('./mock-server.js');
  const { spawn } = require('child_process');

  async function runAgainstMock(query, label) {
    const { server, port } = await start();
    const url = `http://127.0.0.1:${port}/mock-editor.html${query}`;
    const child = spawn(process.execPath, [
      path.join(ROOT, 'scripts', 'naver_draft.js'),
      path.join(__dirname, 'fixtures', 'mock-draft.json'),
      '--headless',
    ], {
      cwd: ROOT,
      env: {
        ...process.env,
        HTTP_PROXY: '', HTTPS_PROXY: '', http_proxy: '', https_proxy: '', NO_PROXY: '*', no_proxy: '*',
        NAVER_WRITE_URL: url,
        NAVER_PROFILE_DIR: path.join(os.tmpdir(), 'nb-mock-profile'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const code = await new Promise((r) => child.on('close', r));
    server.close();
    return { code, out, label };
  }

  const scenarios = [
    ['', '정상 동작'],
    ['?nochooser=1', '파일 선택창 가로채기 실패 → 숨은 input 폴백'],
    ['?noclass=1', '네이버가 클래스명을 전부 바꾼 상황 → 라벨 폴백'],
  ];

  for (const [q, label] of scenarios) {
    let res;
    try { res = await runAgainstMock(q, label); }
    catch (e) { console.log(`  ✘ ${label} → 실행 실패: ${e.message}`); fail++; continue; }

    const checks = [
      ['사진 2/2', /사진\s+2\/2\s+✔/],
      ['캡션 1/1', /캡션\s+1\/1\s+✔/],
      ['소제목 2/2', /소제목\s+2\/2\s+✔/],
      ['인용구 1/1', /인용구\s+1\/1\s+✔/],
      ['구분선 1/1', /구분선\s+1\/1\s+✔/],
      ['태그 3/3', /태그\s+3\/3/],
      ['제목 일치', /제목\s+일치/],
      ['임시저장', /임시저장\s+임시저장 클릭 완료/],
      ['전문대조 일치', /전문대조\s+✔/],
      ['발행 차단 0회', /발행가드\s+차단 0회/],
    ];
    const bad = checks.filter(([, re]) => !re.test(res.out)).map(([n]) => n);
    if (res.code === 0 && bad.length === 0) {
      console.log(`  ✔ ${label}`);
      pass++;
    } else {
      console.log(`  ✘ ${label} (exit ${res.code}) 실패 항목: ${bad.join(', ') || '없음'}`);
      console.log(res.out.split('\n').filter((l) => /✘|Error|실패/.test(l)).slice(0, 8).map((l) => '      ' + l).join('\n'));
      fail++;
    }
  }

  console.log(`\n  통과 ${pass} / 실패 ${fail}\n`);
  process.exit(fail ? 1 : 0);
})();
