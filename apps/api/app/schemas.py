from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, model_validator


class HealthResponse(BaseModel):
    status: str
    app: str
    supervisor: Optional[str] = None
    queue_enabled: bool = True
    queued_jobs: int = 0
    running_jobs: int = 0
    last_scheduler_tick: Optional[str] = None
    pricing_source: Optional[str] = None
    issues: List[str] = Field(default_factory=list)


class MediaRefInput(BaseModel):
    url: Optional[str] = None
    path: Optional[str] = None
    filename: Optional[str] = None
    mime_type: Optional[str] = None


class QueueSettingsResponse(BaseModel):
    setting_id: int = 1
    max_concurrent_jobs: int
    queue_enabled: bool
    default_poll_seconds: int
    max_retry_attempts: int


class QueueSettingsUpdate(BaseModel):
    max_concurrent_jobs: Optional[int] = None
    queue_enabled: Optional[bool] = None
    default_poll_seconds: Optional[int] = None
    max_retry_attempts: Optional[int] = None


class ModelQueuePolicyResponse(BaseModel):
    model_key: str
    enabled: bool
    max_outputs_per_run: int


class ModelQueuePolicyUpdate(BaseModel):
    enabled: Optional[bool] = None
    max_outputs_per_run: Optional[int] = None


class ModelSummary(BaseModel):
    key: str
    label: str
    provider_model: Optional[str] = None
    task_modes: List[str] = Field(default_factory=list)
    media_types: List[str] = Field(default_factory=list)
    supports_output_count: bool = True
    raw: Dict[str, Any] = Field(default_factory=dict)


class PricingResponse(BaseModel):
    refreshed_at: Optional[str] = None
    source: str = "unavailable"
    entries: List[Dict[str, Any]] = Field(default_factory=list)


class CreditsResponse(BaseModel):
    available_credits: Optional[float] = None
    raw: Dict[str, Any] = Field(default_factory=dict)


class TextFieldConfig(BaseModel):
    key: str
    label: str
    placeholder: Optional[str] = None
    default_value: Optional[str] = None
    required: bool = False


class ImageSlotConfig(BaseModel):
    key: str
    label: str
    max_files: int = 1
    help_text: Optional[str] = None
    required: bool = False


