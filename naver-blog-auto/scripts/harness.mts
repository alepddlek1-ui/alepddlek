/**
 * 9장 6.5-a — 로그인 전, 로컬 하네스로 입력 "순서"를 확정한다.
 * 계정 없이 7-1 / 7-3 / 7-5 / 7-6 / 7-7 / 7-8 / 7-25 / 7-26 을 잡는다.
 *
 * ⚠️ 이 하네스는 셀렉터를 검증하지 않는다. 7장 셀렉터는 로그인 전에는 검증할 수 없다.
 */
import fs from "node:fs";
import path from "node:path";
import { publishPost } from "@/lib/naver/publish";
import { DIRS, ensureDirs } from "@/lib/paths";
import type { Draft } from "@/lib/types";

ensureDirs();

const photo = path.join(DIRS.images, "harness-photo.png");
if (!fs.existsSync(photo)) {
  fs.writeFileSync(
    photo,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAKklEQVR4nO3BAQ0AAADCoPdPbQ8HFAAAAAAAAAAAAAAAAAAAAAAAAPBrTFAAAdW3jJgAAAAASUVORK5CYII=",
      "base64",
    ),
  );
}

const TITLE = "하네스 제목 — 이 줄만 제목 칸에 들어가야 한다";
const draft: Draft = {
  title: TITLE,
  sections: [
    { type: "paragraph", text: "첫 문단입니다. 물결표~ 와 **굵게** 표시가 그대로 들어가면 안 됩니다." },
    { type: "quote", text: "인용구 한 줄" },
    { type: "paragraph", text: "인용구 바로 다음 문단입니다. 인용구 안으로 빨려 들어가면 안 됩니다." },
    {
      type: "paragraph",
      text: "형광펜 확인용 문단이고 여기가 핵심 구절입니다 뒤에도 글이 이어집니다.",
      highlight: "여기가 핵심 구절입니다",
    },
    { type: "divider" },
    { type: "image", query: "사진 자리", caption: "사진 아래 설명 ⚠️ 이모지" },
    { type: "paragraph", text: "사진 다음 문단입니다. 캡션에 붙으면 안 됩니다." },
  ],
};

type Metrics = {
  strikeClicks: number;
  boldClicks: number;
  highlightOn: number;
  highlightOff: number;
  quoteApplied: number;
  dividers: number;
  imagesInserted: number;
  captionsTyped: number;
  searchBarText: string;
  titleText: string;
  fileChooserOpened: number;
  clicks: { x: number; y: number; tag: string; cls: string; inComponent: boolean; inCaption: boolean }[];
};
type Probe = {
  metrics: Metrics;
  dimLeft: number;
  popupLeft: number;
  quoteText: string;
  afterQuoteInQuote: boolean;
  captionText: string;
  captionMerged: boolean;
  imageCompText: string;
  captionEmptyLeft: number;
  bodyTexts: string[];
};

let probe: Probe | null = null;
const logs: string[] = [];

const entry = "file://" + path.resolve("fixtures/editor-harness.html");
const res = await publishPost({
  jobId: 0,
  draft,
  imageBySection: new Map([[5, photo]]),
  blogId: "harness",
  dryRun: true, // ⚠️ 하네스는 언제나 연습 모드
  visibility: "private",
  headingAsQuote: false,
  showBrowser: false,
  entryUrl: entry,
  log: (m, l) => logs.push(`${l ?? "info"}: ${m}`),
  inspect: async (_page, frame) => {
    probe = (await frame.evaluate(() => {
      const q = document.querySelector(".se-component.se-quote");
      const nextComp = q?.nextElementSibling;
      const cap = document.querySelector(".se-caption");
      return {
        metrics: (window as unknown as { __metrics: Metrics }).__metrics,
        dimLeft: document.querySelectorAll(".se-popup-dim").length,
        popupLeft: document.querySelectorAll(".se-popup-container").length,
        quoteText: q?.textContent ?? "",
        // 인용구 다음 문단이 인용구 "안"에 있으면 안 된다
        afterQuoteInQuote: !!(
          q && q.textContent && q.textContent.includes("인용구 바로 다음 문단")
        ),
        captionText: cap?.textContent ?? "",
        // 캡션 뒤 문단이 캡션 안으로 빨려 들어가지 않았는지 (7-18 의 "한 컴포넌트로 합쳐짐")
        captionMerged: !!cap?.textContent?.includes("사진 다음 문단"),
        imageCompText: document.querySelector(".se-component.se-image")?.textContent ?? "",
        captionEmptyLeft: document.querySelectorAll(".se-caption.se-is-empty").length,
        bodyTexts: [...document.querySelectorAll(".se-content .se-component")].map(
          (c) => c.textContent?.trim() ?? "",
        ),
      };
    })) as Probe;
  },
});

