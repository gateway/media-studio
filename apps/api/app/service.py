from __future__ import annotations

import logging
import mimetypes
import re
from hashlib import sha256
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter
from threading import Lock
from collections import Counter
from typing import Any, Dict, Iterable, List, Optional, Tuple

from PIL import Image, ImageDraw, ImageOps

from . import enhancement_provider, kie_adapter, store
from .pricing import attach_pricing_summary
from .settings import settings
from .schemas import (
    EnhancePreviewRequest,
    EnhancementConfigRecord,
    JobSubmitRequest,
    MediaRefInput,
    ProjectUpsertRequest,
    PresetUpsertRequest,
    SystemPromptUpsertRequest,
    ValidateRequest,
)

TEXT_TOKEN_RE = re.compile(r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}")
IMAGE_TOKEN_RE = re.compile(r"\[\[\s*([a-zA-Z0-9_]+)\s*\]\]")
GLOBAL_ENHANCEMENT_CONFIG_KEY = "__studio_enhancement__"
ENHANCEMENT_PROVIDER_TIMEOUT_SECONDS = 75
_reference_media_backfill_lock = Lock()
logger = logging.getLogger(__name__)
REFERENCE_MEDIA_ROOT = settings.data_root / "reference-media"
REFERENCE_IMAGES_ROOT = REFERENCE_MEDIA_ROOT / "images"
REFERENCE_VIDEOS_ROOT = REFERENCE_MEDIA_ROOT / "videos"
REFERENCE_AUDIOS_ROOT = REFERENCE_MEDIA_ROOT / "audios"
REFERENCE_THUMBS_ROOT = REFERENCE_MEDIA_ROOT / "thumbs"


class ServiceError(Exception):
    pass


def _input_limit(model: Dict[str, Any], media_kind: str, field: str) -> int:
    raw = model.get("raw") if isinstance(model.get("raw"), dict) else {}
    inputs = raw.get("inputs") if isinstance(raw.get("inputs"), dict) else {}
    spec = inputs.get(media_kind) if isinstance(inputs.get(media_kind), dict) else {}
    value = spec.get(field)
    return int(value or 0)


def _model_has_video_or_audio_inputs(model: Dict[str, Any]) -> bool:
    return (
        _input_limit(model, "video", "required_max") > 0
        or _input_limit(model, "video", "required_min") > 0
        or _input_limit(model, "audio", "required_max") > 0
        or _input_limit(model, "audio", "required_min") > 0
    )


def _model_supports_structured_preset(model: Dict[str, Any], *, requires_image: bool) -> bool:
    if model.get("studio_exposed") is False or _model_has_video_or_audio_inputs(model):
        return False
    task_modes = {str(value) for value in model.get("task_modes") or []}
    input_patterns = {str(value) for value in model.get("input_patterns") or []}
    image_min = _input_limit(model, "image", "required_min")
    image_max = _input_limit(model, "image", "required_max")

    if requires_image:
        return image_max > 0 and (
            "image_edit" in task_modes
            or "single_image" in input_patterns
            or "image_edit" in input_patterns
        )

    return image_min == 0 and (
        "text_to_image" in task_modes
        or "image_generation" in task_modes
        or "prompt_only" in input_patterns
    )


def _preset_requires_image(image_slots: List[Dict[str, Any]]) -> bool:
    return any(bool(slot.get("required")) for slot in image_slots)


def _compatible_preset_model_keys(image_slots: List[Dict[str, Any]]) -> set[str]:
    requires_image = _preset_requires_image(image_slots)
    return {
        str(model.get("key"))
        for model in kie_adapter.list_models()
        if model.get("key") and _model_supports_structured_preset(model, requires_image=requires_image)
    }


def _model_accepts_preset_image_values(model_key: str) -> bool:
    return _model_key_supports_structured_preset(model_key, requires_image=True)


def _model_key_supports_structured_preset(model_key: str, *, requires_image: bool) -> bool:
    try:
        model = kie_adapter.get_model(model_key)
    except Exception:
        return False
    return _model_supports_structured_preset(model, requires_image=requires_image)


