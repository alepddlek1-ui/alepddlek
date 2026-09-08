export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

import { execFile } from "node:child_process";
import { NextResponse } from "next/server";

/**
 * ⚠️ 7-14 — 브라우저의 <input webkitdirectory> 는 보안상 상대 경로만 준다.
 *    Playwright 업로드에 쓸 수 없으므로, 로컬 전용 앱답게 백엔드에서 OS 네이티브 대화상자를 띄운다.
 *
 * ⚠️ 취소 판정이 플랫폼마다 다르다:
 *      macOS  — stderr 의 "User canceled"
 *      윈도우 — stdout 이 비어 있는 것
 *    ⚠️ 윈도우는 `-STA` 가 반드시 필요하다. WinForms 대화상자는 STA 아파트먼트에서만 뜬다. (미검증)
 *    ⚠️ 2분 타임아웃 필수 — 사용자가 대화상자를 방치하면 서버 요청이 영원히 안 끝난다.
 */
function pick(): Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }> {
  const timeout = 120_000;

  return new Promise((resolve) => {
    const strip = (s: string) => s.trim().replace(/[\\/\\\\]+$/, ""); // 끝의 / 와 \ 모두 제거

    if (process.platform === "darwin") {
      execFile(
        "osascript",
        ["-e", 'POSIX path of (choose folder with prompt "사진이 든 폴더를 골라주세요")'],
        { timeout },
        (err, stdout, stderr) => {
          if (/User canceled/i.test(stderr || "")) return resolve({ ok: false, canceled: true });
          if (err) return resolve({ ok: false, error: "폴더 선택 창을 띄우지 못했습니다." });
          const p = strip(stdout);
          resolve(p ? { ok: true, path: p } : { ok: false, canceled: true });
        },
      );
      return;
    }

    if (process.platform === "win32") {
      execFile(
        "powershell",
        [
          "-NoProfile",
          "-STA", // ⚠️ 없으면 대화상자가 아예 뜨지 않는다
          "-Command",
          "Add-Type -AssemblyName System.Windows.Forms; " +
            "$f = New-Object System.Windows.Forms.FolderBrowserDialog; " +
            "if ($f.ShowDialog() -eq 'OK') { $f.SelectedPath }",
        ],
        { timeout, shell: true },
        (err, stdout) => {
          const p = strip(stdout || "");
          // 윈도우는 stdout 이 비어 있는 것이 "취소"다.
          if (!p) return resolve({ ok: false, canceled: !err, error: err ? "폴더 선택 창을 띄우지 못했습니다." : undefined });
          resolve({ ok: true, path: p });
        },
      );
      return;
    }

    resolve({ ok: false, error: "이 컴퓨터에서는 폴더 선택 창을 띄울 수 없습니다. 경로를 직접 입력해 주세요." });
  });
}

export async function POST() {
  return NextResponse.json(await pick());
}
