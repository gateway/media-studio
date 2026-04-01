import type {
  ControlApiStatus,
  LlmPresetsResponse,
  MediaAsset,
  MediaAssetResponse,
  MediaAssetsResponse,
  MediaBatch,
  MediaBatchResponse,
  MediaBatchesResponse,
  MediaCreditsResponse,
  MediaEnhancementConfig,
  MediaEnhancementConfigResponse,
  MediaEnhancementConfigsResponse,
  MediaEnhancementProviderProbeResponse,
  MediaEnhancePreviewResponse,
  MediaJob,
  MediaJobResponse,
  MediaJobsResponse,
  MediaModelDetailResponse,
  MediaModelsResponse,
  MediaModelQueuePolicy,
  MediaModelSummary,
  MediaPreset,
  MediaPresetsResponse,
  MediaPricingResponse,
  MediaPromptContextResponse,
  MediaQueuePoliciesResponse,
  MediaQueuePolicyResponse,
  MediaQueueSettings,
  MediaQueueSettingsResponse,
  MediaSystemPrompt,
  MediaSystemPromptResponse,
  MediaSystemPromptsResponse,
  MediaValidationResponse,
} from "@/lib/types";

export const CONTROL_API_BASE_URL =
  process.env.NEXT_PUBLIC_MEDIA_STUDIO_CONTROL_API_BASE_URL || "http://127.0.0.1:8000";

function withBase(path: string) {
  return `${CONTROL_API_BASE_URL}${path}`;
}

export function toControlApiProxyPath(pathValue: string | null | undefined) {
  if (!pathValue || !pathValue.startsWith("/files/")) {
    return null;
  }
  return `/api/control/files${pathValue.slice("/files".length)}`;
}

export function toControlApiDataProxyPath(filePath: string | null | undefined) {
  if (!filePath) {
    return null;
  }
  const normalized = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
  return `/api/control/files/${normalized}`;
}

async function fetchControlApiResponse(endpoint: string, init?: RequestInit) {
  try {
    const response = await fetch(withBase(endpoint), {
      ...init,
      cache: "no-store",
      next: { revalidate: 0 },
    });
    if (!response.ok) {
      let detail = "";
      try {
        const payload = (await response.clone().json()) as { detail?: string; error?: string; message?: string };
        detail = payload.error || payload.detail || payload.message || "";
      } catch {
        detail = "";
      }
      return {
        ok: false as const,
        response: null,
        error: detail || `Control API returned ${response.status} for ${endpoint}.`,
      };
    }
    return { ok: true as const, response, error: null };
  } catch {
    return { ok: false as const, response: null, error: "The Control API is unavailable right now." };
  }
}

async function fetchControlApiJson<T>(endpoint: string) {
  const result = await fetchControlApiResponse(endpoint);
  if (!result.ok || !result.response) {
    return { ok: false as const, data: null, error: result.error };
  }
  return { ok: true as const, data: (await result.response.json()) as T, error: null };
}

export async function getControlApiJson<T>(endpoint: string, _authMode?: "read" | "admin") {
  return fetchControlApiJson<T>(endpoint);
}

export async function sendControlApiJson<T>(
  endpoint: string,
  {
    method = "POST",
    payload = null,
    authMode: _authMode,
  }: {
    method?: "POST" | "PATCH" | "DELETE";
    payload?: Record<string, unknown> | null;
    authMode?: "read" | "admin";
  } = {},
) {
  const result = await fetchControlApiResponse(endpoint, {
    method,
    headers: payload ? { "Content-Type": "application/json" } : undefined,
    body: payload ? JSON.stringify(payload) : undefined,
  });
  if (!result.ok || !result.response) {
    return { ok: false as const, data: null, error: result.error };
  }
  try {
    return { ok: true as const, data: (await result.response.json()) as T, error: null };
  } catch {
    return { ok: true as const, data: null as T | null, error: null };
  }
}

export async function postControlApiJson<T>(
  endpoint: string,
  payload: Record<string, unknown> | null,
  _authMode?: "read" | "admin",
) {
  return sendControlApiJson<T>(endpoint, { method: "POST", payload });
}

export async function getControlApiFile(pathSegments: string[]) {
  return fetchControlApiResponse(`/media/files/${pathSegments.join("/")}`);
}

