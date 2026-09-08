/**
 * 10장 A — 계정 없이 확인 가능한 항목을 한 번에 돌린다.
 *   npm run selftest
 */
import { spawn } from "node:child_process";

const steps: [string, string[], Record<string, string>][] = [
  ["뉴런 단가 공식 (7-12)", ["scripts/test-neurons.mts"], {}],
  ["셀렉터 부분일치 최소 재현 (7-1, 7-2)", ["scripts/test-selectors.mts"], {}],
  ["수집 필터 (6-4)", ["scripts/test-trends.mts"], {}],
  ["로컬 날짜 집계 + 발행 가드 (7-22)", ["scripts/test-guards.mts"], { TZ: "Asia/Seoul" }],
  ["에러 문구 한국어화 (8-6)", ["scripts/test-errors.mts"], {}],
  ["브라우저 정체 일치 (UA·자동화 표식)", ["scripts/test-browser.mts"], {}],
  ["에디터 로컬 하네스 (9장 6.5-a)", ["scripts/harness.mts"], {}],
];

let failed = 0;
for (const [name, args, env] of steps) {
  console.log(`\n${"─".repeat(60)}\n▶ ${name}\n${"─".repeat(60)}`);
  const code = await new Promise<number>((resolve) => {
    const p = spawn("npx", ["tsx", ...args], {
      stdio: "inherit",
      env: { ...process.env, ...env },
      shell: process.platform === "win32",
    });
    p.on("close", (c) => resolve(c ?? 1));
  });
  if (code !== 0) failed++;
}

console.log(`\n${"═".repeat(60)}`);
console.log(failed ? `✗ ${failed}개 항목 실패` : "✓ 계정 없이 확인 가능한 항목 전부 통과");
process.exit(failed ? 1 : 0);
