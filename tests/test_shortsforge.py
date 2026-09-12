"""shortsforge — 파이프라인 배선이 맞물리는지.

에이전트가 무슨 글을 쓰는지는 여기서 검증할 수 없다. 대신
'순서 · 계약 · 검증 · 넘겨주기' 가 어긋나지 않는지만 본다.
그게 틀어지면 밤새 돌린 30편이 전부 쓰레기가 된다.
"""

from __future__ import annotations

import json

import pytest

from shortsforge.brief import build_brief, write_brief
from shortsforge.ingest import ingest
from shortsforge.prompts import PromptError, is_empty, resolve, substitute
from shortsforge.queue import DONE, PENDING, Seed, SeedQueue
from shortsforge.schema import validate
from shortsforge.stages import PIPELINE, stage_by_id, stage_by_slug
from shortsforge.workspace import Workspace, WorkspaceError, slugify


# --------------------------------------------------------------------------- #
# 단계 정의
# --------------------------------------------------------------------------- #
def test_pipeline_is_in_dependency_order():
    """뒤 단계가 앞 단계에만 의존해야 한다. 아니면 영원히 안 돈다."""
    seen: set[str] = set()
    for stage in PIPELINE:
        assert set(stage.needs) <= seen, f"{stage.slug} 의 선행 단계가 뒤에 있다"
        seen.add(stage.slug)


def test_stage_lookup_by_order_role_and_slug():
    assert stage_by_id("4").slug == "shorts-script"       # 실행 순서 4번
    assert stage_by_id("role:4").slug == "shorts-product"  # 역할 번호 4번
    assert stage_by_id("shorts-title").order == 5


def test_every_stage_has_a_prompt_slot_on_disk():
    from shortsforge.stages import STAGES

    for stage in STAGES:
        assert stage.prompt_path.is_file(), f"{stage.prompt_path} 가 없다"


# --------------------------------------------------------------------------- #
# 작업 폴더
# --------------------------------------------------------------------------- #
def test_slugify_keeps_korean():
    assert slugify("무선 핸디 청소기 A안") == "무선-핸디-청소기-A안"
    assert slugify("  ") == "untitled"


def test_next_stage_walks_the_pipeline(tmp_path):
    ws = Workspace.create("테스트", root=tmp_path)
    assert ws.next_stage().slug == "shorts-product"

    ws.save("shorts-product", {"strengths": [1], "buying_points": [1],
                               "differentiators": [1], "target": "x", "hooks": [1]})
    assert ws.next_stage().slug == "shorts-keyword"

    ws.save("shorts-keyword", {"korean": [1], "xiaohongshu": [1], "tiktok": [1]})
    assert ws.next_stage().slug == "shorts-rival"


def test_script_waits_for_both_dependencies(tmp_path):
    """대본은 상품 분석과 경쟁 분석이 둘 다 있어야 돈다."""
    ws = Workspace.create("테스트", root=tmp_path)
    ws.save("shorts-product", {"strengths": [1]})
    assert ws.next_stage().slug != "shorts-script"


def test_create_refuses_to_clobber(tmp_path):
    Workspace.create("겹침", root=tmp_path)
    with pytest.raises(WorkspaceError, match="이미 있습니다"):
        Workspace.create("겹침", root=tmp_path)


def test_broken_json_says_which_file(tmp_path):
    ws = Workspace.create("테스트", root=tmp_path)
    ws.path_for("shorts-product").write_text("{깨진", encoding="utf-8")
    with pytest.raises(WorkspaceError, match="01_product.json"):
        ws.load("shorts-product")


# --------------------------------------------------------------------------- #
# 영상 투입
# --------------------------------------------------------------------------- #
def test_ingest_records_video_path_without_copying(tmp_path):
    video = tmp_path / "무선청소기.mp4"
    video.write_bytes(b"\x00" * 16)
    ws = ingest(video, root=tmp_path / "work")

    body = ws.input_path.read_text(encoding="utf-8")
    assert str(video.resolve()) in body
    assert "__VIDEO__" not in body                       # 치환어가 남지 않았다
    assert not (ws.root / video.name).exists()           # 복사하지 않는다


def test_ingest_rejects_non_video(tmp_path):
    doc = tmp_path / "메모.txt"
    doc.write_text("x", encoding="utf-8")
    with pytest.raises(WorkspaceError, match="영상 파일이 아닌"):
        ingest(doc, root=tmp_path / "work")