function deriveInputPatterns(model: Record<string, any>): string[] {
  const key = String(model.key ?? "");
  if (key === "kling-2.6-i2v") return ["single_image"];
  if (key === "kling-2.6-t2v") return ["prompt_only"];
  if (key === "kling-3.0-i2v") return ["single_image", "first_last_frames"];
  if (key === "kling-3.0-motion") return ["motion_control"];
  if (key === "kling-3.0-t2v") return ["prompt_only"];
  if (key === "nano-banana-2" || key === "nano-banana-pro") return ["prompt_only", "single_image", "image_edit"];
  return [];
}

function deriveGenerationKind(model: Record<string, any>) {
  const modes = (model.task_modes ?? []) as string[];
  if (modes.some((mode) => mode.includes("video") || mode === "motion_control")) {
    return "video";
  }
  return "image";
}

export function mapModelRecord(model: Record<string, any>): MediaModelSummary {
  const raw = model.raw ?? {};
  return {
    key: model.key,
    label: model.label,
    provider_model: model.provider_model,
    task_modes: model.task_modes ?? [],
    image_inputs: raw.inputs?.image ?? null,
    video_inputs: raw.inputs?.video ?? null,
    audio_inputs: raw.inputs?.audio ?? null,
    input_constraints: raw.input_constraints ?? null,
    options: raw.options ?? null,
    prompt: raw.prompt ?? null,
    input_patterns: deriveInputPatterns(model),
    generation_kind: deriveGenerationKind(model),
    defaults: raw.defaults ?? {},
    capability_summary: model.media_types ?? [],
    spend_notes: [],
  };
}

export function mapPresetRecord(preset: Record<string, any>): MediaPreset {
  const appliesToModels = preset.applies_to_models_json ?? preset.applies_to_models ?? [];
  const appliesToTaskModes = preset.applies_to_task_modes_json ?? preset.applies_to_task_modes ?? [];
  const appliesToInputPatterns = preset.applies_to_input_patterns_json ?? preset.applies_to_input_patterns ?? [];
  const systemPromptIds = preset.system_prompt_ids_json ?? preset.system_prompt_ids ?? [];
  return {
    preset_id: String(preset.preset_id),
    key: String(preset.key),
    label: String(preset.label),
    description: preset.description ?? null,
    status: String(preset.status ?? "active"),
    model_key: preset.model_key ?? null,
    source_kind: (preset.source_kind ?? "custom") as "builtin" | "built_in_override" | "custom",
    base_builtin_key: preset.base_builtin_key ?? null,
    applies_to_models: appliesToModels,
    applies_to_task_modes: appliesToTaskModes,
    applies_to_input_patterns: appliesToInputPatterns,
    prompt_template: preset.prompt_template ?? null,
    system_prompt_template: preset.system_prompt_template ?? null,
    system_prompt_ids: systemPromptIds,
    input_schema_json: preset.input_schema_json ?? [],
    input_slots_json: preset.input_slots_json ?? [],
    choice_groups_json: preset.choice_groups_json ?? [],
    default_options_json: preset.default_options_json ?? {},
    rules_json: preset.rules_json ?? {},
    requires_image: Boolean(preset.requires_image),
    requires_video: Boolean(preset.requires_video),
    requires_audio: Boolean(preset.requires_audio),
    thumbnail_path: preset.thumbnail_path ?? null,
    thumbnail_url: preset.thumbnail_url ?? null,
    notes: preset.notes ?? null,
    version: preset.version ?? null,
    priority: Number(preset.priority ?? 100),
    created_at: preset.created_at ?? null,
    updated_at: preset.updated_at ?? null,
  };
}

export function mapPromptRecord(prompt: Record<string, any>): MediaSystemPrompt {
  return {
    prompt_id: String(prompt.prompt_id),
    key: String(prompt.key),
    label: String(prompt.label),
    description: prompt.description ?? null,
    status: String(prompt.status ?? "active"),
    content: String(prompt.content ?? ""),
    role_tag: String(prompt.role_tag ?? "general"),
    applies_to_models: prompt.applies_to_models_json ?? [],
    applies_to_task_modes: prompt.applies_to_task_modes_json ?? [],
    applies_to_input_patterns: prompt.applies_to_input_patterns_json ?? [],
    notes: null,
    created_at: prompt.created_at ?? null,
    updated_at: prompt.updated_at ?? null,
  };
}

