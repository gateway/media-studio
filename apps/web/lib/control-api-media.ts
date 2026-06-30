import type {
  MediaAsset,
  MediaAssetPickerItem,
  MediaAssetSummaryItem,
  MediaBatch,
  MediaJob,
  MediaProject,
} from "@/lib/types";
import { toControlApiDataPreviewPath, toControlApiProxyPath } from "@/lib/media-paths";

type ControlApiRawRecord = Record<string, unknown>;
type ControlApiRawList = ControlApiRawRecord[];

function isControlApiRawRecord(value: unknown): value is ControlApiRawRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toControlApiRawRecord(value: unknown): ControlApiRawRecord {
  return isControlApiRawRecord(value) ? value : {};
}

function toControlApiRawList(value: unknown): ControlApiRawList {
  return Array.isArray(value) ? value.filter(isControlApiRawRecord) : [];
}

function positiveInteger(value: unknown): number | null {
  const next = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(next) || next <= 0) return null;
  return Math.round(next);
}

function nonNegativeNumber(value: unknown): number | null {
  const next = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(next) || next < 0) return null;
  return next;
}

function outputDimensions(asset: ControlApiRawRecord): { width: number | null; height: number | null } {
  const directWidth = positiveInteger(asset.width);
  const directHeight = positiveInteger(asset.height);
  if (directWidth && directHeight) {
    return { width: directWidth, height: directHeight };
  }
  const payload = toControlApiRawRecord(asset.payload_json);
  const outputs = toControlApiRawList(payload.outputs);
  for (const output of outputs) {
    const width = positiveInteger(output.width);
    const height = positiveInteger(output.height);
    if (width && height) {
      return { width, height };
    }
  }
  return { width: null, height: null };
}

function outputDurationSeconds(asset: ControlApiRawRecord): number | null {
  const directDuration = nonNegativeNumber(asset.duration_seconds);
  if (directDuration != null) return directDuration;
  const payload = toControlApiRawRecord(asset.payload_json);
  const outputs = toControlApiRawList(payload.outputs);
  for (const output of outputs) {
    const duration = nonNegativeNumber(output.duration_seconds ?? output.durationSeconds);
    if (duration != null) return duration;
  }
  return null;
}

function asProxyUrl(pathValue: unknown) {
  if (typeof pathValue !== "string" || !pathValue) {
    return null;
  }
  return toControlApiProxyPath(pathValue) ?? toControlApiDataPreviewPath(pathValue);
}

export function mapJobRecord(job: ControlApiRawRecord): MediaJob {
  const artifactRecord = toControlApiRawRecord(job.artifact_json);
  const artifact = Object.keys(artifactRecord).length
    ? {
        run_id: artifactRecord.run_id ?? null,
        run_dir: artifactRecord.run_dir ?? null,
        hero_original_path: job.hero_original_path ?? null,
        hero_web_path: job.hero_web_path ?? null,
        hero_thumb_path: job.hero_thumb_path ?? null,
        hero_poster_path: job.hero_poster_path ?? null,
      }
    : null;
  return {
    job_id: String(job.job_id),
    batch_id: job.batch_id ?? null,
    project_id: job.project_id ?? null,
    batch_index: job.batch_index ?? 0,
    requested_outputs: job.requested_outputs ?? 1,
    status: String(job.status),
    queued_at: job.queued_at ?? null,
    started_at: job.started_at ?? null,
    finished_at: job.finished_at ?? null,
    scheduler_attempts: job.scheduler_attempts ?? 0,
    last_polled_at: job.last_polled_at ?? null,
    queue_position: job.queue_position ?? null,
    hidden_from_dashboard: false,
    dismissed_at: job.dismissed ? job.updated_at ?? job.created_at : null,
    model_key: job.model_key ?? null,
    task_mode: job.task_mode ?? null,
    provider_task_id: job.provider_task_id ?? null,
    source_asset_id: job.source_asset_id ?? null,
    created_at: String(job.created_at),
    updated_at: String(job.updated_at),
    requested_preset_key: job.requested_preset_key ?? null,
    resolved_preset_key: job.resolved_preset_key ?? null,
    preset_source: job.preset_source ?? null,
    raw_prompt: job.raw_prompt ?? null,
    enhanced_prompt: job.enhanced_prompt ?? null,
    final_prompt_used: job.final_prompt_used ?? null,
    selected_system_prompt_ids: job.selected_system_prompt_ids_json ?? [],
    selected_system_prompts: job.selected_system_prompts_json ?? [],
    resolved_system_prompt: job.resolved_system_prompt_json ?? null,
    resolved_options: job.resolved_options_json ?? null,
    normalized_request: job.normalized_request_json ?? null,
    validation: job.validation_json ?? null,
    preflight: job.preflight_json ?? null,
    prepared: job.prepared_json ?? null,
    error: job.error ?? null,
    artifact,
    final_status: job.final_status_json ?? null,
  } as MediaJob;
}

