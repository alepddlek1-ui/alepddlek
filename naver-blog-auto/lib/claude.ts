import { spawn } from "node:child_process";
import type { z } from "zod";
import { CONFIG } from "@/config";
import { getSettings } from "@/lib/settings";

/**
 * ⚠️ Anthropic API 키를 쓰지 않는다(2-1).
 *    API 키를 쓰면 종량 과금이 된다. 이 앱은 사용자의 Claude 구독요금제로 돌아가야 하므로
 *    로컬에 설치된 claude CLI 를 자식 프로세스로 실행한다.
 *
 * ⚠️ 프롬프트는 반드시 stdin 으로 넘긴다.
 *    argv 로 넘기면 긴 한글에서 escaping 이 깨진다.
 *    덤으로, argv 에 사용자 입력이 없으니 윈도우에서 shell:true 를 써도 안전하다.
 */

/**
 * claude CLI 가 내는 영어 메시지를 사용자가 읽을 수 있는 말로 바꾼다.
 *
 * ⚠️ 8-6 — 에러 원문을 사용자에게 그대로 넘기지 마라.
 *    "무슨 뜻인지 한 줄 + 어떻게 하면 되는지 한 줄" 로 바꿔야 한다.
 *    실제로 사용자가 `Failed to authenticate: OAuth session expired and could not be
 *    refreshed` 를 받고 앱이 고장난 줄 알았다. 실제로는 claude 로그인이 풀린 것뿐이었다.
 */
export function friendlyClaudeError(raw: string): string {
  const t = raw ?? "";
  if (/OAuth session expired|Failed to authenticate|Please run .?claude login|not logged in|Invalid API key|authentication_error/i.test(t)) {
    return "AI 프로그램 로그인이 풀렸습니다. 명령어를 입력하는 창을 새로 열어 claude 를 실행하고 다시 로그인한 뒤, 이 버튼을 한 번 더 눌러주세요.";
  }
  if (/session limit|usage limit|rate.?limit|quota|429/i.test(t)) {
    const when = t.match(/resets?\s+([^\n.]{1,40})/i);
    return `오늘 쓸 수 있는 AI 사용량을 다 썼습니다.${when ? ` ${when[1].trim()}쯤 다시 쓸 수 있습니다.` : " 잠시 뒤에 다시 시도해 주세요."}`;
  }
  if (/ENOENT|not recognized|command not found|spawn .* failed/i.test(t)) {
    return "AI 를 실행하는 프로그램을 찾지 못했습니다. claude 가 설치돼 있는지 확인해 주세요.";
  }
  if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|network|fetch failed/i.test(t)) {
    return "인터넷 연결이 잠깐 끊긴 것 같습니다. 잠시 뒤 다시 시도해 주세요.";
  }
  if (/overloaded|529|503/i.test(t)) {
    return "AI 쪽이 지금 많이 붐빕니다. 잠시 뒤 다시 시도해 주세요.";
  }
  return t;
}

type Ok = { ok: true; text: string };
type Err = { ok: false; error: string };
export type ClaudeResult = Ok | Err;

// ── 동시성 세마포어 ──────────────────────────────────
// claude 프로세스를 무제한으로 띄우면 머신이 죽는다.
let active = 0;
const waiters: (() => void)[] = [];

