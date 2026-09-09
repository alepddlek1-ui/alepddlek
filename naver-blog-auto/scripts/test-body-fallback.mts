/**
 * 명세의 본문 후보가 하나도 안 잡히는 환경에서도 본문에 들어가는지.
 * (실사용에서 "본문 입력 칸에 들어가지 못해 중단했습니다" 가 나온 상황을 흉내 낸다)
 */
import path from "node:path";
import { publishPost } from "@/lib/naver/publish";
import { ensureDirs } from "@/lib/paths";
import type { Draft } from "@/lib/types";

ensureDirs();
const TITLE = "제목은 여기에만";
const draft: Draft = {
  title: TITLE,
  sections: [
    { type: "paragraph", text: "본문 첫 문단입니다." },
    { type: "paragraph", text: "본문 둘째 문단입니다." },
  ],
};

let probe: { titleText: string; bodyTexts: string[] } | null = null;
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
  entryUrl: "file://" + path.resolve("fixtures/editor-harness-alt.html"),
  log: (m, l) => logs.push(`${l ?? "info"}: ${m}`),
  inspect: async (_p, frame) => {
    probe = (await frame.evaluate(() => ({
      titleText: (document.getElementById("titleEl")?.textContent ?? "").trim(),
      bodyTexts: [...document.querySelectorAll(".se-content .se-component")]
        .map((c) => c.textContent?.trim() ?? "")
        .filter(Boolean),
    }))) as { titleText: string; bodyTexts: string[] };
  },
});

console.log("결과:", res.status, "—", res.note);
if (logs.length) console.log("로그:\n  " + logs.join("\n  "));
console.log("제목 칸:", JSON.stringify(probe?.titleText));
console.log("본문:", JSON.stringify(probe?.bodyTexts));

const fails: string[] = [];
if (res.status !== "dry_run") fails.push(`본문 진입 폴백이 동작하지 않았다 (${res.status})`);
if (probe?.titleText !== TITLE) fails.push(`제목 칸이 이상하다: ${probe?.titleText}`);
if (!probe?.bodyTexts.some((t) => t.includes("본문 첫 문단"))) fails.push("본문이 안 들어갔다");
if (probe?.titleText.includes("본문")) fails.push("★ 글이 제목 칸으로 샜다 (7-26)");

console.log(fails.length ? "\n✗ " + fails.join("\n✗ ") : "\n✓ 명세 셀렉터가 없어도 본문에 정확히 들어간다");
process.exit(fails.length ? 1 : 0);
