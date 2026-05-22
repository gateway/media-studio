from __future__ import annotations

import re
import logging
from typing import Any, Dict, List, Optional

from . import kie_adapter, store
from .service_errors import ServiceError
from .schemas import PresetUpsertRequest, ValidateRequest

logger = logging.getLogger(__name__)
TEXT_TOKEN_RE = re.compile(r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}")
IMAGE_TOKEN_RE = re.compile(r"\[\[\s*([a-zA-Z0-9_]+)\s*\]\]")

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


def _enforce_output_count_policy(request: ValidateRequest) -> None:
    try:
        policy = store.get_model_queue_policy(request.model_key)
    except Exception:
        logger.debug("model queue policy unavailable for output count validation", exc_info=True)
        return
    if not policy:
        return
    max_outputs = int(policy.get("max_outputs_per_run") or 1)
    if request.output_count > max_outputs:
        raise ServiceError("Output count exceeds the selected model limit of %s per run." % max_outputs)


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
