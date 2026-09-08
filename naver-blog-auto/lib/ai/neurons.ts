/**
 * Cloudflare Workers AI 뉴런 단가 — 서버·클라이언트 공용 순수 함수.
 *
 * ⚠️ 7-12 — 문서만 보면 `타일 × 4.8 + 스텝 × 9.6` 처럼 읽히지만 틀렸다.
 *    스텝 요금은 이미지 1장이 아니라 **타일마다** 붙는다.
 *      잘못:  4×4.8 + 6×9.6   =  76.8/장
 *      맞음:  4×(4.8 + 6×9.6) = 249.6/장   ← 실측 7,738 ÷ 31장 = 249.6 (오차 0.4)
 *    잘못된 공식으로 계산하면 사용량을 3.4배 과소평가한다.
 */
export const FREE_NEURONS_PER_DAY = 10_000;

export function neuronsPerImage(steps: number, size = 1024): number {
  const tiles = Math.max(1, Math.round((size / 512) * (size / 512)));
  return tiles * (4.8 + Math.min(Math.max(steps, 1), 8) * 9.6);
}

/**
 * ⚠️ 반환값은 정수가 아니다(6스텝 = 249.6). 표의 250 은 반올림값이다.
 *    계산은 실수로 하고, 화면에 표시할 때만 반올림한다. 안 그러면 계량기에 소수점이 뜬다.
 */
export function imagesPerFreeDay(steps: number, size = 1024): number {
  return Math.floor(FREE_NEURONS_PER_DAY / neuronsPerImage(steps, size));
}

/** 이미지 N장짜리 글을 무료 한도로 하루 몇 편 쓸 수 있나 */
export function postsPerFreeDay(steps: number, imagesPerPost: number, size = 1024): number {
  if (imagesPerPost <= 0) return Infinity;
  return Math.floor(FREE_NEURONS_PER_DAY / (neuronsPerImage(steps, size) * imagesPerPost));
}

export const fmtNeurons = (n: number) => Math.round(n).toLocaleString("ko-KR");
