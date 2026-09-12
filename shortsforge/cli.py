"""shortsforge 커맨드라인.

거의 이 셋만 씁니다:

    shortsforge                 지금 상황 (인자 없이)
    shortsforge scan            inbox/ 의 새 영상 → 작업 폴더
    shortsforge brief 이름      reelforge 브리프 생성

나머지는 에이전트가 알아서 부르거나, 가끔 손으로 확인할 때 씁니다:
`ingest` `init` `status` `next` `check` `prompts` `prompt` `queue` `stages`.
실제 제작은 클로드 코드에서 `/쇼츠` 로 합니다.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import __version__
from .brief import write_brief
from .ingest import find_new_videos, ingest
from .queue import DONE, FAILED, PENDING, Seed, SeedQueue
from .prompts import PromptError, is_empty, read_slot, resolve
from .schema import blocking_only, validate, warnings_only
from .stages import PIPELINE, STAGES, stage_by_id
from .workspace import Workspace, WorkspaceError, WORK_ROOT

_COLOR = sys.stdout.isatty()
GREEN, RED, YELLOW, DIM, RESET = (
    ("\033[32m", "\033[31m", "\033[33m", "\033[2m", "\033[0m")
    if _COLOR
    else ("", "", "", "", "")
)


def _ok(text: str) -> str:
    return f"{GREEN}✔{RESET} {text}"


def _bad(text: str) -> str:
    return f"{RED}✘{RESET} {text}"


def _warn(text: str) -> str:
    return f"{YELLOW}!{RESET} {text}"


def _wait(text: str) -> str:
    return f"{DIM}·{RESET} {text}"


# --------------------------------------------------------------------------- #
def cmd_init(args) -> int:
    try:
        ws = Workspace.create(
            args.name,
            root=Path(args.root),
            product_url=args.url or "",
            category=args.category or "",
            force=args.force,
        )
    except WorkspaceError as exc:
        print(_bad(str(exc)))
        return 1
    print(_ok(f"작업 폴더: {ws.root}"))
    print(f"{DIM}  1) {ws.input_path} 를 채우고{RESET}")
    print(f"{DIM}  2) 클로드 코드에서:  /쇼츠 {ws.name}{RESET}")
    return 0


def _status_one(ws: Workspace) -> None:
    print(f"\n{ws.name}")
    done = ws.done_slugs()
    for stage in PIPELINE:
        label = f"{stage.order}. {stage.title} ({stage.slug})"
        if stage.slug in done:
            problems = validate(stage, ws.load(stage))
            stops, notes = blocking_only(problems), warnings_only(problems)
            if stops:
                print("  " + _bad(f"{label} — 다시 만들어야 함 {len(stops)}건"))
            elif notes:
                print("  " + _warn(f"{label} — 아쉬운 곳 {len(notes)}군데"))
            else:
                print("  " + _ok(label))
        elif all(dep in done for dep in stage.needs):
            print("  " + _wait(f"{label}  ← 다음 차례"))
        else:
            waiting = ", ".join(d for d in stage.needs if d not in done)
            print("  " + _wait(f"{label}  (대기: {waiting})"))


def cmd_status(args) -> int:
    root = Path(args.root)
    if args.name:
        try:
            _status_one(Workspace.open(args.name, root=root))
        except WorkspaceError as exc:
            print(_bad(str(exc)))
            return 1
        return 0

    if not root.is_dir():
        print(_bad(f"{root} 가 없습니다. shortsforge init 으로 시작하세요"))
        return 1
    folders = sorted(p for p in root.iterdir() if p.is_dir())
    if not folders:
        print(_bad("작업 폴더가 없습니다"))
        return 1
    for folder in folders:
        _status_one(Workspace(folder))
    return 0


def cmd_next(args) -> int:
    try:
        ws = Workspace.open(args.name, root=Path(args.root))
    except WorkspaceError as exc:
        print(_bad(str(exc)))
        return 1
    stage = ws.next_stage()
    if stage is None:
        print(_ok(f"{ws.name}: 7단계 전부 끝났습니다 → shortsforge brief {ws.name}"))
        return 0
    inputs = [str(ws.path_for(dep)) for dep in stage.needs] or [str(ws.input_path)]
    print(f"{stage.order}. {stage.title}")
    print(f"  에이전트: {stage.slug}")
    print(f"  입력:     {', '.join(inputs)}")
    print(f"  출력:     {ws.path_for(stage)}")
    return 0


def cmd_check(args) -> int:
    try:
        ws = Workspace.open(args.name, root=Path(args.root))
    except WorkspaceError as exc:
        print(_bad(str(exc)))
        return 1

    stages = [stage_by_id(args.stage)] if args.stage else list(PIPELINE)
    blocked = 0
    for stage in stages:
        if not ws.is_done(stage):
            if args.stage:
                print(_bad(f"{stage.filename} 이 아직 없습니다"))
                blocked += 1
            continue
        try:
            problems = validate(stage, ws.load(stage))
        except WorkspaceError as exc:
            print(_bad(str(exc)))
            blocked += 1
            continue

        stops = blocking_only(problems)
        notes = warnings_only(problems)
        if stops:
            blocked += 1
            print(_bad(stage.title))
        elif notes:
            print(_warn(f"{stage.title} — 쓸 수 있지만 아쉬운 곳 {len(notes)}군데"))
        else:
            print(_ok(stage.title))
        for problem in stops:
            print(f"    {problem}")
        for problem in notes:
            print(f"{DIM}    {problem}{RESET}")

    # 경고는 종료 코드를 더럽히지 않는다. 멈출 이유가 아니기 때문.
    return 1 if blocked else 0


def cmd_brief(args) -> int:
    try:
        ws = Workspace.open(args.name, root=Path(args.root))
        target = write_brief(ws)
    except WorkspaceError as exc:
        print(_bad(str(exc)))
        return 1
    print(_ok(f"브리프 생성: {target}"))
    print(f"{DIM}  촬영본 경로를 footage 에 채우고:  reelforge build {target}{RESET}")
    return 0


def cmd_stages(args) -> int:
    print(f"{DIM}순서  역할  에이전트{RESET}")
    for stage in sorted(STAGES, key=lambda s: (s.order == 0, s.order)):
        order = "—" if stage.is_orchestrator else str(stage.order)
        print(f"  {order:>2}    {stage.role}    {stage.slug:<16} {stage.title} — {stage.summary}")
    return 0


def cmd_ingest(args) -> int:
    try:
        ws = ingest(
            args.video,
            name=args.name or "",
            root=Path(args.root),
            product_url=args.url or "",
            category=args.category or "",
            force=args.force,
        )
    except WorkspaceError as exc:
        print(_bad(str(exc)))
        return 1
    print(_ok(f"작업 폴더: {ws.root}"))
    print(f"{DIM}  다음:  클로드 코드에서  /쇼츠 {ws.name}{RESET}")
    return 0


def cmd_scan(args) -> int:
    """inbox/ 에 새로 들어온 영상을 전부 작업 폴더로 만든다."""
    root = Path(args.root)
    found = find_new_videos(Path(args.inbox), root)
    if not found:
        print(_wait(f"{args.inbox} 에 새 영상이 없습니다"))
        return 0
    for video in found:
        try:
            ws = ingest(video, root=root)
        except WorkspaceError as exc:
            print(_bad(str(exc)))
            continue
        print(_ok(f"{video.name} → {ws.root}"))
    return 0


def cmd_prompts(args) -> int:
    """어느 슬롯이 채워졌고 어느 슬롯이 비었는지."""
    missing = 0
    for stage in sorted(STAGES, key=lambda s: (s.is_orchestrator, s.order)):
        try:
            body = read_slot(stage)
        except PromptError as exc:
            print(_bad(str(exc)))
            missing += 1
            continue
        if is_empty(body):
            missing += 1
            print(_bad(f"{stage.title:<12} 비어 있음  {stage.prompt_path}"))
        else:
            lines = len([l for l in body.splitlines() if l.strip()])
            print(_ok(f"{stage.title:<12} {lines}줄        {stage.prompt_path}"))
    if missing:
        print(f"{DIM}  빈 슬롯 {missing}개 — 채우기 전에는 그 단계에서 멈춥니다{RESET}")
    return 1 if missing else 0


def cmd_prompt(args) -> int:
    """에이전트가 자기 지시문을 받아가는 통로."""
    stage = stage_by_id(args.stage)
    try:
        ws = Workspace.open(args.name, root=Path(args.root))
        print(resolve(stage, ws))
    except (WorkspaceError, PromptError) as exc:
        print(_bad(str(exc)), file=sys.stderr)
        return 1
    return 0


# --------------------------------------------------------------------------- #
def cmd_queue(args) -> int:
    queue = SeedQueue(Path(args.file) if args.file else None)

    if args.action == "add":
        if not args.name:
            print(_bad("추가할 상품 이름이 필요합니다"))
            return 1
        seed = queue.add(Seed(name=args.name, url=args.url or "", category=args.category or ""))
        queue.save()
        print(_ok(f"큐에 추가: {seed.name} ({seed.status})"))
    elif args.action == "list":
        if not queue.seeds:
            print(_wait("큐가 비어 있습니다"))
            return 0
        for seed in queue.seeds:
            mark = {PENDING: _wait, DONE: _ok, FAILED: _bad}.get(seed.status, _wait)
            print(mark(f"{seed.name:<24} {seed.status:<8} {seed.workspace or '-'}"))
        counts = queue.counts()
        print(f"{DIM}  대기 {counts[PENDING]} · 진행 {counts['running']} · 완료 {counts[DONE]} · 실패 {counts[FAILED]}{RESET}")
    elif args.action == "take":
        seed = queue.take()
        if seed is None:
            print(_wait("대기 중인 시드가 없습니다"))
            return 1
        queue.save()
        print(seed.name)          # 스크립트가 그대로 받아쓸 수 있게 이름만
    elif args.action == "mark":
        if not args.name or not args.status:
            print(_bad("--name 과 --status 가 필요합니다"))
            return 1
        try:
            seed = queue.mark(args.name, args.status, workspace=args.workspace or "")
        except KeyError as exc:
            print(_bad(str(exc)))
            return 1
        queue.save()
        print(_ok(f"{seed.name} → {seed.status}"))
    return 0


# --------------------------------------------------------------------------- #
def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="shortsforge", description="쇼핑쇼츠 기획 파이프라인")
    parser.add_argument("--version", action="version", version=f"shortsforge {__version__}")
    parser.add_argument("--root", default=str(WORK_ROOT), help="작업 폴더 루트 (기본: work)")
    # 인자 없이 치면 상태를 보여준다. 제일 자주 궁금한 게 그거라서.
    sub = parser.add_subparsers(dest="command", required=False)

    p = sub.add_parser("init", help="새 쇼츠 작업 폴더 만들기")
    p.add_argument("name")
    p.add_argument("--url", help="상품 상세 페이지 주소")
    p.add_argument("--category")
    p.add_argument("--force", action="store_true")
    p.set_defaults(func=cmd_init)

    p = sub.add_parser("ingest", help="영상 투입 → 작업 폴더 생성")
    p.add_argument("video")
    p.add_argument("--name", help="작업 폴더 이름 (기본: 파일 이름)")
    p.add_argument("--url", help="상품 상세 페이지 주소")
    p.add_argument("--category")
    p.add_argument("--force", action="store_true")
    p.set_defaults(func=cmd_ingest)

    p = sub.add_parser("scan", help="inbox/ 의 새 영상 전부 투입")
    p.add_argument("--inbox", default="inbox")
    p.set_defaults(func=cmd_scan)

    p = sub.add_parser("prompts", help="프롬프트 슬롯 현황")
    p.set_defaults(func=cmd_prompts)

    p = sub.add_parser("prompt", help="완성된 프롬프트 출력 (에이전트용)")
    p.add_argument("stage", help="순서 번호 · role:역할번호 · 에이전트 이름")
    p.add_argument("--name", required=True, help="작업 폴더 이름")
    p.set_defaults(func=cmd_prompt)

    p = sub.add_parser("status", help="진행 상황")
    p.add_argument("name", nargs="?")
    p.set_defaults(func=cmd_status)

    p = sub.add_parser("next", help="다음에 돌릴 에이전트")
    p.add_argument("name")
    p.set_defaults(func=cmd_next)

    p = sub.add_parser("check", help="산출물 검증")
    p.add_argument("name")
    p.add_argument("--stage", help="순서 번호 · role:역할번호 · 에이전트 이름")
    p.set_defaults(func=cmd_check)

    p = sub.add_parser("brief", help="reelforge 브리프 생성")
    p.add_argument("name")
    p.set_defaults(func=cmd_brief)

    p = sub.add_parser("stages", help="단계 목록")
    p.set_defaults(func=cmd_stages)

    p = sub.add_parser("queue", help="무한 생성 시드 큐")
    p.add_argument("action", choices=["add", "list", "take", "mark"])
    p.add_argument("name", nargs="?")
    p.add_argument("--url")
    p.add_argument("--category")
    p.add_argument("--status", choices=[PENDING, "running", DONE, FAILED])
    p.add_argument("--workspace")
    p.add_argument("--file", help="큐 파일 경로 (기본: work/queue.json)")
    p.set_defaults(func=cmd_queue)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if not getattr(args, "func", None):
        args.name = None
        return cmd_status(args)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
