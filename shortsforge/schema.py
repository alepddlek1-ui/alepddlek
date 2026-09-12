"""산출물 검증.

에이전트가 JSON 을 뱉는 구조라서, 키 하나가 비거나 이름이 바뀌면
다음 단계가 조용히 이상한 걸 만든다. 여기서 미리 걸러낸다.

jsonschema 를 쓰지 않는 이유: 이 파이프라인이 요구하는 건
'필수 키가 있는가 / 비어있지 않은가' 수준이고, 의존성 하나를 더 얹을 만큼의
값이 없다. 대신 오류 메시지를 사람이 바로 고칠 수 있게 쓴다.
"""

from __future__ import annotations

from .stages import Stage

# 단계별 추가 검사. (키 경로, 사람이 읽는 설명, 검사 함수)
_EXTRA: dict[str, list[tuple[str, str, object]]] = {
    "shorts-script": [
        ("hook", "훅은 12자 이내 한 문장", lambda v: isinstance(v, str) and 0 < len(v) <= 40),
        ("beats", "beats 는 2개 이상의 장면", lambda v: isinstance(v, list) and len(v) >= 2),
        ("duration_sec", "목표 길이는 10~90초", lambda v: isinstance(v, (int, float)) and 10 <= v <= 90),
    ],
    "shorts-title": [
        ("titles", "제목 후보는 5개 이상", lambda v: isinstance(v, list) and len(v) >= 5),
        ("pick", "고른 제목 하나", lambda v: isinstance(v, str) and v.strip()),
    ],
    "shorts-keyword": [
        ("search_terms", "검색어는 5개 이상", lambda v: isinstance(v, list) and len(v) >= 5),
        ("hashtags", "해시태그는 3~15개", lambda v: isinstance(v, list) and 3 <= len(v) <= 15),
    ],
    "shorts-caption": [
        ("thumbnail", "썸네일은 text/sub/composition 을 가진 객체",
         lambda v: isinstance(v, dict) and "text" in v),
    ],
    "shorts-comment": [
        ("seeds", "시드 댓글 3개 이상", lambda v: isinstance(v, list) and len(v) >= 3),
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
        if key in payload and payload[key] not in (None, "", [], {}):
            try:
                ok = bool(check(payload[key]))
            except Exception:  # 검사식이 기대한 타입이 아닐 때
                ok = False
            if not ok:
                problems.append(f"{stage.filename}: '{key}' — {why}")

    return problems
