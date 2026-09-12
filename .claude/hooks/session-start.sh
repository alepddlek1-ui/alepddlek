#!/bin/bash
# 세션이 시작될 때 개발 환경을 준비한다 (Claude Code on the web 전용).
#
#  1. 파이썬 의존성 설치 — 테스트가 바로 돌아가도록
#  2. agent-browser 설치 + 미리 깔린 Chromium 연결
#  3. 에이전트 프록시 CA 를 Chromium 신뢰 저장소에 등록
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

# ---------------------------------------------------------------- 파이썬
# 이미 설치돼 있으면 pip 가 알아서 건너뛴다.
echo "==> 파이썬 의존성 설치"
python3 -m pip install --quiet --disable-pip-version-check -e ".[dev]"

# ------------------------------------------------------------ 프록시 CA
# 이 환경의 https 는 에이전트 프록시에서 TLS 가 다시 끊긴다. Chromium 은
# 시스템 CA 가 아니라 NSS 저장소를 보기 때문에, 여기에 넣어주지 않으면
# 모든 페이지가 ERR_CERT_AUTHORITY_INVALID 로 막힌다.
install_proxy_ca() {
  local ca=/root/.ccr/ca-bundle.crt
  local db="$HOME/.pki/nssdb"

  [ -r "$ca" ] || return 0

  if ! command -v certutil >/dev/null 2>&1; then
    apt-get install -y -qq libnss3-tools >/dev/null 2>&1 \
      || { apt-get update -qq >/dev/null 2>&1 \
           && apt-get install -y -qq libnss3-tools >/dev/null 2>&1; } \
      || { echo "   certutil 을 설치하지 못했다 — CA 등록 건너뜀"; return 0; }
  fi

  mkdir -p "$db"
  [ -f "$db/cert9.db" ] || certutil -N --empty-password -d "sql:$db"

  if certutil -L -d "sql:$db" 2>/dev/null | grep -q '^ccr-'; then
    echo "   CA 이미 등록됨"
    return 0
  fi

  # 번들에 여러 장이 들어 있어서 한 장씩 쪼개 넣는다.
  local tmp count=0 pem
  tmp=$(mktemp -d)
  csplit -z -s -f "$tmp/ca-" -b '%03d.pem' "$ca" '/BEGIN CERTIFICATE/' '{*}'
  for pem in "$tmp"/ca-*.pem; do
    if certutil -A -n "ccr-$(basename "$pem" .pem)" -t "C,," -i "$pem" -d "sql:$db"; then
      count=$((count + 1))
    fi
  done
  rm -rf "$tmp"
  echo "   CA $count 장 등록"
}

# -------------------------------------------------------- agent-browser
# `agent-browser install` 은 쓸 수 없다. Chrome-for-Testing 을 받아오는
# googlechromelabs.github.io 가 egress 정책에서 403 으로 막혀 있다.
# 대신 컨테이너에 미리 들어 있는 Playwright Chromium 을 붙여 쓴다.
setup_agent_browser() {
  local chrome
  chrome=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome 2>/dev/null | head -1 || true)
  if [ -z "$chrome" ]; then
    echo "   미리 설치된 Chromium 이 없다 — 건너뜀"
    return 0
  fi

  if ! command -v agent-browser >/dev/null 2>&1; then
    npm install -g agent-browser >/dev/null 2>&1 \
      || { echo "   agent-browser 설치 실패 — 건너뜀"; return 0; }
  fi

  if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
    {
      echo "export AGENT_BROWSER_EXECUTABLE_PATH=$chrome"
      # 컨테이너가 root 로 돌기 때문에 샌드박스를 끄지 않으면 뜨지 않는다.
      echo 'export AGENT_BROWSER_ARGS="--no-sandbox"'
    } >> "$CLAUDE_ENV_FILE"
  fi

  install_proxy_ca
  echo "   agent-browser 준비 완료 ($chrome)"
}

echo "==> agent-browser 설정"
setup_agent_browser

echo "==> 완료"
