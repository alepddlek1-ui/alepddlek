"""탐지 결과 → 실제 컷 리스트.

무음/필러/말더듬/재촬영본을 모아 '버릴 구간'을 확정하고, 남는 구간을
타임라인 위에 이어 붙여 `Clip` 목록으로 만든다.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..models import Clip, Span, Utterance, merge_spans
from .fillers import FillerConfig, detect_fillers, detect_retakes


@dataclass
class CutConfig:
    # 문장 사이 정적을 이만큼까지는 허용한다 (호흡)
    max_pause: float = 0.45
    # 잘라낸 뒤 남겨둘 숨소리 길이
    keep_pause: float = 0.12
    # 이보다 짧게 남는 조각은 깜빡임처럼 보여 버린다
    min_clip: float = 0.30
    # 이보다 짧은 컷은 굳이 자르지 않는다 (자잘한 컷은 오히려 산만)
    min_cut: float = 0.15
    # 영상 맨 앞/뒤 무음은 통째로 잘라낸다
    trim_head_tail: bool = True
    # 재촬영(NG) 자동 제거
    drop_retakes: bool = True
    # 컷 지점 앞뒤 여유
    pad: float = 0.05


def build_cuts(
    *,
    duration: float,
    silences: list[Span],
    utterances: list[Utterance],
    cut_config: CutConfig | None = None,
    filler_config: FillerConfig | None = None,
    protect: list[Span] | None = None,
) -> tuple[list[Span], list[Span]]:
    """`(남길 구간, 버릴 구간)` 을 돌려준다.

    protect  절대 자르면 안 되는 구간 (예: 손으로 지정한 훅, 제품 클로즈업).
    """
    cfg = cut_config or CutConfig()
    remove: list[Span] = []

    # 1) 정적: 통째로 버리지 않고 `keep_pause` 만큼 숨을 남긴다.
    for span in silences:
        head = span.start <= 0.05
        tail = span.end >= duration - 0.05
        if cfg.trim_head_tail and (head or tail):
            remove.append(Span(span.start, span.end, "silence", "앞뒤 여백 정리"))
            continue
        excess = span.duration - cfg.max_pause
        if excess <= 0:
            continue
        # 가운데를 파내고 앞뒤로 keep_pause 를 남긴다
        cut_start = span.start + cfg.keep_pause
        cut_end = span.end - cfg.keep_pause
        if cut_end - cut_start >= cfg.min_cut:
            remove.append(
                Span(cut_start, cut_end, "silence", f"{span.duration:.2f}s 정적 → {cfg.max_pause:.2f}s")
            )

    # 2) 필러 / 말더듬 / 발화 중 정적
    remove += detect_fillers(utterances, filler_config)

    # 3) 재촬영본
    if cfg.drop_retakes:
        remove += detect_retakes(utterances)

    # 4) 보호 구간 빼기
    remove = _subtract(remove, protect or [])
    remove = [s.clamped(0.0, duration) for s in merge_spans(remove, gap=cfg.min_cut)]
    remove = [s for s in remove if s.duration >= cfg.min_cut]

    keep = _keep_spans(remove, duration, cfg)
    return keep, remove


def _keep_spans(remove: list[Span], duration: float, cfg: CutConfig) -> list[Span]:
    from ..models import invert_spans

    keep = invert_spans(remove, 0.0, duration, gap=cfg.min_clip)
    # 너무 짧은 파편은 버린다 (한 프레임짜리 깜빡임 방지)
    return [k for k in keep if k.duration >= cfg.min_clip]


def _subtract(spans: list[Span], protect: list[Span]) -> list[Span]:
    """protect 구간과 겹치는 부분을 spans 에서 제거."""
    if not protect:
        return spans
    result: list[Span] = []
    for span in spans:
        pieces = [span]
        for guard in protect:
            nxt: list[Span] = []
            for piece in pieces:
                if not piece.overlaps(guard):
                    nxt.append(piece)
                    continue
                if piece.start < guard.start:
                    nxt.append(Span(piece.start, guard.start, piece.reason, piece.detail))
                if guard.end < piece.end:
                    nxt.append(Span(guard.end, piece.end, piece.reason, piece.detail))
            pieces = nxt
        result += pieces
    return result


def to_clips(source: str, keep: list[Span], *, start_at: float = 0.0, speed: float = 1.0) -> list[Clip]:
    """남길 구간들을 타임라인에 이어 붙인다."""
    clips: list[Clip] = []
    cursor = start_at
    for span in keep:
        clip = Clip(
            source=source,
            source_start=round(span.start, 3),
            source_end=round(span.end, 3),
            timeline_start=round(cursor, 3),
            speed=speed,
        )
        clips.append(clip)
        cursor = clip.timeline_end
    return clips


def remap_time(clips: list[Clip], source: str, t: float) -> float | None:
    """원본 시각 `t` 가 컷 후 타임라인의 몇 초로 옮겨갔는지.

    잘려나간 구간이면 None. 자막을 원본 기준 → 편집본 기준으로 옮길 때 쓴다.
    """
    for clip in clips:
        if clip.source != source:
            continue
        if clip.source_start <= t < clip.source_end:
            return clip.timeline_start + (t - clip.source_start) / clip.speed
    return None


def remap_nearest(clips: list[Clip], source: str, t: float) -> float:
    """잘린 시각이면 가장 가까운 살아남은 지점으로 스냅한다."""
    exact = remap_time(clips, source, t)
    if exact is not None:
        return exact
    best, best_gap = 0.0, float("inf")
    for clip in clips:
        if clip.source != source:
            continue
        for src, tl in ((clip.source_start, clip.timeline_start), (clip.source_end, clip.timeline_end)):
            gap = abs(src - t)
            if gap < best_gap:
                best, best_gap = tl, gap
    return best