# --------------------------------------------------------------------------- #
# 산출물 검증
# --------------------------------------------------------------------------- #
def test_missing_key_is_reported():
    problems = validate(stage_by_slug("shorts-script"), {"hook": "짧은 훅"})
    assert any("beats" in p for p in problems)
    assert any("cta" in p for p in problems)


def test_empty_value_counts_as_missing():
    problems = validate(stage_by_slug("shorts-keyword"),
                        {"korean": [], "xiaohongshu": ["a"], "tiktok": ["b"]})
    assert any("korean" in p for p in problems)


def test_counts_are_enforced_as_the_prompt_asked():
    """"후킹 포인트 10개" 라고 써놓고 7개를 받으면 안 된다."""
    problems = validate(stage_by_slug("shorts-product"), {
        "strengths": ["a", "b"], "buying_points": ["x"],
        "differentiators": ["y"], "target": "z", "hooks": ["h"] * 7,
    })
    assert any("10개" in p and "지금 7개" in p for p in problems)


def test_title_length_range_is_checked():
    """20개를 채워도 길이가 어긋나면 통과시키지 않는다."""
    problems = validate(stage_by_slug("shorts-title"),
                        {"titles": ["짧은제목"] * 20, "pick": "짧은제목"})
    assert any("15~30자" in p for p in problems)


def test_script_must_walk_the_promised_flow():
    """공감 → 문제 → 해결 → 제품 흐름이 빠지면 대본이 아니다."""
    problems = validate(stage_by_slug("shorts-script"), {
        "hook": "이거 모르면 손해",
        "beats": [{"label": "공감", "line": "a"}, {"label": "제품", "line": "b"}],
        "cta": "링크 확인",
        "duration_sec": 20,
    })
    assert any("공감" in p for p in problems)


def test_good_payload_passes():
    payload = {
        "hook": "이거 모르면 손해",
        "beats": [{"label": label, "line": "a"}
                  for label in ("공감", "문제", "해결", "제품")],
        "cta": "링크 확인",
        "duration_sec": 20,
    }
    assert validate(stage_by_slug("shorts-script"), payload) == []


# --------------------------------------------------------------------------- #
# 프롬프트 슬롯
# --------------------------------------------------------------------------- #
def test_substitute_leaves_json_braces_alone():
    body = '상품은 {상품명}. 예시: {"hook": "x"} 그리고 {안알려준키}'
    out = substitute(body, {"상품명": "청소기"})
    assert '{"hook": "x"}' in out
    assert "{안알려준키}" in out
    assert "청소기" in out


def test_empty_slot_is_detected():
    assert is_empty("(아직 비어 있습니다. 이 줄을 지우고 프롬프트를 붙여넣으세요.)")
    assert not is_empty("훅부터 CTA까지 대본을 써라")


def test_resolve_refuses_empty_slot(tmp_path):
    ws = Workspace.create("테스트", root=tmp_path)
    slot = tmp_path / "prompts"
    slot.mkdir()
    stage = stage_by_slug("shorts-script")
    (slot / stage.prompt).write_text("## 프롬프트\n\n아직 비어 있습니다\n", encoding="utf-8")
    with pytest.raises(PromptError, match="비어 있습니다"):
        resolve(stage, ws, root=slot)


def test_resolve_fills_this_episodes_values(tmp_path):
    ws = Workspace.create("무선청소기", root=tmp_path)
    slot = tmp_path / "prompts"
    slot.mkdir()
    stage = stage_by_slug("shorts-script")
    (slot / stage.prompt).write_text(
        "## 프롬프트\n{상품명} 대본을 {목표길이}초로 써라.\n", encoding="utf-8"
    )
    out = resolve(stage, ws, root=slot)
    assert "무선청소기 대본을 20초로" in out


def test_channel_persona_is_prepended_to_every_prompt(tmp_path):
    """페르소나가 빠진 대본은 다른 채널 물건이 된다."""
    ws = Workspace.create("무선청소기", root=tmp_path)
    slot = tmp_path / "prompts"
    slot.mkdir()
    (slot / "00-채널.md").write_text(
        "## 프롬프트\n35세 육아맘, 털털하고 쾌활함.\n", encoding="utf-8"
    )
    stage = stage_by_slug("shorts-script")
    (slot / stage.prompt).write_text("## 프롬프트\n대본을 써라.\n", encoding="utf-8")

    out = resolve(stage, ws, root=slot)
    assert "35세 육아맘" in out
    assert out.index("35세 육아맘") < out.index("대본을 써라")   # 앞에 깔린다


