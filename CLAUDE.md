# 이 저장소에서 일하는 법

쇼핑쇼츠 한 편을 **영상 투입 → 기획 7단계 → 캡컷 프로젝트**까지 자동으로 만드는 곳입니다.

```
inbox/영상.mp4
    │  shortsforge ingest / scan
    ▼
work/<작업폴더>/00_input.yaml
    │  /쇼츠  ← 여기서 7개 서브에이전트가 순서대로 돈다
    ▼
01_product → 02_keywords → 03_rivals → 04_script → 05_titles → 06_caption → 07_comments
    │  shortsforge brief
    ▼
work/<작업폴더>/brief.yaml
    │  reelforge build
    ▼
캡컷 프로젝트 (컷편집 · 자막 · AI 목소리)
```

## 두 개의 파이프라인

| | 무엇 | 입력 → 출력 |
|---|---|---|
| `shortsforge/` | 기획 (앞단) | 영상·상품링크 → 대본·제목·캡션·썸네일·댓글 |
| `reelforge/` | 편집 (뒷단) | 촬영본 + brief.yaml → 캡컷 프로젝트 |

접점은 `work/<작업폴더>/brief.yaml` 한 장뿐입니다. 이 형식을 바꾸면
`shortsforge/brief.py` 와 `reelforge/script/brief.py` 를 같이 고쳐야 합니다.

## 누가 무엇을 소유하는가

- **`prompts/*.md` — 사용자 것.** 8개 하위 프로젝트가 *무엇을 생각할지*.
  절대 여기 내용을 대신 써주거나 고치지 마세요. 사용자가 채웁니다.
  비어 있으면 그 단계에서 멈추고 어느 파일을 채워야 하는지 알리세요.
- **`.claude/agents/*.md` — 배선.** 프롬프트를 읽어 실행하고 결과를 약속된
  JSON 자리에 놓는 껍데기. 여기엔 *어떻게 생각할지* 를 쓰지 않습니다.
- **`shortsforge/` — 계약.** 폴더 구조, 단계 순서, 산출물 검증, 시드 큐.

이 셋의 경계를 흐리지 마세요. 프롬프트 내용이 에이전트 파일로 새면
사용자가 프롬프트를 바꿔도 결과가 안 바뀝니다.

## 단계를 하나 추가·변경할 때

`shortsforge/stages.py` 의 `STAGES` 가 **유일한 진실**입니다.
여기만 고치면 CLI·상태 표시·검증·다음 단계 계산이 전부 따라옵니다.
그다음에 `prompts/` 슬롯 파일과 `.claude/agents/` 배선 파일을 같이 추가하세요.
`tests/test_shortsforge.py::test_pipeline_is_in_dependency_order` 가
순서가 꼬였는지 잡아줍니다.

## 자주 쓰는 명령

```bash
shortsforge scan              # inbox/ 의 새 영상 → 작업 폴더
shortsforge status            # 전체 진행 상황
shortsforge next <이름>       # 다음에 돌릴 에이전트
shortsforge check <이름>      # 산출물 검증
shortsforge prompts           # 프롬프트 슬롯 채움 현황
shortsforge brief <이름>      # reelforge 브리프 생성

/쇼츠 <영상 또는 작업폴더>     # 한 편 끝까지
/쇼츠-무한 [편수]              # 큐에 쌓인 것 연속 제작
/쇼츠-상태                     # 지금 뭘 해야 하나
```

## 테스트

```bash
python -m pytest -q
```

`pycapcut`/`libmediainfo` 가 없는 환경에서는 캡컷 draft 테스트 2개가 실패합니다.
그건 환경 문제입니다. 그 외가 깨지면 손대지 말고 고치세요.

## 쓰는 말

주석과 문서는 한국어. 코드 식별자는 영어.
`.claude/` 와 `prompts/` 안의 지시문도 한국어로 씁니다 — 사용자가 읽고 고치는 파일입니다.
