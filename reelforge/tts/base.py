"""AI 오디오(TTS) 공급자 추상화.

공급자는 `synth(text, out_path) -> Path` 하나만 구현하면 된다.
길이는 ffprobe 로 실제 파일에서 재기 때문에 공급자가 신경 쓸 필요가 없다.
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
from typing import Callable, Protocol

from ..media import MediaError, probe
from ..models import NarrationLine


class TTSError(RuntimeError):
    pass


class TTSProvider(Protocol):
    name: str
    ext: str

    def synth(self, text: str, out_path: Path) -> Path: ...


_REGISTRY: dict[str, Callable[..., TTSProvider]] = {}


def register(name: str):
    def deco(factory: Callable[..., TTSProvider]):
        _REGISTRY[name] = factory
        return factory

    return deco


def available_providers() -> list[str]:
    return sorted(_REGISTRY)


def get_provider(name: str, **kwargs) -> TTSProvider:
    if name not in _REGISTRY:
        raise TTSError(
            f"모르는 TTS 공급자 '{name}'. 가능한 값: {', '.join(available_providers())}"
        )
    return _REGISTRY[name](**kwargs)


def env(*names: str) -> str | None:
    for name in names:
        value = os.environ.get(name)
        if value:
            return value.strip()
    return None


# --------------------------------------------------------------------------- #
def synth_narration(
    lines: list[str],
    *,
    provider: str,
    voice: str,
    out_dir: str | Path,
    speed: float = 1.0,
    gap: float = 0.18,
    start_at: float = 0.0,
) -> list[NarrationLine]:
    """대본 각 줄을 음성으로 만들고 타임라인 위에 순서대로 배치한다.

    같은 (공급자, 목소리, 문장) 조합은 파일명 해시로 캐시되므로
    대본을 한 줄만 고쳐도 나머지는 다시 만들지 않는다.
    """
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    engine = get_provider(provider, voice=voice, speed=speed)

    narration: list[NarrationLine] = []
    cursor = start_at
    for index, text in enumerate(lines):
        text = text.strip()
        if not text:
            continue
        digest = hashlib.sha1(
            f"{provider}|{voice}|{speed}|{text}".encode("utf-8")
        ).hexdigest()[:10]
        path = out_dir / f"{index:03d}_{digest}.{engine.ext}"
        if not path.exists():
            engine.synth(text, path)
        duration = _duration(path)
        narration.append(
            NarrationLine(
                text=text,
                start=round(cursor, 3),
                audio_path=str(path),
                duration=round(duration, 3),
                voice=voice,
            )
        )
        cursor += duration + gap
    return narration


def _duration(path: Path) -> float:
    try:
        return probe(path).duration
    except MediaError:
        # ffprobe 가 없어도 파이프라인이 죽지 않게 대략치를 쓴다
        return max(0.8, path.stat().st_size / 16000)
