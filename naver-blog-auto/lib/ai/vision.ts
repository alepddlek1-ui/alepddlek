import { runClaudeJson } from "@/lib/claude";
import { VisionVerdictSchema, GenVerdictSchema, type VisionVerdict, type GenVerdict } from "@/lib/types";

/**
 * 크롤링 사진 판정 — 세 축을 따로 묻는다(6-6).
 * ⚠️ 7-13 — 이 함수를 AI 생성 이미지에 쓰지 마라. 생성물에는 워터마크도 초상권도 없어서
 *    koreanPerson 필터에 멀쩡한 이미지가 탈락한다. 생성물은 judgeGenerated() 를 쓴다.
 */
export async function judgeCrawled(
  imagePath: string,
  context: { title: string; caption?: string; query: string },
): Promise<VisionVerdict> {
  const prompt = [
    "첨부한 이미지를 보고 아래 세 가지를 각각 판단해 JSON 으로만 답하라.",
    "",
    `글 제목: ${context.title}`,
    `이 자리에 들어갈 사진: ${context.query}`,
    context.caption ? `사진 설명: ${context.caption}` : "",
    "",
    "판단 기준:",
    "- watermark: 워터마크 / 사이트 로고 / 저작권 표기 / 서명 / 스톡 출처표시가 **조금이라도** 보이면 true. 의심스러우면 true.",
    "- koreanPerson: 한국인 얼굴이 식별 가능하면 true(초상권 위험). 얼굴이 안 보이거나(뒷모습·손·실루엣) 명백한 외국인 스톡이면 false. **애매하면 true**(안전한 쪽으로).",
    "- fit: 위 둘이 문제없다는 전제에서, 주제와 이 자리에 어울리는 사진인가.",
    "- reason: 판단 이유를 한국어 한 줄로.",
    "",
    `출력 형식: { "fit": true/false, "watermark": true/false, "koreanPerson": true/false, "reason": "…" }`,
  ]
    .filter(Boolean)
    .join("\n");

  const r = await runClaudeJson(prompt, VisionVerdictSchema, { images: [imagePath], retries: 1 });
  if (!r.ok) {
    // ⚠️ 6-6 — 판정 호출이 실패했을 때 그 이미지를 채택하면 안 된다.
    //    claude 한도 초과가 "검증 안 된 이미지 통과"로 이어지는 걸 막는다.
    return { fit: false, watermark: false, koreanPerson: false, reason: `판정 실패: ${r.error}` };
  }
  const v = r.data;
  // ⚠️ AI 가 fit=true 로 답해도 무시한다. 워터마크·초상권이면 코드에서 강제로 탈락시킨다.
  const fit = v.fit && !v.watermark && !v.koreanPerson;
  const reason = v.watermark
    ? `워터마크 — ${v.reason}`
    : v.koreanPerson
      ? `국내 인물(초상권) — ${v.reason}`
      : fit
        ? v.reason
        : `주제 불일치 — ${v.reason}`;
  return { ...v, fit, reason };
}

/**
 * AI 생성 이미지 판정 — 크롤링용과 분리한다(7-13).
 * 워터마크·초상권은 원천적으로 없으므로 네 가지만 본다.
 */
export async function judgeGenerated(
  imagePath: string,
  context: { title: string; query: string },
): Promise<GenVerdict> {
  const prompt = [
    "첨부한 이미지는 AI 가 생성한 그림이다. 아래 네 가지만 보고 JSON 으로만 답하라.",
    "",
    `글 제목: ${context.title}`,
    `그리려던 장면: ${context.query}`,
    "",
    "- offTopic: 그리려던 장면과 다른 것이 그려졌으면 true",
    "- malformed: 형태가 깨졌으면(손가락·사물 구조 이상) true",
    "- hasText: 글자나 글자처럼 보이는 것이 섞여 있으면 true (깨진 글자 포함)",
    "- lowQuality: 흐리거나 뭉개져서 블로그에 쓰기 어려우면 true",
    "- ok: 위 네 가지가 모두 false 일 때만 true",
    "- reason: 이유를 한국어 한 줄로. 문제가 있으면 **무엇을 고쳐야 하는지**까지 적어라.",
    "",
    `출력 형식: { "ok": true/false, "offTopic": …, "malformed": …, "hasText": …, "lowQuality": …, "reason": "…" }`,
  ].join("\n");

  const r = await runClaudeJson(prompt, GenVerdictSchema, { images: [imagePath], retries: 1 });
  if (!r.ok) {
    return {
      ok: false,
      offTopic: false,
      malformed: false,
      hasText: false,
      lowQuality: false,
      reason: `판정 실패: ${r.error}`,
    };
  }
  const v = r.data;
  const ok = v.ok && !v.offTopic && !v.malformed && !v.hasText && !v.lowQuality;
  return { ...v, ok };
}
