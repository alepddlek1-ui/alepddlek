"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SettingsDrawer from "./SettingsDrawer";
import type { Settings } from "@/lib/settingsShared";
import { VISIBILITY_LABEL } from "@/lib/settingsShared";
import type { ImageStyle, JobMode, PhotoSource, Section } from "@/lib/types";

type Status = {
  claude: { ok: boolean; version?: string; error?: string };
  session: { ok: boolean; blogId?: string; reason?: string };
  cloudflare: { configured: boolean };
  settings: Settings;
  limits: Record<string, { min: number; max: number }>;
  publishedToday: number;
  runningJobId: number | null;
};
type JobRow = {
  id: number; keyword: string; status: string; stage: string | null;
  mode: string; error: string | null; created_at: string;
};
type Detail = {
  job: JobRow;
  draft?: { title: string; body_json: string };
  images: { section_index: number | null; local_path: string | null; verdict_ok: number; verdict_reason: string | null; query: string | null; source_site: string | null }[];
  post?: { status: string; blog_url: string | null; screenshot: string | null; note: string | null };
  logs: { id: number; level: string; message: string }[];
};
type UsageResp = {
  usage: { neurons: number; limit: number; measured: boolean; note: string };
  perImage: number;
  publishedToday: number;
  dailyPublishLimit: number;
  minPublishIntervalMin: number;
};

const MODES: { id: JobMode; name: string; desc: string }[] = [
  { id: "auto", name: "자동 발굴", desc: "관심 키워드만 넣으면 요즘 이야기를 훑어 글감을 잡고 글을 씁니다." },
  { id: "review", name: "체험단", desc: "가본 곳·써본 것을 1인칭 후기체로 씁니다." },
  { id: "branding", name: "브랜딩·전문성", desc: "전문가 관점으로 신뢰를 쌓는 구조로 씁니다." },
];
const PHOTOS: { id: PhotoSource; name: string }[] = [
  { id: "none", name: "사진 없음" },
  { id: "local", name: "내 사진" },
  { id: "crawl", name: "검색해서 가져오기" },
  { id: "ai", name: "AI 가 그리기" },
];

const fileUrl = (p: string) => `/api/file?path=${encodeURIComponent(p)}`;

