"""EditPlan → 캡컷 프로젝트(draft) 폴더.

캡컷은 프로젝트를 폴더 하나로 저장한다.

    <Projects>/<프로젝트명>/
        draft_content.json     ← 타임라인 전부 (트랙 · 재질 · 자막)
        draft_meta_info.json   ← 프로젝트 목록에 뜨게 하는 메타데이터

여기서 그 두 파일을 직접 만든다. 그래서 결과물이 '렌더된 mp4' 가 아니라
**캡컷에서 열어서 계속 손댈 수 있는 프로젝트**다.

시간 단위는 전부 마이크로초(int).
"""

from __future__ import annotations

import json
import platform
import time
import uuid
from pathlib import Path
from typing import Any

from ...media import MediaError, probe
from ...models import Caption, Clip, EditPlan
from .styles import TextStyle, get_style, hex_to_rgb

US = 1_000_000


def uid() -> str:
    return str(uuid.uuid4()).upper()


def us(seconds: float) -> int:
    return int(round(seconds * US))


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


# --------------------------------------------------------------------------- #
# 재질(material) 만들기
# --------------------------------------------------------------------------- #
def _video_material(path: str, width: int, height: int, duration_us: int, has_audio: bool) -> dict:
    return {
        "id": uid(),
        "type": "video",
        "path": str(Path(path).resolve()),
        "material_name": Path(path).name,
        "material_id": "",
        "duration": duration_us,
        "width": width,
        "height": height,
        "has_audio": has_audio,
        "category_id": "",
        "category_name": "local",
        "check_flag": 63487,
        "crop": {
            "lower_left_x": 0.0, "lower_left_y": 1.0,
            "lower_right_x": 1.0, "lower_right_y": 1.0,
            "upper_left_x": 0.0, "upper_left_y": 0.0,
            "upper_right_x": 1.0, "upper_right_y": 0.0,
        },
        "crop_ratio": "free",
        "crop_scale": 1.0,
        "extra_type_option": 0,
        "is_ai_generate_content": False,
        "is_unified_beauty_mode": False,
        "local_material_id": uid(),
        "media_path": "",
        "reverse_intensified_path": "",
        "reverse_path": "",
        "source": 0,
        "source_platform": 0,
        "stable": {"matrix_path": "", "stable_level": 0, "time_range": {"duration": 0, "start": 0}},
        "team_id": "",
        "video_algorithm": {
            "algorithms": [], "deflicker": None, "motion_blur_config": None,
            "noise_reduction": None, "path": "", "time_range": None,
        },
    }


def _audio_material(path: str, duration_us: int, *, kind: str = "music") -> dict:
    return {
        "id": uid(),
        "type": kind,                       # music / extract_music
        "path": str(Path(path).resolve()),
        "name": Path(path).stem,
        "duration": duration_us,
        "app_id": 0,
        "category_id": "local",
        "category_name": "local",
        "check_flag": 1,
        "effect_id": "",
        "formula_id": "",
        "intensifies_path": "",
        "is_ai_clone_tone": False,
        "is_text_edit_overdub": False,
        "is_ugc": False,
        "local_material_id": uid(),
        "music_id": uid(),
        "query": "",
        "request_id": "",
        "resource_id": "",
        "search_id": "",
        "source_platform": 0,
        "team_id": "",
        "text_id": "",
        "tone_category_id": "",
        "tone_category_name": "",
        "tone_effect_id": "",
        "tone_effect_name": "",
        "tone_speaker": "",
        "tone_type": "",
        "wave_points": [],
    }


def _text_content(caption: Caption, style: TextStyle) -> str:
    """캡컷 텍스트 재질의 `content` 는 JSON **문자열** 이다."""
    text = caption.text
    base = hex_to_rgb(style.color)
    styles: list[dict] = [_range_style(0, len(text), base, style)]

    # 키워드만 다른 색으로 (강조)
    if caption.emphasis:
        accent = hex_to_rgb(style.emphasis_color)
        flat = text
        for word in caption.emphasis:
            start = flat.find(word)
            while start != -1:
                styles.append(_range_style(start, start + len(word), accent, style))
                start = flat.find(word, start + len(word))

    return json.dumps({"text": text, "styles": styles}, ensure_ascii=False)


