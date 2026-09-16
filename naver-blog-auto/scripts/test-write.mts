import { generateDraft, sanitizeDraft } from "@/lib/ai/content";
import type { Draft, JobInputs } from "@/lib/types";

// ① 순수 함수부터: 지어낸 highlight 가 떨어지는가 (7-24)
const fake: Draft = {
  title: "t",
  sections: [
    { type: "paragraph", text: "옆 사이트는 한 시간째 폴대와 씨름 중이더라고요.", highlight: "폴대와 씨름" },
    { type: "paragraph", text: "그때 확신했습니다.", highlight: "예쁜 것보다 빨리 펴지는 게 훨씬 중요합니다" },
    { type: "paragraph", text: "세 번째 문단입니다." },
  ],
};
const s = sanitizeDraft(fake);
console.log("sanitize: 버린 highlight =", s.droppedHighlights, "(1이어야 정상)");
console.log("  남은 highlight:", s.draft.sections.map((x) => (x.type === "paragraph" ? x.highlight : undefined)));

// ② 실제 생성
const inputs: JobInputs = {
  mode: "review",
  keyword: "홈카페",
  topic: "동네 조용한 카페 방문 후기",
  points: "원두 두 종류, 창가 자리, 주차는 어려움, 웨이팅 10분",
  photoSource: "none",
};
const r = await generateDraft({ inputs, photoCount: 0 });
if (!r.ok) {
  console.log("✗ 생성 실패:", r.error);
  process.exit(1);
}
const d = r.draft;
console.log(`\n제목: ${d.title}`);
console.log(`섹션 ${d.sections.length}개:`, d.sections.map((x) => x.type).join(" "));
console.log("버린 highlight:", r.droppedHighlights);

const texts = d.sections.flatMap((x) => ("text" in x ? [x.text] : []));
const md = texts.filter((t) => /\*\*|~~|`|^#{1,6}\s|^>\s|^[-*+]\s/m.test(t));
console.log("마크다운 유출 문단:", md.length, md.slice(0, 2));

const badHl = d.sections.filter((x) => x.type === "paragraph" && x.highlight && !x.text.includes(x.highlight));
console.log("본문에 없는 highlight:", badHl.length);
const imgs = d.sections.filter((x) => x.type === "image").length;
console.log("image 섹션:", imgs, "(none 이므로 0이어야 정상)");

console.log("\n--- 앞부분 미리보기 ---");
for (const x of d.sections.slice(0, 6)) {
  if (x.type === "paragraph") console.log(`  p: ${x.text.slice(0, 60)}…` + (x.highlight ? `  [형광펜: ${x.highlight}]` : ""));
  else if (x.type === "quote") console.log(`  quote: ${x.text}`);
  else if (x.type === "heading") console.log(`  h: ${x.text}`);
  else console.log(`  ${x.type}`);
}
const fail = md.length || badHl.length || imgs !== 0 || s.droppedHighlights !== 1;
console.log(fail ? "\n✗ 검증 실패" : "\n✓ 글쓰기 검증 통과");
process.exit(fail ? 1 : 0);
