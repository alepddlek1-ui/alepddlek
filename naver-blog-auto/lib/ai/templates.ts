import type { ImageStyle, JobMode, PhotoSource } from "@/lib/types";

/**
 * 사진 소스별 안내문. 이미지 섹션의 `query` 에 무엇을 적을지가 소스마다 완전히 다르다(6-5).
 */
export function photoHintFor(
  photoSource: PhotoSource,
  count: number,
  descs?: { file: string; desc: string }[],
): string {
  if (photoSource === "none") {
    return "이 글에는 사진을 넣지 않는다. image 섹션을 **하나도 만들지 마라.**";
  }
  if (photoSource === "local") {
    const list = (descs ?? [])
      .map((d, i) => `  ${i + 1}. ${d.desc}`)
      .join("\n");
    return [
      `사진은 사용자가 직접 찍은 ${count}장을 쓴다. image 섹션을 **정확히 ${count}개** 만들어라.`,
      "image 의 query 에는 검색어가 아니라 **그 자리에 어떤 사진이 와야 하는지 설명**을 한국어로 적어라.",
      count && list ? `사용할 수 있는 사진 목록:\n${list}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }
  if (photoSource === "ai") {
    return [
      "사진은 AI 가 그린다. image 섹션을 6~8개 배치하라.",
      "image 의 query 에는 검색어가 아니라 **어떤 장면을 그려야 하는지 한국어로 구체적으로 묘사**하라.",
      "사람이 필요하면 얼굴이 크게 나오지 않는 구도(손·뒷모습·실루엣)로 묘사하라.",
    ].join("\n");
  }
  return [
    "사진은 인터넷에서 검색해 가져온다. image 섹션을 6~8개 배치하라.",
    "image 의 query 에는 **검색어**를 적어라.",
    "검색어는 사람 얼굴이 주인공이 아닌 사물·풍경·클로즈업·손동작 위주로 만들어라.",
  ].join("\n");
}

const COMMON_RULES = [
  "사람이 직접 쓴 듯한 구어체로 쓴다. AI 티 나는 표현(‘~에 대해 알아보겠습니다’, ‘결론적으로’, ‘~라고 할 수 있습니다’)을 쓰지 마라.",
  "도입(공감/후킹) → 본문(구획 2~4개) → 마무리(요약/행동유도) 순서로 구성한다.",
  "문단은 2~4줄로 짧게 끊는다.",
  // ⚠️ 7-8 — 스마트에디터가 입력 중에 마크다운을 서식으로 바꿔버린다.
  //    특히 한국어 구어체의 물결표(~)가 취소선이 된다. 지시만으로는 부족해서 타이핑 직전에도 무력화한다.
  "마크다운 기호를 절대 쓰지 마라 — `**`, `~~`, `~`, `#`, `>`, 백틱, `-` 목록 전부 금지. 순수한 문장만 쓴다.",
  // ⚠️ 7-24 — AI 는 본문에 없는 highlight 를 지어낸다(실측 5개 중 1개).
  "paragraph 의 highlight 는 **같은 문단 text 안에 글자 그대로 들어 있는 구절**만 적는다. 요약하거나 새로 지어내지 마라.",
  "highlight 는 문단당 최대 1개, 전체 문단의 30% 정도에만 붙인다.",
];

const SECTION_SPEC = `
출력 형식(JSON):
{
  "title": "글 제목",
  "sections": [
    { "type": "heading",   "text": "소제목" },
    { "type": "paragraph", "text": "문단 내용", "highlight": "문단 안에 그대로 있는 핵심 구절(선택)" },
    { "type": "quote",     "text": "짧은 한 줄(15~30자)" },
    { "type": "divider" },
    { "type": "image",     "query": "…", "caption": "사진 아래 한 줄 설명" }
  ]
}`.trim();

export function modeInstruction(mode: JobMode): string {
  if (mode === "review") {
    return [
      "이 글은 **체험단 후기**다.",
      // 실제 상위 노출 블로그들의 문법이다. 소제목을 heading 이 아니라 quote 로 쓴다.
      "소제목은 `heading` 이 아니라 `quote` 로 만든다. quote 는 짧은 한 줄(15~30자).",
      "철저히 1인칭으로 쓴다 — “저희는”, “~했어요”, “~더라구요”.",
      "“ㅎㅎ”, “진짜” 같은 표현을 과하지 않게 자연스럽게 섞는다.",
      "도입에서 결론을 살짝 흘린다.",
      "실용정보를 구획별로 담는다 — 가는 법 / 웨이팅 / 가격 / 언제 갈지 / 주의점.",
      "문단 1~2개마다 사진 1장이 오는 리듬으로 배치한다.",
      "마무리는 총평 + ‘다시 간다면’의 팁으로 닫는다.",
    ].join("\n");
  }
  if (mode === "branding") {
    return [
      "이 글은 **브랜딩·전문성** 글이다.",
      "소제목은 `heading` 이 아니라 `quote` 로 만든다. quote 는 짧은 한 줄(15~30자).",
      "“~입니다” 전문가체로 쓴다.",
      "구조를 반드시 이 순서로 고정한다:",
      "  ① 권위 선점(숫자 실적) ② 독자의 문제/오해 짚기 ③ 왜 그 방법이 안 통하는지",
      "  ④ 이름 붙인 자체 프레임워크 ⑤ 예상 반박 Q&A ⑥ 정리 + 행동 유도",
      "구획 전환에 divider 를 1~2회 넣는다.",
      // 12장의 법적·윤리 요구사항이다.
      "**숫자를 지어내지 마라.** 사용자가 준 내용 안에 있는 숫자만 쓴다. 없으면 숫자를 쓰지 않는다.",
    ].join("\n");
  }
  return [
    "이 글은 **자동 발굴** 글이다. 수집한 자료를 바탕으로 블로그 글 한 편을 쓴다.",
    "수집 자료를 참고하되 **문장을 그대로 베끼지 마라.** 내 말로 다시 쓴다.",
    "소제목은 `heading` 으로 2~4구획 만든다.",
  ].join("\n");
}

export function draftPrompt(args: {
  mode: JobMode;
  keyword: string;
  ideaTitle?: string;
  ideaAngle?: string;
  topic?: string;
  points?: string;
  sourcesBlock?: string;
  photoSource: PhotoSource;
  photoCount: number;
  photoDescs?: { file: string; desc: string }[];
  imageStyle?: ImageStyle;
}): string {
  const parts: string[] = [
    "너는 네이버 블로그 글을 쓰는 사람이다. 아래 조건에 맞춰 글 한 편을 JSON 으로 만들어라.",
    "",
    modeInstruction(args.mode),
    "",
    `주제 키워드: ${args.keyword}`,
  ];
  if (args.ideaTitle) parts.push(`정한 글감: ${args.ideaTitle}`);
  if (args.ideaAngle) parts.push(`관점: ${args.ideaAngle}`);
  if (args.topic) parts.push(`주제: ${args.topic}`);
  if (args.points) parts.push(`반드시 담을 핵심 내용:\n${args.points}`);
  if (args.sourcesBlock) {
    parts.push("", "참고 자료(그대로 베끼지 말 것):", args.sourcesBlock);
  }
  parts.push(
    "",
    "지켜야 할 것:",
    ...COMMON_RULES.map((r) => `- ${r}`),
    `- ${photoHintFor(args.photoSource, args.photoCount, args.photoDescs)}`,
    "",
    SECTION_SPEC,
  );
  return parts.join("\n");
}

export function ideasPrompt(keyword: string, sourcesBlock: string, n: number): string {
  return [
    `너는 네이버 블로그 글감을 잡는 사람이다. 키워드 "${keyword}" 로 쓸 글감을 ${n}개 만들어라.`,
    "",
    "수집한 자료:",
    sourcesBlock || "(자료를 가져오지 못했다. 키워드만으로 만들어라.)",
    "",
    "조건:",
    "- 자료에서 지금 사람들이 무엇을 궁금해하는지 읽어내고, 검색해서 들어올 만한 글감을 잡아라.",
    "- title 은 실제 블로그 제목처럼 구체적으로. 40자 이내.",
    "- angle 은 어떤 관점으로 쓸지 한 줄.",
    "- rationale 은 왜 지금 이 글감이 통할지 한 줄.",
    "- 좋은 순서대로 정렬해서 내라. 1번이 가장 좋은 글감이어야 한다.",
    "",
    `출력 형식(JSON): { "ideas": [ { "title": "…", "angle": "…", "rationale": "…" } ] }`,
  ].join("\n");
}