export function mapEnhancementConfigRecord(config: Record<string, any>): MediaEnhancementConfig {
  return {
    config_id: String(config.config_id ?? config.model_key),
    model_key: String(config.model_key),
    status: config.status ?? "active",
    label: String(config.label ?? config.model_key),
    helper_profile: String(config.helper_profile ?? ""),
    provider_kind: String(config.provider_kind ?? "builtin"),
    provider_label: config.provider_label ?? null,
    provider_model_id: config.provider_model_id ?? null,
    provider_api_key: config.provider_api_key ?? null,
    provider_base_url: config.provider_base_url ?? null,
    provider_supports_images: Boolean(config.provider_supports_images),
    provider_status: config.provider_status ?? null,
    provider_last_tested_at: config.provider_last_tested_at ?? null,
    provider_capabilities_json: config.provider_capabilities_json ?? {},
    system_prompt: String(config.system_prompt ?? ""),
    image_analysis_prompt: config.image_analysis_prompt ?? null,
    supports_text_enhancement: Boolean(config.supports_text_enhancement),
    supports_image_analysis: Boolean(config.supports_image_analysis),
    notes: config.notes ?? null,
    created_at: config.created_at ?? null,
    updated_at: config.updated_at ?? null,
  };
}

function asProxyUrl(pathValue: unknown) {
  if (typeof pathValue !== "string" || !pathValue) {
    return null;
  }
  return `/files/${pathValue.replace(/^\/+/, "")}`;
}

export function mapJobRecord(job: Record<string, any>): MediaJob {
  const artifact = job.artifact_json
    ? {
        run_id: job.artifact_json.run_id ?? null,
        run_dir: job.artifact_json.run_dir ?? null,
        hero_original_path: job.hero_original_path ?? null,
        hero_web_path: job.hero_web_path ?? null,
        hero_thumb_path: job.hero_thumb_path ?? null,
        hero_poster_path: job.hero_poster_path ?? null,
      }
    : null;
  return {
    job_id: String(job.job_id),
    batch_id: job.batch_id ?? null,
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
    artifact,
    final_status: job.final_status_json ?? null,
  };
}

