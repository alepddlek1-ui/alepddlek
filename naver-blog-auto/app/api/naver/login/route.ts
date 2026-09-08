export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 로그인 창을 최대 5분 열어두므로 함수 실행 시간을 넉넉히 잡는다.
export const maxDuration = 600;

import { NextResponse } from "next/server";
import { loginInteractive, invalidateSessionCache } from "@/lib/naver/session";

export async function POST() {
  const r = await loginInteractive();
  invalidateSessionCache();
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
