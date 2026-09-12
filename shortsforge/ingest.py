"""영상 한 개 → 작업 폴더 한 개.

파이프라인의 방아쇠. 영상을 던지면 여기서 작업 폴더가 생기고,
그 뒤로는 에이전트들이 순서대로 굴러간다.

영상은 **복사하지 않는다.** 경로만 적어둔다. 쇼츠 소재가 몇백 MB 씩 되는데
작업 폴더마다 복사본을 만들면 디스크가 먼저 죽는다.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from pathlib import Path

from .workspace import Workspace, WorkspaceError, slugify

VIDEO_SUFFIXES = {".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi"}


@dataclass
class Probe:
    duration: float = 0.0
    width: int = 0
    height: int = 0

    @property
    def size(self) -> str:
        return f"{self.width}x{self.height}" if self.width and self.height else ""


def probe_video(path: Path) -> Probe:
    """ffprobe 가 있으면 읽고, 없으면 빈 값으로 넘어간다.

    길이·해상도는 '있으면 좋은' 정보다. 이것 때문에 파이프라인 전체가
    멈추면 안 된다.
    """
    try:
        from reelforge.media import probe as _probe  # 무거운 import 를 늦춘다

        info = _probe(path)
        return Probe(duration=round(info.duration, 2), width=info.width, height=info.height)
    except Exception:
        return Probe()


def ingest(
    video: str | Path,
    *,
    name: str = "",
    root: Path | None = None,
    product_url: str = "",
    category: str = "",
    force: bool = False,
) -> Workspace:
    video_path = Path(video).expanduser()
    if not video_path.is_file():
        raise WorkspaceError(f"영상 파일이 없습니다: {video_path}")
    if video_path.suffix.lower() not in VIDEO_SUFFIXES:
        raise WorkspaceError(
            f"영상 파일이 아닌 것 같습니다: {video_path.name} "
            f"(가능: {', '.join(sorted(VIDEO_SUFFIXES))})"
        )

    label = name or video_path.stem
    info = probe_video(video_path)
    return Workspace.create(
        label,
        root=root,
        product_url=product_url,
        category=category,
        force=force,
        extra={
            "__VIDEO__": str(video_path.resolve()),
            "__DURATION__": f"{info.duration or 0}",
            "__SIZE__": info.size,
        },
    )


def find_new_videos(inbox: Path, root: Path) -> list[Path]:
    """inbox 안에서 아직 작업 폴더가 없는 영상들."""
    if not inbox.is_dir():
        return []
    taken = {p.name for p in root.iterdir()} if root.is_dir() else set()
    return sorted(
        p
        for p in inbox.iterdir()
        if p.is_file() and p.suffix.lower() in VIDEO_SUFFIXES and slugify(p.stem) not in taken
    )
