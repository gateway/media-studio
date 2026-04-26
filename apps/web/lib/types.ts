export type NewsItem = {
  item_id: string;
  source_id?: string | null;
  title: string;
  url: string;
  permalink?: string | null;
  published_at?: string | null;
  age_hours?: number | null;
  rank_score?: number | null;
  source_label?: string | null;
  source_type?: string | null;
  author?: string | null;
  summary?: string | null;
  why_it_matters?: string | null;
  dashboard_priority?: string | null;
  dashboard_section_label?: string | null;
  themes?: string[] | null;
  llm_model_used?: string | null;
};

export type NewsArtifact = {
  schema_version: string;
  generated_at: string;
  window?: {
    hours?: number;
    start_at?: string;
    end_at?: string;
  };
  run?: {
    run_id?: string;
    day_key?: string;
    status?: string;
    error_count?: number;
  };
  summary: {
    headline: string;
    top_themes?: string[];
    brief_bullets: string[];
  };
  runtime?: {
    summarization_provider?: string | null;
    summarization_base_url?: string | null;
    llm_model_requested?: string | null;
    llm_model_used?: string | null;
  };
  dashboard?: {
    sections?: Array<{
      section_id: string;
      label: string;
      item_count: number;
      top_item_title?: string | null;
      top_item_url?: string | null;
    }>;
    item_count?: number;
  };
  top_items: NewsItem[];
  source_stats?: Array<{
    source_id: string;
    label: string;
    type: string;
    fetched_count: number;
    kept_count: number;
    error?: string | null;
    last_fetch_at?: string | null;
    duration_ms?: number | null;
  }>;
};

export type NewsManifest = {
  schema_version: string;
  generated_at: string;
  day_key: string;
  run_id: string;
  summarization_provider?: string | null;
  llm_model_requested?: string | null;
  llm_model_used?: string | null;
  summary_json?: string | null;
  summary_markdown?: string | null;
};

