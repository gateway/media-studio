import {
  Clapperboard,
  Clock3,
  Globe2,
  Monitor,
  RectangleHorizontal,
  RectangleVertical,
  SlidersHorizontal,
  Sparkles,
  Square,
  Volume2,
} from "lucide-react";

import type { AttachmentRecord } from "@/lib/media-studio-contract";
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

import { toControlApiDataPreviewPath, toControlApiProxyPath } from "./media-paths";

export { isRecord } from "@/lib/utils";

export type StudioChoice = {
  value: string;
  label: string;
};

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

export type MultiShotParseResult = {
  shots: Array<{ prompt: string; duration: number }>;
  errors: string[];
  totalDuration: number;
};

export type MediaAttachmentKind = {
  kind: "images" | "videos" | "audios";
  role?: "first_frame" | "last_frame" | "reference" | null;
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

export const HIDDEN_STUDIO_OPTION_KEYS = new Set<string>();
export const MULTI_SHOT_MODEL_KEYS = new Set(["kling-3.0-t2v", "kling-3.0-i2v"]);
export const SEEDANCE_MODEL_KEYS = new Set(["seedance-2.0"]);

const STUDIO_PICKER_WIDTHS: Record<string, string> = {
  model: "w-full sm:w-[224px]",
  preset: "w-full sm:w-[162px]",
  "output-count": "w-[calc(50%-0.25rem)] sm:w-[78px]",
  duration: "w-[calc(50%-0.25rem)] sm:w-[92px]",
  aspect_ratio: "w-[calc(50%-0.25rem)] sm:w-[84px]",
  sound: "w-[calc(50%-0.25rem)] sm:w-[96px]",
  audio: "w-[calc(50%-0.25rem)] sm:w-[96px]",
  resolution: "w-[calc(50%-0.25rem)] sm:w-[86px]",
  output_format: "w-[calc(50%-0.25rem)] sm:w-[94px]",
  mode: "w-[calc(50%-0.25rem)] sm:w-[102px]",
  google_search: "w-[calc(50%-0.25rem)] sm:w-[112px]",
};

const NANO_PRESET_MODEL_KEYS = ["nano-banana-2", "nano-banana-pro"] as const;

export function isNanoPresetModel(modelKey: string | null | undefined) {
  return modelKey === "nano-banana-2" || modelKey === "nano-banana-pro";
}

export function studioPresetSupportedModels(preset: MediaPreset | null | undefined) {
  const scopedModels = preset?.applies_to_models?.length
    ? preset.applies_to_models
    : preset?.model_key
      ? [preset.model_key]
      : [];
  return Array.from(new Set(scopedModels.filter((modelKey): modelKey is string => isNanoPresetModel(modelKey))));
}

export function isStudioPresetVisible(preset: MediaPreset | null | undefined) {
  if (!preset) {
    return false;
  }
  return String(preset.status ?? "").toLowerCase() === "active" && studioPresetSupportedModels(preset).length > 0;
}

export function resolveStudioPresetTargetModel(
  preset: MediaPreset | null | undefined,
  preferredModelKey: string | null | undefined,
  fallbackModelKey?: string | null | undefined,
) {
  const supportedModels = studioPresetSupportedModels(preset);
  if (!supportedModels.length) {
    return null;
  }
  if (preferredModelKey && supportedModels.includes(preferredModelKey as (typeof NANO_PRESET_MODEL_KEYS)[number])) {
    return preferredModelKey;
  }
  if (fallbackModelKey && supportedModels.includes(fallbackModelKey as (typeof NANO_PRESET_MODEL_KEYS)[number])) {
    return fallbackModelKey;
  }
  return supportedModels[0] ?? null;
}

export function isSeedanceModel(modelKey: string | null | undefined) {
  return Boolean(modelKey && SEEDANCE_MODEL_KEYS.has(modelKey));
}

function specInputPatterns(model: MediaModelSummary | null) {
  const rawPrompt = (model?.prompt as Record<string, unknown> | undefined) ?? undefined;
  const byPattern =
    (rawPrompt?.default_profile_keys_by_input_pattern as Record<string, unknown> | undefined) ?? undefined;
  if (byPattern && typeof byPattern === "object") {
    return Object.keys(byPattern).filter(Boolean);
  }
  return [];
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
    if (slotState?.assetId || slotState?.referenceId || slotState?.file) {
      imageIndex += 1;
      rendered = rendered.replaceAll(`[[${slot.key}]]`, `[image reference ${imageIndex}]`);
      continue;
    }
    rendered = rendered.replaceAll(`[[${slot.key}]]`, `[[${slot.key}]]`);
  }
  return rendered.trim();
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
  const patterns = new Set([...(model?.input_patterns ?? []), ...specInputPatterns(model)]);

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

export function jobStatusLabel(status: string | null | undefined) {
  if (status === "queued") return "Queued";
  if (status === "submitted" || status === "running" || status === "processing") return "Processing";
  if (status === "completed") return "Complete";
  return "Failed";
}

export function jobPhaseMessage(job: MediaJob | null | undefined) {
  if (!job) {
    return null;
  }
  const finalState = String((job.final_status as Record<string, unknown> | null | undefined)?.state ?? "").toLowerCase();
  if ((job.status === "running" || job.status === "processing") && finalState === "succeeded") {
    return "Final output received. Publishing it into Studio.";
  }
  if (job.status === "submitted" || job.status === "running" || job.status === "processing") {
    return "Waiting for the provider to finish the generation.";
  }
  if (job.status === "queued") {
    return "The job is queued and waiting for an open runner slot.";
  }
  return null;
}

export function batchPhaseMessage(batch: MediaBatch | null | undefined) {
  if (!batch) {
    return null;
  }
  const publishingJob = (batch.jobs ?? []).find((job) => {
    const finalState = String((job.final_status as Record<string, unknown> | null | undefined)?.state ?? "").toLowerCase();
    return (job.status === "running" || job.status === "processing") && finalState === "succeeded";
  });
  if (publishingJob) {
    return "Final output received. Publishing it into Studio.";
  }
  if (batch.running_count > 0) {
    return "Studio is polling the provider for this batch right now.";
  }
  if (batch.queued_count > 0) {
    return "This batch is queued and waiting for runner capacity.";
  }
  return null;
}

export function toneForStatus(status?: string | null) {
  if (status === "completed" || status === "succeeded") return "healthy";
  if (status === "failed") return "danger";
  if (status === "running" || status === "submitted") return "warning";
  return "neutral";
}

export function mediaVariantUrl(
  asset: MediaAsset | null | undefined,
  variant: "original" | "web" | "thumb" | "poster",
) {
  if (!asset) {
    return null;
  }

  if (variant === "original") {
    return toControlApiProxyPath(asset.hero_original_url) ?? toControlApiDataPreviewPath(asset.hero_original_path);
  }
  if (variant === "web") {
    return toControlApiProxyPath(asset.hero_web_url) ?? toControlApiDataPreviewPath(asset.hero_web_path);
  }
  if (variant === "thumb") {
    return toControlApiProxyPath(asset.hero_thumb_url) ?? toControlApiDataPreviewPath(asset.hero_thumb_path);
  }
  return toControlApiProxyPath(asset.hero_poster_url) ?? toControlApiDataPreviewPath(asset.hero_poster_path);
}

export function mediaThumbnailUrl(asset?: MediaAsset | null) {
  if (asset?.generation_kind === "video") {
    return mediaVariantUrl(asset, "poster") ?? mediaVariantUrl(asset, "thumb");
  }
  return mediaVariantUrl(asset, "thumb") ?? mediaVariantUrl(asset, "web") ?? mediaVariantUrl(asset, "poster");
}

export function mediaDisplayUrl(asset?: MediaAsset | null) {
  if (asset?.generation_kind === "video") {
    return mediaThumbnailUrl(asset);
  }
  return mediaVariantUrl(asset, "web") ?? mediaVariantUrl(asset, "thumb") ?? mediaVariantUrl(asset, "poster");
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

export function referencePreviewUrl(reference: MediaReference | null | undefined) {
  if (!reference) {
    return null;
  }
  if (reference.kind === "video") {
    return reference.poster_url ?? reference.thumb_url ?? reference.stored_url ?? toControlApiDataPreviewPath(reference.poster_path ?? reference.thumb_path ?? reference.stored_path);
  }
  if (reference.kind === "audio") {
    return null;
  }
  return reference.thumb_url ?? reference.stored_url ?? toControlApiDataPreviewPath(reference.thumb_path ?? reference.stored_path);
}

export function referencePlaybackUrl(reference: MediaReference | null | undefined) {
  if (!reference) {
    return null;
  }
  return reference.stored_url ?? toControlApiDataPreviewPath(reference.stored_path);
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

export function mediaPlaybackUrl(asset?: MediaAsset | null) {
  if (asset?.generation_kind !== "video") {
    return null;
  }
  return mediaVariantUrl(asset, "web") ?? asset.remote_output_url ?? mediaVariantUrl(asset, "original");
}

export function mediaPreviewUrl(asset?: MediaAsset | null) {
  return mediaDisplayUrl(asset);
}

export function prefetchAssetThumbs(assets: MediaAsset[], seenThumbUrls: Set<string>) {
  if (typeof window === "undefined") {
    return;
  }
  for (const asset of assets) {
    const thumbUrl = mediaThumbnailUrl(asset);
    if (!thumbUrl || seenThumbUrls.has(thumbUrl)) {
      continue;
    }
    seenThumbUrls.add(thumbUrl);
    const image = new Image();
    image.decoding = "async";
    image.loading = "eager";
    image.src = thumbUrl;
  }
}

export function mediaDownloadName(asset?: MediaAsset | null) {
  const payload = isRecord(asset?.payload) ? asset.payload : null;
  const firstOutput = Array.isArray(payload?.outputs) && payload.outputs.length > 0 && isRecord(payload.outputs[0]) ? payload.outputs[0] : null;
  const outputOriginalFilename = typeof firstOutput?.original_filename === "string" ? firstOutput.original_filename : null;
  const extensionSource =
    outputOriginalFilename ??
    asset?.hero_original_path ??
    asset?.hero_web_path ??
    asset?.hero_original_url ??
    asset?.hero_web_url ??
    asset?.hero_poster_url ??
    asset?.hero_thumb_url ??
    null;
  const normalizedExtensionSource = extensionSource?.split("?")[0]?.split("#")[0] ?? extensionSource ?? "";
  const extensionMatch = normalizedExtensionSource.match(/(\.[a-z0-9]+)$/i);
  const extension = extensionMatch?.[1]?.toLowerCase() ?? "";
  const options = isRecord(payload?.options) ? payload.options : null;
  const cleanPart = (value: unknown) =>
    typeof value === "string" && value.trim()
      ? value
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
      : "";
  const preferredParts = [
    asset?.job_id ? `ms-${cleanPart(asset.job_id).replace(/^job-/, "")}` : "",
    cleanPart(asset?.model_key),
    cleanPart(options?.resolution),
    cleanPart(options?.aspect_ratio),
  ].filter(Boolean);

  if (preferredParts.length) {
    return `${preferredParts.join("_")}${extension}`;
  }

  const candidate =
    asset?.hero_original_path ??
    asset?.hero_web_path ??
    asset?.hero_original_url ??
    asset?.hero_web_url ??
    asset?.hero_poster_url ??
    asset?.hero_thumb_url;

  if (!candidate) {
    return asset?.asset_id ? `media-asset-${asset.asset_id}` : "media-asset";
  }

  const normalized = candidate.split("?")[0]?.split("#")[0] ?? candidate;
  const segments = normalized.split("/").filter(Boolean);
  return segments.at(-1) ?? (asset?.asset_id ? `media-asset-${asset.asset_id}` : "media-asset");
}

export function mediaDownloadUrl(asset?: MediaAsset | null) {
  const originalUrl =
    toControlApiProxyPath(asset?.hero_original_url) ??
    toControlApiDataPreviewPath(asset?.hero_original_path) ??
    mediaPreviewUrl(asset);

  if (!originalUrl) {
    return null;
  }

  const downloadUrl = new URL(originalUrl, "http://dashboard.local");
  downloadUrl.searchParams.set("download", "1");
  downloadUrl.searchParams.set("filename", mediaDownloadName(asset));
  return `${downloadUrl.pathname}${downloadUrl.search}`;
}

export function mediaInlineUrl(asset?: MediaAsset | null) {
  const originalUrl =
    toControlApiProxyPath(asset?.hero_original_url) ??
    toControlApiDataPreviewPath(asset?.hero_original_path) ??
    mediaPreviewUrl(asset);

  if (!originalUrl) {
    return null;
  }

  const inlineUrl = new URL(originalUrl, "http://dashboard.local");
  inlineUrl.searchParams.set("inline", "1");
  return `${inlineUrl.pathname}${inlineUrl.search}`;
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

function normalizedRequestImages(job?: MediaJob | null) {
  const preparedRequest = isRecord(job?.prepared) && isRecord(job?.prepared["normalized_request"])
    ? (job?.prepared["normalized_request"] as Record<string, unknown>)
    : null;
  const preparedImages = preparedRequest && Array.isArray(preparedRequest["images"])
    ? (preparedRequest["images"] as unknown[])
    : [];
  if (preparedImages.length) {
    return preparedImages;
  }
  const normalizedRequest = isRecord(job?.normalized_request) ? job.normalized_request : null;
  return normalizedRequest && Array.isArray(normalizedRequest["images"]) ? (normalizedRequest["images"] as unknown[]) : [];
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
      pushPreview(`slot:${slot.key}:${index}`, label, "images", preview?.url);
    });
  }

  let referenceIndex = 0;
  normalizedRequestImages(job).forEach((image, index) => {
    if (!isRecord(image)) {
      return;
    }
    const assetId =
      typeof image.asset_id === "string" || typeof image.asset_id === "number" ? image.asset_id : null;
    if (assetId != null && sourceAssetId != null && String(assetId) === String(sourceAssetId)) {
      return;
    }
    const imageAsset = assetId != null ? findMediaAssetById(assetId, localAssets, favoriteAssets) ?? null : null;
    const urlValue = typeof image.url === "string" ? image.url : null;
    const pathValue = typeof image.path === "string" ? image.path : null;
    const role = typeof image.role === "string" ? image.role : null;
    const kind = studioReferenceKind(image.media_type);
    if (role === "reference") {
      referenceIndex += 1;
    }
    pushPreview(
      `job-image:${index}`,
      normalizedReferenceLabel(role, index + 1, Math.max(referenceIndex, 1)),
      kind,
      (kind === "videos" ? mediaPlaybackUrl(imageAsset) : null) ??
        mediaDisplayUrl(imageAsset) ??
        mediaThumbnailUrl(imageAsset) ??
        urlValue ??
        toControlApiDataPreviewPath(pathValue),
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

  normalizedRequestImages(job).forEach((image, index) => {
    if (!isRecord(image)) {
      return;
    }
    const assetId =
      typeof image.asset_id === "string" || typeof image.asset_id === "number" ? image.asset_id : null;
    if (assetId != null && sourceAssetId != null && String(assetId) === String(sourceAssetId)) {
      return;
    }
    const kind = studioReferenceKind(image.media_type);
    const role =
      image.role === "first_frame" || image.role === "last_frame" || image.role === "reference"
        ? image.role
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
    const urlValue = typeof image.url === "string" ? image.url : null;
    const pathValue = typeof image.path === "string" ? image.path : null;
    const url =
      (kind === "videos" ? mediaPlaybackUrl(asset) : null) ??
      mediaDisplayUrl(asset) ??
      mediaThumbnailUrl(asset) ??
      urlValue ??
      toControlApiDataPreviewPath(pathValue);
    if (!url) {
      return;
    }
    const dedupeKey = [assetId ?? "", pathValue ?? "", url].join("|");
    if (seen.has(dedupeKey)) {
      return;
    }
    seen.add(dedupeKey);
    references.push({
      key: `job-reference:${index}`,
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

  for (const image of normalizedRequestImages(job)) {
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
    const url =
      (kind === "videos" ? mediaPlaybackUrl(asset) : null) ??
      mediaDisplayUrl(asset) ??
      mediaThumbnailUrl(asset) ??
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

export function optionEntries(model: MediaModelSummary | null) {
  if (!model?.options || !isRecord(model.options)) {
    return [] as Array<[string, Record<string, unknown>]>;
  }
  return Object.entries(model.options).filter(
    (entry): entry is [string, Record<string, unknown>] =>
      !HIDDEN_STUDIO_OPTION_KEYS.has(entry[0]) && isRecord(entry[1]),
  );
}

export function sanitizeStudioOptions(options: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(options).filter(([key]) => !HIDDEN_STUDIO_OPTION_KEYS.has(key)),
  );
}

export function hasUsableOptionValue(value: unknown) {
  if (value == null) {
    return false;
  }
  if (typeof value === "boolean") {
    return true;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  return true;
}

export function buildNormalizedStudioOptions(
  model: MediaModelSummary | null,
  currentOptions: Record<string, unknown>,
  presetDefaults?: Record<string, unknown> | null,
) {
  const seededOptions: Record<string, unknown> = {
    ...(isRecord(model?.defaults) ? model.defaults : {}),
    ...(isRecord(presetDefaults) ? presetDefaults : {}),
    ...currentOptions,
  };
  for (const [optionKey, schema] of optionEntries(model)) {
    if (optionKey === "sound" && !hasUsableOptionValue(currentOptions[optionKey])) {
      seededOptions[optionKey] = false;
      continue;
    }
    if (hasUsableOptionValue(seededOptions[optionKey])) {
      continue;
    }
    if (hasUsableOptionValue(schema.default)) {
      seededOptions[optionKey] = schema.default;
      continue;
    }
    const choices = optionChoices(schema, seededOptions[optionKey]);
    if (choices.length) {
      seededOptions[optionKey] = choices[0];
    }
  }
  return sanitizeStudioOptions(seededOptions);
}

export function stripUnsupportedStudioOptions(
  modelKey: string,
  inputPattern: string,
  options: Record<string, unknown>,
) {
  const sanitized = { ...options };
  if (modelKey === "kling-3.0-i2v" && inputPattern === "first_last_frames") {
    delete sanitized.aspect_ratio;
  }
  return sanitized;
}

function aspectRatioIcon(value: unknown) {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)$/i);
  if (!match) {
    return RectangleHorizontal;
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return RectangleHorizontal;
  }
  if (Math.abs(width - height) < 0.001) {
    return Square;
  }
  return width > height ? RectangleHorizontal : RectangleVertical;
}

export function optionIcon(optionKey: string, value?: unknown) {
  if (optionKey.includes("sound") || optionKey.includes("audio")) {
    return Volume2;
  }
  if (optionKey.includes("google_search") || optionKey.includes("web")) {
    return Globe2;
  }
  if (optionKey.includes("duration")) {
    return Clock3;
  }
  if (optionKey.includes("ratio")) {
    return aspectRatioIcon(value);
  }
  if (optionKey.includes("resolution") || optionKey.includes("size")) {
    return RectangleHorizontal;
  }
  if (optionKey.includes("preset")) {
    return Sparkles;
  }
  if (optionKey.includes("model")) {
    return Clapperboard;
  }
  if (optionKey.includes("orientation") || optionKey.includes("mode")) {
    return SlidersHorizontal;
  }
  return Monitor;
}

export function pickerWidth(pickerId: string) {
  const exact = STUDIO_PICKER_WIDTHS[pickerId];
  if (exact) {
    return exact;
  }
  if (pickerId.includes("audio")) return STUDIO_PICKER_WIDTHS.audio;
  if (pickerId.includes("duration")) return STUDIO_PICKER_WIDTHS.duration;
  if (pickerId.includes("ratio")) return STUDIO_PICKER_WIDTHS.aspect_ratio;
  if (pickerId.includes("resolution") || pickerId.includes("size")) return STUDIO_PICKER_WIDTHS.resolution;
  if (pickerId.includes("format")) return STUDIO_PICKER_WIDTHS.output_format;
  if (pickerId.includes("web")) return STUDIO_PICKER_WIDTHS.google_search;
  return "w-[calc(50%-0.25rem)] sm:w-[108px]";
}

export function pickerMenuHeightCap(pickerId: string) {
  if (pickerId === "model") {
    return 520;
  }
  return 360;
}

export function optionChoices(schema: Record<string, unknown>, currentValue: unknown) {
  if (Array.isArray(schema.allowed)) {
    return schema.allowed as unknown[];
  }
  if (Array.isArray(schema.enum)) {
    return schema.enum as unknown[];
  }
  if (Array.isArray(schema.allowed_values)) {
    return schema.allowed_values as unknown[];
  }
  if (Array.isArray(schema.choices)) {
    return schema.choices as unknown[];
  }
  if (schema.type === "bool" || schema.type === "boolean" || typeof currentValue === "boolean" || typeof schema.default === "boolean") {
    return [true, false] as unknown[];
  }
  if (
    (schema.type === "int_range" || schema.type === "float_range" || schema.type === "number_range") &&
    typeof schema.min === "number" &&
    typeof schema.max === "number"
  ) {
    const min = Number(schema.min);
    const max = Number(schema.max);
    if (Number.isFinite(min) && Number.isFinite(max) && max >= min && max - min <= 20) {
      return Array.from({ length: max - min + 1 }, (_, index) => min + index);
    }
  }
  return [] as unknown[];
}

export function serializeOptionChoice(value: unknown) {
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return String(value ?? "");
}

export function parseOptionChoice(schema: Record<string, unknown>, value: string) {
  if (schema.type === "bool" || schema.type === "boolean" || typeof schema.default === "boolean") {
    return value === "true";
  }
  if (schema.type === "number" || schema.type === "int_range" || schema.type === "float_range" || schema.type === "number_range") {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? value : parsed;
  }
  return value;
}

export function optionShortLabel(optionKey: string) {
  if (optionKey === "aspect_ratio") return "Aspect";
  if (optionKey === "resolution") return "Resolution";
  if (optionKey === "output_format") return "Format";
  if (optionKey === "duration") return "Duration";
  if (optionKey === "sound") return "Audio";
  if (optionKey === "google_search") return "Web";
  if (optionKey === "multi_shots") return "Multi View";
  if (optionKey === "mode") return "Mode";
  return optionKey.replaceAll("_", " ");
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

export function optionBooleanValue(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  return false;
}

export function toWholeNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }
  return null;
}

export function parseMultiShotScript(script: string, selectedDuration: unknown): MultiShotParseResult {
  const trimmed = script.trim();
  if (!trimmed) {
    return {
      shots: [],
      errors: ["Add one shot per line in the format `seconds | prompt`."],
      totalDuration: 0,
    };
  }

  const errors: string[] = [];
  const shots = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line, index) => {
      const separatorIndex = line.indexOf("|");
      if (separatorIndex === -1) {
        errors.push(`Line ${index + 1} must use \`seconds | prompt\`.`);
        return [];
      }

      const durationText = line.slice(0, separatorIndex).trim();
      const promptText = line.slice(separatorIndex + 1).trim();
      const duration = Number(durationText);

      if (!Number.isInteger(duration) || duration <= 0) {
        errors.push(`Line ${index + 1} needs a whole-number duration before the pipe.`);
        return [];
      }

      if (duration < 1 || duration > 12) {
        errors.push(`Line ${index + 1} duration must stay between 1 and 12 seconds.`);
        return [];
      }

      if (!promptText) {
        errors.push(`Line ${index + 1} needs prompt text after the pipe.`);
        return [];
      }

      return [{ duration, prompt: promptText }];
    });

  const totalDuration = shots.reduce((sum, shot) => sum + shot.duration, 0);
  const expectedDuration = toWholeNumber(selectedDuration);
  if (expectedDuration != null && shots.length && totalDuration !== expectedDuration) {
    errors.push(`Shot durations total ${totalDuration}s, but the selected duration is ${expectedDuration}s.`);
  }

  return { shots, errors, totalDuration };
}

export function displayChoiceLabel(optionKey: string, _schema: Record<string, unknown>, value: unknown) {
  if (value == null || value === "") {
    return "Select";
  }
  if (optionKey === "mode" && typeof value === "string") {
    if (value === "std" || value === "720p") return "Standard";
    if (value === "pro" || value === "1080p") return "High";
  }
  if (optionKey === "duration") {
    const duration = toWholeNumber(value);
    return duration != null ? `${duration}s` : String(value);
  }
  if (optionKey === "output_format" && typeof value === "string") {
    return value.toUpperCase();
  }
  if ((optionKey === "resolution" || optionKey === "size") && typeof value === "string") {
    return value.replaceAll("_", " ").toUpperCase();
  }
  if (typeof value === "boolean") {
    if (optionKey === "google_search") return value ? "On" : "Off";
    if (optionKey === "sound") return value ? "On" : "Off";
    return value ? "On" : "Off";
  }
  if (typeof value === "string") {
    return value.replaceAll("_", " ");
  }
  return String(value);
}

export function studioOptionChoices(
  modelKey: string | null | undefined,
  optionKey: string,
  schema: Record<string, unknown>,
  currentValue: unknown,
) {
  return optionChoices(schema, currentValue);
}

export function buildChoiceList(
  modelKey: string | null | undefined,
  optionKey: string,
  schema: Record<string, unknown>,
  currentValue: unknown,
): StudioChoice[] {
  return studioOptionChoices(modelKey, optionKey, schema, currentValue).map((choice) => ({
    value: serializeOptionChoice(choice),
    label: displayChoiceLabel(optionKey, schema, choice),
  }));
}
