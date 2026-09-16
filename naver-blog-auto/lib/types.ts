import { z } from "zod";

/** 글은 문자열이 아니라 섹션 배열이다(6-5). */
export const SectionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heading"), text: z.string().min(1) }),
  z.object({
    type: z.literal("paragraph"),
    text: z.string().min(1),
    // highlight: text 안에 글자 그대로 있어야 하는 핵심 구절. 에디터에서 형광펜+굵게가 된다.
    highlight: z.string().optional(),
  }),
  z.object({ type: z.literal("quote"), text: z.string().min(1) }),
  z.object({ type: z.literal("divider") }),
  z.object({ type: z.literal("image"), query: z.string().min(1), caption: z.string().optional() }),
]);
export type Section = z.infer<typeof SectionSchema>;

export const DraftSchema = z.object({
  title: z.string().min(1),
  sections: z.array(SectionSchema).min(3),
});
export type Draft = z.infer<typeof DraftSchema>;

export const IdeaSchema = z.object({
  title: z.string().min(1),
  angle: z.string().default(""),
  rationale: z.string().default(""),
});
export const IdeasSchema = z.object({ ideas: z.array(IdeaSchema).min(1) });
export type Idea = z.infer<typeof IdeaSchema>;

/** 크롤링 이미지 판정 — 세 축을 따로 묻는다(6-6) */
export const VisionVerdictSchema = z.object({
  fit: z.boolean(),
  watermark: z.boolean(),
  koreanPerson: z.boolean(),
  reason: z.string().default(""),
});
export type VisionVerdict = z.infer<typeof VisionVerdictSchema>;

/**
 * 생성 이미지 판정 — 크롤링용을 재사용하면 안 된다(7-13).
 * 생성물에는 워터마크도 초상권도 없으므로 네 가지만 본다.
 */
export const GenVerdictSchema = z.object({
  ok: z.boolean(),
  offTopic: z.boolean().default(false),
  malformed: z.boolean().default(false),
  hasText: z.boolean().default(false),
  lowQuality: z.boolean().default(false),
  reason: z.string().default(""),
});
export type GenVerdict = z.infer<typeof GenVerdictSchema>;

export const PhotoDescSchema = z.object({ file: z.string(), desc: z.string() });
export type PhotoDesc = z.infer<typeof PhotoDescSchema>;

export type PhotoSource = "none" | "local" | "crawl" | "ai";
export type ImageStyle = "photo" | "illust";
export type JobMode = "auto" | "review" | "branding";

export type JobInputs = {
  mode: JobMode;
  keyword: string;
  topic?: string;
  points?: string;
  photoSource: PhotoSource;
  imageStyle?: ImageStyle;
  photoDir?: string;
  photoPlacement?: "order" | "ai";
};

/** 이미지 섹션 개수 요건은 사진 소스마다 다르다(6-5의 경고). */
export function draftSchemaFor(photoSource: PhotoSource, localCount = 0) {
  const countImages = (d: Draft) => d.sections.filter((s) => s.type === "image").length;
  if (photoSource === "none") {
    return DraftSchema.refine((d) => countImages(d) === 0, {
      message: "사진을 쓰지 않는 글이므로 image 섹션이 있으면 안 됩니다.",
    });
  }
  if (photoSource === "local") {
    return DraftSchema.refine((d) => countImages(d) === localCount, {
      message: `image 섹션이 정확히 ${localCount}개여야 합니다.`,
    });
  }
  // crawl / ai — 일부 자리는 적합 사진을 못 찾으므로 넉넉히 6개 이상
  return DraftSchema.refine((d) => countImages(d) >= 6, {
    message: "image 섹션이 6개 이상이어야 합니다.",
  });
}
