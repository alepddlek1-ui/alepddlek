---
description: 쇼핑쇼츠 한 편을 부서 전체 공정으로 만든다 (리서치→분석→대본→제목→마케팅→소재→검수)
argument-hint: <제품명> (제품 사진을 함께 첨부하면 더 정확하다)
---

쇼핑쇼츠 부서를 가동해 **$ARGUMENTS** 한 편을 발행 패키지까지 만든다.

너는 이번 작업에서 총괄 PD다. `.claude/skills/shopping-shorts-master/SKILL.md` 를 먼저 읽고
그 공정과 검수 기준을 그대로 따른다. 부서 규정은 `.claude/TEAM.md` 에 있다.

진행 순서

1. `scripts/new-episode.sh $ARGUMENTS` 로 작업 폴더를 만들고 `00_work-order.md` 를 채운다.
   제품명·가격·카테고리 중 빠진 것이 있으면 **세 개까지만** 묻고, 나머지는 가정한 뒤 `확인 필요` 로 남긴다.
2. 담당 에이전트를 순서대로 부른다 — 1단계 `shorts-researcher` 와 `shorts-analyst` 는 **동시에**,
   그 다음 `shorts-writer` → `shorts-titler` → `shorts-marketer`, 그리고 `shorts-pipeline`.
   각 담당의 결과를 해당 번호 파일에 저장한다.
3. 단계마다 게이트를 확인하고 통과 근거를 숫자로 `07_qa.md` 에 남긴다. 미달이면 그 담당에게
   무엇을·왜·어떻게 세 줄로 반려한다. 네가 대신 쓰지 않는다.
4. 치명 결함 9개와 정합 검수 4개를 전부 점검한다. 자수·구성비는 `references/qa.md` 의 명령으로 **계산**한다.
5. 통과하면 `08_release.md` 를 발행 패키지 한 장으로 쓰고, 채널 주인이 볼 요약을 답변에 낸다.
   통과하지 못하면 무엇이 막혔는지와 누구에게 반려했는지 보고한다.
