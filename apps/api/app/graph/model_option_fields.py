from __future__ import annotations

from typing import Any, Dict, List, Optional

from .schemas import GraphNodeField


UNSUPPORTED_GRAPH_MODEL_OPTIONS = {
    "kling-3.0-motion": {"background_source"},
}


def title_from_key(value: str) -> str:
    return " ".join(part.capitalize() for part in value.replace("_", " ").replace("-", " ").split())


def normalized_model_key(value: str) -> str:
    return str(value or "").strip().lower().replace("_", "-")


def is_seedance_model(model_key: str) -> bool:
    normalized = normalized_model_key(model_key)
    return normalized == "seedance-2.0" or normalized.startswith("seedance-2.0")


def is_suno_model(model_key: str) -> bool:
    normalized = normalized_model_key(model_key)
    return normalized.startswith("suno-") or "suno" in normalized


def is_supported_graph_model_option(model_key: str, option_key: str) -> bool:
    blocked = UNSUPPORTED_GRAPH_MODEL_OPTIONS.get(normalized_model_key(model_key), set())
    return option_key not in blocked


def visible_condition_from_option(spec: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    raw_condition = spec.get("ui_visible_when")
    if not isinstance(raw_condition, dict) or not raw_condition:
        return None
    field, expected = next(iter(raw_condition.items()))
    if not isinstance(field, str) or not field.strip():
        return None
    if isinstance(expected, list):
        return {"field": field, "in": expected}
    return {"field": field, "equals": expected}


def fallback_required_graph_default(key: str, field_type: str, spec: Dict[str, Any]) -> Any:
    if not spec.get("required"):
        return None
    if field_type == "boolean":
        return False
    allowed = list(spec.get("allowed") or [])
    if field_type == "select" and allowed:
        return allowed[0]
    if field_type in {"integer", "float"}:
        minimum = spec.get("min")
        maximum = spec.get("max")
        if key == "duration" and isinstance(minimum, (int, float)) and isinstance(maximum, (int, float)) and minimum <= 5 <= maximum:
            return 5
        if isinstance(minimum, (int, float)):
            return int(minimum) if field_type == "integer" else float(minimum)
    return None


def graph_field_from_model_option(key: str, spec: Dict[str, Any], *, field_id: str | None = None) -> Optional[GraphNodeField]:
    if spec.get("hidden_from_studio"):
        return None
    option_type = str(spec.get("type") or "text")
    ui_control = str(spec.get("ui_control") or "").lower()
    field_type = "text"
    if option_type == "enum":
        field_type = "select"
    elif option_type == "bool":
        field_type = "boolean"
    elif option_type == "int_range":
        field_type = "integer"
    elif option_type in {"float_range", "number_range"}:
        field_type = "float"
    elif option_type == "string" and ui_control == "textarea":
        field_type = "textarea"
    label = spec.get("label") or title_from_key(key)
    help_text = spec.get("help_text") or spec.get("notes")
    if key == "return_last_frame":
        label = spec.get("label") or "Output Last Frame"
        help_text = help_text or "Also request a still image for the final video frame so it can be wired into image nodes."
    default = spec.get("default")
    if default is None:
        default = fallback_required_graph_default(key, field_type, spec)
    return GraphNodeField(
        id=field_id or key,
        label=str(label),
        type=field_type,
        required=bool(spec.get("required")),
        default=default,
        options=list(spec.get("allowed") or []),
        min=spec.get("min"),
        max=spec.get("max"),
        help_text=help_text,
        advanced=bool(spec.get("advanced")),
        visible_if=visible_condition_from_option(spec),
    )


def suno_graph_fields(raw_options: Dict[str, Any]) -> List[GraphNodeField]:
    model_spec = raw_options.get("suno_model") if isinstance(raw_options.get("suno_model"), dict) else {}
    model_options = model_spec.get("allowed") if isinstance(model_spec, dict) else []
    return [
        GraphNodeField(
            id="suno_model",
            label="Model",
            type="select",
            required=True,
            default=model_spec.get("default") or "V5",
            options=model_options if isinstance(model_options, list) else ["V5"],
            help_text="Suno model version used for generation.",
        ),
        GraphNodeField(
            id="custom_mode",
            label="Custom Mode",
            type="boolean",
            default=False,
            help_text="Turn on when you want to provide a title, style, lyrics, or persona.",
        ),
        GraphNodeField(
            id="song_description",
            label="Song Description",
            type="textarea",
            default="",
            placeholder="Describe the instrumental track, arrangement, and production style...",
            help_text="Used when Custom Mode is off. KIE currently limits this prompt to 500 characters.",
            connectable=True,
            port_type="text",
            visible_if={"field": "custom_mode", "not_equals": True},
        ),
        GraphNodeField(
            id="title",
            label="Title",
            type="text",
            default="",
            help_text="Song title for Custom Mode. Up to 80 characters.",
            visible_if={"field": "custom_mode", "equals": True},
        ),
        GraphNodeField(
            id="style",
            label="Style Of Music",
            type="textarea",
            default="",
            placeholder="Genre, instrumentation, mood, and production tags...",
            help_text="Music style for Custom Mode. Up to 1,000 characters.",
            visible_if={"field": "custom_mode", "equals": True},
        ),
        GraphNodeField(
            id="persona_id",
            label="Persona ID",
            type="text",
            default="",
            help_text="Optional Suno persona identifier.",
            visible_if={"field": "custom_mode", "equals": True},
        ),
        GraphNodeField(id="instrumental", label="Instrumental", type="boolean", default=False, help_text="Generate music without vocals."),
        GraphNodeField(
            id="lyrics",
            label="Lyrics",
            type="textarea",
            default="",
            placeholder="Paste lyrics here when Custom Mode is on...",
            help_text="Lyrics for Custom Mode. Leave empty for instrumental tracks.",
            connectable=True,
            port_type="text",
            visible_if={"field": "custom_mode", "equals": True},
        ),
        GraphNodeField(
            id="vocal_gender",
            label="Vocal Gender",
            type="select",
            default="",
            options=["m", "f"],
            help_text="Optional vocal direction. Suno may not strictly follow this field.",
            visible_if={"field": "custom_mode", "equals": True},
        ),
        GraphNodeField(
            id="audio_weight",
            label="Audio Weight",
            type="float",
            default="",
            min=0,
            max=1,
            help_text="Controls adherence to audio/persona guidance where supported.",
        ),
    ]
