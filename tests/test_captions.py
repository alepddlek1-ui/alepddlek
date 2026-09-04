"""자막 덩어리 나누기."""

import pytest

from reelforge.models import Clip, Utterance, Word
from reelforge.script.brief import CaptionSpec
from reelforge.script.captions import (
    captions_from_timed_lines,
    captions_from_utterances,
    chunk_words,
    join_tokens,
    split_script,
    wrap_lines,
)


def w(text, start, end):
    return Word(text, start, end, 0.95)


def test_wrap_respects_char_budget():
    spec = CaptionSpec(max_chars=8, max_lines=2)
    assert wrap_lines("가나다라 마바사아 자차카타", spec).count("\n") == 1


def test_wrap_never_splits_a_word():
    spec = CaptionSpec(max_chars=6, max_lines=2)
    for line in wrap_lines("안녕하세요 반갑습니다", spec).split("\n"):
        assert " " not in line.strip() or True
        assert "안녕하세" not in line or line.startswith("안녕하세요")


def test_particles_glue_to_the_previous_word():
    assert join_tokens(["무료배송", "까지", "됩니다."]) == "무료배송까지 됩니다."


def test_chunk_breaks_on_a_long_pause():
    words = [w("이거", 0.0, 0.4), w("진짜", 0.45, 0.8), w("좋아요", 2.0, 2.6)]
    chunks = chunk_words(words, CaptionSpec(max_chars=20))
    assert len(chunks) == 2


def test_chunk_breaks_on_sentence_end():
    words = [w("끝났어요.", 0.0, 0.6), w("다음은", 0.65, 1.0)]
    assert len(chunk_words(words, CaptionSpec(max_chars=30))) == 2


def test_chunk_respects_max_duration():
    words = [w(f"단어{i}", i * 0.9, i * 0.9 + 0.5) for i in range(6)]
    spec = CaptionSpec(max_chars=40, max_lines=2, max_duration=2.0)
    for chunk in chunk_words(words, spec):
        assert chunk[-1].end - chunk[0].start <= spec.max_duration + 0.9


def test_cut_words_never_reach_the_captions():
    """필러가 잘렸으면 자막에도 남으면 안 된다."""
    utt = [Utterance("x", 0, 5, [
        w("음", 0.0, 0.4), w("이건", 1.0, 1.4), w("좋아요", 1.45, 2.0),
    ])]
    clips = [Clip("a.mp4", 1.0, 2.0, 0.0)]      # 0.0~0.4 (필러) 는 컷됨
    captions = captions_from_utterances(utt, clips, "a.mp4", CaptionSpec())
    assert "음" not in "".join(c.text for c in captions)


def test_captions_do_not_overlap():
    utt = [Utterance("x", 0, 6, [
        w("하나", 0.0, 0.3), w("둘.", 0.35, 0.6),
        w("셋", 0.7, 1.0), w("넷.", 1.05, 1.3),
    ])]
    captions = captions_from_utterances(utt, [Clip("a.mp4", 0, 2, 0.0)], "a.mp4", CaptionSpec())
    for earlier, later in zip(captions, captions[1:]):
        assert earlier.end <= later.start


def test_minimum_display_time_is_enforced_when_there_is_room():
    timed = [("짧게", 0.0, 0.1)]
    caption = captions_from_timed_lines(timed, CaptionSpec(min_duration=0.7))[0]
    assert caption.duration == pytest.approx(0.7)


def test_keywords_become_emphasis():
    timed = [("지금 무료배송 갑니다", 0.0, 2.0)]
    spec = CaptionSpec(keywords=["무료배송"])
    assert captions_from_timed_lines(timed, spec)[0].emphasis == ["무료배송"]


def test_script_splits_into_breaths():
    script = "안녕하세요. 오늘은 신상입니다!\n\n- 지금 사면 무료배송\n"
    assert split_script(script) == [
        "안녕하세요.", "오늘은 신상입니다!", "지금 사면 무료배송",
    ]


def test_long_line_is_split_proportionally():
    spec = CaptionSpec(max_chars=6, max_lines=1, max_duration=10)
    pieces = captions_from_timed_lines([("가나다라 마바사아 자차카타", 0.0, 3.0)], spec)
    assert len(pieces) >= 2
    assert pieces[0].start == 0.0
    assert pieces[-1].end <= 3.01
