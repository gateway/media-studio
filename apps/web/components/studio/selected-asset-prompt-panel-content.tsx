"use client";

import { Image as ImageIcon } from "lucide-react";

import { SurfaceInset } from "@/components/ui/surface-primitives";
import type { StructuredPresetImageSlot, StructuredPresetTextField } from "@/lib/media-studio-helpers";

type SelectedAssetPromptPanelContentProps = {
  structuredPresetActive: boolean;
  presetLabel?: string | null;
  presetDescription?: string | null;
  presetSlots: StructuredPresetImageSlot[];
  presetSlotValues: Record<string, unknown>;
  presetFields: StructuredPresetTextField[];
  presetInputValues: Record<string, string>;
  prompt?: string | null;
  promptContainerClassName?: string;
};

export function SelectedAssetPromptPanelContent({
  structuredPresetActive,
  presetLabel,
  presetDescription,
  presetSlots,
  presetSlotValues,
  presetFields,
  presetInputValues,
  prompt,
  promptContainerClassName = "surface-inset rounded-[18px] px-4 py-3",
}: SelectedAssetPromptPanelContentProps) {
  if (!structuredPresetActive) {
    return (
      <div className={promptContainerClassName}>
        <p className="whitespace-pre-wrap text-sm leading-7 text-white/78">
          {prompt ?? "No prompt text was stored for this asset."}
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-2 sm:grid-cols-2">
        <SurfaceInset appearance="studio" density="compact" className="rounded-[16px]">
          <div className="text-sm text-white/56">Preset</div>
          <div className="mt-1 text-sm font-medium text-white/92">{presetLabel || "Preset"}</div>
        </SurfaceInset>
        <SurfaceInset appearance="studio" density="compact" className="rounded-[16px]">
          <div className="text-sm text-white/56">Description</div>
          <div className="mt-1 text-sm font-medium text-white/92">
            {presetDescription?.trim() || "No preset description was saved."}
          </div>
        </SurfaceInset>
      </div>
      {presetSlots.length ? (
        <div className="grid gap-3">
          {presetSlots.map((slot) => {
            const rawItems = Array.isArray(presetSlotValues[slot.key]) ? (presetSlotValues[slot.key] as unknown[]) : [];
            return (
              <SurfaceInset key={slot.key} appearance="studio" density="compact" className="rounded-[18px]">
                <div className="flex items-center gap-2 surface-label-muted">
                  <ImageIcon className="size-3.5 text-[rgba(208,255,72,0.88)]" />
                  {slot.label}
                </div>
                {slot.helpText ? <div className="mt-1 text-sm leading-6 text-white/60">{slot.helpText}</div> : null}
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <SurfaceInset appearance="studio" density="compact" className="rounded-[14px] border-transparent">
                    <div className="text-[0.72rem] uppercase tracking-[0.12em] text-white/48">Requirement</div>
                    <div className="mt-1 text-sm font-medium text-white/88">{slot.required ? "Required" : "Optional"}</div>
                  </SurfaceInset>
                  <SurfaceInset appearance="studio" density="compact" className="rounded-[14px] border-transparent">
                    <div className="text-[0.72rem] uppercase tracking-[0.12em] text-white/48">Saved input</div>
                    <div className="mt-1 text-sm font-medium text-white/88">
                      {rawItems.length > 0
                        ? `${rawItems.length} ${rawItems.length === 1 ? "reference" : "references"} attached`
                        : "No media recorded"}
                    </div>
                  </SurfaceInset>
                </div>
              </SurfaceInset>
            );
          })}
        </div>
      ) : null}
      {presetFields.length ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {presetFields.map((field) => (
            <SurfaceInset key={field.key} appearance="studio" density="compact" className="rounded-[16px]">
              <div className="text-sm text-white/56">{field.label}</div>
              <div className="mt-1 text-sm font-medium text-white/92">
                {presetInputValues[field.key] || field.defaultValue || "Not provided"}
              </div>
            </SurfaceInset>
          ))}
        </div>
      ) : null}
    </div>
  );
}
