# 네이버 블로그 초안 공장

사진 + 소재 정보 + 한 줄 메모를 주면 → Claude가 **사진을 직접 보고** 글을 쓰고 → 승인 후 네이버 **임시저장**까지.
**발행은 언제나 사람이 합니다.** 스크립트에 발행 버튼 차단 가드가 코드로 박혀 있습니다.

- 주제: 스포츠 이슈 · 필명: 스포츠 이슈 아카이브 · 화자 톤: 기자 같은 건조한 말투
- 상세 지침은 `CLAUDE.md` (Claude가 매번 읽는 마스터 지침)

---

## 설치 (Windows / cmd)

설치 위치: `D:\미선 바탕화면 파일\블로그,인스타그램\00. 블로그 포스팅 전 정리 ★\00. 블로그 포스팅`

```cmd
cd /d "D:\미선 바탕화면 파일\블로그,인스타그램\00. 블로그 포스팅 전 정리 ★\00. 블로그 포스팅"

git clone -b claude/magical-fermi-mzso3v https://github.com/alepddlek1-ui/alepddlek.git _tmp
move "_tmp\naver-blog" "naver-blog"
rmdir /s /q _tmp

cd naver-blog
npm install
npx playwright install chromium
npm test
```

> 폴더 이름에 공백·쉼표·`★`가 있어서 **경로는 반드시 큰따옴표로 감싸야** 합니다.
> 혹시 `npm install` 이나 Playwright가 이 경로에서 말썽을 부리면, 폴더째 `C:\naver-blog` 같은
> 짧은 경로로 옮기면 그대로 동작합니다(경로에 의존하는 코드가 없습니다).

`npm test` 가 **17개 전부 통과**하면 설치가 끝난 겁니다.

### 로그인 (1회)
```cmd
claude
```
그리고 `/setup-login` 또는 직접:
```cmd
node scripts\naver_login.js
```
브라우저가 뜨면 **직접 로그인**합니다. 이 툴은 아이디·비밀번호를 받지도, 저장하지도 않습니다.
세션은 `naver-profile\` 에 저장됩니다. **이 폴더는 외부 공유·커밋 금지.**

---

## 사용

```cmd
cd /d "...\00. 블로그 포스팅\naver-blog"
claude
```

| 명령 | 하는 일 |
|---|---|
| `/write <소재와 한 줄 메모>` | 사진 분석 → 개인정보 모자이크 → 초안 작성 → **승인 후** 임시저장 → 검증 |
| `/setup-login` | 로그인 세션 설정 |
| `/learn-style <내 글 붙여넣기>` | 내 문체를 추출해 `data/style-profile.md` 갱신 |
| `/analyze-trends <자료 붙여넣기>` | 제공한 자료만으로 트렌드·키워드 정리 |

사진은 `input\photos\`, 영상은 `input\videos\` 에 넣고 `/write` 하면 됩니다.

### 최신 버전 받기

```cmd
update.cmd
```
`scripts\`, `CLAUDE.md`, `.claude\`, `tests\`, `drafts\*.json` 을 최신으로 덮어씁니다.
**`data\` 폴더(내 블로그 정보)와 사진·영상은 건드리지 않습니다.**

### 스크립트 직접 실행
```cmd
node scripts\naver_draft.js drafts\2026-09-15-example.json --dry-run   :: 저장 안 함(셀렉터 점검)
node scripts\naver_draft.js drafts\2026-09-15-example.json             :: 임시저장
node scripts\probe_selectors.js                                        :: 셀렉터 실측(읽기 전용)
node scripts\mosaic.js drafts\mosaic-spec.json                         :: 모자이크(원본 보존)
node scripts\make_cards.js drafts\cards-example.json                   :: 정리 이미지 생성
node scripts\lint_draft.js drafts\2026-09-15-example.json              :: 초안 검수(숫자 대조)
npm test                                                               :: 자가 검증
```

---

## 폴더 구조

```
CLAUDE.md                마스터 지침 (Claude가 매번 읽음)
.claude/commands/        /write /setup-login /learn-style /analyze-trends
.claude/settings.json    폴더 내 작업 자동승인
scripts/
  naver_login.js         로그인 세션 저장 (비밀번호 미저장)
  naver_draft.js         초안 → 에디터 입력 → 태그·지도·동영상·소제목 → 임시저장 → 검증
  mosaic.js              개인정보 모자이크 (원본 절대 보존)
  probe_selectors.js     DOM 덤프 (읽기 전용, 셀렉터 깨졌을 때)
  lib/browser.js         세션·발행차단가드·에디터 프레임
data/                    profile / blogger-profile / authority-lines / photo-guide
                         sponsored-disclosure / trends / style-profile
input/photos/            원본 사진      input/photos/_mosaic/ 에 처리본 생성
input/videos/            영상
drafts/                  초안 JSON + 검증 산출물(.dump.txt / .screenshot.png)
examples/                초안 JSON 예시
tests/run.js             자가 검증 (npm test)
```

---

## 지켜지는 규칙

1. **API 키 안 씀** — 모든 AI 작업은 Claude Code 세션 안에서
2. **발행 안 함** — 임시저장까지만. 진짜 발행 버튼 클릭은 코드로 차단(`npm test` 로 검증됨)
3. **사실 안 지어냄** — 출처 없는 문장은 아예 쓰지 않음. 협찬이면 공정위 표기 자동 삽입
4. **자동 수집 안 함** — 트렌드·문체는 사용자가 직접 준 자료로만
5. **승인 없이 저장 안 함**
6. **원본 사진 안 건드림** — 모자이크는 항상 사본

---

## 문제가 생기면

| 증상 | 조치 |
|---|---|
| 셀렉터 실패 / 버튼 못 찾음 | `node scripts\probe_selectors.js` 로 실제 DOM 실측 후 수정, `CLAUDE.md` 11번에 기록 |
| 로그인 화면으로 계속 튕김 | `naver-profile\` 폴더 삭제 후 `/setup-login` 다시 |
| 브라우저가 안 뜸 | `npx playwright install chromium` |
| "저장 글"에 실패본이 쌓임 | 네이버에서 **직접** 정리 (툴이 자동 삭제하지 않습니다) |
| 지도·동영상이 안 붙음 | 로그의 「자동 처리 결과」에서 ❗항목 확인 후 에디터에서 수동 첨부 |

---

## 주의

- 브라우저 자동화는 **네이버 약관상 회색지대**입니다. 본인 계정으로, **하루 1~2건** 권장합니다.
- `naver-profile\` 는 로그인 세션입니다. **절대 공유하지 마세요.**
- 이 툴은 **초안 공장**이지 **무인 발행기가 아닙니다.**
