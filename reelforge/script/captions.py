"""자막 만들기.

릴스 자막의 규칙은 단순하다. **한 화면에 한 호흡**, 두 줄 이내, 0.7초는 머물기.
여기서는 단어 타임스탬프를 그 규칙에 맞게 덩어리로 묶는다.
"""

from __future__ import annotations

import re

from ..analyze.planner import remap_nearest, remap_time
from ..models import Caption, Clip, Utterance, Word
from .brief import CaptionSpec

# 문장이 확실히 끝나는 지점
_SENTENCE_END = re.compile(r"[.!?…]$|[.!?…][\"')\]]$")
# 한국어에서 자막을 끊기 좋은 어미
_CLAUSE_END = re.compile(r"(고|서|며|면|는데|지만|니까|거든요|구요|요|다|죠|까요|세요)$")

# STT 가 조사를 따로 떼어놓는 경우가 많다("무료배송 / 까지"). 자막에서는 붙여준다.
_PARTICLES = {
    "은", "는", "이", "가", "을", "를", "에", "에서", "에게", "께", "도", "만", "까지",
    "부터", "로", "으로", "와", "과", "랑", "이랑", "의", "요", "고", "며", "든지",
}

_TAIL = 0.12          # 마지막 단어가 끝나도 이만큼은 더 띄워둔다
_BREAK_GAP = 0.42     # 단어 사이가 이만큼 벌어지면 자막을 끊는다


def captions_from_utterances(
    utterances: list[Utterance],
    clips: list[Clip],
    source: str,
    spec: CaptionSpec,
) -> list[Caption]:
    """원본 기준 전사 → 컷 편집본 기준 자막.

    잘려나간 단어는 자막에서도 자동으로 빠진다(= 필러가 자막에 안 남는다).
    """
    surviving: list[Word] = []
    for word in (w for u in utterances for w in u.words):
        mid = (word.start + word.end) / 2
        if remap_time(clips, source, mid) is None:
            continue        # 컷된 단어
        surviving.append(word)

    chunks = chunk_words(surviving, spec)
    captions: list[Caption] = []
    for chunk in chunks:
        start = remap_nearest(clips, source, chunk[0].start)
        end = remap_nearest(clips, source, chunk[-1].end) + _TAIL
        text = wrap_lines(join_tokens(w.text for w in chunk), spec)
        captions.append(
            Caption(
                text=text,
                start=round(start, 3),
                end=round(end, 3),
                style=spec.style,
                emphasis=_emphasis(text, spec.keywords),
                position=spec.position,
            )
        )
    return _tidy(captions, spec)


def chunk_words(words: list[Word], spec: CaptionSpec) -> list[list[Word]]:
    """단어들을 자막 한 장 분량으로 묶는다."""
    budget = spec.max_chars * spec.max_lines
    chunks: list[list[Word]] = []
    current: list[Word] = []

    for i, word in enumerate(words):
        current.append(word)
        text = " ".join(w.text for w in current)
        nxt = words[i + 1] if i + 1 < len(words) else None

        must_break = (
            nxt is None
            or _SENTENCE_END.search(word.text.strip()) is not None
            or nxt.start - word.end >= _BREAK_GAP
            or _display_len(text) >= budget
            or (nxt.end - current[0].start) > spec.max_duration
        )
        if not must_break:
            continue

        # 예산을 넘겼는데 아직 문장 중간이면, 끊기 좋은 어미까지 되감는다
        if nxt is not None and _display_len(text) >= budget and len(current) > 2:
            for back in range(len(current) - 1, max(0, len(current) - 3), -1):
                if _CLAUSE_END.search(current[back - 1].text.strip()):
                    chunks.append(current[:back])
                    current = current[back:]
                    break
            else:
                chunks.append(current)
                current = []
            if current:
                continue
        else:
            chunks.append(current)
            current = []

    if current:
        chunks.append(current)
    return [c for c in chunks if c]


def join_tokens(tokens) -> str:
    """단어 토큰들을 문장으로. 홀로 떨어진 조사는 앞 단어에 붙인다."""
    out: list[str] = []
    for token in tokens:
        token = token.strip()
        if not token:
            continue
        bare = token.rstrip(".,!?…")
        if out and bare in _PARTICLES:
            out[-1] += token
        else:
            out.append(token)
    return " ".join(out)


