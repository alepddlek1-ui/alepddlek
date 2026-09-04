"""캡컷 draft 생성 (pycapcut 기반).

여기서 확인하는 것: 우리가 정한 편집 결정이 pycapcut 을 거쳐도 그대로
타임라인에 남는가, 그리고 pycapcut 이 채워주지 않는 두 곳(프로젝트 메타 ·
키워드 강조)을 우리가 제대로 메우는가.
"""

import json

import pytest

from conftest import load_draft, load_meta, write_png, write_wav
from reelforge.export.capcut.draft import US, build_script, us, write_draft
from reelforge.export.capcut.styles import get_style, hex_to_rgb
from reelforge.models import Caption, Clip, EditPlan, NarrationLine

pytest.importorskip("pycapcut")


@pytest.fixture
def plan(footage):
    return EditPlan(
        project="테스트릴스",
        clips=[
            Clip(str(footage), 1.0, 2.5, 0.0),
            Clip(str(footage), 5.0, 7.0, 1.5),
        ],
        captions=[
            Caption("첫 자막", 0.0, 1.2, "reels_bold", ["첫"]),
            Caption("두 번째\n자막", 1.3, 3.0, "reels_bold"),
        ],
    )


def draft_of(plan, **kwargs):
    return json.loads(build_script(plan, **kwargs).dumps())


# --------------------------------------------------------------------------- #
def test_time_conversion_is_microseconds():
    assert us(1.5) == 1_500_000
    assert US == 1_000_000


def test_hex_to_rgb():
    assert hex_to_rgb("#ffffff") == (1.0, 1.0, 1.0)
    assert hex_to_rgb("#000") == (0.0, 0.0, 0.0)
    with pytest.raises(ValueError):
        hex_to_rgb("#12345")


def test_tracks_are_laid_out_as_capcut_expects(plan, tmp_path):
    plan.narration = [NarrationLine("안녕하세요", 0.0, str(write_wav(tmp_path / "v.wav")), 1.4)]
    draft = draft_of(plan)
    kinds = [t["type"] for t in draft["tracks"]]
    assert kinds[0] == "video"
    assert "text" in kinds
    assert "audio" in kinds


def test_clips_keep_their_source_and_timeline_ranges(plan):
    segments = draft_of(plan)["tracks"][0]["segments"]
    assert len(segments) == 2
    first, second = segments
    assert first["target_timerange"] == {"start": 0, "duration": us(1.5)}
    assert first["source_timerange"] == {"start": us(1.0), "duration": us(1.5)}
    assert second["target_timerange"]["start"] == us(1.5)
    assert second["target_timerange"]["duration"] == us(2.0)


def test_one_material_is_reused_across_clips_of_the_same_file(plan):
    assert len(draft_of(plan)["materials"]["videos"]) == 1


def test_every_segment_reference_resolves(plan, tmp_path):
    """끊어진 참조가 있으면 캡컷이 프로젝트를 못 열 수 있다.

    저장 뒤 파일로 확인한다 — 캡컷이 읽는 건 그 파일이지 메모리 위의
    ScriptFile 이 아니기 때문이다.
    """
    draft = load_draft(write_draft(plan, tmp_path / "Projects"))
    known = {
        material["id"]
        for bucket in draft["materials"].values()
        if isinstance(bucket, list)
        for material in bucket
        if isinstance(material, dict) and "id" in material
    }
    for track in draft["tracks"]:
        for segment in track["segments"]:
            assert segment["material_id"] in known
            for ref in segment.get("extra_material_refs", []):
                assert ref in known


def test_pycapcut_leaves_a_dangling_ref_on_text_segments(plan):
    """라이브러리 쪽 문제를 기록해 둔다 — 우리가 저장할 때 걷어낸다.

    pycapcut 0.0.3 의 TextSegment 는 speed 소재의 id 를 참조에 넣지만
    그 소재를 materials 에 등록하지 않는다. 이 테스트가 깨진다면
    라이브러리가 고쳐졌다는 뜻이고, 우리 뒷정리는 그대로 둬도 무해하다.
    """
    draft = draft_of(plan)
    known = {
        m["id"] for bucket in draft["materials"].values() if isinstance(bucket, list)
        for m in bucket if isinstance(m, dict) and "id" in m
    }
    text_track = next(t for t in draft["tracks"] if t["type"] == "text")
    dangling = [
        ref for s in text_track["segments"]
        for ref in s.get("extra_material_refs", []) if ref not in known
    ]
    assert dangling, "pycapcut 이 고쳐졌다면 이 테스트를 지워도 된다"


