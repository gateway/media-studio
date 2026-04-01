"use client";

import { useMemo, useState, useTransition } from "react";

type StudioProps = {
  initialAssets: any[];
  initialJobs: any[];
  initialModels: any[];
  initialPresets: any[];
  initialQueueSettings: any;
};

function mediaUrl(path: string | null | undefined): string | null {
  if (!path) {
    return null;
  }
  const base = process.env.NEXT_PUBLIC_MEDIA_STUDIO_CONTROL_API_BASE_URL || "http://127.0.0.1:8000";
  return `${base}/media/files/${path}`;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/control${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(payload.detail || `Request failed: ${response.status}`);
  }
  return payload;
}

function pill(active?: boolean) {
  return {
    borderRadius: "var(--ms-radius-pill)",
    border: "1px solid var(--ms-border)",
    background: active ? "var(--ms-accent-surface)" : "var(--ms-surface-soft)",
    color: active ? "var(--ms-text-primary)" : "var(--ms-text-muted)",
    padding: "10px 14px",
  } as const;
}

export function StudioClient({
  initialAssets,
  initialJobs,
  initialModels,
  initialPresets,
  initialQueueSettings,
}: StudioProps) {
  const [assets, setAssets] = useState<any[]>(initialAssets);
  const [jobs, setJobs] = useState<any[]>(initialJobs);
  const [models] = useState<any[]>(initialModels);
  const [presets, setPresets] = useState<any[]>(initialPresets);
  const [queueSettings, setQueueSettings] = useState(initialQueueSettings);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(initialAssets[0]?.asset_id || null);
  const [selectedPresetId, setSelectedPresetId] = useState<string>(initialPresets[0]?.preset_id || "");
  const [modelKey, setModelKey] = useState<string>(initialModels[0]?.key || "");
  const [taskMode, setTaskMode] = useState<string>(initialModels[0]?.task_modes?.[0] || "text_to_image");
  const [prompt, setPrompt] = useState("");
  const [outputCount, setOutputCount] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [presetValues, setPresetValues] = useState<Record<string, string>>({});
  const [presetSlotPath, setPresetSlotPath] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showPresets, setShowPresets] = useState(false);
  const [isPending, startTransition] = useTransition();

  const selectedAsset = useMemo(
    () => assets.find((asset) => asset.asset_id === selectedAssetId) || null,
    [assets, selectedAssetId],
  );
  const selectedPreset = useMemo(
    () => presets.find((preset) => preset.preset_id === selectedPresetId) || null,
    [presets, selectedPresetId],
  );
  const selectedModel = useMemo(
    () => models.find((model) => model.key === modelKey) || null,
    [models, modelKey],
  );
  const selectedAssetDisplayUrl = mediaUrl(
    selectedAsset?.hero_web_path || selectedAsset?.hero_poster_path || selectedAsset?.hero_thumb_path,
  );

  async function refreshStudio() {
    const [assetsPayload, jobsPayload, queuePayload, presetsPayload] = await Promise.all([
      api<any>("/media/assets?limit=24"),
      api<any>("/media/jobs?limit=24"),
      api<any>("/media/queue/settings"),
      api<any>("/media/presets"),
    ]);
    setAssets(assetsPayload.items || []);
    setJobs(jobsPayload.items || []);
    setQueueSettings(queuePayload);
    setPresets(presetsPayload || []);
  }

  function currentPresetTextFields(): any[] {
    return selectedPreset?.input_schema_json?.text_fields || [];
  }

  function currentPresetImageSlots(): any[] {
    return selectedPreset?.input_slots_json || [];
  }

  async function submitJob() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        const slotPayload: Record<string, { path: string }[]> = {};
        const slot = currentPresetImageSlots()[0];
        if (slot && presetSlotPath.trim()) {
          slotPayload[slot.key] = [{ path: presetSlotPath.trim() }];
        }
        const validation = await api<any>("/media/validate", {
          method: "POST",
          body: JSON.stringify({
            model_key: modelKey,
            task_mode: taskMode,
            prompt,
            preset_id: selectedPresetId || null,
            preset_text_values: presetValues,
            preset_image_slots: slotPayload,
            output_count: outputCount,
          }),
        });
        if (!["ready", "ready_with_defaults", "ready_with_warning"].includes(validation.validation.state)) {
          throw new Error(`Validation state: ${validation.validation.state}`);
        }
        await api<any>("/media/jobs", {
          method: "POST",
          body: JSON.stringify({
            model_key: modelKey,
            task_mode: taskMode,
            prompt,
            preset_id: selectedPresetId || null,
            preset_text_values: presetValues,
            preset_image_slots: slotPayload,
            output_count: outputCount,
          }),
        });
        setNotice("Job submitted.");
        await refreshStudio();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Submit failed");
      }
    });
  }

  async function toggleFavorite(assetId: string, current: boolean) {
    await api<any>(`/media/assets/${assetId}/favorite?favorited=${current ? "false" : "true"}`, {
      method: "POST",
    });
    await refreshStudio();
  }

  async function dismissAsset(assetId: string) {
    await api<any>(`/media/assets/${assetId}/dismiss`, { method: "POST" });
    await refreshStudio();
    if (selectedAssetId === assetId) {
      setSelectedAssetId(null);
    }
  }

  async function saveQueueSettings(nextMax: number) {
    setError(null);
    setNotice(null);
    try {
      const updated = await api<any>("/media/queue/settings", {
        method: "PATCH",
        body: JSON.stringify({ max_concurrent_jobs: nextMax }),
      });
      setQueueSettings(updated);
      setNotice("Queue settings updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Queue update failed");
    }
  }

  async function createQuickPreset() {
    setError(null);
    setNotice(null);
    try {
      const created = await api<any>("/media/presets", {
        method: "POST",
        body: JSON.stringify({
          key: `quick-${Date.now()}`,
          label: "Quick Portrait Preset",
          model_key: modelKey,
          prompt_template: "Create {{subject}} using [[reference]]",
          text_fields: [{ key: "subject", label: "Subject", required: true }],
          image_slots: [{ key: "reference", label: "Reference", required: true }],
        }),
      });
      setPresets((current) => [created, ...current]);
      setSelectedPresetId(created.preset_id);
      setNotice("Preset created.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preset creation failed");
    }
  }

  const placeholderJobs = jobs.filter((job) => ["queued", "submitted", "running"].includes(job.status));

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "20px",
        display: "grid",
        gridTemplateColumns: "minmax(0, 1.2fr) minmax(360px, 560px)",
        gap: "20px",
      }}
    >
      <section
        style={{
          border: "1px solid var(--ms-border)",
          background: "var(--ms-surface-secondary)",
          borderRadius: "var(--ms-radius-panel)",
          boxShadow: "var(--ms-shadow-soft)",
          padding: "18px",
          display: "flex",
          flexDirection: "column",
          gap: "18px",
        }}
      >
        <header style={{ display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <button type="button" style={pill(true)}>
              All
            </button>
            <button type="button" style={pill()}>
              Images
            </button>
            <button type="button" style={pill()}>
              Videos
            </button>
            <button type="button" style={pill()}>
              Favorites
            </button>
          </div>
          <div style={{ display: "flex", gap: "10px", color: "var(--ms-text-muted)" }}>
            <button type="button" style={pill()} onClick={() => void refreshStudio()}>
              Refresh
            </button>
            <button type="button" style={pill()} onClick={() => setShowSettings((value) => !value)}>
              Settings
            </button>
            <button type="button" style={pill()} onClick={() => setShowPresets((value) => !value)}>
              Presets
            </button>
          </div>
        </header>

        {(error || notice) && (
          <div
            style={{
              borderRadius: "16px",
              border: "1px solid var(--ms-border)",
              background: error ? "rgba(255,181,166,0.12)" : "rgba(208,255,72,0.08)",
              color: error ? "var(--ms-danger)" : "var(--ms-text-primary)",
              padding: "12px 14px",
            }}
          >
            {error || notice}
          </div>
        )}

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
            gap: "16px",
          }}
        >
          {assets.map((asset) => (
            <article
              key={asset.asset_id}
              onClick={() => setSelectedAssetId(asset.asset_id)}
              style={{
                cursor: "pointer",
                aspectRatio: "1 / 1.2",
                borderRadius: "24px",
                border: selectedAssetId === asset.asset_id ? "1px solid var(--ms-accent)" : "1px solid var(--ms-border)",
                background: "linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))",
                padding: "14px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
              }}
            >
              <div
                style={{
                  flex: 1,
                  borderRadius: "18px",
                  background: "rgba(255,255,255,0.05)",
                  display: "grid",
                  placeItems: "center",
                  overflow: "hidden",
                }}
              >
                {asset.hero_thumb_path || asset.hero_poster_path ? (
                  <img
                    src={mediaUrl(asset.hero_thumb_path || asset.hero_poster_path) || undefined}
                    alt={asset.prompt_summary || asset.model_key}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : (
                  <span style={{ color: "var(--ms-text-dim)" }}>Poster / thumb</span>
                )}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", marginTop: "12px" }}>
                <span style={{ color: "var(--ms-text-muted)", fontSize: "14px" }}>{asset.model_key}</span>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    void toggleFavorite(asset.asset_id, asset.favorited);
                  }}
                  style={{ ...pill(asset.favorited), padding: "6px 10px" }}
                >
                  {asset.favorited ? "Liked" : "Like"}
                </button>
              </div>
            </article>
          ))}

          {placeholderJobs.map((job) => (
            <article
              key={job.job_id}
              style={{
                aspectRatio: "1 / 1.2",
                borderRadius: "24px",
                border: "1px solid var(--ms-border)",
                background: "linear-gradient(180deg, rgba(208,255,72,0.08), rgba(255,255,255,0.02))",
                padding: "14px",
                display: "grid",
                placeItems: "center",
                textAlign: "center",
              }}
            >
              <div>
                <div style={{ color: "var(--ms-accent)", marginBottom: "8px" }}>{job.status}</div>
                <div style={{ color: "var(--ms-text-muted)" }}>{job.model_key}</div>
              </div>
            </article>
          ))}
        </section>
      </section>

      <section
        style={{
          border: "1px solid var(--ms-border)",
          background: "var(--ms-surface-secondary)",
          borderRadius: "var(--ms-radius-panel)",
          boxShadow: "var(--ms-shadow-soft)",
          padding: "18px",
          display: "flex",
          flexDirection: "column",
          gap: "18px",
        }}
      >
        <header style={{ display: "flex", gap: "10px", flexWrap: "wrap", color: "var(--ms-text-muted)" }}>
          <span>Jobs {jobs.length}</span>
          <span>Queue limit {queueSettings.max_concurrent_jobs}</span>
          <span>Runner {isPending ? "working" : "idle"}</span>
        </header>

        <label style={{ display: "grid", gap: "8px" }}>
          <span>Model</span>
          <select
            value={modelKey}
            onChange={(event) => {
              const nextKey = event.target.value;
              setModelKey(nextKey);
              const model = models.find((item) => item.key === nextKey);
              setTaskMode(model?.task_modes?.[0] || "text_to_image");
            }}
            style={{ borderRadius: "16px", background: "var(--ms-surface-primary)", color: "var(--ms-text-primary)", border: "1px solid var(--ms-border)", padding: "12px" }}
          >
            {models.map((model) => (
              <option key={model.key} value={model.key}>
                {model.label}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "grid", gap: "8px" }}>
          <span>Task mode</span>
          <select
            value={taskMode}
            onChange={(event) => setTaskMode(event.target.value)}
            style={{ borderRadius: "16px", background: "var(--ms-surface-primary)", color: "var(--ms-text-primary)", border: "1px solid var(--ms-border)", padding: "12px" }}
          >
            {(selectedModel?.task_modes || []).map((mode: string) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "grid", gap: "8px" }}>
          <span>Prompt</span>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Describe the scene you imagine"
            style={{
              minHeight: "180px",
              width: "100%",
              resize: "vertical",
              borderRadius: "24px",
              border: "1px solid var(--ms-border)",
              background: "var(--ms-surface-primary)",
              color: "var(--ms-text-primary)",
              padding: "18px",
            }}
          />
        </label>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: "12px" }}>
          <label style={{ display: "grid", gap: "8px" }}>
            <span>Preset</span>
            <select
              value={selectedPresetId}
              onChange={(event) => setSelectedPresetId(event.target.value)}
              style={{ borderRadius: "16px", background: "var(--ms-surface-primary)", color: "var(--ms-text-primary)", border: "1px solid var(--ms-border)", padding: "12px" }}
            >
              <option value="">No preset</option>
              {presets.map((preset) => (
                <option key={preset.preset_id} value={preset.preset_id}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: "grid", gap: "8px" }}>
            <span>Outputs</span>
            <input
              type="number"
              min={1}
              max={8}
              value={outputCount}
              onChange={(event) => setOutputCount(Number(event.target.value) || 1)}
              style={{ borderRadius: "16px", background: "var(--ms-surface-primary)", color: "var(--ms-text-primary)", border: "1px solid var(--ms-border)", padding: "12px" }}
            />
          </label>
        </div>

        {currentPresetTextFields().map((field) => (
          <label key={field.key} style={{ display: "grid", gap: "8px" }}>
            <span>{field.label}</span>
            <input
              type="text"
              value={presetValues[field.key] || ""}
              onChange={(event) => setPresetValues((current) => ({ ...current, [field.key]: event.target.value }))}
              placeholder={field.placeholder || field.default_value || ""}
              style={{ borderRadius: "16px", background: "var(--ms-surface-primary)", color: "var(--ms-text-primary)", border: "1px solid var(--ms-border)", padding: "12px" }}
            />
          </label>
        ))}

        {currentPresetImageSlots()[0] && (
          <label style={{ display: "grid", gap: "8px" }}>
            <span>{currentPresetImageSlots()[0].label} path</span>
            <input
              type="text"
              value={presetSlotPath}
              onChange={(event) => setPresetSlotPath(event.target.value)}
              placeholder={currentPresetImageSlots()[0].help_text || "/absolute/path/to/image.png"}
              style={{ borderRadius: "16px", background: "var(--ms-surface-primary)", color: "var(--ms-text-primary)", border: "1px solid var(--ms-border)", padding: "12px" }}
            />
          </label>
        )}

        <footer style={{ display: "flex", justifyContent: "space-between", gap: "10px" }}>
          <button type="button" style={pill()} onClick={() => {
            setPrompt("");
            setPresetValues({});
            setPresetSlotPath("");
          }}>
            Clear
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={() => void submitJob()}
            style={{
              borderRadius: "var(--ms-radius-pill)",
              border: "1px solid var(--ms-accent-border)",
              background: "var(--ms-accent)",
              color: "#10130a",
              padding: "12px 18px",
              fontWeight: 600,
              opacity: isPending ? 0.7 : 1,
            }}
          >
            {isPending ? "Generating..." : "Generate"}
          </button>
        </footer>

        {selectedAsset && (
          <section style={{ borderTop: "1px solid var(--ms-border)", paddingTop: "18px", display: "grid", gap: "12px" }}>
            <header style={{ display: "flex", justifyContent: "space-between", gap: "10px" }}>
              <h2 style={{ margin: 0 }}>Selected Asset</h2>
              <button type="button" style={pill()} onClick={() => void dismissAsset(selectedAsset.asset_id)}>
                Remove
              </button>
            </header>
            <div
              style={{
                minHeight: "240px",
                borderRadius: "20px",
                overflow: "hidden",
                background: "rgba(255,255,255,0.05)",
                display: "grid",
                placeItems: "center",
              }}
            >
              {selectedAssetDisplayUrl ? (
                <img
                  src={selectedAssetDisplayUrl}
                  alt={selectedAsset.prompt_summary || selectedAsset.model_key}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : (
                <span style={{ color: "var(--ms-text-dim)" }}>No preview</span>
              )}
            </div>
            <div style={{ color: "var(--ms-text-muted)" }}>{selectedAsset.prompt_summary || "No saved prompt summary."}</div>
          </section>
        )}

        {showSettings && (
          <section style={{ borderTop: "1px solid var(--ms-border)", paddingTop: "18px", display: "grid", gap: "12px" }}>
            <h2 style={{ margin: 0 }}>Settings</h2>
            <label style={{ display: "grid", gap: "8px" }}>
              <span>Max concurrent jobs</span>
              <input
                type="number"
                min={1}
                max={20}
                value={queueSettings.max_concurrent_jobs}
                onChange={(event) => void saveQueueSettings(Number(event.target.value) || 1)}
                style={{ borderRadius: "16px", background: "var(--ms-surface-primary)", color: "var(--ms-text-primary)", border: "1px solid var(--ms-border)", padding: "12px" }}
              />
            </label>
          </section>
        )}

        {showPresets && (
          <section style={{ borderTop: "1px solid var(--ms-border)", paddingTop: "18px", display: "grid", gap: "12px" }}>
            <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ margin: 0 }}>Presets</h2>
              <button type="button" style={pill()} onClick={() => void createQuickPreset()}>
                New Quick Preset
              </button>
            </header>
            {presets.map((preset) => (
              <article key={preset.preset_id} style={{ border: "1px solid var(--ms-border)", borderRadius: "16px", padding: "12px" }}>
                <div>{preset.label}</div>
                <div style={{ color: "var(--ms-text-muted)", fontSize: "14px" }}>{preset.prompt_template}</div>
              </article>
            ))}
          </section>
        )}
      </section>
    </main>
  );
}
