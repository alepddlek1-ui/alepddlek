/**
 * "설치는 됐는데 로그인은 안 된" claude 를 흉내 내서,
 * 화면이 거짓 초록불을 켜지 않는지 확인한다.
 */
import { checkClaude, invalidateClaudeCache } from "@/lib/claude";

const fails: string[] = [];

// ① 로그인 안 된 claude
process.env.CLAUDE_BIN = new URL("../fixtures/fake-bin/claude-noauth", import.meta.url).pathname;
invalidateClaudeCache();
const bad = await checkClaude(true);
console.log("로그인 안 된 claude →", JSON.stringify(bad, null, 2));
if (bad.ok) fails.push("로그인이 안 됐는데 ok=true 로 나온다 (거짓 초록불)");
if (!bad.installed) fails.push("설치는 됐는데 installed=false 로 나온다");
if (!bad.reason?.includes("로그인이 풀렸")) fails.push("이유가 사용자 말로 안 나온다: " + bad.reason);
if (/[A-Za-z]{6,}/.test((bad.reason ?? "").replace(/claude/gi, "")))
  fails.push("이유에 영어 원문이 그대로 남아 있다");

// ② 아예 없는 claude
process.env.CLAUDE_BIN = "/nonexistent/claude-does-not-exist";
invalidateClaudeCache();
const missing = await checkClaude(true);
console.log("\n없는 claude →", JSON.stringify(missing, null, 2));
if (missing.ok) fails.push("없는데 ok=true 로 나온다");
if (missing.installed) fails.push("없는데 installed=true 로 나온다");

console.log(fails.length ? "\n✗ " + fails.join("\n✗ ") : "\n✓ AI 준비 상태를 정직하게 표시한다");
process.exit(fails.length ? 1 : 0);
