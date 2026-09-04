"""자막을 SRT / VTT 로 내보낸다.

캡컷 draft 를 못 쓰는 상황(버전 문제·모바일 앱)이나, 인스타 업로드용
자막 파일이 따로 필요할 때 쓰는 안전한 우회로.
"""

from __future__ import annotations

from pathlib import Path

from ..models import Caption


def to_srt(captions: list[Caption]) -> str:
    blocks = []
    for index, cap in enumerate(captions, start=1):
        blocks.append(
            f"{index}\n{_ts(cap.start)} --> {_ts(cap.end)}\n{cap.text}\n"
        )
    return "\n".join(blocks)


def to_vtt(captions: list[Caption]) -> str:
    body = "\n".join(
        f"{_ts(c.start, sep='.')} --> {_ts(c.end, sep='.')}\n{c.text}\n" for c in captions
    )
    return "WEBVTT\n\n" + body


def _ts(seconds: float, *, sep: str = ",") -> str:
    seconds = max(0.0, seconds)
    hours, rest = divmod(int(seconds), 3600)
    minutes, secs = divmod(rest, 60)
    millis = int(round((seconds - int(seconds)) * 1000))
    if millis == 1000:            # 반올림이 넘칠 때
        millis, secs = 0, secs + 1
    return f"{hours:02d}:{minutes:02d}:{secs:02d}{sep}{millis:03d}"


def write_srt(captions: list[Caption], path: str | Path) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(to_srt(captions), encoding="utf-8")
    return path
