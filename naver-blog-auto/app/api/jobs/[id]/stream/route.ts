export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { getDb } from "@/lib/db";

/** SSE — job_logs 를 1초 폴링해 새 줄만 보낸다. 잡이 끝나면 end 를 보내고 닫는다. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const jobId = Number(id);
  const db = getDb();
  let lastId = 0;

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) =>
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

      const tick = () => {
        try {
          const rows = db
            .prepare(`SELECT * FROM job_logs WHERE job_id = ? AND id > ? ORDER BY id`)
            .all(jobId, lastId) as { id: number }[];
          for (const r of rows) {
            lastId = r.id;
            send("log", r);
          }
          const job = db.prepare(`SELECT status, stage FROM jobs WHERE id = ?`).get(jobId) as
            | { status: string; stage: string | null }
            | undefined;
          if (job) send("stage", job);
          if (job && ["done", "failed", "canceled"].includes(job.status)) {
            send("end", job);
            clearInterval(timer);
            controller.close();
          }
        } catch {
          clearInterval(timer);
          try { controller.close(); } catch { /* 이미 닫혔으면 무시 */ }
        }
      };
      const timer = setInterval(tick, 1000);
      tick();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
