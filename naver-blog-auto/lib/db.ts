import Database from "better-sqlite3";
import { DIRS, ensureDirs } from "@/lib/paths";

/**
 * ⚠️ globalThis 캐싱은 선택이 아니다 → 7-17.
 *    Next.js dev 의 HMR 이 모듈을 여러 번 평가해서, 캐싱하지 않으면
 *    SQLite 파일 핸들이 계속 쌓인다.
 */
declare global {
  // eslint-disable-next-line no-var
  var __blogDb: Database.Database | undefined;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending',
  stage      TEXT,
  auto       INTEGER NOT NULL DEFAULT 1,
  mode       TEXT NOT NULL DEFAULT 'auto',
  inputs     TEXT,
  error      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sources (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id     INTEGER NOT NULL,
  type       TEXT NOT NULL,
  title      TEXT,
  summary    TEXT,
  url        TEXT,
  content    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ideas (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id     INTEGER NOT NULL,
  title      TEXT NOT NULL,
  angle      TEXT,
  rationale  TEXT,
  chosen     INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS drafts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id     INTEGER NOT NULL,
  idea_id    INTEGER,
  title      TEXT NOT NULL,
  body_json  TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS images (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id         INTEGER NOT NULL,
  draft_id       INTEGER,
  query          TEXT,
  src_url        TEXT,
  local_path     TEXT,
  source_site    TEXT,
  verdict_ok     INTEGER NOT NULL DEFAULT 0,
  verdict_reason TEXT,
  section_index  INTEGER,
  gen_prompt     TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS posts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id       INTEGER NOT NULL,
  draft_id     INTEGER,
  status       TEXT NOT NULL DEFAULT 'pending',
  blog_url     TEXT,
  screenshot   TEXT,
  note         TEXT,
  published_at TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS job_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id     INTEGER NOT NULL,
  level      TEXT NOT NULL DEFAULT 'info',
  message    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_logs_job    ON job_logs(job_id, id);
CREATE INDEX IF NOT EXISTS idx_images_job  ON images(job_id);
CREATE INDEX IF NOT EXISTS idx_posts_job   ON posts(job_id);
CREATE INDEX IF NOT EXISTS idx_sources_job ON sources(job_id);
CREATE INDEX IF NOT EXISTS idx_ideas_job   ON ideas(job_id);
`;

/** 기존 DB 를 날리지 않고 컬럼만 덧붙이는 마이그레이션 */
function migrate(db: Database.Database) {
  const wanted: Record<string, Record<string, string>> = {
    jobs: { mode: "TEXT NOT NULL DEFAULT 'auto'", inputs: "TEXT", stage: "TEXT", error: "TEXT" },
    images: { gen_prompt: "TEXT", section_index: "INTEGER", source_site: "TEXT" },
    posts: { note: "TEXT", screenshot: "TEXT", published_at: "TEXT" },
  };
  for (const [table, cols] of Object.entries(wanted)) {
    const have = new Set(
      (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((r) => r.name),
    );
    for (const [col, decl] of Object.entries(cols)) {
      if (!have.has(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`);
    }
  }
}

export function getDb(): Database.Database {
  if (globalThis.__blogDb) return globalThis.__blogDb;
  ensureDirs();
  const db = new Database(DIRS.db);
  // SSE 폴링(읽기)과 파이프라인(쓰기)이 동시에 일어난다.
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec(SCHEMA);
  migrate(db);
  globalThis.__blogDb = db;
  return db;
}

export function touchJob(id: number) {
  getDb().prepare(`UPDATE jobs SET updated_at = datetime('now') WHERE id = ?`).run(id);
}

export function setJobStage(id: number, status: string, stage?: string) {
  getDb()
    .prepare(`UPDATE jobs SET status = ?, stage = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(status, stage ?? null, id);
}

export function failJob(id: number, error: string) {
  getDb()
    .prepare(`UPDATE jobs SET status='failed', error=?, updated_at=datetime('now') WHERE id=?`)
    .run(error, id);
}

/**
 * 오늘 발행 수.
 * ⚠️ datetime('now') 는 UTC 다 → 7-22.
 *    "오늘 몇 편"은 로컬 날짜 개념이므로 반드시 양쪽 다 localtime 으로 변환한다.
 *    (한국시간 새벽 2시 발행이 UTC 로는 어제라서 집계에서 통째로 빠진 사례가 있다)
 */
export function publishedTodayCount(): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM posts
        WHERE status = 'published'
          AND date(published_at, 'localtime') = date('now', 'localtime')`,
    )
    .get() as { n: number };
  return row?.n ?? 0;
}

/** 마지막 발행 이후 지난 분(minute). 발행 이력이 없으면 null */
export function minutesSinceLastPublish(): number | null {
  const row = getDb()
    .prepare(
      `SELECT (julianday('now') - julianday(published_at)) * 24 * 60 AS m
         FROM posts WHERE status='published' AND published_at IS NOT NULL
        ORDER BY published_at DESC LIMIT 1`,
    )
    .get() as { m: number } | undefined;
  return row ? row.m : null;
}
