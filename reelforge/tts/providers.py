"""실제 TTS 공급자들.

edge        무료·키 없음. `pip install edge-tts`. 한국어 품질 준수 → 기본값.
elevenlabs  가장 자연스럽다. ELEVENLABS_API_KEY 필요.
openai      OPENAI_API_KEY 필요. 억양이 차분한 편.
fish        FISH_AUDIO_API_KEY 필요. 목소리 클로닝을 쓸 때.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from pathlib import Path

from .base import TTSError, env, register

_TIMEOUT = 120


def _post(url: str, *, headers: dict, payload: dict, out_path: Path) -> Path:
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=_TIMEOUT) as response:
            data = response.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:400]
        raise TTSError(f"TTS 요청 실패 ({exc.code}): {detail}") from exc
    except urllib.error.URLError as exc:
        raise TTSError(f"TTS 서버에 연결하지 못했습니다: {exc.reason}") from exc
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(data)
    return out_path


# --------------------------------------------------------------------------- #
@register("edge")
class EdgeTTS:
    """Microsoft Edge 읽어주기. 키가 필요 없어 바로 굴려볼 수 있다."""

    name = "edge"
    ext = "mp3"

    def __init__(self, voice: str = "ko-KR-SunHiNeural", speed: float = 1.0):
        self.voice = voice
        self.rate = f"{'+' if speed >= 1 else '-'}{abs(round((speed - 1) * 100)):d}%"

    def synth(self, text: str, out_path: Path) -> Path:
        try:
            import asyncio

            import edge_tts
        except ImportError as exc:
            raise TTSError("edge-tts 가 필요합니다: pip install edge-tts") from exc

        async def _run():
            comm = edge_tts.Communicate(text, self.voice, rate=self.rate)
            await comm.save(str(out_path))

        out_path.parent.mkdir(parents=True, exist_ok=True)
        asyncio.run(_run())
        return out_path


@register("elevenlabs")
class ElevenLabsTTS:
    name = "elevenlabs"
    ext = "mp3"

    def __init__(self, voice: str = "21m00Tcm4TlvDq8ikWAM", speed: float = 1.0):
        self.voice = voice
        self.speed = speed
        self.key = env("ELEVENLABS_API_KEY", "ELEVEN_API_KEY")
        if not self.key:
            raise TTSError("ELEVENLABS_API_KEY 환경변수를 설정하세요.")

    def synth(self, text: str, out_path: Path) -> Path:
        return _post(
            f"https://api.elevenlabs.io/v1/text-to-speech/{self.voice}",
            headers={
                "xi-api-key": self.key,
                "Content-Type": "application/json",
                "Accept": "audio/mpeg",
            },
            payload={
                "text": text,
                "model_id": "eleven_multilingual_v2",
                "voice_settings": {
                    "stability": 0.45,
                    "similarity_boost": 0.8,
                    "speed": self.speed,
                },
            },
            out_path=out_path,
        )


@register("openai")
class OpenAITTS:
    name = "openai"
    ext = "mp3"

    def __init__(self, voice: str = "nova", speed: float = 1.0):
        self.voice = voice
        self.speed = max(0.25, min(4.0, speed))
        self.key = env("OPENAI_API_KEY")
        if not self.key:
            raise TTSError("OPENAI_API_KEY 환경변수를 설정하세요.")

    def synth(self, text: str, out_path: Path) -> Path:
        return _post(
            "https://api.openai.com/v1/audio/speech",
            headers={
                "Authorization": f"Bearer {self.key}",
                "Content-Type": "application/json",
            },
            payload={
                "model": "gpt-4o-mini-tts",
                "voice": self.voice,
                "input": text,
                "speed": self.speed,
                "response_format": "mp3",
            },
            out_path=out_path,
        )


@register("fish")
class FishAudioTTS:
    """Fish Audio. `voice` 에 클로닝한 목소리의 model id 를 넣는다."""

    name = "fish"
    ext = "mp3"

    def __init__(self, voice: str = "", speed: float = 1.0):
        self.voice = voice
        self.speed = speed
        self.key = env("FISH_AUDIO_API_KEY", "FISH_API_KEY")
        if not self.key:
            raise TTSError("FISH_AUDIO_API_KEY 환경변수를 설정하세요.")

    def synth(self, text: str, out_path: Path) -> Path:
        payload: dict = {"text": text, "format": "mp3"}
        if self.voice:
            payload["reference_id"] = self.voice
        return _post(
            "https://api.fish.audio/v1/tts",
            headers={
                "Authorization": f"Bearer {self.key}",
                "Content-Type": "application/json",
            },
            payload=payload,
            out_path=out_path,
        )
