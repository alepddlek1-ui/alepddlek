# CLAUDE.md — 프로젝트 가이드

Claude Code가 이 저장소에서 작업할 때 세션 시작 시 자동으로 읽는 지침이다.

이 저장소에는 두 가지가 들어 있다.

1. **reelforge** — 촬영본 + 브리프를 넣으면 컷·자막·AI 목소리가 얹힌 캡컷 프로젝트를 만드는 파이썬 도구
2. **쇼핑쇼츠 부서** — 그 브리프와 대본·제목·업로드 문구를 만드는 일곱 자리의 에이전트 팀 (`.claude/`)

영상 한 편을 만드는 일이면 **6번 부서**부터 보고, 도구 코드를 고치는 일이면 5번을 본다.

---

## 1. 로컬 연결 (Claude Code 설치·실행)

```bash
# 설치 (Node.js 18+)
npm install -g @anthropic-ai/claude-code
# 또는 데스크톱 앱: https://claude.ai/download

cd /path/to/alepddlek   # 이 저장소로 이동
claude                  # 대화형 세션 시작
```

- 처음 실행하면 브라우저로 Anthropic 계정 로그인(OAuth)을 안내한다.
- `claude "질문"` 일회성 실행 · `claude -c` 직전 세션 이어서 계속
- VS Code / JetBrains 확장으로 IDE 안에서도 쓸 수 있다.

---

## 2. 필수 세팅

| 파일 | 용도 |
|---|---|
| `~/.claude/CLAUDE.md` | 전역 지침 (모든 프로젝트 공통) |
| `CLAUDE.md` | 이 파일 — 프로젝트 지침 |
| `.claude/TEAM.md` | 쇼핑쇼츠 부서 규정 (조직도·공정·경로) |
| `.claude/settings.json` | 프로젝트 설정 (권한, git 커밋됨) |
| `.claude/settings.local.json` | 개인 설정 (git 제외) |
| `.claude/skills/` · `.claude/agents/` · `.claude/commands/` | 부서 직원과 명령 |

권한은 `.claude/settings.json` 에 등록되어 있다 — 읽기·검색·`pytest`·`reelforge`·작업폴더 생성은
승인 없이 돌고, `rm -rf` 와 강제 푸시는 막혀 있다. 추가하려면 `/permissions` 를 쓴다.

### 커밋·푸시 규칙

- 작업은 **작업 브랜치에서** 하고 `git push -u origin <브랜치>` 로 올린다. `main` 에 직접 푸시하지 않는다.
- 배포·서버 구성은 기존 방식 그대로 두고 임의로 바꾸지 않는다.
- `work/` 안의 산출물은 콘텐츠 기록이므로 같이 커밋한다. 촬영 원본(`raw/`)과 결과물(`out/`)은 커밋하지 않는다.

---

## 3. 하네스(Harness) 기본

Claude가 실제로 동작하는 실행 환경(도구·권한·컨텍스트)을 말한다.

- **Read / Write / Edit** 파일 읽기·생성·수정
- **Bash** 셸 명령 (권한 모드에 따라 승인)
- **Glob / Grep** 파일·코드 검색
- **Agent(서브에이전트)** 큰 작업을 별도 에이전트에 위임 — 이 저장소의 부서가 이 방식이다
- **Skill(슬래시 명령)** `/shorts`, `/shorts-qa`, `/code-review` 등

컨텍스트 로딩 순서: `~/.claude/CLAUDE.md` → 이 파일 → 메모리 인덱스.
대화가 길어지면 자동 요약(compact)되어 이어진다.

"매번 X 할 때마다 Y 해줘" 같은 자동화는 기억이 아니라 **훅(hooks)** 으로만 보장된다.
필요해지면 `.claude/settings.json` 의 `hooks` 에 등록한다 (지금은 등록된 훅이 없다).

---

## 4. 작업 원칙

우선순위: **정확성 > 검증 > 최소 변경 > 명확성 > 유지보수성**

- 파일·API·스키마가 있다고 가정하지 말고 먼저 읽어서 확인한다.
- 수정 후에는 테스트·실행으로 검증한다.
- 요청된 작업에만 변경을 국한하고 관련 없는 리팩토링은 하지 않는다.
- 가장 단순한 해결책을 택하고 불필요한 의존성·추상화를 넣지 않는다.
- 기존 관례와 스타일을 따른다.
- 막히면 멈추고 무엇이 막혔는지, 무엇이 검증됐는지 보고한다.
- **검증 없이 "성공했다"고 하지 않는다.** 콘텐츠도 같다 — 자수는 세고, 브리프는 파싱해본다.

