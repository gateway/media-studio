"use client";

import { Pencil, Sparkles, X } from "lucide-react";
import { useRouter } from "next/navigation";

import { presetThumbnailVisual, prettifyModelLabel, studioPresetSupportedModels } from "@/lib/media-studio-helpers";
import type { MediaPreset } from "@/lib/types";

type StudioPresetBrowserProps = {
  presets: MediaPreset[];
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
  onClose,
  onSelectPreset,
}: StudioPresetBrowserProps) {
  const router = useRouter();

  return (
    <div data-testid="studio-preset-browser" className="fixed inset-0 z-[118] overflow-y-auto overscroll-contain bg-[rgba(6,8,7,0.78)] backdrop-blur-md [webkit-overflow-scrolling:touch]">
      <div className="min-h-dvh p-0 lg:p-6">
        <div className="flex min-h-dvh min-w-0 flex-col bg-[linear-gradient(180deg,rgba(16,20,18,0.98),rgba(10,13,12,0.98))] shadow-[0_40px_100px_rgba(0,0,0,0.5)] lg:h-[calc(100dvh-3rem)] lg:min-h-0 lg:max-h-[calc(100dvh-3rem)] lg:overflow-hidden lg:rounded-[34px] lg:border lg:border-white/8">
          <div className="flex items-center justify-between gap-3 border-b border-white/8 px-4 py-4 md:px-6">
            <div>
              <div className="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-[rgba(208,255,72,0.94)]">
                Studio Presets
              </div>
              <div className="mt-1 text-sm text-white/68">
                Pick a preset first, then Studio will load the right model and composer setup for you.
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/78 transition hover:border-[rgba(216,141,67,0.28)] hover:text-white"
              aria-label="Close preset browser"
            >
              <X className="size-5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-4 md:px-6 md:py-6">
            {presets.length ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {presets.map((preset) => {
                  const modelScope = studioPresetSupportedModels(preset)
                    .map((modelKey) => prettifyModelLabel(modelKey))
                    .join(", ");
                  const thumb = presetThumbnailVisual(preset);
                  return (
                    <div
                      key={preset.preset_id}
                      className="relative rounded-[26px] border border-white/10 bg-[rgba(18,22,20,0.92)] shadow-[0_22px_54px_rgba(0,0,0,0.28)] transition hover:-translate-y-0.5 hover:border-[rgba(216,141,67,0.28)] hover:bg-[rgba(22,26,24,0.98)]"
                    >
                      <button
                        type="button"
                        data-testid={`studio-preset-browser-item-${preset.preset_id}`}
                        onClick={() => onSelectPreset(preset)}
                        className="grid w-full content-start gap-4 p-4 text-left"
                      >
                        <div className="flex items-start gap-4 pr-12">
                          {thumb ? (
                            <div className="h-[84px] w-[84px] shrink-0 overflow-hidden rounded-[20px] border border-white/10 bg-white/[0.05]">
                              <img src={thumb} alt={preset.label} className="h-full w-full object-cover" loading="lazy" decoding="async" />
                            </div>
                          ) : (
                            <div className="flex h-[84px] w-[84px] shrink-0 items-center justify-center rounded-[20px] border border-white/10 bg-white/[0.05] text-white/58">
                              <Sparkles className="size-5" />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-semibold tracking-[-0.02em] text-white/94">{preset.label}</div>
                            <div className="mt-2 text-xs font-semibold uppercase tracking-[0.14em] text-white/46">
                              Available for {modelScope || "No model scope"}
                            </div>
                            <p className="mt-2 line-clamp-3 text-sm leading-6 text-white/66">
                              {preset.description ?? "No description added yet."}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-3 rounded-[18px] border border-white/8 bg-white/[0.03] px-3 py-3 text-xs leading-5 text-white/62">
                          <span>{presetInputSummary(preset)}</span>
                          <span className="shrink-0 text-[rgba(208,255,72,0.88)]">Use preset</span>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          router.push(`/presets/${preset.preset_id}`);
                        }}
                        className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-white/72 transition hover:border-[rgba(208,255,72,0.38)] hover:bg-white/[0.09] hover:text-[rgba(208,255,72,0.94)]"
                        aria-label={`Edit ${preset.label}`}
                        title="Edit preset"
                      >
                        <Pencil className="size-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-[26px] border border-dashed border-white/10 bg-[rgba(18,22,20,0.92)] px-5 py-8 text-sm leading-7 text-white/62">
                No active Studio presets are available yet. Add one in the Presets admin route first.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
