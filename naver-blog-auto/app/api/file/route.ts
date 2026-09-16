export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { isInsideData, resolveExisting } from "@/lib/paths";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".heic": "image/heic",
};

/**
 * ./data 안쪽 파일만 서빙한다.
 *
 * ⚠️ 경로 탈출 방지(resolve 후 접두사 검사)는 그대로 두고, 비교 전에 **양쪽 다 NFC 정규화**한다(7-23).
 *    macOS 의 process.cwd() 는 한글을 NFD(자모 분해)로 주는데 브라우저가 보내는 URL 파라미터는
 *    NFC(완성형)라, 같은 폴더인데 startsWith 가 false 가 되어 한글 경로에서 모든 이미지가 403 이 된다.
 *    이 앱은 한국 사용자용이라 거의 확실히 밟는 지뢰다. (정규화는 lib/paths.ts 의 normPath 가 한다)
 */
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams.get("path");
  if (!p) return new NextResponse("path 가 없습니다.", { status: 400 });

  if (!isInsideData(p)) return new NextResponse("허용되지 않은 경로입니다.", { status: 403 });
  const real = resolveExisting(p);
  if (!real) return new NextResponse("파일이 없습니다.", { status: 404 });

  const buf = fs.readFileSync(real);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": MIME[path.extname(real).toLowerCase()] ?? "application/octet-stream",
      "Cache-Control": "no-store",
    },
  });
}
