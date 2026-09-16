/** 8-6 — 영어 에러가 사용자 말로 바뀌는지 */
import { friendlyClaudeError } from "@/lib/claude";

const cases: [string, string][] = [
  ["Failed to authenticate: OAuth session expired and could not be refreshed", "로그인이 풀렸"],
  ["You've hit your session limit · resets 6pm (Asia/Seoul)", "사용량을 다 썼"],
  ["spawn claude ENOENT", "찾지 못했"],
  ["fetch failed", "인터넷 연결"],
  ["Error: overloaded_error", "붐빕니다"],
];
let bad = 0;
for (const [raw, want] of cases) {
  const got = friendlyClaudeError(raw);
  const ok = got.includes(want) && !/[A-Za-z]{6,}/.test(got.replace(/claude/gi, ""));
  if (!ok) bad++;
  console.log(`${ok ? "✓" : "✗"} ${raw.slice(0, 45)}…\n    → ${got}`);
}
// 알 수 없는 것은 그대로 통과시킨다(정보를 잃지 않기 위해)
console.log("알 수 없는 오류는 그대로:", friendlyClaudeError("weird thing") === "weird thing" ? "✓" : "✗");
console.log(bad ? "\n✗ 실패" : "\n✓ 에러 문구 전부 사용자 말로 바뀐다");
process.exit(bad ? 1 : 0);
