"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CircleDollarSign,
  ChevronDown,
  Clapperboard,
  Clock3,
  Coins,
  Copy,
  Download,
  Globe2,
  Heart,
  Image as ImageIcon,
  ImagePlus,
  LoaderCircle,
  Monitor,
  Play,
  Plus,
  RectangleHorizontal,
  SlidersHorizontal,
  Sparkles,
  Settings2,
  Trash2,
  Volume2,
  Wand2,
  X,
} from "lucide-react";

import { useGlobalActivity } from "@/components/global-activity";
import { CollapsibleSubsection } from "@/components/collapsible-sections";
import { MediaModelsConsole } from "@/components/media-models-console";
import { Panel, PanelHeader } from "@/components/panel";
import { StatusPill } from "@/components/status-pill";
import {
  buildGalleryTiles,
  createOptimisticBatch,
  findMediaAssetById,
  mediaAssetPrompt,
  mergeAssetCollections,
  presetRequirementMessage,
  reconcileAssetCollections,
  selectedPromptObjects,
  structuredPresetInputValues,
  structuredPresetInputValuesFromAsset,
  structuredPresetSlotValues,
  structuredPresetSlotValuesFromAsset,
  type GalleryTile,
  upsertBatchCollection,
} from "@/lib/studio-gallery";
import type {
  LlmPreset,
  MediaAsset,
  MediaBatch,
  MediaEnhancementConfig,
  MediaJob,
  MediaModelQueuePolicy,
  MediaModelSummary,
  MediaEnhancePreviewResponse,
  MediaPreset,
  MediaQueueSettings,
  MediaSystemPrompt,
  MediaValidationResponse,
} from "@/lib/types";
import { estimateFromPricingSnapshot, resolveStudioPricingDisplay } from "@/lib/studio-pricing";
import { cn, formatDateTime, truncate } from "@/lib/utils";

type MediaStudioProps = {
  apiHealthy: boolean;
  models: MediaModelSummary[];
  presets: MediaPreset[];
  prompts: MediaSystemPrompt[];
  enhancementConfigs: MediaEnhancementConfig[];
  llmPresets: LlmPreset[];
  queueSettings: MediaQueueSettings | null;
  queuePolicies: MediaModelQueuePolicy[];
  batches: MediaBatch[];
  jobs: MediaJob[];
  assets: MediaAsset[];
  initialAssetLimit?: number;
  initialAssetOffset?: number;
  initialAssetsHasMore?: boolean;
  initialAssetsNextOffset?: number | null;
  latestAsset: MediaAsset | null;
  remainingCredits?: number | null;
  pricingSnapshot?: Record<string, unknown> | null;
  initialSelectedAssetId?: string | null;
  immersive?: boolean;
  closeHref?: string;
};

type AttachmentRecord = {
  id: string;
  file: File;
  kind: "images" | "videos" | "audios";
  previewUrl: string | null;
};

type GalleryKindFilter = "all" | "image" | "video";

type AssetPagePayload = {
  ok?: boolean;
  error?: string;
  assets?: MediaAsset[];
  limit?: number | null;
  offset?: number | null;
  has_more?: boolean;
  next_offset?: number | null;
};

type StudioChoice = {
  value: string;
  label: string;
};

type StructuredPresetTextField = {
  key: string;
  label: string;
  placeholder: string;
  defaultValue: string;
  required: boolean;
};

type StructuredPresetImageSlot = {
  key: string;
  label: string;
  helpText: string;
  required: boolean;
  maxFiles: number;
};

type PresetSlotState = {
  assetId: string | number | null;
  file: File | null;
  previewUrl: string | null;
};

type MultiShotParseResult = {
  shots: Array<{ prompt: string; duration: number }>;
  errors: string[];
  totalDuration: number;
};

const INITIAL_ASSET_PAGE_SIZE = 12;
const ASSET_APPEND_BATCH_SIZE = 4;

function isNanoPresetModel(modelKey: string | null | undefined) {
  return modelKey === "nano-banana-2" || modelKey === "nano-banana-pro";
}

