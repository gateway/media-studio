import type { AttachmentRecord } from "@/lib/media-studio-contract";
import { buildNormalizedStudioOptions } from "@/lib/studio-options";
import {
  findMediaAssetById,
  structuredPresetInputValues,
  structuredPresetInputValuesFromBatch,
  structuredPresetSlotValues,
  structuredPresetSlotValuesFromBatch,
} from "@/lib/studio-gallery";
import type {
  MediaAsset,
  MediaBatch,
  MediaJob,
  MediaModelSummary,
  MediaPreset,
  MediaReference,
  MediaValidationResponse,
} from "@/lib/types";
import { isRecord } from "@/lib/utils";
import { supportedModelInputPatterns } from "@/lib/studio-model-support";
import {
  mediaDisplayUrl,
  mediaDownloadName,
  mediaDownloadUrl,
  mediaInlineUrl,
  mediaPlaybackUrl,
  mediaPreviewUrl,
  mediaThumbnailUrl,
  referencePlaybackUrl,
  referencePreviewUrl,
} from "@/lib/studio-media-urls";

import { toControlApiDataPreviewPath, toControlApiProxyPath } from "./media-paths";

export { isRecord } from "@/lib/utils";
export { supportedModelInputPatterns } from "@/lib/studio-model-support";
export {
  mediaDisplayUrl,
  mediaDownloadName,
  mediaDownloadUrl,
  mediaInlineUrl,
  mediaPlaybackUrl,
  mediaPreviewUrl,
  mediaThumbnailUrl,
  mediaVariantUrl,
  prefetchAssetThumbs,
  referencePlaybackUrl,
  referencePreviewUrl,
} from "@/lib/studio-media-urls";
export { batchPhaseMessage, jobPhaseMessage, jobStatusLabel, toneForStatus } from "@/lib/studio-status";

export type StructuredPresetTextField = {
  key: string;
  label: string;
  placeholder: string;
  defaultValue: string;
  required: boolean;
};

export type StructuredPresetImageSlot = {
  key: string;
  label: string;
  helpText: string;
  required: boolean;
  maxFiles: number;
};

export type PresetSlotState = {
  assetId: string | number | null;
  referenceId?: string | null;
  referenceRecord?: MediaReference | null;
  file: File | null;
  previewUrl: string | null;
};

export type StudioReferencePreview = {
  key: string;
  label: string;
  url: string;
  kind: "images" | "videos" | "audios";
  posterUrl?: string | null;
};

export type StudioJobReferenceInput = StudioReferencePreview & {
  assetId: string | number | null;
  kind: "images" | "videos" | "audios";
  role: "first_frame" | "last_frame" | "reference" | null;
};

export type StudioJobPrimaryInput = {
  assetId: string | number | null;
  url: string;
  kind: "images" | "videos" | "audios";
  role: "first_frame" | "last_frame" | "reference" | null;
};

export type StudioRetryPresetSlotRestore = {
  slotKey: string;
  label: string;
  assetId: string | number | null;
  url: string | null;
};

export type StudioRetryRestorePlan = {
  targetModel: MediaModelSummary | null;
  targetPreset: MediaPreset | null;
  projectId: string | null;
  selectedPromptIds: string[];
  prompt: string;
  presetInputValues: Record<string, string>;
  optionValues: Record<string, unknown>;
  outputCount: number;
  primaryInput: StudioJobPrimaryInput | null;
  referenceInputs: StudioJobReferenceInput[];
  presetSlotRestores: StudioRetryPresetSlotRestore[];
};

export type OrderedImageInput =
  | { source: "asset"; asset: MediaAsset }
  | { source: "reference"; reference: MediaReference; previewUrl: string | null; attachmentId: string }
  | { source: "attachment"; attachment: { id: string; previewUrl: string | null; referenceRecord?: MediaReference | null } };

export type MediaAttachmentKind = {
  kind: "images" | "videos" | "audios";
  role?: "first_frame" | "last_frame" | "reference" | null;
};

export type StudioComposerSlotKind = "image" | "video" | "audio";

export type StudioComposerSlotRole =
  | "source_image"
  | "start_frame"
  | "end_frame"
  | "driving_video"
  | "reference";

export type StudioComposerSlot = {
  id: string;
  kind: StudioComposerSlotKind;
  role: StudioComposerSlotRole;
  label: string;
  required: boolean;
  visible: boolean;
  filled: boolean;
  accept: string;
  slotIndex: number;
  supportsGalleryDrop: boolean;
};

export type StandardComposerLayout = {
  slots: StudioComposerSlot[];
  summaryLabel: string | null;
  usesExplicitSlots: boolean;
};

export type PromptReferenceMentionMatch = {
  start: number;
  end: number;
  query: string;
};

export const STUDIO_NANO_MAX_OUTPUTS = 10;

function isDefaultImageAttachment(attachment: AttachmentRecord) {
  return attachment.kind === "images" && !attachment.role;
}

export function buildOrderedImageInputs(
  currentSourceAsset: MediaAsset | null,
  imageAttachments: AttachmentRecord[],
  sourceAssetIsImage: boolean,
) {
  const items: OrderedImageInput[] = [];
  if (sourceAssetIsImage && currentSourceAsset) {
    items.push({ source: "asset", asset: currentSourceAsset });
  }
  for (const attachment of imageAttachments) {
    if (attachment.referenceRecord && attachment.referenceId) {
      items.push({
        source: "reference",
        reference: attachment.referenceRecord,
        previewUrl: attachment.previewUrl,
        attachmentId: attachment.id,
      });
      continue;
    }
    items.push({ source: "attachment", attachment });
  }
  return items;
}

export function orderedImageInputKey(input: OrderedImageInput | null | undefined, slotIndex: number) {
  if (!input) {
    return `image-slot-${slotIndex}`;
  }
  if (input.source === "asset") {
    return `asset:${input.asset.asset_id}`;
  }
  if (input.source === "reference") {
    return `reference:${input.attachmentId}`;
  }
  return `attachment:${input.attachment.id}`;
}

