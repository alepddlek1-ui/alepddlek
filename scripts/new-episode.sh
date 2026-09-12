#!/usr/bin/env bash
# 쇼핑쇼츠 한 편 작업 폴더를 만든다.
#   사용법: scripts/new-episode.sh <제품명> [날짜(YYYY-MM-DD)]
#   예:     scripts/new-episode.sh 차량용청소기
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "사용법: scripts/new-episode.sh <제품명> [YYYY-MM-DD]" >&2
  exit 1
fi

PRODUCT="$1"
DATE="${2:-$(date +%F)}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SKILLS="$ROOT/.claude/skills"
DIR="$ROOT/work/${DATE}-${PRODUCT}"

if [ -e "$DIR" ]; then
  echo "이미 있습니다: work/${DATE}-${PRODUCT}" >&2
  exit 1
fi

mkdir -p "$DIR"

# 마스터 양식 복사 (있으면 그대로, 없으면 빈 파일)
cp "$SKILLS/shopping-shorts-master/templates/work-order.md" "$DIR/00_work-order.md"
cp "$SKILLS/shopping-shorts-master/templates/qa-sheet.md"   "$DIR/07_qa.md"
cp "$SKILLS/shopping-shorts-master/templates/release.md"    "$DIR/08_release.md"
cp "$SKILLS/shopping-shorts-writer/templates/brief.template.yaml" "$DIR/brief.yaml"

# 담당별 산출물 자리
for f in "01_research:리서치 담당 — 샤오홍슈 5 · TikTok 5 · 국내 검색어" \
         "02_analysis:분석 담당 — 후킹 포인트 8개 / 레퍼런스 분해" \
         "03_script:대본 담당 — 20초 대본 (공백 제외 90~105자)" \
         "04_titles:제목 담당 — 제목 5개 (15~20자)" \
         "05_marketing:마케팅 담당 — 썸네일 3 · 캡션 · 해시태그 10 · 댓글 3" \
         "06_pipeline:소재 담당 — 비슷한 제품 3 · 연관 5 · 시리즈 5"; do
  name="${f%%:*}"; desc="${f#*:}"
  printf '# %s — %s\n\n> %s\n> 미작성\n' "$name" "$PRODUCT" "$desc" > "$DIR/$name.md"
done

# 제목·대본 자수 계산용 평문 (검수에서 쓴다)
: > "$DIR/script.txt"
: > "$DIR/titles.txt"

# 제품명·날짜를 양식에 채워넣기
for t in "$DIR/00_work-order.md" "$DIR/07_qa.md" "$DIR/08_release.md"; do
  python3 - "$t" "$PRODUCT" "$DATE" <<'PY'
import sys, pathlib
p, product, date = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3]
t = p.read_text(encoding="utf-8")
t = t.replace("<제품명>", product).replace("<YYYY-MM-DD>", date)
p.write_text(t, encoding="utf-8")
PY
done

echo "만들었습니다: work/${DATE}-${PRODUCT}"
echo
ls -1 "$DIR" | sed 's/^/  /'
echo
echo "다음: 마스터에게 넘기세요 —  /shorts ${PRODUCT}"
