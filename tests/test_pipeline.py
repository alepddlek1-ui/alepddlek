"""브리프 → 캡컷 프로젝트 전 구간. ffmpeg/whisper 는 가짜로 대체한다."""

import json

import pytest

from reelforge import pipeline
from reelforge.media import MediaInfo
from reelforge.models import Span, Utterance, Word
from reelforge.script.brief import from_dict


def w(text, start, end, prob=0.95):
    return Word(text, start, end, prob)


# 10초짜리 촬영본 흉내:
#  0.0~0.8  앞부분 빈 구간
#  0.8~1.2  "음"           ← 필러
#  1.2~3.0  "이 제품 진짜 좋아요"
#  3.0~6.0  침묵            ← 죽은 시간
#  6.0~8.2  "지금 사면 무료배송입니다"
#  8.2~10.0 뒷부분 빈 구간
FAKE_UTTERANCES = [
    Utterance("음 이 제품 진짜 좋아요", 0.8, 3.0, [
        w("음", 0.8, 1.15), w("이", 1.2, 1.4), w("제품", 1.45, 1.9),
        w("진짜", 1.95, 2.3), w("좋아요.", 2.35, 3.0),
    ]),
    Utterance("지금 사면 무료배송입니다", 6.0, 8.2, [
        w("지금", 6.0, 6.4), w("사면", 6.45, 6.9),
        w("무료배송", 6.95, 7.6), w("입니다.", 7.65, 8.2),
    ]),
]
FAKE_SILENCES = [Span(0.0, 0.8, "silence"), Span(3.0, 6.0, "silence"), Span(8.2, 10.0, "silence")]


@pytest.fixture
def fake_media(monkeypatch, tmp_path):
    def probe(path):
        return MediaInfo(str(path), duration=10.0, width=1080, height=1920, fps=30.0, has_audio=True)

    monkeypatch.setattr(pipeline, "probe", probe)
    monkeypatch.setattr("reelforge.export.capcut.draft.probe", probe)
    monkeypatch.setattr(pipeline, "extract_audio", lambda src, dst, **kw: dst)
    monkeypatch.setattr(pipeline, "detect_silence", lambda *a, **kw: list(FAKE_SILENCES))
    monkeypatch.setattr(pipeline, "transcribe", lambda *a, **kw: list(FAKE_UTTERANCES))
    return tmp_path


@pytest.fixture
def brief(tmp_path):
    video = tmp_path / "take1.mp4"
    video.write_bytes(b"fake")
    return from_dict(
        {
            "project": "스모크",
            "footage": [str(video)],
            "hook": "3초면 끝납니다",
            "cta": "프로필 링크 확인",
            "keywords": ["무료배송"],
        },
        base_dir=tmp_path,
    )


def test_plan_cuts_the_dead_air_and_the_filler(fake_media, brief, tmp_path):
    plan = pipeline.build_plan(brief, tmp_path / "work")

    assert plan.clips, "남는 클립이 있어야 한다"
    assert plan.duration < 10.0
    # 3~6초 침묵이 통째로 남아 있으면 안 된다
    assert plan.duration < 8.0
    reasons = {span.reason for span in plan.removed}
    assert any("silence" in r for r in reasons)
    assert any("filler" in r for r in reasons)


def test_filler_does_not_survive_into_the_captions(fake_media, brief, tmp_path):
    plan = pipeline.build_plan(brief, tmp_path / "work")
    body = " ".join(c.text for c in plan.captions)
    assert "무료배송" in body
    assert "음 " not in body


def test_hook_and_cta_bookend_the_captions(fake_media, brief, tmp_path):
    plan = pipeline.build_plan(brief, tmp_path / "work")
    assert plan.captions[0].text == "3초면 끝납니다"
    assert plan.captions[-1].text == "프로필 링크 확인"


def test_keyword_emphasis_survives_to_the_plan(fake_media, brief, tmp_path):
    plan = pipeline.build_plan(brief, tmp_path / "work")
    assert any("무료배송" in c.emphasis for c in plan.captions)


def test_transcript_cache_skips_the_second_run(fake_media, brief, tmp_path, monkeypatch):
    work = tmp_path / "work"
    pipeline.build_plan(brief, work)

    def boom(*a, **kw):
        raise AssertionError("캐시가 있는데 다시 전사했다")

    monkeypatch.setattr(pipeline, "transcribe", boom)
    plan = pipeline.build_plan(brief, work)
    assert plan.clips


def test_export_writes_plan_srt_and_capcut_project(fake_media, brief, tmp_path):
    plan = pipeline.build_plan(brief, tmp_path / "work")
    results = pipeline.export_all(
        plan, brief, tmp_path / "out", projects_dir=tmp_path / "Projects"
    )
    assert set(results) == {"plan", "srt", "capcut"}

    content = json.loads(
        (tmp_path / "Projects/스모크/draft_content.json").read_text(encoding="utf-8")
    )
    assert content["canvas_config"] == {"width": 1080, "height": 1920, "ratio": "9:16"}
    assert content["tracks"][0]["segments"]

    srt = (tmp_path / "out/스모크.srt").read_text(encoding="utf-8")
    assert "-->" in srt and "무료배송" in srt


def test_everything_cut_away_raises_a_useful_error(fake_media, tmp_path, monkeypatch):
    monkeypatch.setattr(pipeline, "detect_silence", lambda *a, **kw: [Span(0.0, 10.0, "silence")])
    monkeypatch.setattr(pipeline, "transcribe", lambda *a, **kw: [])
    video = tmp_path / "take1.mp4"
    video.write_bytes(b"fake")
    brief = from_dict({"project": "빈영상", "footage": [str(video)]}, base_dir=tmp_path)
    with pytest.raises(ValueError, match="남는 구간이 없습니다"):
        pipeline.build_plan(brief, tmp_path / "work")


def test_ffmpeg_preview_command_is_well_formed(fake_media, brief, tmp_path):
    from reelforge.export.render import render_preview

    plan = pipeline.build_plan(brief, tmp_path / "work")
    cmd = render_preview(plan, tmp_path / "preview.mp4", dry_run=True)
    assert cmd.startswith("ffmpeg -y")
    assert f"concat=n={len(plan.clips)}" in cmd


def test_caption_position_from_the_brief_is_applied(fake_media, tmp_path):
    video = tmp_path / "take1.mp4"
    video.write_bytes(b"fake")
    brief = from_dict(
        {"project": "위치", "footage": [str(video)], "hook": "훅",
         "captions": {"position": 0.4}},
        base_dir=tmp_path,
    )
    plan = pipeline.build_plan(brief, tmp_path / "work")
    assert all(c.position == 0.4 for c in plan.captions)
