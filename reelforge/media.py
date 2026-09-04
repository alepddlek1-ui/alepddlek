"""ffmpeg / ffprobe 얇은 래퍼."""

from __future__ import annotations

import json
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path


class MediaError(RuntimeError):
    pass


def _require(binary: str) -> str:
    path = shutil.which(binary)
    if not path:
        raise MediaError(
            f"'{binary}' 를 찾을 수 없습니다. ffmpeg 를 설치하고 PATH 에 추가하세요.\n"
            "  macOS:   brew install ffmpeg\n"
            "  Windows: winget install Gyan.FFmpeg\n"
            "  Ubuntu:  sudo apt install ffmpeg"
        )
    return path


def run(cmd: list[str], *, capture: bool = True) -> subprocess.CompletedProcess:
    proc = subprocess.run(
        cmd,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if proc.returncode != 0:
        tail = (proc.stderr or "").strip().splitlines()[-12:]
        raise MediaError(f"명령 실패: {' '.join(cmd[:3])} ...\n" + "\n".join(tail))
    return proc


@dataclass
class MediaInfo:
    path: str
    duration: float
    width: int
    height: int
    fps: float
    has_audio: bool
    audio_rate: int = 48000

    @property
    def is_vertical(self) -> bool:
        return self.height >= self.width


def probe(path: str | Path) -> MediaInfo:
    """ffprobe 로 해상도/길이/fps/오디오 유무를 읽는다."""
    path = Path(path)
    if not path.exists():
        raise MediaError(f"파일이 없습니다: {path}")
    out = run(
        [
            _require("ffprobe"), "-v", "error",
            "-print_format", "json",
            "-show_format", "-show_streams",
            str(path),
        ]
    ).stdout
    data = json.loads(out)
    streams = data.get("streams", [])
    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)

    duration = float(data.get("format", {}).get("duration") or 0.0)
    if not duration and video:
        duration = float(video.get("duration") or 0.0)

    width = height = 0
    fps = 30.0
    if video:
        width, height = int(video.get("width", 0)), int(video.get("height", 0))
        # 세로 영상인데 rotate 메타가 걸려 있으면 실제 표시 크기로 뒤집는다.
        rotation = abs(int(_rotation(video)))
        if rotation in (90, 270):
            width, height = height, width
        fps = _parse_fraction(video.get("avg_frame_rate") or video.get("r_frame_rate"))

    return MediaInfo(
        path=str(path),
        duration=duration,
        width=width,
        height=height,
        fps=fps or 30.0,
        has_audio=audio is not None,
        audio_rate=int(audio.get("sample_rate", 48000)) if audio else 48000,
    )


def _rotation(stream: dict) -> float:
    if "rotation" in stream.get("tags", {}):
        return float(stream["tags"]["rotation"])
    for sd in stream.get("side_data_list", []) or []:
        if "rotation" in sd:
            return float(sd["rotation"])
    return 0.0


def _parse_fraction(value: str | None) -> float:
    if not value:
        return 0.0
    if "/" in value:
        num, _, den = value.partition("/")
        try:
            return float(num) / float(den) if float(den) else 0.0
        except ValueError:
            return 0.0
    try:
        return float(value)
    except ValueError:
        return 0.0


def extract_audio(src: str | Path, dst: str | Path, *, rate: int = 16000) -> Path:
    """STT/무음탐지용 16kHz 모노 wav 추출."""
    dst = Path(dst)
    dst.parent.mkdir(parents=True, exist_ok=True)
    run([
        _require("ffmpeg"), "-y", "-i", str(src),
        "-vn", "-ac", "1", "-ar", str(rate), "-c:a", "pcm_s16le",
        str(dst),
    ])
    return dst


def has_ffmpeg() -> bool:
    return bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))
