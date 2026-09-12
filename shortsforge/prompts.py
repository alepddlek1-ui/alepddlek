"""프롬프트 슬롯 읽기.

`prompts/*.md` 는 사용자의 영역이다. 이 모듈은 그 파일에서
`## 프롬프트` 아래 본문만 꺼내고, `{상품명}` 같은 치환어를 이번 편의
실제 값으로 바꿔준다.

에이전트는 이 결과를 그대로 받아 자기 지시문으로 쓴다.
"""

from __future__ import annotations

import re
from pathlib import Path

import yaml

from .stages import Stage
from .workspace import Workspace

PLACEHOLDER = "아직 비어 있습니다"
_HEADING = re.compile(r"^##\s*프롬프트\s*$", re.MULTILINE)


class PromptError(RuntimeError):
    pass


def read_slot(stage: Stage, *, root: Path | None = None) -> str:
    """슬롯 파일에서 프롬프트 본문만 꺼낸다."""
    path = (root / stage.prompt) if root else stage.prompt_path
    if not path.is_file():
        raise PromptError(f"프롬프트 파일이 없습니다: {path}")
    text = path.read_text(encoding="utf-8")
    match = _HEADING.search(text)
    if not match:
        # '## 프롬프트' 머리말을 지워버린 경우. 파일 전체를 프롬프트로 본다.
        return text.strip()
    return text[match.end():].strip()


def is_empty(body: str) -> bool:
    return not body.strip() or PLACEHOLDER in body


def variables(ws: Workspace) -> dict[str, str]:
    """`{상품명}` 같은 치환어에 넣을 값들."""
    raw: dict = {}
    if ws.input_path.is_file():
        raw = yaml.safe_load(ws.input_path.read_text(encoding="utf-8")) or {}
    product = raw.get("product") or {}
    audience = raw.get("audience") or {}
    source = raw.get("source") or {}
    video = raw.get("video") or {}
    return {
        "작업폴더": str(ws.root),
        "상품명": str(raw.get("name") or ws.name),
        "상품링크": str(product.get("url") or ""),
        "카테고리": str(product.get("category") or ""),
        "가격": str(product.get("price") or ""),
        "영상경로": str(source.get("video") or ""),
        "영상길이": str(source.get("duration_sec") or ""),
        "타깃": str(audience.get("who") or ""),
        "불편": str(audience.get("pain") or ""),
        "톤": str(audience.get("tone") or ""),
        "목표길이": str(video.get("duration_sec") or 35),
    }


def substitute(body: str, values: dict[str, str]) -> str:
    """`{키}` 를 값으로 바꾼다. 모르는 중괄호는 건드리지 않는다.

    프롬프트에는 JSON 예시가 들어가는 일이 잦아서 `str.format` 은 쓸 수 없다.
    ({"hook": ...} 같은 게 전부 터진다)
    """
    def swap(match: re.Match) -> str:
        key = match.group(1).strip()
        return values.get(key, match.group(0))

    return re.sub(r"\{([^{}\n]{1,20})\}", swap, body)


def resolve(stage: Stage, ws: Workspace, *, root: Path | None = None) -> str:
    """슬롯 + 이번 편의 값 → 실행 가능한 프롬프트."""
    body = read_slot(stage, root=root)
    if is_empty(body):
        raise PromptError(
            f"{stage.prompt_path} 가 비어 있습니다. "
            f"'## 프롬프트' 아래에 {stage.title} 프롬프트를 붙여넣으세요."
        )
    return substitute(body, variables(ws))
