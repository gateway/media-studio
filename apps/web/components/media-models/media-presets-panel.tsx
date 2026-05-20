"use client";

import { Clapperboard, Edit3, Plus, Upload } from "lucide-react";

import { AdminButton, adminButtonIconLabelClassName } from "@/components/admin-controls";
import { AdminNavButton } from "@/components/admin-nav-button";
import {
  adminHeaderActionRowClassName,
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
  isImporting,
  onImportClick,
}: MediaPresetsPanelProps) {
  const visiblePresets = presets.filter((preset) => preset.source_kind !== "builtin");

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

        <div className="grid gap-3">
          {visiblePresets.length ? (
            visiblePresets.map((preset) => (
              <article key={preset.preset_id} className={adminListRowClassName}>
                {presetThumbnailVisual(preset) ? (
                  <div className={adminListThumbnailClassName}>
                    <img src={presetThumbnailVisual(preset) ?? ""} alt={preset.label} className="h-full w-full object-cover" />
                  </div>
                ) : (
                  <div className={adminListThumbnailFallbackClassName}>pre</div>
                )}
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-[var(--foreground)]">{preset.label}</h3>
                    <span className="admin-status-pill">{preset.status === "active" ? "enabled" : "disabled"}</span>
                  </div>
                  <p className="text-sm text-[var(--muted-strong)]">
                    {presetModelLabels(preset)}{preset.description ? ` · ${preset.description}` : ""}
                  </p>
                  <div className="flex flex-wrap gap-2 text-xs text-[var(--muted-strong)]">
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
      </div>
    </Panel>
  );
}
