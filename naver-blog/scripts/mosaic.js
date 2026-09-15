'use strict';
/**
 * mosaic.js — 사진 개인정보 모자이크 (원본 절대 보존)
 *
 *   node scripts/mosaic.js drafts/mosaic-spec.json
 *
 * spec 포맷 (좌표는 0~1 상대값, EXIF 회전 보정 후 "보이는 화면" 기준):
 * {
 *   "blockSize": 14,           // 선택, 클수록 굵은 모자이크 (기본 14)
 *   "pad": 0,                  // 선택, 박스 추가 여유 비율 (좌표에 이미 15% 여유를 준다면 0)
 *   "regions": [
 *     { "image": "input/photos/IMG_1.jpg",
 *       "boxes": [ { "x":0.31, "y":0.12, "w":0.18, "h":0.22, "why":"관중 얼굴" } ] }
 *   ]
 * }
 *
 * 구현 함정 둘 (반드시 유지):
 *  1) 좌표 기준은 EXIF 회전 보정 후 크기 — 먼저 .rotate() 한 버퍼를 만들고 그 크기로 계산한다
 *  2) sharp는 한 파이프라인에 resize를 1회만 적용한다 — 축소 → 버퍼 → 확대(nearest) 2단계로 분리한다
 *
 * 처리 후 반드시 결과물을 Read로 열어 실제로 가려졌는지 눈으로 확인할 것.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'input', 'photos', '_mosaic');

let sharp;
try {
  sharp = require('sharp');
} catch {
  console.error('sharp 가 설치돼 있지 않습니다. 먼저 `npm install` 을 실행하세요.');
  process.exit(1);
}

function clamp01(v) { return Math.max(0, Math.min(1, v)); }

async function processImage(rel, boxes, blockSize, pad) {
  const src = path.resolve(ROOT, rel);
  if (!fs.existsSync(src)) throw new Error(`사진이 없습니다: ${src}`);

  // 1단계: EXIF 회전 보정 후의 실제 픽셀 버퍼를 먼저 만든다
  const rotated = await sharp(src).rotate().toBuffer({ resolveWithObject: true });
  const W = rotated.info.width;
  const H = rotated.info.height;

  const overlays = [];
  for (const box of boxes) {
    const px = clamp01(box.x - (box.w * pad));
    const py = clamp01(box.y - (box.h * pad));
    const pw = clamp01(box.w * (1 + pad * 2));
    const ph = clamp01(box.h * (1 + pad * 2));

    let left = Math.round(px * W);
    let top = Math.round(py * H);
    let width = Math.round(pw * W);
    let height = Math.round(ph * H);

    left = Math.max(0, Math.min(W - 1, left));
    top = Math.max(0, Math.min(H - 1, top));
    width = Math.max(1, Math.min(W - left, width));
    height = Math.max(1, Math.min(H - top, height));

    // 2단계-a: 잘라서 축소 (resize 1회)
    const smallW = Math.max(1, Math.round(width / blockSize));
    const smallH = Math.max(1, Math.round(height / blockSize));
    const small = await sharp(rotated.data)
      .extract({ left, top, width, height })
      .resize(smallW, smallH, { kernel: 'nearest' })
      .toBuffer();

    // 2단계-b: 새 파이프라인에서 원래 크기로 확대 (resize 1회, nearest 로 계단 효과)
    const blurred = await sharp(small)
      .resize(width, height, { kernel: 'nearest' })
      .toBuffer();

    overlays.push({ input: blurred, left, top, _why: box.why || '', _box: `${width}x${height}@${left},${top}` });
  }

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, path.basename(src));
  if (path.resolve(outPath) === path.resolve(src)) {
    throw new Error('출력 경로가 원본과 같습니다. 원본은 절대 덮어쓰지 않습니다.');
  }

  await sharp(rotated.data)
    .composite(overlays.map((o) => ({ input: o.input, left: o.left, top: o.top })))
    .toFile(outPath);

  return { outPath, count: overlays.length, details: overlays.map((o) => `${o._box} (${o._why})`) };
}

(async () => {
  const specFile = process.argv[2];
  if (!specFile) {
    console.error('사용법: node scripts/mosaic.js <spec.json>');
    process.exit(1);
  }
  const specPath = path.resolve(ROOT, specFile);
  if (!fs.existsSync(specPath)) { console.error(`spec 파일이 없습니다: ${specPath}`); process.exit(1); }

  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  const blockSize = Number(spec.blockSize) > 0 ? Number(spec.blockSize) : 14;
  const pad = Number(spec.pad) >= 0 ? Number(spec.pad) : 0;

  const regions = Array.isArray(spec.regions)
    ? spec.regions
    : (spec.image ? [{ image: spec.image, boxes: spec.boxes || [] }] : []);
  if (!regions.length) { console.error('spec.regions 가 비어 있습니다.'); process.exit(1); }

  const report = [];
  let failed = 0;
  for (const r of regions) {
    if (!r.boxes || !r.boxes.length) { console.log(`  · 건너뜀(박스 없음): ${r.image}`); continue; }
    try {
      const res = await processImage(r.image, r.boxes, blockSize, pad);
      console.log(`  ✔ ${r.image} → ${path.relative(ROOT, res.outPath)}  (${res.count}개 영역)`);
      res.details.forEach((d) => console.log(`      - ${d}`));
      report.push({ src: r.image, out: path.relative(ROOT, res.outPath), areas: res.count });
    } catch (e) {
      failed++;
      console.error(`  ✘ ${r.image}: ${e.message}`);
    }
  }

  console.log('\n' + '─'.repeat(56));
  console.log(`  처리 ${report.length}장 / 실패 ${failed}장   블록 크기 ${blockSize}px`);
  console.log(`  원본은 그대로 있습니다. 처리본: input/photos/_mosaic/`);
  console.log('  ❗처리본을 Read로 열어 실제로 가려졌는지 확인하세요.');
  console.log('  ❗덜 가려졌으면 좌표를 키워 다시 실행하세요.');
  console.log('  ❗초안 JSON에는 처리본 경로를 쓰세요.');
  console.log('─'.repeat(56) + '\n');
  if (failed) process.exitCode = 1;
})();
