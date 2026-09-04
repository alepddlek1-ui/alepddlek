"""EditPlan → 캡컷 프로젝트(draft) 폴더.

타임라인 조립은 **pycapcut** 이 맡는다. 캡컷의 draft 스키마는 버전마다 바뀌는데,
그 추적을 직접 하는 대신 라이브러리에 맡기고 우리는 '무엇을 어디에 놓을지'만 정한다.

두 군데는 pycapcut 이 채워주지 않아 우리가 뒤에서 손본다.

1. `draft_meta_info.json` — pycapcut 이 복사해 넣는 템플릿은 프로젝트 이름과
   경로가 비어 있고 **draft_id 가 모든 draft 에 똑같다.** 그대로 두면 캡컷
   목록에서 프로젝트끼리 서로 가린다.
2. 키워드 강조 — pycapcut 의 텍스트는 글자 범위별 색을 지원하지 않는다.
   자막 전체가 한 색이 되므로, 저장된 JSON 에 강조 범위를 얹는다.
3. 끊어진 참조 — pycapcut 0.0.3 은 자막 세그먼트에 speed 소재의 id 를
   적어놓고 정작 그 소재를 materials 에 넣지 않는다. 어디에도 없는 것을
   가리키는 참조라 걷어낸다.
"""

from __future__ import annotations

import json
import platform
import time
import uuid
from pathlib import Path
from typing import Any

from dataclasses import replace

from ...models import Caption, EditPlan
from .styles import TextStyle, get_style, hex_to_rgb, intro_animation, to_pycapcut

US = 1_000_000


class DraftError(RuntimeError):
    pass


def _pycapcut():
    try:
        import pycapcut

        return pycapcut
    except ImportError as exc:  # pragma: no cover - 환경 의존
        raise DraftError(
            "pycapcut 이 설치되어 있지 않습니다.\n"
            "  pip install pycapcut\n"
            "(영상 정보를 읽는 libmediainfo 도 필요합니다 — reelforge doctor 참고)"
        ) from exc


def us(seconds: float) -> int:
    return int(round(seconds * US))


def uid() -> str:
    return str(uuid.uuid4()).upper()


# --------------------------------------------------------------------------- #
# 캡컷 프로젝트 폴더 위치
# --------------------------------------------------------------------------- #
def default_projects_dir() -> Path | None:
    """설치된 캡컷의 프로젝트 폴더를 추정한다. 못 찾으면 None."""
    home = Path.home()
    candidates: list[Path] = []
    system = platform.system()
    if system == "Darwin":
        candidates += [
            home / "Movies/CapCut/User Data/Projects/com.lveditor.draft",
            home / "Movies/JianyingPro/User Data/Projects/com.lveditor.draft",
        ]
    elif system == "Windows":
        import os

        local = Path(os.environ.get("LOCALAPPDATA", home / "AppData/Local"))
        candidates += [
            local / "CapCut/User Data/Projects/com.lveditor.draft",
            local / "JianyingPro/User Data/Projects/com.lveditor.draft",
        ]
    else:
        candidates += [home / "CapCut/User Data/Projects/com.lveditor.draft"]
    return next((c for c in candidates if c.exists()), None)


def _gain_to_volume(gain_db: float) -> float:
    """dB → 캡컷 volume (1.0 = 원음)."""
    return round(min(2.0, max(0.0, 10 ** (gain_db / 20.0))), 4)


def _ratio_name(width: int, height: int) -> str:
    return {
        (1080, 1920): "9:16", (1080, 1080): "original",
        (1080, 1350): "4:5", (1920, 1080): "16:9",
    }.get((width, height), "original")


# --------------------------------------------------------------------------- #
# 타임라인 조립
# --------------------------------------------------------------------------- #
CAPTION_TRACK = "자막"
OVERLAY_TRACK = "훅·CTA"
NARRATION_TRACK = "나레이션"
MUSIC_TRACK = "BGM"


