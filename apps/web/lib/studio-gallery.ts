import type { MediaAsset, MediaBatch, MediaJob, MediaPreset, MediaSystemPrompt } from "@/lib/types";
import { isRecord } from "@/lib/utils";

export type GalleryTile = {
  asset: MediaAsset | null;
  label: string;
  batch: MediaBatch | null;
  job: MediaJob | null;
};

export type GalleryTileFilters = {
  modelKey?: string;
  generationKind?: "all" | "image" | "video";
  favoritesOnly?: boolean;
};

type AttachmentKindCarrier = {
  kind: "images" | "videos" | "audios";
};

export function mergeAssetCollections(collection: MediaAsset[], additions: MediaAsset[]) {
  if (!additions.length) {
    return collection;
  }
  const merged = [...collection];
  const seen = new Map<string, number>();
  for (const [index, asset] of merged.entries()) {
    seen.set(String(asset.asset_id), index);
  }
  for (const asset of additions) {
    const existingIndex = seen.get(String(asset.asset_id));
    if (existingIndex == null) {
      seen.set(String(asset.asset_id), merged.length);
      merged.push(asset);
      continue;
    }
    merged[existingIndex] = asset;
  }
  return merged;
}

export function reconcileAssetCollections(primary: MediaAsset[], existing: MediaAsset[]) {
  if (!primary.length) {
    return existing;
  }
  const merged = [...primary];
  const seen = new Set(primary.map((asset) => asset.asset_id));
  for (const asset of existing) {
    if (seen.has(asset.asset_id)) {
      continue;
    }
    merged.push(asset);
  }
  return merged;
}

export function upsertBatchCollection(collection: MediaBatch[], batch: MediaBatch) {
  const existingIndex = collection.findIndex((entry) => entry.batch_id === batch.batch_id);
  if (existingIndex >= 0) {
    const next = [...collection];
    next[existingIndex] = batch;
    return next.slice(0, 12);
  }
  const next = [...collection, batch];
  next.sort((left, right) => right.created_at.localeCompare(left.created_at));
  return next.slice(0, 12);
}

export function findMediaAssetById(assetId: string | number | null, ...collections: Array<MediaAsset[] | null | undefined>) {
  if (assetId == null) {
    return null;
  }
  const normalizedAssetId = String(assetId);
  for (const collection of collections) {
    const asset = collection?.find((entry) => String(entry.asset_id) === normalizedAssetId) ?? null;
    if (asset) {
      return asset;
    }
  }
  return null;
}

export function mediaAssetPrompt(asset?: MediaAsset | null, job?: MediaJob | null) {
  return job?.final_prompt_used ?? job?.enhanced_prompt ?? job?.raw_prompt ?? asset?.prompt_summary ?? null;
}

export function structuredPresetInputValues(job?: MediaJob | null) {
  const metadataPrepared = isRecord(job?.prepared?.metadata) ? (job?.prepared?.metadata as Record<string, unknown>) : null;
  const metadataNormalized = isRecord(job?.normalized_request?.metadata)
    ? (job?.normalized_request?.metadata as Record<string, unknown>)
    : null;
  const preparedInputs = isRecord(job?.prepared?.preset_inputs_json) ? (job?.prepared?.preset_inputs_json as Record<string, unknown>) : null;
  const metadataInputs = isRecord(metadataPrepared?.preset_inputs)
    ? (metadataPrepared?.preset_inputs as Record<string, unknown>)
    : isRecord(metadataNormalized?.preset_inputs)
      ? (metadataNormalized?.preset_inputs as Record<string, unknown>)
      : isRecord(metadataPrepared?.preset_text_values)
        ? (metadataPrepared?.preset_text_values as Record<string, unknown>)
        : isRecord(metadataNormalized?.preset_text_values)
          ? (metadataNormalized?.preset_text_values as Record<string, unknown>)
      : null;
  const source = metadataInputs ?? preparedInputs;
  if (!source) {
    return {} as Record<string, string>;
  }
  return Object.fromEntries(Object.entries(source).map(([key, value]) => [key, String(value ?? "").trim()]));
}

export function structuredPresetInputValuesFromAsset(asset?: MediaAsset | null) {
  const payload = isRecord(asset?.payload) ? (asset?.payload as Record<string, unknown>) : null;
  const source = isRecord(payload?.preset_inputs)
    ? (payload?.preset_inputs as Record<string, unknown>)
    : isRecord(payload?.preset_text_values)
      ? (payload?.preset_text_values as Record<string, unknown>)
      : null;
  if (!source) {
    return {} as Record<string, string>;
  }
  return Object.fromEntries(Object.entries(source).map(([key, value]) => [key, String(value ?? "").trim()]));
}