export function mapAssetRecord(asset: Record<string, any>): MediaAsset {
  return {
    ...asset,
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

export function mapBatchRecord(batch: Record<string, any>, jobs: MediaJob[]): MediaBatch {
  return {
    batch_id: String(batch.batch_id),
    status: String(batch.status),
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
      ...(batch.request_summary_json ?? {}),
      prompt_summary: batch.request_summary_json?.prompt ?? batch.request_summary_json?.prompt_summary ?? null,
    },
    jobs: jobs.filter((job) => job.batch_id === batch.batch_id),
    created_at: String(batch.created_at),
    updated_at: String(batch.updated_at),
    finished_at: null,
  };
}

export function mapQueueSettingsRecord(settings: Record<string, any>): MediaQueueSettings {
  return {
    max_concurrent_jobs: settings.max_concurrent_jobs,
    queue_enabled: settings.queue_enabled,
    default_poll_seconds: settings.default_poll_seconds,
    max_retry_attempts: settings.max_retry_attempts,
    created_at: settings.updated_at ?? null,
    updated_at: settings.updated_at ?? null,
  };
}

export function mapQueuePolicyRecord(policy: Record<string, any>): MediaModelQueuePolicy {
  return {
    model_key: policy.model_key,
    enabled: policy.enabled,
    max_outputs_per_run: policy.max_outputs_per_run,
    created_at: policy.updated_at ?? null,
    updated_at: policy.updated_at ?? null,
  };
}

export function mapValidationResponseRecord(payload: Record<string, any>): MediaValidationResponse {
  return {
    ok: true,
    state: payload.validation?.state ?? "unknown",
    normalized_request: payload.validation?.normalized_request ?? null,
    prompt_context: payload.prompt_context ?? null,
    preset_source: payload.prompt_context?.resolution_source ?? undefined,
    selected_system_prompts: payload.prompt_context?.selected_system_prompts ?? [],
    resolved_system_prompt: payload.prompt_context ?? null,
    resolved_options: payload.resolved_options ?? {},
    dynamic_options: {},
    compatibility: {},
    validation: payload.validation ?? null,
    preflight: payload.preflight ?? null,
    warnings: payload.warnings ?? payload.preflight?.warnings ?? [],
  };
}

export function mapEnhancePreviewResponseRecord(payload: Record<string, any>): MediaEnhancePreviewResponse {
  return {
    ok: true,
    raw_prompt: payload.raw_prompt ?? payload.prompt_context?.raw_prompt ?? "",
    normalized_request: payload.validation?.normalized_request ?? null,
    prompt_context: payload.prompt_context ?? null,
    preset_source: payload.prompt_context?.resolution_source ?? undefined,
    selected_system_prompts: payload.prompt_context?.selected_system_prompts ?? [],
    resolved_system_prompt: payload.prompt_context ?? null,
    resolved_options: payload.resolved_options ?? {},
    enhancement_config: payload.enhancement_config ?? null,
    helper_capabilities: payload.helper_capabilities ?? null,
    image_analysis: payload.image_analysis ?? null,
    enhanced_prompt: payload.enhanced_prompt ?? null,
    final_prompt_used: payload.final_prompt_used ?? null,
    warnings: payload.warnings ?? [],
    compatibility: {},
    validation: payload.validation ?? null,
    preflight: payload.preflight ?? null,
    provider_kind: payload.provider_kind ?? payload.enhancement_config?.provider_kind ?? null,
    provider_label: payload.provider_label ?? payload.enhancement_config?.provider_label ?? null,
    provider_model_id: payload.provider_model_id ?? payload.enhancement_config?.provider_model_id ?? null,
  };
}

export async function getControlPlaneSnapshot() {
  const health = await fetchControlApiJson<Record<string, any>>("/health");
  const status: ControlApiStatus = { ok: health.ok, data: health.data ?? undefined };
  const llmPresets: LlmPresetsResponse = { presets: [] };
  const ttsPresets = { ok: true, presets: [] };
  const models = await fetchControlApiJson<any[]>("/media/models");
  return {
    status: { ok: status.ok, data: status.data },
    llmPresets,
    ttsPresets,
    models: { ok: models.ok, data: { models: (models.data ?? []).map(mapModelRecord) } },
  };
}

export async function getMediaDashboardSnapshot(options?: { batchesLimit?: number; batchesOffset?: number }) {
  const batchesLimit = options?.batchesLimit ?? 8;
  const batchesOffset = options?.batchesOffset ?? 0;
  const [health, credits, pricing, modelsRaw, presetsRaw, promptsRaw, enhancementRaw, queueSettingsRaw, queuePoliciesRaw, batchesRaw, jobsRaw, assetsRaw, latestAssetRaw] =
    await Promise.all([
      fetchControlApiJson<Record<string, any>>("/health"),
      fetchControlApiJson<Record<string, any>>("/media/credits"),
      fetchControlApiJson<Record<string, any>>("/media/pricing"),
      fetchControlApiJson<any[]>("/media/models"),
      fetchControlApiJson<any[]>("/media/presets"),
      fetchControlApiJson<any[]>("/media/system-prompts"),
      fetchControlApiJson<any[]>("/media/enhancement-configs"),
      fetchControlApiJson<Record<string, any>>("/media/queue/settings"),
      fetchControlApiJson<any[]>("/media/queue/policies"),
      fetchControlApiJson<Record<string, any>>(`/media/batches?limit=${batchesLimit}&offset=${batchesOffset}`),
      fetchControlApiJson<Record<string, any>>("/media/jobs?limit=8"),
      fetchControlApiJson<Record<string, any>>("/media/assets?limit=12"),
      fetchControlApiJson<Record<string, any>>("/media/assets/latest"),
    ]);

  const models = (modelsRaw.data ?? []).map(mapModelRecord);
  const presets = (presetsRaw.data ?? []).map(mapPresetRecord);
  const prompts = (promptsRaw.data ?? []).map(mapPromptRecord);
  const enhancementConfigs = (enhancementRaw.data ?? []).map(mapEnhancementConfigRecord);
  const jobs = ((jobsRaw.data?.items ?? []) as Record<string, any>[]).map(mapJobRecord);
  const assets = ((assetsRaw.data?.items ?? []) as Record<string, any>[]).map(mapAssetRecord);
  const batches = ((batchesRaw.data?.items ?? []) as Record<string, any>[]).map((batch) =>
    mapBatchRecord(
      batch,
      Array.isArray(batch.jobs) ? (batch.jobs as Record<string, any>[]).map(mapJobRecord) : jobs,
    ),
  );

  return {
    status: { ok: health.ok, data: health.data ?? undefined },
    credits: {
      ok: credits.ok,
      data: {
        balance: {
          available_credits: credits.data?.available_credits ?? null,
          remaining_credits: credits.data?.available_credits ?? null,
        },
      },
    },
    pricing: { ok: pricing.ok, data: { snapshot: pricing.data ?? null } },
    models: { ok: modelsRaw.ok, data: { models } as MediaModelsResponse },
    presets: { ok: presetsRaw.ok, data: { presets } as MediaPresetsResponse },
    prompts: { ok: promptsRaw.ok, data: { prompts } as MediaSystemPromptsResponse },
    enhancementConfigs: { ok: enhancementRaw.ok, data: { configs: enhancementConfigs } as MediaEnhancementConfigsResponse },
    llmPresets: { ok: true, data: { presets: [] as any[] } as LlmPresetsResponse },
    queueSettings: { ok: queueSettingsRaw.ok, data: { settings: queueSettingsRaw.data ? mapQueueSettingsRecord(queueSettingsRaw.data) : null } as MediaQueueSettingsResponse },
    queuePolicies: { ok: queuePoliciesRaw.ok, data: { policies: (queuePoliciesRaw.data ?? []).map(mapQueuePolicyRecord) } as MediaQueuePoliciesResponse },
    batches: {
      ok: batchesRaw.ok,
      data: {
        batches,
        total: Number(batchesRaw.data?.total ?? batches.length),
        limit: Number(batchesRaw.data?.limit ?? batchesLimit),
        offset: Number(batchesRaw.data?.offset ?? batchesOffset),
      } as MediaBatchesResponse,
    },
    jobs: { ok: jobsRaw.ok, data: { jobs } as MediaJobsResponse },
    assets: {
      ok: assetsRaw.ok,
      data: {
        assets,
        limit: 12,
        offset: 0,
        has_more: Boolean(assetsRaw.data?.next_cursor),
        next_offset: null,
      } as MediaAssetsResponse,
    },
    latestAsset: {
      ok: latestAssetRaw.ok,
      data: { asset: latestAssetRaw.data ? mapAssetRecord(latestAssetRaw.data) : null } as MediaAssetResponse,
    },
  };
}

export async function getMediaBatch(batchId: string) {
  const [batchRaw, jobsRaw] = await Promise.all([
    fetchControlApiJson<Record<string, any>>(`/media/batches/${batchId}`),
    fetchControlApiJson<Record<string, any>>("/media/jobs?limit=100"),
  ]);
  const jobs = ((jobsRaw.data?.items ?? []) as Record<string, any>[]).map(mapJobRecord);
  const batch = batchRaw.data ? mapBatchRecord(batchRaw.data, jobs) : null;
  return { ok: batchRaw.ok, data: { batch } as MediaBatchResponse, error: batchRaw.error };
}

export async function getMediaQueueSettings() {
  const payload = await fetchControlApiJson<Record<string, any>>("/media/queue/settings");
  return { ok: payload.ok, data: { settings: payload.data ? mapQueueSettingsRecord(payload.data) : null } as MediaQueueSettingsResponse, error: payload.error };
}

export async function updateMediaQueueSettings(payload: Record<string, unknown>) {
  const result = await sendControlApiJson<Record<string, any>>("/media/queue/settings", { method: "PATCH", payload });
  return { ok: result.ok, data: { settings: result.data ? mapQueueSettingsRecord(result.data) : null } as MediaQueueSettingsResponse, error: result.error };
}

export async function updateMediaQueuePolicy(modelKey: string, payload: Record<string, unknown>) {
  const result = await sendControlApiJson<Record<string, any>>(`/media/queue/policies/${modelKey}`, { method: "PATCH", payload });
  return { ok: result.ok, data: { policy: result.data ? mapQueuePolicyRecord(result.data) : null } as MediaQueuePolicyResponse, error: result.error };
}

export async function getMediaModelDetail(modelKey: string) {
  const [modelRaw, presetsRaw, promptsRaw] = await Promise.all([
    fetchControlApiJson<Record<string, any>>(`/media/models/${modelKey}`),
    fetchControlApiJson<any[]>("/media/presets"),
    fetchControlApiJson<any[]>("/media/system-prompts"),
  ]);
  return {
    ok: modelRaw.ok,
    data: {
      model: modelRaw.data ? mapModelRecord(modelRaw.data) : null,
      presets: (presetsRaw.data ?? []).map(mapPresetRecord).filter((preset) => !preset.model_key || preset.model_key === modelKey),
      prompts: (promptsRaw.data ?? []).map(mapPromptRecord),
    } as MediaModelDetailResponse,
    error: modelRaw.error,
  };
}

export async function getMediaPromptsSnapshot() {
  const [models, prompts, presets] = await Promise.all([
    fetchControlApiJson<any[]>("/media/models"),
    fetchControlApiJson<any[]>("/media/system-prompts"),
    fetchControlApiJson<any[]>("/media/presets"),
  ]);
  return {
    models: { ok: models.ok, data: { models: (models.data ?? []).map(mapModelRecord) } },
    prompts: { ok: prompts.ok, data: { prompts: (prompts.data ?? []).map(mapPromptRecord) } },
    presets: { ok: presets.ok, data: { presets: (presets.data ?? []).map(mapPresetRecord) } },
  };
}

export async function validateMediaRequest(payload: Record<string, unknown>) {
  return postControlApiJson<MediaValidationResponse>("/media/validate", payload);
}

export async function getMediaPromptContext(payload: Record<string, unknown>) {
  return postControlApiJson<MediaPromptContextResponse>("/media/prompt-context", payload);
}

export async function getMediaEnhancementPreview(payload: Record<string, unknown>) {
  return postControlApiJson<MediaEnhancePreviewResponse>("/media/enhance/preview", payload);
}

export async function createMediaEnhancementConfig(payload: Record<string, unknown>) {
  return postControlApiJson<MediaEnhancementConfigResponse>("/media/enhancement-configs", payload);
}

export async function updateMediaEnhancementConfig(modelKey: string, payload: Record<string, unknown>) {
  return sendControlApiJson<MediaEnhancementConfigResponse>(`/media/enhancement-configs/${modelKey}`, {
    method: "PATCH",
    payload,
  });
}

export async function archiveMediaEnhancementConfig(modelKey: string) {
  return sendControlApiJson<MediaEnhancementConfigResponse>(`/media/enhancement-configs/${modelKey}`, { method: "DELETE" });
}

export async function probeMediaEnhancementProvider(payload: Record<string, unknown>) {
  return postControlApiJson<MediaEnhancementProviderProbeResponse>("/media/enhancement/providers/probe", payload);
}

export async function createMediaPrompt(payload: Record<string, unknown>) {
  return postControlApiJson<MediaSystemPromptResponse>("/media/system-prompts", payload);
}

export async function updateMediaPrompt(promptId: string, payload: Record<string, unknown>) {
  return sendControlApiJson<MediaSystemPromptResponse>(`/media/system-prompts/${promptId}`, { method: "PATCH", payload });
}

export async function archiveMediaPrompt(promptId: string) {
  return sendControlApiJson<MediaSystemPromptResponse>(`/media/system-prompts/${promptId}`, { method: "DELETE" });
}

export async function createMediaPreset(payload: Record<string, unknown>) {
  return postControlApiJson<MediaPresetsResponse | { preset: unknown }>("/media/presets", payload);
}

export async function updateMediaPreset(presetId: string, payload: Record<string, unknown>) {
  return sendControlApiJson<MediaPresetsResponse | { preset: unknown }>(`/media/presets/${presetId}`, { method: "PATCH", payload });
}

export async function archiveMediaPreset(presetId: string) {
  return sendControlApiJson<MediaPresetsResponse | { preset: unknown }>(`/media/presets/${presetId}`, { method: "DELETE" });
}