def _range_style(start: int, end: int, color: list[float], style: TextStyle) -> dict:
    entry: dict[str, Any] = {
        "fill": {
            "alpha": 1.0,
            "content": {
                "render_type": "solid",
                "solid": {"alpha": 1.0, "color": color},
            },
        },
        "range": [start, end],
        "size": style.size,
        "bold": style.bold,
        "italic": False,
        "underline": False,
        "font": {"id": "", "path": ""},
        "useLetterColor": True,
    }
    if style.stroke_color:
        entry["strokes"] = [
            {
                "content": {
                    "render_type": "solid",
                    "solid": {"alpha": 1.0, "color": hex_to_rgb(style.stroke_color)},
                },
                "width": style.stroke_width,
            }
        ]
    return entry


def _text_material(caption: Caption, style: TextStyle) -> dict:
    material = {
        "id": uid(),
        "type": "text",
        "content": _text_content(caption, style),
        "alignment": style.alignment,
        "background_alpha": style.background_alpha if style.background_color else 0.0,
        "background_color": style.background_color or "",
        "background_height": 0.14,
        "background_horizontal_offset": 0.0,
        "background_round_radius": 0.12 if style.background_color else 0.0,
        "background_style": 1 if style.background_color else 0,
        "background_vertical_offset": 0.0,
        "background_width": 0.14,
        "bold_width": 0.0,
        "border_alpha": 1.0,
        "border_color": style.stroke_color or "",
        "border_width": style.stroke_width,
        "check_flag": 7,
        "font_category_id": "",
        "font_category_name": "",
        "font_id": "",
        "font_name": "",
        "font_path": "",
        "font_resource_id": "",
        "font_size": style.size,
        "font_source_platform": 0,
        "font_team_id": "",
        "font_title": "none",
        "font_url": "",
        "fonts": [],
        "force_apply_line_max_width": False,
        "global_alpha": 1.0,
        "group_id": "",
        "has_shadow": style.shadow,
        "initial_scale": 1.0,
        "is_rich_text": False,
        "italic_degree": 0,
        "ktv_color": "",
        "language": "",
        "layer_weight": 1,
        "letter_spacing": style.letter_spacing,
        "line_feed": 1,
        "line_max_width": 0.82,
        "line_spacing": style.line_spacing,
        "multi_language_current": "none",
        "name": "",
        "preset_category": "",
        "preset_category_id": "",
        "preset_has_set_alignment": False,
        "preset_id": "",
        "preset_index": 0,
        "preset_name": "",
        "recognize_task_id": "",
        "recognize_type": 0,
        "relevance_segment": [],
        "shadow_alpha": style.shadow_alpha,
        "shadow_angle": -45.0,
        "shadow_color": "#000000",
        "shadow_distance": 5.0,
        "shadow_point": {"x": 0.6, "y": -0.6},
        "shadow_smoothing": 0.45,
        "shape_clip_x": False,
        "shape_clip_y": False,
        "style_name": style.name,
        "sub_type": 0,
        "text_alpha": 1.0,
        "text_color": style.color,
        "text_curve": None,
        "text_preset_resource_id": "",
        "text_size": 30,
        "text_to_audio_ids": [],
        "tts_auto_update": False,
        "typesetting": 0,
        "underline": False,
        "underline_offset": 0.22,
        "underline_width": 0.05,
        "use_effect_default_color": True,
        "words": {"end_time": [], "start_time": [], "text": []},
    }
    return material


def _speed() -> dict:
    return {"id": uid(), "curve_speed": None, "mode": 0, "speed": 1.0, "type": "speed"}


def _canvas() -> dict:
    return {"id": uid(), "album_image": "", "blur": 0.0, "color": "", "image": "",
            "image_id": "", "image_name": "", "source_platform": 0, "team_id": "",
            "type": "canvas_color"}


def _channel_mapping() -> dict:
    return {"id": uid(), "audio_channel_mapping": 0, "is_config_open": False, "type": ""}


def _vocal_separation() -> dict:
    return {"id": uid(), "choice": 0, "production_path": "", "removed_sounds": [],
            "time_range": None, "type": "vocal_separation"}


