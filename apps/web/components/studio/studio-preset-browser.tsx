"use client";

import { Pencil, Sparkles, X } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { EmptyState, MediaBrowserCard, OverlayHeader, OverlayShell } from "@/components/ui/surface-primitives";
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
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
              {presets.map((preset) => {
                const modelScope = studioPresetSupportedModels(preset, models)
                  .map((modelKey) => prettifyModelLabel(modelKey))
                  .join(", ");
                const thumb = presetThumbnailVisual(preset);
                return (
                  <MediaBrowserCard
                    key={preset.preset_id}
                    data-testid={`studio-preset-browser-card-${preset.preset_id}`}
                    appearance="studio"
                    interactive
                    className="shadow-[0_18px_40px_rgba(0,0,0,0.24)]"
                  >
                    <button
                      type="button"
                      onClick={() => onSelectPreset(preset)}
                      className="media-browser-card-thumbnail group relative aspect-square text-left"
                    >
                      {thumb ? (
                        <img
                          src={thumb}
                          alt={preset.label}
                          className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-white/58">
                          <Sparkles className="size-6" />
                        </div>
                      )}
                    </button>
                    <div className="media-browser-card-copy">
                      <div className="media-browser-card-title truncate">{preset.label}</div>
                      <div className="media-browser-card-description line-clamp-2 min-h-[2rem]">
                        {preset.description ?? "No description added yet."}
                      </div>
                    </div>
                    <div className="media-browser-card-meta">
                      Available for {modelScope || "No model scope"}
                    </div>
                    <div className="media-browser-card-meta">
                      {presetInputSummary(preset)}
                    </div>
                    <div className="media-browser-card-actions">
                      <Button
                        type="button"
                        data-testid={`studio-preset-browser-item-${preset.preset_id}`}
                        onClick={() => onSelectPreset(preset)}
                        variant="primary"
                        size="compact"
                        className="h-8 min-w-0 rounded-full px-3 text-[0.62rem] tracking-[0.12em] text-[#172200]"
                      >
                        <Sparkles className="mr-1.5 size-3.5" />
                        Use preset
                      </Button>
                      <IconButton
                        icon={Pencil}
                        onClick={() => router.push(`/presets/${preset.preset_id}?returnTo=${encodeURIComponent(studioReturnToHref)}`)}
                        className="h-8 w-8 rounded-full"
                        aria-label={`Edit ${preset.label}`}
                        title="Edit preset"
                      />
                    </div>
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
