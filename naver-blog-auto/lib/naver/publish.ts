import fs from "node:fs";
import path from "node:path";
import type { Browser, Frame, Locator, Page } from "playwright";
import type { Visibility } from "@/config";
import { newContext, closeQuietly } from "@/lib/playwright";
import { DIRS, ensureDirs } from "@/lib/paths";
import { EDITOR, NAVER, POST_URL_RE } from "@/lib/scrape/selectors";
import { getSettings } from "@/lib/settings";
import { publishedTodayCount, minutesSinceLastPublish } from "@/lib/db";
import type { Draft, Section } from "@/lib/types";

export type PublishStatus = "published" | "dry_run" | "failed" | "blocked";
export type PublishResult = {
  status: PublishStatus;
  blogUrl?: string;
  screenshot?: string;
  note: string;
};

type Log = (msg: string, level?: "info" | "warn" | "error") => void;

// ─────────────────────────────────────────────────────────────
// 텍스트 전처리
// ─────────────────────────────────────────────────────────────

/**
 * ⚠️ 7-8 — 스마트에디터는 입력 "중에" 마크다운을 서식으로 바꿔버린다.
 *    한국어 구어체의 물결표(~)가 특히 위험하다(취소선이 된다).
 *    AI 에게 쓰지 말라고 지시하는 것만으로는 부족해서, 타이핑 직전에 무력화한다.
 */
export function sanitizeForEditor(text: string): string {
  return text
    .replace(/~+/g, "～") // 전각 물결표로 (어감은 보존)
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
    .replace(/^[ \t]*>[ \t]+/gm, "")
    .replace(/^[ \t]*[-*+][ \t]+/gm, "");
}

/**
 * ⚠️ 7-25 (★) — 변이 선택자(VS16, U+FE0F)가 붙은 글자만 base 문자가 하나 더 남는다.
 *    `⚠️` 를 치면 `⚠⚠️` 로 들어간다. (U+26A0 단독·U+1F600·ZWJ 가족·한글은 정상)
 *
 * ⚠️ 해법의 함정: 고치겠다고 keyboard.insertText() 로 **문단 전체**를 넣으면
 *    이모지 하나만 남고 나머지 글이 통째로 사라진다(실측).
 *    → VS16 클러스터만 잘라서 그 조각만 insertText, 나머지는 명세대로 type.
 */
const HAS_VS16 = /\uFE0F/;
const VS16_CLUSTER = /([\s\S]\uFE0F\u20E3?)/;   // ⚠️ ❤️ ✔️ ☀️ 1️⃣

export function splitVS16(text: string): { part: string; useInsertText: boolean }[] {
  return text
    .split(VS16_CLUSTER)
    .filter((p) => p !== "" && p !== undefined)
    .map((part) => ({ part, useInsertText: HAS_VS16.test(part) }));
}

async function typeText(page: Page, text: string) {
  for (const { part, useInsertText } of splitVS16(text)) {
    if (useInsertText) await page.keyboard.insertText(part);
    else await page.keyboard.type(part, { delay: 7 });
  }
}

// ─────────────────────────────────────────────────────────────
// 셀렉터 헬퍼 — 후보 배열 중 보이는 첫 번째
// ─────────────────────────────────────────────────────────────

async function firstVisible(
  scope: Frame | Page,
  cands: readonly string[],
  timeout = 800,
): Promise<Locator | null> {
  for (const sel of cands) {
    const loc = scope.locator(sel).first();
    try {
      if (await loc.isVisible({ timeout })) return loc;
    } catch {
      /* 없는 셀렉터는 그냥 다음 후보로 */
    }
  }
  return null;
}

/**
 * ⚠️ 6-9 — clickAnywhere 는 선택이 아니라 필수다.
 *    발행 버튼과 공개 범위 라디오가 iframe 안에 있는지 밖에 있는지는 **환경에 따라 다르다.**
 *    이 문서를 쓴 환경에서는 iframe 밖, 다른 구현자의 환경에서는 안이었다.
 *    반드시 두 곳을 모두 뒤진다.
 */
async function findAnywhere(
  page: Page,
  frame: Frame,
  cands: readonly string[],
): Promise<Locator | null> {
  return (await firstVisible(frame, cands)) ?? (await firstVisible(page, cands));
}

