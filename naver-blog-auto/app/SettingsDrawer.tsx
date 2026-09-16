"use client";

import { useEffect } from "react";
import type { Settings } from "@/lib/settingsShared";
import { VISIBILITIES, VISIBILITY_LABEL } from "@/lib/settingsShared";
import { neuronsPerImage, imagesPerFreeDay } from "@/lib/ai/neurons";
import type { Visibility } from "@/config";

type Limits = Record<string, { min: number; max: number }>;

function Switch({
  on, onChange, label, color,
}: { on: boolean; onChange: (v: boolean) => void; label: string; color?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className="sw"
      style={color ? ({ ["--sw-color" as string]: color }) : undefined}
      onClick={() => onChange(!on)}
    />
  );
}

export default function SettingsDrawer({
  settings, limits, onChange, onReset, onClose,
}: {
  settings: Settings;
  limits: Limits;
  onChange: (patch: Partial<Settings>) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  // Esc 로 닫기
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const num = (k: keyof Settings, label: string, sub: string) => (
    <div className="row">
      <div>
        <b>{label}</b>
        <small>{sub}</small>
      </div>
      <input
        type="number"
        value={String(settings[k])}
        min={limits[k]?.min}
        max={limits[k]?.max}
        aria-label={label}
        // 범위 밖 값은 서버가 잘라낸다. 입력 중에는 자유롭게 둔다.
        onChange={(e) => onChange({ [k]: Number(e.target.value) } as Partial<Settings>)}
      />
    </div>
  );

  const perImage = Math.round(neuronsPerImage(settings.cfImageSteps));
  const perDay = imagesPerFreeDay(settings.cfImageSteps);

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="설정" aria-modal="true">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <b>설정</b>
          <button className="ghost" onClick={onClose}>
            닫기
          </button>
        </div>

        <h3>발행 안전장치</h3>
        <div className="row">
          <div>
            <b>연습 모드</b>
            <small>켜두면 발행하지 않고 완성된 화면만 저장합니다.</small>
          </div>
          <Switch
            on={settings.dryRun}
            label="연습 모드"
            color="var(--safe)"
            onChange={(v) => onChange({ dryRun: v })}
          />
        </div>
        <div className="row">
          <div>
            <b>전체 중단</b>
            <small>켜면 어떤 작업도 발행되지 않습니다.</small>
          </div>
          <Switch
            on={settings.killSwitch}
            label="전체 중단"
            color="var(--armed)"
            onChange={(v) => onChange({ killSwitch: v })}
          />
        </div>
        <div className="row">
          <div>
            <b>공개 범위</b>
            <small>처음에는 비공개를 권합니다. 나만 보고 확인한 뒤 바꿀 수 있습니다.</small>
          </div>
          <select
            aria-label="공개 범위"
            style={{ width: 130 }}
            value={settings.visibility}
            onChange={(e) => onChange({ visibility: e.target.value as Visibility })}
          >
            {VISIBILITIES.map((v) => (
              <option key={v} value={v}>
                {VISIBILITY_LABEL[v]}
              </option>
            ))}
          </select>
        </div>
        {num("dailyPublishLimit", "하루 발행 수", `하루에 이만큼까지만 올립니다 (${limits.dailyPublishLimit?.min}~${limits.dailyPublishLimit?.max}편)`)}
        {num("minPublishIntervalMin", "발행 간격", "이 시간이 지나야 다음 글을 올립니다 (분)")}

        <h3>글감과 사진</h3>
        {num("scrapeTopN", "검색 수집량", "글감을 잡을 때 참고할 자료 수")}
        {num("imageCandidates", "이미지 후보", "한 자리마다 이만큼 후보를 보고 고릅니다. 낮추면 사진이 빕니다.")}
        {num("cfImageSteps", "생성 품질", `지금은 장당 ${perImage} 뉴런 — 무료 한도로 하루 ${perDay}장`)}

        <h3>실행 방식</h3>
        <div className="row">
          <div>
            <b>브라우저 보기</b>
            <small>켜면 작업하는 창이 화면에 보입니다.</small>
          </div>
          <Switch on={settings.showBrowser} label="브라우저 보기" onChange={(v) => onChange({ showBrowser: v })} />
        </div>
        {num("claudeConcurrency", "AI 동시 실행", "한 번에 몇 개까지 AI를 돌릴지")}
        {num("claudeTimeoutSec", "AI 응답 대기", "이 시간이 지나면 포기합니다 (초)")}

        <div style={{ marginTop: 22 }}>
          <button className="ghost" onClick={onReset}>
            기본값으로 되돌리기
          </button>
        </div>
      </aside>
    </>
  );
}