console.log(`결과: ${res.status} — ${res.note}`);
if (logs.length) console.log("로그:\n  " + logs.join("\n  "));

if (!probe) {
  console.log("✗ 하네스 계측값을 읽지 못했습니다.");
  process.exit(1);
}
const p: Probe = probe;
const m = p.metrics;
console.log("\n계측값:", JSON.stringify(m, null, 2));
console.log("본문 컴포넌트:", JSON.stringify(p.bodyTexts, null, 2));
console.log("탈출 클릭이 실제로 누른 것:");
for (const c of m.clicks.filter((c) => !c.tag.match(/BUTTON|INPUT/)))
  console.log(`  (${c.x},${c.y}) ${c.tag}.${c.cls} 컴포넌트안=${c.inComponent} 캡션안=${c.inCaption}`);

const checks: [string, boolean, string][] = [
  ["7-1  취소선 버튼이 0회 눌렸다", m.strikeClicks === 0, `눌린 횟수 ${m.strikeClicks}`],
  ["7-3  팝업 차단막이 제거됐다", p.dimLeft === 0 && p.popupLeft === 0, `dim ${p.dimLeft} / popup ${p.popupLeft}`],
  ["7-5  인용구 다음 문단이 인용구 밖에 있다", !p.afterQuoteInQuote, `인용구 내용: ${p.quoteText}`],
  ["7-6  글감 검색바에 타이핑이 새지 않았다", m.searchBarText === "", `검색바: ${m.searchBarText}`],
  ["7-7  파일 선택창이 처리됐다(멈추지 않음)", m.imagesInserted === 1, `삽입 ${m.imagesInserted}장`],
  [
    "7-8  마크다운이 무력화됐다",
    !p.bodyTexts.some((t) => t.includes("**") || /물결표~[^～]/.test(t)),
    p.bodyTexts.find((t) => t.includes("**")) ?? "(없음)",
  ],
  ["7-18 캡션이 사진 설명 칸에 들어갔다", m.captionsTyped === 1 && p.captionEmptyLeft === 0, `캡션 "${p.captionText}" / se-is-empty ${p.captionEmptyLeft}개`],
  ["7-18 캡션 뒤 문단이 캡션에 붙지 않았다", !p.captionMerged, `사진 컴포넌트 내용: ${p.imageCompText}`],
  [
    "7-5  각 문단이 별개 컴포넌트로 들어갔다",
    p.bodyTexts.filter((t) => t.includes("사진 다음 문단")).length === 1 &&
      !p.bodyTexts.some((t) => t.includes("사진 아래 설명") && t.includes("사진 다음 문단")),
    JSON.stringify(p.bodyTexts.filter(Boolean)),
  ],
  [
    "7-25 VS16 이모지가 중복되지 않았다",
    !/⚠⚠/.test(p.captionText) && p.captionText.includes("⚠️"),
    `캡션 코드포인트: ${[...p.captionText].map((c) => "U+" + c.codePointAt(0)!.toString(16).toUpperCase()).join(" ")}`,
  ],
  ["7-26 글 전체가 제목 칸에 들어가지 않았다", m.titleText.trim() === TITLE, `제목 칸: ${m.titleText.slice(0, 60)}`],
  ["6-9  형광펜이 켜졌다 꺼졌다", m.highlightOn === 1 && m.highlightOff === 1, `on ${m.highlightOn} / off ${m.highlightOff}`],
  ["6-9  인용구 서식이 적용됐다", m.quoteApplied === 1, `적용 ${m.quoteApplied}회`],
  ["6-9  구분선이 들어갔다", m.dividers === 1, `${m.dividers}개`],
];

console.log("");
let bad = 0;
for (const [name, ok, detail] of checks) {
  if (!ok) bad++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : "  ← " + detail}`);
}
console.log(bad ? `\n✗ ${bad}개 실패` : "\n✓ 하네스 전부 통과");
console.log("스크린샷:", res.screenshot ?? "(없음)");
process.exit(bad ? 1 : 0);
