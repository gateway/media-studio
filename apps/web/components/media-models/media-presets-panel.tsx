"use client";

import { Clapperboard, Edit3, Plus, Upload } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { useMediaPresetPages } from "@/hooks/use-media-preset-pages";
import { AdminButton, AdminInput, adminButtonIconLabelClassName } from "@/components/admin-controls";
import { StatusPill } from "@/components/status-pill";
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
  seedValid?: boolean;
  isImporting: boolean;
  onImportClick: () => void;
};

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
  seedValid = false,
  isImporting,
  onImportClick,
}: MediaPresetsPanelProps) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const seed = useMemo(() => seedValid ? { presets, total: total ?? presets.length, offset: 0, next_offset: nextOffset ?? null } : null, [nextOffset, presets, seedValid, total]);
  const { page, loading, loadingMore, error: loadError, loadMore, retry } = useMediaPresetPages({ query: deferredQuery, view: "full", seed, refreshKey: presets });
  const localPresets = page?.presets ?? [];
  const localTotal = page?.total ?? 0;
  const localNextOffset = page?.next_offset ?? null;
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (localNextOffset == null || loading || loadingMore || loadError || typeof IntersectionObserver === "undefined") return;
    const element = loadMoreRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries.some((entry) => entry.isIntersecting)) void loadMore(); },
      { rootMargin: "420px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [loadError, loadMore, loading, loadingMore, localNextOffset]);

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
          <AdminInput
            id="media-preset-admin-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search presets by name, key, or description..."
            className="sm:max-w-xl"
          />
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted-strong)]">
            Showing {visiblePresets.length} of {localTotal}
          </div>
        </div>
        {loadError ? (
          <CalloutPanel tone="warning" className="text-sm leading-7">
            {loadError}
            <AdminButton variant="subtle" onClick={retry}>Retry loading presets</AdminButton>
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
                    <StatusPill label={preset.status === "active" ? "Enabled" : "Disabled"} tone={preset.status === "active" ? "healthy" : "neutral"} />
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
              onClick={() => void loadMore()}
              disabled={loading || loadingMore}
            >
              {loadingMore ? "Loading..." : "Load more presets"}
            </AdminButton>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