export function insertImageAttachments(
  currentAttachments: AttachmentRecord[],
  nextAttachments: AttachmentRecord[],
  insertAtIndex: number,
) {
  if (!nextAttachments.length) {
    return currentAttachments;
  }
  const normalizedIndex = Math.max(0, insertAtIndex);
  const result: AttachmentRecord[] = [];
  let inserted = false;
  let imageIndex = 0;

  for (const attachment of currentAttachments) {
    if (!inserted && isDefaultImageAttachment(attachment) && imageIndex === normalizedIndex) {
      result.push(...nextAttachments);
      inserted = true;
    }
    result.push(attachment);
    if (isDefaultImageAttachment(attachment)) {
      imageIndex += 1;
    }
  }

  if (!inserted) {
    result.push(...nextAttachments);
  }

  return result;
}

export function resolveComposerSourceAsset(
  sourceAssetId: string | number | null,
  stagedSourceAsset: MediaAsset | null,
  ...collections: Array<MediaAsset[] | null | undefined>
) {
  const resolvedAsset = findMediaAssetById(sourceAssetId, ...collections);
  if (resolvedAsset) {
    return resolvedAsset;
  }
  if (sourceAssetId == null || !stagedSourceAsset) {
    return null;
  }
  return String(stagedSourceAsset.asset_id) === String(sourceAssetId) ? stagedSourceAsset : null;
}

