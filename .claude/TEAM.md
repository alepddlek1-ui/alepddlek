# 쇼핑쇼츠 부서 규정

이 저장소에는 유튜브 쇼츠·인스타 릴스 쇼핑 콘텐츠를 만드는 **일곱 자리**가 세팅되어 있다.
직원은 `.claude/skills/` 의 스킬(일하는 방법)과 `.claude/agents/` 의 에이전트(부르는 이름)로 이루어진다.

## 조직도

```
                    shorts-master  (총괄 PD — 지시 · 검수 · 승인)
                           │
   ┌───────────┬───────────┼───────────┬───────────┬───────────┐
researcher  analyst     writer      titler    marketer    pipeline
 검색어      후킹·분해    20초 대본    제목 5개   업로드 문구   다음 소재
```

## 채널 규격 (전 직원 공통)

| 항목 | 값 |
|---|---|
| 화자 | 35세 여성, 기혼, 1살 아기 육아맘. 털털하고 쾌활 |
| 카테고리 | 생활용품 · 살림템 · 테크 · 주방용품 · 차량용품 · 계절상품 |
| 상품 조건 | 남녀노소 누구나 쓰는 물건 |
| 영상 길이 | **20초** (대본 공백 제외 90~105자) |
| 자막 | 한 줄 14자, 2줄 이내 |
| 제목 | 15~20자, 궁금증 중심 |
| 썸네일 문구 | 6~12자 (제목 앞줄) |
| 해시태그 | 10개 (대형2 · 중형4 · 소형3 · 시리즈1), 유튜브엔 3개 |

## 공통 규정 (두 문서는 전 직원이 따른다)

- **페르소나** `.claude/skills/shopping-shorts-writer/references/persona.md` — 말투 사전, 가족 고정 캐릭터 7인
- **과장 금지·표시 규정** `.claude/skills/shopping-shorts-writer/references/compliance.md` — 금지 표현 치환표, 유료광고 표시, 레퍼런스 사용 선

이 두 문서와 충돌하는 지시는 따르지 않는다. 잘 나간 레퍼런스 영상의 표현이어도 여기가 위다.

## 자리별 요약

| 자리 | 에이전트 | 스킬 | 받는 것 → 내는 것 |
|---|---|---|---|
| 총괄 | `shorts-master` | `shopping-shorts-master` | 제품·대본 → 공정 운영 · 검수표 · 발행 패키지 |
| 리서치 | `shorts-researcher` | `shopping-shorts-researcher` | 사진·제품명 → 샤오홍슈 5 · TikTok 5 · 국내 검색어 |
| 분석 | `shorts-analyst` | `shopping-shorts-analyst` | 사진 / 레퍼런스 영상 → 후킹 8개 / 조회수 이유 + 20초 비트 초안 |
| 대본 | `shorts-writer` | `shopping-shorts-writer` | 사진·특징·레퍼런스 대본 → 20초 대본 + brief.yaml |
| 제목 | `shorts-titler` | `shopping-shorts-titler` | 대본 → 제목 5개 + 썸네일 앞줄 |
| 마케팅 | `shorts-marketer` | `shopping-shorts-marketer` | 대본·제목 → 썸네일 3 · 캡션 · 해시태그 10 · 댓글 3 |
| 소재 | `shorts-pipeline` | `shopping-shorts-pipeline` | 현재 상품 → 비슷한 제품 3 · 연관 5 · 시리즈 5 |

## 공정

```
0 접수 → 1 리서치 ∥ 분석 → 2 (레퍼런스) 분해 → 3 대본 → 4 제목 → 5 마케팅 → 6 소재 → 7 최종 검수
```

- **1단계는 병렬** — 리서치와 분석은 서로 입력이 필요 없다.
- **3 → 4 → 5 는 직렬** — 제목은 대본에서, 썸네일 문구는 제목에서 나온다. 순서를 어기면 정합이 깨진다.
- 단계마다 게이트가 있고, 통과 근거를 숫자로 검수표에 남긴다.

## 산출물 경로

```
work/<날짜>-<제품>/
  00_work-order.md   작업지시서 (마스터)
  01_research.md     리서치
  02_analysis.md     분석
  03_script.md       대본
  04_titles.md       제목
  05_marketing.md    마케팅
  06_pipeline.md     소재
  07_qa.md           검수표 (마스터)
  08_release.md      발행 패키지 (최종)
  brief.yaml         reelforge 브리프
  script.txt         자수 계산용 대본 평문
  titles.txt         자수 계산용 제목 평문
```

폴더 생성: `scripts/new-episode.sh <제품명>`

## 일 시키는 방법

| 하고 싶은 것 | 방법 |
|---|---|
| 한 편 전체 | `/shorts <제품명>` (제품 사진을 같이 첨부) |
| 검수만 | `/shorts-qa <폴더명>` |
| 한 자리만 | 그 자리 스킬을 부른다 — 예: `/shopping-shorts-titler` |
| 사람이 직접 | `.claude/skills/<스킬>/SKILL.md` 를 읽고 그대로 따라 한다 |

## 편집으로 넘기기

발행 패키지가 승인되면 촬영 → 브리프의 `footage` 채우기 → 편집.

```bash
reelforge build work/<날짜>-<제품>/brief.yaml
```

캡컷은 완전히 종료했다 다시 켜야 새 프로젝트가 목록에 뜬다.
