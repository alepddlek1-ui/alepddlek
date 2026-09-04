"""reelforge 커맨드라인.

    reelforge init 여름신상          새 브리프 만들기
    reelforge doctor                 환경 점검 (ffmpeg / whisper / 캡컷 경로)
    reelforge build brief.yaml       분석 → 컷 → 자막 → AI오디오 → 캡컷 프로젝트
    reelforge render brief.yaml      ffmpeg 미리보기 mp4
    reelforge voices                 쓸 수 있는 TTS 목소리 목록
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

from . import __version__
from .export.capcut.draft import default_projects_dir
from .media import has_ffmpeg
from .models import EditPlan
from .pipeline import build_plan, export_all
from .script.brief import BriefError, load_brief

# 파이프(`| head`)나 파일로 넘길 때는 색 코드를 빼서 로그가 지저분해지지 않게 한다.
_COLOR = sys.stdout.isatty()
GREEN, RED, YELLOW, DIM, RESET = (
    ("\033[32m", "\033[31m", "\033[33m", "\033[2m", "\033[0m")
    if _COLOR
    else ("", "", "", "", "")
)


def log(message: str) -> None:
    print(message, flush=True)


def _ok(text: str) -> str:
    return f"{GREEN}✔{RESET} {text}"


def _bad(text: str) -> str:
    return f"{RED}✘{RESET} {text}"


def _warn(text: str) -> str:
    return f"{YELLOW}!{RESET} {text}"


# --------------------------------------------------------------------------- #
def cmd_init(args) -> int:
    template = Path(__file__).parent / "templates" / "brief.yaml"
    target = Path(args.name if args.name.endswith((".yaml", ".yml")) else f"{args.name}.yaml")
    if target.exists() and not args.force:
        print(_bad(f"{target} 이 이미 있습니다. 덮어쓰려면 --force"))
        return 1
    body = template.read_text(encoding="utf-8").replace("__PROJECT__", target.stem)
    target.write_text(body, encoding="utf-8")
    print(_ok(f"브리프 생성: {target}"))
    print(f"{DIM}  footage: 경로를 채우고  reelforge build {target}{RESET}")
    return 0


def cmd_doctor(args) -> int:
    status = 0
    if has_ffmpeg():
        print(_ok("ffmpeg / ffprobe"))
    else:
        print(_bad("ffmpeg 없음 → brew install ffmpeg / winget install Gyan.FFmpeg"))
        status = 1

    try:
        import faster_whisper  # noqa: F401

        print(_ok("faster-whisper (음성 인식)"))
    except ImportError:
        print(_bad("faster-whisper 없음 → pip install faster-whisper"))
        status = 1

    try:
        import yaml  # noqa: F401

        print(_ok("pyyaml"))
    except ImportError:
        print(_warn("pyyaml 없음 → pip install pyyaml (없으면 .json 브리프만 가능)"))

    try:
        import edge_tts  # noqa: F401

        print(_ok("edge-tts (무료 AI 목소리)"))
    except ImportError:
        print(_warn("edge-tts 없음 → pip install edge-tts"))

    try:
        import pycapcut  # noqa: F401

        print(_ok("pycapcut (캡컷 프로젝트 생성)"))
    except ImportError:
        print(_bad("pycapcut 없음 → pip install pycapcut"))
        status = 1

    try:
        import pymediainfo

        if pymediainfo.MediaInfo.can_parse():
            print(_ok("libmediainfo (pycapcut 이 영상 정보를 읽는 데 씁니다)"))
        else:
            print(_bad(
                "libmediainfo 를 찾지 못했습니다 →\n"
                "  macOS:   brew install libmediainfo\n"
                "  Ubuntu:  sudo apt install libmediainfo0v5\n"
                "  Windows: pymediainfo 휠에 포함되어 있습니다 (pip install -U pymediainfo)"
            ))
            status = 1
    except ImportError:
        print(_warn("pymediainfo 없음 → pycapcut 을 설치하면 같이 깔립니다"))

    projects = default_projects_dir()
    if projects:
        print(_ok(f"캡컷 프로젝트 폴더: {projects}"))
    else:
        print(_warn("캡컷 프로젝트 폴더를 못 찾음 → build 시 --projects-dir 로 지정하세요"))

    return status


def cmd_build(args) -> int:
    try:
        brief = load_brief(args.brief)
    except BriefError as exc:
        print(_bad(str(exc)))
        return 1

    work_dir = Path(args.work_dir or Path(args.brief).parent / ".reelforge" / brief.project)
    out_dir = Path(args.out or Path(args.brief).parent / "out" / brief.project)

    print(f"{DIM}프로젝트{RESET} {brief.project}  {brief.aspect}  {brief.fps}fps")
    plan = build_plan(brief, work_dir, log=log, reuse=not args.no_cache)

    meta = plan.meta
    print(
        f"\n{GREEN}컷 요약{RESET}  원본 {meta['original_duration']:.1f}s → "
        f"편집 {plan.duration:.1f}s  ({meta['cut_seconds']:.1f}s 제거, 클립 {len(plan.clips)}개)"
    )
    _print_removed(plan, limit=args.show_cuts)

    results = export_all(
        plan, brief, out_dir,
        projects_dir=args.projects_dir,
        jump_cut_zoom=args.jump_cut_zoom,
        log=log,
    )
    print(f"\n{GREEN}완료{RESET}")
    for key, value in results.items():
        print(f"  {key:8} {value}")
    print(f"\n{DIM}캡컷을 완전히 종료했다 다시 켜면 목록에 '{brief.project}' 가 뜹니다.{RESET}")
    return 0


def _print_removed(plan: EditPlan, limit: int) -> None:
    if limit <= 0 or not plan.removed:
        return
    print(f"{DIM}잘라낸 구간 (상위 {limit}개){RESET}")
    ranked = sorted(plan.removed, key=lambda s: -s.duration)[:limit]
    for span in ranked:
        print(f"  {span.start:7.2f} → {span.end:7.2f}  ({span.duration:4.2f}s)  {span.detail or span.reason}")


def cmd_export(args) -> int:
    """웹 편집기 등에서 손본 plan.json → 캡컷 프로젝트 다시 만들기."""
    from .export.capcut.draft import write_draft
    from .export.srt import write_srt

    plan = EditPlan.load(args.plan)
    target = Path(args.projects_dir) if args.projects_dir else (
        default_projects_dir() or Path(args.plan).parent / "capcut"
    )
    folder = write_draft(
        plan, target,
        style_name=args.style,
        mute_original=args.mute_original,
        jump_cut_zoom=args.jump_cut_zoom,
    )
    print(_ok(f"캡컷 프로젝트: {folder}"))
    if plan.captions:
        srt = write_srt(plan.captions, Path(args.plan).parent / f"{plan.project}.srt")
        print(_ok(f"자막: {srt}"))
    print(f"  클립 {len(plan.clips)}개 · 자막 {len(plan.captions)}장 · {plan.duration:.1f}s")
    print(f"\n{DIM}캡컷을 완전히 종료했다 다시 켜면 목록에 뜹니다.{RESET}")
    return 0


def cmd_render(args) -> int:
    from .export.render import render_preview

    if not args.plan and not args.brief:
        print(_bad("브리프 파일이나 --plan 중 하나는 있어야 합니다."))
        return 1

    plan_path = Path(args.plan) if args.plan else None
    if plan_path is None:
        try:
            brief = load_brief(args.brief)
        except BriefError as exc:
            print(_bad(str(exc)))
            return 1
        work_dir = Path(args.brief).parent / ".reelforge" / brief.project
        plan = build_plan(brief, work_dir, log=log)
    else:
        plan = EditPlan.load(plan_path)

    out = args.out or f"{plan.project}_preview.mp4"
    srt = Path(out).with_suffix(".srt")
    if args.burn and plan.captions:
        from .export.srt import write_srt

        write_srt(plan.captions, srt)
    result = render_preview(
        plan, out,
        burn_srt=srt if (args.burn and plan.captions) else None,
        dry_run=args.dry_run,
    )
    print(result if args.dry_run else _ok(f"미리보기: {result}"))
    return 0


def cmd_voices(args) -> int:
    from .tts import available_providers

    print(f"{DIM}공급자{RESET} " + ", ".join(available_providers()))
    print(f"\n{DIM}한국어 추천 (edge, 키 불필요){RESET}")
    for voice, note in [
        ("ko-KR-SunHiNeural", "여성 · 밝고 또렷함 · 정보형 릴스 기본값"),
        ("ko-KR-InJoonNeural", "남성 · 차분함 · 브랜드/설명형"),
        ("ko-KR-HyunsuMultilingualNeural", "남성 · 자연스러움 · 한영 혼용"),
    ]:
        print(f"  {voice:36} {note}")
    if shutil.which("edge-tts"):
        print(f"\n{DIM}전체 목록: edge-tts --list-voices | grep ko-KR{RESET}")
    print(f"\n{DIM}elevenlabs/openai/fish 는 각각 API 키 환경변수가 필요합니다 (reelforge doctor 참고){RESET}")
    return 0


# --------------------------------------------------------------------------- #
def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="reelforge",
        description="촬영본 + 기획 브리프 → 컷편집·자막·AI오디오가 얹힌 캡컷 프로젝트",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--version", action="version", version=f"reelforge {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("init", help="새 브리프 파일 만들기")
    p.add_argument("name", help="프로젝트 이름 (예: 여름신상)")
    p.add_argument("--force", action="store_true")
    p.set_defaults(func=cmd_init)

    p = sub.add_parser("doctor", help="환경 점검")
    p.set_defaults(func=cmd_doctor)

    p = sub.add_parser("build", help="브리프 → 캡컷 프로젝트")
    p.add_argument("brief")
    p.add_argument("--out", help="산출물 폴더")
    p.add_argument("--work-dir", help="캐시 폴더")
    p.add_argument("--projects-dir", help="캡컷 프로젝트 폴더 (미지정 시 자동 탐지)")
    p.add_argument("--no-cache", action="store_true", help="전사 캐시 무시하고 다시 분석")
    p.add_argument("--jump-cut-zoom", type=float, default=0.0,
                   help="점프컷 완화용 교대 확대 비율 (예: 0.03)")
    p.add_argument("--show-cuts", type=int, default=8, help="잘라낸 구간 출력 개수")
    p.set_defaults(func=cmd_build)

    p = sub.add_parser("export", help="손본 plan.json → 캡컷 프로젝트 다시 만들기")
    p.add_argument("plan", help="plan.json 경로 (웹 편집기에서 받은 파일도 됩니다)")
    p.add_argument("--projects-dir", help="캡컷 프로젝트 폴더")
    p.add_argument("--style", help="자막 스타일을 통째로 덮어쓰기")
    p.add_argument("--mute-original", action="store_true", help="원본 오디오 음소거")
    p.add_argument("--jump-cut-zoom", type=float, default=0.0)
    p.set_defaults(func=cmd_export)

    p = sub.add_parser("render", help="ffmpeg 미리보기 mp4")
    p.add_argument("brief", nargs="?")
    p.add_argument("--plan", help="이미 만든 plan.json 사용")
    p.add_argument("--out")
    p.add_argument("--burn", action="store_true", help="자막을 영상에 태워서 렌더")
    p.add_argument("--dry-run", action="store_true", help="ffmpeg 명령만 출력")
    p.set_defaults(func=cmd_render)

    p = sub.add_parser("voices", help="TTS 공급자 / 목소리")
    p.set_defaults(func=cmd_voices)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except KeyboardInterrupt:
        print("\n중단됨")
        return 130
    except BrokenPipeError:
        # `reelforge voices | head` 처럼 받는 쪽이 먼저 닫은 경우. 정상 종료로 본다.
        try:
            sys.stdout.close()
        except BrokenPipeError:
            pass
        return 0
    except Exception as exc:  # 사용자에게는 스택트레이스 대신 한 줄로
        if "--debug" in (argv or sys.argv):
            raise
        print(_bad(str(exc)), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