export function mapAssetRecord(asset: ControlApiRawRecord): MediaAsset {
  return {
    ...asset,
    project_id: asset.project_id ?? null,
    hidden_from_dashboard: false,
    dismissed_at: asset.dismissed ? asset.created_at : null,
    tags: asset.tags_json ?? [],
    payload: asset.payload_json ?? {},
    source_asset: null,
    hero_original_url: asProxyUrl(asset.hero_original_path),
    hero_web_url: asProxyUrl(asset.hero_web_path),
    hero_thumb_url: asProxyUrl(asset.hero_thumb_path),
    hero_poster_url: asProxyUrl(asset.hero_poster_path),
  } as MediaAsset;
}

export function mapAssetPickerRecord(asset: ControlApiRawRecord): MediaAssetPickerItem {
  const dimensions = outputDimensions(asset);
  return {
    asset_id: asset.asset_id,
    project_id: asset.project_id ?? null,
    generation_kind: asset.generation_kind ?? null,
    created_at: String(asset.created_at),
    model_key: asset.model_key ?? null,
    status: asset.status ?? null,
    task_mode: asset.task_mode ?? null,
    prompt_summary: asset.prompt_summary ?? null,
    hero_original_path: asset.hero_original_path ?? null,
    hero_web_path: asset.hero_web_path ?? null,
    hero_thumb_path: asset.hero_thumb_path ?? null,
    hero_poster_path: asset.hero_poster_path ?? null,
    hero_original_url: asProxyUrl(asset.hero_original_path),
    hero_web_url: asProxyUrl(asset.hero_web_path),
    hero_thumb_url: asProxyUrl(asset.hero_thumb_path),
    hero_poster_url: asProxyUrl(asset.hero_poster_path),
    width: dimensions.width,
    height: dimensions.height,
    duration_seconds: outputDurationSeconds(asset),
  } as MediaAssetPickerItem;
}

export function mapAssetSummaryRecord(asset: ControlApiRawRecord): MediaAssetSummaryItem {
  return {
    ...mapAssetPickerRecord(asset),
    job_id: asset.job_id ?? null,
    project_id: asset.project_id ?? null,
    provider_task_id: asset.provider_task_id ?? null,
    run_id: asset.run_id ?? null,
    source_asset_id: asset.source_asset_id ?? null,
    hidden_from_dashboard: false,
    dismissed_at: asset.dismissed ? asset.created_at : null,
    favorited: Boolean(asset.favorited),
    favorited_at: asset.favorited_at ?? null,
    remote_output_url: asset.remote_output_url ?? null,
    preset_key: asset.preset_key ?? null,
    preset_source: asset.preset_source ?? null,
    tags: asset.tags_json ?? [],
  } as MediaAssetSummaryItem;
}

export function mapBatchRecord(batch: ControlApiRawRecord, jobs: MediaJob[]): MediaBatch {
  const requestSummary = toControlApiRawRecord(batch.request_summary_json);
  return {
    batch_id: String(batch.batch_id),
    status: String(batch.status),
    project_id: batch.project_id ?? null,
    model_key: batch.model_key ?? null,
    task_mode: batch.task_mode ?? null,
    requested_outputs: batch.requested_outputs ?? 1,
    queued_count: batch.queued_count ?? 0,
    running_count: batch.running_count ?? 0,
    completed_count: batch.completed_count ?? 0,
    failed_count: batch.failed_count ?? 0,
    cancelled_count: batch.cancelled_count ?? 0,
    source_asset_id: batch.source_asset_id ?? null,
    requested_preset_key: batch.requested_preset_key ?? null,
    resolved_preset_key: batch.resolved_preset_key ?? null,
    preset_source: batch.preset_source ?? null,
    request_summary: {
      ...requestSummary,
      prompt_summary: requestSummary.prompt ?? requestSummary.prompt_summary ?? null,
    },
    jobs: jobs.filter((job) => job.batch_id === batch.batch_id),
    created_at: String(batch.created_at),
    updated_at: String(batch.updated_at),
    finished_at: batch.finished_at ?? null,
  } as unknown as MediaBatch;
}

export function mapProjectRecord(project: ControlApiRawRecord): MediaProject {
  return {
    project_id: String(project.project_id),
    name: String(project.name ?? ""),
    description: project.description ?? null,
    status: String(project.status ?? "active"),
    hidden_from_global_gallery: Boolean(project.hidden_from_global_gallery),
    cover_asset_id: project.cover_asset_id ?? null,
    cover_reference_id: project.cover_reference_id ?? null,
    cover_image_url: project.cover_image_url ? asProxyUrl(project.cover_image_url) : null,
    cover_thumb_url: project.cover_thumb_url ? asProxyUrl(project.cover_thumb_url) : null,
    created_at: project.created_at ?? null,
    updated_at: project.updated_at ?? null,
  } as MediaProject;
}