function normalizeStructuredPresetTextFields(preset: MediaPreset | null): StructuredPresetTextField[] {
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

function normalizeStructuredPresetImageSlots(preset: MediaPreset | null): StructuredPresetImageSlot[] {
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

function renderStructuredPresetPrompt(
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

const gallerySpanClasses = [
  "sm:row-span-2",
  "",
  "",
  "sm:row-span-2",
  "",
  "",
  "sm:row-span-2",
  "",
  "",
  "sm:row-span-2",
  "",
  "",
];

const HIDDEN_STUDIO_OPTION_KEYS = new Set<string>();
const MULTI_SHOT_MODEL_KEYS = new Set(["kling-3.0-t2v", "kling-3.0-i2v"]);

function toneForStatus(status?: string | null) {
  if (status === "completed" || status === "succeeded") return "healthy";
  if (status === "failed") return "danger";
  if (status === "running" || status === "submitted") return "warning";
  return "neutral";
}

function toControlApiProxyPath(pathValue: string | null | undefined) {
  if (!pathValue || !pathValue.startsWith("/files/")) {
    return null;
  }
  return `/api/control/files${pathValue.slice("/files".length)}`;
}

function toControlApiDataPreviewPath(pathValue: string | null | undefined) {
  if (!pathValue) {
    return null;
  }
  const marker = "/runtime/control-api/data/";
  const markerIndex = pathValue.indexOf(marker);
  if (markerIndex === -1) {
    return null;
  }
  const relative = pathValue.slice(markerIndex + marker.length).replaceAll("\\", "/");
  if (!relative || relative.startsWith("../")) {
    return null;
  }
  return `/api/control/files/${relative}`;
}

function mediaVariantUrl(
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

function mediaThumbnailUrl(asset?: MediaAsset | null) {
  if (asset?.generation_kind === "video") {
    return mediaVariantUrl(asset, "poster") ?? mediaVariantUrl(asset, "thumb");
  }

  return mediaVariantUrl(asset, "thumb") ?? mediaVariantUrl(asset, "web") ?? mediaVariantUrl(asset, "poster");
}

function mediaDisplayUrl(asset?: MediaAsset | null) {
  if (asset?.generation_kind === "video") {
    return mediaThumbnailUrl(asset);
  }

  return mediaVariantUrl(asset, "web") ?? mediaVariantUrl(asset, "thumb") ?? mediaVariantUrl(asset, "poster");
}

function mediaPlaybackUrl(asset?: MediaAsset | null) {
  if (asset?.generation_kind !== "video") {
    return null;
  }

  return (
    mediaVariantUrl(asset, "web") ??
    asset.remote_output_url ??
    mediaVariantUrl(asset, "original")
  );
}

function mediaPreviewUrl(asset?: MediaAsset | null) {
  return mediaDisplayUrl(asset);
}

function prefetchAssetThumbs(assets: MediaAsset[], seenThumbUrls: Set<string>) {
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

function mediaDownloadName(asset?: MediaAsset | null) {
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

function mediaDownloadUrl(asset?: MediaAsset | null) {
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

function mediaInlineUrl(asset?: MediaAsset | null) {
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

function structuredPresetSlotPreviewUrl(
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

function jobPreviewUrl(job?: MediaJob | null) {
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

function classifyFile(file: File) {
  if (file.type.startsWith("video/")) return "videos" as const;
  if (file.type.startsWith("audio/")) return "audios" as const;
  return "images" as const;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function modelInputLimit(
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

function optionEntries(model: MediaModelSummary | null) {
  if (!model?.options || !isRecord(model.options)) {
    return [] as Array<[string, Record<string, unknown>]>;
  }
  return Object.entries(model.options).filter(
    (entry): entry is [string, Record<string, unknown>] =>
      !HIDDEN_STUDIO_OPTION_KEYS.has(entry[0]) && isRecord(entry[1]),
  );
}

function sanitizeStudioOptions(options: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(options).filter(([key]) => !HIDDEN_STUDIO_OPTION_KEYS.has(key)),
  );
}

function hasUsableOptionValue(value: unknown) {
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

function buildNormalizedStudioOptions(
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

function stripUnsupportedStudioOptions(
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

function optionIcon(optionKey: string) {
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

function pickerWidth(pickerId: string) {
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

function optionChoices(schema: Record<string, unknown>, currentValue: unknown) {
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

function serializeOptionChoice(value: unknown) {
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return String(value ?? "");
}

function parseOptionChoice(schema: Record<string, unknown>, value: string) {
  if (schema.type === "bool" || schema.type === "boolean" || typeof schema.default === "boolean") {
    return value === "true";
  }
  if (schema.type === "number" || schema.type === "int_range" || schema.type === "float_range" || schema.type === "number_range") {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? value : parsed;
  }
  return value;
}

function optionShortLabel(optionKey: string) {
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

function isCoarsePointerDevice() {
  if (typeof window === "undefined") {
    return false;
  }
  return window.matchMedia?.("(pointer: coarse)").matches ?? false;
}

function isMobileDownloadDevice() {
  if (typeof navigator === "undefined") {
    return false;
  }
  return (
    isCoarsePointerDevice() ||
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "")
  );
}

function isLikelyMobileSaveDevice() {
  if (typeof navigator === "undefined") {
    return false;
  }
  const userAgent = navigator.userAgent || "";
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent) || (userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1);
}

function mobileSaveActionLabel() {
  return isLikelyMobileSaveDevice() ? "Save" : "Download";
}

function isImageMimeType(value: string | null | undefined) {
  return (value ?? "").toLowerCase().startsWith("image/");
}

function replaceFileExtension(fileName: string, nextExtension: string) {
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

async function getMobileShareBlob(blob: Blob) {
  if (!isImageMimeType(blob.type)) {
    return blob;
  }
  if (blob.type === "image/png" || blob.type === "image/jpeg") {
    return blob;
  }
  return convertImageBlobToJpeg(blob);
}

function StudioMetricPill({
  icon: Icon,
  value,
  accent = "default",
}: {
  icon: typeof Coins;
  value: string;
  accent?: "default" | "highlight";
}) {
  return (
    <div
      className={cn(
        "inline-flex h-10 items-center gap-2 rounded-[14px] border px-3 text-[0.72rem] font-semibold",
        accent === "highlight"
          ? "border-[rgba(216,255,46,0.22)] bg-[rgba(14,18,15,0.99)] text-[#f4ffd3] shadow-[0_14px_24px_rgba(0,0,0,0.24)]"
          : "border-white/14 bg-[rgba(14,18,15,0.99)] text-white/92 shadow-[0_14px_24px_rgba(0,0,0,0.26)]",
      )}
    >
      <span
        className={cn(
          "inline-flex h-5 w-5 items-center justify-center rounded-full",
          accent === "highlight" ? "bg-[rgba(216,255,46,0.22)] text-[#d8ff2e]" : "bg-[rgba(216,255,46,0.18)] text-[#d8ff2e]",
        )}
      >
        <Icon className="size-3.5" />
      </span>
      <span>{value}</span>
    </div>
  );
}

function StudioActionIconButton({
  icon: Icon,
  label,
  onClick,
  disabled = false,
  tone = "secondary",
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "primary" | "secondary" | "danger";
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-10 w-10 items-center justify-center rounded-[16px] border transition disabled:cursor-not-allowed disabled:opacity-60",
        tone === "primary"
          ? "border-[rgba(216,255,46,0.24)] bg-[linear-gradient(135deg,#d8ff2e,#b5f414)] text-[#172200] shadow-[0_16px_28px_rgba(176,235,44,0.18)] hover:-translate-y-0.5"
          : tone === "danger"
            ? "border-[rgba(201,102,82,0.22)] bg-[rgba(201,102,82,0.08)] text-[#ffb5a6] hover:border-[rgba(201,102,82,0.34)] hover:bg-[rgba(201,102,82,0.12)]"
            : "border-white/10 bg-white/[0.06] text-white/78 hover:border-[rgba(216,141,67,0.32)] hover:bg-[rgba(216,141,67,0.14)] hover:text-white",
        className,
      )}
    >
      <Icon className="size-4" />
    </button>
  );
}

function inferBlobMimeType(asset: MediaAsset | null | undefined, blob: Blob) {
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

function optionBooleanValue(value: unknown) {
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

function toWholeNumber(value: unknown) {
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

function parseMultiShotScript(script: string, selectedDuration: unknown): MultiShotParseResult {
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

function displayChoiceLabel(optionKey: string, _schema: Record<string, unknown>, value: unknown) {
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

function studioOptionChoices(
  modelKey: string | null | undefined,
  optionKey: string,
  schema: Record<string, unknown>,
  currentValue: unknown,
) {
  return optionChoices(schema, currentValue);
}

function buildChoiceList(
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

function StudioPillSelect({
  pickerId,
  openPicker,
  setOpenPicker,
  widthClass,
  icon: Icon,
  label,
  choices,
  onSelect,
}: {
  pickerId: string;
  openPicker: string | null;
  setOpenPicker: (value: string | null) => void;
  widthClass: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  choices: StudioChoice[];
  onSelect: (value: string) => void;
}) {
  const isOpen = openPicker === pickerId;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [menuPlacement, setMenuPlacement] = useState<"up" | "down">("down");
  const [menuMaxHeight, setMenuMaxHeight] = useState(280);

  useLayoutEffect(() => {
    if (!isOpen) {
      return;
    }

    function updateMenuPlacement() {
      const container = containerRef.current;
      if (!container) {
        return;
      }
      const rect = container.getBoundingClientRect();
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const gutter = 20;
      const gap = 12;
      const spaceBelow = Math.max(0, viewportHeight - rect.bottom - gutter - gap);
      const spaceAbove = Math.max(0, rect.top - gutter - gap);
      const preferDown = spaceBelow >= 220 || spaceBelow >= spaceAbove;
      const nextPlacement = preferDown ? "down" : "up";
      const availableSpace = nextPlacement === "down" ? spaceBelow : spaceAbove;
      setMenuPlacement(nextPlacement);
      setMenuMaxHeight(Math.max(160, Math.min(availableSpace, 320)));
    }

    updateMenuPlacement();
    window.addEventListener("resize", updateMenuPlacement);
    window.addEventListener("scroll", updateMenuPlacement, true);
    window.visualViewport?.addEventListener("resize", updateMenuPlacement);
    window.visualViewport?.addEventListener("scroll", updateMenuPlacement);

    return () => {
      window.removeEventListener("resize", updateMenuPlacement);
      window.removeEventListener("scroll", updateMenuPlacement, true);
      window.visualViewport?.removeEventListener("resize", updateMenuPlacement);
      window.visualViewport?.removeEventListener("scroll", updateMenuPlacement);
    };
  }, [isOpen]);

  return (
    <div
      ref={containerRef}
      data-studio-picker
      data-picker-id={pickerId}
      className={cn("relative", widthClass, isOpen ? "z-40" : "z-10")}
    >
      <button
        type="button"
        onClick={() => setOpenPicker(isOpen ? null : pickerId)}
        className="flex h-12 w-full items-center gap-3 rounded-[18px] border border-white/8 bg-white/[0.04] pl-3.5 pr-3.5 text-left text-[0.82rem] font-semibold text-white transition hover:border-[rgba(216,141,67,0.22)]"
      >
        <Icon className="size-4.5 shrink-0 text-[rgba(208,255,72,0.92)]" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronDown className={cn("size-4 shrink-0 text-white/42 transition", isOpen ? "rotate-180" : "")} />
      </button>

      {isOpen ? (
        <div
          style={{ maxHeight: `${menuMaxHeight}px` }}
          className={cn(
            "absolute left-0 z-30 w-full overflow-auto rounded-[20px] border border-white/10 bg-[rgba(17,20,19,0.98)] p-2 shadow-[0_24px_52px_rgba(0,0,0,0.44)] backdrop-blur-xl",
            menuPlacement === "down" ? "top-[calc(100%+0.65rem)]" : "bottom-[calc(100%+0.65rem)]",
          )}
        >
          <div className="grid gap-1">
            {choices.map((choice) => (
              <button
                key={`${pickerId}:${choice.value}`}
                type="button"
                onClick={() => {
                  onSelect(choice.value);
                  setOpenPicker(null);
                }}
                className="rounded-[14px] px-3 py-2.5 text-left text-[0.82rem] font-medium text-white/84 transition hover:bg-white/[0.08] hover:text-white"
              >
                {choice.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function inferInputPattern(
  model: MediaModelSummary | null,
  attachments: AttachmentRecord[],
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

function formatOptionValue(value: unknown) {
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

function studioValidationReady(validation: MediaValidationResponse | null) {
  if (!validation?.state) {
    return false;
  }
  return READY_MEDIA_VALIDATION_STATES.has(validation.state.toLowerCase());
}

function prettifyModelLabel(modelKey: string | null | undefined) {
  if (!modelKey) {
    return "Media";
  }
  return modelKey.replaceAll("-", " ");
}

function presetThumbnailVisual(preset: MediaPreset | null | undefined) {
  if (!preset?.thumbnail_url) {
    return null;
  }
  if (preset.thumbnail_url.startsWith("/files/")) {
    return `/api/control/files${preset.thumbnail_url.slice("/files".length)}`;
  }
  return preset.thumbnail_url;
}

function jobStatusLabel(status: string | null | undefined) {
  if (status === "queued") return "Queued";
  if (status === "submitted" || status === "running" || status === "processing") return "Processing";
  if (status === "completed") return "Complete";
  return "Failed";
}

function jobPhaseMessage(job: MediaJob | null | undefined) {
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

function batchPhaseMessage(batch: MediaBatch | null | undefined) {
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

export function MediaStudio({
  apiHealthy,
  models,
  presets,
  prompts,
  enhancementConfigs,
  llmPresets,
  queueSettings,
  queuePolicies,
  batches,
  jobs,
  assets,
  initialAssetLimit = INITIAL_ASSET_PAGE_SIZE,
  initialAssetOffset = 0,
  initialAssetsHasMore = false,
  initialAssetsNextOffset = null,
  latestAsset,
  remainingCredits,
  pricingSnapshot,
  initialSelectedAssetId = null,
  immersive = false,
  closeHref = "/media",
}: MediaStudioProps) {
  const router = useRouter();
  const { showActivity } = useGlobalActivity();
  const promptInputRef = useRef<HTMLTextAreaElement | null>(null);
  const lightboxVideoRef = useRef<HTMLVideoElement | null>(null);
  const galleryLoadMoreRef = useRef<HTMLDivElement | null>(null);
  const loadMoreAssetsRef = useRef<() => void>(() => undefined);
  const prefetchedThumbUrlsRef = useRef(new Set<string>());
  const autoValidateTimerRef = useRef<number | null>(null);
  const validationRequestIdRef = useRef(0);
  const [isRefreshing, startRefresh] = useTransition();
  const [modelKey, setModelKey] = useState(models[0]?.key ?? "nano-banana-2");
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [selectedPromptIds, setSelectedPromptIds] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const [presetInputValues, setPresetInputValues] = useState<Record<string, string>>({});
  const [presetSlotStates, setPresetSlotStates] = useState<Record<string, PresetSlotState>>({});
  const [optionValues, setOptionValues] = useState<Record<string, unknown>>({});
  const [enhanceDialogOpen, setEnhanceDialogOpen] = useState(false);
  const [enhanceBusy, setEnhanceBusy] = useState(false);
  const [enhancePreview, setEnhancePreview] = useState<MediaEnhancePreviewResponse | null>(null);
  const [enhanceError, setEnhanceError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<AttachmentRecord[]>([]);
  const [isDragActive, setIsDragActive] = useState(false);
  const [studioSettingsOpen, setStudioSettingsOpen] = useState(false);
  const [validation, setValidation] = useState<MediaValidationResponse | null>(null);
  const [busyState, setBusyState] = useState<"idle" | "validate" | "submit">("idle");
  const [formMessage, setFormMessage] = useState<{ tone: "healthy" | "warning" | "danger"; text: string } | null>(null);
  const [galleryModelFilter, setGalleryModelFilter] = useState("all");
  const [galleryKindFilter, setGalleryKindFilter] = useState<GalleryKindFilter>("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [favoriteAssets, setFavoriteAssets] = useState<MediaAsset[] | null>(null);
  const [favoritesLoading, setFavoritesLoading] = useState(false);
  const [favoriteAssetFeedHasMore, setFavoriteAssetFeedHasMore] = useState(false);
  const [favoriteAssetFeedNextOffset, setFavoriteAssetFeedNextOffset] = useState<number | null>(null);
  const [loadingMoreFavoriteAssets, setLoadingMoreFavoriteAssets] = useState(false);
  const [prefetchingFavoriteAssetPage, setPrefetchingFavoriteAssetPage] = useState(false);
  const [prefetchedFavoriteAssetPage, setPrefetchedFavoriteAssetPage] = useState<AssetPagePayload | null>(null);
  const [favoriteAssetIdBusy, setFavoriteAssetIdBusy] = useState<string | number | null>(null);
  const [galleryScrollArmed, setGalleryScrollArmed] = useState(false);
  const [mobileComposerCollapsed, setMobileComposerCollapsed] = useState(true);
  const [mobileInspectorPromptOpen, setMobileInspectorPromptOpen] = useState(false);
  const [mobileInspectorInfoOpen, setMobileInspectorInfoOpen] = useState(false);
  const [selectedAssetId, setSelectedAssetId] = useState<string | number | null>(initialSelectedAssetId);
  const [selectedAssetHydratedJob, setSelectedAssetHydratedJob] = useState<MediaJob | null>(null);
  const [selectedMediaLightboxOpen, setSelectedMediaLightboxOpen] = useState(false);
  const [sourceAssetId, setSourceAssetId] = useState<string | number | null>(null);
  const [outputCount, setOutputCount] = useState(1);
  const [localBatches, setLocalBatches] = useState<MediaBatch[]>(batches);
  const [optimisticBatches, setOptimisticBatches] = useState<MediaBatch[]>([]);
  const [localJobs, setLocalJobs] = useState<MediaJob[]>(jobs);
  const [localAssets, setLocalAssets] = useState<MediaAsset[]>(assets);
  const [assetPageLimit, setAssetPageLimit] = useState(Math.max(initialAssetLimit, INITIAL_ASSET_PAGE_SIZE));
  const [assetFeedHasMore, setAssetFeedHasMore] = useState(initialAssetsHasMore);
  const [assetFeedNextOffset, setAssetFeedNextOffset] = useState<number | null>(initialAssetsNextOffset);
  const [loadingMoreAssets, setLoadingMoreAssets] = useState(false);
  const [prefetchingAssetPage, setPrefetchingAssetPage] = useState(false);
  const [prefetchedAssetPage, setPrefetchedAssetPage] = useState<AssetPagePayload | null>(null);
  const [localLatestAsset, setLocalLatestAsset] = useState<MediaAsset | null>(latestAsset);
  const [openPicker, setOpenPicker] = useState<string | null>(null);

  const currentModel = models.find((model) => model.key === modelKey) ?? null;
  const globalEnhancementConfig =
    enhancementConfigs.find((config) => config.model_key === "__studio_enhancement__") ??
    enhancementConfigs.find(
      (config) => Boolean(config.provider_model_id || (config.provider_kind && config.provider_kind !== "builtin")),
    ) ??
    null;
  const currentModelEnhancementConfig =
    enhancementConfigs.find((config) => config.model_key === modelKey) ?? null;
  const enhanceEnabledForModel = Boolean(currentModelEnhancementConfig?.supports_text_enhancement);
  const currentQueuePolicy = queuePolicies.find((policy) => policy.model_key === modelKey) ?? null;
  const maxConcurrentJobs = Math.max(1, queueSettings?.max_concurrent_jobs ?? 10);
  const modelMaxOutputs = Math.max(
    1,
    Math.min(
      maxConcurrentJobs,
      currentQueuePolicy?.max_outputs_per_run ?? (isNanoPresetModel(modelKey) ? 3 : 1),
    ),
  );
  const currentSourceAsset = findMediaAssetById(sourceAssetId, localAssets, favoriteAssets) ?? null;
  const maxImageInputs = modelInputLimit(currentModel, "image_inputs");
  const maxVideoInputs = modelInputLimit(currentModel, "video_inputs");
  const maxAudioInputs = modelInputLimit(currentModel, "audio_inputs");
  const imageAttachments = attachments.filter((attachment) => attachment.kind === "images");
  const videoAttachments = attachments.filter((attachment) => attachment.kind === "videos");
  const audioAttachments = attachments.filter((attachment) => attachment.kind === "audios");
  const sourceAssetIsImage = currentSourceAsset?.generation_kind === "image";
  const sourceAssetIsVideo = currentSourceAsset?.generation_kind === "video";
  const stagedImageCount = imageAttachments.length + (sourceAssetIsImage ? 1 : 0);
  const stagedVideoCount = videoAttachments.length + (sourceAssetIsVideo ? 1 : 0);
  const stagedAudioCount = audioAttachments.length;
  const currentPreset =
    presets.find((preset) => preset.preset_id === selectedPresetId || preset.key === selectedPresetId) ?? null;
  const enhanceProviderLabel =
    enhancePreview?.provider_label ??
    globalEnhancementConfig?.provider_label ??
    (globalEnhancementConfig?.provider_kind === "openrouter"
      ? "OpenRouter.ai"
      : globalEnhancementConfig?.provider_kind === "local_openai"
        ? "Local OpenAI-Compatible"
        : "Built-in helper");
  const enhanceProviderModelId =
    enhancePreview?.provider_model_id ??
    globalEnhancementConfig?.provider_model_id ??
      (globalEnhancementConfig?.provider_kind === "openrouter" ? "qwen/qwen3.5-35b-a3b" : null);
  const enhanceImageAnalysisText = enhancePreview?.image_analysis
    ? typeof enhancePreview.image_analysis === "string"
      ? enhancePreview.image_analysis
      : String(
          (enhancePreview.image_analysis as Record<string, unknown>).analysis ??
            (enhancePreview.image_analysis as Record<string, unknown>).warning ??
            "No image analysis output returned.",
        )
    : null;
  const enhanceImageAnalysisStatus = enhancePreview?.image_analysis
    ? typeof enhancePreview.image_analysis === "string"
      ? "available"
      : String((enhancePreview.image_analysis as Record<string, unknown>).status ?? "available")
    : "Not checked";
  const structuredPresetTextFields = useMemo(() => normalizeStructuredPresetTextFields(currentPreset), [currentPreset]);
  const structuredPresetImageSlots = useMemo(() => normalizeStructuredPresetImageSlots(currentPreset), [currentPreset]);
  const structuredPresetActive =
    isNanoPresetModel(modelKey) && Boolean(currentPreset) && (structuredPresetTextFields.length > 0 || structuredPresetImageSlots.length > 0);
  const inputPattern = inferInputPattern(currentModel, attachments, currentSourceAsset);
  const explicitVideoImageSlots =
    !structuredPresetActive &&
    currentModel?.generation_kind === "video" &&
    maxImageInputs > 0 &&
    maxImageInputs <= 2 &&
    maxVideoInputs === 0 &&
    maxAudioInputs === 0;
  const orderedImageInputs = useMemo(() => {
    const items: Array<
      | { source: "asset"; asset: MediaAsset }
      | { source: "attachment"; attachment: AttachmentRecord }
    > = [];
    if (sourceAssetIsImage && currentSourceAsset) {
      items.push({ source: "asset", asset: currentSourceAsset });
    }
    for (const attachment of imageAttachments) {
      items.push({ source: "attachment", attachment });
    }
    return items;
  }, [currentSourceAsset, imageAttachments, sourceAssetIsImage]);
  const multiShotsEnabled =
    MULTI_SHOT_MODEL_KEYS.has(modelKey) && optionBooleanValue(optionValues["multi_shots"]);
  const multiShotScript = useMemo(
    () => parseMultiShotScript(prompt, optionValues["duration"]),
    [optionValues, prompt],
  );
  const multiShotScriptError = multiShotsEnabled ? multiShotScript.errors[0] ?? null : null;
  const selectedPromptList = selectedPromptObjects(selectedPromptIds, prompts);
  const modelPresets = isNanoPresetModel(modelKey) ? presets.filter((preset) => {
    if (preset.source_kind === "builtin") {
      return false;
    }
    const scopedModels = preset.applies_to_models?.length ? preset.applies_to_models : (preset.model_key ? [preset.model_key] : []);
    return !scopedModels.length || scopedModels.includes(modelKey);
  }) : [];
  const baseGalleryAssets = favoritesOnly ? favoriteAssets ?? [] : localAssets;
  const visibleAssets = baseGalleryAssets.filter((asset) => {
    if (galleryModelFilter !== "all" && asset.model_key !== galleryModelFilter) {
      return false;
    }
    if (galleryKindFilter !== "all" && asset.generation_kind !== galleryKindFilter) {
      return false;
    }
    return true;
  });
  const allowLatestGalleryFallback = !favoritesOnly && galleryModelFilter === "all" && galleryKindFilter === "all";
  const openBatches = localBatches.filter((batch) => ["queued", "processing", "failed", "partial_failure"].includes(batch.status));
  const openOptimisticBatches = optimisticBatches.filter((batch) => ["queued", "processing"].includes(batch.status));
  const activeGalleryHasMore = favoritesOnly ? favoriteAssetFeedHasMore : assetFeedHasMore;
  const activeGalleryLoadingMore = favoritesOnly ? loadingMoreFavoriteAssets : loadingMoreAssets;
  const galleryTiles = useMemo(
    () =>
      buildGalleryTiles(
        visibleAssets,
        localLatestAsset,
        [...openOptimisticBatches, ...openBatches],
        localAssets,
        activeGalleryHasMore,
        allowLatestGalleryFallback,
      ),
    [visibleAssets, localLatestAsset, openOptimisticBatches, openBatches, localAssets, activeGalleryHasMore, allowLatestGalleryFallback],
  );
  const selectedAsset = findMediaAssetById(selectedAssetId, localAssets, favoriteAssets) ?? null;
  const selectedAssetCachedJob = useMemo(() => {
    if (!selectedAsset) {
      return null;
    }
    return (
      localJobs.find((job) => {
        if (selectedAsset.job_id && job.job_id === selectedAsset.job_id) {
          return true;
        }
        if (selectedAsset.provider_task_id && job.provider_task_id === selectedAsset.provider_task_id) {
          return true;
        }
        if (selectedAsset.run_id && job.artifact?.run_id === selectedAsset.run_id) {
          return true;
        }
        return false;
      }) ?? null
    );
  }, [localJobs, selectedAsset]);
  const selectedAssetJob =
    selectedAssetHydratedJob && selectedAssetHydratedJob.job_id === selectedAsset?.job_id
      ? selectedAssetHydratedJob
      : selectedAssetCachedJob;
  const selectedAssetPrompt = mediaAssetPrompt(selectedAsset, selectedAssetJob);
  const selectedAssetPreset = useMemo(
    () => presets.find((preset) => preset.key === selectedAsset?.preset_key) ?? null,
    [presets, selectedAsset?.preset_key],
  );
  const selectedAssetPresetFields = useMemo(
    () => normalizeStructuredPresetTextFields(selectedAssetPreset),
    [selectedAssetPreset],
  );
  const selectedAssetPresetSlots = useMemo(
    () => normalizeStructuredPresetImageSlots(selectedAssetPreset),
    [selectedAssetPreset],
  );
  const selectedAssetPresetInputValues = useMemo(
    () => {
      const fromJob = structuredPresetInputValues(selectedAssetJob);
      if (Object.keys(fromJob).length > 0) {
        return fromJob;
      }
      return structuredPresetInputValuesFromAsset(selectedAsset);
    },
    [selectedAsset, selectedAssetJob],
  );
  const selectedAssetPresetSlotValues = useMemo(
    () => {
      const fromJob = structuredPresetSlotValues(selectedAssetJob);
      if (Object.keys(fromJob).length > 0) {
        return fromJob;
      }
      return structuredPresetSlotValuesFromAsset(selectedAsset);
    },
    [selectedAsset, selectedAssetJob],
  );
  const selectedAssetStructuredPresetActive =
    Boolean(selectedAssetPreset) && (selectedAssetPresetFields.length > 0 || selectedAssetPresetSlots.length > 0);
  const structuredPresetPromptPreview = structuredPresetActive
    ? renderStructuredPresetPrompt(currentPreset?.prompt_template ?? "", presetInputValues, presetSlotStates, structuredPresetImageSlots)
    : "";
  const presetRequirementError = structuredPresetActive
    ? (() => {
        for (const field of structuredPresetTextFields) {
          const value = String(presetInputValues[field.key] ?? field.defaultValue ?? "").trim();
          if (field.required && !value) {
            return `The preset ${currentPreset?.label} requires the text field ${field.label}.`;
          }
        }
        for (const slot of structuredPresetImageSlots) {
          const slotState = presetSlotStates[slot.key];
          const slotFilled = Boolean(slotState?.assetId || slotState?.file);
          if (slot.required && !slotFilled) {
            return `The preset ${currentPreset?.label} requires the image slot ${slot.label}.`;
          }
        }
        return null;
      })()
    : presetRequirementMessage(currentPreset, attachments, currentSourceAsset);
  const firstPresetSlotPreview = structuredPresetImageSlots
    .map((slot) => presetSlotStates[slot.key]?.previewUrl)
    .find((value) => Boolean(value)) ?? null;
  const enhancementPreviewVisual = structuredPresetActive
    ? firstPresetSlotPreview
    : currentSourceAsset
      ? mediaDisplayUrl(currentSourceAsset)
      : attachments.find((attachment) => attachment.kind === "images")?.previewUrl ?? null;
  const selectedAssetDisplayVisual = mediaDisplayUrl(selectedAsset);
  const selectedAssetPlaybackVisual = mediaPlaybackUrl(selectedAsset);
  const selectedAssetLightboxVisual =
    (selectedAsset?.generation_kind === "video"
      ? selectedAssetPlaybackVisual ?? selectedAssetDisplayVisual
      : mediaVariantUrl(selectedAsset, "web") ??
        mediaVariantUrl(selectedAsset, "original") ??
        selectedAssetDisplayVisual) ?? null;
  const mobileComposerExpanded = !mobileComposerCollapsed;
  const compactOptionEntries = optionEntries(currentModel);
  const showImmersiveTopChrome = !immersive;
  const showImmersiveExit = immersive;
  const optionSignature = useMemo(() => JSON.stringify(optionValues), [optionValues]);
  const pricingOptions = useMemo(
    () =>
      buildNormalizedStudioOptions(
        currentModel,
        optionValues,
        isRecord(currentPreset?.default_options_json) ? currentPreset.default_options_json : null,
      ),
    [currentModel, currentPreset?.default_options_json, optionValues],
  );
  const selectedPromptSignature = useMemo(() => selectedPromptIds.join("|"), [selectedPromptIds]);
  const attachmentSignature = useMemo(
    () => attachments.map((attachment) => `${attachment.id}:${attachment.file.name}:${attachment.file.size}`).join("|"),
    [attachments],
  );
  const localPricingEstimate = useMemo(
    () => estimateFromPricingSnapshot(pricingSnapshot, modelKey, pricingOptions, outputCount),
    [modelKey, outputCount, pricingOptions, pricingSnapshot],
  );
  const { estimatedCredits, estimatedCostUsd, generatePriceLabel } = useMemo(
    () => resolveStudioPricingDisplay(validation, localPricingEstimate),
    [validation, localPricingEstimate],
  );
  const formattedRemainingCredits =
    typeof remainingCredits === "number"
      ? `${remainingCredits.toFixed(remainingCredits % 1 === 0 ? 0 : 1)}`
      : null;
  const generateButtonLabel =
    busyState === "submit" ? "Generating..." : generatePriceLabel ? `Generate · ${generatePriceLabel}` : "Generate";

  useEffect(() => {
    setSelectedMediaLightboxOpen(false);
  }, [selectedAssetId]);

  useEffect(() => {
    if (!initialSelectedAssetId) {
      return;
    }
    const matchedAsset = findMediaAssetById(initialSelectedAssetId, localAssets, favoriteAssets);
    if (matchedAsset) {
      setSelectedAssetId(matchedAsset.asset_id);
    }
  }, [initialSelectedAssetId, localAssets, favoriteAssets]);

  useEffect(() => {
    if (!selectedMediaLightboxOpen || selectedAsset?.generation_kind !== "video") {
      return;
    }
    const video = lightboxVideoRef.current;
    if (!video) {
      return;
    }

    const timer = window.setTimeout(() => {
      void video.play().catch(() => undefined);
      const webkitVideo = video as HTMLVideoElement & { webkitEnterFullscreen?: () => void };
      if (typeof video.requestFullscreen === "function") {
        void video.requestFullscreen().catch(() => {
          webkitVideo.webkitEnterFullscreen?.();
        });
        return;
      }
      webkitVideo.webkitEnterFullscreen?.();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [selectedAsset?.asset_id, selectedAsset?.generation_kind, selectedMediaLightboxOpen]);
  const validationReady = studioValidationReady(validation);
  const inferredInputPattern = inferInputPattern(currentModel, attachments, currentSourceAsset);
  const composerHasSubmittableInput = structuredPresetActive
    ? Boolean(structuredPresetPromptPreview)
    : (multiShotsEnabled ? multiShotScript.shots.length > 0 && !multiShotScriptError : Boolean(prompt.trim()));
  const canSubmit =
    busyState === "idle" &&
    !presetRequirementError &&
    composerHasSubmittableInput;
  const composerStatusMessage =
    busyState === "validate"
      ? { tone: "warning" as const, text: "Validating request and checking estimated cost." }
      : busyState === "submit"
        ? { tone: "warning" as const, text: "Preparing the job and sending it to the runner." }
        : formMessage;
  const studioSettingsButton = (
    <button
      type="button"
      onClick={() => router.push("/settings")}
      aria-label="Open studio settings"
      title="Open studio settings"
      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[16px] border border-white/10 bg-white/[0.05] text-white/76 transition hover:border-[rgba(216,141,67,0.28)] hover:bg-[rgba(216,141,67,0.12)] hover:text-white"
    >
      <Settings2 className="size-4" />
    </button>
  );
  const imageSlotLabels =
    explicitVideoImageSlots && currentModel?.input_patterns?.includes("first_last_frames")
      ? ["Start frame", "End frame"]
      : ["Source image"];
  const imageLimitLabel = maxImageInputs > 0 ? `${stagedImageCount} / ${maxImageInputs} images` : null;
  const canAddMoreImages = maxImageInputs <= 0 ? false : stagedImageCount < maxImageInputs;
  const canAddMoreVideos = maxVideoInputs <= 0 ? false : stagedVideoCount < maxVideoInputs;
  const canAddMoreAudios = maxAudioInputs <= 0 ? false : stagedAudioCount < maxAudioInputs;
  const sourceAttachmentStrip = !structuredPresetActive ? (
    <div className="flex flex-wrap gap-3">
      {explicitVideoImageSlots ? (
        <>
          {Array.from({ length: maxImageInputs }, (_, slotIndex) => {
            const slot = orderedImageInputs[slotIndex] ?? null;
            const slotVisual =
              slot?.source === "asset"
                ? mediaThumbnailUrl(slot.asset)
                : slot?.attachment?.previewUrl ?? null;
            const slotLabel = imageSlotLabels[slotIndex] ?? `Image ${slotIndex + 1}`;
            const slotFilled = Boolean(slot);
            return (
              <div key={`video-image-slot-${slotIndex}`} className="flex flex-col gap-2">
                <div className="text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-white/46">{slotLabel}</div>
                <div className="relative h-[82px] w-[82px]">
                  {slotFilled ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (slot?.source === "asset") {
                          setSourceAssetId(null);
                        } else if (slot?.source === "attachment") {
                          removeAttachment(slot.attachment.id);
                        }
                      }}
                      className={cn(
                        "group relative h-full w-full overflow-hidden rounded-[24px] border bg-white/8",
                        slot?.source === "asset" ? "border-[rgba(216,141,67,0.24)]" : "border-white/8",
                      )}
                    >
                      {slotVisual ? (
                        <img
                          src={slotVisual}
                          alt={slotLabel}
                          loading="eager"
                          fetchPriority="high"
                          decoding="async"
                          className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                        />
                      ) : null}
                    </button>
                  ) : (
                    <label
                      onDragOver={(event) => {
                        event.preventDefault();
                        setIsDragActive(true);
                      }}
                      onDragLeave={() => setIsDragActive(false)}
                      onDrop={(event) => void handleSourceTileDrop(event, slotIndex)}
                      className={cn(
                        "flex h-full w-full cursor-pointer items-center justify-center rounded-[24px] border border-white/10 bg-white/[0.06] text-white/82 transition hover:border-[rgba(216,141,67,0.28)] hover:bg-white/[0.09]",
                        isDragActive ? "border-[rgba(216,141,67,0.42)] bg-[rgba(24,28,26,0.95)]" : "",
                      )}
                    >
                      <Plus className="size-6" />
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(event) => {
                          if (slotIndex > orderedImageInputs.length) {
                            setFormMessage({ tone: "warning", text: "Fill the earlier image slot first." });
                            return;
                          }
                          addFiles(event.target.files);
                        }}
                      />
                    </label>
                  )}
                </div>
              </div>
            );
          })}
        </>
      ) : (
        <>
          {currentSourceAsset ? (
            <button
              type="button"
              onClick={() => setSourceAssetId(null)}
              className="group relative h-[82px] w-[82px] overflow-hidden rounded-[24px] border border-[rgba(216,141,67,0.24)] bg-white/8"
            >
              {mediaThumbnailUrl(currentSourceAsset) ? (
                <img
                  src={mediaThumbnailUrl(currentSourceAsset) ?? ""}
                  alt={currentSourceAsset.prompt_summary ?? "Source asset"}
                  loading="eager"
                  fetchPriority="high"
                  decoding="async"
                  className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                />
              ) : null}
            </button>
          ) : null}

          {attachments.slice(0, 4).map((attachment) => (
            <button
              key={attachment.id}
              type="button"
              onClick={() => removeAttachment(attachment.id)}
              className="group relative h-[82px] w-[82px] overflow-hidden rounded-[24px] border border-white/8 bg-white/8"
            >
              {attachment.previewUrl ? (
                attachment.kind === "videos" ? (
                  <video src={attachment.previewUrl} className="h-full w-full object-cover" />
                ) : (
                  <img src={attachment.previewUrl} alt={attachment.file.name} className="h-full w-full object-cover" />
                )
              ) : null}
              <div className="absolute inset-x-0 bottom-0 bg-black/45 px-2 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-white/92">
                {attachment.kind === "images" ? "Image" : attachment.kind === "videos" ? "Video" : "Audio"}
              </div>
            </button>
          ))}

          {attachments.length > 4 ? (
            <div className="flex h-[82px] w-[82px] items-center justify-center rounded-[24px] border border-white/10 bg-white/[0.04] text-center text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-white/58">
              +{attachments.length - 4} more
            </div>
          ) : null}

          <label
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragActive(true);
            }}
            onDragLeave={() => setIsDragActive(false)}
            onDrop={(event) => void handleSourceTileDrop(event)}
            className={cn(
              "flex h-[82px] w-[82px] cursor-pointer items-center justify-center rounded-[24px] border border-white/10 bg-white/[0.06] text-white/82 transition hover:border-[rgba(216,141,67,0.28)] hover:bg-white/[0.09]",
              isDragActive ? "border-[rgba(216,141,67,0.42)] bg-[rgba(24,28,26,0.95)]" : "",
              !canAddMoreImages && !canAddMoreVideos && !canAddMoreAudios ? "cursor-not-allowed opacity-45 hover:border-white/10 hover:bg-white/[0.06]" : "",
            )}
          >
            <Plus className="size-6" />
            <input
              type="file"
              multiple
              accept="image/*,video/*,audio/*"
              className="hidden"
              disabled={!canAddMoreImages && !canAddMoreVideos && !canAddMoreAudios}
              onChange={(event) => addFiles(event.target.files)}
            />
          </label>
        </>
      )}
      {(imageLimitLabel || maxVideoInputs > 0 || maxAudioInputs > 0) && !explicitVideoImageSlots ? (
        <div className="flex min-h-[82px] min-w-[120px] flex-col justify-center rounded-[24px] border border-white/10 bg-white/[0.04] px-3 py-2">
          {imageLimitLabel ? (
            <div className="text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-white/62">{imageLimitLabel}</div>
          ) : null}
          {maxVideoInputs > 0 ? (
            <div className="mt-1 text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-white/44">
              {stagedVideoCount} / {maxVideoInputs} videos
            </div>
          ) : null}
          {maxAudioInputs > 0 ? (
            <div className="mt-1 text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-white/44">
              {stagedAudioCount} / {maxAudioInputs} audio
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  ) : null;

  async function fetchAssetPage({
    offset,
    favorited,
    limitOverride,
    silent = false,
  }: {
    offset: number;
    favorited?: boolean;
    limitOverride?: number;
    silent?: boolean;
  }): Promise<AssetPagePayload | null> {
    const requestLimit = Math.max(1, limitOverride ?? assetPageLimit);
    const params = new URLSearchParams({
      limit: String(requestLimit),
      offset: String(Math.max(0, offset)),
    });
    if (favorited) {
      params.set("favorited", "true");
    }
    if (galleryKindFilter !== "all") {
      params.set("generation_kind", galleryKindFilter);
    }
    if (galleryModelFilter !== "all") {
      params.set("model_key", galleryModelFilter);
    }

    try {
      const response = await fetch(`/api/control/media-assets?${params.toString()}`, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      const payload = (await response.json()) as AssetPagePayload;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Unable to load media assets from the dashboard.");
      }
      return payload;
    } catch (error) {
      if (!silent) {
        setFormMessage({
          tone: "danger",
          text: error instanceof Error ? error.message : "The dashboard could not load more media assets.",
        });
      }
      return null;
    }
  }

  function applyLoadedAssetPage(page: AssetPagePayload) {
    const pageAssets = page.assets ?? [];
    setLocalAssets((current) => mergeAssetCollections(current, pageAssets));
    setAssetFeedHasMore(Boolean(page.has_more));
    setAssetFeedNextOffset(page.next_offset ?? null);
    setPrefetchedAssetPage(null);
  }

  function applyLoadedFavoriteAssetPage(page: AssetPagePayload) {
    const pageAssets = page.assets ?? [];
    setFavoriteAssets((current) => mergeAssetCollections(current ?? [], pageAssets));
    setFavoriteAssetFeedHasMore(Boolean(page.has_more));
    setFavoriteAssetFeedNextOffset(page.next_offset ?? null);
    setPrefetchedFavoriteAssetPage(null);
  }

  async function loadMoreGalleryAssets() {
    if (favoritesOnly || loadingMoreAssets || !assetFeedHasMore || assetFeedNextOffset == null) {
      return;
    }
    setLoadingMoreAssets(true);
    try {
      if (prefetchedAssetPage && prefetchedAssetPage.offset === assetFeedNextOffset) {
        applyLoadedAssetPage(prefetchedAssetPage);
        return;
      }
      const page = await fetchAssetPage({ offset: assetFeedNextOffset, limitOverride: ASSET_APPEND_BATCH_SIZE });
      if (!page) {
        return;
      }
      applyLoadedAssetPage(page);
    } finally {
      setLoadingMoreAssets(false);
    }
  }

  async function loadMoreFavoriteGalleryAssets() {
    if (
      !favoritesOnly ||
      loadingMoreFavoriteAssets ||
      !favoriteAssetFeedHasMore ||
      favoriteAssetFeedNextOffset == null
    ) {
      return;
    }
    setLoadingMoreFavoriteAssets(true);
    try {
      if (prefetchedFavoriteAssetPage && prefetchedFavoriteAssetPage.offset === favoriteAssetFeedNextOffset) {
        applyLoadedFavoriteAssetPage(prefetchedFavoriteAssetPage);
        return;
      }
      const page = await fetchAssetPage({
        offset: favoriteAssetFeedNextOffset,
        favorited: true,
        limitOverride: ASSET_APPEND_BATCH_SIZE,
      });
      if (!page) {
        return;
      }
      applyLoadedFavoriteAssetPage(page);
    } finally {
      setLoadingMoreFavoriteAssets(false);
    }
  }

  loadMoreAssetsRef.current = () => {
    if (favoritesOnly) {
      void loadMoreFavoriteGalleryAssets();
      return;
    }
    void loadMoreGalleryAssets();
  };

  useEffect(() => {
    setLocalJobs(jobs);
  }, [jobs]);

  useEffect(() => {
    setLocalBatches(batches);
  }, [batches]);

  useEffect(() => {
    setOutputCount((current) => Math.min(Math.max(1, current), modelMaxOutputs));
  }, [modelMaxOutputs]);

  useEffect(() => {
    setLocalAssets((current) => reconcileAssetCollections(assets, current));
    setAssetPageLimit(Math.max(initialAssetLimit, INITIAL_ASSET_PAGE_SIZE));
    setAssetFeedHasMore((current) => current || initialAssetsHasMore);
    setAssetFeedNextOffset((current) => {
      if (current == null) {
        return initialAssetsNextOffset;
      }
      if (initialAssetsNextOffset == null) {
        return current;
      }
      return Math.max(current, initialAssetsNextOffset);
    });
    setPrefetchedAssetPage(null);
    setFavoriteAssetFeedHasMore(false);
    setFavoriteAssetFeedNextOffset(null);
    setPrefetchedFavoriteAssetPage(null);
  }, [assets, initialAssetLimit, initialAssetsHasMore, initialAssetsNextOffset]);

  useEffect(() => {
    if (favoritesOnly) {
      return;
    }
    let cancelled = false;
    setPrefetchedAssetPage(null);
    void fetchAssetPage({ offset: 0, limitOverride: INITIAL_ASSET_PAGE_SIZE, silent: true })
      .then((payload) => {
        if (cancelled || !payload) {
          return;
        }
        setLocalAssets(payload.assets ?? []);
        setAssetFeedHasMore(Boolean(payload.has_more));
        setAssetFeedNextOffset(payload.next_offset ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [favoritesOnly, galleryKindFilter, galleryModelFilter]);

  useEffect(() => {
    setLocalLatestAsset(latestAsset);
  }, [latestAsset]);

  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 16) {
        setGalleryScrollArmed(true);
      }
    };
    const armFromGesture = () => {
      setGalleryScrollArmed(true);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("touchmove", armFromGesture, { passive: true });
    window.addEventListener("wheel", armFromGesture, { passive: true });
    handleScroll();
    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("touchmove", armFromGesture);
      window.removeEventListener("wheel", armFromGesture);
    };
  }, []);

  useEffect(() => {
    if (
      !activeGalleryHasMore ||
      !galleryScrollArmed ||
      activeGalleryLoadingMore ||
      !galleryLoadMoreRef.current
    ) {
      return;
    }
    const target = galleryLoadMoreRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadMoreAssetsRef.current();
        }
      },
      { rootMargin: "360px 0px 360px 0px" },
    );
    observer.observe(target);
    const maybeLoadMore = () => {
      const scrollBottom = window.innerHeight + window.scrollY;
      const documentHeight = Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight,
      );
      if (documentHeight - scrollBottom <= 520) {
        loadMoreAssetsRef.current();
      }
    };
    window.setTimeout(maybeLoadMore, 0);
    return () => observer.disconnect();
  }, [
    activeGalleryHasMore,
    favoritesOnly,
    galleryScrollArmed,
    activeGalleryLoadingMore,
    prefetchingAssetPage,
    prefetchingFavoriteAssetPage,
    assetFeedNextOffset,
    favoriteAssetFeedNextOffset,
    prefetchedAssetPage,
    prefetchedFavoriteAssetPage,
    galleryTiles.length,
  ]);

  useEffect(() => {
    if (!selectedAssetId) {
      setSelectedAssetHydratedJob(null);
      setMobileInspectorPromptOpen(false);
      setMobileInspectorInfoOpen(false);
      return;
    }
    setMobileInspectorPromptOpen(true);
    setMobileInspectorInfoOpen(false);
  }, [selectedAssetId]);

  useEffect(() => {
    if (!selectedAsset?.job_id) {
      setSelectedAssetHydratedJob(null);
      return;
    }
    if (selectedAssetCachedJob?.job_id === selectedAsset.job_id) {
      setSelectedAssetHydratedJob(null);
      return;
    }
    let cancelled = false;
    void fetch(`/api/control/media-jobs/${selectedAsset.job_id}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = (await response.json()) as { ok?: boolean; job?: MediaJob | null };
        if (!response.ok || !payload.ok || !payload.job || cancelled) {
          return;
        }
        setSelectedAssetHydratedJob(payload.job);
        setLocalJobs((current) => [payload.job as MediaJob, ...current.filter((job) => job.job_id !== payload.job?.job_id)].slice(0, 24));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [selectedAsset?.asset_id, selectedAsset?.job_id, selectedAssetCachedJob?.job_id]);

  const lockingOverlayOpen = Boolean(selectedAssetId) || studioSettingsOpen || selectedMediaLightboxOpen;

  useEffect(() => {
    if (!lockingOverlayOpen) {
      return;
    }
    const scrollY = window.scrollY;
    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyPosition = document.body.style.position;
    const previousBodyTop = document.body.style.top;
    const previousBodyLeft = document.body.style.left;
    const previousBodyRight = document.body.style.right;
    const previousBodyWidth = document.body.style.width;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousHtmlOverscroll = document.documentElement.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
    document.documentElement.style.overflow = "hidden";
    document.documentElement.style.overscrollBehavior = "none";
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.position = previousBodyPosition;
      document.body.style.top = previousBodyTop;
      document.body.style.left = previousBodyLeft;
      document.body.style.right = previousBodyRight;
      document.body.style.width = previousBodyWidth;
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.documentElement.style.overscrollBehavior = previousHtmlOverscroll;
      window.scrollTo(0, scrollY);
    };
  }, [lockingOverlayOpen]);

  useEffect(() => {
    if (!favoritesOnly) {
      setFavoriteAssets(null);
      setFavoriteAssetFeedHasMore(false);
      setFavoriteAssetFeedNextOffset(null);
      setPrefetchedFavoriteAssetPage(null);
      return;
    }
    let cancelled = false;
    setFavoritesLoading(true);
    void fetchAssetPage({ offset: 0, favorited: true, limitOverride: INITIAL_ASSET_PAGE_SIZE })
      .then((payload) => {
        if (cancelled) {
          return;
        }
        if (!payload) {
          return;
        }
        setFavoriteAssets(payload.assets ?? []);
        setFavoriteAssetFeedHasMore(Boolean(payload.has_more));
        setFavoriteAssetFeedNextOffset(payload.next_offset ?? null);
        setPrefetchedFavoriteAssetPage(null);
      })
      .finally(() => {
        if (!cancelled) {
          setFavoritesLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [favoritesOnly, galleryKindFilter, galleryModelFilter]);

  useEffect(() => {
    if (favoritesOnly || !assetFeedHasMore || assetFeedNextOffset == null || loadingMoreAssets || prefetchingAssetPage || prefetchedAssetPage) {
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setPrefetchingAssetPage(true);
      void fetchAssetPage({ offset: assetFeedNextOffset, limitOverride: ASSET_APPEND_BATCH_SIZE, silent: true })
        .then((page) => {
          if (cancelled || !page) {
            return;
          }
          prefetchAssetThumbs(page.assets ?? [], prefetchedThumbUrlsRef.current);
          const scrollBottom = window.innerHeight + window.scrollY;
          const documentHeight = Math.max(
            document.body.scrollHeight,
            document.documentElement.scrollHeight,
          );
          if (documentHeight - scrollBottom <= 520) {
            applyLoadedAssetPage(page);
            return;
          }
          setPrefetchedAssetPage(page);
        })
        .finally(() => {
          if (!cancelled) {
            setPrefetchingAssetPage(false);
          }
        });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [assetFeedHasMore, assetFeedNextOffset, favoritesOnly, loadingMoreAssets, prefetchingAssetPage, prefetchedAssetPage, assetPageLimit]);

  useEffect(() => {
    if (
      !favoritesOnly ||
      !favoriteAssetFeedHasMore ||
      favoriteAssetFeedNextOffset == null ||
      loadingMoreFavoriteAssets ||
      prefetchingFavoriteAssetPage ||
      prefetchedFavoriteAssetPage
    ) {
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setPrefetchingFavoriteAssetPage(true);
      void fetchAssetPage({
        offset: favoriteAssetFeedNextOffset,
        favorited: true,
        limitOverride: ASSET_APPEND_BATCH_SIZE,
        silent: true,
      })
        .then((page) => {
          if (cancelled || !page) {
            return;
          }
          prefetchAssetThumbs(page.assets ?? [], prefetchedThumbUrlsRef.current);
          const scrollBottom = window.innerHeight + window.scrollY;
          const documentHeight = Math.max(
            document.body.scrollHeight,
            document.documentElement.scrollHeight,
          );
          if (documentHeight - scrollBottom <= 520) {
            applyLoadedFavoriteAssetPage(page);
            return;
          }
          setPrefetchedFavoriteAssetPage(page);
        })
        .finally(() => {
          if (!cancelled) {
            setPrefetchingFavoriteAssetPage(false);
          }
        });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    favoritesOnly,
    favoriteAssetFeedHasMore,
    favoriteAssetFeedNextOffset,
    loadingMoreFavoriteAssets,
    prefetchingFavoriteAssetPage,
    prefetchedFavoriteAssetPage,
    galleryKindFilter,
    galleryModelFilter,
  ]);

  useEffect(() => {
    setOptionValues(
      buildNormalizedStudioOptions(currentModel, {}, isRecord(currentPreset?.default_options_json) ? currentPreset.default_options_json : null),
    );
  }, [currentModel, currentPreset]);

  useEffect(() => {
    const nextValues: Record<string, string> = {};
    for (const field of structuredPresetTextFields) {
      nextValues[field.key] = field.defaultValue ?? "";
    }
    setPresetInputValues(nextValues);
    setPresetSlotStates((current) => {
      for (const state of Object.values(current)) {
        if (state?.previewUrl) {
          URL.revokeObjectURL(state.previewUrl);
        }
      }
      return {};
    });
  }, [currentPreset?.preset_id, structuredPresetTextFields]);

  useEffect(() => {
    return () => {
      for (const attachment of attachments) {
        if (attachment.previewUrl) {
          URL.revokeObjectURL(attachment.previewUrl);
        }
      }
      for (const state of Object.values(presetSlotStates)) {
        if (state?.previewUrl) {
          URL.revokeObjectURL(state.previewUrl);
        }
      }
    };
  }, [attachments, presetSlotStates]);

  useEffect(() => {
    function closePicker(event: MouseEvent) {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("[data-studio-picker]")) {
        return;
      }
      setOpenPicker(null);
    }

    window.addEventListener("mousedown", closePicker);
    return () => window.removeEventListener("mousedown", closePicker);
  }, []);

  useEffect(() => {
    return () => {
      if (autoValidateTimerRef.current) {
        window.clearTimeout(autoValidateTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setOutputCount((current) => Math.min(Math.max(1, current), modelMaxOutputs));
  }, [modelMaxOutputs]);

  useEffect(() => {
    const sourceKind = currentSourceAsset?.generation_kind ?? null;
    if ((sourceKind === "image" && maxImageInputs <= 0) || (sourceKind === "video" && maxVideoInputs <= 0)) {
      setSourceAssetId(null);
    }

    setAttachments((current) => {
      let remainingImages = Math.max(
        0,
        maxImageInputs - (sourceKind === "image" && maxImageInputs > 0 ? 1 : 0),
      );
      let remainingVideos = Math.max(
        0,
        maxVideoInputs - (sourceKind === "video" && maxVideoInputs > 0 ? 1 : 0),
      );
      let remainingAudios = Math.max(0, maxAudioInputs);
      let changed = false;
      const next: AttachmentRecord[] = [];

      for (const attachment of current) {
        if (attachment.kind === "images") {
          if (remainingImages <= 0) {
            changed = true;
            if (attachment.previewUrl) {
              URL.revokeObjectURL(attachment.previewUrl);
            }
            continue;
          }
          remainingImages -= 1;
        } else if (attachment.kind === "videos") {
          if (remainingVideos <= 0) {
            changed = true;
            if (attachment.previewUrl) {
              URL.revokeObjectURL(attachment.previewUrl);
            }
            continue;
          }
          remainingVideos -= 1;
        } else {
          if (remainingAudios <= 0) {
            changed = true;
            continue;
          }
          remainingAudios -= 1;
        }
        next.push(attachment);
      }

      return changed ? next : current;
    });
  }, [currentSourceAsset, maxAudioInputs, maxImageInputs, maxVideoInputs]);

  function updateOption(optionKey: string, value: unknown) {
    setOptionValues((current) => ({ ...current, [optionKey]: value }));
  }

  function refreshStudioDataWithSettleDelay() {
    startRefresh(() => router.refresh());
    window.setTimeout(() => {
      startRefresh(() => router.refresh());
    }, 1400);
  }

  function addFiles(fileList: FileList | File[] | null) {
    const incomingFiles = Array.from(fileList ?? []);
    if (!incomingFiles.length) {
      return;
    }

    let remainingImageCapacity = Math.max(0, maxImageInputs - stagedImageCount);
    let remainingVideoCapacity = Math.max(0, maxVideoInputs - stagedVideoCount);
    let remainingAudioCapacity = Math.max(0, maxAudioInputs - stagedAudioCount);
    const acceptedFiles: File[] = [];
    const rejectedKinds = new Set<string>();

    for (const file of incomingFiles) {
      const kind = classifyFile(file);
      if (kind === "images") {
        if (remainingImageCapacity <= 0) {
          rejectedKinds.add("images");
          continue;
        }
        remainingImageCapacity -= 1;
        acceptedFiles.push(file);
        continue;
      }
      if (kind === "videos") {
        if (remainingVideoCapacity <= 0) {
          rejectedKinds.add("videos");
          continue;
        }
        remainingVideoCapacity -= 1;
        acceptedFiles.push(file);
        continue;
      }
      if (remainingAudioCapacity <= 0) {
        rejectedKinds.add("audios");
        continue;
      }
      remainingAudioCapacity -= 1;
      acceptedFiles.push(file);
    }

    if (!acceptedFiles.length) {
      if (rejectedKinds.size) {
        setFormMessage({
          tone: "warning",
          text: `This model cannot accept more ${Array.from(rejectedKinds).join(", ")} right now.`,
        });
      }
      return;
    }

    const nextAttachments = acceptedFiles.map((file) => ({
      id: `${file.name}-${file.size}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
      file,
      kind: classifyFile(file),
      previewUrl: file.type.startsWith("image/") || file.type.startsWith("video/") ? URL.createObjectURL(file) : null,
    }));

    setAttachments((current) => [...current, ...nextAttachments]);

    const existingImageCount = imageAttachments.length + (sourceAssetIsImage ? 1 : 0);
    const imageReferenceTokens = nextAttachments
      .filter((attachment) => attachment.kind === "images")
      .map((_, index) => `[image reference ${existingImageCount + index + 1}]`);

    if (imageReferenceTokens.length && isNanoPresetModel(modelKey)) {
      insertPromptSnippet(imageReferenceTokens.join(" "));
    }

    if (rejectedKinds.size) {
      setFormMessage({
        tone: "warning",
        text: `Accepted what fit and skipped extra ${Array.from(rejectedKinds).join(", ")} beyond this model's limit.`,
      });
    }
  }

  async function addGalleryAssetAsAttachment(asset: MediaAsset | null) {
    if (!asset || asset.generation_kind !== "image") {
      setFormMessage({ tone: "danger", text: "Only image cards can be staged in image slots." });
      return;
    }
    const assetUrl = mediaInlineUrl(asset) ?? mediaDownloadUrl(asset);
    if (!assetUrl) {
      setFormMessage({ tone: "danger", text: "The selected gallery image could not be loaded." });
      return;
    }
    try {
      const response = await fetch(assetUrl, { credentials: "same-origin" });
      if (!response.ok) {
        throw new Error("Unable to fetch gallery image.");
      }
      const blob = await response.blob();
      const file = new File([blob], mediaDownloadName(asset), {
        type: blob.type || "image/png",
      });
      addFiles([file]);
    } catch {
      setFormMessage({ tone: "danger", text: "The selected gallery image could not be staged in that slot." });
    }
  }

  function assignPresetSlotFile(slotKey: string, file: File | null) {
    setPresetSlotStates((current) => {
      const previous = current[slotKey];
      if (previous?.previewUrl) {
        URL.revokeObjectURL(previous.previewUrl);
      }
      if (!file) {
        return { ...current, [slotKey]: { assetId: null, file: null, previewUrl: null } };
      }
      return {
        ...current,
        [slotKey]: {
          assetId: null,
          file,
          previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
        },
      };
    });
  }

  function assignPresetSlotAsset(slotKey: string, asset: MediaAsset | null) {
    if (!asset) {
      return;
    }
    if (asset.generation_kind !== "image") {
      setFormMessage({ tone: "danger", text: "Structured Nano Banana presets only accept image assets in image slots." });
      return;
    }
    setPresetSlotStates((current) => {
      const previous = current[slotKey];
      if (previous?.previewUrl) {
        URL.revokeObjectURL(previous.previewUrl);
      }
      return {
        ...current,
        [slotKey]: {
          assetId: asset.asset_id,
          file: null,
          previewUrl: mediaThumbnailUrl(asset) ?? mediaDisplayUrl(asset),
        },
      };
    });
  }

  function clearPresetSlot(slotKey: string) {
    setPresetSlotStates((current) => {
      const previous = current[slotKey];
      if (previous?.previewUrl && previous.file) {
        URL.revokeObjectURL(previous.previewUrl);
      }
      return {
        ...current,
        [slotKey]: { assetId: null, file: null, previewUrl: null },
      };
    });
  }

  function insertPromptSnippet(snippet: string) {
    const input = promptInputRef.current;

    if (!input) {
      setPrompt((current) => `${current}${current.trim() ? " " : ""}${snippet}`);
      return;
    }

    const start = input.selectionStart ?? prompt.length;
    const end = input.selectionEnd ?? prompt.length;
    const spacerBefore = start > 0 && !/\s$/.test(prompt.slice(0, start)) ? " " : "";
    const spacerAfter = end < prompt.length && !/^\s/.test(prompt.slice(end)) ? " " : "";
    const insertion = `${spacerBefore}${snippet}${spacerAfter}`;
    const nextPrompt = `${prompt.slice(0, start)}${insertion}${prompt.slice(end)}`;
    setPrompt(nextPrompt);

    window.setTimeout(() => {
      input.focus();
      const cursor = start + insertion.length;
      input.setSelectionRange(cursor, cursor);
    }, 0);
  }

  function handleSourceTileDrop(event: React.DragEvent<HTMLLabelElement>, slotIndex = 0) {
    event.preventDefault();
    setIsDragActive(false);
    const galleryAssetId = event.dataTransfer.getData("application/x-bumblebee-media-asset-id");
    if (galleryAssetId) {
      const asset = findMediaAssetById(galleryAssetId, localAssets, favoriteAssets) ?? null;
      if (!asset) {
        setFormMessage({ tone: "danger", text: "The dragged gallery asset could not be found." });
        return;
      }
      if (asset.generation_kind !== "image") {
        setFormMessage({ tone: "danger", text: "Only image cards can be staged as source media." });
        return;
      }
      if (slotIndex > orderedImageInputs.length) {
        setFormMessage({ tone: "warning", text: "Fill the earlier image slot first." });
        return;
      }
      if (slotIndex === 0) {
        useAssetAsSource(asset, false);
        return;
      }
      void addGalleryAssetAsAttachment(asset);
      return;
    }
    addFiles(event.dataTransfer.files);
  }

  function handlePresetSlotDrop(event: React.DragEvent<HTMLLabelElement>, slotKey: string) {
    event.preventDefault();
    const galleryAssetId = event.dataTransfer.getData("application/x-bumblebee-media-asset-id");
    if (galleryAssetId) {
      const asset = findMediaAssetById(galleryAssetId, localAssets, favoriteAssets) ?? null;
      assignPresetSlotAsset(slotKey, asset);
      return;
    }
    const droppedFile = Array.from(event.dataTransfer.files).find((file) => file.type.startsWith("image/")) ?? null;
    assignPresetSlotFile(slotKey, droppedFile);
  }

  function handleGalleryAssetDragStart(event: React.DragEvent<HTMLDivElement>, asset: MediaAsset | null) {
    if (!asset || asset.generation_kind !== "image") {
      event.preventDefault();
      return;
    }
    event.dataTransfer.setData("application/x-bumblebee-media-asset-id", String(asset.asset_id));
    event.dataTransfer.effectAllowed = "copy";
    const preview = mediaThumbnailUrl(asset);
    if (preview && typeof document !== "undefined") {
      const dragImage = document.createElement("div");
      dragImage.style.width = "72px";
      dragImage.style.height = "72px";
      dragImage.style.borderRadius = "18px";
      dragImage.style.border = "1px solid rgba(255,255,255,0.14)";
      dragImage.style.background = `center / cover no-repeat url("${preview}")`;
      dragImage.style.boxShadow = "0 14px 30px rgba(0,0,0,0.28)";
      dragImage.style.position = "fixed";
      dragImage.style.top = "-9999px";
      dragImage.style.left = "-9999px";
      dragImage.style.pointerEvents = "none";
      document.body.appendChild(dragImage);
      event.dataTransfer.setDragImage(dragImage, 36, 36);
      window.setTimeout(() => {
        dragImage.remove();
      }, 0);
    }
  }

  function removeAttachment(attachmentId: string) {
    setAttachments((current) => {
      const match = current.find((attachment) => attachment.id === attachmentId);
      if (match?.previewUrl) {
        URL.revokeObjectURL(match.previewUrl);
      }
      return current.filter((attachment) => attachment.id !== attachmentId);
    });
  }

  function clearComposer() {
    for (const attachment of attachments) {
      if (attachment.previewUrl) {
        URL.revokeObjectURL(attachment.previewUrl);
      }
    }
    setAttachments([]);
    setPresetSlotStates((current) => {
      for (const state of Object.values(current)) {
        if (state?.previewUrl && state.file) {
          URL.revokeObjectURL(state.previewUrl);
        }
      }
      return {};
    });
    setPresetInputValues({});
    setSourceAssetId(null);
    setPrompt("");
    setSelectedPresetId("");
    setSelectedPromptIds([]);
    setModelKey(models[0]?.key ?? "nano-banana-2");
    setOutputCount(1);
    setValidation(null);
    setFormMessage(null);
    setEnhanceDialogOpen(false);
    setEnhancePreview(null);
    setEnhanceError(null);
    setOpenPicker(null);
  }

  function togglePrompt(promptId: string) {
    setSelectedPromptIds((current) =>
      current.includes(promptId) ? current.filter((value) => value !== promptId) : [...current, promptId],
    );
  }

  function buildMediaFormData(intent: "validate" | "submit" | "enhance") {
    const formData = new FormData();
    const normalizedOptions = buildNormalizedStudioOptions(
      currentModel,
      optionValues,
      isRecord(currentPreset?.default_options_json) ? currentPreset.default_options_json : null,
    );
    const sanitizedOptions = stripUnsupportedStudioOptions(modelKey, inferredInputPattern, normalizedOptions);
    const effectivePrompt = structuredPresetActive ? structuredPresetPromptPreview : prompt;
    formData.set("intent", intent);
    formData.set("model_key", modelKey);
    formData.set("prompt", effectivePrompt);
    formData.set("output_count", String(outputCount));
    formData.set("enhance", intent === "enhance" ? "true" : "false");
    formData.set("options", JSON.stringify(sanitizedOptions));
    formData.set("system_prompt_ids", JSON.stringify(selectedPromptIds));
    if (multiShotsEnabled && multiShotScript.shots.length) {
      formData.set("multi_prompt", JSON.stringify(multiShotScript.shots));
    }
    if (selectedPresetId) {
      const selectedPreset = presets.find((preset) => preset.preset_id === selectedPresetId || preset.key === selectedPresetId);
      if (selectedPreset?.source_kind === "builtin") {
        formData.set("preset_key", selectedPreset.key);
      } else {
        formData.set("preset_id", selectedPresetId);
      }
    }
    if (structuredPresetActive) {
      formData.set("preset_inputs_json", JSON.stringify(presetInputValues));
      const presetSlotValues: Record<string, Array<Record<string, unknown>>> = {};
      for (const slot of structuredPresetImageSlots) {
        const slotState = presetSlotStates[slot.key];
        if (!slotState) {
          continue;
        }
        if (slotState.assetId) {
          presetSlotValues[slot.key] = [{ asset_id: slotState.assetId }];
          formData.set(`preset_slot_asset:${slot.key}`, String(slotState.assetId));
        }
        if (slotState.file) {
          formData.append(`preset_slot_file:${slot.key}`, slotState.file);
        }
      }
      formData.set("preset_slot_values_json", JSON.stringify(presetSlotValues));
    }
    if (!structuredPresetActive && sourceAssetId) {
      formData.set("source_asset_id", String(sourceAssetId));
    }
    if (!structuredPresetActive) {
      for (const attachment of attachments) {
        formData.append("attachments", attachment.file);
      }
    }
    return formData;
  }

  async function requestEnhancementPreview() {
    if (
      !modelKey ||
      (!structuredPresetActive && !prompt.trim() && !attachments.length && !sourceAssetId) ||
      (structuredPresetActive && !structuredPresetPromptPreview.trim())
    ) {
      setEnhanceDialogOpen(true);
      setEnhancePreview(null);
      setEnhanceError("Add a prompt or source media before enhancing.");
      return;
    }

    if (multiShotScriptError) {
      setEnhanceDialogOpen(true);
      setEnhancePreview(null);
      setEnhanceError(multiShotScriptError);
      return;
    }

    if (presetRequirementError) {
      setEnhanceDialogOpen(true);
      setEnhancePreview(null);
      setEnhanceError(presetRequirementError);
      return;
    }

    setEnhanceDialogOpen(true);
    setEnhanceBusy(true);
    setEnhanceError(null);
    showActivity({
      tone: "warning",
      message: "Loading the enhancement preview.",
      spinning: true,
    });

    try {
      const response = await fetch("/api/control/media-enhance", {
        method: "POST",
        body: buildMediaFormData("enhance"),
      });
      const payload = (await response.json()) as
        | { ok: false; error?: string }
        | { ok: true; preview?: MediaEnhancePreviewResponse };

      if (!response.ok || !payload.ok) {
        const errorMessage =
          "error" in payload ? payload.error ?? "Unable to enhance the prompt." : "Unable to enhance the prompt.";
        setEnhancePreview(null);
        setEnhanceError(errorMessage);
        showActivity({ tone: "danger", message: errorMessage }, { autoHideMs: 4200 });
        return;
      }

      setEnhancePreview(payload.preview ?? null);
      showActivity({ tone: "healthy", message: "Enhancement preview ready." }, { autoHideMs: 2200 });
    } catch {
      setEnhancePreview(null);
      const errorMessage = "The dashboard could not reach the enhance preview route.";
      setEnhanceError(errorMessage);
      showActivity({ tone: "danger", message: errorMessage }, { autoHideMs: 4200 });
    } finally {
      setEnhanceBusy(false);
    }
  }

  function openEnhanceDialog() {
    setEnhanceDialogOpen(true);
    setEnhanceError(null);
    setEnhancePreview(null);
  }

  async function requestValidation({ silent = false }: { silent?: boolean } = {}) {
    if (autoValidateTimerRef.current) {
      window.clearTimeout(autoValidateTimerRef.current);
      autoValidateTimerRef.current = null;
    }
    if (
      !modelKey ||
      (!structuredPresetActive && !prompt.trim() && !attachments.length && !sourceAssetId) ||
      (structuredPresetActive && !structuredPresetPromptPreview.trim())
    ) {
      setValidation(null);
      return null;
    }

    if (multiShotScriptError) {
      setValidation(null);
      if (!silent) {
        setFormMessage({ tone: "danger", text: multiShotScriptError });
      }
      return null;
    }

    if (presetRequirementError) {
      setValidation(null);
      if (!silent) {
        setFormMessage({ tone: "danger", text: presetRequirementError });
      }
      return null;
    }

    const requestId = validationRequestIdRef.current + 1;
    validationRequestIdRef.current = requestId;

    if (!silent) {
      setBusyState("validate");
      setFormMessage(null);
    }

    try {
      const response = await fetch("/api/control/media", {
        method: "POST",
        body: buildMediaFormData("validate"),
      });
      const payload = (await response.json()) as
        | { ok: false; error?: string }
        | { ok: true; validation?: MediaValidationResponse; success?: string; jobId?: string | null; batchId?: string | null; job?: MediaJob | null; batch?: MediaBatch | null };

      if (requestId !== validationRequestIdRef.current) {
        return null;
      }

      if (!response.ok || !payload.ok) {
        if (!silent) {
          setFormMessage({
            tone: "danger",
            text: "error" in payload ? payload.error ?? "Media request failed." : "Media request failed.",
          });
        }
        return null;
      }

      setValidation(payload.validation ?? null);
      if (!silent) {
        setFormMessage({ tone: "healthy", text: payload.success ?? "Preflight looks good." });
      }
      return payload.validation ?? null;
    } catch {
      if (!silent) {
        setFormMessage({ tone: "danger", text: "The dashboard could not reach the media route." });
      }
      return null;
    } finally {
      if (!silent) {
        setBusyState("idle");
      }
    }
  }

  async function submitMedia(intent: "validate" | "submit") {
    if (intent === "validate") {
      await requestValidation({ silent: false });
      return;
    }

    showActivity(
      {
        tone: "warning",
        message: validationReady ? "Submitting the media job." : "Checking the media request.",
        spinning: true,
      },
      { autoHideMs: 2200 },
    );

    if (!validationReady) {
      const nextValidation = await requestValidation({ silent: false });
      if (!studioValidationReady(nextValidation)) {
        return;
      }
    }

    if (multiShotScriptError) {
      setFormMessage({ tone: "danger", text: multiShotScriptError });
      return;
    }

    if (presetRequirementError) {
      setFormMessage({ tone: "danger", text: presetRequirementError });
      return;
    }

    const optimisticBatch =
      intent === "submit"
        ? createOptimisticBatch({
            modelKey,
            taskMode: typeof currentModel?.task_modes?.[0] === "string" ? currentModel.task_modes[0] : null,
            requestedOutputs: Math.max(1, outputCount),
            sourceAssetId,
            requestedPresetKey: currentPreset?.key ?? null,
            promptSummary: ((structuredPresetActive ? structuredPresetPromptPreview : prompt).trim() || "Preparing media generation.").slice(0, 240),
            runningSlotsAvailable: Math.max(
              0,
              maxConcurrentJobs -
                localBatches.reduce(
                  (sum, batch) =>
                    sum +
                    (batch.jobs ?? []).filter((job) => ["submitted", "running", "processing"].includes(job.status)).length,
                  0,
                ),
            ),
          })
        : null;
    if (optimisticBatch) {
      setOptimisticBatches((current) => [optimisticBatch, ...current].slice(0, 6));
      showActivity({ tone: "warning", message: "Submitting the media job.", spinning: true });
    }

    setBusyState(intent);
    setFormMessage(null);

    try {
      const response = await fetch("/api/control/media", {
        method: "POST",
        body: buildMediaFormData(intent),
      });
      const payload = (await response.json()) as
        | { ok: false; error?: string }
        | {
            ok: true;
            validation?: MediaValidationResponse;
            success?: string;
            jobId?: string | null;
            batchId?: string | null;
            job?: MediaJob | null;
            batch?: MediaBatch | null;
          };

      if (!response.ok || !payload.ok) {
        if (optimisticBatch) {
          setOptimisticBatches((current) => current.filter((batch) => batch.batch_id !== optimisticBatch.batch_id));
        }
        setFormMessage({
          tone: "danger",
          text: "error" in payload ? payload.error ?? "Media request failed." : "Media request failed.",
        });
        showActivity(
          {
            tone: "danger",
            message: "error" in payload ? payload.error ?? "Media request failed." : "Media request failed.",
          },
          { autoHideMs: 3200 },
        );
        return;
      }

      setValidation(null);
      if (optimisticBatch) {
        setOptimisticBatches((current) => current.filter((batch) => batch.batch_id !== optimisticBatch.batch_id));
      }
      if (payload.job) {
        setLocalJobs((current) => [payload.job as MediaJob, ...current.filter((job) => job.job_id !== payload.job?.job_id)].slice(0, 12));
      }
      if (payload.batch) {
        const batch = payload.batch as MediaBatch;
        setLocalBatches((current) => upsertBatchCollection(current, batch));
        if (Array.isArray(batch.jobs) && batch.jobs.length) {
          setLocalJobs((current) => {
            const byId = new Map(current.map((job) => [job.job_id, job]));
            for (const job of batch.jobs ?? []) {
              byId.set(job.job_id, job);
            }
            return Array.from(byId.values()).sort((left, right) => right.created_at.localeCompare(left.created_at)).slice(0, 24);
          });
        }
      }
      setFormMessage({ tone: "warning", text: payload.success ?? "Media job queued." });
      showActivity({ tone: "healthy", message: payload.success ?? "Media job queued." }, { autoHideMs: 2200 });
      if (payload.batchId) {
        void pollBatch(payload.batchId);
      } else if (payload.jobId) {
        void pollJob(payload.jobId);
      }
    } catch {
      if (optimisticBatch) {
        setOptimisticBatches((current) => current.filter((batch) => batch.batch_id !== optimisticBatch.batch_id));
      }
      setFormMessage({ tone: "danger", text: "The dashboard could not reach the media route." });
      showActivity({ tone: "danger", message: "The dashboard could not reach the media route." }, { autoHideMs: 3200 });
    } finally {
      setBusyState("idle");
    }
  }

  useEffect(() => {
    if (busyState !== "idle") {
      return;
    }
    setValidation(null);
    if (autoValidateTimerRef.current) {
      window.clearTimeout(autoValidateTimerRef.current);
    }
    autoValidateTimerRef.current = window.setTimeout(() => {
      void requestValidation({ silent: true });
    }, 180);
    return () => {
      if (autoValidateTimerRef.current) {
        window.clearTimeout(autoValidateTimerRef.current);
      }
    };
  }, [
    modelKey,
    prompt,
    optionSignature,
    selectedPresetId,
    selectedPromptSignature,
    sourceAssetId,
    attachmentSignature,
    structuredPresetActive,
    structuredPresetPromptPreview,
    JSON.stringify(presetInputValues),
    JSON.stringify(
      Object.fromEntries(
        Object.entries(presetSlotStates).map(([key, value]) => [key, value.assetId ?? value.file?.name ?? ""]),
      ),
    ),
  ]);

  async function pollJob(jobId: string) {
    try {
      const response = await fetch(`/api/control/media-jobs/${jobId}`, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string; job?: MediaJob; batch?: MediaBatch | null };
      if (!response.ok || !payload.ok || !payload.job) {
        setFormMessage({ tone: "danger", text: payload.error ?? "Unable to read the current media job state." });
        return;
      }

      setLocalJobs((current) => [payload.job as MediaJob, ...current.filter((job) => job.job_id !== payload.job?.job_id)].slice(0, 12));
      if (payload.batch) {
        setLocalBatches((current) => upsertBatchCollection(current, payload.batch as MediaBatch));
      }

      const inFlightMessage = jobPhaseMessage(payload.job);
      if (inFlightMessage) {
        setFormMessage({ tone: "warning", text: inFlightMessage });
      }

      if (payload.job.status === "completed" || payload.job.status === "failed") {
        refreshStudioDataWithSettleDelay();
        setFormMessage({
          tone: payload.job.status === "completed" ? "healthy" : "danger",
          text:
            payload.job.status === "completed"
              ? "Media job completed and the reel is refreshing."
              : payload.job.error ?? "Media job failed.",
        });
        return;
      }

      window.setTimeout(() => {
        void pollJob(jobId);
      }, 1800);
    } catch {
      setFormMessage({ tone: "danger", text: "The dashboard lost contact with the media job poller." });
    }
  }

  async function pollBatch(batchId: string) {
    try {
      const response = await fetch(`/api/control/media-batches/${batchId}`, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string; batch?: MediaBatch | null };
      if (!response.ok || !payload.ok || !payload.batch) {
        setFormMessage({ tone: "danger", text: payload.error ?? "Unable to read the current media batch state." });
        return;
      }

      const batch = payload.batch as MediaBatch;
      setLocalBatches((current) => upsertBatchCollection(current, batch));
      if (Array.isArray(batch.jobs) && batch.jobs.length) {
        setLocalJobs((current) => {
          const byId = new Map(current.map((job) => [job.job_id, job]));
          for (const job of batch.jobs ?? []) {
            byId.set(job.job_id, job);
          }
          return Array.from(byId.values()).sort((left, right) => right.created_at.localeCompare(left.created_at)).slice(0, 24);
        });
      }

      const inFlightMessage = batchPhaseMessage(batch);
      if (inFlightMessage) {
        setFormMessage({ tone: "warning", text: inFlightMessage });
      }

      if (["completed", "failed", "partial_failure", "cancelled"].includes(payload.batch.status)) {
        const failedJob = (batch.jobs ?? []).find((job) => job.status === "failed" && job.error);
        const batchFailureMessage =
          failedJob?.error ??
          (payload.batch.status === "cancelled" ? "Media batch was cancelled." : "Media batch finished with issues.");
        refreshStudioDataWithSettleDelay();
        setFormMessage({
          tone: payload.batch.status === "completed" ? "healthy" : "danger",
          text:
            payload.batch.status === "completed"
              ? "Media batch completed and the reel is refreshing."
              : batchFailureMessage,
        });
        return;
      }

      window.setTimeout(() => {
        void pollBatch(batchId);
      }, 1800);
    } catch {
      setFormMessage({ tone: "danger", text: "The dashboard lost contact with the media queue watcher." });
    }
  }

  async function retryJob(jobId: string) {
    setFormMessage(null);
    setBusyState("submit");

    try {
      const response = await fetch(`/api/control/media-jobs/${jobId}`, {
        method: "POST",
        headers: { Accept: "application/json" },
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string; job?: MediaJob | null; batch?: MediaBatch | null };

      if (!response.ok || !payload.ok || !payload.job) {
        setFormMessage({
          tone: "danger",
          text: payload.error ?? "Unable to retry the selected media job.",
        });
        return;
      }

      setLocalJobs((current) => [payload.job as MediaJob, ...current.filter((job) => job.job_id !== payload.job?.job_id)].slice(0, 12));
      if (payload.batch) {
        setLocalBatches((current) => upsertBatchCollection(current, payload.batch as MediaBatch));
      }
      setFormMessage({
        tone: "warning",
        text: "Retry queued through the Control API.",
      });
      if (payload.batch?.batch_id) {
        void pollBatch(payload.batch.batch_id);
      } else {
        void pollJob(payload.job.job_id);
      }
    } catch {
      setFormMessage({ tone: "danger", text: "The dashboard could not reach the retry route." });
    } finally {
      setBusyState("idle");
    }
  }

  async function dismissJob(jobId: string) {
    setFormMessage(null);
    try {
      const response = await fetch(`/api/control/media-jobs/${jobId}`, {
        method: "DELETE",
        headers: { Accept: "application/json" },
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string; job?: MediaJob | null };

      if (!response.ok || !payload.ok) {
        setFormMessage({
          tone: "danger",
          text: payload.error ?? "Unable to remove the selected media job from the dashboard.",
        });
        return;
      }

      setLocalJobs((current) => current.filter((job) => job.job_id !== jobId));
      setFormMessage({
        tone: "healthy",
        text: "Removed the failed media card from the dashboard.",
      });
      startRefresh(() => router.refresh());
    } catch {
      setFormMessage({ tone: "danger", text: "The dashboard could not reach the media remove route." });
    }
  }

  async function dismissAsset(assetId: string | number) {
    setFormMessage(null);
    try {
      const response = await fetch(`/api/control/media-assets/${assetId}`, {
        method: "DELETE",
        headers: { Accept: "application/json" },
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string; asset?: MediaAsset | null };

      if (!response.ok || !payload.ok) {
        setFormMessage({
          tone: "danger",
          text: payload.error ?? "Unable to remove the selected media asset from the dashboard.",
        });
        return;
      }

      setLocalAssets((current) => {
        const nextAssets = current.filter((asset) => asset.asset_id !== assetId);
        setFavoriteAssets((currentFavorites) =>
          currentFavorites ? currentFavorites.filter((asset) => asset.asset_id !== assetId) : currentFavorites,
        );
        setLocalLatestAsset((currentLatest) => {
          if (currentLatest?.asset_id === assetId) {
            return nextAssets[0] ?? null;
          }
          return currentLatest;
        });
        return nextAssets;
      });
      if (selectedAssetId === assetId) {
        setSelectedAssetId(null);
      }
      if (sourceAssetId === assetId) {
        setSourceAssetId(null);
      }
      setFormMessage({
        tone: "healthy",
        text: "Removed the media card from the dashboard.",
      });
      startRefresh(() => router.refresh());
    } catch {
      setFormMessage({ tone: "danger", text: "The dashboard could not reach the media asset remove route." });
    }
  }

  function mergeAssetIntoCollection(collection: MediaAsset[], updatedAsset: MediaAsset) {
    const existingIndex = collection.findIndex((asset) => asset.asset_id === updatedAsset.asset_id);
    if (existingIndex === -1) {
      return [updatedAsset, ...collection];
    }
    const nextCollection = [...collection];
    nextCollection[existingIndex] = updatedAsset;
    return nextCollection;
  }

  function applyFavoriteAssetUpdate(updatedAsset: MediaAsset) {
    setLocalAssets((current) => mergeAssetIntoCollection(current, updatedAsset));
    setLocalLatestAsset((currentLatest) =>
      currentLatest?.asset_id === updatedAsset.asset_id ? updatedAsset : currentLatest,
    );
    setFavoriteAssets((currentFavorites) => {
      if (!currentFavorites) {
        return currentFavorites;
      }
      if (updatedAsset.favorited) {
        return mergeAssetIntoCollection(currentFavorites, updatedAsset);
      }
      return currentFavorites.filter((asset) => asset.asset_id !== updatedAsset.asset_id);
    });
  }

  async function toggleAssetFavorite(asset: MediaAsset | null) {
    if (!asset || favoriteAssetIdBusy != null) {
      return;
    }
    setFavoriteAssetIdBusy(asset.asset_id);
    setFormMessage(null);

    try {
      const response = await fetch(`/api/control/media-assets/${asset.asset_id}`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ favorited: !asset.favorited }),
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string; asset?: MediaAsset | null };

      if (!response.ok || !payload.ok || !payload.asset) {
        setFormMessage({
          tone: "danger",
          text: payload.error ?? "Unable to update the favorite state for the selected media asset.",
        });
        return;
      }

      applyFavoriteAssetUpdate(payload.asset);
      setFormMessage({
        tone: "healthy",
        text: payload.asset.favorited ? "Saved the media asset to favorites." : "Removed the media asset from favorites.",
      });
    } catch {
      setFormMessage({ tone: "danger", text: "The dashboard could not reach the favorite route." });
    } finally {
      setFavoriteAssetIdBusy(null);
    }
  }

  function activateGalleryKindFilter(nextKind: GalleryKindFilter) {
    setFavoritesOnly(false);
    setGalleryKindFilter(nextKind);
  }

  function toggleFavoritesFilter() {
    setFavoritesOnly((current) => {
      const next = !current;
      if (next) {
        setGalleryKindFilter("all");
      }
      return next;
    });
  }

  async function copyPromptFromAsset(promptText: string | null) {
    if (!promptText || !navigator.clipboard) {
      return;
    }
    await navigator.clipboard.writeText(promptText);
    setFormMessage({ tone: "healthy", text: "Copied the selected asset prompt." });
  }

  function useAssetAsSource(asset: MediaAsset | null, animate = false) {
    if (!asset) {
      return;
    }
    if (structuredPresetActive && !animate && asset.generation_kind === "image" && structuredPresetImageSlots.length) {
      const nextSlot =
        structuredPresetImageSlots.find((slot) => {
          const slotState = presetSlotStates[slot.key];
          return !slotState?.assetId && !slotState?.file;
        }) ?? structuredPresetImageSlots[0];
      assignPresetSlotAsset(nextSlot.key, asset);
      setSelectedMediaLightboxOpen(false);
      setSelectedAssetId(null);
      setFormMessage({ tone: "warning", text: `${asset.prompt_summary ? "Image" : "Selected asset"} assigned to ${nextSlot.label}.` });
      return;
    }
    setSourceAssetId(asset.asset_id);
    if (animate && asset.generation_kind !== "video") {
      const currentModelSupportsAnimate = Boolean(
        currentModel?.generation_kind === "video" &&
          (currentModel?.task_modes?.includes("image_to_video") ||
            currentModel?.input_patterns?.includes("single_image") ||
            currentModel?.input_patterns?.includes("first_last_frames")),
      );
      if (!currentModelSupportsAnimate) {
        setModelKey("kling-2.6-i2v");
      }
    }
    setSelectedMediaLightboxOpen(false);
    // Desktop keeps the docked composer anchored to the viewport.
    setMobileComposerCollapsed(!isCoarsePointerDevice());
    setSelectedAssetId(null);
    setFormMessage({
      tone: "warning",
      text: animate
        ? "The selected image is now staged for the animate flow."
        : "The selected asset is now attached as a source reference.",
    });
  }

  async function closeSelectedMediaLightbox() {
    if (typeof document !== "undefined" && document.fullscreenElement && typeof document.exitFullscreen === "function") {
      try {
        await document.exitFullscreen();
      } catch {
        // ignore exit failures so the lightbox can still close
      }
    }
    setSelectedMediaLightboxOpen(false);
  }

  function openSelectedMediaLightbox() {
    if (!selectedAssetLightboxVisual) {
      return;
    }
    setSelectedMediaLightboxOpen(true);
  }

  async function handleAssetDownload(asset: MediaAsset | null) {
    if (!asset) {
      return;
    }

    const inlineUrl = mediaInlineUrl(asset);
    const downloadUrl = mediaDownloadUrl(asset) ?? inlineUrl;
    if (!downloadUrl) {
      return;
    }

    if (isLikelyMobileSaveDevice()) {
      const sourceUrl = new URL(inlineUrl ?? downloadUrl, window.location.origin).toString();
      const attachmentUrl = new URL(downloadUrl, window.location.origin).toString();
      try {
        const response = await fetch(attachmentUrl, { credentials: "same-origin" });
        if (!response.ok) {
          throw new Error("Download failed");
        }
        const originalBlob = await response.blob();
        const mimeType = inferBlobMimeType(asset, originalBlob);
        if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
          const shareFileName = mediaDownloadName(asset);
          try {
            const shareBlob = await getMobileShareBlob(new Blob([originalBlob], { type: mimeType }));
            const normalizedShareFileName =
              shareBlob.type === "image/jpeg" ? replaceFileExtension(shareFileName, "jpg") : shareFileName;
            const file = new File([shareBlob], normalizedShareFileName, {
              type: shareBlob.type || mimeType || "application/octet-stream",
            });
            const shareData: ShareData = { files: [file], title: normalizedShareFileName };
            if (typeof navigator.canShare !== "function" || navigator.canShare(shareData)) {
              await navigator.share(shareData);
              showActivity(
                { tone: "healthy", message: "Opened your device share sheet." },
                { autoHideMs: 2200 },
              );
              return;
            }
          } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") {
              return;
            }
          }
        }

        try {
          if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
            const urlShareData: ShareData = {
              title: mediaDownloadName(asset),
              url: isImageMimeType(mimeType) ? sourceUrl : attachmentUrl,
            };
            if (typeof navigator.canShare !== "function" || navigator.canShare(urlShareData)) {
              await navigator.share(urlShareData);
              showActivity(
                { tone: "healthy", message: "Opened your device share sheet." },
                { autoHideMs: 2200 },
              );
              return;
            }
          }
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }
        }

        const objectUrl = URL.createObjectURL(new Blob([originalBlob], { type: mimeType }));
        try {
          const anchor = document.createElement("a");
          anchor.href = objectUrl;
          anchor.download = mediaDownloadName(asset);
          anchor.rel = "noopener";
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
          showActivity(
            { tone: "healthy", message: "Opened the media save flow for your device." },
            { autoHideMs: 2600 },
          );
          return;
        } finally {
          window.setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
        }
      } catch {
        // Fall through to the generic mobile open behavior below.
      }

      const fallbackLooksLikeImage = /\.(png|jpe?g|webp|gif)$/i.test(mediaDownloadName(asset));
      const opened = window.open(fallbackLooksLikeImage ? sourceUrl : attachmentUrl, "_blank", "noopener,noreferrer");
      if (!opened) {
        window.location.assign(attachmentUrl);
      }
      showActivity(
        { tone: "healthy", message: "Opened the original media so your device can save or share it." },
        { autoHideMs: 2600 },
      );
      return;
    }

    const anchor = document.createElement("a");
    anchor.href = downloadUrl;
    anchor.download = mediaDownloadName(asset);
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  function resetInspector() {
    setSelectedMediaLightboxOpen(false);
    setSelectedAssetId(null);
  }

  return (
    <div className={immersive ? "min-h-dvh" : "space-y-7"}>
      <div
        id="create"
        className={cn(
          "overflow-hidden bg-[#121413] px-0 py-0 text-white",
          immersive
            ? "min-h-dvh"
            : "rounded-[34px] border border-[rgba(22,26,24,0.9)] shadow-[0_38px_90px_rgba(19,24,21,0.3)]",
        )}
      >
        <div className={cn("relative overflow-hidden", immersive ? "min-h-dvh" : "min-h-[920px]")}>
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(216,141,67,0.16),transparent_24%),radial-gradient(circle_at_top_right,rgba(82,110,106,0.2),transparent_28%),linear-gradient(180deg,#181c1a,#111412_52%,#171917)]" />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(7,9,8,0.12),rgba(7,9,8,0.52)),radial-gradient(circle_at_center,transparent_40%,rgba(4,4,4,0.42)_100%)]" />

          {showImmersiveTopChrome ? (
            <div className="absolute left-4 right-4 top-4 z-10 flex items-center justify-end gap-3 md:left-6 md:right-6 md:top-6">
              <div className="flex items-center gap-2 rounded-full bg-black/26 px-3 py-2 backdrop-blur-xl">
                <StatusPill label={apiHealthy ? "api live" : "api down"} tone={apiHealthy ? "healthy" : "danger"} />
                <select
                  value={galleryModelFilter}
                  onChange={(event) => setGalleryModelFilter(event.target.value)}
                  className="rounded-full border border-white/10 bg-white/8 px-3 py-2 text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-white outline-none"
                >
                  <option value="all">All models</option>
                  {models.map((model) => (
                    <option key={model.key} value={model.key}>
                      {model.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : null}

          {showImmersiveExit ? (
            <>
              <div className="pointer-events-none fixed left-5 right-5 top-5 z-30 flex flex-col gap-2 md:left-7 md:right-7 md:top-7 md:flex-row md:items-start md:justify-between">
                <div className="pointer-events-auto flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => activateGalleryKindFilter("all")}
                    className={cn(
                      "inline-flex h-11 w-11 items-center justify-center rounded-full border text-white/82 shadow-[0_16px_38px_rgba(0,0,0,0.34)] backdrop-blur-xl transition hover:text-white",
                      !favoritesOnly && galleryKindFilter === "all"
                        ? "border-[rgba(216,141,67,0.36)] bg-[rgba(216,141,67,0.16)]"
                        : "border-white/12 bg-[rgba(10,12,11,0.72)]",
                    )}
                    aria-label="All media"
                  >
                    <Monitor className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => activateGalleryKindFilter("image")}
                    className={cn(
                      "inline-flex h-11 w-11 items-center justify-center rounded-full border text-white/82 shadow-[0_16px_38px_rgba(0,0,0,0.34)] backdrop-blur-xl transition hover:text-white",
                      !favoritesOnly && galleryKindFilter === "image"
                        ? "border-[rgba(216,141,67,0.36)] bg-[rgba(216,141,67,0.16)]"
                        : "border-white/12 bg-[rgba(10,12,11,0.72)]",
                    )}
                    aria-label="Images"
                  >
                    <ImageIcon className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => activateGalleryKindFilter("video")}
                    className={cn(
                      "inline-flex h-11 w-11 items-center justify-center rounded-full border text-white/82 shadow-[0_16px_38px_rgba(0,0,0,0.34)] backdrop-blur-xl transition hover:text-white",
                      !favoritesOnly && galleryKindFilter === "video"
                        ? "border-[rgba(216,141,67,0.36)] bg-[rgba(216,141,67,0.16)]"
                        : "border-white/12 bg-[rgba(10,12,11,0.72)]",
                    )}
                    aria-label="Videos"
                  >
                    <Clapperboard className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleFavoritesFilter()}
                    className={cn(
                      "inline-flex h-11 w-11 items-center justify-center rounded-full border text-white/82 shadow-[0_16px_38px_rgba(0,0,0,0.34)] backdrop-blur-xl transition hover:text-white",
                      favoritesOnly
                        ? "border-[rgba(255,126,166,0.42)] bg-[rgba(255,126,166,0.16)] text-[#ff8db3]"
                        : "border-white/12 bg-[rgba(10,12,11,0.72)]",
                    )}
                    aria-label="Favorites only"
                  >
                    <Heart className={cn("size-4", favoritesOnly ? "fill-current" : "")} />
                  </button>
                </div>
                <div className="pointer-events-auto flex items-center justify-end gap-2 md:max-w-[calc(100vw-3.5rem)]">
                  {!selectedAsset ? (
                    <div className="hidden items-center gap-2 md:flex">
                      {formattedRemainingCredits ? <StudioMetricPill icon={Coins} value={formattedRemainingCredits} /> : null}
                      {estimatedCredits ? <StudioMetricPill icon={Coins} value={estimatedCredits} accent="highlight" /> : null}
                      {estimatedCostUsd ? <StudioMetricPill icon={CircleDollarSign} value={estimatedCostUsd} accent="highlight" /> : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </>
          ) : null}

          <div
            className={cn(
              "relative z-[1] grid grid-cols-2 gap-px bg-white/6 p-px sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6",
              immersive ? "min-h-dvh pb-[270px] pt-0 md:pb-[290px]" : "min-h-[920px] pt-20",
            )}
          >
            {galleryTiles.map((tile, index) => {
              const preview = mediaThumbnailUrl(tile.asset);
              const batchTile = tile.batch;
              const batchJob = tile.job;
              const jobPreview = batchTile ? preview : preview;
              const eagerTile = index < 4;
              const selected = tile.asset?.asset_id != null && tile.asset.asset_id === selectedAssetId && !batchTile;
              return (
                <div
                  key={
                    tile.job?.job_id
                      ? `job-${tile.job.job_id}`
                      : tile.asset?.asset_id != null
                        ? `asset-${tile.asset.asset_id}`
                        : `placeholder-${index}-${tile.label}`
                  }
                  draggable={Boolean(tile.asset?.asset_id != null && tile.asset?.generation_kind === "image" && !batchTile)}
                  onDragStart={(event) => handleGalleryAssetDragStart(event, tile.asset)}
                  className={cn(
                    "group relative min-h-[190px] overflow-hidden bg-[#171b18] text-left sm:min-h-[250px]",
                    gallerySpanClasses[index] ?? "",
                    selected ? "ring-2 ring-[rgba(216,141,67,0.58)] ring-inset" : "",
                    tile.asset?.asset_id != null && !batchTile ? "cursor-pointer" : "",
                    tile.asset?.generation_kind === "image" && !batchTile ? "cursor-grab active:cursor-grabbing" : "",
                  )}
                  onClick={() => tile.asset?.asset_id != null && !batchTile && setSelectedAssetId(tile.asset.asset_id)}
                >
                  {jobPreview ? (
                    <img
                      src={jobPreview}
                      alt={tile.asset?.prompt_summary ?? tile.label}
                      loading={eagerTile ? "eager" : "lazy"}
                      fetchPriority={eagerTile ? "high" : "auto"}
                      decoding="async"
                      className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
                    />
                  ) : (
                    <div className="h-full w-full bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.12),transparent_45%),linear-gradient(180deg,#28302d,#1a1d1c)]" />
                  )}
                  <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_20%,rgba(0,0,0,0.34)_76%,rgba(0,0,0,0.58)_100%)]" />
                  {tile.asset?.generation_kind === "video" && !batchTile ? (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                      <span className="inline-flex h-14 w-14 items-center justify-center rounded-full border border-white/12 bg-[rgba(10,12,11,0.62)] text-white/88 shadow-[0_18px_40px_rgba(0,0,0,0.28)] backdrop-blur-xl">
                        <Play className="ml-0.5 size-5" />
                      </span>
                    </div>
                  ) : null}
                  {batchTile ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-[rgba(6,8,7,0.36)] p-4">
                      <div className="flex flex-col items-center gap-4 text-center">
                        <div className="flex h-20 w-20 items-center justify-center rounded-full border border-white/14 bg-[rgba(18,22,19,0.92)] shadow-[0_18px_40px_rgba(0,0,0,0.28)] backdrop-blur-xl">
                          {batchJob?.status === "queued" ? (
                            <div className="text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-white/84">Queued</div>
                          ) : (
                            <LoaderCircle className="size-6 animate-spin text-[#d8ff2e]" />
                          )}
                        </div>
                        <div className="text-[0.88rem] font-semibold uppercase tracking-[0.18em] text-white/68">
                          {prettifyModelLabel(batchJob?.model_key ?? batchTile.model_key)}
                        </div>
                      </div>
                    </div>
                  ) : null}
                  {!batchTile ? (
                    <div className="absolute inset-x-0 bottom-0 p-3 sm:p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-white/72">
                          {prettifyModelLabel(tile.asset?.model_key)}
                        </div>
                        <div className="flex items-center gap-2">
                          {tile.asset?.asset_id != null ? (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                void toggleAssetFavorite(tile.asset ?? null);
                              }}
                              disabled={favoriteAssetIdBusy === tile.asset.asset_id}
                              className={cn(
                                "inline-flex h-8 w-8 items-center justify-center rounded-full border backdrop-blur-xl transition",
                                tile.asset?.favorited
                                  ? "border-[rgba(255,126,166,0.38)] bg-[rgba(255,126,166,0.16)] text-[#ff8db3]"
                                  : "border-white/10 bg-[rgba(10,12,11,0.56)] text-white/76 hover:border-[rgba(255,126,166,0.28)] hover:text-[#ffd6e3]",
                                favoriteAssetIdBusy === tile.asset.asset_id ? "opacity-60" : "",
                              )}
                              aria-label={tile.asset?.favorited ? "Unfavorite media asset" : "Favorite media asset"}
                            >
                              <Heart className={cn("size-3.5", tile.asset?.favorited ? "fill-current" : "")} />
                            </button>
                          ) : null}
                          <div className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-[rgba(10,12,11,0.56)] text-white/82 backdrop-blur-xl">
                            {tile.asset?.generation_kind === "video" ? (
                              <Clapperboard className="size-3.5" />
                            ) : (
                              <ImageIcon className="size-3.5" />
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
            {activeGalleryHasMore || activeGalleryLoadingMore ? (
              <div
                ref={galleryLoadMoreRef}
                className="col-span-full flex min-h-16 items-center justify-center border-t border-white/6 bg-[rgba(10,12,11,0.72)] px-4 py-4 text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-white/46"
              >
                {activeGalleryLoadingMore ? (
                  "Loading more gallery items"
                ) : (
                  <button
                    type="button"
                    onClick={() => loadMoreAssetsRef.current()}
                    className="inline-flex min-h-11 items-center justify-center rounded-full border border-white/12 bg-[rgba(18,22,19,0.92)] px-4 py-2 text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-white/72 transition hover:border-[rgba(216,141,67,0.28)] hover:text-white"
                  >
                    Scroll or tap to load more
                  </button>
                )}
              </div>
            ) : null}
          </div>

          {!selectedAsset ? (
            <div
              className={cn(
                mobileComposerExpanded
                  ? "fixed inset-0 z-[110] flex items-end overflow-y-auto bg-[rgba(6,8,7,0.84)] p-3 pb-6 [webkit-overflow-scrolling:touch] md:inset-auto md:block md:overflow-visible md:bg-transparent md:p-0"
                  : immersive
                    ? "fixed bottom-4 left-4 right-4 z-[70] md:bottom-6 md:left-6 md:right-6"
                    : "absolute bottom-4 left-4 right-4 z-20 md:bottom-6 md:left-6 md:right-6",
              )}
            >
            <div
              className={cn(
                "mx-auto w-full border border-white/10 bg-[rgba(21,24,23,0.9)] shadow-[0_28px_70px_rgba(0,0,0,0.42)] backdrop-blur-2xl",
                mobileComposerExpanded
                  ? "mt-auto flex min-h-[calc(100dvh-1.5rem)] flex-col justify-end rounded-[30px] px-4 pb-6 pt-8 md:min-h-0 md:rounded-[34px] md:px-4 md:py-4"
                  : "rounded-[34px] px-4 py-4",
                immersive ? "max-w-[1480px]" : "max-w-[1240px]",
              )}
            >
              <div className="mb-4 flex items-start justify-between gap-3 md:hidden">
                <div className="min-w-0 flex-1">
                  <div className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-white/46">
                    Prompt composer
                  </div>
                  <div className="mt-2 text-[0.95rem] font-semibold tracking-[-0.03em] text-white/92">
                    {currentModel?.label ?? "Select a model"}
                  </div>
                  {mobileComposerExpanded ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {formattedRemainingCredits ? <StudioMetricPill icon={Coins} value={formattedRemainingCredits} /> : null}
                      {estimatedCredits ? <StudioMetricPill icon={Coins} value={estimatedCredits} accent="highlight" /> : null}
                      {estimatedCostUsd ? <StudioMetricPill icon={CircleDollarSign} value={estimatedCostUsd} accent="highlight" /> : null}
                    </div>
                  ) : null}
                  {!structuredPresetActive ? (
                    <div className="mt-4 text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-white/46">
                      Source images
                    </div>
                  ) : (
                    <div className="mt-4 text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-white/46">
                      {currentPreset?.label ?? "Preset mode"}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setMobileComposerCollapsed((current) => !current)}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/76 transition hover:border-[rgba(216,141,67,0.28)] hover:text-white"
                  aria-label={mobileComposerCollapsed ? "Expand prompt composer" : "Collapse prompt composer"}
                >
                  <ChevronDown className={cn("size-4 transition-transform", mobileComposerCollapsed ? "" : "rotate-180")} />
                </button>
              </div>
              <div className={cn(mobileComposerCollapsed ? "hidden md:block" : "block")}>
              <div className="mb-4 md:hidden">
                {sourceAttachmentStrip}
              </div>
              <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)] lg:items-stretch">
                <div className="relative hidden md:flex md:items-end md:justify-between md:gap-3 lg:order-none lg:grid lg:min-h-full lg:content-start lg:justify-stretch lg:gap-3">
                  {sourceAttachmentStrip}
                  <div className="absolute bottom-0 left-0">
                    {studioSettingsButton}
                  </div>
                </div>

                <div className="grid gap-3">
                  {structuredPresetActive ? (
                    <div className="relative grid gap-3 rounded-[26px] border border-white/8 bg-white/[0.04] px-4 py-4">
                      <div className={cn("grid gap-3", structuredPresetImageSlots.length ? "lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)] lg:items-start" : "")}>
                        <div className="rounded-[20px] border border-white/8 bg-[rgba(255,255,255,0.03)] p-4">
                          <div className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-white/48">Preset</div>
                          <div className="mt-2 text-base font-semibold tracking-[-0.03em] text-white/92">{currentPreset?.label}</div>
                          {currentPreset?.description ? (
                            <p className="mt-3 text-sm leading-7 text-white/68">{currentPreset.description}</p>
                          ) : null}
                        </div>
                        {structuredPresetImageSlots.length ? (
                          <div className="grid gap-3">
                            {structuredPresetImageSlots.map((slot) => {
                              const slotState = presetSlotStates[slot.key];
                              const slotPreview = slotState?.assetId
                                ? mediaThumbnailUrl(findMediaAssetById(slotState.assetId, localAssets, favoriteAssets) ?? null) ?? slotState.previewUrl
                                : slotState?.previewUrl;
                              return (
                                <div key={slot.key} className="rounded-[20px] border border-white/8 bg-[rgba(255,255,255,0.03)] p-3">
                                  <div className="flex items-start justify-between gap-3">
                                    <div>
                                      <div className="text-sm font-semibold text-white/88">{slot.label}</div>
                                      <div className="mt-1 text-xs leading-6 text-white/56">{slot.helpText || "Upload or drag an image into this slot."}</div>
                                    </div>
                                  </div>
                                  <div className="mt-3 flex items-center gap-3">
                                    <div className="relative h-[86px] w-[86px] shrink-0">
                                      <label
                                        onDragOver={(event) => event.preventDefault()}
                                        onDrop={(event) => handlePresetSlotDrop(event, slot.key)}
                                        className="relative flex h-full w-full cursor-pointer items-center justify-center overflow-hidden rounded-[22px] border border-white/10 bg-white/[0.05] text-white/74"
                                      >
                                        {slotPreview ? <img src={slotPreview} alt={slot.label} className="h-full w-full object-cover" /> : <ImagePlus className="size-5" />}
                                        <input type="file" accept="image/*" className="hidden" onChange={(event) => assignPresetSlotFile(slot.key, event.target.files?.[0] ?? null)} />
                                      </label>
                                      {slotState?.assetId || slotState?.file ? (
                                        <button
                                          type="button"
                                          onClick={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            clearPresetSlot(slot.key);
                                          }}
                                          className="absolute bottom-1.5 right-1.5 inline-flex h-8 w-8 items-center justify-center rounded-full border border-[rgba(255,181,166,0.22)] bg-[rgba(18,11,10,0.82)] text-[#ffb5a6] shadow-[0_10px_24px_rgba(0,0,0,0.28)] transition hover:border-[rgba(255,181,166,0.34)] hover:text-white"
                                          aria-label={`Clear ${slot.label}`}
                                          title={`Clear ${slot.label}`}
                                        >
                                          <Trash2 className="size-3.5" />
                                        </button>
                                      ) : null}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                      {structuredPresetTextFields.length ? (
                        <div className="grid gap-3 pt-1 sm:grid-cols-2">
                          {structuredPresetTextFields.map((field) => (
                            <label key={field.key} className="grid gap-2">
                              <span className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-white/54">{field.label}</span>
                              <input
                                value={presetInputValues[field.key] ?? field.defaultValue ?? ""}
                                onChange={(event) => setPresetInputValues((current) => ({ ...current, [field.key]: event.target.value }))}
                                placeholder={field.placeholder || field.label}
                                className="h-12 rounded-[18px] border border-white/10 bg-[rgba(11,14,13,0.88)] px-4 text-sm text-white outline-none placeholder:text-white/32"
                              />
                            </label>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="relative">
                      <textarea
                        ref={promptInputRef}
                        value={prompt}
                        onChange={(event) => setPrompt(event.target.value)}
                        placeholder={
                          multiShotsEnabled
                            ? "3 | Wide shot of the skyline\n2 | Hero steps into frame on the rooftop"
                            : "Describe the scene you imagine"
                        }
                        className="min-h-[132px] w-full resize-none rounded-[26px] border border-white/8 bg-white/[0.04] px-4 py-4 text-[0.86rem] leading-6 text-white outline-none placeholder:text-white/38 focus:border-[rgba(216,141,67,0.3)] md:min-h-[98px]"
                      />
                      {enhanceEnabledForModel ? (
                        <button
                          type="button"
                          onClick={openEnhanceDialog}
                          aria-label="Open enhance dialog"
                          title="Open enhance dialog"
                          className="absolute bottom-3 right-3 inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-white/72 transition hover:border-[rgba(216,141,67,0.32)] hover:bg-[rgba(216,141,67,0.14)] hover:text-white"
                        >
                          <Sparkles className="size-4" />
                        </button>
                      ) : null}
                    </div>
                  )}

                  <div className="relative z-30 flex flex-wrap items-center gap-2 pb-1 text-[0.77rem]">
                    <StudioPillSelect
                      pickerId="model"
                      openPicker={openPicker}
                      setOpenPicker={setOpenPicker}
                      widthClass={pickerWidth("model")}
                      icon={Clapperboard}
                      label={currentModel?.label ?? "Model"}
                      choices={models.map((model) => ({
                        value: model.key,
                        label: model.label,
                      }))}
                      onSelect={(value) => {
                        setModelKey(value);
                        setSelectedPresetId("");
                        setSelectedPromptIds([]);
                        setValidation(null);
                        setPresetInputValues({});
                        setPresetSlotStates({});
                      }}
                    />

                  {selectedPresetId || modelPresets.length ? (
                    <StudioPillSelect
                      pickerId="preset"
                      openPicker={openPicker}
                      setOpenPicker={setOpenPicker}
                      widthClass={pickerWidth("preset")}
                      icon={Sparkles}
                      label={
                        modelPresets.find((preset) => preset.preset_id === selectedPresetId)?.label ??
                        modelPresets.find((preset) => preset.key === selectedPresetId)?.label ??
                        "Preset"
                      }
                      choices={[
                        { value: "", label: "Preset" },
                        ...modelPresets.map((preset) => ({
                          value: preset.preset_id,
                          label: preset.label,
                        })),
                      ]}
                      onSelect={(value) => {
                        setSelectedPresetId(value);
                        setValidation(null);
                        setFormMessage(null);
                        if (!value) {
                          setPresetInputValues({});
                          setPresetSlotStates({});
                          return;
                        }
                        const preset = modelPresets.find((entry) => entry.preset_id === value || entry.key === value) ?? null;
                        if (!preset) {
                          return;
                        }
                        const hasStructuredInputs =
                          ((preset.input_schema_json as Array<Record<string, unknown>> | undefined)?.length ?? 0) > 0 ||
                          ((preset.input_slots_json as Array<Record<string, unknown>> | undefined)?.length ?? 0) > 0;
                        if (hasStructuredInputs) {
                          for (const attachment of attachments) {
                            if (attachment.previewUrl) {
                              URL.revokeObjectURL(attachment.previewUrl);
                            }
                          }
                          setAttachments([]);
                          setSourceAssetId(null);
                        }
                        if (!hasStructuredInputs && preset.prompt_template?.trim()) {
                          setPrompt(preset.prompt_template);
                        }
                        if (preset.default_options_json && Object.keys(preset.default_options_json).length) {
                          setOptionValues((current) => ({ ...current, ...preset.default_options_json }));
                        }
                      }}
                    />
                  ) : null}

                    {modelMaxOutputs > 1 ? (
                      <StudioPillSelect
                        pickerId="output-count"
                        openPicker={openPicker}
                        setOpenPicker={setOpenPicker}
                        widthClass={pickerWidth("output-count")}
                        icon={Copy}
                        label={`${outputCount}`}
                        choices={Array.from({ length: modelMaxOutputs }, (_, index) => ({
                          value: String(index + 1),
                          label: String(index + 1),
                        }))}
                        onSelect={(value) => setOutputCount(Math.max(1, Number(value) || 1))}
                      />
                    ) : null}

                    {compactOptionEntries
                      .filter(([optionKey]) => !(modelKey === "kling-3.0-i2v" && inferredInputPattern === "first_last_frames" && optionKey === "aspect_ratio"))
                      .map(([optionKey, schema]) => {
                      const Icon = optionIcon(optionKey);
                      const currentValue = optionValues[optionKey];
                      const choices = buildChoiceList(modelKey, optionKey, schema, currentValue);
                      const resolvedValue = currentValue ?? schema.default ?? null;
                      const resolvedLabel =
                        resolvedValue == null || resolvedValue === ""
                          ? choices[0]?.label ?? "Select"
                          : displayChoiceLabel(optionKey, schema, resolvedValue);
                      return (
                        <StudioPillSelect
                          key={optionKey}
                          pickerId={optionKey}
                          openPicker={openPicker}
                          setOpenPicker={setOpenPicker}
                          widthClass={pickerWidth(optionKey)}
                          icon={Icon}
                          label={resolvedLabel}
                          choices={
                            choices.length
                              ? choices
                              : [
                                  {
                                    value: serializeOptionChoice(resolvedValue ?? ""),
                                    label: resolvedLabel,
                                  },
                                ]
                          }
                          onSelect={(value) => updateOption(optionKey, parseOptionChoice(schema, value))}
                        />
                      );
                    })}

                    <div className="flex w-full items-center gap-2 sm:w-auto sm:ml-auto">
                      <div className="shrink-0 md:hidden">
                        {studioSettingsButton}
                      </div>
                      <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={clearComposer}
                        className="inline-flex h-12 shrink-0 items-center justify-center rounded-[18px] bg-[linear-gradient(135deg,#b4d58b,#87a86a)] px-5 text-[0.76rem] font-semibold text-[#132108] shadow-[0_18px_38px_rgba(113,147,86,0.18)] transition hover:-translate-y-0.5 hover:shadow-[0_22px_42px_rgba(113,147,86,0.24)]"
                      >
                        Clear
                      </button>
                      <button
                        type="button"
                        onClick={() => void submitMedia("submit")}
                        disabled={!canSubmit}
                        className="inline-flex h-12 shrink-0 items-center justify-center rounded-[18px] bg-[linear-gradient(135deg,#d8ff2e,#b5f414)] px-5 text-[0.76rem] font-semibold text-[#172200] shadow-[0_18px_38px_rgba(176,235,44,0.2)] transition hover:-translate-y-0.5 disabled:opacity-60"
                      >
                        {generateButtonLabel}
                      </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {(composerStatusMessage || selectedPromptList.length || multiShotsEnabled) ? (
                <div className="mt-4 grid gap-3 border-t border-white/8 pt-4">
                  <div className="grid gap-2">
                    {multiShotsEnabled ? (
                      <div className="rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-white/74">
                        {multiShotScriptError ? (
                          <span className="text-[#ffb5a6]">{multiShotScriptError}</span>
                        ) : (
                          <span>
                            Multi-shot script ready: {multiShotScript.shots.length} shot
                            {multiShotScript.shots.length === 1 ? "" : "s"} · {multiShotScript.totalDuration}s total
                          </span>
                        )}
                      </div>
                    ) : null}
                    {composerStatusMessage ? (
                      <div
                        className={cn(
                          "rounded-[20px] border px-4 py-3 text-sm",
                          composerStatusMessage.tone === "danger"
                            ? "border-[rgba(201,102,82,0.22)] bg-[rgba(201,102,82,0.08)] text-[#ffb5a6]"
                            : composerStatusMessage.tone === "healthy"
                              ? "border-[rgba(176,235,44,0.22)] bg-[rgba(176,235,44,0.08)] text-[#d8ff82]"
                              : "border-white/8 bg-white/[0.03] text-white/78",
                        )}
                      >
                        <div className="flex items-center gap-2">
                          {busyState !== "idle" ? <LoaderCircle className="size-4 animate-spin" /> : null}
                          <span>{composerStatusMessage.text}</span>
                        </div>
                      </div>
                    ) : null}
                    {selectedPromptList.length ? (
                      <div className="flex flex-wrap gap-2">
                        {selectedPromptList.map((promptItem) => (
                          <button
                            key={promptItem.prompt_id}
                            type="button"
                            onClick={() => togglePrompt(promptItem.prompt_id)}
                            className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-white/78"
                          >
                            @{promptItem.key}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
              </div>
            </div>
            </div>
          ) : null}
        </div>
      </div>

      {enhanceDialogOpen ? (
        <div className="fixed inset-0 z-[125] bg-[rgba(6,8,7,0.7)] backdrop-blur-md">
          <div className="absolute inset-0 p-3 md:p-6">
            <div className="grid h-full gap-4 rounded-[34px] border border-white/8 bg-[linear-gradient(180deg,rgba(16,20,18,0.96),rgba(10,13,12,0.96))] p-4 shadow-[0_40px_100px_rgba(0,0,0,0.5)] lg:grid-cols-[minmax(0,1fr)_320px] lg:p-6">
              <div className="grid min-h-0 gap-4 overflow-hidden rounded-[30px] bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.08),transparent_55%),linear-gradient(180deg,#111514,#181d1b)] p-4 lg:p-6">
                <div className="relative overflow-hidden rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01)),radial-gradient(circle_at_top,rgba(216,141,67,0.12),transparent_36%),rgba(5,7,6,0.86)]">
                  {enhancementPreviewVisual ? (
                    <div className="flex min-h-[260px] items-center justify-center p-4 sm:min-h-[340px] sm:p-5">
                      <img
                        src={enhancementPreviewVisual}
                        alt="Enhancement reference"
                        className="max-h-[50vh] w-auto max-w-full rounded-[24px] object-contain shadow-[0_24px_70px_rgba(0,0,0,0.42)]"
                      />
                    </div>
                  ) : (
                    <div className="flex min-h-[260px] items-center justify-center px-6 text-center text-sm text-white/56 sm:min-h-[340px]">
                      No image reference is staged for this enhancement preview.
                    </div>
                  )}
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
                    <div className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-white/54">User prompt</div>
                    <pre className="mt-3 whitespace-pre-wrap text-sm leading-7 text-white/78">
                      {(structuredPresetActive ? structuredPresetPromptPreview : prompt) || "No prompt entered yet."}
                    </pre>
                  </div>
                  <div className="rounded-[22px] border border-[rgba(216,141,67,0.14)] bg-[rgba(216,141,67,0.05)] p-4">
                    <div className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-[#ffd7af]">Enhanced prompt</div>
                    <pre className="mt-3 whitespace-pre-wrap text-sm leading-7 text-white/88">
                      {enhancePreview?.final_prompt_used || enhancePreview?.enhanced_prompt || (enhanceBusy ? "Enhancing prompt..." : "Run enhance to preview the rewritten prompt.")}
                    </pre>
                  </div>
                  <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4 xl:col-span-2">
                    <div className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-white/54">Image analysis</div>
                    <div className="mt-3 whitespace-pre-wrap text-sm leading-7 text-white/76">
                      {enhanceImageAnalysisText ? (
                        enhanceImageAnalysisText
                      ) : enhancementPreviewVisual ? (
                        "No image analysis output is available for this preview yet."
                      ) : (
                        "No image reference is staged, so there is nothing to analyze."
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid auto-rows-max gap-4 overflow-y-auto rounded-[28px] bg-[rgba(255,255,255,0.04)] p-4 text-white lg:p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-white/54">Enhance prompt</div>
                    <div className="mt-1 text-base font-semibold text-white">{currentModel?.label ?? "Unknown model"}</div>
                    <div className="mt-1 text-sm text-white/66">Preview the rewrite, then send it back to the composer.</div>
                  </div>
                  <button type="button" onClick={() => setEnhanceDialogOpen(false)} className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-black/24 text-white/78 transition hover:text-white">
                    <X className="size-5" />
                  </button>
                </div>

                <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
                  <div className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-white/54">Preview summary</div>
                    <div className="mt-3 grid gap-3 text-sm leading-6 text-white/74">
                      <div>
                        <span className="text-white/48">Model:</span> {currentModel?.label ?? "Unknown model"}
                      </div>
                      <div>
                        <span className="text-white/48">Enhancement provider:</span> {enhanceProviderLabel}
                      </div>
                      <div>
                        <span className="text-white/48">Enhancement model:</span> {enhanceProviderModelId ?? "Not selected"}
                      </div>
                      <div>
                        <span className="text-white/48">Preset:</span> {currentPreset?.label ?? "No preset selected"}
                      </div>
                    <div>
                      <span className="text-white/48">Image reference:</span> {enhancementPreviewVisual ? "Attached" : "None"}
                    </div>
                    <div>
                      <span className="text-white/48">Image analysis:</span>{" "}
                      {enhanceImageAnalysisStatus}
                    </div>
                  </div>
                </div>

                {enhanceError ? (
                  <div className="rounded-[20px] border border-[rgba(201,102,82,0.22)] bg-[rgba(201,102,82,0.08)] px-4 py-3 text-sm text-[#ffb5a6]">
                    {enhanceError}
                  </div>
                ) : null}
                {enhancePreview?.warnings?.length ? (
                  <div className="rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-white/72">
                    {enhancePreview.warnings.join(" ")}
                  </div>
                ) : null}

                <div className="grid gap-3">
                  <button type="button" onClick={() => void requestEnhancementPreview()} disabled={enhanceBusy} className="inline-flex w-full items-center justify-center gap-3 rounded-[22px] bg-[linear-gradient(135deg,#d8ff2e,#b5f414)] px-5 py-4 text-[0.98rem] font-semibold text-[#162300] shadow-[0_18px_34px_rgba(156,204,33,0.22)] disabled:opacity-60">
                    {enhanceBusy ? <LoaderCircle className="size-4.5 animate-spin" /> : <Sparkles className="size-4.5" />}
                    {enhanceBusy ? "Enhancing..." : "Enhance"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const nextPrompt = enhancePreview?.final_prompt_used || enhancePreview?.enhanced_prompt;
                      if (!nextPrompt) {
                        return;
                      }
                      setPrompt(nextPrompt);
                      setEnhanceDialogOpen(false);
                      setFormMessage({ tone: "healthy", text: "Loaded the enhanced prompt into the composer." });
                    }}
                    disabled={!enhancePreview?.final_prompt_used && !enhancePreview?.enhanced_prompt}
                    className="inline-flex w-full items-center justify-center gap-3 rounded-[20px] border border-white/10 bg-white/[0.04] px-5 py-4 text-sm font-semibold text-white/86 disabled:opacity-60"
                  >
                    Use Prompt
                  </button>
                  <button type="button" onClick={() => setEnhanceDialogOpen(false)} className="inline-flex w-full items-center justify-center rounded-[18px] border border-white/10 bg-white/[0.04] px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-white/76">
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {studioSettingsOpen ? (
        <div className="fixed inset-0 z-[118] overflow-y-auto overscroll-contain bg-[rgba(6,8,7,0.78)] backdrop-blur-md [webkit-overflow-scrolling:touch]">
          <div className="min-h-dvh p-0 lg:p-6">
            <div className="flex min-h-dvh min-w-0 flex-col bg-[linear-gradient(180deg,rgba(16,20,18,0.98),rgba(10,13,12,0.98))] shadow-[0_40px_100px_rgba(0,0,0,0.5)] lg:h-[calc(100dvh-3rem)] lg:min-h-0 lg:max-h-[calc(100dvh-3rem)] lg:overflow-hidden lg:rounded-[34px] lg:border lg:border-white/8">
              <div className="flex items-center justify-between gap-3 border-b border-white/8 px-4 py-4 md:px-6">
                <div>
                  <div className="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-[rgba(208,255,72,0.94)]">
                    Studio Settings
                  </div>
                  <div className="mt-1 text-sm text-white/68">
                    Configure the current model, system prompt, and presets without leaving Studio.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setStudioSettingsOpen(false)}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/78 transition hover:border-[rgba(216,141,67,0.28)] hover:text-white"
                  aria-label="Close studio settings"
                >
                  <X className="size-5" />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-4 md:px-6 md:py-6">
                <MediaModelsConsole
                  models={models}
                  presets={presets}
                  enhancementConfigs={enhancementConfigs}
                  llmPresets={llmPresets}
                  initialSelectedModelKey={modelKey}
                  variant="studio"
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {selectedAsset ? (
        <div className="fixed inset-0 z-[120] overflow-y-auto overscroll-contain bg-[rgba(6,8,7,0.86)] backdrop-blur-md [webkit-overflow-scrolling:touch]">
          <div className="min-h-dvh p-0 lg:p-6">
            <div className="grid min-h-dvh content-start gap-4 bg-[linear-gradient(180deg,rgba(16,20,18,0.98),rgba(10,13,12,0.98))] px-3 pb-6 pt-3 shadow-[0_40px_100px_rgba(0,0,0,0.5)] [touch-action:pan-y] lg:h-[calc(100dvh-3rem)] lg:min-h-0 lg:max-h-[calc(100dvh-3rem)] lg:grid-cols-[minmax(0,1fr)_360px] lg:overflow-hidden lg:rounded-[34px] lg:border lg:border-white/8 lg:px-6 lg:pb-6 lg:pt-6">
              <div className="grid min-h-0 content-start gap-4 lg:grid-rows-[minmax(0,1fr)_auto]">
                <div className="relative overflow-hidden rounded-[30px] bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.08),transparent_55%),linear-gradient(180deg,#111514,#181d1b)]">
                  <button
                    type="button"
                    onClick={resetInspector}
                    className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-black/24 text-white/78 transition hover:text-white"
                  >
                    <X className="size-5" />
                  </button>
                  <div className="flex min-h-[48vh] items-center justify-center p-4 sm:p-6 lg:h-full">
                    {selectedAssetDisplayVisual ? (
                      selectedAsset.generation_kind === "video" ? (
                        <button
                          type="button"
                          onClick={openSelectedMediaLightbox}
                          className="relative cursor-zoom-in"
                          aria-label="Open selected video"
                        >
                          <img
                            src={selectedAssetDisplayVisual}
                            alt={selectedAsset.prompt_summary ?? "Selected media artifact"}
                            loading="eager"
                            fetchPriority="high"
                            decoding="async"
                            className="max-h-[58vh] w-auto max-w-full rounded-[28px] object-contain shadow-[0_22px_60px_rgba(0,0,0,0.4)] lg:max-h-[68vh]"
                          />
                          {selectedAssetPlaybackVisual ? (
                            <span className="absolute inset-0 flex items-center justify-center">
                              <span className="inline-flex h-20 w-20 items-center justify-center rounded-full border border-white/12 bg-[rgba(10,12,11,0.72)] text-white shadow-[0_24px_48px_rgba(0,0,0,0.3)] backdrop-blur-xl transition hover:scale-[1.02] hover:bg-[rgba(16,19,18,0.82)]">
                                <Play className="ml-1 size-8" />
                              </span>
                            </span>
                          ) : null}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={openSelectedMediaLightbox}
                          className="cursor-zoom-in"
                          aria-label="Open selected image"
                        >
                          <img
                            src={selectedAssetDisplayVisual}
                            alt={selectedAsset.prompt_summary ?? "Selected media artifact"}
                            loading="eager"
                            fetchPriority="high"
                            decoding="async"
                            className="max-h-[58vh] w-auto max-w-full rounded-[28px] object-contain shadow-[0_22px_60px_rgba(0,0,0,0.4)] lg:max-h-[68vh]"
                          />
                        </button>
                      )
                    ) : null}
                  </div>
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between p-4">
                    <div className="pointer-events-auto flex items-center gap-2">
                      {mediaDownloadUrl(selectedAsset) ? (
                        <StudioActionIconButton
                          icon={Download}
                          label={mobileSaveActionLabel()}
                          onClick={() => void handleAssetDownload(selectedAsset)}
                          className="h-11 w-11 rounded-full border-white/12 bg-[rgba(8,10,9,0.72)] text-white/82 shadow-[0_18px_40px_rgba(0,0,0,0.32)] backdrop-blur-xl"
                        />
                      ) : null}
                    </div>
                    <div className="pointer-events-auto flex items-center gap-2">
                      <StudioActionIconButton
                        icon={Trash2}
                        label="Remove"
                        onClick={() => void dismissAsset(selectedAsset.asset_id)}
                        tone="danger"
                        className="h-11 w-11 rounded-full border-[rgba(201,102,82,0.28)] bg-[rgba(40,16,14,0.76)] text-[#ffb5a6] shadow-[0_18px_40px_rgba(0,0,0,0.32)] backdrop-blur-xl"
                      />
                    </div>
                  </div>

                </div>

                <div className="hidden rounded-[24px] border border-white/8 bg-[rgba(255,255,255,0.04)] p-4 text-white lg:block">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-white/54">
                      {selectedAssetStructuredPresetActive ? "Preset Details" : "Prompt"}
                    </div>
                    {!selectedAssetStructuredPresetActive ? (
                      <button
                        type="button"
                        onClick={() => void copyPromptFromAsset(selectedAssetPrompt)}
                        className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-white/76"
                      >
                        <Copy className="size-3.5" />
                        Copy
                      </button>
                    ) : null}
                  </div>
                  {selectedAssetStructuredPresetActive ? (
                    <div className="grid gap-4">
                      {selectedAssetPresetSlots.length ? (
                        <div className="grid gap-3">
                          {selectedAssetPresetSlots.map((slot) => {
                            const rawItems = Array.isArray(selectedAssetPresetSlotValues[slot.key])
                              ? (selectedAssetPresetSlotValues[slot.key] as unknown[])
                              : [];
                            const previews = rawItems
                              .map((item) => structuredPresetSlotPreviewUrl(item, localAssets, favoriteAssets))
                              .filter((item): item is { url: string; label: string } => Boolean(item?.url));
                            return (
                              <div key={slot.key} className="rounded-[18px] border border-white/7 bg-black/16 p-3">
                                <div className="flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-white/56">
                                  <ImageIcon className="size-3.5 text-[rgba(208,255,72,0.88)]" />
                                  {slot.label}
                                </div>
                                {slot.helpText ? (
                                  <div className="mt-1 text-sm leading-6 text-white/60">{slot.helpText}</div>
                                ) : null}
                                {previews.length ? (
                                  <div className="mt-3 flex flex-wrap gap-3">
                                    {previews.map((preview, index) => (
                                      <div key={`${slot.key}-${index}`} className="grid gap-2">
                                        <img
                                          src={preview.url}
                                          alt={preview.label}
                                          className="h-24 w-24 rounded-[16px] object-cover"
                                          loading="lazy"
                                          decoding="async"
                                        />
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="mt-3 text-sm text-white/54">No source image was recorded.</div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                      {selectedAssetPresetFields.length ? (
                        <div className="grid gap-2">
                          {selectedAssetPresetFields.map((field) => (
                            <div key={field.key} className="flex items-center justify-between gap-3 rounded-[16px] border border-white/7 bg-black/16 px-3 py-3">
                              <span className="text-sm text-white/56">{field.label}</span>
                              <span className="text-sm font-medium text-white/92">
                                {selectedAssetPresetInputValues[field.key] || field.defaultValue || "Not provided"}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="max-h-[14rem] overflow-y-auto rounded-[18px] border border-white/7 bg-black/16 px-4 py-3 pr-2">
                      <p className="whitespace-pre-wrap text-sm leading-7 text-white/78">
                        {selectedAssetPrompt ?? "No prompt text was stored for this asset."}
                      </p>
                    </div>
                  )}
                </div>

                <div className="lg:hidden">
                  <CollapsibleSubsection
                    title={selectedAssetStructuredPresetActive ? "Preset Details" : "Prompt"}
                    description={selectedAssetStructuredPresetActive ? "Open the preset source images and text values for this asset." : "Open the saved prompt for this asset."}
                    tone="media"
                    badge={
                      !selectedAssetStructuredPresetActive ? (
                        <button
                          type="button"
                          onClick={() => void copyPromptFromAsset(selectedAssetPrompt)}
                          className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-white/76"
                        >
                          <Copy className="size-3.5" />
                          Copy
                        </button>
                      ) : undefined
                    }
                    open={mobileInspectorPromptOpen}
                    onOpenChange={setMobileInspectorPromptOpen}
                    className="rounded-[24px] !border-white/10 !bg-[rgba(16,19,18,0.98)] px-4 py-4 text-white shadow-[0_18px_38px_rgba(0,0,0,0.26)]"
                    titleClassName="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-white/72"
                    descriptionClassName="mt-1 text-sm text-white/74"
                    iconClassName="text-white/64"
                    bodyClassName="mt-3"
                  >
                    {selectedAssetStructuredPresetActive ? (
                      <div className="grid gap-4">
                        {selectedAssetPresetSlots.length ? (
                          <div className="grid gap-3">
                            {selectedAssetPresetSlots.map((slot) => {
                              const rawItems = Array.isArray(selectedAssetPresetSlotValues[slot.key])
                                ? (selectedAssetPresetSlotValues[slot.key] as unknown[])
                                : [];
                              const previews = rawItems
                                .map((item) => structuredPresetSlotPreviewUrl(item, localAssets, favoriteAssets))
                                .filter((item): item is { url: string; label: string } => Boolean(item?.url));
                              return (
                                <div key={slot.key} className="rounded-[18px] border border-white/7 bg-black/16 p-3">
                                  <div className="flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-white/56">
                                    <ImageIcon className="size-3.5 text-[rgba(208,255,72,0.88)]" />
                                    {slot.label}
                                  </div>
                                  {slot.helpText ? <div className="mt-1 text-sm leading-6 text-white/60">{slot.helpText}</div> : null}
                                  {previews.length ? (
                                    <div className="mt-3 flex flex-wrap gap-3">
                                      {previews.map((preview, index) => (
                                        <img
                                          key={`${slot.key}-${index}`}
                                          src={preview.url}
                                          alt={preview.label}
                                          className="h-20 w-20 rounded-[14px] object-cover"
                                          loading="lazy"
                                          decoding="async"
                                        />
                                      ))}
                                    </div>
                                  ) : (
                                    <div className="mt-3 text-sm text-white/54">No source image was recorded.</div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                        {selectedAssetPresetFields.length ? (
                          <div className="grid gap-2">
                            {selectedAssetPresetFields.map((field) => (
                              <div key={field.key} className="flex items-center justify-between gap-3 rounded-[16px] border border-white/7 bg-black/16 px-3 py-3">
                                <span className="text-sm text-white/56">{field.label}</span>
                                <span className="text-sm font-medium text-white/92">
                                  {selectedAssetPresetInputValues[field.key] || field.defaultValue || "Not provided"}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="rounded-[18px] border border-white/7 bg-black/16 px-4 py-3">
                        <p className="whitespace-pre-wrap text-sm leading-7 text-white/78">
                          {selectedAssetPrompt ?? "No prompt text was stored for this asset."}
                        </p>
                      </div>
                    )}
                  </CollapsibleSubsection>
                  </div>
                </div>

                <div className="grid gap-3 rounded-[24px] border border-white/10 bg-[rgba(16,19,18,0.98)] p-3 shadow-[0_18px_38px_rgba(0,0,0,0.22)] lg:hidden">
                  {selectedAsset.generation_kind === "image" ? (
                    <>
                      <button
                        type="button"
                        onClick={() => useAssetAsSource(selectedAsset, true)}
                        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[18px] bg-[linear-gradient(135deg,#d8ff2e,#b5f414)] px-4 text-[0.82rem] font-semibold text-[#172200] shadow-[0_18px_38px_rgba(176,235,44,0.2)] transition hover:-translate-y-0.5"
                      >
                        <Wand2 className="size-4" />
                        Animate
                      </button>
                      <button
                        type="button"
                        onClick={() => useAssetAsSource(selectedAsset, false)}
                        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[18px] border border-white/10 bg-white/[0.06] px-4 text-[0.82rem] font-semibold text-white/84 transition hover:border-[rgba(216,141,67,0.3)] hover:bg-[rgba(216,141,67,0.12)] hover:text-white"
                      >
                        <ImagePlus className="size-4" />
                        Use image
                      </button>
                    </>
                  ) : null}
                </div>

                <div className="hidden min-h-0 gap-4 rounded-[28px] bg-[rgba(255,255,255,0.04)] p-4 text-white lg:grid lg:overflow-y-auto lg:p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-white/54">
                      Selected asset
                    </div>
                    <div className="mt-1 text-sm text-white/76">
                      {selectedAsset.model_key ?? "Unknown model"} • {formatDateTime(selectedAsset.created_at)}
                    </div>
                  </div>
                  <StatusPill label={selectedAsset.status ?? "stored"} tone={toneForStatus(selectedAsset.status)} />
                </div>

                <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
                  <div className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-white/54">
                    Information
                  </div>
                  <div className="mt-3 grid gap-2">
                    <div className="flex items-center justify-between gap-3 rounded-[16px] bg-white/[0.03] px-3 py-3">
                      <span className="text-sm text-white/56">Model</span>
                      <span className="text-sm font-medium text-white/92">{selectedAsset.model_key ?? "Unknown"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3 rounded-[16px] bg-white/[0.03] px-3 py-3">
                      <span className="text-sm text-white/56">Preset</span>
                      <span className="text-sm font-medium text-white/92">{selectedAsset.preset_key ?? "builtin"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3 rounded-[16px] bg-white/[0.03] px-3 py-3">
                      <span className="text-sm text-white/56">Type</span>
                      <span className="text-sm font-medium text-white/92">{selectedAsset.generation_kind ?? selectedAsset.task_mode ?? "asset"}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void toggleAssetFavorite(selectedAsset)}
                      disabled={favoriteAssetIdBusy === selectedAsset.asset_id}
                      className="flex items-center justify-between gap-3 rounded-[16px] bg-white/[0.03] px-3 py-3 text-left transition hover:bg-white/[0.05] disabled:opacity-60"
                    >
                      <span className="text-sm text-white/56">Favorite</span>
                      <span
                        className={cn(
                          "inline-flex items-center gap-2 text-sm font-medium",
                          selectedAsset.favorited ? "text-[#ff9abc]" : "text-white/72",
                        )}
                      >
                        <Heart className={cn("size-4", selectedAsset.favorited ? "fill-current" : "")} />
                        {selectedAsset.favorited ? "Saved" : "Off"}
                      </span>
                    </button>
                    {Object.entries((selectedAsset.payload?.resolved_options as Record<string, unknown> | undefined) ?? {})
                      .filter(([, value]) => value != null && value !== "")
                      .slice(0, 6)
                      .map(([key, value]) => (
                        <div key={key} className="flex items-center justify-between gap-3 rounded-[16px] bg-white/[0.03] px-3 py-3">
                          <span className="text-sm text-white/56">{optionShortLabel(key)}</span>
                          <span className="text-sm font-medium text-white/92">{displayChoiceLabel(key, {}, value) || formatOptionValue(value)}</span>
                        </div>
                      ))}
                  </div>
                </div>

                <div className="grid gap-3">
                  {selectedAsset.generation_kind === "image" ? (
                    <>
                      <button
                        type="button"
                        onClick={() => useAssetAsSource(selectedAsset, true)}
                        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[18px] bg-[linear-gradient(135deg,#d8ff2e,#b5f414)] px-4 text-[0.82rem] font-semibold text-[#172200] shadow-[0_18px_38px_rgba(176,235,44,0.2)] transition hover:-translate-y-0.5"
                      >
                        <Wand2 className="size-4" />
                        Animate
                      </button>
                      <button
                        type="button"
                        onClick={() => useAssetAsSource(selectedAsset, false)}
                        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[18px] border border-white/10 bg-white/[0.06] px-4 text-[0.82rem] font-semibold text-white/84 transition hover:border-[rgba(216,141,67,0.3)] hover:bg-[rgba(216,141,67,0.12)] hover:text-white"
                      >
                        <ImagePlus className="size-4" />
                        Use image
                      </button>
                    </>
                  ) : null}
                </div>
              </div>

              <div className="lg:hidden">
                <CollapsibleSubsection
                  title="Selected asset"
                  description="Open the metadata and actions for this asset."
                  tone="media"
                  badge={<StatusPill label={selectedAsset.status ?? "stored"} tone={toneForStatus(selectedAsset.status)} />}
                  open={mobileInspectorInfoOpen}
                  onOpenChange={setMobileInspectorInfoOpen}
                    className="rounded-[24px] !border-white/10 !bg-[rgba(16,19,18,0.98)] px-4 py-4 text-white shadow-[0_18px_38px_rgba(0,0,0,0.26)]"
                  titleClassName="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-white/72"
                  descriptionClassName="mt-1 text-sm text-white/74"
                  iconClassName="text-white/64"
                  bodyClassName="mt-3"
                >
                  <div className="grid gap-4">
                    <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
                      <div className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-white/54">
                        Information
                      </div>
                      <div className="mt-3 grid gap-2">
                        <div className="flex items-center justify-between gap-3 rounded-[16px] bg-white/[0.03] px-3 py-3">
                          <span className="text-sm text-white/56">Model</span>
                          <span className="text-sm font-medium text-white/92">{selectedAsset.model_key ?? "Unknown"}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3 rounded-[16px] bg-white/[0.03] px-3 py-3">
                          <span className="text-sm text-white/56">Preset</span>
                          <span className="text-sm font-medium text-white/92">{selectedAsset.preset_key ?? "builtin"}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3 rounded-[16px] bg-white/[0.03] px-3 py-3">
                          <span className="text-sm text-white/56">Type</span>
                          <span className="text-sm font-medium text-white/92">{selectedAsset.generation_kind ?? selectedAsset.task_mode ?? "asset"}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => void toggleAssetFavorite(selectedAsset)}
                          disabled={favoriteAssetIdBusy === selectedAsset.asset_id}
                          className="flex items-center justify-between gap-3 rounded-[16px] bg-white/[0.03] px-3 py-3 text-left transition hover:bg-white/[0.05] disabled:opacity-60"
                        >
                          <span className="text-sm text-white/56">Favorite</span>
                          <span
                            className={cn(
                              "inline-flex items-center gap-2 text-sm font-medium",
                              selectedAsset.favorited ? "text-[#ff9abc]" : "text-white/72",
                            )}
                          >
                            <Heart className={cn("size-4", selectedAsset.favorited ? "fill-current" : "")} />
                            {selectedAsset.favorited ? "Saved" : "Off"}
                          </span>
                        </button>
                        {Object.entries((selectedAsset.payload?.resolved_options as Record<string, unknown> | undefined) ?? {})
                          .filter(([, value]) => value != null && value !== "")
                          .slice(0, 6)
                          .map(([key, value]) => (
                            <div key={key} className="flex items-center justify-between gap-3 rounded-[16px] bg-white/[0.03] px-3 py-3">
                              <span className="text-sm text-white/56">{optionShortLabel(key)}</span>
                              <span className="text-sm font-medium text-white/92">{displayChoiceLabel(key, {}, value) || formatOptionValue(value)}</span>
                            </div>
                          ))}
                      </div>
                    </div>
                  </div>
                </CollapsibleSubsection>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {selectedAsset && selectedMediaLightboxOpen ? (
        <div
          className="fixed inset-0 z-[140] bg-[rgba(4,6,5,0.96)]"
          onClick={() => void closeSelectedMediaLightbox()}
        >
          <button
            type="button"
            onClick={() => void closeSelectedMediaLightbox()}
            className="absolute right-4 top-4 z-10 flex h-11 w-11 items-center justify-center rounded-full border border-white/12 bg-black/24 text-white/82 transition hover:text-white md:right-6 md:top-6"
            aria-label="Close media lightbox"
          >
            <X className="size-5" />
          </button>
          <div className="flex h-full w-full items-center justify-center p-4 md:p-8" onClick={(event) => event.stopPropagation()}>
            {selectedAsset.generation_kind === "video" && selectedAssetPlaybackVisual ? (
              <video
                ref={lightboxVideoRef}
                src={selectedAssetPlaybackVisual}
                controls
                autoPlay
                playsInline
                preload="metadata"
                poster={selectedAssetDisplayVisual ?? undefined}
                className="max-h-full w-auto max-w-full rounded-[28px] object-contain shadow-[0_28px_90px_rgba(0,0,0,0.48)]"
              />
            ) : selectedAssetLightboxVisual ? (
              <img
                src={selectedAssetLightboxVisual}
                alt={selectedAsset.prompt_summary ?? "Selected media artifact"}
                loading="eager"
                fetchPriority="high"
                decoding="async"
                className="max-h-full w-auto max-w-full rounded-[28px] object-contain shadow-[0_28px_90px_rgba(0,0,0,0.48)]"
              />
            ) : null}
          </div>
        </div>
      ) : null}

      {!immersive ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_360px]">
        <Panel>
          <PanelHeader
            eyebrow="Queue"
            title="Recent jobs"
            description="The stage above is the operator-facing create surface. This queue keeps the current Control API job state visible while runs are moving."
          />
          <div className="mt-5 grid gap-3">
            {localJobs.length ? (
              localJobs.slice(0, 6).map((job) => (
                <div
                  key={job.job_id}
                  className="rounded-[22px] border border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.78)] px-4 py-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium tracking-[-0.02em] text-[var(--foreground)]">
                        {job.model_key ?? "Unknown model"}
                      </div>
                      <p className="mt-2 text-sm leading-7 text-[var(--muted-strong)]">
                        {truncate(job.final_prompt_used || job.enhanced_prompt || job.raw_prompt || "No prompt recorded.", 160)}
                      </p>
                    </div>
                    <StatusPill label={job.status} tone={toneForStatus(job.status)} />
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2 text-xs uppercase tracking-[0.14em] text-[var(--muted-strong)]">
                    <span>{formatDateTime(job.created_at)}</span>
                    <span>•</span>
                    <span>{job.provider_task_id ?? "local staging"}</span>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-[22px] border border-dashed border-white/10 bg-[rgba(12,15,14,0.94)] px-4 py-4 text-sm leading-7 text-[var(--muted-strong)]">
                No media jobs are stored yet.
              </div>
            )}
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            eyebrow="Lineage"
            title="Current create context"
            description="A compact view of the prompt strategy currently staged in the bottom dock."
          />
          <div className="mt-5 grid gap-3">
            <div className="rounded-[20px] border border-white/10 bg-[rgba(12,15,14,0.94)] px-4 py-4">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent-strong)]">
                Model
              </div>
              <div className="mt-2 text-lg font-semibold tracking-[-0.03em] text-[var(--foreground)]">
                {currentModel?.label ?? "No model selected"}
              </div>
            </div>
            <div className="rounded-[20px] border border-white/10 bg-[rgba(12,15,14,0.94)] px-4 py-4">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent-strong)]">
                Selected prompts
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {selectedPromptList.length ? (
                  selectedPromptList.map((promptItem) => (
                    <span
                      key={promptItem.prompt_id}
                      className="rounded-full border border-[rgba(208,255,72,0.24)] bg-[rgba(208,255,72,0.12)] px-3 py-2 text-xs uppercase tracking-[0.12em] text-[var(--accent-strong)]"
                    >
                      @{promptItem.key}
                    </span>
                  ))
                ) : (
                  <span className="text-sm leading-7 text-[var(--muted-strong)]">No system prompts selected yet.</span>
                )}
              </div>
            </div>
            <div className="rounded-[20px] border border-white/10 bg-[rgba(12,15,14,0.94)] px-4 py-4">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent-strong)]">
                Preflight
              </div>
              <div className="mt-2 text-sm leading-7 text-[var(--muted-strong)]">
                {validation?.resolved_system_prompt?.rendered_system_prompt
                  ? String(validation.resolved_system_prompt.rendered_system_prompt)
                  : "Run preflight to see the rendered system prompt and resolved options before submit."}
              </div>
            </div>
          </div>
        </Panel>
        </div>
      ) : null}
    </div>
  );
}
