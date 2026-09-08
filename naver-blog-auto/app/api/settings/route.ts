export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getSettings, saveSettings, resetSettings, SETTING_KEYS, LIMITS } from "@/lib/settings";

export async function GET() {
  return NextResponse.json({ settings: getSettings(), limits: LIMITS });
}

export async function POST(req: Request) {
  const body = (await req.json()) as Record<string, unknown> & { reset?: boolean };
  if (body.reset) return NextResponse.json({ settings: resetSettings(), limits: LIMITS });

  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (!SETTING_KEYS.includes(k as (typeof SETTING_KEYS)[number])) {
      return NextResponse.json({ error: `알 수 없는 설정입니다: ${k}` }, { status: 400 });
    }
    patch[k] = v;
  }
  // 범위를 벗어난 값은 서버가 잘라낸다(클램프). UI 에서 막지 않는다.
  return NextResponse.json({ settings: saveSettings(patch), limits: LIMITS });
}
