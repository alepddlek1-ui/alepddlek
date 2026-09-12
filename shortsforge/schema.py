"""산출물 검증.

프롬프트가 "후킹 포인트 10개", "대댓글 20개" 라고 말했는데 7개만 나오는 일은
흔하다. 그걸 다음 단계로 흘려보내면 마지막에 가서야 발견한다.
여기서 **개수까지** 세는 이유다.

jsonschema 를 쓰지 않는 이유: 이 파이프라인이 요구하는 건 '필수 키가 있는가 /
개수가 맞는가' 수준이고, 의존성 하나를 더 얹을 만큼의 값이 없다.
대신 오류 메시지를 사람이 바로 고칠 수 있게 쓴다.
"""

from __future__ import annotations

from typing import Any, Callable

from .stages import Stage


def _count(minimum: int, maximum: int | None = None) -> Callable[[Any], bool]:
    def check(value: Any) -> bool:
        if not isinstance(value, list):
            return False
        return minimum <= len(value) <= (maximum if maximum is not None else 10**6)

    check.counts = True     # 오류 메시지에 '지금 n개' 를 붙일지 여부
    return check


def _texts_within(low: int, high: int) -> Callable[[Any], bool]:
    """리스트의 문자열 길이가 전부 범위 안인가. (제목 15~30자 같은 것)"""
    def check(value: Any) -> bool:
        if not isinstance(value, list) or not value:
            return False
        return all(isinstance(v, str) and low <= len(v.strip()) <= high for v in value)

    return check


def _beats_cover(labels: set[str]) -> Callable[[Any], bool]:
    """대본이 약속한 흐름을 실제로 다 거치는가."""
    def check(value: Any) -> bool:
        if not isinstance(value, list):
            return False
        got = {str(b.get("label", "")).strip() for b in value if isinstance(b, dict)}
        return labels <= got

    return check


# 단계별 추가 검사: (키, 사람이 읽는 기준, 검사)
_EXTRA: dict[str, list[tuple[str, str, Callable[[Any], bool]]]] = {
    # 4번 — 후킹 포인트 10개
    "shorts-product": [
        ("hooks", "후킹 포인트는 10개", _count(10)),
        ("strengths", "핵심 장점 2개 이상", _count(2)),
    ],
    # 3번 — 언어별 5개씩
    "shorts-keyword": [
        ("korean", "한국어 검색 키워드 5개", _count(5)),
        ("xiaohongshu", "샤오홍슈 검색어 5개", _count(5)),
        ("tiktok", "TikTok 검색어 5개", _count(5)),
    ],
    # 5번 — 분석한 영상이 하나는 있어야 한다
    "shorts-rival": [
        ("videos", "분석한 레퍼런스 영상 1개 이상", _count(1)),
        ("improvements", "우리 채널용 개선안 1개 이상", _count(1)),
    ],
    # 1번 — 20초, 공감→문제→해결→제품→CTA
    "shorts-script": [
        ("hook", "첫 2초 후킹은 한 문장 (40자 이내)",
         lambda v: isinstance(v, str) and 0 < len(v.strip()) <= 40),
        ("beats", "공감·문제·해결·제품 이 순서대로 다 있어야 한다",
         _beats_cover({"공감", "문제", "해결", "제품"})),
        ("duration_sec", "20초 안팎 (15~30초)",
         lambda v: isinstance(v, (int, float)) and 15 <= v <= 30),
    ],
    # 7번 — 20개, 15~30자
    "shorts-title": [
        ("titles", "제목 후보 20개", _count(20)),
        ("titles", "제목은 15~30자", _texts_within(15, 30)),
        ("pick", "그중 고른 하나", lambda v: isinstance(v, str) and v.strip()),
    ],
    # 2번 — 썸네일 5 · 해시태그 15 · 댓글 유도 3
    "shorts-caption": [
        ("thumbnail_texts", "썸네일 문구 5개", _count(5)),
        ("hashtags", "해시태그 15개", _count(15)),
        ("comment_baits", "댓글 유도 문장 3개", _count(3)),
        ("caption", "캡션은 한 문장 이상", lambda v: isinstance(v, str) and len(v.strip()) > 10),
    ],
    # 6번 — 고정 5 · 대댓글 20
    "shorts-comment": [
        ("pinned", "고정댓글 5개", _count(5)),
        ("replies", "대댓글 20개", _count(20)),
        ("buy", "구매 유도 댓글 1개 이상", _count(1)),
        ("save", "저장 유도 댓글 1개 이상", _count(1)),
    ],
    # 8번 — 50 / 50 / 30
    "shorts-factory": [
        ("similar_products", "비슷한 제품 50개", _count(50)),
        ("related_content", "연관 콘텐츠 50개", _count(50)),
        ("series", "시리즈 기획 30개", _count(30)),
    ],
}


def validate(stage: Stage, payload: dict) -> list[str]:
    """문제를 전부 모아서 돌려준다. 빈 리스트면 통과."""
    problems: list[str] = []

    if not isinstance(payload, dict):
        return [f"{stage.filename}: 최상위가 객체(JSON object)여야 합니다"]

    for key in stage.required:
        if key not in payload:
            problems.append(f"{stage.filename}: '{key}' 키가 없습니다")
        elif payload[key] in (None, "", [], {}):
            problems.append(f"{stage.filename}: '{key}' 가 비어 있습니다")

    for key, why, check in _EXTRA.get(stage.slug, []):
        value = payload.get(key)
        if value in (None, "", [], {}):
            continue                      # 위에서 이미 잡았다
        try:
            ok = bool(check(value))
        except Exception:                 # 검사식이 기대한 타입이 아닐 때
            ok = False
        if not ok:
            got = (
                f" (지금 {len(value)}개)"
                if isinstance(value, list) and getattr(check, "counts", False)
                else ""
            )
            problems.append(f"{stage.filename}: '{key}' — {why}{got}")

    return problems
