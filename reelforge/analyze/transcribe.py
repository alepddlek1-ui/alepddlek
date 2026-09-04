"""음성 → 단어 단위 타임스탬프.

기본 엔진은 faster-whisper(로컬, 무료). GPU 없어도 `compute_type="int8"` 이면
CPU 에서 릴스 길이(15~90초) 정도는 몇 초 안에 끝난다.
"""

from __future__ import annotations

import json
from pathlib import Path

from ..models import Utterance, Word


class TranscriptionError(RuntimeError):
    pass


def transcribe(
    audio: str | Path,
    *,
    model: str = "medium",
    language: str = "ko",
    device: str = "auto",
    compute_type: str | None = None,
    cache: str | Path | None = None,
    initial_prompt: str | None = None,
) -> list[Utterance]:
    """`audio` 를 전사해 Utterance 목록을 돌려준다.

    initial_prompt 에 제품명·브랜드명을 넣어주면 고유명사 인식률이 확 오른다.
    (예: "리얼포지, 인스타 릴스, 캡컷")
    """
    if cache and Path(cache).exists():
        return load_transcript(cache)

    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:  # pragma: no cover - 환경 의존
        raise TranscriptionError(
            "faster-whisper 가 설치되어 있지 않습니다.\n"
            "  pip install faster-whisper"
        ) from exc

    if device == "auto":
        device = "cuda" if _has_cuda() else "cpu"
    if compute_type is None:
        compute_type = "float16" if device == "cuda" else "int8"

    whisper = WhisperModel(model, device=device, compute_type=compute_type)
    segments, _info = whisper.transcribe(
        str(audio),
        language=language,
        word_timestamps=True,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 300},
        initial_prompt=initial_prompt,
        condition_on_previous_text=False,   # 반복 환각 억제
    )

    utterances: list[Utterance] = []
    for seg in segments:
        words = [
            Word(
                text=w.word.strip(),
                start=float(w.start),
                end=float(w.end),
                prob=float(getattr(w, "probability", 1.0) or 1.0),
            )
            for w in (seg.words or [])
            if w.word and w.word.strip()
        ]
        text = seg.text.strip()
        if not text:
            continue
        utterances.append(
            Utterance(
                text=text,
                start=float(seg.start),
                end=float(seg.end),
                words=words,
            )
        )

    if cache:
        save_transcript(utterances, cache)
    return utterances


def _has_cuda() -> bool:  # pragma: no cover - 환경 의존
    try:
        import ctranslate2

        return ctranslate2.get_cuda_device_count() > 0
    except Exception:
        return False


# --------------------------------------------------------------------------- #
# 캐시 (전사는 파이프라인에서 제일 느린 단계라 반드시 캐시한다)
# --------------------------------------------------------------------------- #
def save_transcript(utterances: list[Utterance], path: str | Path) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = [
        {
            "text": u.text,
            "start": u.start,
            "end": u.end,
            "words": [{"text": w.text, "start": w.start, "end": w.end, "prob": w.prob} for w in u.words],
        }
        for u in utterances
    ]
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def load_transcript(path: str | Path) -> list[Utterance]:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    return [
        Utterance(
            text=u["text"],
            start=u["start"],
            end=u["end"],
            words=[Word(**w) for w in u.get("words", [])],
        )
        for u in raw
    ]


def all_words(utterances: list[Utterance]) -> list[Word]:
    return [w for u in utterances for w in u.words]