def test_narration_and_music_land_on_their_own_tracks(plan, tmp_path):
    plan.narration = [NarrationLine("안녕하세요", 0.0, str(write_wav(tmp_path / "line0.wav")), 1.4)]
    plan.music = str(write_wav(tmp_path / "bgm.wav", seconds=6.0))
    plan.music_gain_db = -18.0
    draft = draft_of(plan)
    audio = [t for t in draft["tracks"] if t["type"] == "audio"]
    assert len(audio) == 2
    names = {t["name"] for t in audio}
    assert names == {"나레이션", "BGM"}
    music_track = next(t for t in audio if t["name"] == "BGM")
    assert music_track["segments"][0]["volume"] == pytest.approx(0.1259, abs=0.001)


def test_music_is_trimmed_to_the_video_length(plan, tmp_path):
    plan.music = str(write_wav(tmp_path / "bgm.wav", seconds=30.0))
    draft = draft_of(plan)
    music = next(t for t in draft["tracks"] if t.get("name") == "BGM")
    assert music["segments"][0]["target_timerange"]["duration"] == us(plan.duration)


def test_mute_original_zeroes_the_video_volume(plan):
    draft = draft_of(plan, mute_original=True)
    assert all(s["volume"] == 0.0 for s in draft["tracks"][0]["segments"])


def test_gain_is_converted_from_db(plan):
    draft = draft_of(plan, original_gain_db=-6.0)
    assert draft["tracks"][0]["segments"][0]["volume"] == pytest.approx(0.5012, abs=0.001)


def test_jump_cut_zoom_alternates(plan):
    draft = draft_of(plan, jump_cut_zoom=0.04)
    scales = [s["clip"]["scale"]["x"] for s in draft["tracks"][0]["segments"]]
    assert scales == [1.0, pytest.approx(1.04)]


def test_caption_position_maps_to_capcut_transform(plan):
    plan.captions[0].position = 0.5      # 정중앙
    plan.captions[1].position = 0.9      # 거의 바닥
    text_track = next(t for t in draft_of(plan)["tracks"] if t["type"] == "text")
    ys = [s["clip"]["transform"]["y"] for s in text_track["segments"]]
    assert ys[0] == pytest.approx(0.0)
    assert ys[1] == pytest.approx(-0.8)


def test_caption_text_and_style_reach_the_draft(plan):
    material = draft_of(plan)["materials"]["texts"][0]
    content = json.loads(material["content"])
    assert content["text"] == "첫 자막"
    base = content["styles"][0]
    assert base["range"] == [0, len("첫 자막")]
    assert base["bold"] is True
    assert base["strokes"], "외곽선이 있어야 어떤 배경에서도 읽힌다"


def test_short_caption_does_not_get_a_longer_animation_than_itself(plan):
    plan.captions = [Caption("짧다", 0.0, 0.2, "reels_bold")]
    draft = draft_of(plan)
    animations = draft["materials"].get("material_animations", [])
    assert animations
    for entry in animations:
        for animation in entry["animations"]:
            assert animation["duration"] <= us(0.2)


def test_duration_covers_the_whole_timeline(plan):
    assert draft_of(plan)["duration"] == us(plan.duration)
    assert plan.duration == pytest.approx(3.5)


# --------------------------------------------------------------------------- #
# pycapcut 이 안 해주는 두 가지
# --------------------------------------------------------------------------- #
def test_keyword_emphasis_gets_its_own_colored_range(plan, tmp_path):
    """pycapcut 은 글자 범위별 색을 지원하지 않아 우리가 얹는다."""
    folder = write_draft(plan, tmp_path / "Projects")
    content = json.loads(load_draft(folder)["materials"]["texts"][0]["content"])
    styles = content["styles"]
    assert len(styles) == 2, "기본 스타일 + 강조 범위"
    accent = list(hex_to_rgb(get_style("reels_bold").emphasis_color))
    highlight = styles[1]
    assert highlight["range"] == [0, 1]              # '첫'
    assert highlight["fill"]["content"]["solid"]["color"] == accent
    # 기본 스타일은 건드리지 않는다
    assert styles[0]["range"] == [0, len("첫 자막")]


def test_captions_without_keywords_are_left_alone(plan, tmp_path):
    folder = write_draft(plan, tmp_path / "Projects")
    content = json.loads(load_draft(folder)["materials"]["texts"][1]["content"])
    assert len(content["styles"]) == 1


def test_each_project_gets_its_own_draft_id(plan, tmp_path, footage):
    """pycapcut 이 복사하는 meta 템플릿은 draft_id 가 고정값이라 서로 가린다."""
    first = write_draft(plan, tmp_path / "Projects")
    second_plan = EditPlan(project="다른릴스", clips=[Clip(str(footage), 0.0, 1.0, 0.0)])
    second = write_draft(second_plan, tmp_path / "Projects")
    assert load_meta(first)["draft_id"] != load_meta(second)["draft_id"]


