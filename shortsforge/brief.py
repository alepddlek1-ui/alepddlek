"""shortsforge 산출물 → reelforge 브리프(brief.yaml).

여기가 두 파이프라인이 만나는 지점이다.
기획이 끝나면 촬영만 하면 되고, 촬영본 경로를 brief.yaml 에 채우면
`reelforge build` 가 캡컷 프로젝트까지 만들어준다.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from .workspace import Workspace, WorkspaceError


def _read_input(ws: Workspace) -> dict[str, Any]:
    if not ws.input_path.is_file():
        return {}
    return yaml.safe_load(ws.input_path.read_text(encoding="utf-8")) or {}


def build_brief(ws: Workspace) -> dict[str, Any]:
    """대본·캡션·키워드를 모아 reelforge 브리프 딕셔너리를 만든다."""
    script = ws.load("shorts-script")
    source = _read_input(ws)
    video = source.get("video") or {}
    audience = source.get("audience") or {}

    # 나레이션 대본: 한 줄 = 한 호흡. reelforge 의 TTS 가 줄 단위로 끊어 읽는다.
    lines = [script.get("hook", "")]
    for beat in script.get("beats", []):
        line = (beat.get("line") or "").strip()
        if line:
            lines.append(line)
    lines.append(script.get("cta", ""))
    narration_script = "\n".join(l for l in lines if l).strip() + "\n"

    keywords = list(script.get("keywords") or [])
    if not keywords and ws.is_done("shorts-keyword"):
        keywords = [k for k in (ws.load("shorts-keyword").get("primary") or [])][:6]

    idea_lines = [
        f"타깃: {audience.get('who', '')}",
        f"불편: {audience.get('pain', '')}",
        f"톤: {audience.get('tone', '')}",
        f"구성: {' → '.join(b.get('label', '') for b in script.get('beats', []) if b.get('label'))}",
    ]

    brief: dict[str, Any] = {
        "project": ws.name,
        # 촬영 전이라 비워둔다. 찍고 나서 경로만 채우면 된다.
        "footage": [],
        "aspect": video.get("aspect", "9:16"),
        "fps": 30,
        "hook": script.get("hook", ""),
        "idea": "\n".join(l for l in idea_lines if l.split(": ", 1)[-1]),
        "script": narration_script,
        "cta": script.get("cta", ""),
        "keywords": keywords,
        "captions": {
            # 나레이션을 쓰면 대본이 곧 자막이고, 직접 말했으면 전사가 자막이다.
            "source": "script" if video.get("narration") else "transcript",
            "style": "reels_bold",
            "max_chars": 14,
            "max_lines": 2,
        },
        "narration": {
            "enabled": bool(video.get("narration", False)),
            "provider": "edge",
            "voice": video.get("voice", "ko-KR-SunHiNeural"),
            "speed": 1.05,
            "mode": "replace" if video.get("narration") else "off",
        },
    }
    return brief


class _BriefDumper(yaml.SafeDumper):
    """여러 줄 문자열을 `|` 블록으로 뽑는다.

    기본 덤퍼는 대본을 따옴표 하나에 밀어넣고 줄바꿈마다 빈 줄을 끼운다.
    사람이 열어서 고치는 파일이라 그렇게 두면 안 된다.
    """


def _literal(dumper: yaml.SafeDumper, value: str):
    style = "|" if "\n" in value.strip() else None
    return dumper.represent_scalar("tag:yaml.org,2002:str", value, style=style)


_BriefDumper.add_representer(str, _literal)


_HEADER = """# reelforge 브리프 — shortsforge 가 생성했습니다.
# 촬영이 끝나면 footage 에 파일 경로만 채우고:
#     reelforge build {path}
"""


def write_brief(ws: Workspace) -> Path:
    if not ws.is_done("shorts-script"):
        raise WorkspaceError("대본(04_script.json)이 먼저 있어야 브리프를 만들 수 있습니다")
    target = ws.root / "brief.yaml"
    body = yaml.dump(
        build_brief(ws),
        Dumper=_BriefDumper,
        allow_unicode=True,
        sort_keys=False,
        default_flow_style=False,
    )
    target.write_text(_HEADER.format(path=target) + body, encoding="utf-8")
    return target