def validate_preset_payload(payload: PresetUpsertRequest) -> Dict[str, Any]:
    template = payload.prompt_template or ""
    text_tokens = sorted(set(TEXT_TOKEN_RE.findall(template)))
    image_tokens = sorted(set(IMAGE_TOKEN_RE.findall(template)))
    text_fields = [dict(field) for field in payload.input_schema_json]
    image_slots = [dict(slot) for slot in payload.input_slots_json]
    text_keys = sorted([field["key"] for field in text_fields])
    slot_keys = sorted([slot["key"] for slot in image_slots])
    if text_tokens != text_keys:
        raise ServiceError("Prompt template text tokens must exactly match configured text field keys.")
    if image_tokens != slot_keys:
        raise ServiceError("Prompt template image slot tokens must exactly match configured image slot keys.")
    if len(text_keys) != len(set(text_keys)) or len(slot_keys) != len(set(slot_keys)):
        raise ServiceError("Preset keys must be unique.")
    applies_to_models = [str(value).strip() for value in payload.applies_to_models if str(value).strip()]
    compatible_models = _compatible_preset_model_keys(image_slots)
    invalid_models = [value for value in applies_to_models if value not in compatible_models]
    if invalid_models:
        raise ServiceError("Unsupported preset model scope: %s" % ", ".join(sorted(invalid_models)))
    if not applies_to_models:
        raise ServiceError("Select at least one compatible image model for this preset.")
    model_key = payload.model_key if payload.model_key in applies_to_models else applies_to_models[0]
    return {
        "key": payload.key,
        "label": payload.label,
        "description": payload.description,
        "status": payload.status,
        "model_key": model_key,
        "source_kind": payload.source_kind,
        "base_builtin_key": payload.base_builtin_key,
        "applies_to_models_json": applies_to_models,
        "applies_to_task_modes_json": payload.applies_to_task_modes,
        "applies_to_input_patterns_json": payload.applies_to_input_patterns,
        "prompt_template": payload.prompt_template or "",
        "system_prompt_template": payload.system_prompt_template or "",
        "system_prompt_ids_json": payload.system_prompt_ids,
        "default_options_json": payload.default_options_json,
        "rules_json": payload.rules_json,
        "requires_image": payload.requires_image,
        "requires_video": payload.requires_video,
        "requires_audio": payload.requires_audio,
        "input_schema_json": text_fields,
        "input_slots_json": image_slots,
        "choice_groups_json": payload.choice_groups_json,
        "thumbnail_path": payload.thumbnail_path,
        "thumbnail_url": payload.thumbnail_url,
        "notes": payload.notes,
        "version": payload.version,
        "priority": payload.priority,
    }


def upsert_preset(payload: PresetUpsertRequest, preset_id: Optional[str] = None) -> Dict[str, Any]:
    record = validate_preset_payload(payload)
    if preset_id:
        record["preset_id"] = preset_id
    return store.create_or_update_preset(record)


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

    payload = record.copy()
    payload.pop("provider_api_key", None)
    payload.pop("provider_base_url", None)
    payload["provider_api_key_configured"] = bool(stored_api_key)
    payload["provider_base_url_configured"] = bool(stored_base_url)
    payload["provider_credential_source"] = credential_source
    return EnhancementConfigRecord(**payload).model_dump()


