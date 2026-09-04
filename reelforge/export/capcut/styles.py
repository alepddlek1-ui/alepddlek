"""릴스 자막 스타일 프리셋.

캡컷의 텍스트 재질은 색을 0~1 실수 RGB 로 받는다. 여기서는 사람이 읽는
'#ffcc00' 을 그대로 쓰고 변환은 마지막에 한 번만 한다.
"""

from __future__ import annotations

from dataclasses import dataclass, field


def hex_to_rgb(value: str) -> list[float]:
    value = value.lstrip("#")
    if len(value) == 3:
        value = "".join(ch * 2 for ch in value)
    if len(value) != 6:
        raise ValueError(f"색상 형식이 잘못됐습니다: #{value}")
    return [int(value[i : i + 2], 16) / 255.0 for i in (0, 2, 4)]


@dataclass
class TextStyle:
    """자막 한 장의 생김새."""

    name: str
    color: str = "#ffffff"
    emphasis_color: str = "#ffe14d"
    size: float = 12.0            # 캡컷 내부 단위 (대략 pt)
    bold: bool = True
    stroke_color: str | None = "#000000"
    stroke_width: float = 0.09
    shadow: bool = True
    shadow_alpha: float = 0.55
    background_color: str | None = None
    background_alpha: float = 0.65
    letter_spacing: float = 0.0
    line_spacing: float = 0.02
    alignment: int = 1            # 0=왼쪽 1=가운데 2=오른쪽
    scale: float = 1.0
    animation_in: str | None = "펀치"   # 표시용 이름 (draft 에는 keyframe 으로 근사)
    keywords_bold: bool = True
    extra: dict = field(default_factory=dict)


PRESETS: dict[str, TextStyle] = {
    # 인스타 릴스 기본값. 흰 글씨 + 굵은 검정 외곽선 → 어떤 배경에서도 읽힌다.
    "reels_bold": TextStyle(
        name="reels_bold",
        color="#ffffff",
        emphasis_color="#ffe14d",
        size=12.0,
        stroke_color="#000000",
        stroke_width=0.10,
    ),
    # 정보형/후킹형. 노란 형광펜 느낌.
    "pop_yellow": TextStyle(
        name="pop_yellow",
        color="#fff33f",
        emphasis_color="#ffffff",
        size=13.0,
        stroke_color="#1a1a1a",
        stroke_width=0.12,
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
        shadow=True,
        shadow_alpha=0.35,
        letter_spacing=0.02,
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
