"use client";

import type { DragEvent } from "react";

import { Image as ImageIcon, Layers, ChevronDown } from "lucide-react";

import { StudioReferenceSourceMenu } from "@/components/studio/studio-reference-source-menu";
import { StudioStagedMediaTile } from "@/components/studio/studio-staged-media-tile";
import { Button } from "@/components/ui/button";
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
  onOpenPresets: () => void;
  onPresetInputValuesChange: (
    updater: (current: Record<string, string>) => Record<string, string>,
  ) => void;
  onAssignSlotFile: (slotKey: string, file: File | null) => void;
  onClearSlot: (slotKey: string) => void;
  onOpenSlotLibrary: (
    slot: StructuredPresetImageSlot,
    returnFocusTo: HTMLButtonElement,
  ) => void;
  onDropSlot: (
    event: DragEvent<HTMLDivElement | HTMLLabelElement>,
    slotKey: string,
  ) => void;
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
    ? (mediaThumbnailUrl(
        findMediaAssetById(slotState.assetId, localAssets, favoriteAssets) ??
          null,
      ) ?? slotState.previewUrl)
    : slotState?.referenceId
      ? (slotState.referenceRecord?.thumb_url ??
        slotState.referenceRecord?.stored_url ??
        slotState.previewUrl)
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

function StudioStructuredPresetSummary({
  preset,
  fixedPrompt,
  onOpenPresets,
}: Pick<StudioStructuredPresetComposerProps, "preset" | "onOpenPresets"> & {
  fixedPrompt: boolean;
}) {
  return (
    <div className="studio-structured-preset-summary">
      <Button
        variant="subtle"
        className="studio-structured-preset-name"
        onClick={onOpenPresets}
        aria-label={`Choose preset: ${preset?.label ?? "Preset"}`}
        aria-haspopup="dialog"
      >
        <Layers aria-hidden="true" className="studio-structured-preset-icon" />
        <span className="studio-structured-preset-title">{preset?.label}</span>
        <ChevronDown
          aria-hidden="true"
          className="studio-structured-preset-icon"
        />
      </Button>
      {preset?.description ? <p>{preset.description}</p> : null}
      {fixedPrompt ? (
        <p>This preset uses a fixed prompt. No text input is needed.</p>
      ) : null}
    </div>
  );
}

export function StudioStructuredPresetComposer({
  preset,
  imageSlots,
  textFields,
  slotStates,
  inputValues,
  localAssets,
  favoriteAssets,
  onOpenPresets,
  onPresetInputValuesChange,
  onAssignSlotFile,
  onClearSlot,
  onOpenSlotLibrary,
  onDropSlot,
  onOpenPreview,
  onResetFileInput,
}: StudioStructuredPresetComposerProps) {
  return (
    <div className="studio-structured-preset">
      <StudioStructuredPresetSummary
        preset={preset}
        fixedPrompt={!textFields.length}
        onOpenPresets={onOpenPresets}
      />

      <div className="studio-structured-preset-inputs">
        {imageSlots.length ? (
          <div className="studio-media-slot-grid">
            {imageSlots.map((slot) => {
              const { slotPreview, presetSlotPreview } = buildSlotPreview(
                slot,
                slotStates[slot.key],
                localAssets,
                favoriteAssets,
              );
              const action = presetSlotPreview ? "Replace" : "Add";
              const slotLabel =
                !presetSlotPreview && slot.required
                  ? `${slot.label} (required)`
                  : slot.label;
              const sourceMenu = (
                <StudioReferenceSourceMenu
                  action={action}
                  label={`${action} ${slotLabel}`}
                  accept="image/*"
                  multiple={false}
                  testId={`studio-preset-slot-input-${slot.key}`}
                  onPickFiles={(files, input) => {
                    if (!files?.length) return;
                    onAssignSlotFile(slot.key, files[0]);
                    onResetFileInput(input);
                  }}
                  onOpenLibrary={(trigger) => onOpenSlotLibrary(slot, trigger)}
                />
              );
              return (
                <div
                  key={slot.key}
                  data-testid={`studio-preset-slot-${slot.key}`}
                  className="studio-fixed-slot studio-structured-preset-slot"
                >
                  <div className="studio-structured-preset-slot-label">
                    <ImageIcon
                      aria-hidden="true"
                      className="studio-structured-preset-icon"
                    />
                    <span>{slot.label}</span>
                  </div>
                  <div
                    className={cn(
                      "studio-fixed-slot-media",
                      !presetSlotPreview && "studio-reference-add-overview",
                    )}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => onDropSlot(event, slot.key)}
                  >
                    {presetSlotPreview ? (
                      <StudioStagedMediaTile
                        preview={presetSlotPreview}
                        visualUrl={slotPreview}
                        onOpenPreview={onOpenPreview}
                        onRemove={() => onClearSlot(slot.key)}
                        replaceControl={sourceMenu}
                        className="studio-structured-preset-tile"
                        testId={`studio-preset-slot-filled-${slot.key}`}
                      />
                    ) : (
                      sourceMenu
                    )}
                  </div>
                  {slot.helpText ? (
                    <p className="studio-structured-preset-help">
                      {slot.helpText}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
        {textFields.length ? (
          <div className="studio-structured-preset-fields">
            {textFields.map((field) => (
              <label key={field.key} className="studio-structured-preset-field">
                <span>{field.label}</span>
                <input
                  value={inputValues[field.key] ?? field.defaultValue ?? ""}
                  aria-required={field.required}
                  onChange={(event) =>
                    onPresetInputValuesChange((current) => ({
                      ...current,
                      [field.key]: event.target.value,
                    }))
                  }
                  placeholder={field.placeholder || field.label}
                  className="studio-text-input"
                />
              </label>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
