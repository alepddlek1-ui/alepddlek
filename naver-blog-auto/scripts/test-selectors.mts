/** 7-1 / 7-2 최소 재현 — 계정도 네트워크도 필요 없다. 셀렉터 매칭 "개수"를 센다. */
import path from "node:path";
import { chromium } from "playwright";

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
const page = await browser.newPage();
await page.goto("file://" + path.resolve("fixtures/selector-trap.html"));

const count = (sel: string) => page.locator(sel).count();

const rows: [string, number, number][] = [
  ["7-1 옛 셀렉터  button:has-text('취소')", await count("button:has-text('취소')"), 2],
  ["7-1 새 셀렉터  .se-popup-container button:text-is('취소')", await count(".se-popup-container button:text-is('취소')"), 1],
  ["7-1 클래스 기반 button.se-popup-button-cancel", await count("button.se-popup-button-cancel"), 1],
  ["7-2 옛 셀렉터  button:has-text('발행')", await count("button:has-text('발행')"), 2],
  ["7-2 새 셀렉터  button[data-click-area='tpb.publish']", await count("button[data-click-area='tpb.publish']"), 1],
];
await browser.close();

let bad = 0;
for (const [name, got, want] of rows) {
  const ok = got === want;
  if (!ok) bad++;
  console.log(`${ok ? "✓" : "✗"} ${name} → ${got}개 (기대 ${want})`);
}
console.log(bad ? "\n✗ 부분일치 함정 재현 실패" : "\n✓ 7-1·7-2 부분일치 함정이 재현되고, 새 셀렉터가 정확히 1개만 잡는다");
process.exit(bad ? 1 : 0);
