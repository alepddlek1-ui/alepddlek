import fs from "node:fs";
import { CONFIG } from "@/config";
import { getDb, setJobStage, failJob } from "@/lib/db";
import { jobLog } from "@/lib/log";
import { getSettings } from "@/lib/settings";
import { collectSources, type Source } from "@/lib/scrape/trends";
import { generateIdeas, generateDraft } from "@/lib/ai/content";
import { findImageFor } from "@/lib/scrape/images";
import { generateAndVerify, neighborsOf, cfConfigured } from "@/lib/ai/imagegen";
import { listPhotos, describePhotos, placePhotos } from "@/lib/localPhotos";
import { verifySession } from "@/lib/naver/session";
import { publishPost } from "@/lib/naver/publish";
import type { Draft, JobInputs, PhotoDesc } from "@/lib/types";

/**
 * 이미지 채우기.
 * ⚠️ 6-10 — photoDescs 를 **인자로 받아야 한다. 내부에서 만들지 마라.**
 *    본문 생성 단계에서 만든 사진 설명을 그대로 넘겨 재사용한다.
 *    인자로 받지 않으면 이미지 단계에서 다시 만들게 되고 claude 호출이 배로 든다.
 */
async function fillImages(
  jobId: number,
  draftId: number,
  draft: Draft,
  opts: {
    photoSource: JobInputs["photoSource"];
    imageStyle: JobInputs["imageStyle"];
    photos: string[];
    photoDescs: PhotoDesc[];
    photoPlacement: "order" | "ai";
  },
): Promise<Map<number, string>> {
  const db = getDb();
  const s = getSettings();
  const out = new Map<number, string>();
  const log = (m: string, l: "info" | "warn" = "info") => jobLog(jobId, m, l);

  const insert = db.prepare(
    `INSERT INTO images (job_id, draft_id, query, src_url, local_path, source_site,
                         verdict_ok, verdict_reason, section_index, gen_prompt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const slots = draft.sections
    .map((sec, i) => ({ sec, i }))
    .filter((x) => x.sec.type === "image") as {
    sec: Extract<Draft["sections"][number], { type: "image" }>;
    i: number;
  }[];

  if (opts.photoSource === "none" || slots.length === 0) return out;

  if (opts.photoSource === "local") {
    const placed = await placePhotos({
      sections: draft.sections,
      photos: opts.photoDescs,
      placement: opts.photoPlacement,
    });
    placed.forEach((file, k) => {
      const slot = slots[k];
      if (!slot || !file) return;
      out.set(slot.i, file);
      // 사용자가 직접 찍은 사진이라 워터마크·초상권 필터를 적용하지 않는다.
      insert.run(jobId, draftId, slot.sec.query, null, file, "local", 1, "내 사진", slot.i, null);
    });
    log(`내 사진 ${out.size}장을 배치했습니다.`);
    return out;
  }

  if (opts.photoSource === "ai") {
    if (!cfConfigured()) {
      log("AI 사진 생성 열쇠가 없어 사진 없이 진행합니다.", "warn");
      return out;
    }
    for (const { sec, i } of slots) {
      const r = await generateAndVerify({
        jobId,
        title: draft.title,
        query: sec.query,
        caption: sec.caption,
        style: opts.imageStyle ?? "photo",
        neighbors: neighborsOf(draft.sections, i),
        steps: s.cfImageSteps,
        onLog: log,
      });
      if (r.ok) {
        out.set(i, r.path);
        insert.run(jobId, draftId, sec.query, null, r.path, "ai", 1, r.verdict.reason, i, r.prompt);
      } else {
        insert.run(jobId, draftId, sec.query, null, null, "ai", 0, r.error, i, r.prompt ?? null);
        log(`"${sec.query}" 자리는 사진을 못 만들어 비워둡니다: ${r.error}`, "warn");
      }
    }
    log(`AI 사진 ${out.size}장을 만들었습니다.`);
    return out;
  }

  // crawl
  for (const { sec, i } of slots) {
    const r = await findImageFor({
      jobId,
      query: sec.query,
      title: draft.title,
      caption: sec.caption,
      candidates: s.imageCandidates,
      showBrowser: s.showBrowser,
      onLog: log,
    });
    // ⚠️ 탈락한 이미지도 사유와 함께 기록한다 — 워터마크·초상권 필터가 실제로 동작하는지
    //    사용자가 확인할 수 있는 유일한 통로다(6-6).
    for (const rej of r.rejected) {
      insert.run(jobId, draftId, sec.query, rej.srcUrl, null, rej.site, 0, rej.verdict.reason, i, null);
    }
    if (r.adopted) {
      out.set(i, r.adopted.localPath);
      insert.run(
        jobId, draftId, sec.query, r.adopted.srcUrl, r.adopted.localPath,
        r.adopted.site, 1, r.adopted.verdict.reason, i, null,
      );
    } else {
      log(`"${sec.query}" 자리는 쓸 만한 사진을 못 찾아 비워둡니다.`, "warn");
    }
  }
  log(`검색 사진 ${out.size}장을 채택했습니다.`);
  return out;
}

export async function runJob(jobId: number): Promise<void> {
  const db = getDb();
  const log = (m: string, l: "info" | "warn" | "error" = "info") => jobLog(jobId, m, l);

  try {
    const job = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(jobId) as
      | { id: number; keyword: string; inputs: string | null; mode: string }
      | undefined;
    if (!job) return;

    const inputs = JSON.parse(job.inputs || "{}") as JobInputs;
    const s = getSettings();

    // ── 내 사진: 목록과 설명을 여기서 "한 번만" 만든다(6-8/6-10) ──
    let photos: string[] = [];
    let photoDescs: PhotoDesc[] = [];
    if (inputs.photoSource === "local" && inputs.photoDir) {
      photos = listPhotos(inputs.photoDir);
      if (!photos.length) {
        failJob(jobId, "사진 폴더에서 사진을 찾지 못했습니다.");
        log("사진 폴더에 쓸 수 있는 사진이 없습니다.", "error");
        return;
      }
      log(`내 사진 ${photos.length}장을 찾았습니다. 사진마다 한 줄 설명을 만듭니다.`);
      photoDescs = await describePhotos(photos);
    }

    // ── 수집 ──
    let sources: Source[] = [];
    if (inputs.mode === "auto") {
      setJobStage(jobId, "scraping", "자료 수집");
      log(`"${job.keyword}" 로 뉴스·블로그를 모읍니다.`);
      sources = await collectSources(job.keyword, s.scrapeTopN, s.showBrowser);
      log(`자료 ${sources.length}건을 모았습니다.`);
      const ins = db.prepare(
        `INSERT INTO sources (job_id, type, title, summary, url) VALUES (?, ?, ?, ?, ?)`,
      );
      for (const src of sources) ins.run(jobId, src.type, src.title, src.summary, src.url);
    }

    // ── 글감 ──
    let chosenIdea;
    if (inputs.mode === "auto") {
      setJobStage(jobId, "writing", "글감 고르기");
      const ideas = await generateIdeas(job.keyword, sources, 5);
      if (!ideas.ok) {
        failJob(jobId, ideas.error);
        log(`글감을 만들지 못했습니다: ${ideas.error}`, "error");
        return;
      }
      const ins = db.prepare(
        `INSERT INTO ideas (job_id, title, angle, rationale, chosen) VALUES (?, ?, ?, ?, ?)`,
      );
      ideas.ideas.forEach((idea, k) => ins.run(jobId, idea.title, idea.angle, idea.rationale, k === 0 ? 1 : 0));
      chosenIdea = ideas.ideas[0];
      log(`글감 ${ideas.ideas.length}개 중 "${chosenIdea.title}" 로 씁니다.`);
    }

    // ── 본문 ──
    setJobStage(jobId, "writing", "글 쓰기");
    log("글을 씁니다. 1~3분 걸립니다.");
    const d = await generateDraft({
      inputs,
      idea: chosenIdea,
      sources,
      photoCount: photos.length,
      photoDescs,
    });
    if (!d.ok) {
      failJob(jobId, d.error);
      log(`글을 쓰지 못했습니다: ${d.error}`, "error");
      return;
    }
    if (d.droppedHighlights) {
      log(`본문에 없는 강조 표시 ${d.droppedHighlights}개를 걷어냈습니다.`, "warn");
    }
    const draft = d.draft;
    const draftRow = db
      .prepare(`INSERT INTO drafts (job_id, idea_id, title, body_json) VALUES (?, ?, ?, ?)`)
      .run(jobId, null, draft.title, JSON.stringify(draft.sections));
    const draftId = Number(draftRow.lastInsertRowid);
    log(`"${draft.title}" — 문단 ${draft.sections.length}개를 썼습니다.`);

    // ── 사진 ──
    setJobStage(jobId, "imaging", "사진 준비");
    const imageBySection = await fillImages(jobId, draftId, draft, {
      photoSource: inputs.photoSource,
      imageStyle: inputs.imageStyle,
      photos,
      photoDescs,
      photoPlacement: inputs.photoPlacement ?? "order",
    });

    // ── 발행 ──
    setJobStage(jobId, "publishing", s.dryRun ? "연습 모드로 완성" : "발행");
    const session = await verifySession();
    if (!session.ok || !session.blogId) {
      const note = session.reason ?? "네이버 로그인이 필요합니다.";
      db.prepare(
        `INSERT INTO posts (job_id, draft_id, status, note) VALUES (?, ?, 'failed', ?)`,
      ).run(jobId, draftId, note);
      failJob(jobId, note);
      log(note, "error");
      return;
    }

    log(s.dryRun ? "연습 모드로 글쓰기 화면을 채웁니다." : "네이버에 글을 올립니다.");

    // ⚠️ 6-10 — 발행 단계에 15분 상한. 에디터가 멈추면 잡이 영원히 publishing 으로 남는다.
    const result = await Promise.race([
      publishPost({
        jobId,
        draft,
        imageBySection,
        blogId: session.blogId,
        dryRun: s.dryRun,
        visibility: s.visibility,
        headingAsQuote: inputs.mode !== "auto",
        showBrowser: s.showBrowser,
        log,
      }),
      new Promise<null>((r) => setTimeout(() => r(null), CONFIG.publishStageTimeoutMs)),
    ]);

    if (!result) {
      const note = "글쓰기 화면이 응답하지 않아 15분 만에 중단했습니다.";
      db.prepare(`INSERT INTO posts (job_id, draft_id, status, note) VALUES (?, ?, 'failed', ?)`).run(
        jobId, draftId, note,
      );
      failJob(jobId, note);
      log(note, "error");
      return;
    }

    // published 일 때만 published_at 을 채운다 — 발행 한도 계산의 근거다.
    db.prepare(
      `INSERT INTO posts (job_id, draft_id, status, blog_url, screenshot, note, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      jobId, draftId, result.status, result.blogUrl ?? null, result.screenshot ?? null,
      result.note, result.status === "published" ? new Date().toISOString() : null,
    );

    if (result.status === "published" || result.status === "dry_run") {
      setJobStage(jobId, "done", result.status === "published" ? "발행 완료" : "연습 완료");
      log(result.note);
    } else {
      // ⚠️ 8-2 — 실패를 성공으로 보고하지 않는다.
      failJob(jobId, result.note);
      log(result.note, "error");
    }
  } catch (e) {
    const msg = (e as Error).message;
    failJob(jobId, msg);
    jobLog(jobId, `작업이 예상치 못하게 멈췄습니다: ${msg}`, "error");
  }
}

/** 진행 중인 잡이 있으면 그 id — 중복 실행 방지(7-16) */
export function runningJobId(): number | null {
  const row = getDb()
    .prepare(
      `SELECT id FROM jobs WHERE status IN ('pending','scraping','writing','imaging','publishing')
        ORDER BY id DESC LIMIT 1`,
    )
    .get() as { id: number } | undefined;
  return row?.id ?? null;
}

export function screenshotExists(p?: string | null) {
  return !!p && fs.existsSync(p);
}