def _text_animation(style: TextStyle) -> dict | None:
    """자막 등장 애니메이션. 리소스 id 는 캡컷 버전마다 달라서
    없으면 캡컷이 조용히 무시한다(자막 자체는 정상 표시)."""
    if not style.animation_in:
        return None
    return {
        "id": uid(),
        "type": "sticker_animation",
        "multi_language_current": "none",
        "animations": [
            {
                "anim_adjust_params": None,
                "category_id": "in",
                "category_name": "入场",
                "duration": 300000,
                "id": "624861",
                "material_type": "sticker",
                "name": style.animation_in,
                "panel": "",
                "path": "",
                "platform": "all",
                "resource_id": "624861",
                "start": 0,
                "type": "in",
            }
        ],
    }


# --------------------------------------------------------------------------- #
# 세그먼트
# --------------------------------------------------------------------------- #
def _base_segment(material_id: str, timeline_start: int, duration: int, source_start: int) -> dict:
    return {
        "id": uid(),
        "material_id": material_id,
        "target_timerange": {"start": timeline_start, "duration": duration},
        "source_timerange": {"start": source_start, "duration": duration},
        "extra_material_refs": [],
        "clip": {
            "alpha": 1.0,
            "flip": {"horizontal": False, "vertical": False},
            "rotation": 0.0,
            "scale": {"x": 1.0, "y": 1.0},
            "transform": {"x": 0.0, "y": 0.0},
        },
        "caption_info": None,
        "cartoon": False,
        "common_keyframes": [],
        "enable_adjust": True,
        "enable_color_correct_adjust": False,
        "enable_color_curves": True,
        "enable_color_match_adjust": False,
        "enable_color_wheels": True,
        "enable_lut": True,
        "enable_smart_color_adjust": False,
        "group_id": "",
        "hdr_settings": {"intensity": 1.0, "mode": 1, "nits": 1000},
        "intensifies_audio": False,
        "is_placeholder": False,
        "is_tone_modify": False,
        "keyframe_refs": [],
        "last_nonzero_volume": 1.0,
        "render_index": 0,
        "responsive_layout": {
            "enable": False, "horizontal_pos_layout": 0, "size_layout": 0,
            "target_follow": "", "vertical_pos_layout": 0,
        },
        "reverse": False,
        "speed": 1.0,
        "template_id": "",
        "template_scene": "default",
        "track_attribute": 0,
        "track_render_index": 0,
        "uniform_scale": {"on": True, "value": 1.0},
        "visible": True,
        "volume": 1.0,
    }


def _track(track_type: str, segments: list[dict], *, name: str = "") -> dict:
    return {
        "id": uid(),
        "type": track_type,
        "attribute": 0,
        "flag": 0,
        "is_default_name": not name,
        "name": name,
        "segments": segments,
    }