async function clickAnywhere(page: Page, frame: Frame, cands: readonly string[]): Promise<boolean> {
  const el = await findAnywhere(page, frame, cands);
  if (!el) return false;
  try {
    await el.click({ timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// 오버레이 처리
// ─────────────────────────────────────────────────────────────

/**
 * ⚠️ 7-4 / 7-21 — 도움말 패널과 우측 라이브러리 도크를 닫는다.
 *    도크의 클래스 계열은 환경마다 다르다:
 *      ① 도움말 계열   .se-help-panel-close-button
 *      ② 사이드바 계열 .se-sidebar-close-button
 *      ③ 어느 쪽도 없으면 Escape
 *    한 환경에서는 ①로 함께 닫혔지만, 다른 환경에서는 사진 삽입 직후
 *    .se-help-panel-close-button 이 0개이고 .se-sidebar-close-button 만 있었다.
 */
async function closeOverlays(page: Page, frame: Frame, log?: Log) {
  let closed = 0;
  for (const sel of EDITOR.sidebarClose) {
    for (const scope of [frame, page] as (Frame | Page)[]) {
      const loc = scope.locator(sel);
      let n = 0;
      try {
        n = await loc.count();
      } catch {
        continue;
      }
      for (let i = 0; i < n; i++) {
        const one = loc.nth(i);
        try {
          if (await one.isVisible({ timeout: 500 })) {
            await one.click({ timeout: 3000 });
            closed++;
            await page.waitForTimeout(250);
          }
        } catch {
          /* 못 닫으면 아래 Escape 로 */
        }
      }
    }
  }
  if (!closed) {
    // 어느 계열도 없으면 Escape. 열려 있는 패널이 없을 수도 있으니 실패해도 조용히 넘어간다.
    const openPanel =
      (await firstVisible(frame, EDITOR.helpPanel, 400)) ??
      (await firstVisible(frame, EDITOR.sidebar, 400)) ??
      (await firstVisible(page, EDITOR.sidebar, 400));
    if (openPanel) {
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(250);
      log?.("우측 패널을 Escape 로 닫았습니다.");
    }
  }
}

/**
 * ⚠️ 7-1 (★최악) / 7-3 — '작성 중인 글이 있습니다' 복원 팝업.
 *    - 취소 버튼은 클래스 기반을 먼저 쓴다. `:has-text('취소')` 는 툴바의 '취소선' 버튼에
 *      부분일치해서, 취소선이 전역으로 켜진 채 글 전체가 타이핑된다.
 *    - 팝업과 함께 깔리는 .se-popup-dim 이 남아 있으면 이후 클릭이 조용히 무시된다.
 *    - 못 닫으면 진행하지 말고 실패로 처리한다(팝업이 떠 있으면 입력 자체가 안 된다).
 */
async function dismissRestorePopup(
  page: Page,
  frame: Frame,
  log: Log,
): Promise<{ ok: boolean; reason?: string }> {
  const popup = await firstVisible(frame, EDITOR.restorePopup, 1500);
  if (!popup) return { ok: true };

  log("작성 중이던 글 팝업이 떠서 닫고 새 글로 시작합니다.");
  const cancel = await firstVisible(frame, EDITOR.restoreCancel, 1200);
  if (cancel) {
    await cancel.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(700);
  }

  // 차단막이 실제로 사라졌는지 확인한다.
  const dim = await firstVisible(frame, EDITOR.popupDim, 700);
  const stillPopup = await firstVisible(frame, EDITOR.restorePopup, 700);
  if (dim || stillPopup) {
    return { ok: false, reason: "작성 중이던 글 팝업을 닫지 못했습니다." };
  }
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────
// 컴포넌트 탈출 클릭
// ─────────────────────────────────────────────────────────────

/**
 * ⚠️ 7-5 — 인용구·구분선·캡션 같은 컴포넌트 안에서는 **어떤 키로도 탈출되지 않는다.**
 *    (ArrowDown / Enter 두 번 / Escape / Ctrl+End 전부 실패했다.
 *     더 나쁜 것: 인용구 안에서 '본문' 서식을 적용하면 인용구가 통째로 평범한 텍스트로 환원된다.)
 *    유일한 해결은 마우스로 마지막 컴포넌트 아래 빈 영역을 클릭하는 것이다.
 *
 * ⚠️ 7-6 — 그 y 좌표를 아무렇게나 잡으면 화면 맨 아래 '글감 검색바'를 눌러버린다.
 *    그러면 이후 캡션이 검색창에 타이핑되고 글감 패널이 열린다. 실제 위치를 재서 클램프한다.
 *
 * ⚠️ 7-27 — boundingBox() 는 요소가 없으면 Playwright 기본 30초를 기다린다.
 *    탈출 클릭은 인용구·구분선·캡션마다 있어서 누적된다(실행이 44초 → 5분 초과가 된 사례).
 *    모든 boundingBox 에 timeout 800 을 주고, 같은 값을 반복해 재지 말고 한 번 재서 재사용한다.
 */
async function exitToNewParagraph(page: Page, frame: Frame, log?: Log) {
  const box = async (loc: Locator) => loc.boundingBox({ timeout: 800 }).catch(() => null);

  const comps = frame.locator(EDITOR.contentComponents[0]);
  let n = 0;
  try {
    n = await comps.count();
  } catch {
    return;
  }
  if (!n) return;

  const vh = page.viewportSize()?.height ?? 900;
  // 하단 글감 검색바는 고정 위치라 움직이지 않는다 — 한 번만 재서 재사용한다(7-27).
  const toolbarBox = await box(frame.locator(EDITOR.bottomToolbar[0]).first());
  const maxY = Math.min(toolbarBox ? toolbarBox.y - 20 : vh - 150, vh - 20);

  for (let attempt = 0; attempt < 2; attempt++) {
    // 마지막 컴포넌트 위치는 스크롤하면 바뀌므로 시도마다 다시 잰다.
    const lbox = await box(comps.last());
    if (!lbox) return;

    const bottom = lbox.y + lbox.height;
    const wantY = bottom + 30;
    /**
     * ⚠️ 클릭이 마지막 컴포넌트 "안"에 떨어지면 안 된다.
     *    틀린 클램프: maxY 를 `.se-content` 의 아래쪽(canvasBottom)으로 잡았더니,
     *    본문 높이가 마지막 컴포넌트에서 끝나는 경우 클램프된 y 가 컴포넌트 내부가 됐다.
     *    실측(하네스): 캡션 뒤 탈출 클릭이 (324,521) → DIV.se-caption 을 눌러
     *    다음 문단이 캡션 안으로 들어가 한 컴포넌트로 합쳐졌다(7-18 의 그 증상).
     *    canvasBottom 은 `.se-content` 박스가 아니라 "글을 쓰는 캔버스"다 —
     *    캔버스는 마지막 컴포넌트 아래로 더 이어진다. 그래서 뷰포트와 글감 검색바로만 제한한다.
     */
    const minY = bottom + 8;
    if (minY <= maxY) {
      const x = lbox.x + Math.min(Math.max(lbox.width / 2, 40), 300);
      const y = Math.max(140, Math.min(wantY, maxY));
      await page.mouse.click(x, y);
      await page.waitForTimeout(200);
      return;
    }

    if (attempt === 0) {
      // 아래 여백이 없으면 공간을 만든 뒤 다시 계산한다(7-5).
      await page.mouse.wheel(0, 250);
      await page.waitForTimeout(300);
      continue;
    }

    // 끝내 여백이 없으면 **클릭하지 않는다.**
    // 컴포넌트 안을 누르면 다음 글이 그 안으로 들어가 합쳐진다 — 안 누르는 편이 낫다.
    log?.("문단을 빠져나올 빈 공간을 찾지 못했습니다.", "warn");
    return;
  }
}

// ─────────────────────────────────────────────────────────────
// 포커스 확인
// ─────────────────────────────────────────────────────────────

/** 지금 커서가 "제목 칸"에 있는지 — 7-26 을 잡는 신호 */
async function focusInfo(frame: Frame) {
  return frame.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    if (!a) return { inTitle: false, editable: false, cls: "", tag: "" };
    const inTitle = !!a.closest(".se-section-documentTitle, .se-documentTitle, .se-title-text");
    return {
      inTitle,
      editable: a.isContentEditable || a.tagName === "INPUT" || a.tagName === "TEXTAREA",
      cls: typeof a.className === "string" ? a.className : "",
      tag: a.tagName,
    };
  });
}

// ─────────────────────────────────────────────────────────────
// 서식
// ─────────────────────────────────────────────────────────────

/** 문단서식 드롭다운을 열고 옵션 하나를 고른다. 드롭다운 애니메이션 때문에 대기가 필요하다. */
async function applyParagraphFormat(page: Page, frame: Frame, option: readonly string[]) {
  const opened = await clickAnywhere(page, frame, EDITOR.textFormatOpen);
  if (!opened) return false;
  await page.waitForTimeout(350);
  const ok = await clickAnywhere(page, frame, option);
  await page.waitForTimeout(350);
  return ok;
}

/** 형광펜(노랑) 켜기/끄기. 인라인 서식은 "클릭 이후 새로 입력되는 글자"에 적용된다(실측). */
async function setHighlight(page: Page, frame: Frame, on: boolean) {
  const opened = await clickAnywhere(page, frame, EDITOR.bgColorOpen);
  if (!opened) return false;
  await page.waitForTimeout(300);
  const ok = await clickAnywhere(page, frame, on ? EDITOR.bgColorYellow : EDITOR.bgColorNone);
  await page.waitForTimeout(300);
  return ok;
}

async function toggleBold(page: Page, frame: Frame) {
  const ok = await clickAnywhere(page, frame, EDITOR.bold);
  await page.waitForTimeout(250);
  return ok;
}

// ─────────────────────────────────────────────────────────────
// 이미지 + 캡션
// ─────────────────────────────────────────────────────────────

/**
 * ⚠️ 7-7 (★) — page.waitForEvent("filechooser") 같은 일회성 리스너가 만료된 뒤
 *    이미지 버튼을 누르면 Playwright 가 가로채지 못해 **OS 네이티브 파일 대화상자**가 뜬다.
 *    그 창은 브라우저를 블로킹하고 자동화는 볼 수도 닫을 수도 없다(7분 정지, CPU 0%, 에러도 없음).
 *    플랫폼 무관이다. 페이지를 열기 **전에** 영구 핸들러를 등록하는 것이 양쪽 모두의 정답이다.
 */
type PendingUpload = { path: string | null; done: boolean };

async function insertImage(
  page: Page,
  frame: Frame,
  pending: PendingUpload,
  filePath: string,
  caption: string | undefined,
  log: Log,
): Promise<{ imageOk: boolean; captionOk: boolean }> {
  pending.path = filePath;
  pending.done = false;

  const clicked = await clickAnywhere(page, frame, EDITOR.imageButton);
  if (!clicked) {
    pending.path = null;
    log("사진 넣기 버튼을 찾지 못해 이 사진은 건너뜁니다.", "warn");
    return { imageOk: false, captionOk: false };
  }

  // 업로드 완료 폴링(최대 20초)
  const deadline = Date.now() + 20_000;
  while (!pending.done && Date.now() < deadline) await page.waitForTimeout(200);
  pending.path = null;
  if (!pending.done) {
    log("사진 업로드가 20초 안에 끝나지 않아 건너뜁니다.", "warn");
    return { imageOk: false, captionOk: false };
  }
  await page.waitForTimeout(2600);

  // 사진을 넣으면 우측 도크가 자동으로 열린다(7-21).
  await closeOverlays(page, frame, log);

  if (!caption) {
    await exitToNewParagraph(page, frame, log);
    return { imageOk: true, captionOk: true };
  }

  /**
   * ⚠️ 7-18 — 업로드 직후 .se-caption 은 DOM 에 있지만 0×0 이라 곧바로 클릭할 수 없다.
   *    방금 넣은(=마지막) 이미지 컴포넌트를 클릭해야 펼쳐지고, 그때 `se-is-on` 이 붙는다.
   *    ⚠️ 크기 숫자를 판정 기준으로 쓰지 마라 — 환경에 따라 640×24 이기도 64×63 이기도 했다.
   *       se-is-on 클래스가 붙는 것이 "펼쳐졌다"의 안정적인 신호다.
   *    ⚠️ el.focus() 로 우회하려 하지 마라. activeElement 가 안 바뀌어 글자가 사라진다.
   */
  const comp = frame.locator(EDITOR.imageComponent[0]).last();
  try {
    await comp.click({ timeout: 5000 });
  } catch {
    /* 아래 폴백 사다리로 */
  }
  await page.waitForTimeout(600);

  const capInComp = comp.locator(EDITOR.caption[0]).first();
  const capAny = frame.locator(EDITOR.caption[0]).last();
  let cap: Locator | null = null;
  for (const c of [capInComp, capAny]) {
    try {
      const cls = await c.getAttribute("class", { timeout: 800 });
      if (cls && cls.includes("se-is-on")) {
        cap = c;
        break;
      }
      if (await c.isVisible({ timeout: 500 })) {
        cap = c;
        break;
      }
    } catch {
      /* 다음 후보 */
    }
  }

  if (!cap) {
    // 폴백 사다리 ② — 캡션을 포기하고 경고만 남긴다.
    //   본문에 그냥 타이핑하면 사진 설명이 아니라 본문 줄이 되고 다음 문단과 합쳐진다.
    //   넣는 것보다 빼는 게 낫다. ③ 이미지는 이미 들어갔으므로 발행은 계속 진행한다.
    log("사진 설명 칸이 열리지 않아 이 사진의 설명은 넣지 않았습니다.", "warn");
    await exitToNewParagraph(page, frame, log);
    return { imageOk: true, captionOk: false };
  }

  await cap.click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);
  await typeText(page, sanitizeForEditor(caption));
  await page.waitForTimeout(200);

  // 캡션도 컴포넌트 안이다 — 7-5 의 마우스 탈출을 여기서도 해야
  // 다음 문단이 캡션에 붙지 않는다.
  await exitToNewParagraph(page, frame, log);
  return { imageOk: true, captionOk: true };
}

// ─────────────────────────────────────────────────────────────
// 스크린샷
// ─────────────────────────────────────────────────────────────

/**
 * ⚠️ 7-20 — fullPage:true 만으로는 마지막 한 화면(900px)밖에 안 담긴다.
 *    에디터 iframe 문서의 scrollHeight === clientHeight === 뷰포트 높이라 fullPage 가 무의미하다.
 *    → .se-content 의 **scrollHeight** 만큼 뷰포트를 키우고 찍은 뒤 되돌린다.
 *    ⚠️ boundingBox().height 로 계산하지 마라 — 실측 761 vs 3637, 5배 차이다.
 */
async function fullScreenshot(page: Page, frame: Frame, outPath: string, log: Log): Promise<string[]> {
  const original = page.viewportSize() ?? { width: 1366, height: 900 };
  const files: string[] = [];
  try {
    const content = frame.locator(EDITOR.content[0]).first();
    const cbox = await content.boundingBox({ timeout: 800 }).catch(() => null);
    const scrollHeight = await content
      .evaluate((el) => (el as HTMLElement).scrollHeight)
      .catch(() => 0);

    if (scrollHeight > 0) {
      const want = Math.min(9000, Math.round((cbox?.y ?? 0) + scrollHeight + 160));
      await page.setViewportSize({ width: original.width, height: Math.max(original.height, want) });
      await page.waitForTimeout(1200);
      await page.screenshot({ path: outPath, fullPage: true });
      files.push(outPath);
      return files;
    }

    // 폴백 ② — iframe 문서가 자체 스크롤을 갖는 환경이면 한 화면씩 여러 장 찍는다.
    const doc = await frame
      .evaluate(() => ({
        scroll: document.documentElement.scrollHeight,
        client: document.documentElement.clientHeight,
      }))
      .catch(() => null);
    if (doc && doc.scroll > doc.client) {
      await frame.evaluate(() => window.scrollTo(0, 0));
      const pages = Math.min(8, Math.ceil(doc.scroll / doc.client));
      for (let i = 0; i < pages; i++) {
        const f = outPath.replace(/\.png$/, `-${i + 1}.png`);
        await page.screenshot({ path: f });
        files.push(f);
        await frame.evaluate((h) => window.scrollBy(0, h), doc.client);
        await page.waitForTimeout(400);
      }
      return files;
    }

    // 폴백 ③ — 보이는 화면이라도 저장하고, 일부만 담겼음을 로그에 명시한다.
    await page.screenshot({ path: outPath });
    files.push(outPath);
    log("스크린샷이 일부만 담겼습니다 — 글 전체 높이를 재지 못했습니다.", "warn");
    return files;
  } catch (e) {
    log(`스크린샷을 저장하지 못했습니다: ${(e as Error).message}`, "warn");
    return files;
  } finally {
    await page.setViewportSize(original).catch(() => {});
    await page.waitForTimeout(400);
  }
}

// ─────────────────────────────────────────────────────────────
// 공개 범위
// ─────────────────────────────────────────────────────────────

/**
 * ⚠️ 7-19 (★) — radio input 은 opacity:0 이라 클릭되지 않는다. label 을 눌러야 한다.
 *    그리고 **네이버 발행 레이어의 기본값은 전체공개**다.
 *    label 클릭 후 input.checked 를 직접 읽어 확인하고, 확인되지 않으면 발행하지 말고 중단한다.
 *    ⚠️ 절대 "일단 발행하고 나중에 바꾸자"로 가지 마라 — 되돌릴 수 없다.
 */
async function selectVisibility(
  page: Page,
  frame: Frame,
  visibility: Visibility,
  log: Log,
): Promise<{ ok: boolean; reason?: string }> {
  const spec = EDITOR.visibility[visibility];

  const label = await findAnywhere(page, frame, [spec.label]);
  if (!label) {
    return { ok: false, reason: "공개 범위 선택 항목을 찾지 못했습니다." };
  }
  await label.click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(400);

  // input.checked 를 직접 읽는다. isChecked() 는 opacity:0 요소에서도 값을 읽어준다.
  for (const scope of [frame, page] as (Frame | Page)[]) {
    const input = scope.locator(spec.input).first();
    try {
      if ((await input.count()) === 0) continue;
      const checked = await input.evaluate((el) => (el as HTMLInputElement).checked, {
        timeout: 2000,
      });
      if (checked) {
        log(`공개 범위를 확인했습니다.`);
        return { ok: true };
      }
      return { ok: false, reason: "공개 범위가 선택되지 않았습니다." };
    } catch {
      /* 다음 스코프 */
    }
  }
  return { ok: false, reason: "공개 범위를 확인할 수 없었습니다." };
}

// ─────────────────────────────────────────────────────────────
// 발행 가드
// ─────────────────────────────────────────────────────────────

export function checkPublishGuards(): { ok: boolean; reason?: string } {
  const s = getSettings();
  if (s.killSwitch) return { ok: false, reason: "전체 중단이 켜져 있어 발행하지 않았습니다." };

  const today = publishedTodayCount();
  if (today >= s.dailyPublishLimit) {
    return {
      ok: false,
      reason: `오늘 발행 한도(${s.dailyPublishLimit}편)를 채워서 발행하지 않았습니다.`,
    };
  }

  const since = minutesSinceLastPublish();
  if (since !== null && since < s.minPublishIntervalMin) {
    const wait = Math.ceil(s.minPublishIntervalMin - since);
    return { ok: false, reason: `최소 발행 간격이 남아 있어 발행하지 않았습니다(약 ${wait}분 뒤).` };
  }
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────
// 본체
// ─────────────────────────────────────────────────────────────

export type PublishArgs = {
  jobId: number;
  draft: Draft;
  /** 섹션 index → 로컬 사진 경로 */
  imageBySection: Map<number, string>;
  blogId: string;
  dryRun: boolean;
  visibility: Visibility;
  /** 체험단·브랜딩 유형은 heading 도 인용구로 처리한다 */
  headingAsQuote: boolean;
  showBrowser: boolean;
  /** 테스트 전용 — 로컬 하네스(9장 6.5-a)에 붙이기 위한 진입 주소 */
  entryUrl?: string;
  /** 테스트 전용 — 브라우저를 닫기 직전에 페이지 상태를 재기 위한 훅 */
  inspect?: (page: Page, frame: Frame) => Promise<void>;
  log: Log;
};

export async function publishPost(args: PublishArgs): Promise<PublishResult> {
  const { log } = args;
  ensureDirs();

  // 발행 가드는 연습 모드가 아닐 때만 검사한다.
  if (!args.dryRun) {
    const guard = checkPublishGuards();
    if (!guard.ok) return { status: "blocked", note: guard.reason! };
  }

  let browser: Browser | null = null;
  let pageRef: Page | null = null;
  let frameRef: Frame | null = null;
  const shotPath = path.join(DIRS.shots, `job${args.jobId}-${Date.now()}.png`);

  try {
    const ctx = await newContext({
      headless: !args.showBrowser,
      useNaverSession: !args.entryUrl,
    });
    browser = ctx.browser;
    const page = await ctx.context.newPage();
    pageRef = page;

    // ① ⚠️ 7-7 — 파일 선택 핸들러는 페이지를 열기 "전에" 영구 등록한다.
    const pending: PendingUpload = { path: null, done: false };
    page.on("filechooser", async (chooser) => {
      try {
        if (pending.path) await chooser.setFiles(pending.path);
      } catch {
        /* 실패해도 폴링이 풀리도록 finally 로 done 을 세운다 */
      } finally {
        pending.done = true;
      }
    });

    // ② 에디터 진입
    const entry = args.entryUrl ?? NAVER.write(args.blogId);
    await page.goto(entry, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(2500);

    if (!args.entryUrl && /nid\.naver\.com/.test(page.url())) {
      return { status: "failed", note: "네이버 로그인이 풀려서 글쓰기 화면에 들어가지 못했습니다." };
    }

    const frameEl = await page.$(EDITOR.frame);
    const frame = (frameEl ? await frameEl.contentFrame() : null) ?? page.mainFrame();
    frameRef = frame;

    // ③ 복원 팝업
    const popup = await dismissRestorePopup(page, frame, log);
    if (!popup.ok) {
      await page.screenshot({ path: shotPath }).catch(() => {});
      return { status: "failed", screenshot: shotPath, note: popup.reason! };
    }

    // ④ 도움말/온보딩 패널
    await closeOverlays(page, frame, log);

    // ⑤ 제목 → 본문 → 섹션
    const titleEl = await firstVisible(frame, EDITOR.title, 3000);
    if (!titleEl) {
      await page.screenshot({ path: shotPath }).catch(() => {});
      return { status: "failed", screenshot: shotPath, note: "제목 칸을 찾지 못했습니다." };
    }
    await titleEl.click({ timeout: 5000 });
    await page.waitForTimeout(300);
    await typeText(page, sanitizeForEditor(args.draft.title));
    await page.waitForTimeout(300);

    /**
     * ⚠️ 7-26 — 본문 영역을 못 찾았을 때 "Enter 치면 본문으로 가겠지" 하고 넘어가면
     *    **글 전체가 제목 칸에 들어간다.** 에러도 안 나고 스크린샷을 봐야만 안다.
     *    → Enter 로 한 번 더 시도하고, 그래도 본문 포커스가 확인되지 않으면
     *      스크린샷을 남기고 즉시 실패 처리한다. 조용히 진행하는 것이 최악이다.
     */
    let body = await firstVisible(frame, EDITOR.body, 2000);
    if (body) {
      await body.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(400);
    }
    let focus = await focusInfo(frame);
    if (focus.inTitle || !focus.editable) {
      await page.keyboard.press("Enter");
      await page.waitForTimeout(600);
      body = await firstVisible(frame, EDITOR.body, 2000);
      if (body) {
        await body.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(400);
      }
      focus = await focusInfo(frame);
    }
    if (focus.inTitle || !focus.editable) {
      await page.screenshot({ path: shotPath }).catch(() => {});
      return {
        status: "failed",
        screenshot: shotPath,
        note: "본문 입력 칸에 들어가지 못해 중단했습니다. 그대로 진행하면 글 전체가 제목 칸에 들어갑니다.",
      };
    }

    let captionsFailed = 0;
    let imagesFailed = 0;

    for (let i = 0; i < args.draft.sections.length; i++) {
      const s: Section = args.draft.sections[i];

      if (s.type === "image") {
        const file = args.imageBySection.get(i);
        if (!file || !fs.existsSync(file)) continue; // 사진을 못 구한 자리는 그냥 건너뛴다
        const r = await insertImage(page, frame, pending, file, s.caption, log);
        if (!r.imageOk) imagesFailed++;
        if (!r.captionOk) captionsFailed++;
        continue;
      }

      if (s.type === "divider") {
        await clickAnywhere(page, frame, EDITOR.dividerInsert);
        await page.waitForTimeout(400);
        // 구분선도 컴포넌트다 — 마우스로 탈출해야 다음 문단이 딸려 들어가지 않는다(7-5).
        await exitToNewParagraph(page, frame, log);
        continue;
      }

      if (s.type === "quote" || (s.type === "heading" && args.headingAsQuote)) {
        // ⚠️ 7-5 덤 — 툴바의 인용구 '컴포넌트 삽입' 버튼보다,
        //    텍스트를 먼저 치고 Shift+Home 으로 선택한 뒤 문단 서식으로 적용하는 편이 훨씬 안정적이다.
        await typeText(page, sanitizeForEditor(s.text));
        await page.waitForTimeout(200);
        await page.keyboard.press("Shift+Home");
        await page.waitForTimeout(200);
        await applyParagraphFormat(page, frame, EDITOR.optQuote);
        await exitToNewParagraph(page, frame, log);
        continue;
      }

      if (s.type === "heading") {
        await applyParagraphFormat(page, frame, EDITOR.optHeading);
        await typeText(page, sanitizeForEditor(s.text));
        await page.keyboard.press("Enter");
        await page.waitForTimeout(250);
        await applyParagraphFormat(page, frame, EDITOR.optBody); // 본문으로 복귀
        continue;
      }

      // paragraph
      const text = sanitizeForEditor(s.text);
      // ⚠️ 7-24 이중 방어 — 타이핑 직전에 한 번 더 확인하고, 못 찾으면 형광펜을 생략한다.
      const hl = s.highlight ? sanitizeForEditor(s.highlight) : "";
      const at = hl ? text.indexOf(hl) : -1;
      if (hl && at >= 0) {
        await typeText(page, text.slice(0, at));
        // 인라인 서식은 "클릭 이후 새로 입력되는 글자"에 적용된다(선택 후 적용이 아니다).
        await setHighlight(page, frame, true);
        await toggleBold(page, frame);
        await typeText(page, hl);
        await toggleBold(page, frame);
        await setHighlight(page, frame, false);
        await typeText(page, text.slice(at + hl.length));
      } else {
        await typeText(page, text);
      }
      await page.keyboard.press("Enter");
      await page.keyboard.press("Enter");
      await page.waitForTimeout(150);
    }

    // ⑥ 스크린샷 "앞" 오버레이 닫기
    await closeOverlays(page, frame, log);
    await page.waitForTimeout(400);

    // ⑦ 발행 직전 전체 스크린샷
    const shots = await fullScreenshot(page, frame, shotPath, log);
    const shot = shots[0];

    const noteBits: string[] = [];
    if (imagesFailed) noteBits.push(`사진 ${imagesFailed}장을 넣지 못했습니다`);
    if (captionsFailed) noteBits.push(`사진 설명 ${captionsFailed}개를 넣지 못했습니다`);

    // ⑧ 연습 모드면 여기서 종료
    if (args.dryRun) {
      return {
        status: "dry_run",
        screenshot: shot,
        note: ["연습 모드라 발행하지 않고 완성 화면만 저장했습니다.", ...noteBits].join(" / "),
      };
    }

    // ⑨ 스크린샷 "뒤" 다시 한 번 닫기 — 촬영 이후 재차 열렸을 수 있다.
    await closeOverlays(page, frame, log);
    await page.waitForTimeout(300);

    // ⑩ 발행 버튼
    const opened = await clickAnywhere(page, frame, EDITOR.publishOpen);
    if (!opened) {
      return { status: "failed", screenshot: shot, note: "발행 버튼을 찾지 못했습니다." };
    }
    await page.waitForTimeout(1200);

    // ⑪ 공개 범위 — 확인되지 않으면 발행하지 않는다.
    const vis = await selectVisibility(page, frame, args.visibility, log);
    if (!vis.ok) {
      return {
        status: "failed",
        screenshot: shot,
        note: `${vis.reason} 잘못된 공개 범위로 나가는 것을 막기 위해 발행하지 않고 멈췄습니다. 글은 임시저장 상태로 남아 있습니다.`,
      };
    }

    // ⑫ 최종 확인
    const confirmed = await clickAnywhere(page, frame, EDITOR.publishConfirm);
    if (!confirmed) {
      return { status: "failed", screenshot: shot, note: "최종 발행 버튼을 찾지 못했습니다. 글은 임시저장 상태로 남아 있습니다." };
    }

    /**
     * ⚠️ 7-11 — 발행 버튼을 눌렀다는 사실은 발행됐다는 뜻이 아니다.
     *    한 번은 blog_url 에 글쓰기 URL 이 그대로 기록돼 "발행 완료"로 표시됐는데
     *    실제로는 임시저장이었다. 게시글 주소로 바뀌는지 20초간 폴링한다.
     */
    const deadline = Date.now() + 20_000;
    let finalUrl = "";
    while (Date.now() < deadline) {
      finalUrl = page.url();
      if (POST_URL_RE.test(finalUrl)) break;
      await page.waitForTimeout(700);
    }

    if (!POST_URL_RE.test(finalUrl)) {
      return {
        status: "failed",
        screenshot: shot,
        note: "발행 버튼을 눌렀지만 게시글 주소가 나오지 않았습니다. 글은 임시저장 상태로 남아 있습니다.",
      };
    }

    return {
      status: "published",
      blogUrl: finalUrl,
      screenshot: shot,
      note: ["발행했습니다.", ...noteBits].join(" / "),
    };
  } catch (e) {
    return { status: "failed", note: `발행 중 문제가 생겼습니다: ${(e as Error).message}` };
  } finally {
    if (args.inspect && pageRef && frameRef) {
      await args.inspect(pageRef, frameRef).catch(() => {});
    }
    await closeQuietly(browser);
  }
}
