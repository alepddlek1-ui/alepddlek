/**
 * 커서는 본문에 있는데 화면 상태 판정은 "본문 아님"이라고 하는 환경.
 * (사용자 스크린샷에서 실제로 관찰된 상황 — 제목은 정상, 커서는 본문, 그런데 중단됨)
 * 실제로 한 글자 쳐보는 판정만이 이걸 통과해야 한다.
 */
import path from "node:path";
import { publishPost } from "@/lib/naver/publish";
import { ensureDirs } from "@/lib/paths";
import type { Draft } from "@/lib/types";

ensureDirs();
const TITLE = "제목은 제목 칸에만";
const draft: Draft = {
  title: TITLE,
  sections: [
    { type: "paragraph", text: "본문 첫 문단입니다." },
    { type: "paragraph", text: "본문 둘째 문단입니다." },
  ],
};

let probe: { title: string; body: string[] } | null = null;
const logs: string[] = [];

const res = await publishPost({
  jobId: 0,
  draft,
  imageBySection: new Map(),
  blogId: "harness",
  dryRun: true,
  visibility: "private",
  headingAsQuote: false,
  showBrowser: false,
  entryUrl: "file://" + path.resolve("fixtures/editor-harness-shadow.html"),
  log: (m, l) => logs.push(`${l ?? "info"}: ${m}`),
  inspect: async (_p, frame) => {
    probe = (await frame.evaluate(() => ({
      title: (document.getElementById("titleEl")?.textContent ?? "").trim(),
      body: (window as unknown as { __bodyTexts: () => string[] }).__bodyTexts(),
    }))) as { title: string; body: string[] };
  },
});

console.log("결과:", res.status, "—", res.note);
if (logs.length) console.log("로그:\n  " + logs.join("\n  "));
console.log("제목 칸:", JSON.stringify(probe?.title));
console.log("본문:", JSON.stringify(probe?.body));

const fails: string[] = [];
if (res.status !== "dry_run") fails.push(`중단됐다 (${res.status}) — 실제로 쳐보는 판정이 동작하지 않았다`);
if (probe?.title !== TITLE) fails.push(`제목 칸이 이상하다: ${probe?.title}`);
if (!probe?.body.some((t) => t.includes("본문 첫 문단"))) fails.push("본문이 안 들어갔다");
if (probe?.body.some((t) => t.includes("가가")) || probe?.title.includes("가"))
  fails.push("확인용으로 친 글자가 안 지워졌다");

console.log(fails.length ? "\n✗ " + fails.join("\n✗ ") : "\n✓ 화면 판정이 틀려도 본문에 정확히 들어가고, 확인용 글자도 남지 않는다");
process.exit(fails.length ? 1 : 0);