export function detectPromptReferenceMention(prompt: string, caretIndex: number | null | undefined) {
  const normalizedCaret = Math.max(0, Math.min(caretIndex ?? prompt.length, prompt.length));
  const atIndex = prompt.lastIndexOf("@", normalizedCaret - 1);
  if (atIndex === -1) {
    return null;
  }

  const beforeAt = atIndex > 0 ? prompt[atIndex - 1] : "";
  if (beforeAt && !/\s|[([{,]/.test(beforeAt)) {
    return null;
  }

  const segment = prompt.slice(atIndex + 1, normalizedCaret);
  if (/[\n\r[\]]/.test(segment)) {
    return null;
  }

  return {
    start: atIndex,
    end: normalizedCaret,
    query: segment.trim().toLowerCase(),
  } satisfies PromptReferenceMentionMatch;
}

export function applyPromptReferenceMention(
  prompt: string,
  mention: PromptReferenceMentionMatch,
  replacement: string,
) {
  const suffix = prompt.slice(mention.end);
  const needsTrailingSpace = suffix.length > 0 && !/^\s|[.,!?;:)\]]/.test(suffix);
  const separator = needsTrailingSpace ? " " : "";
  const nextPrompt = `${prompt.slice(0, mention.start)}${replacement}${separator}${suffix}`;
  const nextCaretIndex = mention.start + replacement.length + separator.length;
  return {
    prompt: nextPrompt,
    caretIndex: nextCaretIndex,
  };
}

export const MULTI_SHOT_MODEL_KEYS = new Set(["kling-3.0-t2v", "kling-3.0-i2v"]);
export const SEEDANCE_MODEL_KEYS = new Set(["seedance-2.0"]);

const LEGACY_STRUCTURED_IMAGE_PRESET_MODEL_KEYS = [
  "nano-banana-2",
  "nano-banana-pro",
  "gpt-image-2-text-to-image",
  "gpt-image-2-image-to-image",
] as const;

export function isStructuredImagePresetModel(modelKey: string | null | undefined) {
  return LEGACY_STRUCTURED_IMAGE_PRESET_MODEL_KEYS.includes(modelKey as (typeof LEGACY_STRUCTURED_IMAGE_PRESET_MODEL_KEYS)[number]);
}

export function modelSupportsStructuredImagePreset(model: MediaModelSummary | null | undefined, requiresImage: boolean) {
  if (!model || model.studio_exposed === false) {
    return false;
  }
  const taskModes = new Set(model.task_modes ?? []);
  const inputPatterns = new Set(supportedModelInputPatterns(model));
  const imageInputs = model.image_inputs ?? {};
  const videoInputs = model.video_inputs ?? {};
  const audioInputs = model.audio_inputs ?? {};
  const imageMin = Number(imageInputs.required_min ?? 0) || 0;
  const imageMax = Number(imageInputs.required_max ?? 0) || 0;
  const hasVideoOrAudioInputs =
    Number(videoInputs.required_min ?? 0) > 0 ||
    Number(videoInputs.required_max ?? 0) > 0 ||
    Number(audioInputs.required_min ?? 0) > 0 ||
    Number(audioInputs.required_max ?? 0) > 0;
  if (hasVideoOrAudioInputs || model.generation_kind === "video") {
    return false;
  }
  if (requiresImage) {
    return imageMax > 0 && (taskModes.has("image_edit") || inputPatterns.has("single_image") || inputPatterns.has("image_edit"));
  }
  return imageMin === 0 && (taskModes.has("text_to_image") || taskModes.has("image_generation") || inputPatterns.has("prompt_only"));
}

export function presetRequiresImageInput(preset: MediaPreset | null | undefined) {
  const slots = ((preset?.input_slots_json as Array<Record<string, unknown>> | undefined) ?? []);
  return slots.some((slot) => Boolean(slot.required));
}

export function compatibleStructuredImagePresetModels(models: MediaModelSummary[], requiresImage: boolean) {
  return models.filter((model) => modelSupportsStructuredImagePreset(model, requiresImage));
}

export function studioPresetSupportedModels(preset: MediaPreset | null | undefined, models?: MediaModelSummary[]) {
  const scopedModels = preset?.applies_to_models?.length
    ? preset.applies_to_models
    : preset?.model_key
      ? [preset.model_key]
      : [];
  const uniqueScopedModels = Array.from(new Set(scopedModels.filter((modelKey): modelKey is string => Boolean(modelKey))));
  if (models?.length) {
    const requiresImage = presetRequiresImageInput(preset);
    const modelByKey = new Map(models.map((model) => [model.key, model]));
    return uniqueScopedModels.filter((modelKey) => {
      const model = modelByKey.get(modelKey);
      return model ? modelSupportsStructuredImagePreset(model, requiresImage) : false;
    });
  }
  return uniqueScopedModels.filter((modelKey) => isStructuredImagePresetModel(modelKey));
}

export function studioPresetSupportsModel(
  preset: MediaPreset | null | undefined,
  modelKey: string | null | undefined,
  models?: MediaModelSummary[],
) {
  if (!modelKey) {
    return false;
  }
  return studioPresetSupportedModels(preset, models).includes(modelKey);
}

export function isStudioPresetVisible(preset: MediaPreset | null | undefined, models?: MediaModelSummary[]) {
  if (!preset) {
    return false;
  }
  return String(preset.status ?? "").toLowerCase() === "active" && studioPresetSupportedModels(preset, models).length > 0;
}

export function resolveStudioPresetTargetModel(
  preset: MediaPreset | null | undefined,
  preferredModelKey: string | null | undefined,
  fallbackModelKey?: string | null | undefined,
  models?: MediaModelSummary[],
) {
  const supportedModels = studioPresetSupportedModels(preset, models);
  if (!supportedModels.length) {
    return null;
  }
  if (preferredModelKey && supportedModels.includes(preferredModelKey)) {
    return preferredModelKey;
  }
  if (fallbackModelKey && supportedModels.includes(fallbackModelKey)) {
    return fallbackModelKey;
  }
  return supportedModels[0] ?? null;
}

export function isSeedanceModel(modelKey: string | null | undefined) {
  return Boolean(modelKey && SEEDANCE_MODEL_KEYS.has(modelKey));
}

export function modelSupportsImageDrivenInputs(model: MediaModelSummary | null) {
  const patterns = new Set(supportedModelInputPatterns(model));
  return (
    patterns.has("single_image") ||
    patterns.has("image_edit") ||
    patterns.has("first_last_frames") ||
    patterns.has("multimodal_reference") ||
    patterns.has("motion_control")
  );
}

export function modelSupportsFirstLastFrames(model: MediaModelSummary | null) {
  return new Set(supportedModelInputPatterns(model)).has("first_last_frames");
}

export function modelSupportsMotionControl(model: MediaModelSummary | null) {
  return new Set(supportedModelInputPatterns(model)).has("motion_control");
}

export function resolveStandardComposerSlots({
  model,
  attachments,
  sourceAsset,
}: {
  model: MediaModelSummary | null;
  attachments: MediaAttachmentKind[];
  sourceAsset: MediaAsset | null;
}): StandardComposerLayout {
  const patterns = new Set(supportedModelInputPatterns(model));
  const maxImageInputs = modelInputLimit(model, "image_inputs");
  const maxVideoInputs = modelInputLimit(model, "video_inputs");
  const maxAudioInputs = modelInputLimit(model, "audio_inputs");
  const imageCount =
    attachments.filter((attachment) => attachment.kind === "images").length +
    (sourceAsset?.generation_kind === "image" ? 1 : 0);
  const videoCount =
    attachments.filter((attachment) => attachment.kind === "videos").length +
    (sourceAsset?.generation_kind === "video" ? 1 : 0);

  if (patterns.has("motion_control") && maxImageInputs === 1 && maxVideoInputs === 1 && maxAudioInputs === 0) {
    const slots: StudioComposerSlot[] = [
      {
        id: "slot-source-image",
        kind: "image",
        role: "source_image",
        label: "Source image",
        required: true,
        visible: true,
        filled: imageCount >= 1,
        accept: "image/*",
        slotIndex: 0,
        supportsGalleryDrop: true,
      },
      {
        id: "slot-driving-video",
        kind: "video",
        role: "driving_video",
        label: "Driving video",
        required: true,
        visible: true,
        filled: videoCount >= 1,
        accept: "video/*",
        slotIndex: 1,
        supportsGalleryDrop: true,
      },
    ];
    const filledCount = slots.filter((slot) => slot.filled).length;
    return {
      slots,
      summaryLabel: `${filledCount} / ${slots.length} inputs`,
      usesExplicitSlots: true,
    };
  }

  const usesExplicitImageSlots =
    patterns.has("first_last_frames") &&
    maxImageInputs === 2 &&
    maxVideoInputs === 0 &&
    maxAudioInputs === 0;

  const usesExplicitSingleImageSlot =
    maxImageInputs === 1 &&
    maxVideoInputs === 0 &&
    maxAudioInputs === 0 &&
    (patterns.has("single_image") || patterns.has("image_edit"));

  if (!usesExplicitImageSlots && !usesExplicitSingleImageSlot) {
    return {
      slots: [],
      summaryLabel: null,
      usesExplicitSlots: false,
    };
  }

  const slots: StudioComposerSlot[] = usesExplicitImageSlots
    ? [
        {
          id: "slot-start-frame",
          kind: "image",
          role: "start_frame",
          label: "Start frame",
          required: true,
          visible: true,
          filled: imageCount >= 1,
          accept: "image/*",
          slotIndex: 0,
          supportsGalleryDrop: true,
        },
        {
          id: "slot-end-frame",
          kind: "image",
          role: "end_frame",
          label: "End frame optional",
          required: false,
          visible: true,
          filled: imageCount >= 2,
          accept: "image/*",
          slotIndex: 1,
          supportsGalleryDrop: true,
        },
      ]
    : [
        {
          id: "slot-source-image",
          kind: "image",
          role: "source_image",
          label: "Source image",
          required: true,
          visible: true,
          filled: imageCount >= 1,
          accept: "image/*",
          slotIndex: 0,
          supportsGalleryDrop: true,
        },
      ];

  const filledCount = slots.filter((slot) => slot.filled).length;
  return {
    slots,
    summaryLabel: slots.length > 1 ? `${filledCount} / ${slots.length} frames` : `${filledCount} / ${slots.length}`,
    usesExplicitSlots: true,
  };
}

export function normalizeStructuredPresetTextFields(preset: MediaPreset | null): StructuredPresetTextField[] {
  return ((preset?.input_schema_json as Array<Record<string, unknown>> | undefined) ?? [])
    .map((field) => ({
      key: String(field.key ?? "").trim(),
      label: String(field.label ?? "").trim() || String(field.key ?? "").trim(),
      placeholder: String(field.placeholder ?? "").trim(),
      defaultValue: String(field.default_value ?? "").trim(),
      required: Boolean(field.required ?? true),
    }))
    .filter((field) => field.key);
}

export function normalizeStructuredPresetImageSlots(preset: MediaPreset | null): StructuredPresetImageSlot[] {
  return ((preset?.input_slots_json as Array<Record<string, unknown>> | undefined) ?? [])
    .map((slot) => ({
      key: String(slot.key ?? slot.slot ?? "").trim(),
      label: String(slot.label ?? "").trim() || String(slot.key ?? slot.slot ?? "").trim(),
      helpText: String(slot.help_text ?? "").trim(),
      required: Boolean(slot.required ?? true),
      maxFiles: Math.max(1, Number(slot.max_files ?? 1) || 1),
    }))
    .filter((slot) => slot.key);
}

export function renderStructuredPresetPrompt(
  template: string,
  inputValues: Record<string, string>,
  slotStates: Record<string, PresetSlotState>,
  imageSlots: StructuredPresetImageSlot[],
) {
  let rendered = template;
  for (const [key, value] of Object.entries(inputValues)) {
    rendered = rendered.replaceAll(`{{${key}}}`, value.trim());
  }
  let imageIndex = 0;
  for (const slot of imageSlots) {
    const slotState = slotStates[slot.key];
    if (isPresetSlotFilled(slotState)) {
      imageIndex += 1;
      rendered = rendered.replaceAll(`[[${slot.key}]]`, `[image reference ${imageIndex}]`);
      continue;
    }
    rendered = rendered.replaceAll(`[[${slot.key}]]`, `[[${slot.key}]]`);
  }
  return rendered.trim();
}

export function isPresetSlotFilled(slotState: PresetSlotState | null | undefined) {
  return Boolean(slotState?.assetId || slotState?.referenceId || slotState?.file);
}

export function inferInputPattern(
  model: MediaModelSummary | null,
  attachments: MediaAttachmentKind[],
  sourceAsset: MediaAsset | null,
) {
  const imageCount =
    attachments.filter((attachment) => attachment.kind === "images").length +
    (sourceAsset?.generation_kind === "image" ? 1 : 0);
  const videoCount =
    attachments.filter((attachment) => attachment.kind === "videos").length +
    (sourceAsset?.generation_kind === "video" ? 1 : 0);
  const referenceImageCount = attachments.filter(
    (attachment) => attachment.kind === "images" && attachment.role === "reference",
  ).length;
  const referenceVideoCount = attachments.filter(
    (attachment) => attachment.kind === "videos" && attachment.role === "reference",
  ).length;
  const referenceAudioCount = attachments.filter(
    (attachment) => attachment.kind === "audios" && attachment.role === "reference",
  ).length;
  const firstFrameCount = attachments.filter(
    (attachment) => attachment.kind === "images" && attachment.role === "first_frame",
  ).length;
  const lastFrameCount = attachments.filter(
    (attachment) => attachment.kind === "images" && attachment.role === "last_frame",
  ).length;
  const patterns = new Set(supportedModelInputPatterns(model));

  if (
    patterns.has("multimodal_reference") &&
    (referenceImageCount > 0 || referenceVideoCount > 0 || referenceAudioCount > 0)
  ) {
    return "multimodal_reference";
  }
  if (patterns.has("first_last_frames") && firstFrameCount > 0 && lastFrameCount > 0) {
    return "first_last_frames";
  }
  if (patterns.has("single_image") && firstFrameCount > 0 && lastFrameCount === 0) {
    return "single_image";
  }

  if (patterns.has("motion_control") && imageCount >= 1 && videoCount >= 1) {
    return "motion_control";
  }
  if (patterns.has("first_last_frames") && imageCount >= 2) {
    return "first_last_frames";
  }
  if (patterns.has("image_edit") && imageCount >= 1) {
    return "image_edit";
  }
  if (patterns.has("single_image") && imageCount >= 1) {
    return "single_image";
  }
  return "prompt_only";
}

export type SeedanceComposerMode = "text_only" | "first_frame" | "first_last_frames" | "multimodal_reference";

export function deriveSeedanceComposerMode(
  attachments: MediaAttachmentKind[],
  sourceAsset: MediaAsset | null,
): SeedanceComposerMode {
  const firstFrameCount =
    attachments.filter((attachment) => attachment.kind === "images" && attachment.role === "first_frame").length +
    (sourceAsset?.generation_kind === "image" ? 1 : 0);
  const lastFrameCount = attachments.filter(
    (attachment) => attachment.kind === "images" && attachment.role === "last_frame",
  ).length;
  const referenceCount = attachments.filter((attachment) => attachment.role === "reference").length;
  if (referenceCount > 0) {
    return "multimodal_reference";
  }
  if (firstFrameCount > 0 && lastFrameCount > 0) {
    return "first_last_frames";
  }
  if (firstFrameCount > 0) {
    return "first_frame";
  }
  return "text_only";
}

export function seedanceReferenceTokenGuide(attachments: MediaAttachmentKind[]) {
  const lines: string[] = [];
  let imageIndex = 0;
  let videoIndex = 0;
  let audioIndex = 0;
  for (const attachment of attachments) {
    if (attachment.role !== "reference") continue;
    if (attachment.kind === "images") {
      imageIndex += 1;
      lines.push(`@image${imageIndex}`);
      continue;
    }
    if (attachment.kind === "videos") {
      videoIndex += 1;
      lines.push(`@video${videoIndex}`);
      continue;
    }
    if (attachment.kind === "audios") {
      audioIndex += 1;
      lines.push(`@audio${audioIndex}`);
    }
  }
  return lines;
}

export function formatOptionValue(value: unknown) {
  if (typeof value === "boolean") {
    return value ? "On" : "Off";
  }
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  if (value == null || value === "") {
    return "Not set";
  }
  return String(value);
}

const READY_MEDIA_VALIDATION_STATES = new Set(["ready", "ready_with_defaults", "ready_with_warning"]);

export function studioValidationReady(validation: MediaValidationResponse | null) {
  if (!validation?.state) {
    return false;
  }
  return READY_MEDIA_VALIDATION_STATES.has(validation.state.toLowerCase());
}

export function prettifyModelLabel(modelKey: string | null | undefined) {
  if (!modelKey) {
    return "Media";
  }
  return modelKey.replaceAll("-", " ");
}

export function presetThumbnailVisual(preset: MediaPreset | null | undefined) {
  return toControlApiProxyPath(preset?.thumbnail_url) ?? preset?.thumbnail_url ?? null;
}

export function orderedImageInputVisual(input?: OrderedImageInput | null) {
  if (!input) {
    return null;
  }
  if (input.source === "asset") {
    return mediaThumbnailUrl(input.asset) ?? mediaDisplayUrl(input.asset);
  }
  if (input.source === "reference") {
    return input.previewUrl ?? null;
  }
  return input.attachment.previewUrl ?? null;
}

export function referenceKindToAttachmentKind(kind: string | null | undefined) {
  if (kind === "video") return "videos" as const;
  if (kind === "audio") return "audios" as const;
  return "images" as const;
}

export function resolveEnhancementPreviewVisual({
  structuredPresetActive,
  firstPresetSlotPreview,
  orderedImageInputs,
  currentSourceAsset,
  imageAttachmentPreviewUrls,
}: {
  structuredPresetActive: boolean;
  firstPresetSlotPreview: string | null;
  orderedImageInputs: OrderedImageInput[];
  currentSourceAsset: MediaAsset | null;
  imageAttachmentPreviewUrls: Array<string | null>;
}) {
  if (structuredPresetActive) {
    return firstPresetSlotPreview ?? null;
  }
  const orderedVisual = orderedImageInputs.map((input) => orderedImageInputVisual(input)).find(Boolean);
  if (orderedVisual) {
    return orderedVisual;
  }
  if (currentSourceAsset) {
    return mediaThumbnailUrl(currentSourceAsset) ?? mediaDisplayUrl(currentSourceAsset);
  }
  return imageAttachmentPreviewUrls.find(Boolean) ?? null;
}

export function structuredPresetSlotPreviewUrl(
  slotItem: unknown,
  localAssets: MediaAsset[],
  favoriteAssets: MediaAsset[] | null,
) {
  if (!isRecord(slotItem)) {
    return null;
  }
  const assetId =
    typeof slotItem.asset_id === "string" || typeof slotItem.asset_id === "number" ? slotItem.asset_id : null;
  if (assetId != null) {
    const asset = findMediaAssetById(assetId, localAssets, favoriteAssets) ?? null;
    return {
      url: mediaDisplayUrl(asset) ?? mediaThumbnailUrl(asset),
      label: asset?.prompt_summary ?? `Image asset ${assetId}`,
    };
  }
  const pathValue = typeof slotItem.path === "string" ? slotItem.path : null;
  const urlValue = typeof slotItem.url === "string" ? slotItem.url : null;
  const url = urlValue ?? toControlApiDataPreviewPath(pathValue);
  if (!url) {
    return null;
  }
  return {
    url,
    label: pathValue?.split("/").at(-1) ?? "Preset image",
  };
}

type NormalizedRequestMediaKey = "images" | "videos" | "audios";

function normalizedRequestMedia(job: MediaJob | null | undefined, key: NormalizedRequestMediaKey) {
  const preparedRequest = isRecord(job?.prepared) && isRecord(job?.prepared["normalized_request"])
    ? (job?.prepared["normalized_request"] as Record<string, unknown>)
    : null;
  const preparedItems = preparedRequest && Array.isArray(preparedRequest[key])
    ? (preparedRequest[key] as unknown[])
    : [];
  if (preparedItems.length) {
    return preparedItems;
  }
  const normalizedRequest = isRecord(job?.normalized_request) ? job.normalized_request : null;
  return normalizedRequest && Array.isArray(normalizedRequest[key]) ? (normalizedRequest[key] as unknown[]) : [];
}

function normalizedRequestImages(job?: MediaJob | null) {
  return normalizedRequestMedia(job, "images");
}

function normalizedRequestOriginalMedia(job: MediaJob | null | undefined, key: NormalizedRequestMediaKey) {
  const preparedRequest =
    isRecord(job?.prepared) && isRecord(job?.prepared["normalized_request"])
      ? (job?.prepared["normalized_request"] as Record<string, unknown>)
      : null;
  const preparedDebug = preparedRequest && isRecord(preparedRequest.debug) ? (preparedRequest.debug as Record<string, unknown>) : null;
  const preparedOriginalMedia =
    preparedDebug && isRecord(preparedDebug.original_media) ? (preparedDebug.original_media as Record<string, unknown>) : null;
  const preparedItems = preparedOriginalMedia && Array.isArray(preparedOriginalMedia[key])
    ? (preparedOriginalMedia[key] as unknown[])
    : [];
  if (preparedItems.length) {
    return preparedItems;
  }

  const normalizedRequest = isRecord(job?.normalized_request) ? (job.normalized_request as Record<string, unknown>) : null;
  const normalizedDebug = normalizedRequest && isRecord(normalizedRequest.debug) ? (normalizedRequest.debug as Record<string, unknown>) : null;
  const normalizedOriginalMedia =
    normalizedDebug && isRecord(normalizedDebug.original_media) ? (normalizedDebug.original_media as Record<string, unknown>) : null;
  const normalizedItems = normalizedOriginalMedia && Array.isArray(normalizedOriginalMedia[key])
    ? (normalizedOriginalMedia[key] as unknown[])
    : [];
  if (normalizedItems.length) {
    return normalizedItems;
  }

  const preparedTopLevelDebug =
    isRecord(job?.prepared) && isRecord(job?.prepared["debug"])
      ? (job?.prepared["debug"] as Record<string, unknown>)
      : null;
  const preparedTopLevelOriginalMedia =
    preparedTopLevelDebug && isRecord(preparedTopLevelDebug.original_media)
      ? (preparedTopLevelDebug.original_media as Record<string, unknown>)
      : null;
  return preparedTopLevelOriginalMedia && Array.isArray(preparedTopLevelOriginalMedia[key])
    ? (preparedTopLevelOriginalMedia[key] as unknown[])
    : [];
}

function normalizedRequestMediaEntries(job?: MediaJob | null) {
  const collections: NormalizedRequestMediaKey[] = ["images", "videos", "audios"];
  return collections.flatMap((collectionKey) =>
    normalizedRequestMedia(job, collectionKey).map((item, index) => ({ item, index, collectionKey })),
  );
}

function normalizedOriginalMediaEntry(
  job: MediaJob | null | undefined,
  collectionKey: NormalizedRequestMediaKey,
  index: number,
) {
  const originalItems = normalizedRequestOriginalMedia(job, collectionKey);
  const item = originalItems[index];
  return isRecord(item) ? item : null;
}

function normalizedMediaUrl(
  item: Record<string, unknown>,
  originalItem: Record<string, unknown> | null,
  asset: MediaAsset | null,
  kind: "images" | "videos" | "audios",
) {
  const urlValue = typeof item.url === "string" ? item.url : null;
  const pathValue = typeof item.path === "string" ? item.path : null;
  const originalPathValue = typeof originalItem?.path === "string" ? originalItem.path : null;
  const originalUrlValue = typeof originalItem?.url === "string" ? originalItem.url : null;

  return (
    (kind === "videos" ? mediaPlaybackUrl(asset) : null) ??
    mediaDisplayUrl(asset) ??
    mediaThumbnailUrl(asset) ??
    toControlApiDataPreviewPath(originalPathValue) ??
    originalUrlValue ??
    toControlApiDataPreviewPath(pathValue) ??
    urlValue
  );
}

function normalizedReferenceLabel(role: string | null, fallbackIndex: number, referenceIndex: number) {
  if (role === "first_frame") {
    return "First frame";
  }
  if (role === "last_frame") {
    return "Last frame";
  }
  if (role === "reference") {
    return `Reference ${referenceIndex}`;
  }
  return `Image ${fallbackIndex}`;
}

function studioReferenceKind(mediaType: unknown): "images" | "videos" | "audios" {
  if (typeof mediaType === "string") {
    const normalized = mediaType.toLowerCase();
    if (normalized === "video") {
      return "videos";
    }
    if (normalized === "audio") {
      return "audios";
    }
  }
  return "images";
}

export function buildStudioReferencePreviews({
  asset,
  job,
  presetSlots,
  presetSlotValues,
  localAssets,
  favoriteAssets,
}: {
  asset?: MediaAsset | null;
  job?: MediaJob | null;
  presetSlots?: StructuredPresetImageSlot[];
  presetSlotValues?: Record<string, unknown>;
  localAssets: MediaAsset[];
  favoriteAssets: MediaAsset[] | null;
}) {
  const previews: StudioReferencePreview[] = [];
  const seen = new Set<string>();
  const sourceAssetId = asset?.source_asset_id ?? job?.source_asset_id ?? null;
  const sourceAsset =
    sourceAssetId != null ? findMediaAssetById(sourceAssetId, localAssets, favoriteAssets) ?? null : null;
  const presetSlotPreviews: StudioReferencePreview[] = [];
  const hideImplicitPrimaryFromPresetSlots = (presetSlots?.length ?? 0) > 0;

  function pushPreview(
    key: string,
    label: string,
    kind: "images" | "videos" | "audios",
    url: string | null | undefined,
    posterUrl?: string | null,
  ) {
    if (!url) {
      return;
    }
    const normalizedUrl = String(url).trim();
    if (!normalizedUrl || seen.has(normalizedUrl)) {
      return;
    }
    seen.add(normalizedUrl);
    previews.push({ key, label, url: normalizedUrl, kind, posterUrl: posterUrl ?? null });
  }

  for (const slot of presetSlots ?? []) {
    const rawItems = Array.isArray(presetSlotValues?.[slot.key]) ? (presetSlotValues?.[slot.key] as unknown[]) : [];
    rawItems.forEach((item, index) => {
      const preview = structuredPresetSlotPreviewUrl(item, localAssets, favoriteAssets);
      const label = rawItems.length > 1 ? `${slot.label} ${index + 1}` : slot.label;
      if (!preview?.url) {
        return;
      }
      presetSlotPreviews.push({
        key: `slot:${slot.key}:${index}`,
        label,
        kind: "images",
        url: preview.url,
        posterUrl: null,
      });
    });
  }

  if (sourceAsset && presetSlotPreviews.length === 0) {
    const sourceKind = sourceAsset.generation_kind === "video" ? "videos" : "images";
    pushPreview(
      `source:${sourceAsset.asset_id}`,
      sourceKind === "videos" ? "Source video" : "Source image",
      sourceKind,
      (sourceKind === "videos" ? mediaPlaybackUrl(sourceAsset) : null) ??
        mediaDisplayUrl(sourceAsset) ??
        mediaThumbnailUrl(sourceAsset),
      sourceKind === "videos" ? mediaThumbnailUrl(sourceAsset) ?? mediaDisplayUrl(sourceAsset) ?? null : null,
    );
  }

  presetSlotPreviews.forEach((preview) => {
    pushPreview(preview.key, preview.label, preview.kind, preview.url, preview.posterUrl);
  });

  let referenceIndex = 0;
  let consumedImplicitPrimary = false;
  normalizedRequestMediaEntries(job).forEach(({ item, index, collectionKey }) => {
    if (!isRecord(item)) {
      return;
    }
    const assetId =
      typeof item.asset_id === "string" || typeof item.asset_id === "number" ? item.asset_id : null;
    if (assetId != null && sourceAssetId != null && String(assetId) === String(sourceAssetId)) {
      return;
    }
    const imageAsset = assetId != null ? findMediaAssetById(assetId, localAssets, favoriteAssets) ?? null : null;
    const role = typeof item.role === "string" ? item.role : null;
    const kind = studioReferenceKind(item.media_type ?? collectionKey.slice(0, -1));
    const originalItem = normalizedOriginalMediaEntry(job, collectionKey, index);
    if (hideImplicitPrimaryFromPresetSlots && role == null) {
      return;
    }
    if (role == null && sourceAssetId == null && !consumedImplicitPrimary) {
      pushPreview(
        `job-${collectionKey.slice(0, -1)}:${index}`,
        kind === "videos" ? "Source video" : kind === "audios" ? "Source audio" : "Source image",
        kind,
        normalizedMediaUrl(item, originalItem, imageAsset, kind),
        kind === "videos"
          ? mediaThumbnailUrl(imageAsset) ?? mediaDisplayUrl(imageAsset) ?? null
          : null,
      );
      consumedImplicitPrimary = true;
      return;
    }
    if (sourceAssetId != null && role == null) {
      return;
    }
    if (role === "reference") {
      referenceIndex += 1;
    }
    pushPreview(
      `job-${collectionKey.slice(0, -1)}:${index}`,
      normalizedReferenceLabel(role, index + 1, Math.max(referenceIndex, 1)),
      kind,
      normalizedMediaUrl(item, originalItem, imageAsset, kind),
      kind === "videos"
        ? mediaThumbnailUrl(imageAsset) ?? mediaDisplayUrl(imageAsset) ?? null
        : null,
    );
  });

  return previews;
}

export function buildStudioJobReferenceInputs({
  job,
  localAssets,
  favoriteAssets,
}: {
  job?: MediaJob | null;
  localAssets: MediaAsset[];
  favoriteAssets: MediaAsset[] | null;
}) {
  const references: StudioJobReferenceInput[] = [];
  const seen = new Set<string>();
  const sourceAssetId = job?.source_asset_id ?? null;
  let referenceIndex = 0;
  let consumedImplicitPrimary = false;

  normalizedRequestMediaEntries(job).forEach(({ item, index, collectionKey }) => {
    if (!isRecord(item)) {
      return;
    }
    const assetId =
      typeof item.asset_id === "string" || typeof item.asset_id === "number" ? item.asset_id : null;
    if (assetId != null && sourceAssetId != null && String(assetId) === String(sourceAssetId)) {
      return;
    }
    const kind = studioReferenceKind(item.media_type ?? collectionKey.slice(0, -1));
    const role =
      item.role === "first_frame" || item.role === "last_frame" || item.role === "reference"
        ? item.role
        : null;
    if (role == null && sourceAssetId == null && !consumedImplicitPrimary) {
      consumedImplicitPrimary = true;
      return;
    }
    if (sourceAssetId != null && role == null) {
      return;
    }
    if (role === "reference") {
      referenceIndex += 1;
    }
    const asset = assetId != null ? findMediaAssetById(assetId, localAssets, favoriteAssets) ?? null : null;
    const pathValue = typeof item.path === "string" ? item.path : null;
    const originalItem = normalizedOriginalMediaEntry(job, collectionKey, index);
    const url = normalizedMediaUrl(item, originalItem, asset, kind);
    if (!url) {
      return;
    }
    const dedupeKey = [assetId ?? "", pathValue ?? "", url].join("|");
    if (seen.has(dedupeKey)) {
      return;
    }
    seen.add(dedupeKey);
    references.push({
      key: `job-reference:${collectionKey}:${index}`,
      label: normalizedReferenceLabel(role, index + 1, Math.max(referenceIndex, 1)),
      url,
      posterUrl: kind === "videos" ? mediaThumbnailUrl(asset) ?? mediaDisplayUrl(asset) ?? null : null,
      assetId,
      kind,
      role,
    });
  });

  return references;
}

export function buildStudioJobPrimaryInput({
  job,
  localAssets,
  favoriteAssets,
}: {
  job?: MediaJob | null;
  localAssets: MediaAsset[];
  favoriteAssets: MediaAsset[] | null;
}) {
  const sourceAssetId = job?.source_asset_id ?? null;
  if (sourceAssetId != null) {
    const sourceAsset = findMediaAssetById(sourceAssetId, localAssets, favoriteAssets) ?? null;
    const sourceUrl =
      mediaPlaybackUrl(sourceAsset) ?? mediaDisplayUrl(sourceAsset) ?? mediaThumbnailUrl(sourceAsset);
    if (sourceUrl) {
      return {
        assetId: sourceAssetId,
        url: sourceUrl,
        kind: sourceAsset?.generation_kind === "video" ? "videos" : "images",
        role: null,
      } satisfies StudioJobPrimaryInput;
    }
  }

  const requestImages = normalizedRequestImages(job);
  const fallbackOriginalMedia = normalizedRequestOriginalMedia(job, "images");
  for (const [index, image] of requestImages.entries()) {
    if (!isRecord(image)) {
      continue;
    }
    const mediaType = typeof image.media_type === "string" ? image.media_type.toLowerCase() : "image";
    const kind =
      mediaType === "video" ? "videos" : mediaType === "audio" ? "audios" : ("images" as const);
    const role =
      image.role === "first_frame" || image.role === "last_frame" || image.role === "reference"
        ? image.role
        : null;
    if (role != null && role !== "first_frame") {
      continue;
    }
    const assetId =
      typeof image.asset_id === "string" || typeof image.asset_id === "number" ? image.asset_id : null;
    const asset = assetId != null ? findMediaAssetById(assetId, localAssets, favoriteAssets) ?? null : null;
    const urlValue = typeof image.url === "string" ? image.url : null;
    const pathValue = typeof image.path === "string" ? image.path : null;
    const originalMediaEntry = fallbackOriginalMedia[index];
    const originalPathValue =
      isRecord(originalMediaEntry) && typeof originalMediaEntry.path === "string" ? originalMediaEntry.path : null;
    const url =
      (kind === "videos" ? mediaPlaybackUrl(asset) : null) ??
      mediaDisplayUrl(asset) ??
      mediaThumbnailUrl(asset) ??
      toControlApiDataPreviewPath(originalPathValue) ??
      urlValue ??
      toControlApiDataPreviewPath(pathValue);
    if (!url) {
      continue;
    }
    return {
      assetId,
      url,
      kind,
      role,
    } satisfies StudioJobPrimaryInput;
  }

  return null;
}

export function resolveStudioRetryPreset(job: MediaJob | null | undefined, presets: MediaPreset[]) {
  if (!job) {
    return null;
  }
  return (
    presets.find(
      (preset) =>
        preset.key === job.resolved_preset_key ||
        preset.key === job.requested_preset_key ||
        preset.preset_id === job.resolved_preset_key ||
        preset.preset_id === job.requested_preset_key,
    ) ?? null
  );
}

export function buildStudioRetryRestorePlan({
  job,
  batch,
  models,
  presets,
  localAssets,
  favoriteAssets,
}: {
  job?: MediaJob | null;
  batch?: MediaBatch | null;
  models: MediaModelSummary[];
  presets: MediaPreset[];
  localAssets: MediaAsset[];
  favoriteAssets: MediaAsset[] | null;
}) {
  if (!job) {
    return null;
  }

  const targetModel = models.find((model) => model.key === job.model_key) ?? null;
  const targetPreset = resolveStudioRetryPreset(job, presets);
  const presetInputValues = {
    ...structuredPresetInputValuesFromBatch(batch),
    ...structuredPresetInputValues(job),
  };
  const optionValues = buildNormalizedStudioOptions(
    targetModel,
    (job.resolved_options as Record<string, unknown> | undefined) ?? {},
    null,
  );
  const primaryInput = buildStudioJobPrimaryInput({ job, localAssets, favoriteAssets });
  const referenceInputs = buildStudioJobReferenceInputs({ job, localAssets, favoriteAssets });

  const presetSlotRestores: StudioRetryPresetSlotRestore[] = [];
  if (targetPreset) {
    const slotValues = {
      ...structuredPresetSlotValuesFromBatch(batch),
      ...structuredPresetSlotValues(job),
    };
    for (const slot of normalizeStructuredPresetImageSlots(targetPreset)) {
      const rawItems = Array.isArray(slotValues[slot.key]) ? (slotValues[slot.key] as unknown[]) : [];
      const firstItem = rawItems[0];
      if (!isRecord(firstItem)) {
        continue;
      }
      const assetId =
        typeof firstItem.asset_id === "string" || typeof firstItem.asset_id === "number" ? firstItem.asset_id : null;
      const preview = structuredPresetSlotPreviewUrl(firstItem, localAssets, favoriteAssets);
      const url = preview?.url ?? null;
      if (assetId == null && !url) {
        continue;
      }
      presetSlotRestores.push({
        slotKey: slot.key,
        label: slot.label,
        assetId,
        url,
      });
    }
  }

  return {
    targetModel,
    targetPreset,
    projectId: job.project_id ? String(job.project_id) : batch?.project_id ? String(batch.project_id) : null,
    selectedPromptIds: job.selected_system_prompt_ids ?? [],
    prompt: job.final_prompt_used ?? job.enhanced_prompt ?? job.raw_prompt ?? "",
    presetInputValues,
    optionValues,
    outputCount: Math.max(1, job.requested_outputs ?? 1),
    primaryInput,
    referenceInputs,
    presetSlotRestores,
  } satisfies StudioRetryRestorePlan;
}

export function jobPreviewUrl(job?: MediaJob | null) {
  if (!job) {
    return null;
  }
  const preparedRequest = isRecord(job.prepared) && isRecord(job.prepared["normalized_request"])
    ? (job.prepared["normalized_request"] as Record<string, unknown>)
    : null;
  const normalizedRequest = isRecord(job.normalized_request) ? job.normalized_request : null;
  const preparedImages = preparedRequest && Array.isArray(preparedRequest["images"])
    ? (preparedRequest["images"] as Array<Record<string, unknown>>)
    : [];
  const normalizedImages = normalizedRequest && Array.isArray(normalizedRequest["images"])
    ? (normalizedRequest["images"] as Array<Record<string, unknown>>)
    : [];
  const image = preparedImages[0] ?? normalizedImages[0];
  if (!isRecord(image)) {
    return null;
  }
  const uploadedUrl = typeof image.url === "string" ? image.url : null;
  const localPath = typeof image.path === "string" ? image.path : null;
  return uploadedUrl ?? toControlApiDataPreviewPath(localPath);
}

export function classifyFile(file: File) {
  const lowerName = file.name.toLowerCase();
  if (file.type.startsWith("video/")) return "videos" as const;
  if (file.type.startsWith("audio/")) return "audios" as const;
  if (/\.(mp4|mov|webm|m4v|avi|mkv)$/i.test(lowerName)) return "videos" as const;
  if (/\.(mp3|wav|aac|m4a|ogg|flac)$/i.test(lowerName)) return "audios" as const;
  return "images" as const;
}

export function modelInputLimit(
  model: MediaModelSummary | null,
  inputKey: "image_inputs" | "video_inputs" | "audio_inputs",
) {
  const raw = isRecord(model?.[inputKey]) ? model?.[inputKey].required_max : null;
  const parsed = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Math.trunc(parsed));
}

