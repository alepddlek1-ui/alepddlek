"""파이프라인 전체가 주고받는 자료구조.

시간 단위 규칙
--------------
* 파이썬 코드 안에서는 전부 **초(float)** 로 다룬다.
* 캡컷 draft 로 나갈 때만 **마이크로초(int)** 로 바꾼다 (`export.capcut.draft`).
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Iterable


# --------------------------------------------------------------------------- #
# 전사(transcription)
# --------------------------------------------------------------------------- #
@dataclass
class Word:
    """STT 가 뱉은 단어 하나."""

    text: str
    start: float
    end: float
    prob: float = 1.0

    @property
    def duration(self) -> float:
        return max(0.0, self.end - self.start)


@dataclass
class Utterance:
    """단어들이 모인 발화 단위(문장)."""

    text: str
    start: float
    end: float
    words: list[Word] = field(default_factory=list)

    @property
    def duration(self) -> float:
        return max(0.0, self.end - self.start)


# --------------------------------------------------------------------------- #
# 구간
# --------------------------------------------------------------------------- #
@dataclass
class Span:
    """[start, end) 구간. 컷 후보이자 무음 구간이자 필러 구간."""

    start: float
    end: float
    reason: str = ""          # silence / filler / retake / manual ...
    detail: str = ""          # 사람이 읽을 근거 ("음...", "3.2s 무음")
    source: str = ""          # 어느 원본의 구간인지 (컷을 되살릴 때 필요)

    @property
    def duration(self) -> float:
        return max(0.0, self.end - self.start)

    def overlaps(self, other: "Span") -> bool:
        return self.start < other.end and other.start < self.end

    def clamped(self, lo: float, hi: float) -> "Span":
        return Span(
            max(self.start, lo), min(self.end, hi), self.reason, self.detail, self.source
        )


# --------------------------------------------------------------------------- #
# 타임라인 산출물
# --------------------------------------------------------------------------- #
@dataclass
class Clip:
    """원본 영상에서 잘라내 타임라인에 올릴 조각 하나."""

    source: str               # 원본 파일 경로
    source_start: float       # 원본 기준 시작
    source_end: float         # 원본 기준 끝
    timeline_start: float     # 최종 타임라인 기준 시작
    speed: float = 1.0

    @property
    def source_duration(self) -> float:
        return max(0.0, self.source_end - self.source_start)

    @property
    def duration(self) -> float:
        return self.source_duration / self.speed if self.speed else 0.0

    @property
    def timeline_end(self) -> float:
        return self.timeline_start + self.duration


@dataclass
class Caption:
    """화면에 찍힐 자막 한 장."""

    text: str
    start: float              # 최종 타임라인 기준
    end: float
    style: str = "default"
    emphasis: list[str] = field(default_factory=list)   # 강조할 단어들
    position: float = 0.72    # 화면 세로 위치. 0=맨 위, 1=맨 아래
    layer: str = "caption"    # caption=말자막 / overlay=훅·CTA 같은 얹는 문구

    @property
    def duration(self) -> float:
        return max(0.0, self.end - self.start)


@dataclass
class NarrationLine:
    """AI 오디오(TTS) 로 읽힐 한 줄."""

    text: str
    start: float              # 최종 타임라인 기준
    audio_path: str | None = None
    duration: float = 0.0
    voice: str | None = None

    @property
    def end(self) -> float:
        return self.start + self.duration


@dataclass
class EditPlan:
    """편집 결정이 전부 담긴 중간 산출물.

    이 JSON 하나만 있으면 캡컷 draft / SRT / ffmpeg 렌더 아무 데로나 내보낼 수 있다.
    사람이 열어서 직접 고치는 것도 상정한 포맷.
    """

    project: str
    width: int = 1080
    height: int = 1920
    fps: int = 30
    clips: list[Clip] = field(default_factory=list)
    captions: list[Caption] = field(default_factory=list)
    narration: list[NarrationLine] = field(default_factory=list)
    music: str | None = None
    music_gain_db: float = -18.0
    removed: list[Span] = field(default_factory=list)   # 왜 잘렸는지 기록용
    meta: dict[str, Any] = field(default_factory=dict)

    @property
    def duration(self) -> float:
        ends = [c.timeline_end for c in self.clips]
        ends += [c.end for c in self.captions]
        ends += [n.end for n in self.narration]
        return max(ends) if ends else 0.0

    # ---- 직렬화 ---------------------------------------------------------- #
    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["duration"] = round(self.duration, 3)
        return d

    def save(self, path: str | Path) -> Path:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(self.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8"
        )
        return path

    @classmethod
    def load(cls, path: str | Path) -> "EditPlan":
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
        raw.pop("duration", None)
        return cls(
            project=raw["project"],
            width=raw.get("width", 1080),
            height=raw.get("height", 1920),
            fps=raw.get("fps", 30),
            clips=[Clip(**c) for c in raw.get("clips", [])],
            captions=[Caption(**c) for c in raw.get("captions", [])],
            narration=[NarrationLine(**n) for n in raw.get("narration", [])],
            music=raw.get("music"),
            music_gain_db=raw.get("music_gain_db", -18.0),
            removed=[Span(**s) for s in raw.get("removed", [])],
            meta=raw.get("meta", {}),
        )


# --------------------------------------------------------------------------- #
# 구간 연산 유틸 (planner / captions 양쪽에서 씀)
# --------------------------------------------------------------------------- #
def merge_spans(spans: Iterable[Span], gap: float = 0.0) -> list[Span]:
    """겹치거나 `gap` 이내로 붙어 있는 구간들을 하나로 합친다."""
    ordered = sorted(spans, key=lambda s: (s.start, s.end))
    merged: list[Span] = []
    for span in ordered:
        if span.duration <= 0:
            continue
        if merged and span.start - merged[-1].end <= gap:
            prev = merged[-1]
            reasons = {prev.reason, span.reason} - {""}
            details = [d for d in (prev.detail, span.detail) if d]
            merged[-1] = Span(
                prev.start,
                max(prev.end, span.end),
                "+".join(sorted(reasons)),
                " / ".join(details),
                prev.source or span.source,
            )
        else:
            merged.append(Span(span.start, span.end, span.reason, span.detail))
    return merged


def invert_spans(
    spans: Iterable[Span], start: float, end: float, *, gap: float = 0.0
) -> list[Span]:
    """`[start, end)` 에서 `spans` 를 빼고 남는 구간들.

    `gap` 이내로 붙어 있는 컷들은 하나로 보므로, 컷과 컷 사이에
    한 프레임짜리 파편이 남지 않는다.
    """
    keep: list[Span] = []
    cursor = start
    for span in merge_spans(spans, gap=gap):
        if span.end <= start or span.start >= end:
            continue
        s = max(span.start, start)
        if s > cursor:
            keep.append(Span(cursor, s, "keep"))
        cursor = max(cursor, min(span.end, end))
    if cursor < end:
        keep.append(Span(cursor, end, "keep"))
    return [k for k in keep if k.duration > 0]
