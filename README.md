# reelforge

촬영한 영상 + 기획 브리프를 넣으면 **버벅거리는 구간을 잘라내고, 자막을 달고, AI 목소리를 얹은 캡컷 프로젝트**를 만들어 줍니다.

결과물은 렌더링된 mp4가 아니라 **캡컷에서 열어 계속 손볼 수 있는 프로젝트 파일**입니다. 자동화가 90%를 해놓고, 감각이 필요한 10%는 평소처럼 캡컷에서 다듬는 구조입니다.

```
촬영본.mp4  +  brief.yaml
        │
        ├─ 무음 탐지        ffmpeg silencedetect
        ├─ 음성 인식        faster-whisper (단어별 타임스탬프)
        ├─ 버벅임 탐지      필러("음/어/그") · 말더듬 · 죽은 시간 · 재촬영(NG)
        ├─ 컷 결정          숨 쉴 틈은 남기고 나머지를 제거
        ├─ 자막 생성        컷된 타임라인 기준으로 재배치 + 키워드 강조
        └─ AI 오디오        대본 → TTS → 트랙에 배치
        │
        ▼
캡컷 프로젝트 (pycapcut 으로 조립) + SRT + plan.json
```

---

## 30초 요약

```bash
pip install -e ".[all]"

reelforge doctor                  # 환경 점검
reelforge init 여름신상            # 브리프 생성 → footage 경로만 채우면 됨
reelforge build 여름신상.yaml      # 끝. 캡컷 켜면 프로젝트가 떠 있습니다
```

---

## 설치

```bash
git clone <이 저장소>
cd reelforge
pip install -e ".[all]"
```

같이 필요한 것들:

| 무엇 | 왜 | 설치 |
|---|---|---|
| **ffmpeg** | 무음 탐지 · 오디오 추출 · 미리보기 렌더 | `brew install ffmpeg` / `winget install Gyan.FFmpeg` / `apt install ffmpeg` |
| **faster-whisper** | 단어별 타임스탬프 (컷과 자막의 전제) | `pip install faster-whisper` |
| **edge-tts** | 무료 AI 목소리 | `pip install edge-tts` |
| **libmediainfo** | pycapcut 이 영상 크기·길이를 읽는 데 씁니다 | `brew install libmediainfo` / `apt install libmediainfo0v5` (윈도우는 pip 휠에 포함) |

`reelforge doctor` 가 빠진 걸 알려줍니다.

---

## 브리프 한 장이 입력의 전부

`reelforge init 프로젝트명` 이 주석 달린 템플릿을 만들어 줍니다.

```yaml
project: 여름신상_릴스
footage:
  - raw/take1.mp4
aspect: "9:16"

hook: "이거 모르면 계속 손해봅니다"      # 0~2초에 크게 박히는 첫 문장
idea: |
  타깃: 20대 후반 직장인 / 톤: 친구가 알려주듯 빠르게
cta: "프로필 링크에서 확인"

script: |                                # AI 나레이션용 대본 (한 줄 = 한 호흡)
  아침마다 10분씩 날리고 있었어요.
  이거 하나 바꿨더니 3분이면 끝납니다.

keywords: [무료배송, 3분]                # 자막에서 다른 색으로 강조할 단어

captions:
  source: transcript      # 내가 말한 그대로 / script(대본) / none
  style: reels_bold
  max_chars: 14

narration:
  enabled: false          # true 로 켜면 script 를 읽어 음성 생성
  provider: edge
  voice: ko-KR-SunHiNeural
  mode: mix               # replace(원본 음소거) / mix / off

cut:
  max_pause: 0.45         # 이보다 긴 정적은 이 길이로 줄인다
```

---

### 브리프를 쓰는 사람이 따로 있습니다

대본·훅·자막 키워드를 채워주는 담당이 `.claude/` 에 들어있습니다. 제품 사진이나 특징, 참고할 대본을 던지면
20초 쇼핑 쇼츠 대본과 함께 **이 브리프를 채운 YAML** 을 그대로 내줍니다.

