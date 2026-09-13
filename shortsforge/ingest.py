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


def looks_like_url(token: str) -> bool:
    return token.startswith(("http://", "https://"))


def looks_like_video(token: str) -> bool:
    return Path(token).expanduser().suffix.lower() in VIDEO_SUFFIXES


def start(
    tokens: list[str],
    *,
    root: Path | None = None,
    category: str = "",
    force: bool = False,
) -> tuple[Workspace, str]:
    """받은 게 무엇이든 작업 폴더 하나로 만든다.

    영상 경로 · 상품 링크 · 상품명 · 이미 있는 폴더 이름을 섞어서 줘도 된다.
    사람은 "이거 링크랑 영상" 이라고 던지지, 인자 순서를 맞춰주지 않는다.

    돌려주는 두 번째 값은 무슨 일이 있었는지 한 줄 설명.
    """
    video = next((t for t in tokens if looks_like_video(t)), "")
    url = next((t for t in tokens if looks_like_url(t) and not looks_like_video(t)), "")
    rest = [t for t in tokens if t not in (video, url)]
    label = " ".join(rest).strip()

    base = root or WORK_ROOT

    # 이미 있는 작업 폴더를 부른 것이라면 이어서 한다.
    if label and (base / slugify(label)).is_dir() and not force:
        ws = Workspace.open(label, root=base)
        if url or video:
            _patch_input(ws, url=url, video=video)
            return ws, f"{ws.name} 이어서 (새 정보 반영)"
        return ws, f"{ws.name} 이어서"

    if video:
        ws = ingest(video, name=label, root=base, product_url=url,
                    category=category, force=force)
        return ws, f"{ws.name} 새로 시작 (영상 + {'링크' if url else '링크 없음'})"

    if not label and url:
        # 링크만 왔다. 이름은 나중에 상품 분석이 제대로 채운다.
        label = url.rstrip("/").split("/")[-1][:40] or "새-상품"

    if not label:
        raise WorkspaceError(
            "영상·상품 링크·상품명 중 하나는 필요합니다.\n"
            "  예: shortsforge start 영상.mp4 https://상품페이지"
        )

    ws = Workspace.create(label, root=base, product_url=url,
                          category=category, force=force)
    return ws, f"{ws.name} 새로 시작 (영상 없이 기획만)"


def _patch_input(ws: Workspace, *, url: str = "", video: str = "") -> None:
    """이미 있는 작업 폴더에 나중에 받은 링크·영상을 끼워넣는다."""
    body = ws.input_path.read_text(encoding="utf-8")
    if url and 'url: ""' in body:
        body = body.replace('url: ""', f'url: "{url}"', 1)
    if video:
        resolved = str(Path(video).expanduser().resolve())
        if 'video: ""' in body:
            body = body.replace('video: ""', f'video: "{resolved}"', 1)
    ws.input_path.write_text(body, encoding="utf-8")