export function modelSupportsImageToVideoAnimation(model: MediaModelSummary | null) {
  if (!model || model.studio_exposed === false || model.generation_kind !== "video") {
    return false;
  }
  return model.task_modes?.includes("image_to_video") || modelInputLimit(model, "image_inputs") > 0;
}

export function resolveImageToVideoAnimationModel(
  models: MediaModelSummary[],
  currentModel: MediaModelSummary | null,
) {
  if (modelSupportsImageToVideoAnimation(currentModel)) {
    return currentModel;
  }
  const supportedModels = models.filter(modelSupportsImageToVideoAnimation);
  return (
    supportedModels.find((model) => model.key === "kling-2.6-i2v") ??
    supportedModels.find((model) => model.key === "kling-3.0-i2v") ??
    supportedModels[0] ??
    null
  );
}

export function isCoarsePointerDevice() {
  if (typeof window === "undefined") {
    return false;
  }
  return window.matchMedia?.("(pointer: coarse)").matches ?? false;
}

export function isMobileDownloadDevice() {
  if (typeof navigator === "undefined") {
    return false;
  }
  return isCoarsePointerDevice() || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
}

export function isLikelyMobileSaveDevice() {
  if (typeof navigator === "undefined") {
    return false;
  }
  const userAgent = navigator.userAgent || "";
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent) || (userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1);
}

