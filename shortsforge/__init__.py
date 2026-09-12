"""shortsforge — 쇼핑쇼츠 기획 파이프라인.

reelforge 가 '촬영본 → 캡컷 프로젝트' 를 담당한다면,
shortsforge 는 그 앞단인 '상품 링크 → 대본·제목·캡션·썸네일·댓글' 을 담당한다.

실제 생각은 Claude Code 의 서브에이전트(.claude/agents/*.md)가 하고,
이 패키지는 그 사이에서 **작업 폴더·산출물 계약(JSON)·진행 상태**를 관리한다.
사람이 손으로 관리하면 8단계짜리 파이프라인은 3편만 돌려도 무너진다.
"""

__version__ = "0.1.0"

from .stages import STAGES, Stage, stage_by_id, stage_by_slug  # noqa: F401
