"""8개 역할의 정의 · 실행 순서 · 산출물 계약.

사용자가 준 역할 번호(`role`)와 실제 실행 순서(`order`)는 다르다.
상품을 분석하기 전에 대본을 쓸 수는 없기 때문이다.

    역할 번호            실행 순서
    1 대본        ->     4
    2 캡션+썸네일 ->     6
    3 키워드 번역 ->     2
    4 상품 분석   ->     1
    5 경쟁 영상   ->     3
    6 댓글        ->     7
    7 제목        ->     5
    8 무한 생성   ->     0 (나머지 전부를 감싸는 오케스트레이터)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

# 프롬프트는 사용자 소유물이다. 이 폴더만 사용자가 관리하고, 나머지는 배선이다.
PROMPT_DIR = Path("prompts")


@dataclass(frozen=True)
class Stage:
    order: int                      # 실행 순서 (0 = 오케스트레이터)
    role: int                       # 사용자가 부여한 역할 번호
    slug: str                       # 에이전트 이름 (.claude/agents/<slug>.md)
    title: str                      # 사람이 읽는 이름
    filename: str                   # work/<slug>/ 안의 산출물 파일명
    prompt: str                     # prompts/ 안의 프롬프트 파일명 (사용자가 채운다)
    needs: tuple[str, ...] = ()     # 먼저 끝나 있어야 하는 단계의 slug
    required: tuple[str, ...] = ()  # 산출물 JSON 의 최상위 필수 키
    summary: str = ""

    @property
    def is_orchestrator(self) -> bool:
        return self.order == 0

    @property
    def prompt_path(self) -> "Path":
        return PROMPT_DIR / self.prompt


# --------------------------------------------------------------------------- #
# 순서대로. 이 리스트가 파이프라인의 유일한 진실이다.
# --------------------------------------------------------------------------- #
STAGES: tuple[Stage, ...] = (
    Stage(
        order=1,
        role=4,
        slug="shorts-product",
        title="상품 분석",
        filename="01_product.json",
        prompt="01-상품분석.md",
        required=("product", "hooks", "objections", "proof"),
        summary="상품 페이지·리뷰에서 팔리는 근거와 반박 포인트를 뽑는다",
    ),
    Stage(
        order=2,
        role=3,
        slug="shorts-keyword",
        title="키워드 번역",
        filename="02_keywords.json",
        prompt="02-키워드번역.md",
        needs=("shorts-product",),
        required=("primary", "search_terms", "hashtags"),
        summary="판매자 언어를 구매자 검색어로 번역하고 해시태그까지 확장한다",
    ),
    Stage(
        order=3,
        role=5,
        slug="shorts-rival",
        title="경쟁 영상 분석",
        filename="03_rivals.json",
        prompt="03-경쟁영상분석.md",
        needs=("shorts-keyword",),
        required=("videos", "patterns", "gaps"),
        summary="같은 키워드 상위 쇼츠의 훅·구성·이탈 구간을 해부한다",
    ),
    Stage(
        order=4,
        role=1,
        slug="shorts-script",
        title="대본",
        filename="04_script.json",
        prompt="04-대본.md",
        needs=("shorts-product", "shorts-rival"),
        required=("hook", "beats", "cta", "duration_sec"),
        summary="0.8초 훅부터 CTA까지, 말로 읽히는 쇼츠 대본을 쓴다",
    ),
    Stage(
        order=5,
        role=7,
        slug="shorts-title",
        title="제목",
        filename="05_titles.json",
        prompt="05-제목.md",
        needs=("shorts-script", "shorts-keyword"),
        required=("titles", "pick"),
        summary="검색에 걸리면서 클릭도 나는 제목 후보를 만들고 하나를 고른다",
    ),
    Stage(
        order=6,
        role=2,
        slug="shorts-caption",
        title="캡션 + 썸네일",
        filename="06_caption.json",
        prompt="06-캡션썸네일.md",
        needs=("shorts-script", "shorts-title"),
        required=("caption", "hashtags", "thumbnail"),
        summary="업로드 캡션과 커버(썸네일) 문구·구도를 만든다",
    ),
    Stage(
        order=7,
        role=6,
        slug="shorts-comment",
        title="댓글",
        filename="07_comments.json",
        prompt="07-댓글.md",
        needs=("shorts-script",),
        required=("pinned", "seeds", "replies"),
        summary="고정댓글·시드댓글·예상 질문 답변을 미리 준비한다",
    ),
    Stage(
        order=0,
        role=8,
        slug="shorts-factory",
        title="콘텐츠 무한 생성",
        filename="08_factory.json",
        prompt="08-무한생성.md",
        required=("seeds",),
        summary="시드 큐를 돌며 위 7단계를 상품마다 반복시킨다",
    ),
)

PIPELINE: tuple[Stage, ...] = tuple(
    sorted((s for s in STAGES if not s.is_orchestrator), key=lambda s: s.order)
)


def stage_by_slug(slug: str) -> Stage:
    for stage in STAGES:
        if stage.slug == slug:
            return stage
    raise KeyError(f"모르는 단계: {slug}")


def stage_by_id(token: str | int) -> Stage:
    """'4', 'role:1', 'shorts-script' 중 아무거나 받아서 단계를 찾는다.

    맨손으로 칠 때 헷갈리는 건 역할 번호와 순서 번호다. 기본은 **순서 번호**,
    `role:` 접두사를 붙이면 역할 번호로 읽는다.
    """
    token = str(token).strip()
    if token.startswith("role:"):
        role = int(token.split(":", 1)[1])
        for stage in STAGES:
            if stage.role == role:
                return stage
        raise KeyError(f"모르는 역할 번호: {role}")
    if token.isdigit():
        order = int(token)
        for stage in STAGES:
            if stage.order == order:
                return stage
        raise KeyError(f"모르는 순서 번호: {order}")
    return stage_by_slug(token)


def missing_dependencies(stage: Stage, done: set[str]) -> list[Stage]:
    """아직 안 끝난 선행 단계들."""
    return [stage_by_slug(slug) for slug in stage.needs if slug not in done]