- 분석 담당: `.claude/skills/shopping-shorts-analyst/` (상품 분석 · 후킹 포인트 8개 · 경쟁 영상 분해) → `.claude/agents/shorts-analyst.md`
- 리서치 담당: `.claude/skills/shopping-shorts-researcher/` (샤오홍슈·TikTok 검색어 · 한중영 대응 사전) → `.claude/agents/shorts-researcher.md`
- 대본 담당: `.claude/skills/shopping-shorts-writer/` (페르소나 · 훅 공식 · 20초 비트 · 과장 금지 규정) → `.claude/agents/shorts-writer.md`
- 제목 담당: `.claude/skills/shopping-shorts-titler/` (15~20자 궁금증 제목 5개 · 썸네일 2줄 분할) → `.claude/agents/shorts-titler.md`
- 마케팅 담당: `.claude/skills/shopping-shorts-marketer/` (썸네일 문구 · 검색 캡션 · 해시태그 · 댓글 유도) → `.claude/agents/shorts-marketer.md`
- 소재 담당: `.claude/skills/shopping-shorts-pipeline/` (비슷한 제품 · 연관 콘텐츠 · 시리즈 기획 · 일곱 확장 축) → `.claude/agents/shorts-pipeline.md`
- 브리프 서식: `.claude/skills/shopping-shorts-writer/templates/brief.template.yaml`

리서치 담당이 해외에서 먹힌 각을 찾아오고, 분석 담당이 그 이유와 후킹 포인트를 근거로 만들고, 대본 담당이 영상을 만들 브리프를, 제목 담당이 썸네일과 검색을 같이 잡는 한 줄을, 마케팅 담당이 그 영상을 올릴 문구를 채웁니다. 소재 담당이 다음 편을 끊기지 않게 대어줍니다.

---

## 무엇을 어떻게 자르나

"버벅거림"은 한 가지가 아니라서, 네 종류를 따로 잡습니다.

| 종류 | 예시 | 판단 기준 |
|---|---|---|
| **정적** | 말 안 하는 구간 | `silencedetect` 로 찾되, 통째로 지우지 않고 `max_pause` 만큼 **숨을 남깁니다**. 다 지우면 말이 뚝뚝 끊겨 들립니다. |
| **필러** | "음…", "어…" | 단어 자체가 필러면 즉시 컷. "그", "약간", "좀" 은 **앞뒤로 뜸을 들였을 때만** 컷 — "**그** 제품이" 의 '그'는 살려야 하니까요. |
| **말더듬** | "제, 제, 제품이" | 연속 반복을 찾아 **마지막(제대로 말한) 것만** 남깁니다. |
| **재촬영(NG)** | 같은 말을 다시 찍음 | 앞뒤 문장이 78% 이상 비슷하면 **앞 테이크를 버립니다.** |

거기에 안전장치:

- `min_clip` 보다 짧게 남는 조각은 버립니다 (한 프레임짜리 깜빡임 방지)
- `min_cut` 보다 짧은 컷은 아예 하지 않습니다 (자잘한 컷은 오히려 산만)
- `protect: [[3.0, 5.5]]` 로 **절대 자르면 안 되는 구간**을 못박을 수 있습니다

컷이 마음에 안 들면 브리프 숫자만 만지면 됩니다.

| 증상 | 고치는 법 |
|---|---|
| 너무 뚝뚝 끊긴다 | `cut.max_pause` ↑ (0.6~0.8), `filler.dead_air` ↑ |
| 아직 늘어진다 | `cut.max_pause` ↓ (0.3), `filler.dead_air` ↓ (0.4) |
| 멀쩡한 말이 잘린다 | `filler.soft_pause` ↑ (0.4), `cut.drop_retakes: false` |
| 필러가 안 잘린다 | `filler.low_confidence` ↑ (0.5) |