def wrap_lines(text: str, spec: CaptionSpec) -> str:
    """`max_chars` 기준으로 줄바꿈. 어절은 쪼개지 않는다."""
    words = text.split()
    lines: list[str] = []
    line = ""
    for word in words:
        candidate = f"{line} {word}".strip()
        if line and _display_len(candidate) > spec.max_chars and len(lines) + 1 < spec.max_lines:
            lines.append(line)
            line = word
        else:
            line = candidate
    if line:
        lines.append(line)
    return "\n".join(lines[: spec.max_lines])


def _display_len(text: str) -> float:
    """한글은 1, 영문/숫자는 0.6 으로 셈해 체감 폭을 맞춘다."""
    total = 0.0
    for ch in text:
        if ch.isspace():
            total += 0.4
        elif "가" <= ch <= "힣":
            total += 1.0
        else:
            total += 0.6
    return total


def _emphasis(text: str, keywords: list[str]) -> list[str]:
    flat = text.replace("\n", " ")
    return [k for k in keywords if k and k in flat]


def _tidy(captions: list[Caption], spec: CaptionSpec) -> list[Caption]:
    """겹침 제거 + 최소 노출 시간 보장."""
    out: list[Caption] = []
    for i, cap in enumerate(captions):
        start = cap.start
        end = max(cap.end, start + spec.min_duration)
        nxt = captions[i + 1] if i + 1 < len(captions) else None
        if nxt is not None:
            end = min(end, max(start + 0.25, nxt.start - 0.02))
        if end <= start:
            continue
        out.append(
            Caption(
                cap.text, round(start, 3), round(end, 3),
                cap.style, cap.emphasis, cap.position,
            )
        )
    return out


# --------------------------------------------------------------------------- #
# 대본에서 바로 자막 만들기 (AI 나레이션 모드)
# --------------------------------------------------------------------------- #
def split_script(script: str) -> list[str]:
    """대본을 한 호흡 단위로 쪼갠다. 빈 줄/문장부호 기준."""
    lines: list[str] = []
    for block in re.split(r"\n\s*\n", script.strip()):
        for raw in block.splitlines():
            raw = raw.strip().lstrip("-•* ").strip()
            if not raw:
                continue
            # 한 줄에 여러 문장이면 문장별로 더 쪼갠다
            for sentence in re.split(r"(?<=[.!?…])\s+", raw):
                sentence = sentence.strip()
                if sentence:
                    lines.append(sentence)
    return lines


def captions_from_timed_lines(
    timed: list[tuple[str, float, float]], spec: CaptionSpec
) -> list[Caption]:
    """`(문장, 시작, 끝)` 목록 → 자막. TTS 로 길이를 아는 나레이션에 쓴다."""
    captions: list[Caption] = []
    for text, start, end in timed:
        for piece_text, piece_start, piece_end in _split_long(text, start, end, spec):
            captions.append(
                Caption(
                    text=wrap_lines(piece_text, spec),
                    start=round(piece_start, 3),
                    end=round(piece_end, 3),
                    style=spec.style,
                    emphasis=_emphasis(piece_text, spec.keywords),
                    position=spec.position,
                )
            )
    return _tidy(captions, spec)


def _split_long(text: str, start: float, end: float, spec: CaptionSpec):
    """한 문장이 화면에 다 안 들어가면 글자 수 비례로 나눠 시간도 쪼갠다."""
    budget = spec.max_chars * spec.max_lines
    if _display_len(text) <= budget and (end - start) <= spec.max_duration:
        return [(text, start, end)]

    words = text.split()
    pieces: list[list[str]] = [[]]
    for word in words:
        candidate = pieces[-1] + [word]
        if pieces[-1] and _display_len(" ".join(candidate)) > budget:
            pieces.append([word])
        else:
            pieces[-1] = candidate

    total = sum(_display_len(" ".join(p)) for p in pieces) or 1.0
    out = []
    cursor = start
    for piece in pieces:
        share = (end - start) * (_display_len(" ".join(piece)) / total)
        out.append((" ".join(piece), cursor, cursor + share))
        cursor += share
    return out
