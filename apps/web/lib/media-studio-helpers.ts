import {
  Clapperboard,
  Clock3,
  Globe2,
  Monitor,
  RectangleHorizontal,
  SlidersHorizontal,
  Sparkles,
  Volume2,
} from "lucide-react";

import { findMediaAssetById } from "@/lib/studio-gallery";
import type {
  MediaAsset,
  MediaBatch,
  MediaJob,
  MediaModelSummary,
  MediaPreset,
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
  file: File | null;
  previewUrl: string | null;
};

export type MultiShotParseResult = {
  shots: Array<{ prompt: string; duration: number }>;
  errors: string[];
  totalDuration: number;
};

export type MediaAttachmentKind = {
  kind: "images" | "videos" | "audios";
};

export const HIDDEN_STUDIO_OPTION_KEYS = new Set<string>();
export const MULTI_SHOT_MODEL_KEYS = new Set(["kling-3.0-t2v", "kling-3.0-i2v"]);

const STUDIO_PICKER_WIDTHS: Record<string, string> = {
  model: "w-full sm:w-[232px]",
  preset: "w-full sm:w-[186px]",
  "output-count": "w-[calc(50%-0.25rem)] sm:w-[95px]",
  duration: "w-[calc(50%-0.25rem)] sm:w-[110px]",
  aspect_ratio: "w-[calc(50%-0.25rem)] sm:w-[104px]",
  sound: "w-[calc(50%-0.25rem)] sm:w-[114px]",
  audio: "w-[calc(50%-0.25rem)] sm:w-[114px]",
  resolution: "w-[calc(50%-0.25rem)] sm:w-[108px]",
  output_format: "w-[calc(50%-0.25rem)] sm:w-[120px]",
  mode: "w-[calc(50%-0.25rem)] sm:w-[120px]",
  google_search: "w-[calc(50%-0.25rem)] sm:w-[132px]",
};

export function isNanoPresetModel(modelKey: string | null | undefined) {
  return modelKey === "nano-banana-2" || modelKey === "nano-banana-pro";
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
    if (slotState?.assetId || slotState?.file) {
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
  const patterns = new Set(model?.input_patterns ?? []);

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
  if (file.type.startsWith("video/")) return "videos" as const;
  if (file.type.startsWith("audio/")) return "audios" as const;
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

export function optionIcon(optionKey: string) {
  if (optionKey.includes("sound") || optionKey.includes("audio")) {
    return Volume2;
  }
  if (optionKey.includes("google_search") || optionKey.includes("web")) {
    return Globe2;
  }
  if (optionKey.includes("duration")) {
    return Clock3;
  }
  if (optionKey.includes("ratio") || optionKey.includes("resolution") || optionKey.includes("size")) {
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
  return "w-[calc(50%-0.25rem)] sm:w-[132px]";
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