def test_channel_persona_is_not_duplicated(tmp_path):
    """프롬프트가 {채널} 을 직접 부르면 그 자리에만 들어간다."""
    ws = Workspace.create("무선청소기", root=tmp_path)
    slot = tmp_path / "prompts"
    slot.mkdir()
    (slot / "00-채널.md").write_text("## 프롬프트\n35세 육아맘\n", encoding="utf-8")
    stage = stage_by_slug("shorts-script")
    (slot / stage.prompt).write_text(
        "## 프롬프트\n아래 채널용 대본:\n{채널}\n", encoding="utf-8"
    )
    assert resolve(stage, ws, root=slot).count("35세 육아맘") == 1


# --------------------------------------------------------------------------- #
# reelforge 로 넘기기
# --------------------------------------------------------------------------- #
def _finished_workspace(tmp_path) -> Workspace:
    ws = Workspace.create("테스트상품", root=tmp_path)
    ws.save("shorts-script", {
        "hook": "설거지 10분 줄었습니다",
        "beats": [
            {"label": "문제", "line": "매일 10분씩 날렸어요.", "sec": 5},
            {"label": "해결", "line": "이거 하나 바꿨습니다.", "sec": 8},
        ],
        "cta": "프로필 링크에서 확인",
        "duration_sec": 35,
        "keywords": ["무료배송"],
    })
    return ws


def test_brief_stacks_script_lines_in_order(tmp_path):
    brief = build_brief(_finished_workspace(tmp_path))
    lines = brief["script"].strip().splitlines()
    assert lines[0] == "설거지 10분 줄었습니다"
    assert lines[-1] == "프로필 링크에서 확인"
    assert len(lines) == 4                       # 훅 + 비트 2 + CTA


def test_brief_carries_the_ingested_video_as_footage(tmp_path):
    """영상을 넣고 시작했으면 손으로 경로를 옮겨적게 하지 않는다."""
    video = tmp_path / "장갑.mp4"
    video.write_bytes(b"\x00" * 16)
    ws = ingest(video, root=tmp_path / "work")
    ws.save("shorts-script", {
        "hook": "h", "beats": [{"label": "공감", "line": "a"}],
        "cta": "c", "duration_sec": 20,
    })
    assert build_brief(ws)["footage"] == [str(video.resolve())]


def test_brief_notes_the_chosen_title(tmp_path):
    ws = _finished_workspace(tmp_path)
    ws.save("shorts-title", {"titles": ["x"] * 20, "pick": "이 영상의 제목"})
    assert "제목: 이 영상의 제목" in build_brief(ws)["idea"]


def test_brief_is_loadable_by_reelforge(tmp_path):
    """두 파이프라인의 접점. 여기가 깨지면 손으로 옮겨 적게 된다."""
    from reelforge.script.brief import load_brief

    target = write_brief(_finished_workspace(tmp_path))
    brief = load_brief(target)
    assert brief.project == "테스트상품"
    assert brief.hook == "설거지 10분 줄었습니다"
    assert brief.captions.keywords == ["무료배송"]


def test_brief_needs_a_script_first(tmp_path):
    ws = Workspace.create("빈것", root=tmp_path)
    with pytest.raises(WorkspaceError, match="대본"):
        write_brief(ws)


# --------------------------------------------------------------------------- #
# 시드 큐
# --------------------------------------------------------------------------- #
def test_queue_take_marks_running_and_survives_reload(tmp_path):
    path = tmp_path / "queue.json"
    queue = SeedQueue(path)
    queue.add(Seed(name="청소기"))
    queue.add(Seed(name="가습기"))
    assert queue.take().name == "청소기"
    queue.save()

    again = SeedQueue(path)
    assert again.seeds[0].status == "running"
    assert again.take().name == "가습기"      # 다음 대기 건으로 넘어간다


def test_queue_does_not_add_the_same_product_twice(tmp_path):
    queue = SeedQueue(tmp_path / "q.json")
    queue.add(Seed(name="청소기"))
    queue.add(Seed(name="청소기", url="https://다름"))
    assert len(queue.seeds) == 1


def test_queue_counts(tmp_path):
    queue = SeedQueue(tmp_path / "q.json")
    queue.add(Seed(name="a"))
    queue.add(Seed(name="b"))
    queue.mark("b", DONE, workspace="work/b")
    counts = queue.counts()
    assert counts[PENDING] == 1 and counts[DONE] == 1