class PresetUpsertRequest(BaseModel):
    key: str
    label: str
    description: Optional[str] = None
    status: str = "active"
    model_key: Optional[str] = None
    source_kind: str = "custom"
    base_builtin_key: Optional[str] = None
    applies_to_models: List[str] = Field(default_factory=list)
    applies_to_models_json: List[str] = Field(default_factory=list)
    applies_to_task_modes: List[str] = Field(default_factory=list)
    applies_to_task_modes_json: List[str] = Field(default_factory=list)
    applies_to_input_patterns: List[str] = Field(default_factory=list)
    applies_to_input_patterns_json: List[str] = Field(default_factory=list)
    prompt_template: Optional[str] = None
    system_prompt_template: Optional[str] = None
    system_prompt_ids: List[str] = Field(default_factory=list)
    default_options_json: Dict[str, Any] = Field(default_factory=dict)
    rules_json: Dict[str, Any] = Field(default_factory=dict)
    requires_image: bool = False
    requires_video: bool = False
    requires_audio: bool = False
    input_schema_json: List[Dict[str, Any]] = Field(default_factory=list)
    input_slots_json: List[Dict[str, Any]] = Field(default_factory=list)
    choice_groups_json: List[Dict[str, Any]] = Field(default_factory=list)
    thumbnail_path: Optional[str] = None
    thumbnail_url: Optional[str] = None
    notes: Optional[str] = None
    version: str = "v1"
    priority: int = 100

    @model_validator(mode="before")
    @classmethod
    def normalize_scope_fields(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        merged = dict(data)
        if not merged.get("applies_to_models") and merged.get("applies_to_models_json"):
            merged["applies_to_models"] = merged["applies_to_models_json"]
        if not merged.get("applies_to_task_modes") and merged.get("applies_to_task_modes_json"):
            merged["applies_to_task_modes"] = merged["applies_to_task_modes_json"]
        if not merged.get("applies_to_input_patterns") and merged.get("applies_to_input_patterns_json"):
            merged["applies_to_input_patterns"] = merged["applies_to_input_patterns_json"]
        return merged


class PresetRecord(BaseModel):
    preset_id: str
    key: str
    label: str
    description: Optional[str] = None
    status: str = "active"
    model_key: Optional[str] = None
    source_kind: str = "custom"
    base_builtin_key: Optional[str] = None
    applies_to_models: List[str] = Field(default_factory=list)
    applies_to_models_json: List[str] = Field(default_factory=list)
    applies_to_task_modes: List[str] = Field(default_factory=list)
    applies_to_task_modes_json: List[str] = Field(default_factory=list)
    applies_to_input_patterns: List[str] = Field(default_factory=list)
    applies_to_input_patterns_json: List[str] = Field(default_factory=list)
    prompt_template: Optional[str] = None
    system_prompt_template: Optional[str] = None
    system_prompt_ids_json: List[str] = Field(default_factory=list)
    default_options_json: Dict[str, Any] = Field(default_factory=dict)
    rules_json: Dict[str, Any] = Field(default_factory=dict)
    requires_image: bool = False
    requires_video: bool = False
    requires_audio: bool = False
    input_schema_json: List[Dict[str, Any]] = Field(default_factory=list)
    input_slots_json: List[Dict[str, Any]] = Field(default_factory=list)
    choice_groups_json: List[Dict[str, Any]] = Field(default_factory=list)
    thumbnail_path: Optional[str] = None
    thumbnail_url: Optional[str] = None
    notes: Optional[str] = None
    version: Optional[str] = None
    priority: int = 100
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

    @model_validator(mode="before")
    @classmethod
    def mirror_scope_fields(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        merged = dict(data)
        applies_to_models = merged.get("applies_to_models") or merged.get("applies_to_models_json") or []
        applies_to_task_modes = merged.get("applies_to_task_modes") or merged.get("applies_to_task_modes_json") or []
        applies_to_input_patterns = (
            merged.get("applies_to_input_patterns") or merged.get("applies_to_input_patterns_json") or []
        )
        merged["applies_to_models"] = applies_to_models
        merged["applies_to_models_json"] = applies_to_models
        merged["applies_to_task_modes"] = applies_to_task_modes
        merged["applies_to_task_modes_json"] = applies_to_task_modes
        merged["applies_to_input_patterns"] = applies_to_input_patterns
        merged["applies_to_input_patterns_json"] = applies_to_input_patterns
        return merged


class SystemPromptUpsertRequest(BaseModel):
    key: str
    label: str
    status: str = "active"
    content: str
    role_tag: Optional[str] = None
    applies_to_models_json: List[str] = Field(default_factory=list)
    applies_to_task_modes_json: List[str] = Field(default_factory=list)
    applies_to_input_patterns_json: List[str] = Field(default_factory=list)


class SystemPromptRecord(BaseModel):
    prompt_id: str
    key: str
    label: str
    status: str = "active"
    content: str
    role_tag: Optional[str] = None
    applies_to_models_json: List[str] = Field(default_factory=list)
    applies_to_task_modes_json: List[str] = Field(default_factory=list)
    applies_to_input_patterns_json: List[str] = Field(default_factory=list)
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class EnhancementConfigUpsertRequest(BaseModel):
    model_key: str
    label: str
    helper_profile: Optional[str] = None
    provider_kind: str = "builtin"
    provider_label: Optional[str] = None
    provider_model_id: Optional[str] = None
    provider_api_key: Optional[str] = None
    provider_base_url: Optional[str] = None
    provider_supports_images: bool = False
    provider_status: Optional[str] = None
    provider_last_tested_at: Optional[str] = None
    provider_capabilities_json: Dict[str, Any] = Field(default_factory=dict)
    system_prompt: Optional[str] = None
    image_analysis_prompt: Optional[str] = None
    supports_text_enhancement: bool = True
    supports_image_analysis: bool = False


class EnhancementConfigRecord(BaseModel):
    config_id: str
    model_key: str
    label: str
    helper_profile: Optional[str] = None
    provider_kind: str = "builtin"
    provider_label: Optional[str] = None
    provider_model_id: Optional[str] = None
    provider_api_key: Optional[str] = None
    provider_base_url: Optional[str] = None
    provider_supports_images: bool = False
    provider_status: Optional[str] = None
    provider_last_tested_at: Optional[str] = None
    provider_capabilities_json: Dict[str, Any] = Field(default_factory=dict)
    system_prompt: Optional[str] = None
    image_analysis_prompt: Optional[str] = None
    supports_text_enhancement: bool = True
    supports_image_analysis: bool = False
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class EnhancementProviderModel(BaseModel):
    id: str
    label: str
    provider: str
    supports_images: bool = False
    input_modalities: List[str] = Field(default_factory=list)
    raw: Dict[str, Any] = Field(default_factory=dict)


class EnhancementProviderProbeRequest(BaseModel):
    provider_kind: str
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    selected_model_id: Optional[str] = None
    require_images: bool = False


class EnhancementProviderProbeResponse(BaseModel):
    ok: bool = True
    provider: str
    credential_source: Optional[str] = None
    selected_model: Optional[EnhancementProviderModel] = None
    available_models: List[EnhancementProviderModel] = Field(default_factory=list)


class PromptContextRequest(BaseModel):
    model_key: str
    task_mode: Optional[str] = None
    prompt: Optional[str] = None
    images: List[MediaRefInput] = Field(default_factory=list)
    videos: List[MediaRefInput] = Field(default_factory=list)
    audios: List[MediaRefInput] = Field(default_factory=list)
    options: Dict[str, Any] = Field(default_factory=dict)
    prompt_profile_key: Optional[str] = None
    system_prompt_override: Optional[str] = None


class PromptContextResponse(BaseModel):
    prompt_context: Dict[str, Any]


class ValidateRequest(BaseModel):
    model_key: str
    task_mode: Optional[str] = None
    prompt: Optional[str] = None
    images: List[MediaRefInput] = Field(default_factory=list)
    videos: List[MediaRefInput] = Field(default_factory=list)
    audios: List[MediaRefInput] = Field(default_factory=list)
    options: Dict[str, Any] = Field(default_factory=dict)
    preset_id: Optional[str] = None
    preset_text_values: Dict[str, str] = Field(default_factory=dict)
    preset_image_slots: Dict[str, List[MediaRefInput]] = Field(default_factory=dict)
    selected_system_prompt_ids: List[str] = Field(default_factory=list)
    source_asset_id: Optional[str] = None
    output_count: int = 1
    enhance: Optional[bool] = None
    prompt_policy: Optional[str] = None
    prompt_profile_key: Optional[str] = None
    system_prompt_override: Optional[str] = None


class ValidateResponse(BaseModel):
    prompt_context: Dict[str, Any]
    validation: Dict[str, Any]
    preflight: Dict[str, Any]
    final_prompt: Optional[str] = None
    resolved_options: Dict[str, Any] = Field(default_factory=dict)
    warnings: List[str] = Field(default_factory=list)


class EnhancePreviewRequest(ValidateRequest):
    pass


class EnhancePreviewResponse(BaseModel):
    prompt_context: Dict[str, Any]
    enhancement: Dict[str, Any]
    validation: Dict[str, Any]
    raw_prompt: Optional[str] = None
    enhanced_prompt: Optional[str] = None
    final_prompt_used: Optional[str] = None
    image_analysis: Optional[Any] = None
    warnings: List[str] = Field(default_factory=list)
    enhancement_config: Optional[EnhancementConfigRecord] = None
    provider_kind: Optional[str] = None
    provider_label: Optional[str] = None
    provider_model_id: Optional[str] = None
    resolved_options: Dict[str, Any] = Field(default_factory=dict)


class JobSubmitRequest(ValidateRequest):
    pass


class JobRecord(BaseModel):
    job_id: str
    batch_id: str
    batch_index: int
    provider_task_id: Optional[str] = None
    status: str
    queued_at: Optional[str] = None
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    scheduler_attempts: int = 0
    last_polled_at: Optional[str] = None
    queue_position: Optional[int] = None
    model_key: str
    task_mode: Optional[str] = None
    source_asset_id: Optional[str] = None
    requested_preset_key: Optional[str] = None
    resolved_preset_key: Optional[str] = None
    preset_source: Optional[str] = None
    raw_prompt: Optional[str] = None
    enhanced_prompt: Optional[str] = None
    final_prompt_used: Optional[str] = None
    selected_system_prompt_ids_json: List[str] = Field(default_factory=list)
    selected_system_prompts_json: List[Dict[str, Any]] = Field(default_factory=list)
    resolved_system_prompt_json: Dict[str, Any] = Field(default_factory=dict)
    resolved_options_json: Dict[str, Any] = Field(default_factory=dict)
    normalized_request_json: Dict[str, Any] = Field(default_factory=dict)
    prompt_context_json: Dict[str, Any] = Field(default_factory=dict)
    validation_json: Dict[str, Any] = Field(default_factory=dict)
    preflight_json: Dict[str, Any] = Field(default_factory=dict)
    prepared_json: Dict[str, Any] = Field(default_factory=dict)
    submit_response_json: Dict[str, Any] = Field(default_factory=dict)
    final_status_json: Dict[str, Any] = Field(default_factory=dict)
    artifact_json: Dict[str, Any] = Field(default_factory=dict)
    error: Optional[str] = None
    dismissed: bool = False
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class BatchRecord(BaseModel):
    batch_id: str
    status: str
    model_key: str
    task_mode: Optional[str] = None
    requested_outputs: int
    queued_count: int = 0
    running_count: int = 0
    completed_count: int = 0
    failed_count: int = 0
    cancelled_count: int = 0
    source_asset_id: Optional[str] = None
    requested_preset_key: Optional[str] = None
    resolved_preset_key: Optional[str] = None
    preset_source: Optional[str] = None
    request_summary_json: Dict[str, Any] = Field(default_factory=dict)
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class JobEventRecord(BaseModel):
    event_id: str
    job_id: str
    event_type: str
    payload_json: Dict[str, Any] = Field(default_factory=dict)
    created_at: Optional[str] = None


class AssetRecord(BaseModel):
    asset_id: str
    job_id: str
    provider_task_id: Optional[str] = None
    run_id: Optional[str] = None
    source_asset_id: Optional[str] = None
    generation_kind: Optional[str] = None
    favorited: bool = False
    favorited_at: Optional[str] = None
    dismissed: bool = False
    created_at: Optional[str] = None
    model_key: str
    status: str
    task_mode: Optional[str] = None
    prompt_summary: Optional[str] = None
    artifact_run_dir: Optional[str] = None
    manifest_path: Optional[str] = None
    run_json_path: Optional[str] = None
    hero_original_path: Optional[str] = None
    hero_web_path: Optional[str] = None
    hero_thumb_path: Optional[str] = None
    hero_poster_path: Optional[str] = None
    remote_output_url: Optional[str] = None
    preset_key: Optional[str] = None
    preset_source: Optional[str] = None
    tags_json: List[str] = Field(default_factory=list)
    payload_json: Dict[str, Any] = Field(default_factory=dict)


class AssetListResponse(BaseModel):
    items: List[AssetRecord] = Field(default_factory=list)
    next_cursor: Optional[str] = None


class JobsListResponse(BaseModel):
    items: List[JobRecord] = Field(default_factory=list)


class JobEventsResponse(BaseModel):
    items: List[JobEventRecord] = Field(default_factory=list)


class BatchesListResponse(BaseModel):
    items: List[BatchRecord] = Field(default_factory=list)


class SubmitResponse(BaseModel):
    batch: BatchRecord
    jobs: List[JobRecord]
