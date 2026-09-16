import { CONFIG } from "@/config";
import { getDb } from "@/lib/db";
import { LIMITS, VISIBILITIES, type Settings } from "@/lib/settingsShared";

export type { Settings } from "@/lib/settingsShared";
export { LIMITS, VISIBILITIES, VISIBILITY_LABEL } from "@/lib/settingsShared";

const DEFAULTS: Settings = {
  dryRun: CONFIG.dryRun,
  killSwitch: CONFIG.killSwitch,
  visibility: VISIBILITIES.includes(CONFIG.visibility) ? CONFIG.visibility : "private",
  dailyPublishLimit: CONFIG.dailyPublishLimit,
  minPublishIntervalMin: CONFIG.minPublishIntervalMin,
  scrapeTopN: CONFIG.scrapeTopN,
  imageCandidates: CONFIG.imageCandidates,
  cfImageSteps: CONFIG.cfImageSteps,
  showBrowser: CONFIG.showBrowser,
  claudeTimeoutSec: CONFIG.claudeTimeoutSec,
  claudeConcurrency: CONFIG.claudeConcurrency,
};

export const SETTING_KEYS = Object.keys(DEFAULTS) as (keyof Settings)[];

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** 범위를 벗어난 값은 UI 에서 막지 말고 여기서 잘라낸다(입력 중에는 자유롭게 두는 편이 편하다) */
export function clampSettings(s: Settings): Settings {
  const out = { ...s };
  for (const [k, r] of Object.entries(LIMITS) as [keyof Settings, { min: number; max: number }][]) {
    const v = Number(out[k]);
    (out as Record<string, unknown>)[k] = Number.isFinite(v)
      ? clamp(Math.round(v), r.min, r.max)
      : DEFAULTS[k];
  }
  if (!VISIBILITIES.includes(out.visibility)) out.visibility = "private";
  out.dryRun = !!out.dryRun;
  out.killSwitch = !!out.killSwitch;
  out.showBrowser = !!out.showBrowser;
  return out;
}

export function getSettings(): Settings {
  const rows = getDb().prepare(`SELECT key, value FROM settings`).all() as {
    key: string;
    value: string;
  }[];
  const stored = new Map(rows.map((r) => [r.key, r.value]));
  const out = { ...DEFAULTS };
  for (const k of SETTING_KEYS) {
    const raw = stored.get(k);
    if (raw === undefined) continue;
    const def = DEFAULTS[k];
    if (typeof def === "boolean") (out as Record<string, unknown>)[k] = raw === "true";
    else if (typeof def === "number") (out as Record<string, unknown>)[k] = Number(raw);
    else (out as Record<string, unknown>)[k] = raw;
  }
  return clampSettings(out);
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const merged = clampSettings({ ...getSettings(), ...patch } as Settings);
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  );
  const tx = db.transaction(() => {
    for (const k of SETTING_KEYS) stmt.run(k, String(merged[k]));
  });
  tx();
  return merged;
}

export function resetSettings(): Settings {
  getDb().prepare(`DELETE FROM settings`).run();
  return getSettings();
}

export function defaultSettings(): Settings {
  return { ...DEFAULTS };
}
