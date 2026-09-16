export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { checkClaude, invalidateClaudeCache } from "@/lib/claude";
import { verifySession, hasSessionFile } from "@/lib/naver/session";
import { cfConfigured } from "@/lib/ai/imagegen";
import { getSettings, LIMITS } from "@/lib/settings";
import { publishedTodayCount, minutesSinceLastPublish } from "@/lib/db";
import { runningJobId } from "@/lib/pipeline";

export async function GET(req: Request) {
  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  if (refresh) invalidateClaudeCache();
  const [claude, session] = await Promise.all([
    checkClaude(refresh),
    hasSessionFile() ? verifySession(refresh) : Promise.resolve({ ok: false, reason: "아직 네이버에 로그인하지 않았습니다.", checkedAt: Date.now() }),
  ]);
  return NextResponse.json({
    claude,
    session,
    cloudflare: { configured: cfConfigured() },
    settings: getSettings(),
    limits: LIMITS,
    publishedToday: publishedTodayCount(),
    minutesSinceLastPublish: minutesSinceLastPublish(),
    runningJobId: runningJobId(),
  });
}