export function structuredPresetSlotValues(job?: MediaJob | null) {
  if (isRecord(job?.prepared?.preset_slot_values_json)) {
    return job?.prepared?.preset_slot_values_json as Record<string, unknown>;
  }
  if (isRecord(job?.normalized_request?.preset_slot_values_json)) {
    return job?.normalized_request?.preset_slot_values_json as Record<string, unknown>;
  }
  const normalizedRequest = isRecord(job?.normalized_request) ? (job?.normalized_request as Record<string, unknown>) : null;
  const metadata = isRecord(normalizedRequest?.metadata) ? (normalizedRequest?.metadata as Record<string, unknown>) : null;
  const slotKeys = Array.isArray(metadata?.preset_slot_keys)
    ? (metadata?.preset_slot_keys as unknown[]).map((value) => String(value ?? "").trim()).filter(Boolean)
    : [];
  const images = Array.isArray(normalizedRequest?.images) ? (normalizedRequest?.images as unknown[]) : [];
  if (slotKeys.length && images.length) {
    const inferred = Object.fromEntries(
      slotKeys.map((slotKey, index) => {
        const image = images[index];
        return [
          slotKey,
          isRecord(image)
            ? [
                {
                  path: typeof image.path === "string" ? image.path : null,
                  url: typeof image.url === "string" ? image.url : null,
                },
              ]
            : [],
        ];
      }),
    );
    return inferred as Record<string, unknown>;
  }
  return {} as Record<string, unknown>;
}

export function structuredPresetSlotValuesFromAsset(asset?: MediaAsset | null) {
  const payload = isRecord(asset?.payload) ? (asset?.payload as Record<string, unknown>) : null;
  if (isRecord(payload?.preset_slot_values)) {
    return payload.preset_slot_values as Record<string, unknown>;
  }
  return {} as Record<string, unknown>;
}

export function backgroundLabel(index: number) {
  const labels = [
    "Recent still",
    "Library frame",
    "Queued render",
    "Source image",
    "Video poster",
    "Artifact preview",
  ];
  return labels[index % labels.length] ?? "Media tile";
}

function jobHasPublishedAsset(job: MediaJob, assets: MediaAsset[]) {
  return assets.some((asset) => asset.job_id === job.job_id);
}

function inferBatchJobGenerationKind(job: MediaJob, batch: MediaBatch, previewAsset: MediaAsset | null) {
  if (previewAsset?.generation_kind === "video") {
    return "video";
  }
  if (previewAsset?.generation_kind === "image") {
    return "image";
  }
  const modelKey = String(job.model_key ?? batch.model_key ?? "").toLowerCase();
  const taskMode = String(job.task_mode ?? batch.task_mode ?? "").toLowerCase();
  if (
    modelKey.startsWith("kling-") ||
    modelKey.startsWith("seedance-") ||
    taskMode.includes("video") ||
    taskMode === "motion_control"
  ) {
    return "video";
  }
  return "image";
}

export function buildGalleryTiles(
  assets: MediaAsset[],
  latestAsset: MediaAsset | null,
  batches: MediaBatch[],
  allAssets: MediaAsset[],
  hasMoreAssets: boolean,
  allowLatestFallback: boolean,
  filters: GalleryTileFilters = {},
): GalleryTile[] {
  const source = assets.length ? assets : allowLatestFallback && latestAsset ? [latestAsset] : [];
  const tiles: GalleryTile[] = [];
  const seenJobIds = new Set<string>();
  const seenAssetIds = new Set<string>();
  const activeModelFilter = filters.modelKey && filters.modelKey !== "all" ? filters.modelKey : null;
  const activeKindFilter = filters.generationKind && filters.generationKind !== "all" ? filters.generationKind : null;
  const favoritesOnly = Boolean(filters.favoritesOnly);

  for (const batch of favoritesOnly ? [] : batches.slice(0, 3)) {
    const pendingJobs = (batch.jobs ?? []).filter((job) => {
      const previewAsset = allAssets.find((asset) => asset.job_id === job.job_id) ?? null;
      const publishedAsset = previewAsset ? jobHasPublishedAsset(job, allAssets) : false;
      const resolvedModelKey = String(job.model_key ?? batch.model_key ?? "");
      const resolvedGenerationKind = inferBatchJobGenerationKind(job, batch, previewAsset);
      if (activeModelFilter && resolvedModelKey !== activeModelFilter) {
        return false;
      }
      if (activeKindFilter && resolvedGenerationKind !== activeKindFilter) {
        return false;
      }
      if (publishedAsset) {
        return false;
      }
      if (["queued", "submitted", "running", "processing"].includes(job.status)) {
        return true;
      }
      if (job.status === "failed") {
        return true;
      }
      const finalState = String((job.final_status as Record<string, unknown> | null | undefined)?.state ?? "").toLowerCase();
      return finalState === "succeeded";
    });
    for (const job of pendingJobs) {
      if (seenJobIds.has(job.job_id)) {
        continue;
      }
      seenJobIds.add(job.job_id);
      const previewAsset = allAssets.find((asset) => asset.job_id === job.job_id) ?? null;
      if (previewAsset?.asset_id != null) {
        seenAssetIds.add(String(previewAsset.asset_id));
      }
      const finalState = String((job.final_status as Record<string, unknown> | null | undefined)?.state ?? "").toLowerCase();
      tiles.push({
        asset: previewAsset,
        label:
          job.status === "queued"
            ? "Queued output"
            : job.status === "failed"
              ? "Failed output"
            : finalState === "succeeded" || job.status === "completed"
              ? "Publishing output"
              : "Processing output",
        batch,
        job,
      });
    }
  }

  if (!source.length) {
    return tiles;
  }

  for (const asset of source) {
    if (seenAssetIds.has(String(asset.asset_id))) {
      continue;
    }
    seenAssetIds.add(String(asset.asset_id));
    tiles.push({
      asset,
      label: backgroundLabel(tiles.length),
      batch: null,
      job: null,
    });
  }

  return tiles;
}

