/**
 * 자동 점검 — 막힐 수 있는 곳을 한 번에 전부 재고, **지금 할 일 하나**만 알려준다.
 *
 * ⚠️ 8-5/8-6 — 사용자에게 경우의 수를 물어보지 마라. 잴 수 있는 건 코드가 재고,
 *    사람에게는 결론 한 줄만 준다. (하나씩 물어보다 사용자의 시간을 크게 쓴 적이 있다)
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { checkClaude } from "@/lib/claude";
import { DIRS } from "@/lib/paths";
import { cfConfigured } from "@/lib/ai/imagegen";
import { CONFIG } from "@/config";

type Row = { name: string; ok: boolean | "opt"; detail: string; todo?: string };
const rows: Row[] = [];

// ① Node
const major = Number(process.versions.node.split(".")[0]);
rows.push({
  name: "Node",
  ok: major >= 20,
  detail: `v${process.versions.node}`,
  todo: "nodejs.org 에서 LTS 버전을 받아 설치해 주세요.",
});

// ② 필요한 프로그램이 깔려 있나
const hasModules = fs.existsSync(path.join(process.cwd(), "node_modules", "next"));
rows.push({
  name: "필요한 프로그램",
  ok: hasModules,
  detail: hasModules ? "설치됨" : "없음",
  todo: "이 폴더에서 npm install 을 한 번 실행해 주세요.",
});

// ③ AI (설치 + 실제 로그인까지)
const claude = await checkClaude(true);
const isWin = process.platform === "win32";
// 화면(버튼) 기준이 아니라 **이 창에서 칠 명령** 기준으로 알려준다.
const loginTodo = [
  "AI 로그인이 안 돼 있습니다. 아래를 순서대로 하시면 됩니다.",
  "",
  "  1) claude setup-token",
  "     → 브라우저에서 로그인하면 sk-ant-oat01-... 로 시작하는 긴 글자가 나옵니다.",
  "",
  isWin
    ? '  2) setx CLAUDE_CODE_OAUTH_TOKEN "여기에그글자붙여넣기"'
    : '  2) echo \'export CLAUDE_CODE_OAUTH_TOKEN="여기에그글자붙여넣기"\' >> ~/.zshrc',
  "",
  "  3) 열려 있는 검은 창을 전부 닫고 새로 여세요. (옛 설정을 들고 있어서 꼭 필요합니다)",
  "",
  '  4) claude -p "안녕"  →  인사말이 나오면 끝입니다.',
].join("\n  ");

rows.push({
  name: "AI(claude)",
  ok: claude.ok,
  detail: claude.ok
    ? `${claude.version} · 로그인됨`
    : claude.installed
      ? `${claude.version} · 로그인 안 됨`
      : "설치 안 됨",
  todo: claude.installed ? loginTodo : claude.reason,
});

// ④ 네이버 로그인 정보 (파일 유무만 — 실제 확인은 앱이 켜질 때 한다)
const hasSession = fs.existsSync(DIRS.storageState);
rows.push({
  name: "네이버 로그인",
  ok: hasSession,
  detail: hasSession ? "저장돼 있음" : "아직 안 함",
  todo: "앱 화면 오른쪽 위 [네이버 로그인] 을 눌러 로그인해 주세요.",
});

// ⑤ 앱 자리(포트)가 비어 있나
const portBusy = await new Promise<boolean>((resolve) => {
  const s = net.createServer();
  s.once("error", () => resolve(true));
  s.once("listening", () => s.close(() => resolve(false)));
  s.listen(CONFIG.port, "0.0.0.0");
});
rows.push({
  name: `앱 자리(${CONFIG.port}번)`,
  ok: !portBusy,
  detail: portBusy ? "이미 사용 중" : "비어 있음",
  todo: `앱이 이미 켜져 있습니다. 브라우저에서 localhost:${CONFIG.port} 를 열어보세요. 그래도 안 뜨면 열려 있는 검은 창을 모두 닫고 다시 켜주세요.`,
});

// ⑥ AI 사진 생성 (선택)
rows.push({
  name: "AI 사진 생성",
  ok: cfConfigured() ? true : "opt",
  detail: cfConfigured() ? "열쇠 있음" : "열쇠 없음 (안 넣어도 앱은 다 돌아갑니다)",
});

// ── 출력 ──────────────────────────────────────
const mark = (ok: Row["ok"]) => (ok === true ? "✓" : ok === "opt" ? "―" : "✗");
console.log("\n  점검 결과\n  " + "─".repeat(52));
for (const r of rows) {
  console.log(`  ${mark(r.ok)} ${r.name.padEnd(16, " ")} ${r.detail}`);
}
console.log("  " + "─".repeat(52));

const blocker = rows.find((r) => r.ok === false);
if (!blocker) {
  console.log("\n  준비가 다 됐습니다. 앱을 켜고 글을 만들어 보세요.\n");
  process.exit(0);
}
console.log(`\n  지금 하실 일 — ${blocker.name}\n`);
console.log(`  ${blocker.todo ?? "위 항목을 해결해 주세요."}\n`);
console.log("  해결한 뒤 이 점검을 다시 돌리려면: npm run doctor\n");
process.exit(1);
