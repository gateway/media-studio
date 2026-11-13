from __future__ import annotations

import hashlib
import json
from typing import Any, Dict, Iterable, List, Optional, Tuple

from .seedance import is_seedance_model


KNOWN_STUDIO_INPUT_PATTERNS = {
    "prompt_only",
    "single_image",
    "image_edit",
    "first_last_frames",
    "motion_control",
    "multimodal_reference",
}

HIDDEN_STUDIO_OPTION_KEYS: set[str] = set()

# The SDK applies option defaults to every request. These defaults are for active Studio controls.
_STILL_FORMATS = ["png", "jpeg", "webp"]
_GPT_IMAGE_OUTPUT_OPTIONS = {
    "output_format": {"label": "File format", "ui_order": 10},
    "aspect_ratio": {
        "label": "Aspect ratio", "ui_order": 20,
        "ui_choice_labels": {"auto": "Auto"},
        "ui_visible_when": {"output_format": _STILL_FORMATS},
    },
    "resolution": {"ui_order": 30, "ui_visible_when": {"output_format": _STILL_FORMATS}},
    "background": {
        "default": "auto",
        "ui_order": 40,
        "ui_visible_when": {"output_format": [*_STILL_FORMATS, "gif"], "resolution": ["1K", None]},
        "ui_choice_visible_when": {"transparent": {"output_format": ["png", "webp", "gif"]}},
    },
    "output_compression": {
        "label": "Compression", "ui_order": 50, "ui_visible_when": {"output_format": ["jpeg", "webp"]},
    },
    "frame_count": {
        "label": "Frame count", "default": 9, "ui_order": 20, "ui_visible_when": {"output_format": "gif"},
    },
    "frame_duration_ms": {
        "label": "Time per frame (ms)", "default": 200, "ui_step": 10, "ui_order": 30,
        "ui_visible_when": {"output_format": "gif"},
    },
    "size": {
        "label": "Frame size", "default": "auto", "ui_control": "text", "ui_order": 50,
        "ui_visible_when": {"output_format": "gif"},
    },
    "svg_model": {
        "label": "SVG author", "default": "gpt-5.6-luna", "ui_order": 20,
        "ui_choice_labels": {
            "gpt-6-sol": "GPT-6 Sol",
            "gpt-5.6-luna": "GPT-5.6 Luna",
            "gpt-5.6-terra": "GPT-5.6 Terra",
        },
        "ui_visible_when": {"output_format": "svg"},
    },
    "quality": {"ui_group": "advanced"},
    "complexity": {"label": "Planning complexity", "ui_group": "advanced"},
    "moderation": {"ui_group": "advanced"},
}
_STUDIO_OPTION_OVERRIDES = {
    **{
        f"gpt-image-2-6-{tier}-{mode}-to-image": _GPT_IMAGE_OUTPUT_OPTIONS
        for tier in ("sunburst", "flare")
        for mode in ("text", "image")
    },
    "kling-3.0-i2v": {
        "aspect_ratio": {"ui_visible_when": {"$input_pattern": ["prompt_only", "single_image"]}},
    },
}


def _is_record(value: Any) -> bool:
    return isinstance(value, dict)


def _input_limit(raw: Dict[str, Any], input_key: str) -> int:
    inputs = raw.get("inputs") if _is_record(raw.get("inputs")) else {}
    spec = inputs.get(input_key) if _is_record(inputs) else None
    if not _is_record(spec):
        return 0
    raw_max = spec.get("required_max")
    raw_value = raw_max if raw_max not in (None, "") else spec.get("required_min")
    try:
        parsed = int(raw_value or 0)
    except (TypeError, ValueError):
        return 0
    return max(0, parsed)


def _prompt_patterns(raw: Dict[str, Any]) -> List[str]:
    prompt = raw.get("prompt") if _is_record(raw.get("prompt")) else {}
    by_pattern = prompt.get("default_profile_keys_by_input_pattern") if _is_record(prompt) else {}
    if not _is_record(by_pattern):
        return []
    return [str(key) for key in by_pattern if str(key)]