# --------------------------------------------------------------------------- #
# 본체
# --------------------------------------------------------------------------- #
def build_draft(
    plan: EditPlan,
    *,
    style_name: str | None = None,
    mute_original: bool = False,
    original_gain_db: float = 0.0,
    jump_cut_zoom: float = 0.0,
) -> dict:
    """`EditPlan` 을 draft_content.json 딕셔너리로 만든다.

    jump_cut_zoom  0 보다 크면 컷마다 살짝 번갈아 확대해 점프컷 티를 줄인다
                   (0.03 이면 3% 확대).
    """
    materials: dict[str, list] = {
        "videos": [], "audios": [], "texts": [], "stickers": [],
        "canvases": [], "speeds": [], "sound_channel_mappings": [],
        "vocal_separations": [], "material_animations": [], "transitions": [],
        "video_effects": [], "audio_effects": [], "audio_fades": [],
        "beats": [], "drafts": [], "effects": [], "filters": [], "images": [],
        "loudnesses": [], "manual_deformations": [], "masks": [],
        "placeholders": [], "plugin_effects": [], "realtime_denoises": [],
        "shapes": [], "smart_crops": [], "text_templates": [], "time_marks": [],
        "video_trackings": [], "hsl": [], "green_screens": [], "digital_humans": [],
        "chromas": [], "color_curves": [], "audio_balances": [], "adjusts": [],
        "ai_translates": [], "audio_track_indexes": [], "flowers": [], "log_color_wheels": [],
        "multi_language_refs": [], "primary_color_wheels": [], "tail_leader": [],
        "text_templates_v2": [], "vocal_beautifys": [],
    }

    # ---- 영상 트랙 ---------------------------------------------------- #
    source_materials: dict[str, dict] = {}
    video_segments: list[dict] = []
    for index, clip in enumerate(plan.clips):
        material = source_materials.get(clip.source)
        if material is None:
            info = _safe_probe(clip.source)
            material = _video_material(
                clip.source, info["width"] or plan.width, info["height"] or plan.height,
                us(info["duration"]), info["has_audio"],
            )
            source_materials[clip.source] = material
            materials["videos"].append(material)

        speed, canvas, mapping, vocal = _speed(), _canvas(), _channel_mapping(), _vocal_separation()
        speed["speed"] = clip.speed
        materials["speeds"].append(speed)
        materials["canvases"].append(canvas)
        materials["sound_channel_mappings"].append(mapping)
        materials["vocal_separations"].append(vocal)

        segment = _base_segment(
            material["id"], us(clip.timeline_start), us(clip.duration), us(clip.source_start)
        )
        segment["source_timerange"]["duration"] = us(clip.source_duration)
        segment["speed"] = clip.speed
        segment["extra_material_refs"] = [speed["id"], canvas["id"], mapping["id"], vocal["id"]]
        segment["volume"] = 0.0 if mute_original else _gain_to_volume(original_gain_db)
        segment["last_nonzero_volume"] = segment["volume"] or 1.0
        segment["render_index"] = index

        if jump_cut_zoom and index % 2 == 1:
            zoom = 1.0 + jump_cut_zoom
            segment["clip"]["scale"] = {"x": zoom, "y": zoom}
            segment["uniform_scale"] = {"on": True, "value": zoom}

        video_segments.append(segment)

    # ---- 자막 트랙 ------------------------------------------------------ #
    text_segments: list[dict] = []
    for index, caption in enumerate(plan.captions):
        style = get_style(style_name or caption.style)
        material = _text_material(caption, style)
        materials["texts"].append(material)

        segment = _base_segment(material["id"], us(caption.start), us(caption.duration), 0)
        segment.pop("source_timerange")
        segment["source_timerange"] = None
        segment["render_index"] = 14000 + index
        segment["track_render_index"] = 1
        # y: 화면 위가 +1, 아래가 -1. position 0(위)~1(아래) 을 뒤집어 매핑.
        segment["clip"]["transform"] = {"x": 0.0, "y": round(1.0 - 2.0 * _position(caption), 4)}
        segment["clip"]["scale"] = {"x": style.scale, "y": style.scale}
        segment["uniform_scale"] = {"on": True, "value": style.scale}

        animation = _text_animation(style)
        if animation:
            materials["material_animations"].append(animation)
            segment["extra_material_refs"] = [animation["id"]]
        text_segments.append(segment)

    # ---- 오디오 트랙: AI 나레이션 --------------------------------------- #
    narration_segments: list[dict] = []
    for line in plan.narration:
        if not line.audio_path:
            continue
        material = _audio_material(line.audio_path, us(line.duration), kind="extract_music")
        materials["audios"].append(material)
        mapping, speed = _channel_mapping(), _speed()
        materials["sound_channel_mappings"].append(mapping)
        materials["speeds"].append(speed)
        segment = _base_segment(material["id"], us(line.start), us(line.duration), 0)
        segment["extra_material_refs"] = [speed["id"], mapping["id"]]
        narration_segments.append(segment)

    # ---- 오디오 트랙: 배경음악 ------------------------------------------ #
    music_segments: list[dict] = []
    if plan.music:
        info = _safe_probe(plan.music)
        total = plan.duration
        material = _audio_material(plan.music, us(info["duration"] or total), kind="music")
        materials["audios"].append(material)
        mapping, speed = _channel_mapping(), _speed()
        materials["sound_channel_mappings"].append(mapping)
        materials["speeds"].append(speed)
        segment = _base_segment(material["id"], 0, us(min(total, info["duration"] or total)), 0)
        segment["extra_material_refs"] = [speed["id"], mapping["id"]]
        segment["volume"] = _gain_to_volume(plan.music_gain_db)
        segment["last_nonzero_volume"] = segment["volume"] or 1.0
        music_segments.append(segment)

    tracks = [_track("video", video_segments)]
    if text_segments:
        tracks.append(_track("text", text_segments))
    if narration_segments:
        tracks.append(_track("audio", narration_segments, name="나레이션"))
    if music_segments:
        tracks.append(_track("audio", music_segments, name="BGM"))

    return {
        "id": uid(),
        "canvas_config": {
            "width": plan.width,
            "height": plan.height,
            "ratio": _ratio_name(plan.width, plan.height),
        },
        "color_space": 0,
        "config": {
            "adjust_max_index": 1,
            "attachment_info": [],
            "combination_max_index": 1,
            "export_range": None,
            "extract_audio_last_index": 1,
            "lyrics_recognition_id": "",
            "lyrics_sync": True,
            "lyrics_taskinfo": [],
            "maintrack_adsorb": True,
            "material_save_mode": 0,
            "multi_language_current": "none",
            "multi_language_list": [],
            "multi_language_main": "none",
            "multi_language_mode": "none",
            "original_sound_last_index": 1,
            "record_audio_last_index": 1,
            "sticker_max_index": 1,
            "subtitle_keywords_config": None,
            "subtitle_recognition_id": "",
            "subtitle_sync": True,
            "subtitle_taskinfo": [],
            "system_font_list": [],
            "video_mute": False,
            "zoom_info_params": None,
        },
        "cover": None,
        "create_time": 0,
        "duration": us(plan.duration),
        "extra_info": None,
        "fps": float(plan.fps),
        "free_render_index_mode_on": False,
        "group_container": None,
        "keyframe_graph_list": [],
        "keyframes": {
            "adjusts": [], "audios": [], "effects": [], "filters": [],
            "handwrites": [], "stickers": [], "texts": [], "videos": [],
        },
        "last_modified_platform": _platform_block(),
        "materials": materials,
        "mutable_config": None,
        "name": "",
        "new_version": "110.0.0",
        "platform": _platform_block(),
        "relationships": [],
        "render_index_track_mode_on": True,
        "retouch_cover": None,
        "source": "default",
        "static_cover_image_path": "",
        "time_marks": None,
        "tracks": tracks,
        "update_time": 0,
        "version": 360000,
    }