def build_script(
    plan: EditPlan,
    *,
    style_name: str | None = None,
    mute_original: bool = False,
    original_gain_db: float = 0.0,
    jump_cut_zoom: float = 0.0,
):
    """`EditPlan` 을 pycapcut `ScriptFile` 로 만든다.

    jump_cut_zoom  0 보다 크면 컷마다 번갈아 살짝 확대해 점프컷 티를 줄인다
                   (0.03 이면 3% 확대).
    """
    pc = _pycapcut()
    if not plan.clips:
        raise DraftError("클립이 하나도 없습니다.")

    script = pc.ScriptFile(plan.width, plan.height, plan.fps)
    script.add_track(pc.TrackType.video)

    # ── 영상 ──────────────────────────────────────────────────────────── #
    materials: dict[str, Any] = {}
    volume = 0.0 if mute_original else _gain_to_volume(original_gain_db)
    for index, clip in enumerate(plan.clips):
        material = materials.get(clip.source)
        if material is None:
            material = pc.VideoMaterial(clip.source)
            materials[clip.source] = material

        clip_settings = None
        if jump_cut_zoom and index % 2 == 1:
            zoom = 1.0 + jump_cut_zoom
            clip_settings = pc.ClipSettings(scale_x=zoom, scale_y=zoom)

        segment = pc.VideoSegment(
            material,
            pc.Timerange(us(clip.timeline_start), us(clip.duration)),
            source_timerange=pc.Timerange(us(clip.source_start), us(clip.source_duration)),
            speed=clip.speed if clip.speed != 1.0 else None,
            volume=volume,
            clip_settings=clip_settings,
        )
        script.add_segment(segment)

    # ── 자막 ──────────────────────────────────────────────────────────── #
    for track_name, group in caption_groups(plan):
        script.add_track(pc.TrackType.text, track_name)
        for caption in group:
            script.add_segment(_text_segment(pc, caption, style_name), track_name)

    # ── AI 나레이션 ───────────────────────────────────────────────────── #
    narration = [line for line in plan.narration if line.audio_path]
    if narration:
        script.add_track(pc.TrackType.audio, NARRATION_TRACK)
        for line in narration:
            script.add_segment(
                pc.AudioSegment(
                    line.audio_path,
                    pc.Timerange(us(line.start), us(line.duration)),
                ),
                NARRATION_TRACK,
            )

    # ── 배경음악 ──────────────────────────────────────────────────────── #
    if plan.music:
        script.add_track(pc.TrackType.audio, MUSIC_TRACK)
        music = pc.AudioMaterial(plan.music)
        length = min(us(plan.duration), music.duration) or music.duration
        script.add_segment(
            pc.AudioSegment(
                music,
                pc.Timerange(0, length),
                source_timerange=pc.Timerange(0, length),
                volume=_gain_to_volume(plan.music_gain_db),
            ),
            MUSIC_TRACK,
        )

    return script


def caption_groups(plan: EditPlan) -> list[tuple[str, list[Caption]]]:
    """자막을 트랙별로 나눈다.

    훅·CTA 는 말자막 위에 얹는 문구라 같은 트랙에 두면 겹친다.

    **이 함수가 자막 순서의 유일한 기준이다.** 저장 뒤 강조 색을 얹을 때도
    같은 순서를 써야 엉뚱한 자막에 색이 들어가지 않는다.
    """
    groups = [
        (CAPTION_TRACK, _no_overlap([c for c in plan.captions if c.layer != "overlay"])),
        (OVERLAY_TRACK, _no_overlap([c for c in plan.captions if c.layer == "overlay"])),
    ]
    return [(name, group) for name, group in groups if group]


def ordered_captions(plan: EditPlan) -> list[Caption]:
    """실제로 draft 에 쓰이는 순서대로 펼친 자막 목록."""
    return [caption for _, group in caption_groups(plan) for caption in group]


def _no_overlap(captions: list[Caption]) -> list[Caption]:
    """한 트랙 안에서 자막이 겹치지 않게 뒤쪽을 잘라낸다.

    캡컷은 한 트랙에 겹치는 세그먼트를 허용하지 않는다. 웹 편집대에서 시각을
    손으로 고치면 얼마든지 겹칠 수 있으므로, 내보내기 직전에 정리한다.
    """
    ordered = sorted(captions, key=lambda c: (c.start, c.end))
    out: list[Caption] = []
    for caption in ordered:
        start = max(0.0, caption.start)
        end = caption.end
        if out and start < out[-1].end:
            start = out[-1].end
        if end - start < 0.05:
            continue
        trimmed = replace(caption, start=round(start, 3), end=round(end, 3))
        out.append(trimmed)
    return out


def _text_segment(pc, caption: Caption, style_name: str | None):
    style = get_style(style_name or caption.style)
    text_style, border, background = to_pycapcut(style)

    # position 0(화면 위)~1(화면 아래) → 캡컷 y(+1 위 ~ -1 아래)
    position = min(1.0, max(0.0, float(caption.position)))
    segment = pc.TextSegment(
        caption.text,
        pc.Timerange(us(caption.start), us(caption.duration)),
        style=text_style,
        border=border,
        background=background,
        clip_settings=pc.ClipSettings(
            transform_y=round(1.0 - 2.0 * position, 4),
            scale_x=style.scale,
            scale_y=style.scale,
        ),
    )
    animation = intro_animation(style)
    if animation is not None:
        # 자막이 아주 짧으면 등장 애니메이션이 자막보다 길어질 수 있다
        duration = min(style.animation_ms, max(0.1, caption.duration * 0.4))
        segment.add_animation(animation, f"{duration}s")
    return segment