`build` 실행하면 무엇을 왜 잘랐는지 표로 찍어줍니다.

```
컷 요약  원본 62.4s → 편집 41.8s  (20.6s 제거, 클립 23개)
잘라낸 구간 (상위 8개)
    12.40 →   15.10  (2.70s)  take1.mp4: 2.70s 정적 → 0.45s
    31.02 →   31.48  (0.46s)  take1.mp4: 필러 '음'
     8.15 →    8.44  (0.29s)  take1.mp4: 말더듬 '제' x3
```

---

## 자막

전사 결과를 **컷이 적용된 타임라인 기준으로 다시 배치**합니다. 잘려나간 필러는 자막에도 남지 않습니다.

릴스 자막 규칙을 그대로 코드로 옮겼습니다.

- 한 화면에 **한 호흡**, 두 줄 이내 (`max_chars` × `max_lines`)
- 최소 0.7초는 화면에 머물기 — 그보다 짧으면 못 읽습니다
- 문장 끝 / 0.42초 이상 벌어진 지점에서 끊기
- 예산을 넘기면 **어미(`~고`, `~는데`, `~니까`)까지 되감아** 자연스럽게 자르기
- 조사가 떨어져 나오면 붙이기 ("무료배송 / 까지" → "무료배송까지")
- `keywords` 에 넣은 단어는 다른 색으로 강조

스타일 프리셋 네 가지: `reels_bold`(기본, 흰 글씨 + 검정 외곽선), `pop_yellow`, `minimal`, `caption_box`.

`position: 0.72` 는 화면 아래쪽 — 인스타 UI(계정명·좋아요 버튼)에 가리지 않는 자리입니다.

---

## AI 오디오

```yaml
narration:
  enabled: true
  provider: edge          # edge(무료·키 불필요) / elevenlabs / openai / fish
  voice: ko-KR-SunHiNeural
  mode: replace           # 원본 음소거하고 AI 목소리만
  align: clips            # 각 문장을 컷 시작점에 맞춤 (B롤에 유용)
```

`reelforge voices` 로 추천 목소리를 볼 수 있습니다.

- **edge** — 키가 필요 없어 바로 굴려볼 수 있습니다. 한국어 품질도 준수합니다.
- **elevenlabs / openai / fish** — 각각 `ELEVENLABS_API_KEY`, `OPENAI_API_KEY`, `FISH_AUDIO_API_KEY` 환경변수 필요. fish 는 목소리 클로닝을 쓸 때.

같은 문장은 해시로 캐시되므로, 대본을 한 줄만 고쳐도 나머지는 다시 만들지 않습니다.

`mode` 세 가지: `replace`(원본 음소거) · `mix`(원본을 깔고 위에 얹기) · `off`.

---

## 캡컷 프로젝트는 어떻게 만들어지나