def _unique(values: Iterable[str]) -> List[str]:
    seen: set[str] = set()
    result: List[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def supported_model_input_patterns(model: Dict[str, Any]) -> List[str]:
    return _unique([*model.get("input_patterns", []), *_prompt_patterns(model.get("raw") or {})])


def option_choices(schema: Dict[str, Any], current_value: Any = None) -> List[Any]:
    declared: List[Any] = []
    for key in ("allowed", "enum", "allowed_values", "choices"):
        value = schema.get(key)
        if isinstance(value, list):
            declared = value
            break
    if schema.get("type") == "int_range":
        minimum = schema.get("min")
        maximum = schema.get("max")
        if (
            isinstance(minimum, (int, float))
            and isinstance(maximum, (int, float))
            and float(minimum).is_integer()
            and float(maximum).is_integer()
            and maximum >= minimum
        ):
            minimum_int = int(minimum)
            maximum_int = int(maximum)
            ranged = range(minimum_int, maximum_int + 1)
            if declared:
                return [*declared, *(value for value in ranged if value not in declared)]
            if maximum_int - minimum_int <= 20:
                return list(ranged)
    if declared:
        return declared
    if schema.get("type") in {"bool", "boolean"} or isinstance(current_value, bool) or isinstance(schema.get("default"), bool):
        return [True, False]
    if schema.get("type") in {"float_range", "number_range"}:
        minimum = schema.get("min")
        maximum = schema.get("max")
        if isinstance(minimum, int) and isinstance(maximum, int) and maximum >= minimum and maximum - minimum <= 20:
            return list(range(minimum, maximum + 1))
    return []


def _option_label(option_key: str, schema: Dict[str, Any]) -> str:
    label = schema.get("label")
    if isinstance(label, str) and label.strip():
        return label.strip()
    return option_key.replace("_", " ").title()


def _normalize_option_type(schema: Dict[str, Any]) -> str:
    raw_type = str(schema.get("type") or "").lower()
    if raw_type in {"bool", "boolean"}:
        return "bool"
    if raw_type in {"int_range", "float_range", "number_range", "integer", "number"}:
        return "int_range"
    if raw_type == "string":
        return "string"
    if option_choices(schema, schema.get("default")):
        return "enum"
    return raw_type or "unknown"


def _studio_option_supported(schema: Dict[str, Any]) -> bool:
    option_type = _normalize_option_type(schema)
    if option_type == "enum":
        return bool(option_choices(schema, schema.get("default")))
    if option_type == "bool":
        return True
    if option_type == "int_range":
        return schema.get("min") is not None or schema.get("max") is not None or bool(option_choices(schema, schema.get("default")))
    if option_type == "string":
        return schema.get("ui_control") == "text"
    return False


def _dynamic_option(option_key: str, schema: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if option_key in HIDDEN_STUDIO_OPTION_KEYS or schema.get("hidden_from_studio") is True:
        return None
    if not _studio_option_supported(schema):
        return None

    option_type = _normalize_option_type(schema)
    payload: Dict[str, Any] = {
        "key": option_key,
        "type": option_type,
        "label": _option_label(option_key, schema),
        "help_text": schema.get("help_text") or schema.get("notes"),
        "ui_group": schema.get("ui_group"),
        "ui_order": schema.get("ui_order"),
        "advanced": bool(schema.get("advanced") or False),
        "required": bool(schema.get("required") or False),
        "default": schema.get("default"),
        "hidden_from_studio": False,
    }
    choices = option_choices(schema, schema.get("default"))
    if option_type in {"enum", "bool"} or choices:
        payload["allowed"] = choices
    _copy_option_metadata(payload, schema)
    return payload


def _copy_option_metadata(payload: Dict[str, Any], schema: Dict[str, Any]) -> None:
    for key in ("min", "max"):
        if schema.get(key) is not None:
            payload[key] = schema[key]
    for key in ("ui_control", "ui_visible_when", "ui_choice_visible_when", "ui_choice_labels", "ui_step", "value_aliases"):
        if schema.get(key):
            payload[key] = schema[key]


def _studio_option_schemas(model_key: Any, raw: Dict[str, Any]) -> Dict[str, Any]:
    options = raw.get("options") if _is_record(raw.get("options")) else {}
    overrides = _STUDIO_OPTION_OVERRIDES.get(model_key, {})
    return {
        key: {**schema, **overrides.get(key, {})}
        for key, schema in options.items()
        if _is_record(schema)
    }


def _dynamic_options(options: Dict[str, Any]) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for option_key, schema in options.items():
        dynamic = _dynamic_option(str(option_key), schema)
        if dynamic is not None:
            rows.append(dynamic)
    return sorted(rows, key=lambda item: (item.get("ui_order") is None, item.get("ui_order") or 0, item["label"]))


def _unsupported_option_keys(options: Dict[str, Any]) -> List[str]:
    keys: List[str] = []
    for option_key, schema in options.items():
        if option_key in HIDDEN_STUDIO_OPTION_KEYS or schema.get("hidden_from_studio") is True:
            continue
        if not _studio_option_supported(schema):
            keys.append(str(option_key))
    return sorted(keys)


def _unsupported_summary(hidden_reason: str, unsupported_option_keys: List[str]) -> str:
    if not unsupported_option_keys:
        return hidden_reason
    return f"{hidden_reason} Unsupported option controls: {', '.join(unsupported_option_keys)}."


def derive_studio_model_support(model: Dict[str, Any]) -> Dict[str, Any]:
    raw = model.get("raw") or {}
    patterns = supported_model_input_patterns(model)
    unsupported_input_patterns = [pattern for pattern in patterns if pattern not in KNOWN_STUDIO_INPUT_PATTERNS]
    options = _studio_option_schemas(model.get("key"), raw)
    unsupported_option_keys = _unsupported_option_keys(options)
    max_image_inputs = _input_limit(raw, "image")
    max_video_inputs = _input_limit(raw, "video")
    max_audio_inputs = _input_limit(raw, "audio")
    pattern_set = set(patterns)

    if not patterns:
        hidden_reason = "Studio could not recognize any supported input pattern for this model."
        status = "unsupported"
        support_summary = _unsupported_summary(hidden_reason, unsupported_option_keys)
        supported_patterns: List[str] = []
    elif unsupported_input_patterns:
        hidden_reason = f"Studio does not understand this model's input pattern yet: {', '.join(unsupported_input_patterns)}."
        status = "unsupported"
        support_summary = _unsupported_summary(hidden_reason, unsupported_option_keys)
        supported_patterns = [pattern for pattern in patterns if pattern in KNOWN_STUDIO_INPUT_PATTERNS]
    elif "multimodal_reference" in pattern_set and not is_seedance_model(model.get("key")):
        hidden_reason = "Studio only exposes multimodal reference contracts through the dedicated Seedance flow right now."
        status = "unsupported"
        support_summary = _unsupported_summary(hidden_reason, unsupported_option_keys)
        supported_patterns = patterns
    else:
        prompt_only = pattern_set == {"prompt_only"}
        explicit_first_last = (
            "first_last_frames" in pattern_set and max_image_inputs == 2 and max_video_inputs == 0 and max_audio_inputs == 0
        )
        explicit_motion = (
            "motion_control" in pattern_set and max_image_inputs == 1 and max_video_inputs == 1 and max_audio_inputs == 0
        )
        explicit_single_image = (
            "motion_control" not in pattern_set
            and "multimodal_reference" not in pattern_set
            and max_image_inputs == 1
            and max_video_inputs == 0
            and max_audio_inputs == 0
            and ("single_image" in pattern_set or "image_edit" in pattern_set)
        )
        generic_image_only = (
            "first_last_frames" not in pattern_set
            and "motion_control" not in pattern_set
            and "multimodal_reference" not in pattern_set
            and max_image_inputs > 1
            and max_video_inputs == 0
            and max_audio_inputs == 0
            and all(pattern in {"prompt_only", "single_image", "image_edit"} for pattern in pattern_set)
            and ("single_image" in pattern_set or "image_edit" in pattern_set)
        )
        supported_seedance = is_seedance_model(model.get("key")) and all(
            pattern in {"prompt_only", "single_image", "first_last_frames", "multimodal_reference"} for pattern in pattern_set
        )
        hidden_reason = None
        if supported_seedance:
            status = "fully_supported"
            support_summary = "Studio can use the dedicated Seedance frame and reference composer for this contract."
        elif explicit_motion:
            status = "fully_supported"
            support_summary = "Studio can render explicit source-image and driving-video slots for this model."
        elif explicit_first_last:
            status = "fully_supported"
            support_summary = "Studio can render explicit start-frame and end-frame slots for this model."
        elif explicit_single_image:
            status = "fully_supported"
            support_summary = "Studio can render the standard single-image slot for this model."
        elif prompt_only:
            status = "fully_supported"
            support_summary = "Studio can use the standard prompt-only composer for this model."
        elif generic_image_only:
            status = "generic_supported"
            support_summary = f"Studio will use the generic attachment composer for up to {max_image_inputs} image inputs."
        else:
            status = "unsupported"
            hidden_reason = "Studio does not have a safe composer contract for this mix of image, video, and audio inputs yet."
            support_summary = hidden_reason
        supported_patterns = patterns

    if status != "unsupported" and unsupported_option_keys:
        status = "generic_supported"
        option_summary = (
            "Some options still rely on provider defaults because Studio does not have dropdown controls for: "
            f"{', '.join(unsupported_option_keys)}."
        )
        support_summary = f"{support_summary} {option_summary}" if support_summary else option_summary

    return {
        "studio_support_status": status,
        "studio_exposed": status != "unsupported",
        "studio_supported_input_patterns": supported_patterns,
        "studio_unsupported_input_patterns": unsupported_input_patterns,
        "studio_hidden_reason": hidden_reason,
        "studio_support_summary": support_summary,
        "studio_unsupported_option_keys": unsupported_option_keys,
        "studio_dynamic_options": _dynamic_options(options),
    }


def spec_fingerprint(raw_specs: Iterable[Dict[str, Any]]) -> str:
    digest = hashlib.sha256()
    for raw in sorted(raw_specs, key=lambda item: str(item.get("key") or "")):
        digest.update(json.dumps(raw, sort_keys=True, separators=(",", ":")).encode("utf-8"))
    return digest.hexdigest()[:12]
