"use client";

import { Clapperboard, Edit3, Plus, Upload } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { AdminButton, adminButtonIconLabelClassName } from "@/components/admin-controls";
import { AdminNavButton } from "@/components/admin-nav-button";
import {
  adminHeaderActionRowClassName,
  adminListContentClassName,
  adminListMetaClassName,
  adminListActionGroupClassName,
  adminListRowClassName,
  adminListThumbnailClassName,
  adminListThumbnailFallbackClassName,
} from "@/components/admin-theme";
import { Panel, PanelHeader } from "@/components/panel";
import { CalloutPanel, surfaceCardClassName, surfaceInsetClassName } from "@/components/ui/surface-primitives";
import { presetThumbnailVisual } from "@/lib/media-studio-helpers";
import type { MediaPreset } from "@/lib/types";

type MediaPresetsPanelProps = {
  presets: MediaPreset[];
  total?: number;
  nextOffset?: number | null;
  isImporting: boolean;
  onImportClick: () => void;
};

const ADMIN_PRESET_PAGE_SIZE = 60;

function presetModelLabels(preset: MediaPreset) {
  const scopedModels = preset.applies_to_models?.length ? preset.applies_to_models : preset.model_key ? [preset.model_key] : [];
  if (!scopedModels.length) {
    return "No model scope";
  }
  return scopedModels
    .map((value) => (value === "nano-banana-pro" ? "Nano Banana Pro" : value === "nano-banana-2" ? "Nano Banana 2" : value))
    .join(", ");
}

export function MediaPresetsPanel({
  presets,
  total,
  nextOffset,
  isImporting,
  onImportClick,
}: MediaPresetsPanelProps) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [localPresets, setLocalPresets] = useState<MediaPreset[]>(presets);
  const [localTotal, setLocalTotal] = useState(total ?? presets.length);
  const [localNextOffset, setLocalNextOffset] = useState<number | null>(nextOffset ?? null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setLocalPresets(presets);
    setLocalTotal(total ?? presets.length);
    setLocalNextOffset(nextOffset ?? null);
  }, [nextOffset, presets, total]);

  async function loadPresetPage(offset: number, mode: "replace" | "append") {
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams({
        limit: String(ADMIN_PRESET_PAGE_SIZE),
        offset: String(offset),
        status: "active",
      });
      if (deferredQuery.trim()) params.set("q", deferredQuery.trim());
      const response = await fetch(`/api/control/media-presets?${params.toString()}`);
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        presets?: MediaPreset[];
        total?: number;
        next_offset?: number | null;
      };
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error ?? "Unable to load presets.");
      }
      const nextPresets = payload.presets ?? [];
      setLocalPresets((current) => (mode === "append" ? [...current, ...nextPresets] : nextPresets));
      setLocalTotal(Number(payload.total ?? nextPresets.length));
      setLocalNextOffset(payload.next_offset ?? null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Unable to load presets.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPresetPage(0, "replace");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deferredQuery]);

  useEffect(() => {
    if (localNextOffset == null || loading || typeof IntersectionObserver === "undefined") return;
    const element = loadMoreRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadPresetPage(localNextOffset, "append");
        }
      },
      { rootMargin: "420px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, localNextOffset, deferredQuery]);

  const visiblePresets = useMemo(
    () => localPresets.filter((preset) => preset.source_kind !== "builtin"),
    [localPresets],
  );

  return (
    <Panel>
      <PanelHeader
        eyebrow="Presets"
        title="Structured Presets"
        description="Manage all structured presets in one place. Each preset shows which Studio models it appears in."
        action={
          <div className={adminHeaderActionRowClassName}>
            <AdminButton variant="subtle" onClick={onImportClick} disabled={isImporting}>
              <span className={adminButtonIconLabelClassName}>
                <Upload className="size-4" />
                {isImporting ? "Importing..." : "Import"}
              </span>
            </AdminButton>
            <AdminNavButton href="/presets/new">
              <span className={adminButtonIconLabelClassName}>
                <Plus className="size-4" />
                New Preset
              </span>
            </AdminNavButton>
          </div>
        }
      />
      <div className="mt-5 grid gap-4">
        <CalloutPanel tone="accent" className={surfaceInsetClassName({ appearance: "admin", className: "text-sm leading-7 text-[var(--muted-strong)]" })}>
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent-strong)]">Prompt placeholder rules</div>
          <p className="mt-2">
            Use <span className="font-medium text-[var(--foreground)]">{"{{field_key}}"}</span> for text fields and{" "}
            <span className="font-medium text-[var(--foreground)]">{"[[image_slot_key]]"}</span> for image slots. A preset cannot save unless every configured field and slot appears in the prompt, and no unused fields remain.
          </p>
        </CalloutPanel>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <label className="sr-only" htmlFor="media-preset-admin-search">
            Search media presets
          </label>
          <input
            id="media-preset-admin-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search presets by name, key, or description..."
            className="min-h-11 w-full rounded-2xl border border-[var(--admin-border-subtle)] bg-[var(--admin-surface-inset)] px-4 text-sm text-[var(--foreground)] outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--accent-strong)] sm:max-w-xl"
          />
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted-strong)]">
            Showing {visiblePresets.length} of {localTotal}
          </div>
        </div>
        {loadError ? (
          <CalloutPanel tone="warning" className="text-sm leading-7">
            {loadError}
          </CalloutPanel>
        ) : null}

        <div className="grid gap-3">
          {visiblePresets.length ? (
            visiblePresets.map((preset) => (
              <article key={preset.preset_id} className={adminListRowClassName}>
                {presetThumbnailVisual(preset) ? (
                  <div className={adminListThumbnailClassName}>
                    <img
                      src={presetThumbnailVisual(preset) ?? ""}
                      alt={preset.label}
                      className="h-full w-full object-cover"
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                ) : (
                  <div className={adminListThumbnailFallbackClassName}>pre</div>
                )}
                <div className={adminListContentClassName}>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-[var(--foreground)]">{preset.label}</h3>
                    <span className="admin-status-pill">{preset.status === "active" ? "enabled" : "disabled"}</span>
                  </div>
                  <p className="text-sm text-[var(--muted-strong)]">
                    {presetModelLabels(preset)}{preset.description ? ` · ${preset.description}` : ""}
                  </p>
                  <div className={adminListMetaClassName}>
                    <span>{preset.key}</span>
                    <span>
                      {preset.input_schema_json?.length ?? 0} text field{(preset.input_schema_json?.length ?? 0) === 1 ? "" : "s"}
                    </span>
                    <span>
                      {preset.input_slots_json?.length ?? 0} image slot{(preset.input_slots_json?.length ?? 0) === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>
                <div className={adminListActionGroupClassName}>
                  <AdminNavButton
                    href={`/presets/${encodeURIComponent(preset.preset_id)}`}
                    variant="subtle"
                    size="compact"
                    title={`Edit ${preset.label}`}
                  >
                    <Edit3 className="size-3.5" />
                    <span className="sr-only">Edit</span>
                  </AdminNavButton>
                </div>
              </article>
            ))
          ) : (
            <CalloutPanel tone="muted" className="text-sm leading-7 text-[var(--muted-strong)]">
              No structured presets have been added yet.
            </CalloutPanel>
          )}
        </div>
        {localNextOffset != null ? (
          <div ref={loadMoreRef} className="flex justify-center">
            <AdminButton
              variant="subtle"
              onClick={() => void loadPresetPage(localNextOffset, "append")}
              disabled={loading}
            >
              {loading ? "Loading..." : "Load more presets"}
            </AdminButton>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
