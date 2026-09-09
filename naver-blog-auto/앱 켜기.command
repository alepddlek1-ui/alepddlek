#!/bin/sh
# 더블클릭하면 앱이 켜지고 브라우저까지 열립니다.
cd "$(dirname "$0")" || exit 1

if [ ! -d node_modules ]; then
  echo ""
  echo "[1/2] 처음 켜는 것 같습니다. 필요한 프로그램을 내려받습니다. 1~3분 걸립니다."
  echo ""
  npm install || { echo ""; echo "내려받기에 실패했습니다."; read -r _; exit 1; }
fi

echo ""
echo "[2/2] 앱을 켭니다. 잠시 뒤 브라우저가 저절로 열립니다."
echo "이 창은 닫지 마세요. 닫으면 앱이 꺼집니다."
echo ""

( sleep 8; (command -v open >/dev/null && open http://localhost:4123) || (command -v xdg-open >/dev/null && xdg-open http://localhost:4123) ) &
npm run dev
