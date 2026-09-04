"""컷 판단 로직 — 영상 없이 검증한다."""

import pytest

from reelforge.analyze.fillers import FillerConfig, detect_fillers, detect_retakes
from reelforge.analyze.planner import CutConfig, build_cuts, remap_time, to_clips
from reelforge.analyze.silence import parse_silencedetect
from reelforge.models import Span, Utterance, Word, invert_spans, merge_spans


def w(text, start, end, prob=0.95):
    return Word(text, start, end, prob)


# --------------------------------------------------------------------------- #
def test_silencedetect_parsing():
    log = (
        "[silencedetect] silence_start: 1.5\n"
        "[silencedetect] silence_end: 3.2 | silence_duration: 1.7\n"
        "[silencedetect] silence_start: 9.0\n"
    )
    spans = parse_silencedetect(log, total_duration=12.0)
    assert [(s.start, s.end) for s in spans] == [(1.5, 3.2), (9.0, 12.0)]


def test_merge_and_invert():
    spans = [Span(1, 2), Span(2.05, 3), Span(5, 6)]
    assert len(merge_spans(spans, gap=0.1)) == 2
    keep = invert_spans(spans, 0, 8, gap=0.1)
    assert [(k.start, k.end) for k in keep] == [(0, 1), (3, 5), (6, 8)]


# --------------------------------------------------------------------------- #
def test_hard_filler_is_cut():
    utt = Utterance("음 좋아요", 0, 2, [w("음", 0.0, 0.4), w("좋아요", 0.5, 1.2)])
    spans = detect_fillers([utt])
    assert any("음" in s.detail for s in spans if s.reason == "filler")


def test_soft_filler_needs_a_pause():
    """'그 제품' 처럼 붙어 나온 관형사는 살린다."""
    glued = Utterance("그 제품", 0, 2, [w("그", 0.0, 0.2), w("제품", 0.22, 0.8)])
    assert not [s for s in detect_fillers([glued]) if s.reason == "filler"]

    hesitant = Utterance("그 제품", 0, 2, [w("그", 0.0, 0.2), w("제품", 0.9, 1.5)])
    assert [s for s in detect_fillers([hesitant]) if s.reason == "filler"]


def test_stutter_keeps_last_repeat():
    utt = Utterance("제 제 제품", 0, 3, [
        w("제", 0.0, 0.2), w("제", 0.3, 0.5), w("제품", 0.6, 1.2),
    ])
    stutters = [s for s in detect_fillers([utt]) if s.reason == "stutter"]
    assert len(stutters) == 1
    # 살아남는 건 마지막 '제품'
    assert stutters[0].end <= 0.6


def test_dead_air_between_words():
    utt = Utterance("a b", 0, 4, [w("안녕", 0.0, 0.5), w("하세요", 2.0, 2.6)])
    dead = [s for s in detect_fillers([utt]) if s.reason == "dead_air"]
    assert len(dead) == 1
    assert dead[0].duration == pytest.approx(1.5 - 2 * FillerConfig().pad, abs=0.01)


def test_low_confidence_noise_is_cut():
    utt = Utterance("x", 0, 2, [w("흡", 0.0, 0.3, prob=0.1), w("네", 0.4, 0.7)])
    assert [s for s in detect_fillers([utt]) if s.reason == "filler"]


def test_retake_drops_the_earlier_take():
    first = Utterance("안녕하세요 오늘은 신제품을 소개합니다", 0, 3)
    second = Utterance("안녕하세요 오늘은 신제품을 소개할게요", 4, 7)
    spans = detect_retakes([first, second])
    assert len(spans) == 1
    assert (spans[0].start, spans[0].end) == (0, 3)


# --------------------------------------------------------------------------- #
def test_build_cuts_leaves_breathing_room():
    """긴 정적은 통째로 지우지 않고 max_pause 만큼 남긴다."""
    silences = [Span(1.0, 4.0, "silence")]
    utts = [Utterance("x", 0, 5, [w("안녕", 0.0, 0.9), w("반가워요", 4.1, 5.0)])]
    keep, removed = build_cuts(
        duration=5.0, silences=silences, utterances=utts,
        cut_config=CutConfig(max_pause=0.5, keep_pause=0.15),
    )
    remaining_gap = sum(k.duration for k in keep) - (0.9 + 0.9)
    assert 0.1 < remaining_gap < 0.8      # 숨 쉴 틈은 남았다
    assert removed


def test_protected_span_is_never_cut():
    silences = [Span(1.0, 4.0, "silence")]
    keep, removed = build_cuts(
        duration=5.0, silences=silences, utterances=[],
        protect=[Span(1.5, 3.5, "protect")],
    )
    assert all(not r.overlaps(Span(1.5, 3.5)) for r in removed)


def test_head_and_tail_are_trimmed_whole():
    silences = [Span(0.0, 1.2, "silence"), Span(8.5, 10.0, "silence")]
    keep, _ = build_cuts(duration=10.0, silences=silences, utterances=[])
    assert keep[0].start >= 1.19
    assert keep[-1].end <= 8.51


def test_tiny_fragments_are_dropped():
    silences = [Span(1.0, 3.0, "silence"), Span(3.1, 6.0, "silence")]
    keep, _ = build_cuts(
        duration=6.0, silences=silences, utterances=[],
        cut_config=CutConfig(min_clip=0.5, max_pause=0.2, keep_pause=0.05),
    )
    assert all(k.duration >= 0.5 for k in keep)


# --------------------------------------------------------------------------- #
def test_clips_are_laid_end_to_end():
    keep = [Span(1.0, 2.0), Span(5.0, 6.5)]
    clips = to_clips("a.mp4", keep)
    assert clips[0].timeline_start == 0.0
    assert clips[1].timeline_start == pytest.approx(1.0)
    assert clips[1].timeline_end == pytest.approx(2.5)


def test_remap_time_follows_the_cut():
    clips = to_clips("a.mp4", [Span(1.0, 2.0), Span(5.0, 6.5)])
    assert remap_time(clips, "a.mp4", 1.5) == pytest.approx(0.5)
    assert remap_time(clips, "a.mp4", 5.5) == pytest.approx(1.5)
    assert remap_time(clips, "a.mp4", 3.0) is None      # 잘려나간 지점