export default function Page() {
  const [status, setStatus] = useState<Status | null>(null);
  const [usage, setUsage] = useState<UsageResp | null>(null);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [starting, setStarting] = useState(false); // 7-16 — 클라이언트 쪽 잠금
  const [msg, setMsg] = useState("");

  const [mode, setMode] = useState<JobMode>("auto");
  const [keyword, setKeyword] = useState("");
  const [topic, setTopic] = useState("");
  const [points, setPoints] = useState("");
  const [photoSource, setPhotoSource] = useState<PhotoSource>("none");
  const [imageStyle, setImageStyle] = useState<ImageStyle>("photo");
  const [photoDir, setPhotoDir] = useState("");
  const [liveLogs, setLiveLogs] = useState<{ id: number; level: string; message: string }[]>([]);
  const es = useRef<EventSource | null>(null);

  const load = useCallback(async () => {
    const [s, j, u] = await Promise.all([
      fetch("/api/status").then((r) => r.json()),
      fetch("/api/jobs").then((r) => r.json()),
      fetch("/api/usage").then((r) => r.json()),
    ]);
    setStatus(s);
    setJobs(j.jobs ?? []);
    setUsage(u);
    return s as Status;
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openJob = useCallback(async (id: number) => {
    setSelected(id);
    const d = (await fetch(`/api/jobs/${id}`).then((r) => r.json())) as Detail;
    setDetail(d);
    setLiveLogs(d.logs ?? []);
  }, []);

  // SSE — 진행 중인 잡의 로그를 실시간으로 받는다
  const watch = useCallback(
    (id: number) => {
      es.current?.close();
      const src = new EventSource(`/api/jobs/${id}/stream`);
      es.current = src;
      src.addEventListener("log", (e) => {
        const row = JSON.parse((e as MessageEvent).data);
        setLiveLogs((prev) => (prev.some((p) => p.id === row.id) ? prev : [...prev, row]));
      });
      src.addEventListener("stage", (e) => {
        const j = JSON.parse((e as MessageEvent).data);
        setJobs((prev) => prev.map((p) => (p.id === id ? { ...p, ...j } : p)));
      });
      src.addEventListener("end", () => {
        src.close();
        es.current = null;
        setStarting(false);
        load();
        openJob(id);
      });
    },
    [load, openJob],
  );

  useEffect(() => () => es.current?.close(), []);

  // 새로고침해도 진행 중인 작업을 이어서 본다
  useEffect(() => {
    if (status?.runningJobId && !es.current) {
      setStarting(true);
      openJob(status.runningJobId);
      watch(status.runningJobId);
    }
  }, [status?.runningJobId, openJob, watch]);

  const patchSettings = async (patch: Partial<Settings>) => {
    const r = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const j = await r.json();
    if (j.settings) {
      setStatus((s) => (s ? { ...s, settings: j.settings } : s));
      fetch("/api/usage").then((x) => x.json()).then(setUsage);
    }
  };

  const resetSettings = async () => {
    const j = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reset: true }),
    }).then((r) => r.json());
    setStatus((s) => (s ? { ...s, settings: j.settings } : s));
  };

  const login = async () => {
    setMsg("로그인 창을 띄웁니다. 창이 뜨면 평소처럼 로그인해 주세요. “로그인 상태 유지”를 꼭 켜주세요.");
    const j = await fetch("/api/naver/login", { method: "POST" }).then((r) => r.json());
    setMsg(j.message ?? "");
    await fetch("/api/status?refresh=1");
    load();
  };

  const pickFolder = async () => {
    const j = await fetch("/api/pick-folder", { method: "POST" }).then((r) => r.json());
    if (j.ok && j.path) setPhotoDir(j.path);
    else if (j.error) setMsg(j.error);
  };

  const start = async () => {
    if (starting) return;
    setStarting(true);
    setMsg("");
    setLiveLogs([]);
    const r = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode,
        keyword: mode === "auto" ? keyword : topic,
        topic,
        points,
        photoSource,
        imageStyle,
        photoDir,
      }),
    });
    const j = await r.json();
    if (!r.ok) {
      setMsg(j.error ?? "작업을 시작하지 못했습니다.");
      setStarting(false);
      return;
    }
    await load();
    openJob(j.id);
    watch(j.id);
  };

  const st = status?.settings;
  const rail = !st
    ? { color: "var(--dim)", title: "불러오는 중…", sub: "", run: "만들기" }
    : st.killSwitch
      ? { color: "var(--armed)", title: "전체 중단", sub: "어떤 작업도 발행되지 않습니다.", run: "" }
      : st.dryRun
        ? { color: "var(--safe)", title: "연습 모드", sub: "발행하지 않고 완성 화면만 저장합니다.", run: "연습으로 만들기" }
        : {
            color: "var(--armed)",
            title: "실제 발행",
            sub: `완성되는 글이 블로그에 그대로 올라갑니다. 지금 공개 범위는 “${VISIBILITY_LABEL[st.visibility]}” 입니다.`,
            run: "글 만들고 발행하기",
          };

  const sections: Section[] = useMemo(() => {
    if (!detail?.draft) return [];
    try {
      return JSON.parse(detail.draft.body_json) as Section[];
    } catch {
      return [];
    }
  }, [detail]);

  const imageBySection = useMemo(() => {
    const m = new Map<number, string>();
    for (const im of detail?.images ?? []) {
      if (im.verdict_ok && im.local_path && im.section_index !== null) m.set(im.section_index, im.local_path);
    }
    return m;
  }, [detail]);

  const canRun =
    !!status &&
    status.claude.ok &&
    !st?.killSwitch &&
    !starting &&
    (mode === "auto" ? keyword.trim() : topic.trim()) !== "" &&
    !(photoSource === "ai" && !status.cloudflare.configured) &&
    !(photoSource === "local" && !photoDir.trim());

  const meterColor = (ratio: number) =>
    ratio >= 0.9 ? "var(--armed)" : ratio >= 0.7 ? "var(--live)" : "var(--safe)";

  const pubRatio = usage ? usage.publishedToday / Math.max(1, usage.dailyPublishLimit) : 0;
  const neuRatio = usage ? usage.usage.neurons / Math.max(1, usage.usage.limit) : 0;

  return (
    <>
      <div className="rail" style={{ ["--rail-color" as string]: rail.color }}>
        <div className="rail-text">
          <div className="rail-title">{rail.title}</div>
          <div className="rail-sub">{rail.sub}</div>
        </div>
        <div className="dots">
          <span className={`dot ${status?.claude.ok ? "on" : "off"}`} title={status?.claude.version ?? status?.claude.error ?? ""}>
            <i />
            AI
          </span>
          <span className={`dot ${status?.session.ok ? "on" : "off"}`} title={status?.session.reason ?? ""}>
            <i />
            네이버
          </span>
          <span className={`dot ${status?.cloudflare.configured ? "on" : ""}`}>
            <i />
            이미지 생성
          </span>
        </div>
        {!status?.session.ok && (
          <button className="ghost" onClick={login}>
            네이버 로그인
          </button>
        )}
        <button className="ghost" onClick={() => setDrawer(true)}>
          설정
        </button>
      </div>

      <div className="wrap">
        {msg && <p className="note" style={{ marginTop: 14 }}>{msg}</p>}

        <div className="meters">
          <div className="meter" style={{ ["--meter-color" as string]: meterColor(pubRatio) }}>
            <div className="meter-top">
              <span className="meter-label">오늘 발행</span>
              <span className="meter-num">
                {usage?.publishedToday ?? 0} / {usage?.dailyPublishLimit ?? 3}편
              </span>
            </div>
            <div className="meter-bar">
              <span style={{ width: `${Math.min(100, pubRatio * 100)}%` }} />
            </div>
            <div className="meter-sub">
              글 사이 최소 {usage?.minPublishIntervalMin ?? 30}분 간격
              {pubRatio >= 1 ? " · 설정에서 늘릴 수 있습니다" : ""}
            </div>
          </div>

          <div className="meter" style={{ ["--meter-color" as string]: meterColor(neuRatio) }}>
            <div className="meter-top">
              <span className="meter-label">이미지 생성량</span>
              <span className="meter-num">
                {Math.round(usage?.usage.neurons ?? 0).toLocaleString("ko-KR")} /{" "}
                {(usage?.usage.limit ?? 10000).toLocaleString("ko-KR")} 뉴런
              </span>
            </div>
            <div className="meter-bar">
              <span style={{ width: `${Math.min(100, neuRatio * 100)}%` }} />
            </div>
            <div className="meter-sub">
              {usage?.usage.note} · 장당 {Math.round(usage?.perImage ?? 0)} 뉴런
            </div>
          </div>
        </div>

        <div className="h">무엇을 쓸까요</div>
        <div className="types">
          {MODES.map((m) => (
            <button
              key={m.id}
              className="type"
              aria-pressed={mode === m.id}
              onClick={() => {
                setMode(m.id);
                if (m.id === "auto" && photoSource === "local") setPhotoSource("none");
              }}
            >
              <b>{m.name}</b>
              <span>{m.desc}</span>
            </button>
          ))}
        </div>

        <div className="card" style={{ marginTop: 12 }}>
          {mode === "auto" ? (
            <label className="field">
              <span>관심 있는 분야를 한 단어로</span>
              <input type="text" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="예: 제주도 여행, 홈카페" />
            </label>
          ) : (
            <>
              <label className="field">
                <span>주제</span>
                <input type="text" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder={mode === "review" ? "예: 성수동 브런치 카페 다녀온 후기" : "예: 소상공인 블로그 마케팅"} />
              </label>
              <label className="field">
                <span>글에 꼭 담을 내용</span>
                <textarea value={points} onChange={(e) => setPoints(e.target.value)} placeholder="아는 대로 적어주세요. 여기 적은 내용 안에서만 글을 씁니다." />
              </label>
            </>
          )}

          <div className="field">
            <span style={{ display: "block", color: "var(--dim)", fontSize: 12, marginBottom: 5 }}>사진은 어떻게 할까요</span>
            <div className="chips">
              {PHOTOS.map((p) => (
                <button
                  key={p.id}
                  className="chip"
                  aria-pressed={photoSource === p.id}
                  // 자동 발굴에는 '내 사진'이 없다 — 주제를 미리 모르므로.
                  disabled={p.id === "local" && mode === "auto"}
                  onClick={() => setPhotoSource(p.id)}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          {photoSource === "ai" && (
            <div className="field">
              <span style={{ display: "block", color: "var(--dim)", fontSize: 12, marginBottom: 5 }}>그림체</span>
              <div className="chips">
                <button className="chip" aria-pressed={imageStyle === "photo"} onClick={() => setImageStyle("photo")}>
                  사진처럼
                </button>
                <button className="chip" aria-pressed={imageStyle === "illust"} onClick={() => setImageStyle("illust")}>
                  일러스트
                </button>
              </div>
              {!status?.cloudflare.configured && (
                <p className="warn">
                  AI 로 사진을 그리려면 열쇠(키)가 필요합니다. 지금은 “검색해서 가져오기”로 바꾸면 그냥 쓸 수 있습니다.
                </p>
              )}
            </div>
          )}

          {photoSource === "local" && (
            <div className="field">
              <span style={{ display: "block", color: "var(--dim)", fontSize: 12, marginBottom: 5 }}>사진이 든 폴더</span>
              <div style={{ display: "flex", gap: 8 }}>
                <input type="text" value={photoDir} onChange={(e) => setPhotoDir(e.target.value)} placeholder="폴더 고르기를 누르거나 여기에 직접 붙여넣으세요" />
                <button className="ghost" onClick={pickFolder} style={{ flex: "0 0 auto" }}>
                  폴더 고르기
                </button>
              </div>
            </div>
          )}

          <button className="run" style={{ ["--run-color" as string]: rail.color }} disabled={!canRun} onClick={start}>
            {starting ? "만드는 중…" : rail.run || "전체 중단이 켜져 있습니다"}
          </button>
          {/* 공개 범위를 설정에만 숨기지 않는다 — 실발행 직전에 "지금 어디로 나가는지"를 알아야 한다(6-13). */}
          {st && (
            <p className="note" style={{ marginTop: 8 }}>
              올릴 때 공개 범위는 <b>{VISIBILITY_LABEL[st.visibility]}</b> 입니다.
              {st.visibility === "public" && " 누구나 볼 수 있습니다."}
              {" 설정에서 바꿀 수 있습니다."}
            </p>
          )}
          {!status?.claude.ok && <p className="warn">AI 를 실행하는 프로그램이 준비되지 않았습니다.</p>}
          {!status?.session.ok && <p className="note" style={{ marginTop: 8 }}>네이버 로그인을 아직 안 했습니다. 글은 만들 수 있지만 올리지는 못합니다.</p>}
        </div>

        <div className="cols" style={{ marginTop: 22 }}>
          <div>
            <div className="h" style={{ marginTop: 0 }}>최근 작업</div>
            <div className="jobs">
              {jobs.length === 0 && <p className="note">아직 만든 글이 없습니다.</p>}
              {jobs.map((j) => (
                <button key={j.id} className="job" aria-pressed={selected === j.id} onClick={() => openJob(j.id)}>
                  <span>{j.keyword}</span>
                  <small>
                    {j.status === "done" ? "완료" : j.status === "failed" ? "실패" : (j.stage ?? j.status)}
                  </small>
                </button>
              ))}
            </div>

            {liveLogs.length > 0 && (
              <>
                <div className="h">진행 상황</div>
                <div className="logs">
                  {liveLogs.map((l) => (
                    <div key={l.id} className={l.level}>
                      {l.message}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <div>
            {detail?.draft && (
              <>
                <div className="h" style={{ marginTop: 0 }}>완성된 글</div>
                {detail.post && (
                  <div className="card" style={{ marginBottom: 10 }}>
                    <b>
                      {detail.post.status === "published"
                        ? "블로그에 올라갔습니다"
                        : detail.post.status === "dry_run"
                          ? "연습 모드 — 올리지 않았습니다"
                          : detail.post.status === "blocked"
                            ? "안전장치가 막았습니다"
                            : "올리지 못했습니다"}
                    </b>
                    <p className="note">{detail.post.note}</p>
                    {detail.post.blog_url && (
                      <p>
                        <a href={detail.post.blog_url} target="_blank" rel="noreferrer">
                          올라간 글 보기
                        </a>
                      </p>
                    )}
                    {detail.post.screenshot && (
                      <img src={fileUrl(detail.post.screenshot)} alt="발행 직전 화면" style={{ width: "100%", borderRadius: 8, marginTop: 8 }} />
                    )}
                  </div>
                )}

                <article className="preview">
                  <h1>{detail.draft.title}</h1>
                  {sections.map((s, i) => {
                    if (s.type === "heading") return <h2 key={i}>{s.text}</h2>;
                    if (s.type === "quote") return <blockquote key={i}>{s.text}</blockquote>;
                    if (s.type === "divider") return <hr key={i} />;
                    if (s.type === "image") {
                      const p = imageBySection.get(i);
                      return (
                        <figure key={i} style={{ margin: 0 }}>
                          {p ? <img src={fileUrl(p)} alt={s.caption ?? s.query} /> : <div className="missing">이 자리는 사진을 넣지 못했습니다</div>}
                          {s.caption && <figcaption>{s.caption}</figcaption>}
                        </figure>
                      );
                    }
                    const hl = s.highlight && s.text.includes(s.highlight) ? s.highlight : "";
                    if (!hl) return <p key={i}>{s.text}</p>;
                    const at = s.text.indexOf(hl);
                    return (
                      <p key={i}>
                        {s.text.slice(0, at)}
                        <mark>{hl}</mark>
                        {s.text.slice(at + hl.length)}
                      </p>
                    );
                  })}
                </article>

                {detail.images.some((im) => !im.verdict_ok) && (
                  <>
                    <div className="h">걸러낸 사진</div>
                    <div className="card">
                      {detail.images
                        .filter((im) => !im.verdict_ok)
                        .map((im, k) => (
                          <p key={k} className="note" style={{ margin: "4px 0" }}>
                            “{im.query}” — {im.verdict_reason}
                          </p>
                        ))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        <p className="legal">
          자동 발행은 네이버 이용약관상 계정 제재 위험이 있습니다. 그래서 연습 모드가 기본값이고,
          하루 발행 수·발행 간격·전체 중단 장치가 있습니다. 이 값들은 네이버가 정한 것이 아니라 이 앱의 자체 브레이크입니다.
          검색으로 가져온 사진은 저작권 분쟁 소지가 있어, 워터마크·인물 사진을 걸러내더라도 라이선스를 보장하지는 않습니다.
          상업적으로 쓰기 전에는 직접 확인해 주세요. 그래서 AI 가 그린 사진이 더 안전한 선택입니다.
        </p>
      </div>

      {drawer && status && (
        <SettingsDrawer
          settings={status.settings}
          limits={status.limits}
          onChange={patchSettings}
          onReset={resetSettings}
          onClose={() => setDrawer(false)}
        />
      )}
    </>
  );
}