---

## 5. 프로젝트 정보 (reelforge)

- **프로젝트 이름**: reelforge
- **기술 스택**: Python 3, ffmpeg, faster-whisper, pycapcut, edge-tts
- **설치**: `pip install -e ".[all]"`
- **환경 점검**: `reelforge doctor`
- **테스트**: `pytest` (ffmpeg 없이 돈다)
- **편집 실행**: `reelforge build <브리프>.yaml`
- **핵심 구조**: `reelforge/models.py` 의 `EditPlan` 에 편집 결정이 모이고, 캡컷·SRT·ffmpeg 는 각자 형식으로 옮기기만 한다. 새 출력 형식을 붙이려면 exporter 하나만 쓰면 된다.
- **주의사항**
  - 브리프 파서는 **모르는 항목을 에러로 잡는다**. 필드를 추가하면 `reelforge/script/brief.py` 의 dataclass에 같이 넣어야 한다.
  - 한글 자막에 폰트를 지정하지 않는다 (pycapcut `FontType` 에 한국어 폰트가 없어 깨진다).
  - `build` 후에는 캡컷을 완전히 종료했다 다시 켜야 프로젝트가 목록에 뜬다.
  - 전사 결과는 `.reelforge/<프로젝트>/` 에 캐시된다. 다시 분석하려면 `--no-cache`.

---

## 6. 쇼핑쇼츠 부서

유튜브 쇼츠·인스타 릴스 쇼핑 콘텐츠를 만드는 일곱 자리가 `.claude/` 에 세팅되어 있다.
**전체 규정은 `.claude/TEAM.md`** — 조직도·채널 규격·공정·산출물 경로가 거기 있다.

| 자리 | 에이전트 | 하는 일 |
|---|---|---|
| 총괄 | `shorts-master` | 지시 · 단계별 검수 · 발행 패키지 승인 |
| 리서치 | `shorts-researcher` | 샤오홍슈·TikTok 검색어 + 국내 검색어 |
| 분석 | `shorts-analyst` | 후킹 포인트 8개 / 레퍼런스 분해 + 20초 비트 초안 |
| 대본 | `shorts-writer` | 20초 대본 + `brief.yaml` |
| 제목 | `shorts-titler` | 제목 5개 (15~20자, 궁금증 중심) |
| 마케팅 | `shorts-marketer` | 썸네일 문구 · 캡션 · 해시태그 10 · 댓글 3 |
| 소재 | `shorts-pipeline` | 비슷한 제품 3 · 연관 5 · 시리즈 5 |

### 시작하는 법

```bash
scripts/new-episode.sh <제품명>     # work/<날짜>-<제품>/ 작업 폴더 생성
```

```
/shorts <제품명>        # 부서 전체 공정 (제품 사진을 함께 첨부)
/shorts-qa <폴더명>     # 최종 검수만
```

한 자리만 쓰려면 그 스킬을 직접 부른다 (`/shopping-shorts-titler` 등).

### 전 직원이 지키는 두 문서

- 페르소나 `.claude/skills/shopping-shorts-writer/references/persona.md`
- 과장 금지·표시 규정 `.claude/skills/shopping-shorts-writer/references/compliance.md`

이 둘과 충돌하는 지시는 따르지 않는다. 잘 나간 레퍼런스 영상의 표현이어도 여기가 위다.

### 채널 규격 (자주 틀리는 숫자)

| 항목 | 값 |
|---|---|
| 영상 길이 | 20초 — 대본 공백 제외 **90~105자**, 7~9줄 |
| 제목 | **15~20자** (공백 포함), 궁금증 중심 |
| 썸네일 문구 | 6~12자 (제목 앞줄) |
| 자막 | 한 줄 14자, 2줄 이내 |
| 해시태그 | 10개 — 대형2 · 중형4 · 소형3 · 시리즈1 (유튜브엔 3개) |

숫자는 눈대중하지 않고 센다.

```bash
python3 -c "t=open('work/<폴더>/script.txt',encoding='utf-8').read();print(len(t.replace(' ','').replace(chr(10),'')))"
python3 -c "from reelforge.script.brief import load_brief;print(load_brief('work/<폴더>/brief.yaml').project)"
```