def probe_enhancement_provider(payload: Dict[str, Any]) -> Dict[str, Any]:
    provider_kind = str(payload.get("provider_kind") or "").strip()
    require_images = bool(payload.get("require_images"))
    model_key = str(payload.get("model_key") or "").strip()
    current_config = store.get_enhancement_config(model_key) if model_key else None
    api_key = payload.get("api_key") or (current_config or {}).get("provider_api_key")
    base_url = payload.get("base_url") or (current_config or {}).get("provider_base_url")
    selected_model_id = payload.get("selected_model_id")
    if provider_kind == "openrouter":
        return enhancement_provider.test_openrouter_connection(
            api_key=api_key,
            model_id=selected_model_id,
            require_images=require_images,
            base_url=base_url,
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
            merged.update(value)
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
        if value.get(key):
            ref[key] = value[key]
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


def _reference_kind_for_path(file_path: Path) -> Optional[str]:
    mime_type, _ = mimetypes.guess_type(file_path.name)
    normalized = str(mime_type or "").lower()
    if normalized.startswith("image/"):
        return "image"
    if normalized.startswith("video/"):
        return "video"
    if normalized.startswith("audio/"):
        return "audio"
    return None


def _reference_kind_from_source(source_mime_type: Optional[str], source_name: Optional[str]) -> str:
    normalized = str(source_mime_type or "").lower().strip()
    if normalized.startswith("video/"):
        return "video"
    if normalized.startswith("audio/"):
        return "audio"
    if normalized.startswith("image/"):
        return "image"
    guessed, _ = mimetypes.guess_type(source_name or "")
    guessed = str(guessed or "").lower()
    if guessed.startswith("video/"):
        return "video"
    if guessed.startswith("audio/"):
        return "audio"
    return "image"


def _reference_extension_from_source(kind: str, source_name: Optional[str], source_mime_type: Optional[str]) -> str:
    explicit = Path(source_name or "").suffix.lower()
    if explicit:
        return explicit
    normalized = str(source_mime_type or "").lower()
    if kind == "video" and "mp4" in normalized:
        return ".mp4"
    if kind == "audio" and "wav" in normalized:
        return ".wav"
    if kind == "audio" and "mpeg" in normalized:
        return ".mp3"
    if "jpeg" in normalized:
        return ".jpg"
    if "png" in normalized:
        return ".png"
    if "webp" in normalized:
        return ".webp"
    if kind == "video":
        return ".mp4"
    if kind == "audio":
        return ".wav"
    return ".png"


def _reference_root_for_kind(kind: str) -> Path:
    if kind == "video":
        return REFERENCE_VIDEOS_ROOT
    if kind == "audio":
        return REFERENCE_AUDIOS_ROOT
    return REFERENCE_IMAGES_ROOT


def _relative_data_path(path_value: Path) -> str:
    return str(path_value.relative_to(settings.data_root)).replace("\\", "/")


def _write_reference_thumb(source_path: Path, digest: str) -> Optional[str]:
    REFERENCE_THUMBS_ROOT.mkdir(parents=True, exist_ok=True)
    thumb_path = REFERENCE_THUMBS_ROOT / f"{digest}.webp"
    if not thumb_path.exists():
        with Image.open(source_path) as image:
            normalized = ImageOps.exif_transpose(image)
            if normalized.mode not in {"RGB", "RGBA"}:
                normalized = normalized.convert("RGB")
            resampling = getattr(getattr(Image, "Resampling", Image), "LANCZOS", Image.LANCZOS)
            normalized.thumbnail((512, 512), resampling)
            normalized.save(thumb_path, "WEBP", quality=82, method=6)
    return _relative_data_path(thumb_path)


def _probe_reference_media_metadata(file_path: Path, kind: str) -> Tuple[Optional[int], Optional[int], Optional[float]]:
    if kind != "image":
        return None, None, None
    try:
        with Image.open(file_path) as image:
            width, height = image.size
        return width, height, None
    except Exception:
        return None, None, None


def _reference_media_path_exists(relative_path: Optional[str]) -> bool:
    if not relative_path:
        return False
    return (settings.data_root / relative_path).exists()


def sanitize_reference_media_record(record: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    stored_path = str(record.get("stored_path") or "").strip()
    if not stored_path or not _reference_media_path_exists(stored_path):
        return None

    normalized = dict(record)
    thumb_path = str(normalized.get("thumb_path") or "").strip()
    poster_path = str(normalized.get("poster_path") or "").strip()
    if thumb_path and not _reference_media_path_exists(thumb_path):
        normalized["thumb_path"] = None
    if poster_path and not _reference_media_path_exists(poster_path):
        normalized["poster_path"] = None
    return normalized


def list_available_reference_media(*, kind: Optional[str], limit: int, offset: int, project_id: Optional[str] = None) -> List[Dict[str, Any]]:
    page_size = max(limit * 2, 40)
    skipped_live_offset = 0
    raw_offset = 0
    items: List[Dict[str, Any]] = []

    while len(items) < limit:
        batch = store.list_reference_media(kind=kind, limit=page_size, offset=raw_offset, project_id=project_id)
        if not batch:
            break
        raw_offset += len(batch)
        for record in batch:
            normalized = sanitize_reference_media_record(record)
            if normalized is None:
                continue
            if skipped_live_offset < offset:
                skipped_live_offset += 1
                continue
            items.append(normalized)
            if len(items) >= limit:
                break

    return items


def import_reference_media_bytes(
    *,
    source_bytes: bytes,
    source_name: Optional[str] = None,
    source_mime_type: Optional[str] = None,
) -> Dict[str, Any]:
    if not source_bytes:
        raise ServiceError("Choose a reference file to import.")

    kind = _reference_kind_from_source(source_mime_type, source_name)
    file_size_bytes = len(source_bytes)
    digest = sha256(source_bytes).hexdigest()
    existing = store.get_reference_media_by_hash(kind, digest, file_size_bytes)
    if existing:
        existing_path = settings.data_root / str(existing.get("stored_path") or "")
        if existing.get("stored_path") and existing_path.exists():
            return store.mark_reference_media_used(str(existing["reference_id"]))

    extension = _reference_extension_from_source(kind, source_name, source_mime_type)
    root = _reference_root_for_kind(kind)
    root.mkdir(parents=True, exist_ok=True)
    stored_path = root / f"{digest}{extension}"
    if not stored_path.exists():
        stored_path.write_bytes(source_bytes)

    width, height, duration_seconds = _probe_reference_media_metadata(stored_path, kind)
    thumb_path = _write_reference_thumb(stored_path, digest) if kind == "image" else None
    mime_type = source_mime_type or mimetypes.guess_type(source_name or stored_path.name)[0]

    payload = {
        "kind": kind,
        "status": "active",
        "original_filename": source_name or stored_path.name,
        "stored_path": _relative_data_path(stored_path),
        "mime_type": mime_type,
        "file_size_bytes": file_size_bytes,
        "sha256": digest,
        "width": width,
        "height": height,
        "duration_seconds": duration_seconds,
        "thumb_path": thumb_path,
        "poster_path": None,
        "usage_count": 1,
        "metadata_json": {},
    }

    if existing:
        updated_existing = store.mark_reference_media_used(str(existing["reference_id"]))
        return store.create_or_update_reference_media(
            {
                **updated_existing,
                **payload,
                "reference_id": updated_existing["reference_id"],
                "usage_count": updated_existing["usage_count"],
                "last_used_at": updated_existing.get("last_used_at"),
            }
        )

    return store.create_or_reuse_reference_media(payload, increment_usage=True)


def _sha256_file(file_path: Path) -> str:
    digest = sha256()
    with file_path.open("rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def iter_existing_upload_files() -> Iterable[Path]:
    uploads_dir = settings.uploads_dir
    if not uploads_dir.exists():
        return []
    return (path for path in uploads_dir.rglob("*") if path.is_file())


def backfill_reference_media() -> Dict[str, Any]:
    started = perf_counter()
    scanned = 0
    imported = 0
    reused = 0
    skipped = 0
    errors: List[str] = []

    with _reference_media_backfill_lock:
        for file_path in iter_existing_upload_files():
            scanned += 1
            kind = _reference_kind_for_path(file_path)
            if not kind:
                skipped += 1
                continue
            try:
                digest = _sha256_file(file_path)
                relative_path = str(file_path.relative_to(settings.data_root)).replace("\\", "/")
                file_size_bytes = file_path.stat().st_size
                existing = store.get_reference_media_by_hash(kind, digest, file_size_bytes)
                width, height, duration_seconds = _probe_reference_media_metadata(file_path, kind)
                record = store.create_or_reuse_reference_media(
                    {
                        "kind": kind,
                        "status": "active",
                        "original_filename": file_path.name,
                        "stored_path": relative_path,
                        "mime_type": mimetypes.guess_type(file_path.name)[0],
                        "file_size_bytes": file_size_bytes,
                        "sha256": digest,
                        "width": width,
                        "height": height,
                        "duration_seconds": duration_seconds,
                        "thumb_path": None,
                        "poster_path": None,
                        "usage_count": 0,
                        "metadata_json": {"backfilled": True},
                    },
                    increment_usage=False,
                )
                if existing or record.get("stored_path") != relative_path:
                    reused += 1
                else:
                    imported += 1
            except Exception as exc:
                skipped += 1
                errors.append(f"{file_path}: {exc}")

    duration_seconds = round(perf_counter() - started, 3)
    result = {
        "scanned": scanned,
        "imported": imported,
        "reused": reused,
        "skipped": skipped,
        "errors": errors,
        "duration_seconds": duration_seconds,
    }
    logger.info(
        "reference_media_backfill scanned=%s imported=%s reused=%s skipped=%s errors=%s duration_seconds=%s",
        scanned,
        imported,
        reused,
        skipped,
        len(errors),
        duration_seconds,
    )
    return result


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
    if not _model_key_supports_structured_preset(request.model_key, requires_image=_preset_requires_image(slots)):
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
    if not has_numeric_estimate:
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
        if mime_type.startswith("image/"):
            return "image"
    suffix = output_path.suffix.lower()
    if suffix in {".mp4", ".mov", ".webm", ".mkv", ".avi"}:
        return "video"
    if suffix in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
        return "image"
    task_mode = str(job.get("task_mode") or "").lower()
    if "video" in task_mode:
        return "video"
    model_key = str(job.get("model_key") or "").lower()
    if "video" in model_key or "i2v" in model_key or "t2v" in model_key:
        return "video"
    return "image"


def _normalized_output_source_path(job: Dict[str, Any], output_path: Path, remote_output_url: Optional[str]) -> Path:
    output_kind = _infer_output_kind(job, output_path, remote_output_url)
    if output_kind == "video" and output_path.suffix.lower() not in {".mp4", ".mov", ".webm", ".mkv", ".avi"}:
        normalized = output_path.with_suffix(".mp4")
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


def publish_job_artifact(job: Dict[str, Any], output_path: Path, remote_output_url: Optional[str] = None) -> Dict[str, Any]:
    existing_asset = store.get_asset_by_job_id(job["job_id"])
    normalized_output_path = _normalized_output_source_path(job, output_path, remote_output_url)
    output_kind = _infer_output_kind(job, normalized_output_path, remote_output_url)
    payload = job["submit_response_json"]
    status = job["final_status_json"]
    artifact = kie_adapter.create_run_artifact(
        {
            "status": "succeeded",
            "model_key": job["model_key"],
            "task_mode": job.get("task_mode"),
            "provider_model": (job["validation_json"].get("normalized_request") or {}).get("provider_model"),
            "slug": job["job_id"],
            "created_at": datetime.now(timezone.utc).isoformat(),
            "prompts": {
                "raw": job.get("raw_prompt"),
                "enhanced": job.get("enhanced_prompt"),
                "final_used": job.get("final_prompt_used"),
                "prompt_profile": job["prompt_context_json"].get("resolved_profile_key"),
            },
            "outputs": [{"kind": output_kind, "role": "output", "source_path": str(normalized_output_path)}],
            "options": job["resolved_options_json"],
            "provider_trace": {
                "task_id": job.get("provider_task_id"),
            },
            "submit_payload": payload.get("provider_payload"),
            "submit_response": payload,
            "final_status_response": status,
        }
    )
    output = artifact["outputs"][0]
    generation_kind = "video" if output_kind == "video" else "image"
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
        "hero_thumb_path": _relative_media_path(artifact, output.get("thumb_path")),
        "hero_poster_path": _relative_media_path(artifact, output.get("poster_path")),
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
    output_path = downloads_dir / ("%s.png" % job["job_id"])
    _fake_output_image(output_path, job.get("final_prompt_used") or job.get("raw_prompt") or job["model_key"])
    return publish_job_artifact(job, output_path)
