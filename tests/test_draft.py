"""캡컷 draft 생성 — 구조가 캡컷이 읽을 수 있는 형태인지."""

import json

import pytest

from reelforge.export.capcut.draft import US, build_draft, build_meta, us, write_draft
from reelforge.export.capcut.styles import get_style, hex_to_rgb
from reelforge.models import Caption, Clip, EditPlan, NarrationLine


@pytest.fixture
def plan(tmp_path):
    video = tmp_path / "take1.mp4"
    video.write_bytes(b"fake")           # probe 는 실패해도 되도록 설계돼 있다
    return EditPlan(
        project="테스트릴스",
        clips=[
            Clip(str(video), 1.0, 2.5, 0.0),
            Clip(str(video), 5.0, 7.0, 1.5),
        ],
        captions=[
            Caption("첫 자막", 0.0, 1.2, "reels_bold", ["첫"]),
            Caption("두 번째\n자막", 1.3, 3.0, "reels_bold"),
        ],
        narration=[NarrationLine("안녕하세요", 0.0, str(tmp_path / "l0.mp3"), 1.4)],
    )


def test_time_conversion_is_microseconds():
    assert us(1.5) == 1_500_000
    assert US == 1_000_000


def test_hex_to_rgb():
    assert hex_to_rgb("#ffffff") == [1.0, 1.0, 1.0]
    assert hex_to_rgb("#000") == [0.0, 0.0, 0.0]
    with pytest.raises(ValueError):
        hex_to_rgb("#12345")


def test_draft_has_the_tracks_capcut_expects(plan):
    draft = build_draft(plan)
    kinds = [track["type"] for track in draft["tracks"]]
    assert kinds[0] == "video"
    assert "text" in kinds
    assert "audio" in kinds


def test_video_segments_carry_source_and_timeline_ranges(plan):
    draft = build_draft(plan)
    segments = draft["tracks"][0]["segments"]
    assert len(segments) == 2
    first, second = segments
    assert first["target_timerange"] == {"start": 0, "duration": us(1.5)}
    assert first["source_timerange"] == {"start": us(1.0), "duration": us(1.5)}
    assert second["target_timerange"]["start"] == us(1.5)


def test_one_material_is_reused_across_clips_of_the_same_file(plan):
    draft = build_draft(plan)
    assert len(draft["materials"]["videos"]) == 1


def test_every_segment_reference_resolves(plan):
    """extra_material_refs 가 실제 재질을 가리키지 않으면 캡컷이 프로젝트를 못 연다."""
    draft = build_draft(plan)
    known = {
        material["id"]
        for bucket in draft["materials"].values()
        for material in bucket
        if isinstance(material, dict) and "id" in material
    }
    for track in draft["tracks"]:
        for segment in track["segments"]:
            assert segment["material_id"] in known
            for ref in segment["extra_material_refs"]:
                assert ref in known


def test_text_content_is_a_json_string_with_styles(plan):
    draft = build_draft(plan)
    material = draft["materials"]["texts"][0]
    content = json.loads(material["content"])
    assert content["text"] == "첫 자막"
    assert content["styles"][0]["range"] == [0, len("첫 자막")]
    # 강조 키워드는 별도 범위 + 다른 색
    emphasis = content["styles"][-1]
    assert emphasis["range"] == [0, 1]
    accent = hex_to_rgb(get_style("reels_bold").emphasis_color)
    assert emphasis["fill"]["content"]["solid"]["color"] == accent


def test_mute_original_zeroes_the_video_volume(plan):
    draft = build_draft(plan, mute_original=True)
    assert all(s["volume"] == 0.0 for s in draft["tracks"][0]["segments"])


def test_gain_is_converted_from_db(plan):
    draft = build_draft(plan, original_gain_db=-6.0)
    volume = draft["tracks"][0]["segments"][0]["volume"]
    assert volume == pytest.approx(0.5012, abs=0.001)


def test_jump_cut_zoom_alternates(plan):
    draft = build_draft(plan, jump_cut_zoom=0.04)
    scales = [s["clip"]["scale"]["x"] for s in draft["tracks"][0]["segments"]]
    assert scales == [1.0, pytest.approx(1.04)]


def test_caption_position_maps_to_capcut_transform(plan):
    draft = build_draft(plan)
    text_track = next(t for t in draft["tracks"] if t["type"] == "text")
    # position 0.72(화면 아래쪽) → y 음수
    assert text_track["segments"][0]["clip"]["transform"]["y"] < 0


def test_duration_covers_the_whole_timeline(plan):
    draft = build_draft(plan)
    assert draft["duration"] == us(plan.duration)
    assert plan.duration == pytest.approx(3.5)


def test_write_draft_creates_both_json_files(plan, tmp_path):
    folder = write_draft(plan, tmp_path / "Projects")
    assert (folder / "draft_content.json").exists()
    assert (folder / "draft_meta_info.json").exists()
    assert folder.name == "테스트릴스"
    meta = json.loads((folder / "draft_meta_info.json").read_text(encoding="utf-8"))
    assert meta["draft_name"] == "테스트릴스"
    assert meta["draft_fold_path"] == str(folder)


def test_template_overrides_version_fields(plan, tmp_path):
    folder = write_draft(
        plan, tmp_path / "P", template={"version": 999, "new_version": "123.0.0"}
    )
    content = json.loads((folder / "draft_content.json").read_text(encoding="utf-8"))
    assert content["version"] == 999
    assert content["new_version"] == "123.0.0"


def test_plan_round_trips_through_json(plan, tmp_path):
    path = plan.save(tmp_path / "plan.json")
    again = EditPlan.load(path)
    assert again.project == plan.project
    assert len(again.clips) == len(plan.clips)
    assert again.captions[0].emphasis == ["첫"]
    assert again.duration == pytest.approx(plan.duration)


def test_caption_position_reaches_the_draft(plan):
    """브리프의 captions.position 이 실제 y 좌표까지 전달돼야 한다."""
    plan.captions[0].position = 0.5      # 정중앙
    plan.captions[1].position = 0.9      # 거의 바닥
    draft = build_draft(plan)
    text_track = next(t for t in draft["tracks"] if t["type"] == "text")
    ys = [s["clip"]["transform"]["y"] for s in text_track["segments"]]
    assert ys[0] == pytest.approx(0.0)
    assert ys[1] == pytest.approx(-0.8)
