"use client";

import { Pencil, Sparkles, X } from "lucide-react";
import { useRouter } from "next/navigation";

import { EmptyState, MediaBrowserCard, OverlayHeader, OverlayShell, SurfaceInset } from "@/components/ui/surface-primitives";
import { presetThumbnailVisual, prettifyModelLabel, studioPresetSupportedModels } from "@/lib/media-studio-helpers";
import type { MediaModelSummary, MediaPreset } from "@/lib/types";

type StudioPresetBrowserProps = {
  presets: MediaPreset[];
  models: MediaModelSummary[];
  onClose: () => void;
  onSelectPreset: (preset: MediaPreset) => void;
};

function presetInputSummary(preset: MediaPreset) {
  const textFieldCount = (preset.input_schema_json?.length ?? 0);
  const imageSlotCount = (preset.input_slots_json?.length ?? 0);
  return `${textFieldCount} text field${textFieldCount === 1 ? "" : "s"} · ${imageSlotCount} image slot${imageSlotCount === 1 ? "" : "s"}`;
}

export function StudioPresetBrowser({
  presets,
  models,
  onClose,
  onSelectPreset,
}: StudioPresetBrowserProps) {
  const router = useRouter();
  const studioReturnToHref = "/studio";

  return (
    <OverlayShell
      backdropClassName="z-[118]"
      panelClassName="flex min-h-dvh min-w-0 flex-col lg:h-[calc(100dvh-3rem)] lg:min-h-0 lg:max-h-[calc(100dvh-3rem)] lg:overflow-hidden"
    >
      <div data-testid="studio-preset-browser" className="flex min-h-dvh min-w-0 flex-col lg:min-h-0">
        <div className="border-b border-white/8 px-4 py-4 md:px-6">
          <OverlayHeader
            appearance="studio"
            eyebrow="Studio Presets"
            title="Studio Presets"
            description="Pick a preset first, then Studio will load the right model and composer setup for you."
            actions={
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => router.push(`/presets/new?returnTo=${encodeURIComponent(studioReturnToHref)}`)}
                className="inline-flex h-10 items-center justify-center rounded-full border border-[rgba(208,255,72,0.28)] bg-[rgba(208,255,72,0.12)] px-4 text-sm font-semibold tracking-[-0.01em] text-[rgba(236,255,180,0.96)] transition hover:bg-[rgba(208,255,72,0.18)] hover:text-white"
              >
                New Preset
              </button>
              <button
                type="button"
                onClick={onClose}
                className="overlay-close-button h-10 w-10 bg-white/[0.04]"
                aria-label="Close preset browser"
              >
                <X className="size-5" />
              </button>
            </div>
            }
            className="border-0 pb-0"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-4 md:px-6 md:py-6">
          {presets.length ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {presets.map((preset) => {
                  const modelScope = studioPresetSupportedModels(preset, models)
                    .map((modelKey) => prettifyModelLabel(modelKey))
                    .join(", ");
                  const thumb = presetThumbnailVisual(preset);
                  return (
                    <MediaBrowserCard
                      key={preset.preset_id}
                      appearance="studio"
                      interactive
                      className="relative rounded-[26px] bg-[rgba(18,22,20,0.92)] shadow-[0_22px_54px_rgba(0,0,0,0.28)] hover:-translate-y-0.5 hover:border-[rgba(216,141,67,0.28)] hover:bg-[rgba(22,26,24,0.98)]"
                    >
                      <button
                        type="button"
                        data-testid={`studio-preset-browser-item-${preset.preset_id}`}
                        onClick={() => onSelectPreset(preset)}
                        className="grid w-full content-start gap-4 p-4 text-left"
                      >
                        <div className="flex items-start gap-4 pr-12">
                          {thumb ? (
                            <div className="media-browser-card-thumbnail surface-preview-frame h-[84px] w-[84px] shrink-0 rounded-[20px]">
                              <img src={thumb} alt={preset.label} className="h-full w-full object-cover" loading="lazy" decoding="async" />
                            </div>
                          ) : (
                            <div className="media-browser-card-thumbnail surface-preview-frame flex h-[84px] w-[84px] shrink-0 items-center justify-center rounded-[20px] text-white/58">
                              <Sparkles className="size-5" />
                            </div>
                          )}
                          <div className="media-browser-card-copy min-w-0 flex-1">
                            <div className="media-browser-card-title text-sm tracking-[-0.02em]">{preset.label}</div>
                            <div className="mt-2 text-xs font-semibold uppercase tracking-[0.14em] text-white/46">
                              Available for {modelScope || "No model scope"}
                            </div>
                            <p className="mt-2 line-clamp-3 text-sm leading-6 text-white/66">
                              {preset.description ?? "No description added yet."}
                            </p>
                          </div>
                        </div>
                        <SurfaceInset appearance="studio" density="compact" className="flex items-center justify-between gap-3 rounded-[18px] text-xs leading-5 text-white/62">
                          <span>{presetInputSummary(preset)}</span>
                          <span className="shrink-0 text-[rgba(208,255,72,0.88)]">Use preset</span>
                        </SurfaceInset>
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          router.push(`/presets/${preset.preset_id}?returnTo=${encodeURIComponent(studioReturnToHref)}`);
                        }}
                        className="overlay-close-button absolute right-4 top-4 h-9 w-9 bg-white/[0.05] text-white/72 hover:border-[rgba(208,255,72,0.38)] hover:bg-white/[0.09] hover:text-[rgba(208,255,72,0.94)]"
                        aria-label={`Edit ${preset.label}`}
                        title="Edit preset"
                      >
                        <Pencil className="size-4" />
                      </button>
                    </MediaBrowserCard>
                  );
                })}
            </div>
          ) : (
            <EmptyState
              appearance="studio"
              eyebrow="Studio Presets"
              title="No active Studio presets are available yet."
              description="Add one in the Presets admin route first."
              className="text-left"
            />
          )}
        </div>
      </div>
    </OverlayShell>
  );
}
