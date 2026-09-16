/** 브라우저가 자기 정체를 어떻게 말하는지 확인한다 (UA 가 실제 OS 와 맞는지, webdriver 가 감춰졌는지) */
import { newContext, closeQuietly } from "@/lib/playwright";

const { browser, context } = await newContext({ headless: true });
const page = await context.newPage();
await page.goto("about:blank");
const info = await page.evaluate(() => ({
  ua: navigator.userAgent,
  webdriver: (navigator as unknown as { webdriver?: unknown }).webdriver,
  platform: navigator.platform,
}));
await closeQuietly(browser);

console.log("실행 중인 OS   :", process.platform);
console.log("브라우저가 말하는 UA:", info.ua);
console.log("navigator.platform :", info.platform);
console.log("navigator.webdriver:", info.webdriver, "(평범한 크롬과 같은 false 여야 정상)");

const uaOs = /Windows NT/.test(info.ua) ? "win32" : /Macintosh/.test(info.ua) ? "darwin" : "linux";
const fails: string[] = [];
if (uaOs !== process.platform) fails.push(`UA 가 말하는 OS(${uaOs}) 와 실제 OS(${process.platform}) 가 다르다`);
if (info.webdriver !== false) fails.push(`navigator.webdriver 가 ${String(info.webdriver)} 다 — 평범한 크롬은 false`);
if (/Headless/i.test(info.ua)) fails.push("UA 에 Headless 가 남아 있다");
console.log(fails.length ? "\n✗ " + fails.join("\n✗ ") : "\n✓ 브라우저 정체가 실제 환경과 일치한다");
process.exit(fails.length ? 1 : 0);
