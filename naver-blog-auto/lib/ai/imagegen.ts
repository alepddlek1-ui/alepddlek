import fs from "node:fs";
import path from "node:path";
import { CONFIG, CF_MODEL } from "@/config";
import { runClaude } from "@/lib/claude";
import { DIRS, ensureDirs } from "@/lib/paths";
import { judgeGenerated } from "@/lib/ai/vision";
import type { GenVerdict, ImageStyle, Section } from "@/lib/types";

export function cfConfigured() {
  return !!(CONFIG.cfAccountId && CONFIG.cfApiToken);
}

const STYLE_TOKENS: Record<ImageStyle, string> = {
  photo:
    "photorealistic photograph, natural lighting, shallow depth of field, 50mm lens, high detail",
  illust:
    "clean flat vector illustration, simple shapes, soft muted color palette, minimal, lots of white space",
};

/** ① claude -p 가 FLUX 용 영문 프롬프트를 설계한다 */
export async function designPrompt(args: {
  title: string;
  query: string;
  caption?: string;
  style: ImageStyle;
  neighbors: string[];
  retryReason?: string;
}): Promise<{ ok: true; prompt: string } | { ok: false; error: string }> {
  const ask = [
    "You design prompts for the FLUX image model. Output ONLY the final prompt, nothing else.",
    "",
    `Blog post title (Korean): ${args.title}`,
    `What this image should show (Korean): ${args.query}`,
    args.caption ? `Caption (Korean): ${args.caption}` : "",
    args.neighbors.length ? `Surrounding text for context (Korean):\n${args.neighbors.join("\n---\n")}` : "",
    args.retryReason
      ? `\nThe previous attempt was rejected: ${args.retryReason}\nFix exactly that problem.`
      : "",
    "",
    "Rules (all mandatory):",
    "- English, ONE paragraph, at most 40 words.",
    "- State subject / composition / lighting / background / texture.",
    `- Must include these style tokens: ${STYLE_TOKENS[args.style]}`,
    "- Must end with exactly: no text, no letters, no words, no watermark, no logo",
    "- No real people, no celebrities, no brand logos.",
    "- If a person is needed, compose so the face is not prominent (hands, back view, silhouette).",
    // 생성 모델이 한글을 깨뜨린다. 한국적 맥락은 반영하되 간판은 넣지 않는다.
    "- Korean context is fine, but never include Korean signage or any written characters.",
  ]
    .filter(Boolean)
    .join("\n");

  const r = await runClaude(ask);
  if (!r.ok) return { ok: false, error: r.error };
  const prompt = r.text.trim().replace(/^["'`]+|["'`]+$/g, "").replace(/\s+/g, " ");
  if (!prompt) return { ok: false, error: "빈 프롬프트가 나왔습니다." };
  return { ok: true, prompt };
}

/** ② Cloudflare Workers AI 로 생성 */
export async function generateImage(
  prompt: string,
  steps: number,
  outPath: string,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  if (!cfConfigured()) return { ok: false, error: "Cloudflare 열쇠가 설정되지 않았습니다." };
  ensureDirs();

  const url = `https://api.cloudflare.com/client/v4/accounts/${CONFIG.cfAccountId}/ai/run/${CF_MODEL}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 90_000);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CONFIG.cfApiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt, steps: Math.min(Math.max(steps, 1), 8) }),
      signal: ac.signal,
    });

    const ctype = resp.headers.get("content-type") || "";
    let buf: Buffer;
    if (ctype.includes("application/json")) {
      // ⚠️ FLUX 응답은 바이너리가 아니라 base64 JSON 이다(6-7).
      const j = (await resp.json()) as {
        success?: boolean;
        result?: { image?: string };
        errors?: { message: string }[];
      };
      if (!resp.ok || j.success === false) {
        return { ok: false, error: j.errors?.map((e) => e.message).join(", ") || `HTTP ${resp.status}` };
      }
      const b64 = j.result?.image;
      if (!b64) return { ok: false, error: "응답에 이미지가 없습니다." };
      buf = Buffer.from(b64, "base64");
    } else {
      // SDXL 계열은 바이너리를 준다. content-type 으로 분기해 두면 모델 교체가 쉽다.
      if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
      buf = Buffer.from(await resp.arrayBuffer());
    }

    if (buf.length < 2000) return { ok: false, error: "생성된 이미지가 너무 작습니다(생성 실패)." };
    fs.writeFileSync(outPath, buf);
    return { ok: true, path: outPath };
  } catch (e) {
    const err = e as Error;
    return {
      ok: false,
      error: err.name === "AbortError" ? "이미지 생성이 90초를 넘겼습니다." : err.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** 앞뒤 문단 맥락(±3섹션에서 2개, 400자) */
export function neighborsOf(sections: Section[], index: number): string[] {
  const out: string[] = [];
  for (let d = 1; d <= 3 && out.length < 2; d++) {
    for (const i of [index - d, index + d]) {
      const s = sections[i];
      if (s && (s.type === "paragraph" || s.type === "quote") && out.length < 2) {
        out.push(s.text.slice(0, 400));
      }
    }
  }
  return out;
}

/**
 * ③ 생성 → 검증 → (부적합하면 이유를 프롬프트 설계에 되먹여) 1회만 재생성.
 * ⚠️ 무한 루프 금지. 두 번째도 실패하면 그 자리는 건너뛴다.
 */
export async function generateAndVerify(args: {
  jobId: number;
  title: string;
  query: string;
  caption?: string;
  style: ImageStyle;
  neighbors: string[];
  steps: number;
  onLog?: (msg: string, level?: "info" | "warn") => void;
}): Promise<
  | { ok: true; path: string; prompt: string; verdict: GenVerdict }
  | { ok: false; error: string; prompt?: string; verdict?: GenVerdict }
> {
  ensureDirs();
  let retryReason: string | undefined;
  let lastPrompt = "";
  let lastVerdict: GenVerdict | undefined;

  for (let attempt = 0; attempt < 2; attempt++) {
    const d = await designPrompt({ ...args, retryReason });
    if (!d.ok) return { ok: false, error: d.error, prompt: lastPrompt, verdict: lastVerdict };
    lastPrompt = d.prompt;

    const file = path.join(
      DIRS.images,
      `gen-job${args.jobId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.png`,
    );
    const g = await generateImage(d.prompt, args.steps, file);
    if (!g.ok) return { ok: false, error: g.error, prompt: d.prompt };

    const verdict = await judgeGenerated(file, { title: args.title, query: args.query });
    lastVerdict = verdict;
    if (verdict.ok) return { ok: true, path: file, prompt: d.prompt, verdict };

    args.onLog?.(`생성 사진이 기준에 안 맞아 다시 그립니다: ${verdict.reason}`, "warn");
    retryReason = verdict.reason;
    try {
      fs.rmSync(file, { force: true });
    } catch {
      /* 무시 */
    }
  }
  return {
    ok: false,
    error: lastVerdict?.reason || "두 번 시도했지만 쓸 만한 사진이 안 나왔습니다.",
    prompt: lastPrompt,
    verdict: lastVerdict,
  };
}
