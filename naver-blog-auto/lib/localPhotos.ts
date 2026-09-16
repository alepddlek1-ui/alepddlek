import fs from "node:fs";
import path from "node:path";
import { runClaude } from "@/lib/claude";
import { expandHome } from "@/lib/paths";
import type { PhotoDesc, Section } from "@/lib/types";

const EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic"]);

/** 폴더에서 사진 목록을 읽는다. 파일명 자연순 정렬(1, 2, 10 순서). */
export function listPhotos(dir: string): string[] {
  const root = path.resolve(expandHome(dir));
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root)
    .filter((f) => EXTS.has(path.extname(f).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, "ko", { numeric: true }))
    .map((f) => path.join(root, f));
}

/**
 * 사진마다 한 줄 설명(30자)을 만든다.
 * ⚠️ 6-8/6-10 — 본문 생성 "전에" 한 번만 만들고 그 결과를 프롬프트와 배치에 재사용해야 한다.
 *    이미지 단계에서 다시 만들면 claude 호출이 배로 든다.
 */
export async function describePhotos(files: string[]): Promise<PhotoDesc[]> {
  const out: PhotoDesc[] = [];
  for (const f of files) {
    const r = await runClaude("이 사진에 무엇이 담겼는지 한국어 한 줄(30자 이내)로만 답하세요.", {
      images: [f],
    });
    out.push({
      file: f,
      desc: r.ok ? r.text.trim().split("\n")[0].slice(0, 40) : path.basename(f),
    });
  }
  return out;
}

/**
 * 사진 배치.
 * - order: 글 흐름 순서대로 순차 배치
 * - ai:    사진 설명과 각 자리의 캡션을 claude 가 매칭
 * ⚠️ 매칭 실패·누락분은 반드시 순서대로 채우는 폴백을 둔다.
 */
export async function placePhotos(args: {
  sections: Section[];
  photos: PhotoDesc[];
  placement: "order" | "ai";
}): Promise<string[]> {
  const slots = args.sections
    .map((s, i) => ({ i, s }))
    .filter((x) => x.s.type === "image") as { i: number; s: Extract<Section, { type: "image" }> }[];

  const byOrder = () => slots.map((_, k) => args.photos[k]?.file).filter(Boolean) as string[];

  if (args.placement === "order" || slots.length === 0 || args.photos.length === 0) {
    return byOrder();
  }

  const prompt = [
    "사진들을 글의 사진 자리에 배치하려 한다. 가장 어울리는 짝을 지어 JSON 으로만 답하라.",
    "",
    "사진 목록:",
    ...args.photos.map((p, k) => `  ${k}: ${p.desc}`),
    "",
    "사진 자리:",
    ...slots.map((s, k) => `  ${k}: ${s.s.query}${s.s.caption ? ` / ${s.s.caption}` : ""}`),
    "",
    "한 사진은 한 자리에만 쓴다. 남는 자리는 비워도 된다.",
    `출력 형식: { "pairs": [ { "slot": 0, "photo": 2 } ] }`,
  ].join("\n");

  const r = await runClaude(prompt);
  const assigned: (string | undefined)[] = new Array(slots.length).fill(undefined);
  if (r.ok) {
    try {
      const m = r.text.match(/\{[\s\S]*\}/);
      const j = m ? (JSON.parse(m[0]) as { pairs?: { slot: number; photo: number }[] }) : null;
      const usedPhoto = new Set<number>();
      for (const p of j?.pairs ?? []) {
        const f = args.photos[p.photo]?.file;
        if (f && !usedPhoto.has(p.photo) && p.slot >= 0 && p.slot < slots.length && !assigned[p.slot]) {
          assigned[p.slot] = f;
          usedPhoto.add(p.photo);
        }
      }
    } catch {
      /* 파싱 실패 → 아래 폴백 */
    }
  }

  // 폴백: 매칭 실패·누락분을 남은 사진으로 순서대로 채운다.
  const used = new Set(assigned.filter(Boolean));
  const rest = args.photos.map((p) => p.file).filter((f) => !used.has(f));
  for (let i = 0; i < assigned.length; i++) {
    if (!assigned[i] && rest.length) assigned[i] = rest.shift();
  }
  return assigned.filter(Boolean) as string[];
}