export function mobileSaveActionLabel() {
  return isLikelyMobileSaveDevice() ? "Save" : "Download";
}

export function isImageMimeType(value: string | null | undefined) {
  return (value ?? "").toLowerCase().startsWith("image/");
}

export function replaceFileExtension(fileName: string, nextExtension: string) {
  const normalized = fileName.trim() || `output.${nextExtension}`;
  const index = normalized.lastIndexOf(".");
  if (index <= 0) {
    return `${normalized}.${nextExtension}`;
  }
  return `${normalized.slice(0, index)}.${nextExtension}`;
}

async function blobToImageElement(blob: Blob) {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Failed to decode image"));
      element.src = objectUrl;
    });
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function convertImageBlobToJpeg(blob: Blob) {
  if (typeof document === "undefined") {
    return blob;
  }

  const image = await blobToImageElement(blob);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const context = canvas.getContext("2d");

  if (!context) {
    return blob;
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0);

  const converted = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((value) => resolve(value), "image/jpeg", 0.92);
  });

  return converted ?? blob;
}

export async function getMobileShareBlob(blob: Blob) {
  if (!isImageMimeType(blob.type)) {
    return blob;
  }
  if (blob.type === "image/png" || blob.type === "image/jpeg") {
    return blob;
  }
  return convertImageBlobToJpeg(blob);
}

export function inferBlobMimeType(asset: MediaAsset | null | undefined, blob: Blob) {
  if (blob.type) {
    return blob.type;
  }
  const filename = mediaDownloadName(asset).toLowerCase();
  if (filename.endsWith(".png")) return "image/png";
  if (filename.endsWith(".jpg") || filename.endsWith(".jpeg")) return "image/jpeg";
  if (filename.endsWith(".webp")) return "image/webp";
  if (filename.endsWith(".mp4")) return "video/mp4";
  if (filename.endsWith(".mov")) return "video/quicktime";
  return "application/octet-stream";
}
