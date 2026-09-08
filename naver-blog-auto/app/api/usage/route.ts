export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getUsage } from "@/lib/ai/cfUsage";
import { getSettings } from "@/lib/settings";
import { publishedTodayCount, minutesSinceLastPublish } from "@/lib/db";
import { neuronsPerImage } from "@/lib/ai/neurons";

export async function GET() {
  const s = getSettings();
  return NextResponse.json({
    usage: await getUsage(s.cfImageSteps),
    perImage: neuronsPerImage(s.cfImageSteps),
    publishedToday: publishedTodayCount(),
    dailyPublishLimit: s.dailyPublishLimit,
    minPublishIntervalMin: s.minPublishIntervalMin,
    minutesSinceLastPublish: minutesSinceLastPublish(),
  });
}
