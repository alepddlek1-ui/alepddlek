"""테스트 공용 도구.

pycapcut 은 소재 파일을 libmediainfo 로 실제로 읽는다. 그래서 빈 파일로는
안 되고, 진짜 미디어가 필요하다. ffmpeg 없이도 만들 수 있는 PNG 를 쓴다
(캡컷에서 사진도 영상 트랙에 올라간다).
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

import pytest


def write_png(path: Path, width: int = 32, height: int = 56) -> Path:
    """의존성 없이 만드는 진짜 PNG."""
    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data)) + tag + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    raw = b"".join(b"\x00" + b"\x22\x44\x66" * width for _ in range(height))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )
    return path


def write_wav(path: Path, seconds: float = 1.4, rate: int = 8000) -> Path:
    """표준 라이브러리만으로 만드는 진짜 WAV (무음)."""
    import wave

    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(b"\x00\x00" * int(rate * seconds))
    return path


@pytest.fixture
def footage(tmp_path: Path) -> Path:
    """촬영본 자리에 놓을 실제로 읽히는 소재 파일."""
    return write_png(tmp_path / "take1.png")


def load_draft(folder: Path) -> dict:
    import json

    return json.loads((folder / "draft_content.json").read_text(encoding="utf-8"))


def load_meta(folder: Path) -> dict:
    import json

    return json.loads((folder / "draft_meta_info.json").read_text(encoding="utf-8"))
