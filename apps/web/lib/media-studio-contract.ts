import type {
  LlmPreset,
  MediaAsset,
  MediaBatch,
  MediaEnhancementConfig,
  MediaJob,
  MediaModelQueuePolicy,
  MediaModelSummary,
  MediaPreset,
  MediaQueueSettings,
  MediaSystemPrompt,
} from "@/lib/types";

export type MediaStudioProps = {
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

export type AttachmentRecord = {
  id: string;
  file: File;
  kind: "images" | "videos" | "audios";
  role?: "first_frame" | "last_frame" | "reference" | null;
  previewUrl: string | null;
  durationSeconds?: number | null;
};

export type GalleryKindFilter = "all" | "image" | "video";

export type AssetPagePayload = {
  ok?: boolean;
  error?: string;
  assets?: MediaAsset[];
  limit?: number | null;
  offset?: number | null;
  has_more?: boolean;
  next_offset?: number | null;
};

export type ComposerStatusTone = "healthy" | "warning" | "danger";

export type ComposerStatusMessage = {
  tone: ComposerStatusTone;
  text: string;
};

export type FloatingComposerStatus = ComposerStatusMessage & {
  visible: boolean;
};

export const INITIAL_ASSET_PAGE_SIZE = 12;
export const ASSET_APPEND_BATCH_SIZE = 4;
export const FLOATING_COMPOSER_STATUS_MS = 2600;
export const FLOATING_COMPOSER_STATUS_FADE_MS = 320;

export const gallerySpanClasses = [
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