def test_meta_names_the_project_and_its_folder(plan, tmp_path):
    folder = write_draft(plan, tmp_path / "Projects")
    meta = load_meta(folder)
    assert meta["draft_name"] == "테스트릴스"
    assert meta["draft_fold_path"] == str(folder)
    assert meta["tm_duration"] == us(plan.duration)


def test_write_draft_creates_both_json_files(plan, tmp_path):
    folder = write_draft(plan, tmp_path / "Projects")
    assert (folder / "draft_content.json").exists()
    assert (folder / "draft_meta_info.json").exists()
    assert folder.name == "테스트릴스"


def test_rebuilding_the_same_project_replaces_it(plan, tmp_path):
    write_draft(plan, tmp_path / "Projects")
    plan.captions[0].text = "고친 자막"
    folder = write_draft(plan, tmp_path / "Projects")
    content = json.loads(load_draft(folder)["materials"]["texts"][0]["content"])
    assert content["text"] == "고친 자막"


def test_plan_round_trips_through_json(plan, tmp_path):
    again = EditPlan.load(plan.save(tmp_path / "plan.json"))
    assert again.project == plan.project
    assert len(again.clips) == len(plan.clips)
    assert again.captions[0].emphasis == ["첫"]
    assert again.duration == pytest.approx(plan.duration)


def test_hook_and_captions_do_not_fight_over_one_track(plan):
    """훅은 말자막 위에 얹는 문구다. 같은 트랙에 두면 캡컷이 프로젝트를 거부한다."""
    plan.captions.insert(0, Caption("이거 모르면 손해", 0.0, 1.8, "reels_bold", layer="overlay"))
    draft = draft_of(plan)
    text_tracks = [t for t in draft["tracks"] if t["type"] == "text"]
    assert len(text_tracks) == 2
    assert {t["name"] for t in text_tracks} == {"자막", "훅·CTA"}


def test_hand_edited_overlapping_captions_are_trimmed_not_rejected(plan):
    """웹 편집대에서 시각을 겹치게 고쳐도 내보내기가 죽으면 안 된다."""
    plan.captions = [
        Caption("먼저", 0.0, 2.5, "reels_bold"),
        Caption("겹침", 1.0, 3.0, "reels_bold"),
    ]
    segments = next(t for t in draft_of(plan)["tracks"] if t["type"] == "text")["segments"]
    assert len(segments) == 2
    first, second = segments
    assert first["target_timerange"]["start"] + first["target_timerange"]["duration"] \
        <= second["target_timerange"]["start"]


def test_a_caption_swallowed_by_its_neighbour_is_dropped(plan):
    plan.captions = [
        Caption("길게 남는 자막", 0.0, 3.0, "reels_bold"),
        Caption("완전히 가려짐", 1.0, 2.0, "reels_bold"),
    ]
    segments = next(t for t in draft_of(plan)["tracks"] if t["type"] == "text")["segments"]
    assert len(segments) == 1


def test_canvas_ratio_is_labelled_for_capcut(plan, tmp_path):
    """pycapcut 은 늘 'original' 로 적는다. 캡컷 UI 에 9:16 으로 뜨게 채운다."""
    assert load_draft(write_draft(plan, tmp_path / "P"))["canvas_config"] == {
        "width": 1080, "height": 1920, "ratio": "9:16",
    }


def test_emphasis_lands_on_the_right_caption_when_tracks_are_split(plan, tmp_path):
    """훅을 다른 트랙으로 빼면 자막 소재 순서가 plan.captions 순서와 달라진다.

    순서를 맞추지 않으면 강조 색이 엉뚱한 자막에 들어가거나 조용히 사라진다.
    """
    plan.captions = [
        Caption("이거 모르면 손해", 0.0, 1.8, "reels_bold", ["손해"], 0.32, "overlay"),
        Caption("이번 신상은 무료배송", 0.2, 2.4, "reels_bold", ["무료배송"], 0.72),
        Caption("3분이면 끝납니다", 2.5, 4.6, "reels_bold", ["3분"], 0.72),
    ]
    texts = load_draft(write_draft(plan, tmp_path / "P"))["materials"]["texts"]
    accent = list(hex_to_rgb(get_style("reels_bold").emphasis_color))

    highlighted = {}
    for material in texts:
        content = json.loads(material["content"])
        for style in content["styles"][1:]:
            start, end = style["range"]
            assert style["fill"]["content"]["solid"]["color"] == accent
            highlighted[content["text"]] = content["text"][start:end]

    assert highlighted == {
        "이거 모르면 손해": "손해",
        "이번 신상은 무료배송": "무료배송",
        "3분이면 끝납니다": "3분",
    }
