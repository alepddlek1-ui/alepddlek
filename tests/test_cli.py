"""CLI 인자 처리."""

import pytest

from reelforge.cli import build_parser, main


def test_init_writes_a_usable_brief(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    assert main(["init", "여름신상"]) == 0
    brief = tmp_path / "여름신상.yaml"
    assert brief.exists()

    from reelforge.script.brief import load_brief

    assert load_brief(brief).project == "여름신상"


def test_init_refuses_to_clobber(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    main(["init", "중복"])
    assert main(["init", "중복"]) == 1
    assert main(["init", "중복", "--force"]) == 0


def test_render_without_a_target_fails_clearly(capsys):
    assert main(["render"]) == 1
    assert "브리프" in capsys.readouterr().out


def test_missing_brief_reports_the_path(tmp_path, capsys):
    assert main(["build", str(tmp_path / "없음.yaml")]) == 1
    assert "없습니다" in capsys.readouterr().out


def test_build_defaults():
    args = build_parser().parse_args(["build", "b.yaml"])
    assert args.jump_cut_zoom == 0.0
    assert args.no_cache is False
    assert args.show_cuts == 8


def test_a_command_is_required():
    with pytest.raises(SystemExit):
        build_parser().parse_args([])


def test_export_rebuilds_a_draft_from_an_edited_plan(tmp_path, capsys):
    """웹 편집기에서 컷을 되살리고 자막을 고친 뒤 다시 캡컷으로 보내는 경로."""
    from reelforge.models import Caption, Clip, EditPlan

    video = tmp_path / "take1.mp4"
    video.write_bytes(b"fake")
    plan = EditPlan(
        project="손본버전",
        clips=[Clip(str(video), 0.0, 2.0, 0.0)],
        captions=[Caption("고친 자막", 0.0, 1.5, "reels_bold")],
    )
    plan_path = plan.save(tmp_path / "plan.json")

    assert main([
        "export", str(plan_path),
        "--projects-dir", str(tmp_path / "Projects"),
        "--no-template",
    ]) == 0
    draft = tmp_path / "Projects/손본버전/draft_content.json"
    assert draft.exists()
    assert "고친 자막" in draft.read_text(encoding="utf-8")
    assert (tmp_path / "손본버전.srt").exists()