export type NewsManagedSource = {
  source_id: string;
  kind: "subreddit" | "rss";
  label: string;
  value: string;
  normalized_value: string;
  enabled: boolean;
  status: "healthy" | "degraded" | "disabled";
  weight: number;
  tags?: string[];
  last_fetch_at?: string | null;
  last_error?: string | null;
  last_error_at?: string | null;
  consecutive_failures?: number;
  last_fetched_count?: number;
  last_kept_count?: number;
  disabled_reason?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type NewsSourceListResponse = {
  ok?: boolean;
  sources: NewsManagedSource[];
};

export type NewsTopicPreference = {
  topic: string;
  weight: number;
  origin: "explicit" | "llm-inferred";
  updated_at?: string | null;
};

export type NewsProfileSnapshot = {
  snapshot_id: string;
  status: "ready" | "failed" | "superseded";
  model?: string | null;
  reused_loaded_runtime?: boolean;
  loaded_temporarily?: boolean;
  feedback_window?: number;
  profile?: {
    liked_topics?: string[];
    disliked_topics?: string[];
    liked_sources?: unknown[];
    disliked_sources?: unknown[];
    suggested_sources?: unknown[];
    confidence_notes?: string[];
    ranking_hints?: Record<string, unknown>;
    raw_response_excerpt?: string;
  } | null;
  created_at?: string | null;
};

export type NewsProfileResponse = {
  ok?: boolean;
  latest_snapshot?: NewsProfileSnapshot | null;
  topic_preferences: NewsTopicPreference[];
  top_positive_topics: NewsTopicPreference[];
  top_negative_topics: NewsTopicPreference[];
  source_preferences?: Array<{
    source_id: string;
    score: number;
    hidden: boolean;
  }>;
};

export type NewsSuggestion = {
  suggestion_id: string;
  kind: "subreddit" | "rss";
  label: string;
  value: string;
  normalized_value: string;
  reason?: string | null;
  confidence: number;
  status: "pending" | "approved" | "rejected" | "archived";
  snapshot_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type NewsSuggestionsResponse = {
  ok?: boolean;
  suggestions: NewsSuggestion[];
};

export type NewsHealthResponse = {
  ok?: boolean;
  counts?: {
    sources_total: number;
    healthy_sources: number;
    degraded_sources: number;
    disabled_sources: number;
    pending_suggestions: number;
  };
  degraded_sources: NewsManagedSource[];
  disabled_sources: NewsManagedSource[];
  latest_profile_snapshot?: NewsProfileSnapshot | null;
};

export type ControlApiStatus = {
  ok?: boolean;
  data?: {
    desired_runtime?: Record<
      string,
      {
        mode: "running" | "stopped";
        profile?: string | null;
        residency?: "none" | "temporary" | "pinned";
        updated_at?: string;
        source?: string | null;
      }
    >;
    asr?: {
      service: string;
      status: string;
      pid?: number | null;
      profile?: string | null;
      host?: string | null;
      port?: number | null;
      health_http?: number | null;
      model_id?: string | null;
      forced_aligner_id?: string | null;
      dtype?: string | null;
      rss_kb?: number | null;
      mem_pct?: number | null;
    };
    llm?: {
      service: string;
      status: string;
      pid?: number | null;
      profile?: string | null;
      host?: string | null;
      port?: number | null;
      health_http?: number | null;
      model_path?: string | null;
      ctx_size?: number | null;
      rss_kb?: number | null;
      mem_pct?: number | null;
    };
    tts?: {
      service: string;
      status: string;
      pid?: number | null;
      profile?: string | null;
      host?: string | null;
      port?: number | null;
      health_http?: number | null;
    };
    open_webui?: {
      status?: string;
      port?: number | null;
    };
  };
};

export type QueueActiveJob = {
  job_id: string;
  domain: "operation" | "voice";
  kind: string;
  subsystem: "llm" | "tts" | "asr";
  status: string;
  created_at: string;
  started_at?: string | null;
  required_runtime_profile?: string | null;
  status_message?: string | null;
};

export type RuntimeLeaseInfo = {
  service: "llm" | "tts" | "asr";
  profile?: string | null;
  residency: "none" | "temporary" | "pinned";
  source?: string | null;
  owner_job_id?: string | null;
  last_used_at?: string | null;
  unload_after?: string | null;
};

export type QueueSummaryResponse = {
  ok?: boolean;
  queued_jobs: number;
  current_job?: QueueActiveJob | null;
  leases?: RuntimeLeaseInfo[];
  counts_by_subsystem?: Record<string, number>;
};

export type LlmHelperCapabilities = {
  profile: string;
  supports_prompt_enhancement: boolean;
  supports_images: boolean;
  supports_multimodal_prompt_enhancement: boolean;
};

export type ModelListResponse = {
  data?: Array<{
    id: string;
    object: string;
    meta?: {
      n_ctx_train?: number | null;
      n_params?: number | null;
      size?: number | null;
    };
    capabilities?: string[];
  }>;
  models?: Array<{
    model?: string;
    name?: string;
    capabilities?: string[];
  }>;
  helper_capabilities?: LlmHelperCapabilities;
};

export type LlmPreset = {
  profile: string;
  cataloged: boolean;
  label: string;
  category: string;
  summary: string;
  use_cases: string[];
  model_family: string;
  model_file: string;
  quantization: string;
  context_size: number;
  thinking_enabled: boolean;
  default: boolean;
  recommended: boolean;
  memory_note: string;
  benchmark_note: string;
  supports_prompt_enhancement: boolean;
  supports_images: boolean;
  supports_multimodal_prompt_enhancement: boolean;
};

export type LlmPresetsResponse = {
  current?: string;
  default_profile?: string;
  presets: LlmPreset[];
};

export type ProfileListResponse = {
  current?: string | null;
  profiles: string[];
};

export type AsrPreset = {
  profile: string;
  model_key?: string | null;
  label: string;
  summary: string;
  use_cases: string[];
  model_id: string;
  runtime_profile: string;
  dtype: string;
  timestamps_enabled: boolean;
  default: boolean;
  recommended: boolean;
  memory_note: string;
  benchmark_note: string;
};

export type AsrPresetCatalogResponse = {
  current?: string | null;
  default_profile?: string;
  presets: AsrPreset[];
};

export type AsrModelCapabilities = {
  supports_file_upload: boolean;
  supports_microphone: boolean;
  supports_url_ingest: boolean;
  supports_timestamps: boolean;
  supports_word_timing: boolean;
  supports_segment_timing: boolean;
  supports_forced_alignment: boolean;
  supports_streaming: boolean;
  supports_transcript_postprocess: boolean;
  supports_native_summary: boolean;
  supports_native_structured_output: boolean;
  supports_language_override: boolean;
  supports_context_prompt: boolean;
  supports_speaker_diarization: boolean;
};

export type AsrModelMode = {
  mode_id: "transcribe" | "transcribe_timestamps" | "force_align" | "stream_live";
  label: string;
  description: string;
};

export type AsrModelForms = {
  source_options: string[];
  output_formats: string[];
  summary_modes: string[];
};

export type AsrModel = {
  model_key: string;
  label: string;
  runtime_profile: string;
  model_id: string;
  summary: string;
  default: boolean;
  recommended: boolean;
  capabilities: AsrModelCapabilities;
  forms: AsrModelForms;
  modes: AsrModelMode[];
  help_sections?: Array<{ title: string; body: string }>;
};

export type AsrCatalogResponse = {
  current_profile?: string | null;
  current_model_key?: string | null;
  models: AsrModel[];
};

export type AsrTimedWord = {
  word: string;
  start?: number | null;
  end?: number | null;
};

export type AsrTimedSegment = {
  id?: string | null;
  text: string;
  start?: number | null;
  end?: number | null;
  words?: AsrTimedWord[];
};

export type AsrSummaryRecord = {
  summary_id: string;
  session_id: string;
  prompt_mode: string;
  llm_profile?: string | null;
  provider_path: string;
  custom_prompt?: string | null;
  output_text?: string | null;
  output_json?: Record<string, unknown> | null;
  artifact_path?: string | null;
  created_at: string;
};

export type AsrSessionRecord = {
  session_id: string;
  created_at: string;
  updated_at: string;
  source_kind: "file" | "microphone" | "url";
  source_label?: string | null;
  source_url?: string | null;
  audio_artifact_path?: string | null;
  normalized_audio_artifact_path?: string | null;
  transcript_json_path?: string | null;
  plain_text_path?: string | null;
  srt_path?: string | null;
  vtt_path?: string | null;
  waveform_peaks_path?: string | null;
  alignment_json_path?: string | null;
  model_key?: string | null;
  model_id?: string | null;
  runtime_profile?: string | null;
  mode_used?: string | null;
  language?: string | null;
  context_prompt?: string | null;
  timestamps_enabled: boolean;
  alignment_used: boolean;
  summary_status?: string | null;
  job_id?: string | null;
  duration_ms?: number | null;
  metadata_json?: Record<string, unknown>;
};

export type AsrTranscriptResponse = {
  session_id?: string | null;
  text: string;
  words?: AsrTimedWord[] | null;
  segments?: AsrTimedSegment[] | null;
  duration?: number | null;
  language?: string | null;
  source_kind?: string | null;
  audio_url?: string | null;
  downloads: Record<string, string>;
  model: Record<string, string | null | undefined>;
  mode?: string | null;
  metrics?: Record<string, unknown>;
  summaries?: AsrSummaryRecord[];
  artifacts?: Record<string, unknown>;
};

export type AsrSessionResponse = {
  ok?: boolean;
  session: AsrSessionRecord;
  transcript?: AsrTranscriptResponse | null;
};

export type AsrSessionListResponse = {
  ok?: boolean;
  sessions: AsrSessionRecord[];
};

export type AsrSummaryListResponse = {
  ok?: boolean;
  summaries: AsrSummaryRecord[];
};

export type TtsPreset = {
  preset_id: string;
  label: string;
  mode: string;
  summary: string;
  use_cases: string[];
  model_id: string;
  runtime_profile: string;
  quality_tier: string;
  validated: boolean;
  notes?: string | null;
  voices?: string[] | null;
};

export type TtsPresetsResponse = {
  defaults?: {
    base?: string;
    clone?: string;
    design?: string;
  };
  presets: TtsPreset[];
};

export type TtsProfilesResponse = {
  current?: string | null;
  profiles?: string[];
};

export type TtsStudioModelCapabilities = {
  supports_text_input: boolean;
  supports_built_in_voices: boolean;
  supports_saved_voice_playback: boolean;
  supports_design_prompt: boolean;
  supports_reference_transcript: boolean;
  supports_reference_audio_upload: boolean;
  supports_trim_controls: boolean;
  supports_inline_control?: boolean;
  supports_multi_speaker_tags?: boolean;
  supports_voice_design?: boolean;
  supports_voice_cloning?: boolean;
  supports_prompt_enhancement?: boolean;
};

export type TtsStudioHelpSection = {
  title: string;
  body: string;
  examples: string[];
};

export type TtsStudioModel = {
  model_key: string;
  label: string;
  runtime_profile: string;
  model_id: string;
  summary: string;
  built_in_voices: string[];
  presets: TtsPreset[];
  generate_presets?: TtsPreset[];
  capabilities: TtsStudioModelCapabilities;
  help_sections?: TtsStudioHelpSection[];
};

export type TtsStudioMode = {
  mode_id: "base" | "design" | "clone";
  label: string;
  description: string;
  models: TtsStudioModel[];
};

export type TtsStudioCatalogResponse = {
  current_profile?: string | null;
  current_mode?: "base" | "design" | "clone" | null;
  modes: TtsStudioMode[];
};

export type OperationJob = {
  job_id: string;
  kind: string;
  status: "queued" | "running" | "completed" | "failed" | string;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
  progress_percent?: number | null;
  stage?: string | null;
  status_message?: string | null;
  queue_position?: number | null;
  subsystem?: "llm" | "tts" | "asr" | null;
  required_runtime_profile?: string | null;
  runtime_residency?: "none" | "temporary" | "pinned" | null;
  request?: Record<string, unknown> | null;
  result?: (Record<string, unknown> & {
    metrics?: {
      started_at?: string | null;
      finished_at?: string | null;
      elapsed_ms?: number | null;
      model_id?: string | null;
      runtime_profile?: string | null;
      ctx_size?: number | null;
      input_chars?: number | null;
      output_chars?: number | null;
      input_bytes?: number | null;
      artifact_duration_ms?: number | null;
      memory_rss_kb?: number | null;
      memory_mem_pct?: number | null;
      prompt_tokens?: number | null;
      completion_tokens?: number | null;
      total_tokens?: number | null;
      source_filename?: string | null;
      health_http?: number | null;
    } | null;
  }) | null;
  error?: string | null;
};

export type OperationJobResponse = {
  ok?: boolean;
  job: OperationJob;
};

export type OperationJobListResponse = {
  ok?: boolean;
  jobs?: OperationJob[];
};

export type VoiceAsset = {
  voice_id: string;
  name: string;
  kind: "clone" | "design" | string;
  model_id: string;
  ref_audio_path: string;
  ref_text: string;
  created_at: string;
  notes?: Record<string, unknown> | null;
};

export type VoicesResponse = {
  voices: VoiceAsset[];
};

export type VoiceJob = {
  job_id: string;
  kind: string;
  status: string;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
  progress_percent?: number | null;
  stage?: string | null;
  status_message?: string | null;
  request?: {
    voice_id?: string | null;
    text?: string | null;
    mode?: string | null;
    preset_id?: string | null;
    model_id?: string | null;
    voice?: string | null;
    name?: string | null;
    source_filename?: string | null;
    trim_start_seconds?: number | null;
    trim_duration_seconds?: number | null;
  } | null;
  result?: {
    ok?: boolean;
    voice_id?: string | null;
    artifact_path?: string | null;
    artifact_url?: string | null;
    log_excerpt?: string | null;
    model_id?: string | null;
    mode?: string | null;
    name?: string | null;
    kind?: string | null;
    ref_audio_path?: string | null;
    metrics?: {
      started_at?: string | null;
      finished_at?: string | null;
      elapsed_ms?: number | null;
      model_id?: string | null;
      runtime_profile?: string | null;
      input_chars?: number | null;
      reference_chars?: number | null;
      design_prompt_chars?: number | null;
      artifact_duration_ms?: number | null;
      artifact_size_bytes?: number | null;
      sample_rate_hz?: number | null;
      channels?: number | null;
      memory_rss_kb?: number | null;
      memory_mem_pct?: number | null;
      health_http?: number | null;
      pid?: number | null;
    } | null;
  } | null;
  error?: string | null;
};

export type VoiceJobsResponse = {
  ok?: boolean;
  jobs?: VoiceJob[];
};

export type SkillCatalog = {
  generated_at?: string;
  total_skills?: number;
  categories?: Array<{
    name: string;
    count: number;
  }>;
  skills?: Array<{
    name: string;
    category: string;
    subsystem?: string;
    description?: string;
  }>;
};

export type ResearchArtifact = {
  schema_version: string;
  generated_at: string;
  request: {
    request_id: string | null;
    origin: string | null;
    response_mode: string;
    requested_by: string | null;
  };
  source: {
    source_kind: string | null;
    url: string | null;
    path: string | null;
    title: string | null;
    site_name: string | null;
    original_filename?: string | null;
  };
  summary: {
    headline: string;
    brief: string;
    key_points: string[];
    user_instructions_applied: string | null;
    markdown?: string | null;
  };
  artifacts: {
    history_path: string | null;
    extracted_text_artifact: string | null;
    markdown_artifact: string | null;
  };
  runtime: {
    provider_runtime: string | null;
    model_requested: string | null;
    model_used: string | null;
    endpoint: string | null;
    execution_path: string | null;
    warnings: string[];
  };
  warnings: string[];
};

export type MediaPreset = {
  preset_id: string;
  key: string;
  label: string;
  description?: string | null;
  status: string;
  model_key?: string | null;
  source_kind: "builtin" | "built_in_override" | "custom" | "imported";
  base_builtin_key?: string | null;
  applies_to_models: string[];
  applies_to_task_modes: string[];
  applies_to_input_patterns: string[];
  prompt_template?: string | null;
  system_prompt_template?: string | null;
  system_prompt_ids?: string[];
  default_options_json?: Record<string, unknown>;
  rules_json?: Record<string, unknown>;
  requires_image?: boolean;
  requires_video?: boolean;
  requires_audio?: boolean;
  input_schema_json?: Array<Record<string, unknown>>;
  input_slots_json?: Array<Record<string, unknown> | string>;
  choice_groups_json?: Array<Record<string, unknown>>;
  thumbnail_path?: string | null;
  thumbnail_url?: string | null;
  notes?: string | null;
  version?: string | null;
  priority?: number;
  created_at?: string | null;
  updated_at?: string | null;
};

export type MediaSystemPrompt = {
  prompt_id: string;
  key: string;
  label: string;
  description?: string | null;
  status: string;
  content: string;
  role_tag: "general" | "first_frame" | "last_frame" | "image_edit" | "motion_control" | string;
  applies_to_models: string[];
  applies_to_task_modes: string[];
  applies_to_input_patterns: string[];
  notes?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type MediaJob = {
  job_id: string;
  batch_id?: string | null;
  project_id?: string | null;
  batch_index?: number;
  requested_outputs?: number;
  status: string;
  queued_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  scheduler_attempts?: number;
  last_polled_at?: string | null;
  queue_position?: number | null;
  hidden_from_dashboard?: boolean;
  dismissed_at?: string | null;
  model_key?: string | null;
  task_mode?: string | null;
  provider_task_id?: string | null;
  source_asset_id?: string | number | null;
  created_at: string;
  updated_at: string;
  requested_preset_key?: string | null;
  resolved_preset_key?: string | null;
  preset_source?: string | null;
  raw_prompt?: string | null;
  enhanced_prompt?: string | null;
  final_prompt_used?: string | null;
  selected_system_prompt_ids?: string[];
  selected_system_prompts?: MediaSystemPrompt[];
  resolved_system_prompt?: Record<string, unknown> | null;
  resolved_options?: Record<string, unknown> | null;
  normalized_request?: Record<string, unknown> | null;
  validation?: Record<string, unknown> | null;
  preflight?: Record<string, unknown> | null;
  prepared?: Record<string, unknown> | null;
  error?: string | null;
  artifact?: {
    run_id?: string | null;
    run_dir?: string | null;
    hero_original_path?: string | null;
    hero_web_path?: string | null;
    hero_thumb_path?: string | null;
    hero_poster_path?: string | null;
  } | null;
  final_status?: {
    output_urls?: string[];
  } | null;
};

export type MediaBatch = {
  batch_id: string;
  status: string;
  project_id?: string | null;
  model_key?: string | null;
  task_mode?: string | null;
  requested_outputs: number;
  queued_count: number;
  running_count: number;
  completed_count: number;
  failed_count: number;
  cancelled_count: number;
  source_asset_id?: string | number | null;
  requested_preset_key?: string | null;
  resolved_preset_key?: string | null;
  preset_source?: string | null;
  request_summary?: Record<string, unknown> | null;
  jobs?: MediaJob[];
  created_at: string;
  updated_at: string;
  finished_at?: string | null;
};

export type MediaQueueSettings = {
  max_concurrent_jobs: number;
  queue_enabled: boolean;
  default_poll_seconds: number;
  max_retry_attempts: number;
  created_at?: string | null;
  updated_at?: string | null;
};

export type MediaModelQueuePolicy = {
  model_key: string;
  enabled: boolean;
  max_outputs_per_run: number;
  created_at?: string | null;
  updated_at?: string | null;
};

export type MediaAsset = {
  asset_id: string | number;
  job_id?: string | null;
  project_id?: string | null;
  provider_task_id?: string | null;
  run_id?: string | null;
  source_asset_id?: string | number | null;
  generation_kind?: string | null;
  hidden_from_dashboard?: boolean;
  dismissed_at?: string | null;
  favorited?: boolean;
  favorited_at?: string | null;
  created_at: string;
  model_key?: string | null;
  status?: string | null;
  task_mode?: string | null;
  prompt_summary?: string | null;
  artifact_run_dir?: string | null;
  manifest_path?: string | null;
  run_json_path?: string | null;
  hero_original_path?: string | null;
  hero_web_path?: string | null;
  hero_thumb_path?: string | null;
  hero_poster_path?: string | null;
  hero_original_url?: string | null;
  hero_web_url?: string | null;
  hero_thumb_url?: string | null;
  hero_poster_url?: string | null;
  remote_output_url?: string | null;
  preset_key?: string | null;
  preset_source?: string | null;
  tags?: string[];
  payload?: Record<string, unknown>;
  source_asset?: MediaAsset | null;
};

export type MediaReference = {
  reference_id: string;
  kind: "image" | "video" | "audio";
  status: string;
  attached_project_ids?: string[];
  original_filename?: string | null;
  stored_path: string;
  mime_type?: string | null;
  file_size_bytes: number;
  sha256: string;
  width?: number | null;
  height?: number | null;
  duration_seconds?: number | null;
  thumb_path?: string | null;
  poster_path?: string | null;
  stored_url?: string | null;
  thumb_url?: string | null;
  poster_url?: string | null;
  usage_count: number;
  last_used_at?: string | null;
  metadata?: Record<string, unknown>;
  created_at?: string | null;
  updated_at?: string | null;
};

export type MediaProject = {
  project_id: string;
  name: string;
  description?: string | null;
  status: "active" | "archived" | string;
  hidden_from_global_gallery?: boolean;
  cover_asset_id?: string | null;
  cover_reference_id?: string | null;
  cover_image_url?: string | null;
  cover_thumb_url?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type MediaCreditsResponse = {
  ok?: boolean;
  balance?: {
    available_credits?: number | null;
    remaining_credits?: number | null;
    [key: string]: unknown;
  };
};

export type MediaPricingResponse = {
  ok?: boolean;
  version?: string | null;
  label?: string | null;
  released_on?: string | null;
  refreshed_at?: string | null;
  source?: string;
  source_kind?: string | null;
  source_url?: string | null;
  currency?: string;
  notes?: string[];
  rules?: Record<string, unknown>[];
  cache_status?: string | null;
  is_stale?: boolean;
  refresh_error?: string | null;
  is_authoritative?: boolean;
  pricing_status?: string | null;
  priced_model_keys?: string[];
  missing_model_keys?: string[];
  unmapped_source_rows?: Record<string, unknown>[];
  snapshot?: Record<string, unknown> | null;
};

export type MediaPricingEstimateResponse = {
  ok?: boolean;
  prompt_context?: Record<string, unknown>;
  validation?: Record<string, unknown> | null;
  preflight?: Record<string, unknown>;
  pricing_summary?: Record<string, unknown>;
  refreshed_at?: string | null;
  final_prompt?: string | null;
  resolved_options?: Record<string, unknown>;
  warnings?: string[];
};

export type MediaModelsResponse = {
  ok?: boolean;
  models?: MediaModelSummary[];
};

export type MediaPresetsResponse = {
  ok?: boolean;
  presets?: MediaPreset[];
};

export type MediaProjectsResponse = {
  ok?: boolean;
  projects?: MediaProject[];
};

export type MediaProjectResponse = {
  ok?: boolean;
  project?: MediaProject | null;
};

export type MediaJobsResponse = {
  ok?: boolean;
  jobs?: MediaJob[];
};

export type MediaJobResponse = {
  ok?: boolean;
  job?: MediaJob | null;
  batch?: MediaBatch | null;
};

export type MediaBatchResponse = {
  ok?: boolean;
  batch?: MediaBatch | null;
};

export type MediaBatchesResponse = {
  ok?: boolean;
  batches?: MediaBatch[];
  total?: number;
  limit?: number;
  offset?: number;
};

export type MediaQueueSettingsResponse = {
  ok?: boolean;
  settings?: MediaQueueSettings | null;
};

export type MediaQueuePoliciesResponse = {
  ok?: boolean;
  policies?: MediaModelQueuePolicy[];
};

export type MediaQueuePolicyResponse = {
  ok?: boolean;
  policy?: MediaModelQueuePolicy | null;
};

export type MediaAssetsResponse = {
  ok?: boolean;
  assets?: MediaAsset[];
  limit?: number;
  offset?: number;
  has_more?: boolean;
  next_offset?: number | null;
};

export type MediaAssetResponse = {
  ok?: boolean;
  asset?: MediaAsset | null;
};

export type MediaReferencesResponse = {
  ok?: boolean;
  items?: MediaReference[];
  limit?: number;
  offset?: number;
};

export type MediaReferenceResponse = {
  ok?: boolean;
  item?: MediaReference | null;
};

export type MediaModelSummary = {
  key: string;
  label: string;
  provider_model: string;
  task_modes: string[];
  image_inputs?: Record<string, unknown>;
  video_inputs?: Record<string, unknown>;
  audio_inputs?: Record<string, unknown>;
  input_constraints?: Record<string, unknown>;
  options?: Record<string, unknown>;
  prompt?: Record<string, unknown>;
  input_patterns?: string[];
  generation_kind?: string;
  defaults?: Record<string, unknown>;
  capability_summary?: string[];
  spend_notes?: string[];
  studio_support_status?: "fully_supported" | "generic_supported" | "unsupported";
  studio_supported_input_patterns?: string[];
  studio_unsupported_input_patterns?: string[];
  studio_hidden_reason?: string | null;
  studio_support_summary?: string | null;
  studio_unsupported_option_keys?: string[];
  studio_exposed?: boolean;
};

export type MediaModelDetailResponse = {
  ok?: boolean;
  model: MediaModelSummary;
  presets: MediaPreset[];
  prompts: MediaSystemPrompt[];
};

export type MediaPromptContextResponse = {
  ok?: boolean;
  normalized_request?: Record<string, unknown>;
  prompt_context?: Record<string, unknown>;
  preset_source?: "builtin" | "db_override" | "db_custom";
  selected_system_prompts?: MediaSystemPrompt[];
  resolved_system_prompt?: Record<string, unknown>;
  resolved_options?: Record<string, unknown>;
  enhanced_prompt?: string | null;
  final_prompt_used?: string | null;
  warnings?: string[];
};

export type MediaEnhancementConfig = {
  config_id: string;
  model_key: string;
  status: string;
  label: string;
  helper_profile: string;
  provider_kind?: string;
  provider_label?: string | null;
  provider_model_id?: string | null;
  provider_api_key_configured?: boolean;
  provider_base_url_configured?: boolean;
  provider_credential_source?: string | null;
  provider_supports_images?: boolean;
  provider_status?: string | null;
  provider_last_tested_at?: string | null;
  provider_capabilities_json?: Record<string, unknown>;
  system_prompt: string;
  image_analysis_prompt?: string | null;
  supports_text_enhancement: boolean;
  supports_image_analysis: boolean;
  notes?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type MediaEnhancementConfigResponse = {
  ok?: boolean;
  config: MediaEnhancementConfig;
};

export type MediaEnhancementConfigsResponse = {
  ok?: boolean;
  configs: MediaEnhancementConfig[];
};

export type MediaEnhancementProviderModel = {
  id: string;
  label: string;
  provider: string;
  supports_images: boolean;
  input_modalities: string[];
  raw?: Record<string, unknown>;
};

export type MediaEnhancementProviderProbeResponse = {
  ok?: boolean;
  provider: string;
  credential_source?: string | null;
  selected_model?: MediaEnhancementProviderModel | null;
  available_models: MediaEnhancementProviderModel[];
};

export type MediaEnhancePreviewResponse = {
  ok?: boolean;
  raw_prompt?: string;
  normalized_request?: Record<string, unknown> | null;
  prompt_context?: Record<string, unknown>;
  preset_source?: "builtin" | "db_override" | "db_custom";
  selected_system_prompts?: MediaSystemPrompt[];
  resolved_system_prompt?: Record<string, unknown>;
  resolved_options?: Record<string, unknown>;
  enhancement_config?: MediaEnhancementConfig | null;
  helper_capabilities?: LlmHelperCapabilities | null;
  image_analysis?: Record<string, unknown> | string | null;
  enhanced_prompt?: string | null;
  final_prompt_used?: string | null;
  warnings?: string[];
  compatibility?: Record<string, unknown>;
  validation?: Record<string, unknown>;
  preflight?: Record<string, unknown>;
  provider_kind?: string | null;
  provider_label?: string | null;
  provider_model_id?: string | null;
};

export type MediaValidationResponse = {
  ok?: boolean;
  state: string;
  normalized_request?: Record<string, unknown> | null;
  prompt_context?: Record<string, unknown>;
  preset_source?: "builtin" | "db_override" | "db_custom";
  selected_system_prompts?: MediaSystemPrompt[];
  resolved_system_prompt?: Record<string, unknown>;
  resolved_options?: Record<string, unknown>;
  dynamic_options?: Record<string, unknown>;
  compatibility?: Record<string, unknown>;
  validation?: Record<string, unknown>;
  preflight?: Record<string, unknown>;
  pricing_summary?: Record<string, unknown>;
  warnings?: string[];
};

export type MediaSystemPromptResponse = {
  ok?: boolean;
  prompt: MediaSystemPrompt;
};

export type MediaSystemPromptsResponse = {
  ok?: boolean;
  prompts: MediaSystemPrompt[];
};
