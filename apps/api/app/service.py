from __future__ import annotations

import logging
import mimetypes
import json
import re
import shutil
import subprocess
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter
from collections import Counter
from typing import Any, Dict, List, Optional, Tuple

from PIL import Image, ImageDraw

from . import enhancement_provider, external_llm_usage, kie_adapter, store
from .pricing import attach_pricing_summary
from .service_errors import ServiceError
from .service_provider_config import (
    GLOBAL_ENHANCEMENT_CONFIG_KEY,
    PROMPT_RECIPE_DRAFTING_CONFIG_KEY,
    PROMPT_RECIPE_DRAFTING_DEFAULT_MAX_TOKENS,
    PROMPT_RECIPE_DRAFTING_DEFAULT_TEMPERATURE,
    PROMPT_RECIPE_DRAFTING_PROVIDERS,
    provider_credential_source as _provider_credential_source,
    public_prompt_recipe_drafting_config,
    shared_provider_runtime as _shared_provider_runtime,
)
from .settings import settings
from .schemas import (
    EnhancePreviewRequest,
    EnhancementConfigRecord,
    JobSubmitRequest,
    MediaRefInput,
    PromptRecipeDraftRequest,
    PromptRecipeDraftingConfigUpsertRequest,
    ProjectUpsertRequest,
    PresetUpsertRequest,
    PromptRecipeUpsertRequest,
    SystemPromptUpsertRequest,
    ValidateRequest,
)
from .service_preset_validation import (
    _enforce_output_count_policy,
    _model_accepts_preset_image_values,
    _model_key_supports_structured_preset,
    _preset_image_policy,
    _preset_requires_image,
    upsert_preset,
    validate_preset_payload,
)
from .service_prompt_recipe_validation import (
    _normalize_prompt_recipe_draft_payload,
    upsert_prompt_recipe,
    validate_prompt_recipe_payload,
)
from .service_reference_media import (
    backfill_reference_media,
    import_reference_media_bytes,
    import_reference_media_file,
    import_reference_media_streamed_upload,
    list_available_reference_media,
    sanitize_reference_media_record,
)

ENHANCEMENT_PROVIDER_TIMEOUT_SECONDS = 75
logger = logging.getLogger(__name__)




def upsert_system_prompt(payload: SystemPromptUpsertRequest, prompt_id: Optional[str] = None) -> Dict[str, Any]:
    record = payload.model_dump()
    if prompt_id:
        record["prompt_id"] = prompt_id
    return store.create_or_update_system_prompt(record)


def upsert_enhancement_config(payload: Dict[str, Any], model_key: Optional[str] = None) -> Dict[str, Any]:
    record = payload.copy()
    if model_key:
        record["model_key"] = model_key
    return store.create_or_update_enhancement_config(record)


def validate_project_payload(payload: ProjectUpsertRequest) -> Dict[str, Any]:
    name = str(payload.name or "").strip()
    if not name:
        raise ServiceError("Project name is required.")
    status = str(payload.status or "active").strip().lower() or "active"
    if status not in {"active", "archived"}:
        raise ServiceError("Project status must be active or archived.")
    return {
        "name": name,
        "description": str(payload.description).strip() if payload.description is not None else None,
        "cover_asset_id": str(payload.cover_asset_id).strip() if payload.cover_asset_id else None,
        "cover_reference_id": str(payload.cover_reference_id).strip() if payload.cover_reference_id else None,
        "hidden_from_global_gallery": bool(payload.hidden_from_global_gallery),
        "status": status,
    }


def hydrate_project_record(record: Dict[str, Any]) -> Dict[str, Any]:
    normalized = dict(record)
    cover_reference_id = str(normalized.get("cover_reference_id") or "").strip()
    if cover_reference_id:
        reference = store.get_reference_media(cover_reference_id)
        sanitized = sanitize_reference_media_record(reference) if reference else None
        if sanitized:
            normalized["cover_image_url"] = sanitized.get("stored_path")
            normalized["cover_thumb_url"] = sanitized.get("thumb_path") or sanitized.get("stored_path")
        else:
            normalized["cover_reference_id"] = None
    if not normalized.get("cover_image_url"):
        cover_asset_id = str(normalized.get("cover_asset_id") or "").strip()
        if cover_asset_id:
            asset = store.get_asset(cover_asset_id)
            if asset:
                normalized["cover_image_url"] = (
                    asset.get("hero_web_path")
                    or asset.get("hero_original_path")
                    or asset.get("hero_thumb_path")
                )
                normalized["cover_thumb_url"] = (
                    asset.get("hero_thumb_path")
                    or asset.get("hero_web_path")
                    or asset.get("hero_original_path")
                )
    return normalized


def list_projects(status: Optional[str] = "active") -> List[Dict[str, Any]]:
    return [hydrate_project_record(record) for record in store.list_projects(status=status)]


def get_project(project_id: str) -> Optional[Dict[str, Any]]:
    record = store.get_project(project_id)
    if not record:
        return None
    return hydrate_project_record(record)


def upsert_project(payload: ProjectUpsertRequest, project_id: Optional[str] = None) -> Dict[str, Any]:
    record = validate_project_payload(payload)
    if record.get("cover_asset_id") and not store.get_asset(str(record["cover_asset_id"])):
        raise ServiceError("Selected cover asset could not be found.")
    if record.get("cover_reference_id") and not store.get_reference_media(str(record["cover_reference_id"])):
        raise ServiceError("Selected project image could not be found.")
    if project_id:
        current = store.get_project(project_id)
        if not current:
            raise ServiceError("Project not found.")
        record["project_id"] = project_id
    return hydrate_project_record(store.create_or_update_project(record))


def archive_project(project_id: str) -> Dict[str, Any]:
    try:
        return hydrate_project_record(store.archive_project(project_id))
    except KeyError as exc:
        raise ServiceError("Project not found.") from exc


def unarchive_project(project_id: str) -> Dict[str, Any]:
    try:
        return hydrate_project_record(store.unarchive_project(project_id))
    except KeyError as exc:
        raise ServiceError("Project not found.") from exc


def delete_project(project_id: str, *, permanent: bool = False) -> Optional[Dict[str, Any]]:
    project = store.get_project(project_id)
    if not project:
        raise ServiceError("Project not found.")
    if permanent:
        store.delete_project(project_id)
        return None
    return store.archive_project(project_id)


def require_active_project(project_id: Optional[str]) -> Optional[Dict[str, Any]]:
    if not project_id:
        return None
    project = store.get_project(project_id)
    if not project:
        raise ServiceError("Project not found.")
    if str(project.get("status") or "active") != "active":
        raise ServiceError("Archived projects cannot receive new jobs.")
    return project


def attach_reference_to_project(project_id: str, reference_id: str) -> Dict[str, Any]:
    project = store.get_project(project_id)
    if not project:
        raise ServiceError("Project not found.")
    record = store.get_reference_media(reference_id)
    if not record:
        raise ServiceError("Reference media not found.")
    try:
        return store.attach_reference_to_project(project_id, reference_id)
    except KeyError as exc:
        raise ServiceError("Reference media not found.") from exc


def detach_reference_from_project(project_id: str, reference_id: str) -> Dict[str, Any]:
    project = store.get_project(project_id)
    if not project:
        raise ServiceError("Project not found.")
    try:
        return store.detach_reference_from_project(project_id, reference_id)
    except KeyError as exc:
        raise ServiceError("Reference media not found.") from exc


