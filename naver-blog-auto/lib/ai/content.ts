import { runClaudeJson } from "@/lib/claude";
import { IdeasSchema, draftSchemaFor, type Draft, type Idea, type JobInputs } from "@/lib/types";
import { draftPrompt, ideasPrompt } from "@/lib/ai/templates";
import { sourcesToPromptBlock, type Source } from "@/lib/scrape/trends";

export async function generateIdeas(
  keyword: string,
  sources: Source[],
  n = 5,
): Promise<{ ok: true; ideas: Idea[] } | { ok: false; error: string }> {
  const r = await runClaudeJson(ideasPrompt(keyword, sourcesToPromptBlock(sources), n), IdeasSchema);
  if (!r.ok) return r;
  return { ok: true, ideas: r.data.ideas.slice(0, n) };
}

/**
 * ⚠️ 7-24 — AI 는 본문에 없는 highlight 를 지어낸다(실측 5개 중 1개, 20%).
 *    형광펜은 text.indexOf(highlight) 로 자리를 찾으므로, 그대로 두면 서식이 엉뚱한 곳에 붙는다.
 *
 * ⚠️ 이걸 Zod .refine() 으로 초안 전체 반려 사유로 삼지 마라.
 *    문단 30개짜리 글을 highlight 하나 때문에 버리는 건 나쁜 거래다(생성에 100초).
 *    이미지 자리 개수는 재생성할 가치가 있지만 highlight 는 아니다.
 *    → 그 highlight 만 떨어뜨리고, 몇 개를 버렸는지 로그에 남긴다.
 */
export function sanitizeDraft(draft: Draft): { draft: Draft; droppedHighlights: number } {
  let dropped = 0;
  const sections = draft.sections.map((s) => {
    if (s.type !== "paragraph" || !s.highlight) return s;
    const h = s.highlight.trim();
    if (h && s.text.includes(h)) return { ...s, highlight: h };
    dropped++;
    const { highlight: _drop, ...rest } = s;
    return rest;
  });
  return { draft: { ...draft, sections }, droppedHighlights: dropped };
}

export async function generateDraft(args: {
  inputs: JobInputs;
  idea?: Idea;
  sources?: Source[];
  photoCount: number;
  photoDescs?: { file: string; desc: string }[];
}): Promise<{ ok: true; draft: Draft; droppedHighlights: number } | { ok: false; error: string }> {
  const { inputs } = args;
  const prompt = draftPrompt({
    mode: inputs.mode,
    keyword: inputs.keyword,
    ideaTitle: args.idea?.title,
    ideaAngle: args.idea?.angle,
    topic: inputs.topic,
    points: inputs.points,
    sourcesBlock: args.sources?.length ? sourcesToPromptBlock(args.sources) : undefined,
    photoSource: inputs.photoSource,
    photoCount: args.photoCount,
    photoDescs: args.photoDescs,
    imageStyle: inputs.imageStyle,
  });

  // 이미지 섹션 개수 요건은 사진 소스마다 다르다.
  // local 인데 6개를 강제하면 사진이 4장뿐일 때 재시도만 3번 돌다 실패한다(6-5).
  const schema = draftSchemaFor(inputs.photoSource, args.photoCount);
  const r = await runClaudeJson(prompt, schema);
  if (!r.ok) return r;

  const { draft, droppedHighlights } = sanitizeDraft(r.data);
  return { ok: true, draft, droppedHighlights };
}
