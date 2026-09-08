export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const jobId = Number(id);
  const db = getDb();
  const job = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(jobId);
  if (!job) return NextResponse.json({ error: "없는 작업입니다." }, { status: 404 });

  return NextResponse.json({
    job,
    sources: db.prepare(`SELECT * FROM sources WHERE job_id = ? ORDER BY id`).all(jobId),
    ideas: db.prepare(`SELECT * FROM ideas WHERE job_id = ? ORDER BY id`).all(jobId),
    draft: db.prepare(`SELECT * FROM drafts WHERE job_id = ? ORDER BY id DESC LIMIT 1`).get(jobId),
    images: db.prepare(`SELECT * FROM images WHERE job_id = ? ORDER BY id`).all(jobId),
    post: db.prepare(`SELECT * FROM posts WHERE job_id = ? ORDER BY id DESC LIMIT 1`).get(jobId),
    logs: db.prepare(`SELECT * FROM job_logs WHERE job_id = ? ORDER BY id`).all(jobId),
  });
}
