"""브리프 파싱 — 오타는 조용히 넘어가면 안 된다."""

import json

import pytest

from reelforge.script.brief import BriefError, from_dict, load_brief


def test_minimal_brief():
    brief = from_dict({"project": "테스트"})
    assert brief.size == (1080, 1920)
    assert brief.captions.source == "transcript"
    assert brief.narration.enabled is False


def test_single_footage_string_is_accepted():
    assert from_dict({"project": "t", "footage": "a.mp4"}).footage == ["a.mp4"]


def test_project_is_required():
    with pytest.raises(BriefError, match="project"):
        from_dict({"footage": ["a.mp4"]})


def test_unknown_aspect_is_rejected():
    with pytest.raises(BriefError, match="비율"):
        from_dict({"project": "t", "aspect": "3:2"})


def test_typo_in_a_nested_key_is_caught():
    """`max_char` (s 빠짐) 이 조용히 무시되면 자막이 이상해진다."""
    with pytest.raises(BriefError, match="max_char"):
        from_dict({"project": "t", "captions": {"max_char": 10}})


def test_top_level_keywords_flow_into_captions():
    brief = from_dict({"project": "t", "keywords": ["무료배송"]})
    assert brief.captions.keywords == ["무료배송"]


def test_relative_paths_resolve_against_the_brief(tmp_path):
    (tmp_path / "raw").mkdir()
    path = tmp_path / "brief.json"
    path.write_text(json.dumps({"project": "t", "footage": ["raw/a.mp4"]}), encoding="utf-8")
    brief = load_brief(path)
    assert brief.footage_paths[0] == tmp_path / "raw/a.mp4"


def test_stt_prompt_gathers_proper_nouns():
    brief = from_dict({
        "project": "t", "hook": "리얼포지 써보세요", "cta": "프로필 링크",
        "keywords": ["무료배송"],
    })
    assert "리얼포지" in brief.stt_prompt
    assert "무료배송" in brief.stt_prompt


def test_shipped_template_is_valid(tmp_path):
    from pathlib import Path

    import reelforge

    source = Path(reelforge.__file__).parent / "templates" / "brief.yaml"
    target = tmp_path / "brief.yaml"
    target.write_text(source.read_text(encoding="utf-8").replace("__PROJECT__", "샘플"), encoding="utf-8")
    brief = load_brief(target)
    assert brief.project == "샘플"
    assert brief.captions.style == "reels_bold"
    assert brief.narration.voice.startswith("ko-KR")