def _position(caption: Caption) -> float:
    """0(화면 위)~1(화면 아래) 을 캡컷의 y(+1 위 ~ -1 아래) 로 넘기기 전 정리."""
    return min(1.0, max(0.0, float(caption.position)))


def _gain_to_volume(gain_db: float) -> float:
    """dB → 캡컷 volume(1.0 = 원음)."""
    return round(min(2.0, max(0.0, 10 ** (gain_db / 20.0))), 4)


def _ratio_name(width: int, height: int) -> str:
    return {
        (1080, 1920): "9:16", (1080, 1080): "original", (1080, 1350): "4:5",
        (1920, 1080): "16:9",
    }.get((width, height), "original")


def _platform_block() -> dict:
    system = {"Darwin": "mac", "Windows": "windows"}.get(platform.system(), "windows")
    return {
        "app_id": 3704,
        "app_source": "cc",
        "app_version": "5.9.0",
        "device_id": "",
        "hard_disk_id": "",
        "mac_address": "",
        "os": system,
        "os_version": platform.release(),
    }


def _safe_probe(path: str) -> dict:
    try:
        info = probe(path)
        return {
            "duration": info.duration, "width": info.width,
            "height": info.height, "has_audio": info.has_audio,
        }
    except MediaError:
        return {"duration": 0.0, "width": 0, "height": 0, "has_audio": True}