타임라인 조립은 **[pycapcut](https://pypi.org/project/pycapcut/)** 이 맡습니다. 캡컷의 `draft_content.json` 스키마는 버전마다 바뀌는데, 그 추적을 직접 하는 대신 라이브러리에 맡기고 우리는 "무엇을 어디에 놓을지"만 정합니다.

만들어지는 트랙:

| 트랙 | 내용 |
|---|---|
| 영상 | 컷된 클립들이 순서대로 |
| 자막 | 말자막 |
| 훅·CTA | 말자막 **위에 얹히는** 문구 (별도 트랙이라 겹치지 않습니다) |
| 나레이션 | AI 오디오 |
| BGM | 배경음악 |

pycapcut 이 채워주지 않는 세 곳은 저장한 뒤에 손봅니다.

- **프로젝트 메타** — pycapcut 이 복사해 넣는 템플릿은 프로젝트 이름·경로가 비어 있고 `draft_id` 가 **모든 프로젝트에 똑같습니다.** 그대로 두면 캡컷 목록에서 프로젝트끼리 서로 가립니다. 매번 새 id 와 이름·경로·길이를 채웁니다.
- **키워드 강조** — pycapcut 의 텍스트는 글자 범위별 색을 지원하지 않아 자막 전체가 한 색이 됩니다. 저장된 JSON 의 `styles` 배열에 강조 범위를 얹습니다.
- **끊어진 참조** — pycapcut 0.0.3 은 자막 세그먼트에 speed 소재의 id 를 적어놓고 정작 그 소재를 등록하지 않습니다. 어디에도 없는 것을 가리키는 참조라 걷어냅니다.

그리고 자막이 한 트랙 안에서 겹치면 캡컷이 프로젝트를 거부합니다. 웹 편집대에서 시각을 손으로 고치면 얼마든지 겹칠 수 있으므로, 내보내기 직전에 뒤쪽을 잘라 정리합니다.

프로젝트 폴더를 자동으로 못 찾으면 직접 지정하세요.

```bash
reelforge build 브리프.yaml --projects-dir "~/Movies/CapCut/User Data/Projects/com.lveditor.draft"
```

기본 탐색 경로:

- macOS `~/Movies/CapCut/User Data/Projects/com.lveditor.draft`
- Windows `%LOCALAPPDATA%\CapCut\User Data\Projects\com.lveditor.draft`

> **중요**: `build` 후에는 캡컷을 **완전히 종료했다 다시 켜야** 새 프로젝트가 목록에 뜹니다. 캡컷은 실행 중에 프로젝트 목록을 다시 읽지 않습니다.

> 한글 자막에는 폰트를 지정하지 않습니다. pycapcut 의 `FontType` 에는 한국어 폰트가 없어, 지정하면 글자가 깨질 수 있습니다. 비워두면 캡컷 기본 폰트가 한글을 제대로 렌더합니다.


---

## 캡컷이 프로젝트를 못 열 때

캡컷 버전이 많이 앞서가 draft 를 못 읽는 경우가 있습니다. 그때도 작업이 날아가지 않도록 **우회로**가 같이 나옵니다.

```
out/프로젝트명/
    plan.json        편집 결정 전부 (사람이 읽고 고칠 수 있는 형식)
    프로젝트명.srt    자막 — 캡컷에 그대로 임포트 가능
```

```bash
# 컷만 적용된 mp4 를 뽑아서 캡컷에 넣고 자막만 얹기
reelforge render 브리프.yaml --out 컷적용.mp4

# 자막까지 태워서 확인용으로
reelforge render 브리프.yaml --burn
```

`plan.json` 을 손으로 고친 뒤 다시 내보낼 수도 있습니다 (`reelforge render --plan out/.../plan.json`).

---

## 웹 편집대

YAML을 직접 안 만지고 브라우저에서 브리프를 채우고, 자동으로 잘린 컷을 눈으로 확인하고 싶을 때 씁니다. `web/editor.html` 이 그 페이지입니다.

**기획 브리프 탭** — 훅·대본·자막 스타일·컷 강도를 폼으로 채우면 YAML이 실시간으로 만들어집니다. 자막 위치는 9:16 프레임 미리보기에 그대로 비치고, 인스타 UI에 가리는 영역이 빗금으로 표시됩니다. `brief.json` 으로 받으면 CLI가 그대로 읽습니다(`reelforge build 브리프.json`).

**컷 검토 탭** — `out/<프로젝트>/plan.json` 을 끌어다 놓으면 원본 타임라인 위에 잘려나간 구간이 빨갛게 뜹니다. 과하게 잘린 곳을 눌러 **되살리면 뒤따르는 자막 시각이 자동으로 밀립니다.** 자막 글자와 타이밍도 그 자리에서 고칠 수 있습니다.

고친 `plan.json` 을 받아서 캡컷 프로젝트를 다시 만듭니다.

```bash
reelforge export plan.json
```

브리프를 페이지에 저장해두면 다른 기기에서 열어도 남아 있고, Claude가 그 브리프를 그대로 읽어 `build` 를 돌릴 수 있습니다.

---

## 명령어

| 명령 | 하는 일 |
|---|---|
| `reelforge init 이름` | 주석 달린 브리프 생성 |
| `reelforge doctor` | ffmpeg / whisper / 캡컷 경로 점검 |
| `reelforge build 브리프.yaml` | 전체 파이프라인 → 캡컷 프로젝트 |
| `reelforge export plan.json` | 손본 plan.json → 캡컷 프로젝트 다시 만들기 |
| `reelforge render 브리프.yaml` | ffmpeg 미리보기 mp4 |
| `reelforge voices` | TTS 공급자 / 추천 목소리 |

`build` 옵션 몇 가지:

```bash
reelforge build 브리프.yaml \
  --jump-cut-zoom 0.03 \   # 컷마다 3%씩 번갈아 확대 → 점프컷 티 줄이기
  --no-cache \             # 전사 캐시 무시하고 다시 분석
  --show-cuts 20           # 잘라낸 구간 20개까지 출력
```

---

## 영상을 여러 편 뽑을 때

브리프를 폴더로 관리하면 됩니다.

```
reels/
  2026-09-신상소개.yaml
  2026-09-사용후기.yaml
  raw/
    신상_take1.mp4
```

```bash
for f in reels/*.yaml; do reelforge build "$f"; done
```

전사 결과는 `.reelforge/<프로젝트>/` 에 캐시되므로, 자막 문구나 컷 강도만 바꿔 다시 돌리면 **분석을 건너뛰고 몇 초 만에** 끝납니다.

---

## 속도

릴스 한 편(60초) 기준, M1 맥북 CPU:

| 단계 | 시간 |
|---|---|
| 오디오 추출 + 무음 탐지 | ~2초 |
| 전사 (`medium`) | ~25초 (`small` 이면 ~10초) |
| 컷 · 자막 계산 | 1초 미만 |
| TTS (5문장, edge) | ~4초 |
| draft 생성 | 1초 미만 |

두 번째 실행부터는 전사가 캐시되어 **5초 안쪽**입니다. 빠르게 여러 버전을 시험할 땐 `stt_model: small` 로 두고, 최종본만 `medium` 이상으로 돌리세요.

---

## 구조

```
reelforge/
  models.py              Span · Clip · Caption · EditPlan (시간은 전부 초 단위)
  media.py               ffmpeg / ffprobe 래퍼
  analyze/
    silence.py           silencedetect 파싱
    transcribe.py        faster-whisper + 캐시
    fillers.py           필러 · 말더듬 · 죽은 시간 · 재촬영 탐지
    planner.py           탐지 결과 → 컷 리스트 → 타임라인 매핑
  script/
    brief.py             브리프 파싱 (오타는 에러로 잡는다)
    captions.py          자막 덩어리 나누기 · 줄바꿈 · 조사 붙이기
  tts/                   공급자 추상화 + edge/elevenlabs/openai/fish
  export/
    capcut/draft.py      EditPlan → pycapcut → draft 폴더 (+ 뒷정리)
    capcut/styles.py     자막 프리셋 → pycapcut 텍스트 설정
    srt.py, render.py    우회로
  pipeline.py            전체 조립
  cli.py
web/editor.html          브리프 작성 + 컷 검토 웹 편집대
```

가운데 있는 `EditPlan` 이 핵심입니다. 편집 결정이 전부 여기 모이고, 캡컷·SRT·ffmpeg 는 그걸 각자 형식으로 옮기기만 합니다. 새 출력 형식(프리미어 XML 등)을 붙이려면 exporter 하나만 쓰면 됩니다.

## 테스트

```bash
pytest
```

ffmpeg 없이 돕니다. 컷 판단과 자막 분할은 순수 계산이라 가짜 전사 데이터로 검증하고,
draft 생성은 pycapcut 이 소재를 실제로 읽으므로 표준 라이브러리로 만든 진짜 PNG·WAV 를 씁니다.