def public_enhancement_config(record: Dict[str, Any]) -> Dict[str, Any]:
    provider_kind = str(record.get("provider_kind") or "builtin").strip()
    stored_api_key = str(record.get("provider_api_key") or "").strip()
    stored_base_url = str(record.get("provider_base_url") or "").strip()

    credential_source: str | None = None
    if stored_api_key:
        credential_source = "stored"
    elif provider_kind == "openrouter" and settings.openrouter_api_key:
        credential_source = "env"
    elif provider_kind == "local_openai" and settings.local_openai_api_key:
        credential_source = "env"
    elif provider_kind == "codex_local":
        credential_source = enhancement_provider.codex_local_provider.CODEX_LOCAL_PROVIDER_CREDENTIAL_SOURCE

    payload = record.copy()
    payload.pop("provider_api_key", None)
    payload.pop("provider_base_url", None)
    payload["provider_api_key_configured"] = bool(stored_api_key)
    payload["provider_base_url_configured"] = bool(stored_base_url)
    payload["provider_credential_source"] = credential_source
    return EnhancementConfigRecord(**payload).model_dump()


def upsert_prompt_recipe_drafting_config(payload: PromptRecipeDraftingConfigUpsertRequest) -> Dict[str, Any]:
    provider_kind = str(payload.provider_kind or "openrouter").strip()
    if provider_kind not in PROMPT_RECIPE_DRAFTING_PROVIDERS:
        raise ServiceError("Unsupported drafting provider.")
    temperature = max(0.0, min(2.0, float(payload.temperature)))
    max_tokens = max(128, min(4000, int(payload.max_tokens)))
    record = {
        "config_key": PROMPT_RECIPE_DRAFTING_CONFIG_KEY,
        "enabled": bool(payload.enabled),
        "provider_kind": provider_kind,
        "provider_label": str(payload.provider_label or "").strip() or None,
        "provider_model_id": str(payload.provider_model_id or "").strip() or None,
        "provider_base_url": str(payload.provider_base_url or "").strip() or None,
        "provider_supports_images": bool(payload.provider_supports_images),
        "provider_status": str(payload.provider_status or "").strip() or None,
        "provider_last_tested_at": str(payload.provider_last_tested_at or "").strip() or None,
        "provider_capabilities_json": payload.provider_capabilities_json or {},
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    stored = store.create_or_update_prompt_recipe_drafting_config(record)
    return public_prompt_recipe_drafting_config(stored)


def probe_prompt_recipe_drafting_provider(payload: Dict[str, Any]) -> Dict[str, Any]:
    provider_kind = str(payload.get("provider_kind") or "").strip()
    if provider_kind not in PROMPT_RECIPE_DRAFTING_PROVIDERS:
        raise ServiceError("Unsupported drafting provider.")
    current_config = store.get_prompt_recipe_drafting_config(PROMPT_RECIPE_DRAFTING_CONFIG_KEY) or {}
    matching_config = current_config if str(current_config.get("provider_kind") or "").strip() == provider_kind else {}
    runtime = _shared_provider_runtime(
        provider_kind,
        stored_base_url=str(payload.get("provider_base_url") or matching_config.get("provider_base_url") or "").strip() or None,
    )
    selected_model_id = str(payload.get("provider_model_id") or matching_config.get("provider_model_id") or "").strip() or None
    require_images = bool(payload.get("require_images"))
    probe_mode = str(payload.get("probe_mode") or "catalog").strip().lower()
    try:
        if provider_kind == "openrouter":
            bundle = enhancement_provider.test_openrouter_connection(
                api_key=runtime.get("api_key"),
                model_id=selected_model_id,
                require_images=require_images,
                base_url=runtime.get("base_url"),
            )
            bundle["credential_source"] = runtime.get("credential_source")
            return bundle
        if provider_kind == "codex_local":
            bundle = (
                enhancement_provider.test_codex_local_connection(
                    model_id=selected_model_id,
                    require_images=require_images,
                )
                if probe_mode == "full"
                else enhancement_provider.load_codex_local_catalog(
                    model_id=selected_model_id,
                    require_images=require_images,
                    force_refresh=bool(payload.get("force_refresh")),
                )
            )
            bundle["credential_source"] = runtime.get("credential_source")
            return bundle
        bundle = enhancement_provider.test_local_openai_connection(
            base_url=str(runtime.get("base_url") or ""),
            api_key=runtime.get("api_key"),
            model_id=selected_model_id,
            require_images=require_images,
        )
        bundle["credential_source"] = runtime.get("credential_source")
        return bundle
    except enhancement_provider.EnhancementProviderError as exc:
        raise ServiceError(str(exc)) from exc


def generate_prompt_recipe_draft(payload: PromptRecipeDraftRequest) -> Dict[str, Any]:
    idea = str(payload.idea or "").strip()
    if not idea:
        raise ServiceError("Describe the recipe idea before generating a draft.")
    stored_config = store.get_prompt_recipe_drafting_config(PROMPT_RECIPE_DRAFTING_CONFIG_KEY) or {}
    if not bool(stored_config.get("enabled", True)):
        raise ServiceError("Recipe drafting is turned off in AI Settings.")
    provider_kind = str(payload.provider_kind or stored_config.get("provider_kind") or "openrouter").strip()
    matching_config = stored_config if str(stored_config.get("provider_kind") or "").strip() == provider_kind else {}
    provider_model_id = str(payload.provider_model_id or matching_config.get("provider_model_id") or "").strip()
    if provider_kind not in PROMPT_RECIPE_DRAFTING_PROVIDERS:
        raise ServiceError("Unsupported drafting provider.")
    if not provider_model_id:
        raise ServiceError("Configure a Prompt Recipe Drafting model in Settings or provide a draft override model.")
    runtime = _shared_provider_runtime(
        provider_kind,
        stored_base_url=str(payload.provider_base_url or matching_config.get("provider_base_url") or "").strip() or None,
    )
    try:
        if provider_kind == "codex_local":
            provider_result = enhancement_provider.run_codex_local_prompt_recipe_draft(
                model_id=provider_model_id,
                idea=idea,
                category=str(payload.category or "").strip() or None,
                output_format=str(payload.output_format or "").strip() or None,
                image_input_mode=str(payload.image_input_mode or "").strip() or None,
            )
        else:
            provider_result = enhancement_provider.run_openai_compatible_prompt_recipe_draft(
                provider_kind=provider_kind,
                base_url=str(runtime.get("base_url") or ""),
                api_key=str(runtime.get("api_key") or ""),
                model_id=provider_model_id,
                idea=idea,
                category=str(payload.category or "").strip() or None,
                output_format=str(payload.output_format or "").strip() or None,
                image_input_mode=str(payload.image_input_mode or "").strip() or None,
                temperature=float(matching_config.get("temperature") or PROMPT_RECIPE_DRAFTING_DEFAULT_TEMPERATURE),
                max_tokens=int(matching_config.get("max_tokens") or PROMPT_RECIPE_DRAFTING_DEFAULT_MAX_TOKENS),
            )
    except enhancement_provider.EnhancementProviderError as exc:
        raise ServiceError(str(exc)) from exc
    usage_event = external_llm_usage.record_external_llm_usage(
        provider_kind=str(provider_result.get("provider_kind") or provider_kind),
        provider_model_id=str(provider_result.get("provider_model_id") or provider_model_id),
        provider_response_id=provider_result.get("provider_response_id"),
        usage=provider_result.get("usage"),
        source_kind="prompt_recipe_drafting",
        recipe_id=None,
        metadata_json={
            "category": str(payload.category or "").strip() or None,
            "output_format": str(payload.output_format or "").strip() or None,
            "image_input_mode": str(payload.image_input_mode or "").strip() or None,
        },
    )
    if isinstance(provider_result.get("raw_text"), str):
        try:
            raw_payload = json.loads(str(provider_result.get("raw_text") or ""))
        except json.JSONDecodeError as exc:
            raise ServiceError("Prompt recipe drafting provider returned invalid JSON.") from exc
    else:
        raw_payload = provider_result
    if not isinstance(raw_payload, dict):
        raise ServiceError("Prompt recipe drafting provider must return a JSON object.")
    normalized = _normalize_prompt_recipe_draft_payload(raw_payload, payload)
    try:
        draft_request = PromptRecipeUpsertRequest(**normalized)
    except Exception as exc:
        message = str(exc)
        if "system_prompt_template" in message:
            raise ServiceError("Drafting model returned an invalid recipe draft: System prompt template is required.") from exc
        raise ServiceError(f"Drafting model returned an invalid recipe draft: {exc}") from exc
    validated = validate_prompt_recipe_payload(draft_request)
    response_payload = PromptRecipeUpsertRequest(**validated).model_dump()
    validation_warnings = list(validated.get("validation_warnings_json") or [])
    return {
        "draft": response_payload,
        "validation_warnings": validation_warnings,
        "drafting_model": {
            "provider_kind": provider_kind,
            "provider_model_id": provider_model_id,
        },
        "usage_event_id": usage_event.get("usage_event_id") if usage_event else None,
    }


def probe_enhancement_provider(payload: Dict[str, Any]) -> Dict[str, Any]:
    provider_kind = str(payload.get("provider_kind") or "").strip()
    require_images = bool(payload.get("require_images"))
    model_key = str(payload.get("model_key") or "").strip()
    probe_mode = str(payload.get("probe_mode") or "catalog").strip().lower()
    current_config = store.get_enhancement_config(model_key) if model_key else None
    matching_config = (
        current_config
        if current_config and str(current_config.get("provider_kind") or "").strip() == provider_kind
        else {}
    )
    api_key = payload.get("api_key") or matching_config.get("provider_api_key")
    base_url = payload.get("base_url") or matching_config.get("provider_base_url")
    selected_model_id = payload.get("selected_model_id")
    try:
        if provider_kind == "openrouter":
            return enhancement_provider.test_openrouter_connection(
                api_key=api_key,
                model_id=selected_model_id,
                require_images=require_images,
                base_url=base_url,
            )
        if provider_kind == "codex_local":
            if probe_mode == "full":
                return enhancement_provider.test_codex_local_connection(
                    model_id=str(selected_model_id or "").strip() or None,
                    require_images=require_images,
                )
            return enhancement_provider.load_codex_local_catalog(
                model_id=str(selected_model_id or "").strip() or None,
                require_images=require_images,
                force_refresh=bool(payload.get("force_refresh")),
            )
        if provider_kind == "local_openai":
            resolved_base = str(base_url or settings.local_openai_base_url).strip()
            if not resolved_base:
                raise ServiceError("Local OpenAI-compatible base URL is required.")
            return enhancement_provider.test_local_openai_connection(
                base_url=resolved_base,
                api_key=api_key,
                model_id=selected_model_id,
                require_images=require_images,
            )
        raise ServiceError("Unsupported enhancement provider.")
    except enhancement_provider.EnhancementProviderError as exc:
        raise ServiceError(str(exc)) from exc


def probe_shared_provider_catalog(payload: Dict[str, Any]) -> Dict[str, Any]:
    provider_kind = str(payload.get("provider_kind") or "").strip()
    require_images = bool(payload.get("require_images"))
    selected_model_id = str(payload.get("selected_model_id") or "").strip() or None
    probe_mode = str(payload.get("probe_mode") or "catalog").strip().lower()
    base_url_override = payload.get("base_url")
    try:
        if provider_kind == "codex_local":
            if probe_mode == "full":
                return enhancement_provider.test_codex_local_connection(
                    model_id=selected_model_id,
                    require_images=require_images,
                )
            return enhancement_provider.load_codex_local_catalog(
                model_id=selected_model_id,
                require_images=require_images,
                force_refresh=bool(payload.get("force_refresh")),
            )

        runtime = _shared_provider_runtime(
            provider_kind,
            stored_base_url=str(base_url_override or "").strip() or None,
        )
        if provider_kind == "openrouter":
            return enhancement_provider.test_openrouter_connection(
                api_key=runtime["api_key"],
                model_id=selected_model_id,
                require_images=require_images,
                base_url=runtime["base_url"],
            )
        if provider_kind == "local_openai":
            return enhancement_provider.test_local_openai_connection(
                base_url=runtime["base_url"],
                api_key=runtime["api_key"],
                model_id=selected_model_id,
                require_images=require_images,
            )
        raise ServiceError("Unsupported shared provider catalog.")
    except enhancement_provider.EnhancementProviderError as exc:
        raise ServiceError(str(exc)) from exc


def _asset_to_kie_ref(asset_id: str | None) -> Dict[str, Any] | None:
    if not asset_id:
        return None
    asset = store.get_asset(str(asset_id))
    if not asset:
        return None
    for key in ("hero_original_path", "hero_web_path", "hero_thumb_path", "hero_poster_path"):
        value = asset.get(key)
        if not value:
            continue
        resolved = settings.data_root / str(value)
        if resolved.exists():
            mime_type = None
            suffix = resolved.suffix.lower()
            if suffix in {".jpg", ".jpeg"}:
                mime_type = "image/jpeg"
            elif suffix == ".png":
                mime_type = "image/png"
            elif suffix == ".webp":
                mime_type = "image/webp"
            elif suffix == ".mp4":
                mime_type = "video/mp4"
            return _ref_to_kie(
                {
                    "path": str(resolved),
                    "filename": resolved.name,
                    "mime_type": mime_type,
                }
            )
    return None


def _ref_to_kie(value: Dict[str, Any]) -> Dict[str, Any]:
    if value.get("asset_id") and not value.get("path") and not value.get("url"):
        asset_ref = _asset_to_kie_ref(str(value.get("asset_id")))
        if asset_ref:
            merged = dict(asset_ref)
            merged.update(
                {
                    key: item
                    for key, item in value.items()
                    if key not in {"asset_id"} and item not in {None, ""}
                }
            )
            value = merged
    if value.get("reference_id") and not value.get("path"):
        reference = store.get_reference_media(str(value.get("reference_id")))
        if reference and reference.get("stored_path"):
            merged = dict(reference)
            merged.update(
                {
                    key: item
                    for key, item in value.items()
                    if item is not None and item != ""
                }
            )
            merged["path"] = reference.get("stored_path")
            if not merged.get("filename"):
                merged["filename"] = reference.get("original_filename")
            if not merged.get("mime_type"):
                merged["mime_type"] = reference.get("mime_type")
            value = merged
    raw_path = value.get("path")
    if raw_path:
        candidate = Path(str(raw_path))
        if not candidate.is_absolute():
            resolved = settings.data_root / candidate
            if resolved.exists():
                value = {**value, "path": str(resolved)}
    ref = {}
    for key in ("url", "path", "filename", "mime_type", "role", "duration_seconds"):
        item = value.get(key)
        if item is not None and item != "":
            ref[key] = item
    return ref


def _source_asset_to_kie_ref(asset_id: str | None) -> Dict[str, Any] | None:
    return _asset_to_kie_ref(asset_id)


def _media_ref_signature(value: Dict[str, Any]) -> Tuple[Any, ...]:
    normalized = _ref_to_kie(value)
    return (
        normalized.get("url"),
        normalized.get("path"),
        normalized.get("filename"),
        normalized.get("mime_type"),
        normalized.get("role"),
        normalized.get("duration_seconds"),
    )


def _strip_injected_retry_image_refs(
    images: List[Dict[str, Any]],
    *,
    source_asset_id: Optional[str],
    preset_image_slots: Dict[str, List[Dict[str, Any]]],
) -> List[Dict[str, Any]]:
    removals: Counter[Tuple[Any, ...]] = Counter()
    source_asset_ref = _source_asset_to_kie_ref(source_asset_id)
    if source_asset_ref:
        removals[_media_ref_signature(source_asset_ref)] += 1
    for refs in preset_image_slots.values():
        for ref in refs:
            removals[_media_ref_signature(ref)] += 1

    kept: List[Dict[str, Any]] = []
    for image in images:
        signature = _media_ref_signature(image)
        if removals[signature] > 0:
            removals[signature] -= 1
            continue
        kept.append(image)
    return kept


def build_retry_submit_request(job: Dict[str, Any], batch: Optional[Dict[str, Any]] = None) -> JobSubmitRequest:
    normalized_request = job.get("normalized_request_json") or {}
    if not isinstance(normalized_request, dict):
        raise ServiceError("Stored job request is invalid.")

    batch_record = batch or store.get_batch(job["batch_id"]) or {}
    batch_summary = batch_record.get("request_summary_json") or {}
    if not isinstance(batch_summary, dict):
        batch_summary = {}

    preset_image_slots = batch_summary.get("preset_image_slots") or {}
    if not isinstance(preset_image_slots, dict):
        preset_image_slots = {}
    preset_text_values = batch_summary.get("preset_text_values") or {}
    if not isinstance(preset_text_values, dict):
        preset_text_values = {}

    preset_key = str(job.get("requested_preset_key") or job.get("resolved_preset_key") or "").strip()
    preset = store.get_preset_by_key(preset_key) if preset_key else None
    if preset_key and not preset:
        raise ServiceError("Stored preset could not be resolved for retry.")

    images = normalized_request.get("images") or []
    if not isinstance(images, list):
        images = []
    replay_images = _strip_injected_retry_image_refs(
        [dict(item) for item in images if isinstance(item, dict)],
        source_asset_id=job.get("source_asset_id"),
        preset_image_slots={key: [dict(item) for item in value if isinstance(item, dict)] for key, value in preset_image_slots.items() if isinstance(value, list)},
    )

    videos = normalized_request.get("videos") or []
    if not isinstance(videos, list):
        videos = []
    audios = normalized_request.get("audios") or []
    if not isinstance(audios, list):
        audios = []
    options = normalized_request.get("options") or job.get("resolved_options_json") or {}
    if not isinstance(options, dict):
        options = {}

    selected_system_prompt_ids = job.get("selected_system_prompt_ids_json") or []
    if not isinstance(selected_system_prompt_ids, list):
        selected_system_prompt_ids = []

    return JobSubmitRequest(
        model_key=str(normalized_request.get("model_key") or job["model_key"]),
        task_mode=normalized_request.get("task_mode") or job.get("task_mode"),
        prompt=job.get("raw_prompt") if job.get("raw_prompt") is not None else normalized_request.get("prompt"),
        images=[MediaRefInput(**item) for item in replay_images],
        videos=[MediaRefInput(**item) for item in videos if isinstance(item, dict)],
        audios=[MediaRefInput(**item) for item in audios if isinstance(item, dict)],
        options=options,
        preset_id=preset.get("preset_id") if preset else None,
        preset_text_values={str(key): str(value) for key, value in preset_text_values.items()},
        preset_image_slots={
            str(key): [MediaRefInput(**item) for item in value if isinstance(item, dict)]
            for key, value in preset_image_slots.items()
            if isinstance(value, list)
        },
        selected_system_prompt_ids=[str(value) for value in selected_system_prompt_ids],
        source_asset_id=job.get("source_asset_id"),
        project_id=job.get("project_id") or batch_record.get("project_id"),
        output_count=1,
        enhance=False,
        prompt_policy=normalized_request.get("prompt_policy"),
        prompt_profile_key=normalized_request.get("prompt_profile_key"),
        system_prompt_override=normalized_request.get("system_prompt_override"),
    )


def _image_reference_tokens(count: int, start_index: int) -> List[str]:
    if count <= 0:
        return []
    return [f"[image reference {index}]" for index in range(start_index, start_index + count)]


def _render_preset_prompt(template: str, text_values: Dict[str, str], image_slots: Dict[str, List[Dict[str, Any]]]) -> str:
    rendered = template
    for key, value in text_values.items():
        rendered = re.sub(r"\{\{\s*%s\s*\}\}" % re.escape(key), value, rendered)
    rendered = re.sub(r"(?im)^[^\n]*\{\{\s*[^}]+\s*\}\}[^\n]*\bonly when provided\.?[ \t]*\n?", "", rendered)
    rendered = re.sub(r"\{\{\s*[^}]+\s*\}\}", "", rendered)
    image_index = 0
    for key, refs in image_slots.items():
        tokens = _image_reference_tokens(len(refs), image_index + 1)
        if tokens:
            image_index += len(tokens)
            replacement = ", ".join(tokens)
        else:
            replacement = f"[[{key}]]"
        rendered = re.sub(r"\[\[\s*%s\s*\]\]" % re.escape(key), replacement, rendered)
    return rendered


def _collect_system_prompts(ids: List[str]) -> List[Dict[str, Any]]:
    prompts = []
    for prompt_id in ids:
        prompt = store.get_system_prompt(prompt_id)
        if prompt:
            prompts.append(prompt)
    return prompts




def _resolve_preset(request: ValidateRequest) -> Tuple[Optional[Dict[str, Any]], Dict[str, str], Dict[str, List[Dict[str, Any]]], Optional[str]]:
    if not request.preset_id:
        return None, {}, {}, request.prompt
    preset = store.get_preset(request.preset_id)
    if not preset:
        raise ServiceError("Preset not found.")
    applies_to_models = preset.get("applies_to_models_json") or []
    if applies_to_models and request.model_key not in applies_to_models:
        raise ServiceError("Preset is not available for the selected model.")
    text_fields = preset.get("input_schema_json", [])
    slots = preset.get("input_slots_json", [])
    if not _model_key_supports_structured_preset(request.model_key, image_policy=_preset_image_policy(slots)):
        raise ServiceError("Preset is not compatible with the selected model.")
    text_values = {}
    for field in text_fields:
        key = field["key"]
        value = request.preset_text_values.get(key) or field.get("default_value")
        if field.get("required") and not value:
            raise ServiceError("Missing required preset text field: %s" % key)
        if value:
            text_values[key] = value
    image_slot_values = {}
    for slot in slots:
        key = slot["key"]
        refs = [item.model_dump() for item in request.preset_image_slots.get(key, [])]
        if slot.get("required") and not refs:
            raise ServiceError("Missing required preset image slot: %s" % key)
        if refs:
            image_slot_values[key] = refs
    if image_slot_values and not _model_accepts_preset_image_values(request.model_key):
        raise ServiceError("Preset image slots are not available for the selected model.")
    prompt = _render_preset_prompt(preset["prompt_template"] or "", text_values, image_slot_values)
    return preset, text_values, image_slot_values, prompt


def build_validation_bundle(request: ValidateRequest) -> Dict[str, Any]:
    _enforce_output_count_policy(request)
    preset, text_values, image_slot_values, final_prompt = _resolve_preset(request)
    resolved_image_slot_values = {
        key: [_ref_to_kie(ref) for ref in refs]
        for key, refs in image_slot_values.items()
    }
    selected_prompts = _collect_system_prompts(request.selected_system_prompt_ids)
    merged_images = [_ref_to_kie(item.model_dump()) for item in request.images]
    for refs in resolved_image_slot_values.values():
        merged_images.extend(refs)
    merged_videos = [_ref_to_kie(item.model_dump()) for item in request.videos]
    source_asset_ref = _source_asset_to_kie_ref(request.source_asset_id)
    if source_asset_ref:
        mime_type = str(source_asset_ref.get("mime_type") or "")
        if mime_type.startswith("video/"):
            merged_videos.append(source_asset_ref)
        else:
            merged_images.insert(0, source_asset_ref)
    raw_request = {
        "model_key": request.model_key,
        "task_mode": request.task_mode,
        "prompt": final_prompt or request.prompt,
        "images": merged_images,
        "videos": merged_videos,
        "audios": [_ref_to_kie(item.model_dump()) for item in request.audios],
        "options": request.options,
        "callback_url": request.callback_url or _default_kie_callback_url(request.model_key),
        "prompt_profile_key": request.prompt_profile_key,
        "system_prompt_override": request.system_prompt_override,
        "prompt_policy": request.prompt_policy or ("ask" if request.enhance else "off"),
        "metadata": {
            "output_count": request.output_count,
            "selected_system_prompt_ids": request.selected_system_prompt_ids,
            "preset_text_values": text_values,
            "preset_image_slots": resolved_image_slot_values,
        },
    }
    prompt_context = kie_adapter.resolve_prompt_context(raw_request)
    validation = kie_adapter.validate_request(raw_request)
    try:
        preflight = kie_adapter.run_preflight(validation)
    except Exception as exc:
        preflight = {
            "decision": "reject",
            "can_submit": False,
            "reason": str(exc),
            "warnings": [],
            "estimated_cost": {
                "model_key": request.model_key,
                "estimated_credits": None,
                "estimated_cost_usd": None,
                "currency": "USD",
                "is_known": False,
                "has_numeric_estimate": False,
                "is_authoritative": False,
                "assumptions": [],
                "notes": [],
            },
        }
    estimated_cost = preflight.get("estimated_cost") if isinstance(preflight.get("estimated_cost"), dict) else None
    has_numeric_estimate = bool(estimated_cost and estimated_cost.get("has_numeric_estimate"))
    if not has_numeric_estimate or kie_adapter.needs_duration_aware_estimate(raw_request):
        try:
            preflight["estimated_cost"] = kie_adapter.estimate_request_cost(raw_request)
        except Exception:
            pass
    preflight = attach_pricing_summary(preflight, output_count=request.output_count)
    return {
        "preset": preset,
        "raw_request": raw_request,
        "prompt_context": prompt_context,
        "validation": validation,
        "preflight": preflight,
        "pricing_summary": preflight.get("pricing_summary") or {},
        "final_prompt": final_prompt or request.prompt,
        "resolved_options": request.options,
        "selected_prompts": selected_prompts,
        "text_values": text_values,
        "image_slot_values": resolved_image_slot_values,
    }


def _default_kie_callback_url(model_key: str) -> Optional[str]:
    try:
        model = kie_adapter.get_model(model_key)
        raw = model.get("raw") or {}
        transport = raw.get("transport") if isinstance(raw.get("transport"), dict) else {}
        if not transport.get("callback_supported"):
            return None
    except Exception:
        return None
    configured_base = str(settings.media_studio_public_api_base_url or "").strip()
    if configured_base:
        base_url = configured_base.rstrip("/")
    else:
        host = settings.api_host if settings.api_host not in {"0.0.0.0", "::"} else "127.0.0.1"
        base_url = f"http://{host}:{settings.api_port}"
    return f"{base_url}/media/providers/kie/callback"


def _resolved_enhancement_config(model_key: str) -> Dict[str, Any]:
    global_config = store.get_enhancement_config(GLOBAL_ENHANCEMENT_CONFIG_KEY) or {}
    model_config = store.get_enhancement_config(model_key) or {}
    legacy_provider_config = model_config if (
        model_config.get("provider_model_id")
        or str(model_config.get("provider_kind") or "builtin").strip() != "builtin"
    ) else {}
    engine_config = global_config or legacy_provider_config
    if global_config or model_config:
        result = EnhancementConfigRecord(
            config_id=str(model_config.get("config_id") or global_config.get("config_id") or f"cfg-{model_key}"),
            model_key=model_key,
            label=str(model_config.get("label") or f"{model_key} enhancement"),
            helper_profile=str(model_config.get("helper_profile") or global_config.get("helper_profile") or "midctx-64k-no-thinking-q3-prefill"),
            provider_kind=str(engine_config.get("provider_kind") or "builtin"),
            provider_label=engine_config.get("provider_label"),
            provider_model_id=engine_config.get("provider_model_id"),
            provider_api_key_configured=bool(engine_config.get("provider_api_key")),
            provider_base_url_configured=bool(engine_config.get("provider_base_url")),
            provider_credential_source="stored" if engine_config.get("provider_api_key") else None,
            provider_supports_images=bool(engine_config.get("provider_supports_images")),
            provider_status=engine_config.get("provider_status"),
            provider_last_tested_at=engine_config.get("provider_last_tested_at"),
            provider_capabilities_json=engine_config.get("provider_capabilities_json") or {},
            system_prompt=str(model_config.get("system_prompt") or global_config.get("system_prompt") or ""),
            image_analysis_prompt=model_config.get("image_analysis_prompt") or global_config.get("image_analysis_prompt"),
            supports_text_enhancement=bool(
                model_config.get("supports_text_enhancement")
                if "supports_text_enhancement" in model_config
                else global_config.get("supports_text_enhancement", True)
            ),
            supports_image_analysis=bool(
                model_config.get("supports_image_analysis")
                if "supports_image_analysis" in model_config
                else global_config.get("supports_image_analysis", False)
            ),
            notes=model_config.get("notes") or global_config.get("notes"),
            status=str(model_config.get("status") or global_config.get("status") or "active"),
        ).model_dump()
        result["provider_api_key"] = engine_config.get("provider_api_key")
        result["provider_base_url"] = engine_config.get("provider_base_url")
        return result
    return EnhancementConfigRecord(
        config_id=f"cfg-{GLOBAL_ENHANCEMENT_CONFIG_KEY}",
        model_key=GLOBAL_ENHANCEMENT_CONFIG_KEY,
        label="Studio enhancement",
        helper_profile="midctx-64k-no-thinking-q3-prefill",
        provider_kind="builtin",
        provider_api_key_configured=False,
        provider_base_url_configured=False,
        supports_text_enhancement=True,
        supports_image_analysis=False,
    ).model_dump()


def _normalize_enhanced_prompt_text(value: Any) -> str:
    return " ".join(str(value or "").split()).strip().casefold()


def _candidate_enhancement_image_paths(request: ValidateRequest, bundle: Dict[str, Any]) -> List[str]:
    paths: List[str] = []
    for item in bundle.get("raw_request", {}).get("images", []) or []:
        if isinstance(item, dict) and item.get("path"):
            paths.append(str(item.get("path")))
    if request.source_asset_id:
        asset = store.get_asset(str(request.source_asset_id))
        if asset:
            for key in ("hero_web_path", "hero_original_path", "hero_thumb_path", "hero_poster_path"):
                value = asset.get(key)
                if value:
                    resolved = settings.data_root / str(value)
                    if resolved.exists():
                        paths.append(str(resolved))
                        break
    deduped: List[str] = []
    seen = set()
    for path_value in paths:
        if path_value in seen:
            continue
        seen.add(path_value)
        deduped.append(path_value)
    return deduped


def _run_external_enhancement(config: Dict[str, Any], request: EnhancePreviewRequest, bundle: Dict[str, Any]) -> Dict[str, Any]:
    provider_kind = str(config.get("provider_kind") or "builtin").strip()
    provider_model_id = str(config.get("provider_model_id") or "").strip()
    if not provider_model_id:
        if provider_kind == "openrouter":
            provider_model_id = "qwen/qwen3.5-35b-a3b"
        else:
            raise ServiceError("Choose an enhancement model before running enhancement.")
    image_paths = _candidate_enhancement_image_paths(request, bundle)
    prompt_text = str(bundle.get("final_prompt") or request.prompt or "").strip()
    supports_text_enhancement = bool(config.get("supports_text_enhancement"))
    supports_image_analysis = bool(config.get("supports_image_analysis"))
    using_image_analysis = supports_image_analysis and bool(image_paths)
    if not prompt_text and not image_paths:
        raise ServiceError("Add a prompt or source media before enhancing.")
    if not supports_text_enhancement and not using_image_analysis:
        raise ServiceError("The selected enhancement model requires an image input.")
    if using_image_analysis and not bool(config.get("provider_supports_images")):
        raise ServiceError("The selected enhancement model does not support image input.")
    provider_api_key = config.get("provider_api_key") or None
    provider_base_url = config.get("provider_base_url") or None
    def run_provider_call() -> Dict[str, Any]:
        if provider_kind == "openrouter":
            return enhancement_provider.run_openai_compatible_enhancement(
                provider_kind="openrouter",
                base_url=str(provider_base_url or settings.openrouter_base_url),
                api_key=str(provider_api_key or settings.openrouter_api_key or ""),
                model_id=provider_model_id,
                prompt=prompt_text,
                media_model_key=request.model_key,
                task_mode=request.task_mode,
                system_prompt=config.get("system_prompt"),
                image_analysis_prompt=config.get("image_analysis_prompt"),
                image_paths=image_paths[:1] if using_image_analysis else [],
            )
        if provider_kind == "local_openai":
            return enhancement_provider.run_openai_compatible_enhancement(
                provider_kind="local_openai",
                base_url=str(provider_base_url or settings.local_openai_base_url),
                api_key=str(provider_api_key or settings.local_openai_api_key or ""),
                model_id=provider_model_id,
                prompt=prompt_text,
                media_model_key=request.model_key,
                task_mode=request.task_mode,
                system_prompt=config.get("system_prompt"),
                image_analysis_prompt=config.get("image_analysis_prompt"),
                image_paths=image_paths[:1] if using_image_analysis else [],
            )
        if provider_kind == "codex_local":
            return enhancement_provider.run_codex_local_enhancement(
                model_id=provider_model_id,
                prompt=prompt_text,
                media_model_key=request.model_key,
                task_mode=request.task_mode,
                system_prompt=config.get("system_prompt"),
                image_analysis_prompt=config.get("image_analysis_prompt"),
                image_paths=image_paths[:1] if using_image_analysis else [],
            )
        raise ServiceError("Unsupported enhancement provider.")
    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(run_provider_call)
        try:
            return future.result(timeout=ENHANCEMENT_PROVIDER_TIMEOUT_SECONDS)
        except FuturesTimeoutError as exc:
            raise ServiceError("The enhancement provider timed out. Try again or switch the enhancement model in Settings.") from exc


def build_enhancement_preview(request: EnhancePreviewRequest) -> Dict[str, Any]:
    started_at = perf_counter()
    preview_request = request.model_copy(update={"prompt_policy": request.prompt_policy or "preview"})
    bundle = build_validation_bundle(preview_request)
    enhancement_config = _resolved_enhancement_config(preview_request.model_key)
    provider_kind = str(enhancement_config.get("provider_kind") or "builtin").strip()
    if provider_kind == "builtin":
        enhancement = kie_adapter.dry_run_prompt_enhancement(bundle["raw_request"])
    else:
        try:
            enhancement = _run_external_enhancement(enhancement_config, preview_request, bundle)
        except enhancement_provider.EnhancementProviderError as exc:
            duration_ms = int((perf_counter() - started_at) * 1000)
            logger.warning(
                "enhancement_preview_failed provider=%s provider_model=%s media_model=%s duration_ms=%s error=%s",
                provider_kind,
                enhancement_config.get("provider_model_id") or "-",
                preview_request.model_key,
                duration_ms,
                str(exc),
            )
            raise ServiceError(str(exc)) from exc
        usage_event = external_llm_usage.record_external_llm_usage(
            provider_kind=str(enhancement.get("provider_kind") or provider_kind),
            provider_model_id=str(enhancement.get("provider_model_id") or enhancement_config.get("provider_model_id") or ""),
            provider_response_id=enhancement.get("provider_response_id"),
            usage=enhancement.get("usage"),
            source_kind="studio_enhancement_preview",
            model_key=preview_request.model_key,
            task_mode=preview_request.task_mode,
            metadata_json={"image_count": len(_candidate_enhancement_image_paths(preview_request, bundle))},
        )
        if usage_event:
            enhancement["usage_event_id"] = usage_event.get("usage_event_id")
    raw_prompt = str(bundle.get("final_prompt") or preview_request.prompt or "").strip()
    enhanced_prompt = str(enhancement.get("final_prompt_used") or enhancement.get("enhanced_prompt") or "").strip()
    # Treat no-op rewrites as provider failures so Studio does not present an unchanged prompt as a successful enhancement.
    if enhanced_prompt and _normalize_enhanced_prompt_text(enhanced_prompt) == _normalize_enhanced_prompt_text(raw_prompt):
        raise ServiceError(
            "Enhancement provider returned the original prompt unchanged. Update the enhancement prompt in Models or switch the enhancement model in Settings."
        )
    duration_ms = int((perf_counter() - started_at) * 1000)
    logger.info(
        "enhancement_preview_ready provider=%s provider_model=%s media_model=%s duration_ms=%s image_count=%s",
        provider_kind,
        enhancement.get("provider_model_id") or enhancement_config.get("provider_model_id") or "-",
        preview_request.model_key,
        duration_ms,
        len(_candidate_enhancement_image_paths(preview_request, bundle)),
    )
    return {
        "prompt_context": enhancement.get("context") or bundle["prompt_context"],
        "enhancement": enhancement,
        "validation": bundle["validation"],
        "raw_prompt": bundle["final_prompt"] or preview_request.prompt,
        "enhanced_prompt": enhancement.get("enhanced_prompt"),
        "final_prompt_used": enhancement.get("final_prompt_used") or enhancement.get("enhanced_prompt"),
        "image_analysis": enhancement.get("image_analysis"),
        "warnings": enhancement.get("warnings") or [],
        "enhancement_config": enhancement_config,
        "provider_kind": provider_kind,
        "provider_label": enhancement_config.get("provider_label") or provider_kind,
        "provider_model_id": enhancement.get("provider_model_id") or enhancement_config.get("provider_model_id"),
        "resolved_options": bundle["resolved_options"],
    }


def submit_jobs(request: ValidateRequest) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    require_active_project(request.project_id)
    bundle = build_validation_bundle(request)
    validation_state = bundle["validation"].get("state")
    if validation_state not in {"ready", "ready_with_defaults", "ready_with_warning"}:
        raise ServiceError("Request is not ready for submit.")

    preset = bundle["preset"]
    batch_payload = {
        "model_key": request.model_key,
        "task_mode": request.task_mode,
        "requested_outputs": request.output_count,
        "source_asset_id": request.source_asset_id,
        "project_id": request.project_id,
        "requested_preset_key": preset["key"] if preset else None,
        "resolved_preset_key": preset["key"] if preset else None,
        "preset_source": "media_preset" if preset else None,
        "request_summary_json": {
            "prompt": bundle["final_prompt"],
            "options": bundle["resolved_options"],
            "output_count": request.output_count,
            "preset_text_values": bundle["text_values"],
            "preset_image_slots": bundle["image_slot_values"],
            "pricing_summary": bundle["pricing_summary"],
        },
    }
    normalized_request_for_storage = dict(bundle["validation"].get("normalized_request") or {})
    if bundle["image_slot_values"]:
        normalized_request_for_storage["preset_image_slots"] = bundle["image_slot_values"]
    jobs_payload = []
    for index in range(request.output_count):
        jobs_payload.append(
            {
                "batch_index": index,
                "model_key": request.model_key,
                "task_mode": request.task_mode,
                "source_asset_id": request.source_asset_id,
                "project_id": request.project_id,
                "requested_preset_key": preset["key"] if preset else None,
                "resolved_preset_key": preset["key"] if preset else None,
                "preset_source": "media_preset" if preset else None,
                "raw_prompt": request.prompt,
                "final_prompt_used": bundle["final_prompt"],
                "selected_system_prompt_ids_json": request.selected_system_prompt_ids,
                "selected_system_prompts_json": bundle["selected_prompts"],
                "resolved_system_prompt_json": bundle["prompt_context"],
                "resolved_options_json": bundle["resolved_options"],
                "normalized_request_json": normalized_request_for_storage,
                "prompt_context_json": bundle["prompt_context"],
                "validation_json": bundle["validation"],
                "preflight_json": bundle["preflight"],
            }
        )
    return store.create_batch_and_jobs(batch_payload, jobs_payload)


def _fake_output_image(target_path: Path, label: str) -> None:
    target_path.parent.mkdir(parents=True, exist_ok=True)
    image = Image.new("RGB", (1024, 1024), color=(15, 18, 16))
    draw = ImageDraw.Draw(image)
    draw.rectangle((48, 48, 976, 976), outline=(208, 255, 72), width=6)
    draw.text((100, 120), "Media Studio", fill=(247, 246, 240))
    draw.text((100, 180), label[:120], fill=(200, 200, 190))
    image.save(target_path)


def _fake_output_video(target_path: Path) -> None:
    target_path.parent.mkdir(parents=True, exist_ok=True)
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        subprocess.run(
            [
                ffmpeg,
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=0x101414:s=640x360:d=1",
                "-an",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-movflags",
                "+faststart",
                str(target_path),
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return
    target_path.write_bytes(
        b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom"
        b"\x00\x00\x00\x08free"
        b"\x00\x00\x00\x08mdat"
    )


def _fake_output_audio(target_path: Path) -> None:
    target_path.parent.mkdir(parents=True, exist_ok=True)
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        subprocess.run(
            [
                ffmpeg,
                "-y",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=1",
                "-c:a",
                "libmp3lame",
                "-q:a",
                "6",
                str(target_path),
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return
    target_path.write_bytes(b"ID3\x04\x00\x00\x00\x00\x00\x21Media Studio audio placeholder")


def _relative_media_path(artifact: Dict[str, Any], path_value: Optional[str]) -> Optional[str]:
    if not path_value:
        return None
    run_dir = artifact.get("run_dir")
    if not run_dir:
        return path_value
    absolute_path = Path(run_dir) / path_value
    try:
        return absolute_path.relative_to(settings.data_root).as_posix()
    except ValueError:
        return absolute_path.as_posix()


def _infer_output_kind(job: Dict[str, Any], output_path: Path, remote_output_url: Optional[str]) -> str:
    if output_path.exists():
        try:
            header = output_path.read_bytes()[:32]
        except OSError:
            header = b""
        if b"ftyp" in header[:16]:
            return "video"
        if header.startswith(b"\x1a\x45\xdf\xa3"):
            return "video"
        if header.startswith(b"ID3") or (len(header) >= 2 and header[0] == 0xFF and (header[1] & 0xE0) == 0xE0):
            return "audio"
        if header.startswith(b"RIFF") and b"WAVE" in header[:16]:
            return "audio"
        if header.startswith(b"\x89PNG\r\n\x1a\n"):
            return "image"
        if header.startswith(b"\xff\xd8\xff"):
            return "image"
        if header.startswith(b"RIFF") and b"WEBP" in header[:16]:
            return "image"
        if header.startswith((b"GIF87a", b"GIF89a")):
            return "image"
    for candidate in (remote_output_url, str(output_path)):
        mime_type = mimetypes.guess_type(candidate or "")[0] or ""
        if mime_type.startswith("video/"):
            return "video"
        if mime_type.startswith("audio/"):
            return "audio"
        if mime_type.startswith("image/"):
            return "image"
    suffix = output_path.suffix.lower()
    if suffix in {".mp4", ".mov", ".webm", ".mkv", ".avi"}:
        return "video"
    if suffix in {".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg"}:
        return "audio"
    if suffix in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
        return "image"
    task_mode = str(job.get("task_mode") or "").lower()
    if "video" in task_mode:
        return "video"
    if "audio" in task_mode or "music" in task_mode:
        return "audio"
    model_key = str(job.get("model_key") or "").lower()
    if "video" in model_key or "i2v" in model_key or "t2v" in model_key:
        return "video"
    if "audio" in model_key or "music" in model_key or "suno" in model_key:
        return "audio"
    return "image"


def _normalized_output_source_path(job: Dict[str, Any], output_path: Path, remote_output_url: Optional[str]) -> Path:
    output_kind = _infer_output_kind(job, output_path, remote_output_url)
    if output_kind == "video" and output_path.suffix.lower() not in {".mp4", ".mov", ".webm", ".mkv", ".avi"}:
        normalized = output_path.with_suffix(".mp4")
        if not normalized.exists():
            output_path.replace(normalized)
        return normalized
    if output_kind == "audio" and output_path.suffix.lower() not in {".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg"}:
        extension = ".mp3"
        try:
            header = output_path.read_bytes()[:32]
        except OSError:
            header = b""
        if header.startswith(b"RIFF") and b"WAVE" in header[:16]:
            extension = ".wav"
        normalized = output_path.with_suffix(extension)
        if not normalized.exists():
            output_path.replace(normalized)
        return normalized
    if output_kind == "image" and output_path.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
        extension = ".jpg"
        try:
            header = output_path.read_bytes()[:32]
        except OSError:
            header = b""
        if header.startswith(b"\x89PNG\r\n\x1a\n"):
            extension = ".png"
        elif header.startswith(b"RIFF") and b"WEBP" in header[:16]:
            extension = ".webp"
        elif header.startswith((b"GIF87a", b"GIF89a")):
            extension = ".gif"
        normalized = output_path.with_suffix(extension)
        if not normalized.exists():
            output_path.replace(normalized)
        return normalized
    return output_path


def _find_existing_job_asset(
    job_id: str,
    *,
    remote_output_url: Optional[str],
    output_index: Optional[int],
    output_role: str,
) -> Optional[Dict[str, Any]]:
    for asset in store.get_assets_by_job_id(job_id):
        asset_remote_url = str(asset.get("remote_output_url") or "").strip()
        if remote_output_url and asset_remote_url == remote_output_url:
            return asset
        payload = asset.get("payload_json") if isinstance(asset.get("payload_json"), dict) else {}
        graph_payload = payload.get("graph") if isinstance(payload, dict) else {}
        if not isinstance(graph_payload, dict):
            continue
        if graph_payload.get("output_role") != output_role:
            continue
        if output_index is not None and graph_payload.get("output_index") == output_index:
            return asset
    return None


def publish_job_artifact(
    job: Dict[str, Any],
    output_path: Path,
    remote_output_url: Optional[str] = None,
    *,
    output_index: Optional[int] = None,
    output_role: str = "output",
    output_metadata: Optional[Dict[str, Any]] = None,
    associated_outputs: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    existing_asset = _find_existing_job_asset(
        job["job_id"],
        remote_output_url=remote_output_url,
        output_index=output_index,
        output_role=output_role,
    )
    normalized_output_path = _normalized_output_source_path(job, output_path, remote_output_url)
    output_kind = _infer_output_kind(job, normalized_output_path, remote_output_url)
    payload = job["submit_response_json"]
    status = job["final_status_json"]
    artifact_graph_payload = {
        "output_index": output_index,
        "output_role": output_role,
        "remote_output_url": remote_output_url,
    }
    if output_metadata:
        artifact_graph_payload["output_metadata"] = output_metadata
    artifact_slug = job["job_id"]
    if output_index is not None or output_role != "output":
        safe_role = re.sub(r"[^a-zA-Z0-9_-]+", "-", output_role or "output").strip("-") or "output"
        artifact_slug = f"{job['job_id']}-{safe_role}-{output_index or 1}"
    artifact_outputs = [
        {
            "kind": output_kind,
            "role": output_role,
            "source_path": str(normalized_output_path),
            "source_url": remote_output_url,
            "metadata": output_metadata or {},
        }
    ]
    for associated in associated_outputs or []:
        associated_path = Path(str(associated.get("path") or ""))
        if not associated_path.exists():
            continue
        associated_url = str(associated.get("remote_output_url") or "").strip() or None
        associated_kind = _infer_output_kind(job, associated_path, associated_url)
        artifact_outputs.append(
            {
                "kind": associated_kind,
                "role": str(associated.get("role") or "related"),
                "source_path": str(associated_path),
                "source_url": associated_url,
                "metadata": associated.get("metadata") if isinstance(associated.get("metadata"), dict) else {},
            }
        )
    artifact = kie_adapter.create_run_artifact(
        {
            "status": "succeeded",
            "model_key": job["model_key"],
            "task_mode": job.get("task_mode"),
            "provider_model": (job["validation_json"].get("normalized_request") or {}).get("provider_model"),
            "slug": artifact_slug,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "prompts": {
                "raw": job.get("raw_prompt"),
                "enhanced": job.get("enhanced_prompt"),
                "final_used": job.get("final_prompt_used"),
                "prompt_profile": job["prompt_context_json"].get("resolved_profile_key"),
            },
            "outputs": artifact_outputs,
            "options": job["resolved_options_json"],
            "provider_trace": {
                "task_id": job.get("provider_task_id"),
            },
            "submit_payload": payload.get("provider_payload"),
            "submit_response": payload,
            "final_status_response": status,
        }
    )
    artifact["graph"] = artifact_graph_payload
    output = artifact["outputs"][0]
    associated_cover_output = next(
        (
            item
            for item in artifact.get("outputs", [])[1:]
            if item.get("kind") == "image" and str(item.get("role") or "").lower() in {"cover", "cover_image", "artwork", "poster"}
        ),
        None,
    )
    generation_kind = output_kind if output_kind in {"video", "audio"} else "image"
    associated_cover_thumb_path = None
    associated_cover_display_path = None
    if associated_cover_output:
        associated_cover_thumb_path = _relative_media_path(
            artifact,
            associated_cover_output.get("thumb_path") or associated_cover_output.get("web_path") or associated_cover_output.get("original_path"),
        )
        associated_cover_display_path = _relative_media_path(
            artifact,
            associated_cover_output.get("web_path") or associated_cover_output.get("thumb_path") or associated_cover_output.get("original_path"),
        )
    asset_payload = {
        "job_id": job["job_id"],
        "project_id": job.get("project_id"),
        "provider_task_id": job.get("provider_task_id"),
        "run_id": artifact["run_id"],
        "source_asset_id": job.get("source_asset_id"),
        "generation_kind": generation_kind,
        "model_key": job["model_key"],
        "status": "completed",
        "task_mode": job.get("task_mode"),
        "prompt_summary": job.get("final_prompt_used") or job.get("raw_prompt"),
        "artifact_run_dir": artifact["run_dir"],
        "manifest_path": _relative_media_path(artifact, artifact.get("manifest_path")),
        "run_json_path": _relative_media_path(artifact, "run.json"),
        "hero_original_path": _relative_media_path(artifact, output.get("original_path")),
        "hero_web_path": _relative_media_path(artifact, output.get("web_path")),
        "hero_thumb_path": associated_cover_thumb_path or _relative_media_path(artifact, output.get("thumb_path")),
        "hero_poster_path": associated_cover_display_path or _relative_media_path(artifact, output.get("poster_path")),
        "remote_output_url": remote_output_url,
        "preset_key": job.get("resolved_preset_key"),
        "preset_source": job.get("preset_source"),
        "payload_json": artifact,
        "tags_json": ["offline"] if not remote_output_url else [],
    }
    if existing_asset:
        asset_payload["asset_id"] = existing_asset["asset_id"]
    asset = store.create_or_update_asset(asset_payload)
    store.update_job(job["job_id"], {"artifact_json": artifact})
    return asset


def simulate_job_completion(job: Dict[str, Any], downloads_dir: Path) -> Dict[str, Any]:
    task_mode = str(job.get("task_mode") or "").lower()
    model_key = str(job.get("model_key") or "").lower()
    if "video" in task_mode or "i2v" in model_key or "t2v" in model_key:
        output_path = downloads_dir / ("%s.mp4" % job["job_id"])
        _fake_output_video(output_path)
    elif "audio" in task_mode or "music" in task_mode or "suno" in model_key:
        output_path = downloads_dir / ("%s.mp3" % job["job_id"])
        _fake_output_audio(output_path)
    else:
        output_path = downloads_dir / ("%s.png" % job["job_id"])
        _fake_output_image(output_path, job.get("final_prompt_used") or job.get("raw_prompt") or job["model_key"])
    return publish_job_artifact(job, output_path)
