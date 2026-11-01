"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Power } from "lucide-react";
import { jsonFetch } from "./utils/graph-api";

type GenerationMode = { live_submit_enabled: boolean; kie_api_key_configured: boolean };
const MODE_URL = "/api/control/media/generation-mode";
const isLive = (mode: GenerationMode | null) => Boolean(mode?.live_submit_enabled && mode?.kie_api_key_configured);

export function GraphGenerationControls({ runActive, onRun }: { runActive: boolean; onRun: () => void }) {
  const [mode, setMode] = useState<GenerationMode | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmLive, setConfirmLive] = useState(false);
  const requestRevision = useRef({ value: 0 });
  const live = isLive(mode);
  const offline = mode !== null && !live;
  const runDisabled = mode === null || busy;
  const refresh = useCallback(async () => {
    const revision = ++requestRevision.current.value;
    try {
      const next = await jsonFetch<GenerationMode>(MODE_URL);
      if (revision === requestRevision.current.value) { setMode(next); setError(""); }
      return next;
    } catch (failure) {
      if (revision === requestRevision.current.value) {
        setMode(null);
        setError((failure as Error).message || "Could not check generation mode.");
      }
      return null;
    }
  }, []);
  useEffect(() => {
    const revision = requestRevision.current;
    refresh().catch((failure: Error) => setError(failure.message));
    const onFocus = () => { refresh().catch((failure: Error) => setError(failure.message)); };
    window.addEventListener("focus", onFocus);
    const timer = setInterval(onFocus, 15000);
    return () => { ++revision.value; clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [refresh]);

  async function enableLive() {
    setBusy(true);
    ++requestRevision.current.value;
    try {
      const next = await jsonFetch<GenerationMode>(`${MODE_URL}/enable-live`, { method: "POST" });
      ++requestRevision.current.value;
      setMode(next);
      setError("");
      setConfirmLive(false);
    } catch (failure) {
      setError((failure as Error).message);
    } finally { setBusy(false); }
  }

  async function runWithCurrentMode() {
    setBusy(true);
    const current = await refresh();
    setBusy(false);
    if (!current) return;
    if (isLive(current) !== live) {
      setError("Generation mode changed. Review the run button, then run again.");
      return;
    }
    onRun();
  }

  return <>
    <OfflineModeControl mode={mode} disabled={runActive || busy} onEnable={() => setConfirmLive(true)} />
    {!runActive && <button className="graph-run-button" type="button" data-testid="graph-run-button" disabled={runDisabled} onClick={() => { runWithCurrentMode().catch((failure: Error) => setError(failure.message)); }}>
      <Play size={18} />{offline ? "Run offline" : "Run"}
    </button>}
    {error && <div className="graph-generation-notice" role="alert"><span>{error}</span><button type="button" disabled={busy} onClick={() => { refresh().catch((failure: Error) => setError(failure.message)); }}>Check again</button></div>}
    <EnableLiveDialog open={confirmLive} busy={busy} runActive={runActive} onCancel={() => setConfirmLive(false)} onEnable={() => { enableLive().catch((failure: Error) => setError(failure.message)); }} />

  </>;
}

function OfflineModeControl({ mode, disabled, onEnable }: { mode: GenerationMode | null; disabled: boolean; onEnable: () => void }) {
  if (!mode || isLive(mode)) return null;
  const title = "Offline mode: media steps create placeholders. Text and analysis services may still run.";
  if (!mode.kie_api_key_configured) {
    return <a className="graph-credit-balance graph-generation-mode" href="/settings/connections" title={`${title} Set up a connection to enable live generation.`} aria-label="Offline mode — set up a connection"><Power size={12} aria-hidden="true" />Offline</a>;
  }
  return <button className="graph-credit-balance graph-generation-mode" type="button" disabled={disabled} title={`${title} Click to enable live generation.`} aria-label="Offline mode — enable live generation" onClick={onEnable}>
    <Power size={12} aria-hidden="true" />Offline
  </button>;
}

function EnableLiveDialog({ open, busy, runActive, onCancel, onEnable }: { open: boolean; busy: boolean; runActive: boolean; onCancel: () => void; onEnable: () => void }) {
  if (!open) return null;
  return <div className="graph-rename-modal graph-generation-dialog" role="dialog" aria-label="Enable live generation" aria-modal="true" onKeyDown={(event) => { if (event.key === "Escape" && !busy) onCancel(); }}>
    <strong>Enable live generation?</strong>
    <p>Media generation will use provider credits. This applies to all Studio and Graph jobs until the API restarts. It does not run this workflow.</p>
    <div className="graph-rename-actions">
      <button type="button" autoFocus disabled={busy} onClick={onCancel}>Cancel</button>
      <button type="button" disabled={busy || runActive} onClick={onEnable}>{busy ? "Enabling…" : "Enable live"}</button>
    </div>
  </div>;
}
