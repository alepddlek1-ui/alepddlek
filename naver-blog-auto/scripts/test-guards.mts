/**
 * 7-22(로컬 날짜 집계) + 발행 가드 3종 검증. 계정도 네트워크도 필요 없다.
 * TZ=Asia/Seoul 로 돌려야 UTC 와 로컬 날짜가 갈린다.
 */
import { getDb, publishedTodayCount, minutesSinceLastPublish } from "@/lib/db";
import { saveSettings, resetSettings } from "@/lib/settings";
import { checkPublishGuards } from "@/lib/naver/publish";

const db = getDb();
db.prepare(`DELETE FROM posts`).run();
resetSettings();

console.log("TZ =", process.env.TZ, "| 지금 로컬:", new Date().toLocaleString("ko-KR"));

// 한국시간 오늘 새벽 2시에 발행한 글 — UTC 로는 "어제 17시"다.
const now = new Date();
const dawnLocal = new Date(now);
dawnLocal.setHours(2, 0, 0, 0);
const storedUtc = dawnLocal.toISOString();
console.log("저장할 값(UTC ISO):", storedUtc, "→ 로컬로는", dawnLocal.toLocaleString("ko-KR"));

db.prepare(
  `INSERT INTO posts (job_id, draft_id, status, published_at) VALUES (0, 0, 'published', ?)`,
).run(storedUtc);

// 틀린 방식(UTC 날짜 vs 로컬 날짜)과 맞는 방식을 나란히 재본다
const wrong = (
  db.prepare(
    `SELECT COUNT(*) n FROM posts WHERE status='published' AND date(published_at) = date('now','localtime')`,
  ).get() as { n: number }
).n;
const right = publishedTodayCount();
console.log(`  틀린 집계(UTC 날짜 비교): ${wrong}편`);
console.log(`  맞는 집계(양쪽 localtime): ${right}편`);

const fails: string[] = [];
if (right !== 1) fails.push(`7-22 로컬 날짜 집계가 새벽 발행분을 놓쳤다 (${right}편)`);

// ── 가드 3종 ──────────────────────────────────
db.prepare(`DELETE FROM posts`).run();

// ① 한도
saveSettings({ dailyPublishLimit: 1, minPublishIntervalMin: 0, killSwitch: false });
db.prepare(`INSERT INTO posts (job_id, draft_id, status, published_at) VALUES (0,0,'published',?)`)
  .run(new Date().toISOString());
const g1 = checkPublishGuards();
console.log("① 하루 한도:", g1.ok ? "통과(문제)" : `막힘 — ${g1.reason}`);
if (g1.ok) fails.push("하루 한도 가드가 막지 않았다");

// ② 간격
saveSettings({ dailyPublishLimit: 50, minPublishIntervalMin: 30 });
const g2 = checkPublishGuards();
console.log("② 발행 간격:", g2.ok ? "통과(문제)" : `막힘 — ${g2.reason}`);
if (g2.ok) fails.push("발행 간격 가드가 막지 않았다");
console.log("   마지막 발행 후:", minutesSinceLastPublish()?.toFixed(2), "분");

// ③ 전체 중단
saveSettings({ minPublishIntervalMin: 0, killSwitch: true });
const g3 = checkPublishGuards();
console.log("③ 전체 중단:", g3.ok ? "통과(문제)" : `막힘 — ${g3.reason}`);
if (g3.ok) fails.push("전체 중단 가드가 막지 않았다");

// ④ 아무 제약 없으면 통과해야 한다
db.prepare(`DELETE FROM posts`).run();
saveSettings({ killSwitch: false, minPublishIntervalMin: 30, dailyPublishLimit: 3 });
const g4 = checkPublishGuards();
console.log("④ 제약 없음:", g4.ok ? "통과" : `막힘(문제) — ${g4.reason}`);
if (!g4.ok) fails.push("제약이 없는데도 막았다");

// ⚠️ 8-3 — 테스트 때문에 낮춘 안전장치는 반드시 되돌린다.
resetSettings();
db.prepare(`DELETE FROM posts`).run();
console.log("\n안전장치를 기본값으로 되돌렸습니다.");

console.log(fails.length ? "✗ " + fails.join("\n✗ ") : "✓ 7-22 와 발행 가드 3종 전부 통과");
process.exit(fails.length ? 1 : 0);
