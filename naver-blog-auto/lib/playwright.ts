import fs from "node:fs";
import { spawn } from "node:child_process";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { DIRS } from "@/lib/paths";

/**
 * ⚠️ User-Agent 는 **실제로 돌고 있는 운영체제와 같아야 한다.**
 *    틀린 코드: macOS UA 를 상수로 박아두고 모든 플랫폼에서 그대로 보냈다.
 *    그러면 윈도우에서 "나는 맥이다"라고 말하면서 브라우저 내부 값은 전부 윈도우로 나와,
 *    네이버 로그인 페이지가 "현재 서비스 접속이 불가합니다"로 막는다(실제로 막혔다).
 *    UA 만 갈아끼우고 나머지를 그대로 두는 것이 오히려 가장 눈에 띄는 신호다.
 */
function uaFor(chromeVersion: string): string {
  const v = chromeVersion || "131.0.0.0";
  const tail = `AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36`;
  if (process.platform === "win32") return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) ${tail}`;
  if (process.platform === "darwin") return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ${tail}`;
  return `Mozilla/5.0 (X11; Linux x86_64) ${tail}`;
}

/** browser.version() 은 "HeadlessChrome/141.0.7390.54" 처럼 온다. 숫자만 뽑는다. */
function versionOf(browser: Browser): string {
  const m = browser.version().match(/[\d.]+/);
  return m ? m[0] : "131.0.0.0";
}

// ⚠️ 설치 Promise 를 모듈 레벨에 캐싱해 중복 설치를 막는다.
let installing: Promise<void> | null = null;

function installChromium(): Promise<void> {
  if (installing) return installing;
  installing = new Promise<void>((resolve, reject) => {
    console.log("[playwright] chromium 이 없어 설치를 시작합니다. 몇 분 걸릴 수 있습니다.");
    // ⚠️ 윈도우에서는 npx 도 셸 심이라 shell:true 가 필요하다(11장 2번).
    const p = spawn("npx", ["playwright", "install", "chromium"], {
      shell: process.platform === "win32",
      stdio: "inherit",
    });
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`chromium 설치가 코드 ${code} 로 끝났습니다.`)),
    );
  });
  return installing;
}

/**
 * ⚠️ 자동화 표식을 끈다.
 *    Playwright 가 기본으로 켜는 --enable-automation 과 navigator.webdriver 는
 *    "사람이 아니라 프로그램이 열었다"고 사이트에 알려주는 값이다.
 *    이 앱에서 브라우저를 여는 이유는 **사용자가 직접 자기 계정에 로그인하기 위해서**이고
 *    (2-4: 로그인은 자동화하지 않는다), 그 창이 아예 안 열리면 로그인 자체가 불가능하다.
 */
const LAUNCH_ARGS = ["--disable-blink-features=AutomationControlled"];
const IGNORE_ARGS = ["--enable-automation"];

/**
 * 로그인 창은 **사용자 컴퓨터에 이미 깔린 진짜 크롬/엣지**로 여는 편이 훨씬 잘 열린다.
 * 없으면 앱이 받아둔 브라우저로 넘어간다.
 */
const CHANNELS = ["chrome", "msedge"] as const;

async function launchBrowser(opts: {
  headless: boolean;
  preferSystemBrowser?: boolean;
}): Promise<Browser> {
  const executablePath = process.env.CHROMIUM_PATH || undefined;
  const base = {
    headless: opts.headless,
    args: LAUNCH_ARGS,
    ignoreDefaultArgs: IGNORE_ARGS,
  };

  if (opts.preferSystemBrowser && !executablePath) {
    for (const channel of CHANNELS) {
      try {
        return await chromium.launch({ ...base, channel });
      } catch {
        // 그 브라우저가 안 깔려 있으면 다음 후보로
      }
    }
  }

  try {
    return await chromium.launch({ ...base, executablePath });
  } catch (e) {
    const msg = (e as Error).message ?? "";
    // 브라우저가 안 깔려 있으면 자동으로 설치하고 한 번만 재시도한다.
    if (/Executable doesn'?t exist|please run|install/i.test(msg)) {
      await installChromium();
      return chromium.launch({ ...base, executablePath });
    }
    throw e;
  }
}

export async function newContext(opts: {
  headless?: boolean;
  useNaverSession?: boolean;
  /** 로그인 창처럼 사람이 직접 조작하는 창에 쓴다 */
  preferSystemBrowser?: boolean;
}): Promise<{ browser: Browser; context: BrowserContext }> {
  const headless = opts.headless ?? true;
  const browser = await launchBrowser({ headless, preferSystemBrowser: opts.preferSystemBrowser });

  const storageState =
    opts.useNaverSession && fs.existsSync(DIRS.storageState) ? DIRS.storageState : undefined;

  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    userAgent: uaFor(versionOf(browser)),
    storageState,
  });

  // ⚠️ navigator.webdriver 를 스크립트로 지우지 않는다.
  //    평범한 크롬은 이 값이 **false** 다. undefined 로 만들면 오히려 더 눈에 띈다.
  //    위의 --disable-blink-features=AutomationControlled 만으로 false 가 된다(실측).

  context.setDefaultTimeout(20_000);
  return { browser, context };
}

export async function closeQuietly(browser: Browser | null | undefined) {
  try {
    await browser?.close();
  } catch {
    /* 이미 닫혔으면 무시 */
  }
}
