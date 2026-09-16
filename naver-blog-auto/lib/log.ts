import { getDb } from "@/lib/db";

export type LogLevel = "info" | "warn" | "error";

export function jobLog(jobId: number, message: string, level: LogLevel = "info") {
  try {
    getDb()
      .prepare(`INSERT INTO job_logs (job_id, level, message) VALUES (?, ?, ?)`)
      .run(jobId, level, message);
  } catch {
    /* 로그 실패로 파이프라인을 죽이지 않는다 */
  }
  const tag = level === "error" ? "✗" : level === "warn" ? "!" : "·";
  console.log(`[job ${jobId}] ${tag} ${message}`);
}
