"""설치된 캡컷에서 '정답 스키마' 를 배워온다.

draft_content.json 구조는 캡컷 버전마다 조금씩 달라진다. 그래서 버전 값을
코드에 박아두는 대신, 사용자가 캡컷에서 직접 만든 프로젝트 하나를 읽어
버전·플랫폼 값을 그대로 베낀다. 캡컷을 업데이트하면 다시 한 번만 돌리면 된다.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .draft import default_projects_dir


class CalibrationError(RuntimeError):
    pass


def find_latest_draft(projects_dir: str | Path | None = None) -> Path:
    """가장 최근에 수정한 캡컷 프로젝트 폴더."""
    root = Path(projects_dir) if projects_dir else default_projects_dir()
    if not root or not root.exists():
        raise CalibrationError(
            "캡컷 프로젝트 폴더를 찾지 못했습니다.\n"
            "캡컷 > 설정에서 초안(draft) 저장 경로를 확인해 --projects-dir 로 넘겨주세요."
        )
    drafts = [p for p in root.iterdir() if (p / "draft_content.json").exists()]
    if not drafts:
        raise CalibrationError(
            f"{root} 안에 프로젝트가 없습니다.\n"
            "캡컷에서 아무 영상이나 하나 올리고 자막 한 줄 넣은 프로젝트를 저장한 뒤 다시 실행하세요."
        )
    return max(drafts, key=lambda p: (p / "draft_content.json").stat().st_mtime)


def learn(draft_folder: str | Path) -> dict[str, Any]:
    """프로젝트 폴더에서 재사용할 값들을 뽑아낸다."""
    folder = Path(draft_folder)
    content_path = folder / "draft_content.json"
    if not content_path.exists():
        raise CalibrationError(f"draft_content.json 이 없습니다: {folder}")

    content = json.loads(content_path.read_text(encoding="utf-8"))
    template: dict[str, Any] = {
        "source_draft": str(folder),
        "version": content.get("version"),
        "new_version": content.get("new_version"),
        "platform": content.get("platform"),
        "last_modified_platform": content.get("last_modified_platform"),
        "canvas_config": content.get("canvas_config"),
        "fps": content.get("fps"),
    }

    # 자막이 하나라도 있으면 폰트 정보를 베껴온다 (한글 폰트 깨짐 방지)
    texts = (content.get("materials") or {}).get("texts") or []
    if texts:
        sample = texts[0]
        template["font"] = {
            key: sample.get(key)
            for key in ("font_id", "font_name", "font_path", "font_resource_id",
                        "font_title", "font_category_id", "font_category_name")
            if sample.get(key)
        }
    return {k: v for k, v in template.items() if v is not None}


def save(template: dict[str, Any], path: str | Path) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(template, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def load(path: str | Path) -> dict[str, Any] | None:
    path = Path(path)
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def default_template_path() -> Path:
    return Path.home() / ".reelforge" / "capcut_template.json"
