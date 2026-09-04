"""버벅거림 탐지: 필러(음/어/그...), 말더듬, 단어 사이 죽은 시간.

전부 순수 함수라 영상 없이도 테스트된다.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

from ..models import Span, Utterance, Word

# 한국어 필러. 단독으로 튀어나올 때만 필러로 본다
# (예: "그 제품이" 의 '그' 는 관형사라 살려야 한다 → 앞뒤 침묵이 있어야 컷).
HARD_FILLERS = {"음", "어", "엄", "으", "에", "아", "어어", "음음", "으음", "어우", "흠"}
SOFT_FILLERS = {"그", "저", "뭐", "이제", "인제", "약간", "좀", "막", "이렇게", "그니까", "뭐지", "그쵸"}

_PUNCT = re.compile(r"[^\w가-힣]+", re.UNICODE)


def normalize(text: str) -> str:
    """비교용 정규화: 구두점 제거 + NFC + 소문자."""
    text = unicodedata.normalize("NFC", text or "")
    return _PUNCT.sub("", text).lower()


def _stretch(word: str) -> str:
    """'어어어' → '어', 'ㅋㅋㅋ' → 'ㅋ' 처럼 늘어뜨린 소리를 접는다."""
    if not word:
        return word
    folded = [word[0]]
    for ch in word[1:]:
        if ch != folded[-1]:
            folded.append(ch)
    return "".join(folded)


@dataclass
class FillerConfig:
    # 필러 단어 앞뒤로 이만큼 침묵이 있어야 '진짜 버벅임'으로 인정 (SOFT 전용)
    soft_pause: float = 0.28
    # 단어 사이가 이보다 벌어지면 죽은 시간으로 보고 잘라낸다
    dead_air: float = 0.55
    # 잘라낸 뒤 남길 여유 (앞뒤로 이만큼은 남겨야 소리가 뚝 끊기지 않는다)
    pad: float = 0.06
    # STT 확신도가 이보다 낮고 짧은 단어는 잡음으로 간주
    low_confidence: float = 0.35
    # 같은 단어를 이 간격 안에 반복하면 말더듬
    stutter_gap: float = 0.6
    # 이 길이 미만의 컷은 오히려 부자연스러우니 버린다
    min_cut: float = 0.12


def detect_fillers(
    utterances: list[Utterance], config: FillerConfig | None = None
) -> list[Span]:
    """필러 + 말더듬 + 죽은 시간 구간 목록."""
    cfg = config or FillerConfig()
    spans: list[Span] = []
    for utt in utterances:
        words = utt.words
        if not words:
            continue
        spans += _filler_words(words, cfg)
        spans += _stutters(words, cfg)
        spans += _dead_air(words, cfg)
    return [s for s in spans if s.duration >= cfg.min_cut]


# 발화의 처음/끝에서는 앞뒤 간격을 알 수 없다. 모르는 건 0 으로 둔다 —
# 측정되지 않은 침묵을 근거로 멀쩡한 단어를 자르지 않기 위해서다.
def _gap_before(words: list[Word], i: int) -> float:
    return words[i].start - words[i - 1].end if i > 0 else 0.0


def _gap_after(words: list[Word], i: int) -> float:
    return words[i + 1].start - words[i].end if i + 1 < len(words) else 0.0


def _filler_words(words: list[Word], cfg: FillerConfig) -> list[Span]:
    out: list[Span] = []
    for i, word in enumerate(words):
        norm = normalize(word.text)
        if not norm:
            continue
        folded = _stretch(norm)

        is_hard = norm in HARD_FILLERS or folded in HARD_FILLERS
        is_soft = norm in SOFT_FILLERS
        low_conf = word.prob < cfg.low_confidence and len(norm) <= 2

        if is_hard or low_conf:
            reason, detail = "filler", f"필러 '{word.text.strip()}'"
        elif is_soft and (
            _gap_before(words, i) >= cfg.soft_pause or _gap_after(words, i) >= cfg.soft_pause
        ):
            # 앞뒤로 뜸을 들인 '그...', '약간...' 만 컷
            reason, detail = "filler", f"머뭇거림 '{word.text.strip()}'"
        else:
            continue

        out.append(
            Span(max(0.0, word.start - cfg.pad), word.end + cfg.pad, reason, detail)
        )
    return out


def _stutters(words: list[Word], cfg: FillerConfig) -> list[Span]:
    """'제, 제품이' / '이거 이거 보시면' 처럼 곧바로 반복된 앞 단어를 잘라낸다.

    마지막(제대로 말한) 반복만 남기고 앞의 것들을 지운다.
    """
    out: list[Span] = []
    i = 0
    while i < len(words) - 1:
        current = normalize(words[i].text)
        if not current:
            i += 1
            continue
        j = i
        while (
            j + 1 < len(words)
            and _is_repeat(current, normalize(words[j + 1].text))
            and words[j + 1].start - words[j].end <= cfg.stutter_gap
        ):
            j += 1
        if j > i:
            # words[i..j-1] 삭제, words[j] 유지
            out.append(
                Span(
                    max(0.0, words[i].start - cfg.pad),
                    words[j].start - cfg.pad,
                    "stutter",
                    f"말더듬 '{words[i].text.strip()}' x{j - i + 1}",
                )
            )
            i = j + 1
        else:
            i += 1
    return out


def _is_repeat(a: str, b: str) -> bool:
    """'제' vs '제품', '이거' vs '이거' 처럼 더듬은 반복인지."""
    if not a or not b:
        return False
    if a == b:
        return True
    # 짧은 조각이 뒤 단어의 시작이면 더듬은 것 (제/제품)
    short, long = (a, b) if len(a) <= len(b) else (b, a)
    return len(short) == 1 and long.startswith(short)


def _dead_air(words: list[Word], cfg: FillerConfig) -> list[Span]:
    """한 발화 안에서 말이 끊긴 구간."""
    out: list[Span] = []
    for i in range(len(words) - 1):
        gap = words[i + 1].start - words[i].end
        if gap >= cfg.dead_air:
            out.append(
                Span(
                    words[i].end + cfg.pad,
                    words[i + 1].start - cfg.pad,
                    "dead_air",
                    f"{gap:.2f}s 정적",
                )
            )
    return out


# --------------------------------------------------------------------------- #
# 반복 테이크 (같은 말을 여러 번 다시 찍은 경우)
# --------------------------------------------------------------------------- #
def detect_retakes(
    utterances: list[Utterance], *, similarity: float = 0.78, window: float = 25.0
) -> list[Span]:
    """앞에서 한 말을 뒤에서 거의 똑같이 반복하면 **앞의 것**을 버린다.

    NG 내고 다시 찍는 습관을 그대로 흡수하는 장치.
    """
    out: list[Span] = []
    for i, earlier in enumerate(utterances):
        a = normalize(earlier.text)
        if len(a) < 6:
            continue
        for later in utterances[i + 1 :]:
            if later.start - earlier.end > window:
                break
            b = normalize(later.text)
            if len(b) < 6:
                continue
            if _ratio(a, b) >= similarity:
                out.append(
                    Span(earlier.start, earlier.end, "retake", f"재촬영본으로 대체: '{earlier.text[:18]}…'")
                )
                break
    return out


def _ratio(a: str, b: str) -> float:
    from difflib import SequenceMatcher

    return SequenceMatcher(None, a, b).ratio()
