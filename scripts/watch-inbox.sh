#!/usr/bin/env bash
# inbox/ 를 지켜보다가 새 영상이 들어오면 /쇼츠 를 자동으로 돌린다.
#
#   ./scripts/watch-inbox.sh            # 10초마다 확인
#   ./scripts/watch-inbox.sh 60         # 60초마다
#
# 클로드 코드를 헤드리스(-p)로 부르기 때문에 터미널을 띄워둘 필요가 없다.
# 멈추려면 Ctrl-C.
set -uo pipefail

INTERVAL="${1:-10}"
INBOX="${INBOX:-inbox}"
LOG="${LOG:-work/watch.log}"

mkdir -p "$INBOX" work

command -v claude >/dev/null || { echo "claude CLI 가 필요합니다"; exit 1; }
command -v shortsforge >/dev/null || { echo "shortsforge 가 필요합니다 (pip install -e .)"; exit 1; }

echo "지켜보는 중: $INBOX/  (${INTERVAL}초 간격)  로그: $LOG"

while true; do
  # 아직 작업 폴더가 없는 영상만 골라온다 (shortsforge 가 판단)
  mapfile -t NEW < <(shortsforge scan 2>/dev/null | sed -n 's/.*→ \(work\/.*\)$/\1/p')

  for workdir in "${NEW[@]:-}"; do
    [ -z "$workdir" ] && continue
    name="$(basename "$workdir")"
    echo "[$(date '+%F %T')] 시작: $name" | tee -a "$LOG"

    # 영상 한 편을 끝까지. 빈 프롬프트 슬롯은 건너뛰고 진행한다.
    if claude -p "/쇼츠 $name --skip-empty" >>"$LOG" 2>&1; then
      echo "[$(date '+%F %T')] 완료: $name" | tee -a "$LOG"
    else
      echo "[$(date '+%F %T')] 실패: $name — $LOG 확인" | tee -a "$LOG"
    fi
  done

  sleep "$INTERVAL"
done
