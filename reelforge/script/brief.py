"""기획 브리프(YAML) 로딩 + 검증.

브리프 한 장이 릴스 한 편의 '입력 전부'다. 촬영 파일 · 기획 의도 · 대본 ·
자막 스타일 · AI 목소리 · 컷 강도를 여기서 다 정한다.
"""

from __future__ import annotations

from dataclasses import dataclass, field, fields
from pathlib import Path
from typing import Any

from ..analyze.fillers import FillerConfig
from ..analyze.planner import CutConfig

ASPECTS = {
    "9:16": (1080, 1920),
    "1:1": (1080, 1080),
    "4:5": (1080, 1350),
    "16:9": (1920, 1080),
}


class BriefError(ValueError):
    pass


@dataclass
class CaptionSpec:
    source: str = "transcript"      # transcript | script | none
    style: str = "reels_bold"
    max_chars: int = 14             # 한 줄 글자 수 (한글 기준)
    max_lines: int = 2
    min_duration: float = 0.7
    max_duration: float = 3.0
    position: float = 0.72          # 화면 세로 위치 0=위 1=아래
    keywords: list[str] = field(default_factory=list)


@dataclass
class NarrationSpec:
    enabled: bool = False
    provider: str = "edge"          # edge | elevenlabs | openai | fish
    voice: str = "ko-KR-SunHiNeural"
    speed: float = 1.0
    mode: str = "mix"               # replace(원본 음소거) | mix | off
    align: str = "sequential"       # sequential(순서대로) | clips(컷 시작에 맞춤)
    gap: float = 0.18               # 문장 사이 쉬는 시간
    original_gain_db: float = -14.0  # mix 일 때 원본 목소리를 깔아두는 크기


@dataclass
class Brief:
    project: str
    footage: list[str] = field(default_factory=list)
    aspect: str = "9:16"
    fps: int = 30
    hook: str = ""
    idea: str = ""
    script: str = ""
    cta: str = ""
    music: str | None = None
    music_gain_db: float = -18.0
    captions: CaptionSpec = field(default_factory=CaptionSpec)
    narration: NarrationSpec = field(default_factory=NarrationSpec)
    cut: CutConfig = field(default_factory=CutConfig)
    filler: FillerConfig = field(default_factory=FillerConfig)
    protect: list[list[float]] = field(default_factory=list)   # [[start, end], ...]
    stt_model: str = "medium"
    language: str = "ko"
    base_dir: Path = field(default_factory=Path)

    # ---------------------------------------------------------------- #
    @property
    def size(self) -> tuple[int, int]:
        if self.aspect not in ASPECTS:
            raise BriefError(f"지원하지 않는 비율: {self.aspect} (가능: {', '.join(ASPECTS)})")
        return ASPECTS[self.aspect]

    @property
    def footage_paths(self) -> list[Path]:
        return [self._resolve(f) for f in self.footage]

    @property
    def music_path(self) -> Path | None:
        return self._resolve(self.music) if self.music else None

    def _resolve(self, value: str) -> Path:
        path = Path(value).expanduser()
        return path if path.is_absolute() else (self.base_dir / path)

    @property
    def stt_prompt(self) -> str:
        """고유명사 인식률을 올리려고 STT 에 미리 던져줄 힌트."""
        parts = [self.hook, self.cta, " ".join(self.captions.keywords)]
        return " ".join(p for p in parts if p).strip()[:220]


def load_brief(path: str | Path) -> Brief:
    path = Path(path)
    if not path.exists():
        raise BriefError(f"브리프 파일이 없습니다: {path}")
    raw = _read_structured(path)
    if not isinstance(raw, dict):
        raise BriefError("브리프 최상단은 매핑(key: value) 이어야 합니다.")
    return from_dict(raw, base_dir=path.parent.resolve())


def from_dict(raw: dict[str, Any], *, base_dir: Path | None = None) -> Brief:
    if "project" not in raw:
        raise BriefError("`project` 는 필수입니다.")

    footage = raw.get("footage") or []
    if isinstance(footage, str):
        footage = [footage]

    brief = Brief(
        project=str(raw["project"]),
        footage=[str(f) for f in footage],
        aspect=str(raw.get("aspect", "9:16")),
        fps=int(raw.get("fps", 30)),
        hook=str(raw.get("hook", "")),
        idea=str(raw.get("idea", "")),
        script=str(raw.get("script", "")),
        cta=str(raw.get("cta", "")),
        music=raw.get("music"),
        music_gain_db=float(raw.get("music_gain_db", -18.0)),
        captions=_build(CaptionSpec, raw.get("captions")),
        narration=_build(NarrationSpec, raw.get("narration")),
        cut=_build(CutConfig, raw.get("cut")),
        filler=_build(FillerConfig, raw.get("filler")),
        protect=[[float(a), float(b)] for a, b in (raw.get("protect") or [])],
        stt_model=str(raw.get("stt_model", "medium")),
        language=str(raw.get("language", "ko")),
        base_dir=base_dir or Path.cwd(),
    )
    # 최상단 keywords 는 자막 강조 키워드로 흘려보낸다
    if raw.get("keywords") and not brief.captions.keywords:
        brief.captions.keywords = [str(k) for k in raw["keywords"]]
    brief.size  # 비율 검증을 여기서 터뜨린다
    return brief


def _build(cls, data: Any):
    if data is None:
        return cls()
    if isinstance(data, bool):        # `narration: true` 같은 축약 허용
        return cls(enabled=data) if "enabled" in {f.name for f in fields(cls)} else cls()
    if not isinstance(data, dict):
        raise BriefError(f"{cls.__name__} 항목은 매핑이어야 합니다: {data!r}")
    known = {f.name for f in fields(cls)}
    unknown = set(data) - known
    if unknown:
        raise BriefError(
            f"{cls.__name__} 에 모르는 항목: {', '.join(sorted(unknown))} (가능: {', '.join(sorted(known))})"
        )
    return cls(**data)


def _read_structured(path: Path) -> Any:
    text = path.read_text(encoding="utf-8")
    if path.suffix.lower() in {".json"}:
        import json

        return json.loads(text)
    try:
        import yaml
    except ImportError as exc:  # pragma: no cover
        raise BriefError(
            "YAML 브리프를 읽으려면 pyyaml 이 필요합니다: pip install pyyaml\n"
            "(또는 브리프를 .json 으로 저장하세요)"
        ) from exc
    return yaml.safe_load(text)
