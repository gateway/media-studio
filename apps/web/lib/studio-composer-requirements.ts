import type { AttachmentRecord } from "@/lib/media-studio-contract";
import {
  isPresetSlotFilled,
  type PresetSlotState,
  type StandardComposerLayout,
  type StructuredPresetImageSlot,
  type StructuredPresetTextField,
} from "@/lib/media-studio-helpers";
import { presetRequirementMessage } from "@/lib/studio-gallery";
import { motionControlVideoInputError } from "@/lib/studio-motion-validation";
import type { MediaAsset, MediaModelSummary, MediaPreset } from "@/lib/types";
import { isRecord } from "@/lib/utils";

export function studioPresetRequirementError({
  presetDetailPending,
  structuredPresetActive,
  currentPresetCompatibleWithModel,
  currentPreset,
  structuredPresetTextFields,
  structuredPresetImageSlots,
  presetInputValues,
  presetSlotStates,
  attachments,
  sourceAsset,
}: {
  presetDetailPending: boolean;
  structuredPresetActive: boolean;
  currentPresetCompatibleWithModel: boolean;
  currentPreset: MediaPreset | null;
  structuredPresetTextFields: StructuredPresetTextField[];
  structuredPresetImageSlots: StructuredPresetImageSlot[];
  presetInputValues: Record<string, string>;
  presetSlotStates: Record<string, PresetSlotState>;
  attachments: AttachmentRecord[];
  sourceAsset: MediaAsset | null;
}) {
  if (presetDetailPending) return "Preset details are still loading.";
  if (structuredPresetActive) {
    const field = structuredPresetTextFields.find(
      (field) =>
        field.required &&
        !String(
          presetInputValues[field.key] ?? field.defaultValue ?? "",
        ).trim(),
    );
    if (field)
      return `The preset ${currentPreset?.label} requires the text field ${field.label}.`;
    const slot = structuredPresetImageSlots.find(
      (slot) =>
        slot.required && !isPresetSlotFilled(presetSlotStates[slot.key]),
    );
    return slot
      ? `The preset ${currentPreset?.label} requires the image slot ${slot.label}.`
      : null;
  }
  return currentPresetCompatibleWithModel
    ? presetRequirementMessage(currentPreset, attachments, sourceAsset)
    : null;
}

function requiredImageCountError(
  model: MediaModelSummary | null,
  filled: number,
) {
  const imageInputSpec = isRecord(model?.image_inputs)
    ? model.image_inputs
    : null;
  const rawRequiredMin = imageInputSpec?.required_min;
  const required = Number(rawRequiredMin);
  if (!Number.isFinite(required) || required <= 0 || filled >= required)
    return null;
  return required === 1
    ? "Add a source image before generating with this image-to-image model."
    : `Add ${required} source images before generating with this image-to-image model.`;
}

export function studioRequiredInputError({
  slots,
  model,
  attachments,
  sourceAsset,
  optionValues,
  stagedImageCount,
  structuredPresetImageInputCount,
}: {
  slots: StandardComposerLayout["slots"];
  model: MediaModelSummary | null;
  attachments: AttachmentRecord[];
  sourceAsset: MediaAsset | null;
  optionValues: Record<string, unknown>;
  stagedImageCount: number;
  structuredPresetImageInputCount: number;
}) {
  const missing = slots.find(
    (slot) => slot.visible && slot.required && !slot.filled,
  );
  if (missing)
    return `Add ${missing.label.toLowerCase()} before generating with this model.`;
  const motionError = motionControlVideoInputError({
    model,
    attachments,
    sourceAsset,
    optionValues,
  });
  if (motionError) return motionError;
  return requiredImageCountError(
    model,
    stagedImageCount + structuredPresetImageInputCount,
  );
}
