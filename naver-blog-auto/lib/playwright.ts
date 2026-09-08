import fs from "node:fs";
import { spawn } from "node:child_process";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { DIRS } from "@/lib/paths";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

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

export async function newContext(opts: {
  headless?: boolean;
  useNaverSession?: boolean;
}): Promise<{ browser: Browser; context: BrowserContext }> {
  const headless = opts.headless ?? true;

  // CHROMIUM_PATH 가 있으면 그 브라우저를 쓴다.
  // (설치를 못 하는 환경 — 회사 네트워크·컨테이너 등 — 에서 이미 있는 크롬을 가리키기 위한 탈출구)
  const executablePath = process.env.CHROMIUM_PATH || undefined;
  const launch = () => chromium.launch({ headless, executablePath });
  let browser: Browser;
  try {
    browser = await launch();
  } catch (e) {
    const msg = (e as Error).message ?? "";
    // 브라우저가 안 깔려 있으면 자동으로 설치하고 한 번만 재시도한다.
    if (/Executable doesn'?t exist|please run|install/i.test(msg)) {
      await installChromium();
      browser = await launch();
    } else {
      throw e;
    }
  }

  const storageState =
    opts.useNaverSession && fs.existsSync(DIRS.storageState) ? DIRS.storageState : undefined;

  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    locale: "ko-KR",
    userAgent: UA,
    storageState,
  });
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