# --------------------------------------------------------------------------- #
def build_meta(plan: EditPlan, folder: Path) -> dict:
    now = int(time.time() * US)
    materials = []
    seen: set[str] = set()
    for clip in plan.clips:
        if clip.source in seen:
            continue
        seen.add(clip.source)
        materials.append(_meta_material(clip.source, "video"))
    for line in plan.narration:
        if line.audio_path and line.audio_path not in seen:
            seen.add(line.audio_path)
            materials.append(_meta_material(line.audio_path, "audio"))
    if plan.music and plan.music not in seen:
        materials.append(_meta_material(plan.music, "audio"))

    return {
        "cloud_package_completed_time": "",
        "draft_cloud_capcut_purchase_info": "",
        "draft_cloud_last_action_download": False,
        "draft_cloud_materials": [],
        "draft_cloud_purchase_info": "",
        "draft_cloud_template_id": "",
        "draft_cloud_tutorial_info": "",
        "draft_cloud_videocut_purchase_info": "",
        "draft_cover": "draft_cover.jpg",
        "draft_deeplink_url": "",
        "draft_enterprise_info": {
            "draft_enterprise_extra": "", "draft_enterprise_id": "",
            "draft_enterprise_name": "", "enterprise_material": None,
        },
        "draft_fold_path": str(folder),
        "draft_id": uid(),
        "draft_is_ai_packaging_used": False,
        "draft_is_ai_shorts": False,
        "draft_is_ai_translate": False,
        "draft_is_article_video_draft": False,
        "draft_is_from_deeplink": "false",
        "draft_is_invisible": False,
        "draft_materials": [
            {"type": 0, "value": materials},
            {"type": 1, "value": []}, {"type": 2, "value": []},
            {"type": 3, "value": []}, {"type": 6, "value": []},
            {"type": 7, "value": []}, {"type": 8, "value": []},
        ],
        "draft_materials_copied_info": [],
        "draft_name": plan.project,
        "draft_new_version": "",
        "draft_removable_storage_device": "",
        "draft_root_path": str(folder.parent),
        "draft_segment_extra_info": [],
        "draft_timeline_materials_size_": 0,
        "draft_type": "",
        "tm_draft_cloud_completed": "",
        "tm_draft_cloud_modified": 0,
        "tm_draft_create": now,
        "tm_draft_modified": now,
        "tm_draft_removed": 0,
        "tm_duration": us(plan.duration),
    }


def _meta_material(path: str, kind: str) -> dict:
    info = _safe_probe(path)
    return {
        "create_time": int(time.time()),
        "duration": us(info["duration"]),
        "extra_info": Path(path).name,
        "file_Path": str(Path(path).resolve()),
        "height": info["height"],
        "id": uid(),
        "import_time": int(time.time()),
        "import_time_ms": int(time.time() * US),
        "item_source": 1,
        "md5": "",
        "metetype": kind,
        "roughcut_time_range": {"duration": us(info["duration"]), "start": 0},
        "sub_time_range": {"duration": -1, "start": -1},
        "type": 0,
        "width": info["width"],
    }


def write_draft(
    plan: EditPlan,
    out_dir: str | Path,
    *,
    style_name: str | None = None,
    mute_original: bool = False,
    original_gain_db: float = 0.0,
    jump_cut_zoom: float = 0.0,
    template: dict | None = None,
) -> Path:
    """draft 폴더를 만들고 두 json 을 쓴다. 폴더 경로를 돌려준다."""
    folder = Path(out_dir) / plan.project
    folder.mkdir(parents=True, exist_ok=True)

    content = build_draft(
        plan,
        style_name=style_name,
        mute_original=mute_original,
        original_gain_db=original_gain_db,
        jump_cut_zoom=jump_cut_zoom,
    )
    if template:
        content = apply_template(content, template)

    (folder / "draft_content.json").write_text(
        json.dumps(content, ensure_ascii=False), encoding="utf-8"
    )
    (folder / "draft_meta_info.json").write_text(
        json.dumps(build_meta(plan, folder), ensure_ascii=False), encoding="utf-8"
    )
    return folder


def apply_template(content: dict, template: dict) -> dict:
    """설치된 캡컷이 실제로 쓰는 버전 값들을 덮어씌운다.

    `reelforge calibrate` 로 뽑아낸 값. 캡컷 버전이 올라가면
    이것만 다시 뽑으면 된다.
    """
    for key in ("version", "new_version", "platform", "last_modified_platform"):
        if key in template:
            content[key] = template[key]
    return content
