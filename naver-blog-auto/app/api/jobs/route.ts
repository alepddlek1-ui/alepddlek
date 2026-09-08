export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { jobLog } from "@/lib/log";
import { runJob, runningJobId } from "@/lib/pipeline";
import type { JobInputs } from "@/lib/types";

export async function GET() {
  const rows = getDb()
    .prepare(`SELECT id, keyword, status, stage, mode, error, created_at, updated_at
                FROM jobs ORDER BY id DESC LIMIT 30`)
    .all();
  return NextResponse.json({ jobs: rows });
}

export async function POST(req: Request) {
  // ⚠️ 7-16 — 버튼 연타·SSE 재연결로 같은 잡이 두 번 만들어진다. 진행 중이면 409 로 거절한다.
  const running = runningJobId();
  if (running !== null) {
    return NextResponse.json(
      { error: "이미 만들고 있는 글이 있습니다. 끝나면 다시 눌러주세요.", runningJobId: running },
      { status: 409 },
    );
  }

  const body = (await req.json()) as Partial<JobInputs>;
  const mode = body.mode ?? "auto";
  const keyword = (body.keyword ?? body.topic ?? "").trim();
  if (!keyword) return NextResponse.json({ error: "주제를 입력해 주세요." }, { status: 400 });

  const inputs: JobInputs = {
    mode,
    keyword,
    topic: body.topic,
    points: body.points,
    photoSource: body.photoSource ?? "none",
    imageStyle: body.imageStyle ?? "photo",
    photoDir: body.photoDir,
    photoPlacement: body.photoPlacement ?? "order",
  };

  const r = getDb()
    .prepare(`INSERT INTO jobs (keyword, status, stage, auto, mode, inputs)
              VALUES (?, 'pending', '준비', ?, ?, ?)`)
    .run(keyword, mode === "auto" ? 1 : 0, mode, JSON.stringify(inputs));
  const id = Number(r.lastInsertRowid);
  jobLog(id, "작업을 시작합니다.");

  // ⚠️ 6-10 — fire-and-forget. await 하지 말고 즉시 응답한다. 진행 상황은 SSE 로 본다.
  runJob(id).catch(console.error);

  return NextResponse.json({ id });
}
