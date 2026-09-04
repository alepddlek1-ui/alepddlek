"""ffmpeg 미리보기 렌더.

캡컷을 열기 전에 '컷이 제대로 잡혔나' 를 30초 만에 확인하는 용도.
최종 납품본은 캡컷에서 뽑는 걸 전제로 한다.
"""

from __future__ import annotations

import shlex
from pathlib import Path

from ..media import _require, run
from ..models import EditPlan


def build_filter_complex(plan: EditPlan, *, with_audio: bool = True) -> tuple[list[str], str, str]:
    """(입력 인자, filter_complex 문자열, 최종 라벨) 을 만든다."""
    sources: list[str] = []
    for clip in plan.clips:
        if clip.source not in sources:
            sources.append(clip.source)

    parts: list[str] = []
    video_labels: list[str] = []
    audio_labels: list[str] = []

    for index, clip in enumerate(plan.clips):
        src = sources.index(clip.source)
        vlabel, alabel = f"v{index}", f"a{index}"
        parts.append(
            f"[{src}:v]trim=start={clip.source_start:.3f}:end={clip.source_end:.3f},"
            f"setpts=PTS-STARTPTS,"
            f"scale={plan.width}:{plan.height}:force_original_aspect_ratio=increase,"
            f"crop={plan.width}:{plan.height},fps={plan.fps},format=yuv420p[{vlabel}]"
        )
        video_labels.append(f"[{vlabel}]")
        if with_audio:
            parts.append(
                f"[{src}:a]atrim=start={clip.source_start:.3f}:end={clip.source_end:.3f},"
                f"asetpts=PTS-STARTPTS,aresample=48000[{alabel}]"
            )
            audio_labels.append(f"[{alabel}]")

    n = len(plan.clips)
    if with_audio:
        parts.append("".join(a + b for a, b in zip(video_labels, audio_labels)) + f"concat=n={n}:v=1:a=1[vout][aout]")
        final = "[vout]"
        final_audio = "[aout]"
    else:
        parts.append("".join(video_labels) + f"concat=n={n}:v=1:a=0[vout]")
        final, final_audio = "[vout]", ""

    inputs: list[str] = []
    for source in sources:
        inputs += ["-i", source]
    return inputs, ";".join(parts), final + final_audio


def render_preview(
    plan: EditPlan,
    out_path: str | Path,
    *,
    burn_srt: str | Path | None = None,
    with_audio: bool = True,
    crf: int = 23,
    dry_run: bool = False,
) -> str:
    """컷 적용본을 mp4 로 뽑는다. `dry_run` 이면 명령만 돌려준다."""
    if not plan.clips:
        raise ValueError("컷이 하나도 없습니다. 먼저 plan 을 만드세요.")

    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    inputs, filters, _ = build_filter_complex(plan, with_audio=with_audio)

    if burn_srt:
        escaped = str(burn_srt).replace("\\", "/").replace(":", r"\:")
        filters += f";[vout]subtitles='{escaped}':force_style='Fontsize=18,Outline=2'[vsub]"
        vmap = "[vsub]"
    else:
        vmap = "[vout]"

    cmd = ["ffmpeg", "-y", *inputs, "-filter_complex", filters, "-map", vmap]
    if with_audio:
        cmd += ["-map", "[aout]", "-c:a", "aac", "-b:a", "192k"]
    cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", str(crf), str(out_path)]

    if dry_run:
        return " ".join(shlex.quote(c) for c in cmd)

    cmd[0] = _require("ffmpeg")
    run(cmd, capture=False)
    return str(out_path)