# --------------------------------------------------------------------------- #
# 저장 + 뒷정리
# --------------------------------------------------------------------------- #
def write_draft(
    plan: EditPlan,
    out_dir: str | Path,
    *,
    style_name: str | None = None,
    mute_original: bool = False,
    original_gain_db: float = 0.0,
    jump_cut_zoom: float = 0.0,
) -> Path:
    """draft 폴더를 만들고 두 json 을 쓴다. 폴더 경로를 돌려준다."""
    pc = _pycapcut()
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    script = build_script(
        plan,
        style_name=style_name,
        mute_original=mute_original,
        original_gain_db=original_gain_db,
        jump_cut_zoom=jump_cut_zoom,
    )

    folder = pc.DraftFolder(str(out_dir))
    # create_draft 는 빈 ScriptFile 을 새로 만들지만, 우리는 위에서 조립한
    # script 를 그대로 쓴다. 필요한 건 폴더와 meta 템플릿뿐.
    placeholder = folder.create_draft(plan.project, plan.width, plan.height, plan.fps,
                                      allow_replace=True)
    script.save_path = placeholder.save_path
    script.save()

    draft_dir = Path(placeholder.save_path).parent
    _fix_meta(draft_dir, plan)
    _finalize_content(draft_dir / "draft_content.json", plan, style_name)
    return draft_dir


def _fix_meta(draft_dir: Path, plan: EditPlan) -> None:
    """pycapcut 이 복사해둔 meta 템플릿에 이 프로젝트의 정보를 채운다.

    특히 draft_id: 템플릿에 고정값이 박혀 있어 그대로 두면 프로젝트마다
    같은 id 를 갖게 되고, 캡컷 목록에서 서로 가린다.
    """
    path = draft_dir / "draft_meta_info.json"
    if not path.exists():
        return
    meta = json.loads(path.read_text(encoding="utf-8"))
    now = int(time.time() * US)
    meta.update({
        "draft_id": uid(),
        "draft_name": plan.project,
        "draft_fold_path": str(draft_dir),
        "draft_root_path": str(draft_dir.parent),
        "tm_draft_create": now,
        "tm_draft_modified": now,
        "tm_duration": us(plan.duration),
    })
    path.write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")


def _finalize_content(content_path: Path, plan: EditPlan, style_name: str | None) -> None:
    """저장된 draft_content.json 을 한 번 읽어 손볼 곳을 다 손보고 다시 쓴다."""
    if not content_path.exists():
        return
    data = json.loads(content_path.read_text(encoding="utf-8"))
    changed = _apply_emphasis(data, plan, style_name)
    changed |= _prune_dangling_refs(data)
    # pycapcut 은 비율을 늘 "original" 로 적는다. 캡컷 UI 가 9:16 으로 뜨도록 채운다.
    canvas = data.get("canvas_config")
    if canvas and canvas.get("ratio") != _ratio_name(plan.width, plan.height):
        canvas["ratio"] = _ratio_name(plan.width, plan.height)
        changed = True
    if changed:
        content_path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


def _prune_dangling_refs(data: dict) -> bool:
    """어느 소재도 가리키지 않는 참조를 걷어낸다.

    pycapcut 0.0.3 은 자막 세그먼트의 extra_material_refs 에 speed 소재의
    id 를 넣지만 그 소재를 materials 에 등록하지 않는다. 끊어진 참조가 있으면
    캡컷이 프로젝트를 못 열 수 있다.
    """
    known = {
        material["id"]
        for bucket in data.get("materials", {}).values()
        if isinstance(bucket, list)
        for material in bucket
        if isinstance(material, dict) and "id" in material
    }
    changed = False
    for track in data.get("tracks", []):
        for segment in track.get("segments", []):
            refs = segment.get("extra_material_refs")
            if not refs:
                continue
            alive = [ref for ref in refs if ref in known]
            if len(alive) != len(refs):
                segment["extra_material_refs"] = alive
                changed = True
    return changed


def _apply_emphasis(data: dict, plan: EditPlan, style_name: str | None) -> bool:
    """키워드에 다른 색을 입힌다.

    pycapcut 의 텍스트는 글자 범위별 스타일을 지원하지 않아, 저장된 뒤에
    `content` 안의 styles 배열에 강조 범위를 덧붙인다.
    """
    captions = ordered_captions(plan)
    if not any(c.emphasis for c in captions):
        return False

    texts = data.get("materials", {}).get("texts", [])
    if len(texts) != len(captions):
        return False      # 순서를 확신할 수 없으면 손대지 않는다

    changed = False
    for material, caption in zip(texts, captions):
        if not caption.emphasis:
            continue
        try:
            content = json.loads(material["content"])
        except (KeyError, ValueError):
            continue
        base = content.get("styles", [])
        if not base:
            continue
        style = get_style(style_name or caption.style)
        accent = list(hex_to_rgb(style.emphasis_color))
        for word in caption.emphasis:
            for start in _find_all(content.get("text", ""), word):
                highlight = json.loads(json.dumps(base[0]))
                highlight["range"] = [start, start + len(word)]
                highlight["fill"]["content"]["solid"]["color"] = accent
                base.append(highlight)
                changed = True
        content["styles"] = base
        material["content"] = json.dumps(content, ensure_ascii=False)

    return changed


def _find_all(haystack: str, needle: str) -> list[int]:
    if not needle:
        return []
    out, at = [], haystack.find(needle)
    while at != -1:
        out.append(at)
        at = haystack.find(needle, at + len(needle))
    return out
