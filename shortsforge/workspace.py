"""작업 폴더 하나 = 쇼츠 한 편.

    work/<슬러그>/
        00_input.yaml     사람이 채우는 입력 (상품 링크 · 톤 · 길이)
        01_product.json   ~ 07_comments.json   에이전트 산출물
        brief.yaml        reelforge 로 넘어가는 최종 브리프

상태 파일을 따로 두지 않는다. **파일이 있으면 끝난 단계**다.
상태와 실제가 어긋나는 사고를 원천적으로 없애려는 것.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from .stages import PIPELINE, Stage, stage_by_slug

WORK_ROOT = Path("work")
INPUT_FILE = "00_input.yaml"


class WorkspaceError(RuntimeError):
    pass


def slugify(name: str) -> str:
    """한글 상품명도 폴더 이름으로 쓸 수 있게 다듬는다.

    한글은 그대로 둔다. 폴더 이름에 한글이 들어가는 게 파일 탐색기에서
    훨씬 읽기 쉽고, 요즘 도구 중에 이걸 못 견디는 건 거의 없다.
    """
    cleaned = re.sub(r"[^\w가-힣-]+", "-", name.strip(), flags=re.UNICODE)
    cleaned = re.sub(r"-{2,}", "-", cleaned).strip("-")
    return cleaned or "untitled"


@dataclass
class Workspace:
    root: Path

    # ----------------------------------------------------------------- #
    @classmethod
    def create(
        cls,
        name: str,
        *,
        root: Path | None = None,
        product_url: str = "",
        category: str = "",
        force: bool = False,
        extra: dict[str, str] | None = None,
    ) -> "Workspace":
        base = root or WORK_ROOT
        ws = cls(base / slugify(name))
        if ws.root.exists() and not force:
            raise WorkspaceError(f"{ws.root} 이 이미 있습니다. 덮어쓰려면 --force")
        ws.root.mkdir(parents=True, exist_ok=True)

        fields = {
            "__NAME__": name,
            "__URL__": product_url,
            "__CATEGORY__": category,
            "__DATE__": date.today().isoformat(),
            "__VIDEO__": "",
            "__DURATION__": "0",
            "__SIZE__": "",
            **(extra or {}),
        }
        template = Path(__file__).parent / "templates" / "input.yaml"
        body = template.read_text(encoding="utf-8")
        for token, value in fields.items():
            body = body.replace(token, value)
        ws.input_path.write_text(body, encoding="utf-8")
        return ws

    @classmethod
    def open(cls, name: str, *, root: Path | None = None) -> "Workspace":
        base = root or WORK_ROOT
        ws = cls(base / slugify(name))
        if not ws.root.is_dir():
            raise WorkspaceError(f"{ws.root} 이 없습니다. 먼저 shortsforge init {name}")
        return ws

    # ----------------------------------------------------------------- #
    @property
    def name(self) -> str:
        return self.root.name

    @property
    def input_path(self) -> Path:
        return self.root / INPUT_FILE

    def path_for(self, stage: Stage | str) -> Path:
        stage = stage if isinstance(stage, Stage) else stage_by_slug(stage)
        return self.root / stage.filename

    def is_done(self, stage: Stage | str) -> bool:
        return self.path_for(stage).is_file()

    def done_slugs(self) -> set[str]:
        return {s.slug for s in PIPELINE if self.is_done(s)}

    def load(self, stage: Stage | str) -> dict:
        path = self.path_for(stage)
        if not path.is_file():
            raise WorkspaceError(f"{path} 이 아직 없습니다")
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise WorkspaceError(f"{path} 이 올바른 JSON 이 아닙니다: {exc}") from exc

    def save(self, stage: Stage | str, payload: dict) -> Path:
        path = self.path_for(stage)
        path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        return path

    def next_stage(self) -> Stage | None:
        """아직 안 끝났고, 선행 단계가 전부 끝난 첫 단계."""
        done = self.done_slugs()
        for stage in PIPELINE:
            if stage.slug in done:
                continue
            if all(dep in done for dep in stage.needs):
                return stage
        return None
