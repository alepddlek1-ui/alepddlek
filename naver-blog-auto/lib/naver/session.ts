import fs from "node:fs";
import { newContext, closeQuietly } from "@/lib/playwright";
import { DIRS, ensureDirs } from "@/lib/paths";
import { NAVER } from "@/lib/scrape/selectors";

export type SessionState = {
  ok: boolean;
  blogId?: string;
  /** 읽기는 되는데 글쓰기만 만료된 상태(7-10) */
  writeOk?: boolean;
  reason?: string;
  checkedAt: number;
};

let cache: SessionState | null = null;
const TTL_MS = 5 * 60 * 1000; // 검증은 브라우저를 띄우므로 5분 캐시
let loginInFlight = false;

export function invalidateSessionCache() {
  cache = null;
}

export function hasSessionFile() {
  return fs.existsSync(DIRS.storageState);
}

export function logout() {
  invalidateSessionCache();
  try {
    fs.rmSync(DIRS.storageState, { force: true });
  } catch {
    /* 없으면 무시 */
  }
}

/**
 * 로그인 창을 띄운다. ⚠️ 자동화하지 않는다(2-4) — 보안문자·2차인증 때문이다.
 * 사용자가 직접 로그인하면 NID_SES 쿠키가 생기고, 그때 storageState 를 저장한다.
 */
export async function loginInteractive(): Promise<{ ok: boolean; message: string }> {
  if (loginInFlight) return { ok: false, message: "로그인 창이 이미 열려 있습니다." };
  loginInFlight = true;
  ensureDirs();

  let browser = null;
  try {
    // 로그인 창은 사람이 직접 쓰는 창이다 — 컴퓨터에 깔린 진짜 크롬/엣지를 먼저 시도한다.
    const r = await newContext({
      headless: false,
      useNaverSession: false,
      preferSystemBrowser: true,
    });
    browser = r.browser;
    const context = r.context;
    const page = await context.newPage();
    await page.goto(NAVER.login, { waitUntil: "domcontentloaded" });

    const deadline = Date.now() + 5 * 60 * 1000; // 최대 5분
    let got = false;
    while (Date.now() < deadline) {
      if (page.isClosed()) break; // 사용자가 창을 닫으면 즉시 중단
      const cookies = await context.cookies();
      if (cookies.some((c) => c.name === "NID_SES" && c.value)) {
        got = true;
        break;
      }
      await page.waitForTimeout(1000);
    }

    if (!got) {
      return {
        ok: false,
        message: page.isClosed()
          ? "로그인 창이 닫혀서 중단했습니다."
          : "5분 안에 로그인이 끝나지 않아 중단했습니다.",
      };
    }

    // 쿠키 안정화를 위해 네이버 메인을 한 번 들른 뒤 저장한다.
    await page.goto(NAVER.home, { waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForTimeout(1200);
    await context.storageState({ path: DIRS.storageState });
    invalidateSessionCache();
    return { ok: true, message: "로그인 정보를 저장했습니다." };
  } catch (e) {
    return { ok: false, message: `로그인 중 문제가 생겼습니다: ${(e as Error).message}` };
  } finally {
    await closeQuietly(browser);
    loginInFlight = false;
  }
}

/**
 * 세션 검증.
 * ⚠️ 7-9 — naver.com 은 로그인 상태에서도 nidlogin 링크가 남아 있다. 그걸로 판정하면 항상 "만료"가 된다.
 * ⚠️ 7-10 — 읽기는 되는데 글쓰기만 만료된 상태가 실제로 있다("로그인 상태 유지" 미체크).
 *            그래서 2단계로 글쓰기 페이지까지 열어본다.
 */
export async function verifySession(force = false): Promise<SessionState> {
  if (!force && cache && Date.now() - cache.checkedAt < TTL_MS) return cache;
  if (!hasSessionFile()) {
    cache = { ok: false, reason: "아직 네이버에 로그인하지 않았습니다.", checkedAt: Date.now() };
    return cache;
  }

  let browser = null;
  try {
    const r = await newContext({ headless: true, useNaverSession: true });
    browser = r.browser;
    const page = await r.context.newPage();

    // 1단계: 내 블로그로 이동 → nid.naver.com 으로 튕기면 만료
    await page.goto(NAVER.myBlog, { waitUntil: "domcontentloaded", timeout: 25_000 });
    await page.waitForTimeout(800);
    let url = page.url();
    if (/nid\.naver\.com/.test(url)) {
      cache = { ok: false, reason: "네이버 로그인이 풀렸습니다.", checkedAt: Date.now() };
      return cache;
    }

    const m = url.match(/blog\.naver\.com\/([^/?#]+)/);
    const blogId = m?.[1];
    if (!blogId || blogId === "MyBlog.naver") {
      cache = {
        ok: false,
        reason: "블로그 주소를 확인하지 못했습니다. 블로그가 개설돼 있는지 확인해 주세요.",
        checkedAt: Date.now(),
      };
      return cache;
    }

    // 2단계: 글쓰기 페이지까지 열어본다. 여기서 튕기면 "글쓰기 권한 만료".
    await page.goto(NAVER.write(blogId), { waitUntil: "domcontentloaded", timeout: 25_000 });
    await page.waitForTimeout(1200);
    url = page.url();
    const writeOk = !/nid\.naver\.com/.test(url);

    cache = {
      ok: writeOk,
      blogId,
      writeOk,
      reason: writeOk
        ? undefined
        : '글쓰기 권한이 만료됐습니다. 다시 로그인할 때 "로그인 상태 유지"를 켜주세요.',
      checkedAt: Date.now(),
    };
    return cache;
  } catch (e) {
    cache = {
      ok: false,
      reason: `세션을 확인하지 못했습니다: ${(e as Error).message}`,
      checkedAt: Date.now(),
    };
    return cache;
  } finally {
    await closeQuietly(browser);
  }
}
