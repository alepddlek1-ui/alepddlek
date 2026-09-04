"""브리프 하나 → 캡컷 프로젝트 하나.

    load_brief → 분석(무음/전사) → 컷 결정 → 자막 → AI 오디오 → EditPlan
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from .analyze.planner import build_cuts, to_clips
from .analyze.silence import detect_silence
from .analyze.transcribe import load_transcript, save_transcript, transcribe
from .export.srt import write_srt
from .media import extract_audio, probe
from .models import Caption, Clip, EditPlan, NarrationLine, Span, Utterance
from .script.brief import Brief
from .script.captions import (
    captions_from_timed_lines,
    captions_from_utterances,
    split_script,
)
from .tts import synth_narration

Log = Callable[[str], None]


def _noop(_: str) -> None:
    pass


@dataclass
class SourceAnalysis:
    path: str
    duration: float
    width: int
    height: int
    utterances: list[Utterance]
    silences: list[Span]
    keep: list[Span]
    removed: list[Span]


def analyze_source(
    path: Path,
    brief: Brief,
    work_dir: Path,
    *,
    log: Log = _noop,
    reuse: bool = True,
) -> SourceAnalysis:
    """영상 한 개를 분석한다. 전사 결과는 캐시된다."""
    info = probe(path)
    log(f"  · {path.name}  {info.width}x{info.height}  {info.duration:.1f}s")

    stem = path.stem
    wav = work_dir / f"{stem}.16k.wav"
    if not (reuse and wav.exists()):
        extract_audio(path, wav)

    silences = detect_silence(wav, total_duration=info.duration)
    log(f"    무음 {len(silences)}곳")

    cache = work_dir / f"{stem}.transcript.json"
    if reuse and cache.exists():
        utterances = load_transcript(cache)
        log(f"    전사 캐시 사용 ({len(utterances)}문장)")
    else:
        log(f"    전사 중… (모델 {brief.stt_model})")
        utterances = transcribe(
            wav,
            model=brief.stt_model,
            language=brief.language,
            initial_prompt=brief.stt_prompt or None,
        )
        # 캐시 쓰기는 여기서 책임진다 (전사가 파이프라인에서 제일 느린 단계)
        save_transcript(utterances, cache)
        log(f"    전사 완료 ({len(utterances)}문장)")

    protect = [Span(a, b, "protect") for a, b in brief.protect]
    keep, removed = build_cuts(
        duration=info.duration,
        silences=silences,
        utterances=utterances,
        cut_config=brief.cut,
        filler_config=brief.filler,
        protect=protect,
    )
    cut_total = sum(r.duration for r in removed)
    log(f"    컷 {len(removed)}개 / {cut_total:.1f}s 제거 → {sum(k.duration for k in keep):.1f}s 남음")
    return SourceAnalysis(
        path=str(path), duration=info.duration, width=info.width, height=info.height,
        utterances=utterances, silences=silences, keep=keep, removed=removed,
    )


def build_plan(
    brief: Brief,
    work_dir: str | Path,
    *,
    log: Log = _noop,
    reuse: bool = True,
) -> EditPlan:
    """브리프 → EditPlan."""
    work_dir = Path(work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)

    footage = brief.footage_paths
    if not footage:
        raise ValueError("브리프에 `footage` 가 없습니다.")

    width, height = brief.size
    plan = EditPlan(
        project=brief.project, width=width, height=height, fps=brief.fps,
        music=str(brief.music_path) if brief.music_path else None,
        music_gain_db=brief.music_gain_db,
    )

    # 1) 영상별 분석 + 컷 -------------------------------------------------- #
    log("분석")
    cursor = 0.0
    analyses: list[SourceAnalysis] = []
    clips_by_source: dict[str, list[Clip]] = {}
    for path in footage:
        analysis = analyze_source(path, brief, work_dir, log=log, reuse=reuse)
        clips = to_clips(analysis.path, analysis.keep, start_at=cursor)
        clips_by_source[analysis.path] = clips
        plan.clips += clips
        plan.removed += [
            Span(r.start, r.end, r.reason, f"{path.name}: {r.detail}", analysis.path)
            for r in analysis.removed
        ]
        cursor = clips[-1].timeline_end if clips else cursor
        analyses.append(analysis)

    if not plan.clips:
        raise ValueError(
            "남는 구간이 없습니다. 컷이 너무 공격적입니다 — 브리프의 cut.max_pause 를 키우거나 "
            "silence 임계값을 낮춰보세요."
        )

    # 2) AI 나레이션 -------------------------------------------------------- #
    if brief.narration.enabled and brief.narration.mode != "off":
        lines = split_script(brief.script)
        if not lines:
            log("나레이션: 대본(`script`)이 비어 있어 건너뜁니다.")
        else:
            log(f"AI 오디오 생성 ({brief.narration.provider} / {brief.narration.voice}, {len(lines)}줄)")
            plan.narration = synth_narration(
                lines,
                provider=brief.narration.provider,
                voice=brief.narration.voice,
                speed=brief.narration.speed,
                gap=brief.narration.gap,
                out_dir=work_dir / "tts",
            )
            if brief.narration.align == "clips":
                plan.narration = _align_to_clips(plan.narration, plan.clips)
            total = plan.narration[-1].end if plan.narration else 0.0
            video_total = sum(c.duration for c in plan.clips)
            log(f"    나레이션 {total:.1f}s / 영상 {video_total:.1f}s")
            if abs(total - video_total) > 1.5:
                log(
                    f"    ⚠ 길이 차이 {abs(total - video_total):.1f}s — "
                    "캡컷에서 클립 길이를 늘리거나 대본을 조절하세요."
                )

    # 3) 자막 --------------------------------------------------------------- #
    source = brief.captions.source
    if source == "transcript":
        for analysis in analyses:
            plan.captions += captions_from_utterances(
                analysis.utterances, clips_by_source[analysis.path], analysis.path, brief.captions
            )
    elif source == "script":
        timed = [(n.text, n.start, n.end) for n in plan.narration]
        if not timed:
            timed = _spread_script(split_script(brief.script), sum(c.duration for c in plan.clips))
        plan.captions = captions_from_timed_lines(timed, brief.captions)
    elif source != "none":
        raise ValueError(f"captions.source 는 transcript/script/none 중 하나여야 합니다: {source}")

    # 훅 문구는 맨 앞 1.8초에 따로 얹는다
    if brief.hook:
        plan.captions.insert(
            0,
            Caption(
                brief.hook, 0.0, min(1.8, plan.duration or 1.8),
                brief.captions.style,
                position=brief.captions.overlay_position, layer="overlay",
            ),
        )
    if brief.cta:
        end = plan.duration
        plan.captions.append(
            Caption(
                brief.cta, max(0.0, end - 1.6), end,
                brief.captions.style,
                position=brief.captions.overlay_position, layer="overlay",
            )
        )
    log(f"자막 {len(plan.captions)}장")

    plan.meta = {
        "brief": brief.project,
        "hook": brief.hook,
        "idea": brief.idea,
        "sources": [a.path for a in analyses],
        "original_duration": round(sum(a.duration for a in analyses), 2),
        "cut_seconds": round(sum(r.duration for r in plan.removed), 2),
        "narration_mode": brief.narration.mode if brief.narration.enabled else "off",
    }
    return plan


def _align_to_clips(narration: list[NarrationLine], clips: list[Clip]) -> list[NarrationLine]:
    """나레이션 각 줄을 컷 시작 지점에 맞춘다 (B롤에 얹을 때)."""
    aligned: list[NarrationLine] = []
    cursor = 0.0
    for index, line in enumerate(narration):
        start = clips[index].timeline_start if index < len(clips) else cursor
        start = max(start, cursor)
        aligned.append(
            NarrationLine(line.text, round(start, 3), line.audio_path, line.duration, line.voice)
        )
        cursor = start + line.duration + 0.12
    return aligned


def _spread_script(lines: list[str], total: float) -> list[tuple[str, float, float]]:
    """TTS 없이 대본만 있을 때, 글자 수 비례로 시간에 흩뿌린다."""
    if not lines or total <= 0:
        return []
    weights = [max(1, len(line)) for line in lines]
    unit = total / sum(weights)
    out, cursor = [], 0.0
    for line, weight in zip(lines, weights):
        span = weight * unit
        out.append((line, cursor, cursor + span))
        cursor += span
    return out


def export_all(
    plan: EditPlan,
    brief: Brief,
    out_dir: str | Path,
    *,
    projects_dir: str | Path | None = None,
    jump_cut_zoom: float = 0.0,
    log: Log = _noop,
) -> dict[str, str]:
    """EditPlan → 캡컷 draft + SRT + plan.json."""
    from .export.capcut.draft import default_projects_dir, write_draft

    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    results: dict[str, str] = {}

    results["plan"] = str(plan.save(out_dir / "plan.json"))
    if plan.captions:
        results["srt"] = str(write_srt(plan.captions, out_dir / f"{plan.project}.srt"))

    target = Path(projects_dir) if projects_dir else (default_projects_dir() or out_dir / "capcut")
    folder = write_draft(
        plan,
        target,
        mute_original=brief.narration.enabled and brief.narration.mode == "replace",
        original_gain_db=(
            brief.narration.original_gain_db
            if brief.narration.enabled and brief.narration.mode == "mix"
            else 0.0
        ),
        jump_cut_zoom=jump_cut_zoom,
    )
    results["capcut"] = str(folder)
    log(f"캡컷 프로젝트: {folder}")
    return results
