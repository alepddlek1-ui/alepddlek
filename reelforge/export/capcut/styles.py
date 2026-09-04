"""릴스 자막 스타일 프리셋 → pycapcut 텍스트 설정.

사람이 읽는 '#ffcc00' 으로 적어두고, pycapcut 이 원하는 0~1 실수 RGB 로는
마지막에 한 번만 바꾼다.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


def hex_to_rgb(value: str) -> tuple[float, float, float]:
    value = value.lstrip("#")
    if len(value) == 3:
        value = "".join(ch * 2 for ch in value)
    if len(value) != 6:
        raise ValueError(f"색상 형식이 잘못됐습니다: #{value}")
    r, g, b = (int(value[i : i + 2], 16) / 255.0 for i in (0, 2, 4))
    return (r, g, b)


@dataclass
class TextStyle:
    """자막 한 장의 생김새."""

    name: str
    color: str = "#ffffff"
    emphasis_color: str = "#ffe14d"
    size: float = 12.0            # 캡컷 내부 단위
    bold: bool = True
    stroke_color: str | None = "#000000"
    stroke_width: float = 40.0    # pycapcut 의 TextBorder.width 단위
    background_color: str | None = None
    background_alpha: float = 0.62
    letter_spacing: int = 0
    line_spacing: int = 0
    align: int = 1                # 0=왼쪽 1=가운데 2=오른쪽
    max_line_width: float = 0.82
    scale: float = 1.0
    # pycapcut 의 TextIntro 멤버 이름. 없는 이름이면 조용히 건너뛴다.
    animation_in: str | None = "Wiping_In"
    animation_ms: float = 0.3
    extra: dict[str, Any] = field(default_factory=dict)


PRESETS: dict[str, TextStyle] = {
    # 릴스 기본값. 흰 글씨 + 굵은 검정 외곽선 → 어떤 배경에서도 읽힌다.
    "reels_bold": TextStyle(
        name="reels_bold",
        color="#ffffff",
        emphasis_color="#ffe14d",
        size=12.0,
        stroke_color="#000000",
        stroke_width=44.0,
    ),
    # 정보형/후킹형. 노란 형광펜 느낌.
    "pop_yellow": TextStyle(
        name="pop_yellow",
        color="#fff33f",
        emphasis_color="#ffffff",
        size=13.0,
        stroke_color="#1a1a1a",
        stroke_width=52.0,
    ),
    # 브랜드/무드 영상. 얇고 조용하게.
    "minimal": TextStyle(
        name="minimal",
        color="#ffffff",
        emphasis_color="#ffffff",
        size=9.5,
        bold=False,
        stroke_color=None,
        stroke_width=0.0,
        letter_spacing=1,
        animation_in=None,
    ),
    # 자막 박스형. 배경이 복잡한 야외 촬영에 안전하다.
    "caption_box": TextStyle(
        name="caption_box",
        color="#ffffff",
        emphasis_color="#ffe14d",
        size=10.5,
        stroke_color=None,
        stroke_width=0.0,
        background_color="#000000",
        background_alpha=0.62,
    ),
}


def get_style(name: str) -> TextStyle:
    if name not in PRESETS:
        raise KeyError(
            f"모르는 자막 스타일 '{name}'. 가능한 값: {', '.join(sorted(PRESETS))}"
        )
    return PRESETS[name]


# --------------------------------------------------------------------------- #
# pycapcut 어댑터
# --------------------------------------------------------------------------- #
def to_pycapcut(style: TextStyle):
    """`(TextStyle, TextBorder|None, TextBackground|None)` 로 변환."""
    import pycapcut as pc

    text_style = pc.TextStyle(
        size=style.size,
        bold=style.bold,
        align=style.align,
        color=hex_to_rgb(style.color),
        letter_spacing=style.letter_spacing,
        line_spacing=style.line_spacing,
        max_line_width=style.max_line_width,
        auto_wrapping=False,     # 줄바꿈은 우리가 이미 넣었다
    )
    border = (
        pc.TextBorder(color=hex_to_rgb(style.stroke_color), width=style.stroke_width)
        if style.stroke_color
        else None
    )
    background = (
        pc.TextBackground(
            color=style.background_color,
            alpha=style.background_alpha,
            round_radius=0.12,
            height=0.14,
            width=0.14,
        )
        if style.background_color
        else None
    )
    return text_style, border, background


def intro_animation(style: TextStyle):
    """프리셋이 지정한 등장 애니메이션. 설치된 pycapcut 에 없으면 None."""
    if not style.animation_in:
        return None
    import pycapcut as pc

    return getattr(pc.TextIntro, style.animation_in, None)
