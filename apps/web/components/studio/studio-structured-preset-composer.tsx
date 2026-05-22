"use client";

import type { DragEvent } from "react";

import { ImagePlus } from "lucide-react";

import { StudioStagedMediaTile } from "@/components/studio/studio-staged-media-tile";
import { findMediaAssetById } from "@/lib/studio-gallery";
import {
  mediaThumbnailUrl,
  type PresetSlotState,
  type StudioReferencePreview,
  type StructuredPresetImageSlot,
  type StructuredPresetTextField,
} from "@/lib/media-studio-helpers";
import type { MediaAsset, MediaPreset } from "@/lib/types";
import { cn } from "@/lib/utils";

type StudioStructuredPresetComposerProps = {
  preset: MediaPreset | null;
  imageSlots: StructuredPresetImageSlot[];
  textFields: StructuredPresetTextField[];
  slotStates: Record<string, PresetSlotState>;
  inputValues: Record<string, string>;
  localAssets: MediaAsset[];
  favoriteAssets: MediaAsset[];
  onPresetInputValuesChange: (updater: (current: Record<string, string>) => Record<string, string>) => void;
  onAssignSlotFile: (slotKey: string, file: File | null) => void;
  onClearSlot: (slotKey: string) => void;
  onDropSlot: (event: DragEvent<HTMLDivElement | HTMLLabelElement>, slotKey: string) => void;
  onOpenPreview: (preview: StudioReferencePreview) => void;
  onResetFileInput: (input: HTMLInputElement | null) => void;
};

function buildSlotPreview(
  slot: StructuredPresetImageSlot,
  slotState: PresetSlotState | undefined,
  localAssets: MediaAsset[],
  favoriteAssets: MediaAsset[],
) {
  const slotPreview = slotState?.assetId
    ? mediaThumbnailUrl(findMediaAssetById(slotState.assetId, localAssets, favoriteAssets) ?? null) ?? slotState.previewUrl
    : slotState?.referenceId
      ? slotState.referenceRecord?.thumb_url ?? slotState.referenceRecord?.stored_url ?? slotState.previewUrl
      : slotState?.previewUrl;

  if (!slotPreview) {
    return { slotPreview: null, presetSlotPreview: null };
  }

  return {
    slotPreview,
    presetSlotPreview: {
      key: `preset-slot:${slot.key}`,
      label: slot.label,
      url: slotPreview,
      kind: "images",
      posterUrl: null,
    } satisfies StudioReferencePreview,
  };
}

export function StudioStructuredPresetComposer({
  preset,
  imageSlots,
  textFields,
  slotStates,
  inputValues,
  localAssets,
  favoriteAssets,
  onPresetInputValuesChange,
  onAssignSlotFile,
  onClearSlot,
  onDropSlot,
  onOpenPreview,
  onResetFileInput,
}: StudioStructuredPresetComposerProps) {
  return (
    <div className="studio-panel relative grid gap-3 px-4 py-4">
      <div className={cn("grid gap-3", imageSlots.length ? "lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)] lg:items-start" : "")}>
        <div className="studio-panel-compact p-4">
          <div className="studio-field-label">Preset</div>
          <div className="mt-2 text-base font-semibold tracking-[-0.03em] text-[var(--text-primary)]">{preset?.label}</div>
          {preset?.description ? <p className="mt-3 text-sm leading-7 text-[var(--text-muted)]">{preset.description}</p> : null}
        </div>

        {imageSlots.length ? (
          <div className="grid gap-3">
            {imageSlots.map((slot) => {
              const { slotPreview, presetSlotPreview } = buildSlotPreview(slot, slotStates[slot.key], localAssets, favoriteAssets);

              return (
                <div
                  key={slot.key}
                  data-testid={`studio-preset-slot-${slot.key}`}
                  className="studio-panel-compact p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-[var(--text-primary)]">{slot.label}</div>
                      <div className="mt-1 text-xs leading-6 text-[var(--text-muted)]">
                        {slot.helpText || "Upload or drag an image into this slot."}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-3">
                    <div className="relative h-[86px] w-[86px] shrink-0">
                      {presetSlotPreview ? (
                        <div
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => onDropSlot(event, slot.key)}
                          className="h-full w-full"
                        >
                          <StudioStagedMediaTile
                            preview={presetSlotPreview}
                            visualUrl={slotPreview}
                            onOpenPreview={onOpenPreview}
                            onRemove={() => onClearSlot(slot.key)}
                            replaceControl={
                              <label className="studio-icon-button h-8 w-8 cursor-pointer">
                                <ImagePlus className="size-3.5" />
                                <input
                                  type="file"
                                  accept="image/*"
                                  data-testid={`studio-preset-slot-input-${slot.key}`}
                                  className="hidden"
                                  onChange={(event) => {
                                    onAssignSlotFile(slot.key, event.target.files?.[0] ?? null);
                                    onResetFileInput(event.currentTarget);
                                  }}
                                />
                              </label>
                            }
                            className="h-full w-full"
                            testId={`studio-preset-slot-filled-${slot.key}`}
                          />
                        </div>
                      ) : (
                        <label
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => onDropSlot(event, slot.key)}
                          className="studio-slot-tile relative flex h-full w-full cursor-pointer items-center justify-center overflow-hidden"
                        >
                          <ImagePlus className="size-5" />
                          <input
                            type="file"
                            accept="image/*"
                            data-testid={`studio-preset-slot-input-${slot.key}`}
                            className="hidden"
                            onChange={(event) => {
                              onAssignSlotFile(slot.key, event.target.files?.[0] ?? null);
                              onResetFileInput(event.currentTarget);
                            }}
                          />
                        </label>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      {textFields.length ? (
        <div className="grid gap-3 pt-1 sm:grid-cols-2">
          {textFields.map((field) => (
            <label key={field.key} className="grid gap-2">
              <span className="studio-field-label">{field.label}</span>
              <input
                value={inputValues[field.key] ?? field.defaultValue ?? ""}
                onChange={(event) => onPresetInputValuesChange((current) => ({ ...current, [field.key]: event.target.value }))}
                placeholder={field.placeholder || field.label}
                className="studio-text-input"
              />
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}