export function createOptimisticBatch({
  modelKey,
  taskMode,
  requestedOutputs,
  sourceAssetId,
  requestedPresetKey,
  promptSummary,
  runningSlotsAvailable,
}: {
  modelKey: string;
  taskMode: string | null;
  requestedOutputs: number;
  sourceAssetId: string | number | null;
  requestedPresetKey: string | null;
  promptSummary: string;
  runningSlotsAvailable: number;
}): MediaBatch {
  const createdAt = new Date().toISOString();
  const batchId = `optimistic-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
  const runningCount = Math.min(Math.max(0, runningSlotsAvailable), requestedOutputs);
  const queuedCount = Math.max(0, requestedOutputs - runningCount);
  const jobs: MediaJob[] = Array.from({ length: requestedOutputs }, (_, index) => {
    const isRunning = index < runningCount;
    return {
      job_id: `${batchId}-job-${index + 1}`,
      batch_id: batchId,
      batch_index: index + 1,
      requested_outputs: requestedOutputs,
      status: isRunning ? "processing" : "queued",
      queued_at: createdAt,
      started_at: isRunning ? createdAt : null,
      finished_at: null,
      scheduler_attempts: 0,
      last_polled_at: null,
      queue_position: isRunning ? null : index - runningCount + 1,
      model_key: modelKey,
      task_mode: taskMode,
      source_asset_id: sourceAssetId,
      created_at: createdAt,
      updated_at: createdAt,
      requested_preset_key: requestedPresetKey,
    };
  });

  return {
    batch_id: batchId,
    status: runningCount > 0 ? "processing" : "queued",
    model_key: modelKey,
    task_mode: taskMode,
    requested_outputs: requestedOutputs,
    queued_count: queuedCount,
    running_count: runningCount,
    completed_count: 0,
    failed_count: 0,
    cancelled_count: 0,
    source_asset_id: sourceAssetId,
    requested_preset_key: requestedPresetKey,
    resolved_preset_key: requestedPresetKey,
    preset_source: requestedPresetKey ? "db_custom" : null,
    request_summary: {
      prompt_summary: promptSummary,
      output_count: requestedOutputs,
      optimistic: true,
    },
    jobs,
    created_at: createdAt,
    updated_at: createdAt,
    finished_at: null,
  };
}

export function selectedPromptObjects(selectedPromptIds: string[], prompts: MediaSystemPrompt[]) {
  const selected = new Set(selectedPromptIds);
  return prompts.filter((prompt) => selected.has(prompt.prompt_id));
}

export function presetRequirementMessage(
  preset: MediaPreset | null,
  attachments: AttachmentKindCarrier[],
  sourceAsset: MediaAsset | null,
) {
  if (!preset) {
    return null;
  }
  const hasImage = Boolean(sourceAsset) || attachments.some((attachment) => attachment.kind === "images");
  const hasVideo = attachments.some((attachment) => attachment.kind === "videos");
  const hasAudio = attachments.some((attachment) => attachment.kind === "audios");
  if (preset.requires_image && !hasImage) {
    return `The preset ${preset.label} requires at least one image.`;
  }
  if (preset.requires_video && !hasVideo) {
    return `The preset ${preset.label} requires at least one video.`;
  }
  if (preset.requires_audio && !hasAudio) {
    return `The preset ${preset.label} requires at least one audio file.`;
  }
  return null;
}