async function acquire(limit: number) {
  // ⚠️ 한도는 "호출 시점에" 읽는다 — 설정 변경이 즉시 반영되어야 한다.
  if (active < limit) {
    active++;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  active++;
}
function release() {
  active = Math.max(0, active - 1);
  const next = waiters.shift();
  if (next) next();
}

const isWin = process.platform === "win32";

function spawnClaude(args: string[], bin = CONFIG.claudeBin) {
  // ⚠️ 윈도우: npm 전역 바이너리는 claude.cmd 셸 심이라 spawn 이 직접 실행하지 못하고
  //    ENOENT 로 죽는다. shell:true 로 우회한다(프롬프트가 stdin 이라 안전).
  return spawn(bin, args, { shell: isWin, stdio: ["pipe", "pipe", "pipe"] });
}

export async function runClaude(
  prompt: string,
  opts?: { images?: string[]; system?: string },
): Promise<ClaudeResult> {
  const s = getSettings();
  await acquire(s.claudeConcurrency);
  try {
    // 이미지 첨부: 프롬프트 끝에 @절대경로 를 공백으로 붙이면 claude 가 읽는다(프로젝트 밖 경로도 됨).
    //
    // ⚠️ 경로는 반드시 큰따옴표로 감싼다. 공백이 든 경로에서 @ 토큰이 공백에서 끊기기 때문이다.
    //    틀린 추측: 에러 문구가 "이미지 읽기 권한이 없습니다" 라서 권한 문제로 보이지만 아니다 —
    //    claude 가 잘린 경로("…/시험")를 못 찾아 읽기를 시도하다 나온 메시지다.
    //    실측(같은 파일, 세 형태):
    //      @/tmp/시험 사진.png    → 실패("권한 없음")
    //      @/tmp/시험\ 사진.png   → 실패(백슬래시 이스케이프는 통하지 않는다)
    //      @"/tmp/시험 사진.png"  → 성공
    //    공백 없는 경로도 따옴표로 감싸서 문제없으므로 항상 감싼다.
    //    한국 사용자의 사진 폴더 이름에는 공백이 흔하다.
    const imgs = (opts?.images ?? []).map((p) => `@"${p}"`).join(" ");
    const full = [opts?.system, prompt, imgs].filter(Boolean).join("\n\n");

    return await new Promise<ClaudeResult>((resolve) => {
      let p: ReturnType<typeof spawnClaude>;
      try {
        p = spawnClaude(["-p", "--output-format", "json"]);
      } catch (e) {
        resolve({ ok: false, error: `claude 실행 실패: ${(e as Error).message}` });
        return;
      }

      let out = "";
      let err = "";
      let settled = false;
      const done = (r: ClaudeResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(r);
      };

      const timer = setTimeout(
        () => {
          try {
            p.kill("SIGKILL");
          } catch {
            /* 이미 죽었으면 무시 */
          }
          done({ ok: false, error: `claude 응답이 ${s.claudeTimeoutSec}초 안에 오지 않았습니다.` });
        },
        s.claudeTimeoutSec * 1000,
      );

      p.stdout.on("data", (d) => (out += d.toString()));
      p.stderr.on("data", (d) => (err += d.toString()));
      p.on("error", (e) =>
        done({ ok: false, error: friendlyClaudeError(e.message) }),
      );
      p.on("close", (code) => {
        if (!out.trim()) {
          done({ ok: false, error: friendlyClaudeError(err.trim()) || `claude 가 코드 ${code} 로 끝났습니다.` });
          return;
        }
        try {
          const j = JSON.parse(out) as {
            type?: string;
            result?: string;
            is_error?: boolean;
            error?: string;
          };
          // ⚠️ 실제 응답에는 usage, modelUsage, permission_denials 등 필드가 20개 넘게 더 들어 있다.
          //    정상이다. .result 만 읽으면 된다.
          if (j.is_error) {
            done({ ok: false, error: friendlyClaudeError(String(j.result ?? j.error ?? "claude 오류")) });
            return;
          }
          if (typeof j.result === "string") {
            done({ ok: true, text: j.result });
            return;
          }
        } catch {
          /* JSON 이 아니면 raw stdout 폴백 */
        }
        done({ ok: true, text: out });
      });

      try {
        p.stdin.write(full);
        p.stdin.end();
      } catch (e) {
        done({ ok: false, error: `프롬프트 전달 실패: ${(e as Error).message}` });
      }
    });
  } finally {
    release();
  }
}

const JSON_SYSTEM =
  "반드시 유효한 JSON 만 출력하라. 설명/마크다운/코드펜스 없이 JSON 객체 또는 배열만 반환하라.";

/**
 * 응답에서 JSON 을 뽑아낸다.
 * AI 는 지시해도 앞뒤에 말을 붙인다 — ① 코드펜스 우선 ② 없으면 첫 괄호부터 짝까지.
 */
export function extractJson(text: string): string | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]?.trim()) return fence[1].trim();

  const iObj = text.indexOf("{");
  const iArr = text.indexOf("[");
  const starts = [iObj, iArr].filter((i) => i >= 0);
  if (!starts.length) return null;
  const start = Math.min(...starts);
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  const end = text.lastIndexOf(close);
  if (end <= start) return null;
  return text.slice(start, end + 1).trim();
}

export async function runClaudeJson<S extends z.ZodTypeAny>(
  prompt: string,
  schema: S,
  opts?: { images?: string[]; system?: string; retries?: number },
): Promise<{ ok: true; data: z.output<S> } | { ok: false; error: string }> {
  const retries = opts?.retries ?? 2;
  let lastError = "알 수 없는 오류";

  for (let attempt = 0; attempt <= retries; attempt++) {
    const hint =
      attempt === 0 ? "" : `\n\n(직전 응답이 형식에 맞지 않았습니다: ${lastError} — 형식을 정확히 지켜 다시 출력하세요.)`;
    const r = await runClaude(prompt + hint, {
      images: opts?.images,
      system: [opts?.system, JSON_SYSTEM].filter(Boolean).join("\n"),
    });
    if (!r.ok) {
      lastError = r.error;
      // 실행 자체가 실패한 경우(한도 초과 등)는 재시도해도 같으므로 즉시 반환
      return { ok: false, error: r.error };
    }
    const raw = extractJson(r.text);
    if (!raw) {
      lastError = "JSON 을 찾지 못했습니다.";
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      lastError = `JSON 파싱 실패: ${(e as Error).message}`;
      continue;
    }
    const v = schema.safeParse(parsed);
    if (v.success) return { ok: true, data: v.data };
    // Zod 검증 실패도 재시도 사유다.
    lastError = v.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" / ");
  }
  return { ok: false, error: lastError };
}

export async function checkClaude(): Promise<{ ok: boolean; version?: string; error?: string }> {
  return new Promise((resolve) => {
    let p: ReturnType<typeof spawnClaude>;
    try {
      p = spawnClaude(["--version"]);
    } catch (e) {
      resolve({ ok: false, error: (e as Error).message });
      return;
    }
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      try {
        p.kill("SIGKILL");
      } catch {
        /* noop */
      }
      resolve({ ok: false, error: "claude --version 이 20초 안에 답하지 않았습니다." });
    }, 20_000);
    p.stdout.on("data", (d) => (out += d.toString()));
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("error", (e) => {
      clearTimeout(timer);
      resolve({ ok: false, error: e.message });
    });
    p.on("close", () => {
      clearTimeout(timer);
      const v = out.trim();
      if (v) resolve({ ok: true, version: v });
      else resolve({ ok: false, error: err.trim() || "claude 를 찾지 못했습니다." });
    });
  });
}
