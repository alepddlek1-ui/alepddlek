"""ffmpeg `silencedetect` 로 무음(= 말 안 하는) 구간을 찾는다."""

from __future__ import annotations

import re
from pathlib import Path

from ..media import MediaError, _require, run
from ..models import Span

_START = re.compile(r"silence_start:\s*(-?[\d.]+)")
_END = re.compile(r"silence_end:\s*(-?[\d.]+)")


def detect_silence(
    audio: str | Path,
    *,
    threshold_db: float = -34.0,
    min_duration: float = 0.35,
    total_duration: float | None = None,
) -> list[Span]:
    """무음 구간 목록.

    threshold_db  이 값보다 조용하면 무음으로 본다. 촬영 환경이 시끄러우면 -30 쪽으로,
                  아주 조용하면 -40 쪽으로 조절.
    min_duration  이보다 짧은 정적은 말의 리듬이므로 무시.
    """
    cmd = [
        _require("ffmpeg"), "-hide_banner", "-nostats", "-i", str(audio),
        "-af", f"silencedetect=noise={threshold_db}dB:d={min_duration}",
        "-f", "null", "-",
    ]
    # silencedetect 결과는 stderr 로 나온다. 실패해도 파싱은 시도.
    try:
        stderr = run(cmd).stderr
    except MediaError:
        raise

    return parse_silencedetect(stderr, total_duration=total_duration)


def parse_silencedetect(log: str, *, total_duration: float | None = None) -> list[Span]:
    """ffmpeg 로그 텍스트 → Span 목록. (테스트하기 쉽게 분리)"""
    spans: list[Span] = []
    pending: float | None = None
    for line in log.splitlines():
        if (m := _START.search(line)) is not None:
            pending = max(0.0, float(m.group(1)))
        elif (m := _END.search(line)) is not None and pending is not None:
            end = float(m.group(1))
            spans.append(Span(pending, end, "silence", f"{end - pending:.2f}s 무음"))
            pending = None
    # 파일 끝까지 무음으로 끝난 경우
    if pending is not None and total_duration and total_duration > pending:
        spans.append(
            Span(pending, total_duration, "silence", f"{total_duration - pending:.2f}s 끝무음")
        )
    return spans
