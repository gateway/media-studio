from __future__ import annotations

import sqlite3
from typing import Any, Dict, Iterable, List

from .. import kie_adapter, store
from .model_option_fields import graph_field_from_model_option, is_supported_graph_model_option
from .prompt_recipe_catalog import slug, title_from_key
from .schemas import GraphNodeField, GraphNodePort


MODEL_OPTION_FIELD_PREFIX = "option__"


def _model_labels() -> Dict[str, str]:
    labels: Dict[str, str] = {}
    for model in kie_adapter.list_models():
        key = str(model.get("key") or "").strip()
        if not key:
            continue
        labels[key] = str(model.get("label") or model.get("name") or title_from_key(key))
    return labels


def _models_by_key() -> Dict[str, Dict[str, Any]]:
    return {str(model.get("key") or "").strip(): model for model in kie_adapter.list_models() if str(model.get("key") or "").strip()}


def _compatible_models(preset: Dict[str, Any]) -> List[str]:
    models = [str(item).strip() for item in (preset.get("applies_to_models_json") or preset.get("applies_to_models") or []) if str(item).strip()]
    model_key = str(preset.get("model_key") or "").strip()
    if model_key and model_key not in models:
        models.insert(0, model_key)
    return models


def _field_help_text(*, required: bool, detail: str) -> str:
    prefix = "Required." if required else "Optional."
    return f"{prefix} {detail}".strip() if detail else prefix


def _selection_summary(preset: Dict[str, Any], compatible_models: List[Dict[str, str]]) -> Dict[str, Any]:
    label = str(preset.get("label") or preset.get("key") or preset.get("preset_id") or "Media Preset")
    image_slots = preset.get("input_slots_json") or []
    required_slots = [str(slot.get("label") or title_from_key(str(slot.get("key") or ""))) for slot in image_slots if slot.get("required")]
    slot_count = len(image_slots)
    model_label = compatible_models[0]["label"] if compatible_models else "No compatible model"
    details = [f"Model: {model_label}", f"Image slots: {slot_count}"]
    if required_slots:
        details.append("Required images: " + ", ".join(required_slots))
    else:
        details.append("Required images: none")
    return {
        "title": label,
        "subtitle": "Media Preset",
        "description": str(preset.get("description") or "Run this saved Media Preset."),
        "details": details,
    }


def media_preset_catalog(*, status: str = "all") -> List[Dict[str, Any]]:
    try:
        presets = store.list_presets()
    except sqlite3.OperationalError as exc:
        if "no such table: media_presets" not in str(exc):
            raise
        presets = []
    model_labels = _model_labels()
    catalog: List[Dict[str, Any]] = []
    for preset in presets:
        status_value = str(preset.get("status") or "active")
        if status == "active" and status_value != "active":
            continue
        preset_id = str(preset.get("preset_id") or "").strip()
        if not preset_id:
            continue
        compatible_model_keys = _compatible_models(preset)
        compatible_models = [
            {"value": model_key, "label": model_labels.get(model_key) or title_from_key(model_key)}
            for model_key in compatible_model_keys
        ]
        text_fields = []
        for field in preset.get("input_schema_json") or []:
            key = str(field.get("key") or "").strip()
            if not key:
                continue
            detail = str(field.get("help_text") or field.get("description") or "").strip()
            text_fields.append(
                {
                    "key": key,
                    "label": str(field.get("label") or title_from_key(key)),
                    "type": "textarea" if field.get("multiline") else "text",
                    "required": bool(field.get("required")),
                    "default_value": field.get("default_value"),
                    "placeholder": field.get("placeholder"),
                    "help_text": detail,
                    "display_help_text": _field_help_text(required=bool(field.get("required")), detail=detail),
                }
            )
        image_slots = []
        for slot in preset.get("input_slots_json") or []:
            key = str(slot.get("key") or "").strip()
            if not key:
                continue
            max_files = int(slot.get("max_files") or 1)
            detail = str(slot.get("help_text") or slot.get("description") or "").strip()
            image_slots.append(
                {
                    "key": key,
                    "label": str(slot.get("label") or title_from_key(key)),
                    "required": bool(slot.get("required")),
                    "max_files": max(1, max_files),
                    "help_text": detail,
                }
            )
        catalog.append(
            {
                "preset_id": preset_id,
                "key": str(preset.get("key") or preset_id),
                "label": str(preset.get("label") or preset.get("key") or preset_id),
                "description": str(preset.get("description") or ""),
                "status": status_value,
                "compatible_models": compatible_models,
                "default_model_key": compatible_model_keys[0] if compatible_model_keys else "",
                "default_options": dict(preset.get("default_options_json") or {}) if isinstance(preset.get("default_options_json"), dict) else {},
                "text_fields": text_fields,
                "image_slots": image_slots,
                "selection_summary": _selection_summary(preset, compatible_models),
            }
        )
    catalog.sort(key=lambda item: (str(item.get("label") or "").lower(), str(item.get("preset_id") or "").lower()))
    return catalog


def media_preset_model_option_fields_by_model(catalog: Iterable[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    models_by_key = _models_by_key()
    model_keys = sorted(
        {
            str(model.get("value") or "").strip()
            for preset in catalog
            for model in (preset.get("compatible_models") or [])
            if str(model.get("value") or "").strip()
        }
    )
    fields_by_model: Dict[str, List[Dict[str, Any]]] = {}
    for model_key in model_keys:
        model = models_by_key.get(model_key)
        raw = model.get("raw") if isinstance(model, dict) else {}
        raw_options = raw.get("options") if isinstance(raw, dict) else {}
        if not isinstance(raw_options, dict):
            continue
        fields: List[Dict[str, Any]] = []
        for option_key, option in raw_options.items():
            key = str(option_key)
            if not is_supported_graph_model_option(model_key, key):
                continue
            field = graph_field_from_model_option(
                key,
                option if isinstance(option, dict) else {},
                field_id=f"{MODEL_OPTION_FIELD_PREFIX}{key}",
            )
            if not field:
                continue
            payload = field.model_dump(mode="json")
            payload["option_key"] = key
            visible_if = payload.get("visible_if")
            if isinstance(visible_if, dict) and isinstance(visible_if.get("field"), str):
                visible_if["field"] = f"{MODEL_OPTION_FIELD_PREFIX}{visible_if['field']}"
            fields.append(payload)
        if fields:
            fields_by_model[model_key] = fields
    return fields_by_model


def media_preset_picker_options(catalog: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [
        {
            "value": str(item["preset_id"]),
            "label": str(item["label"]),
            "description": str(item.get("description") or ""),
            "selection_summary": dict(item.get("selection_summary") or {}),
        }
        for item in catalog
    ]


def media_preset_search_aliases(catalog: Iterable[Dict[str, Any]]) -> List[str]:
    aliases = ["media preset", "preset", "image preset"]
    for item in catalog:
        aliases.extend([str(item.get("label") or ""), str(item.get("key") or "")])
    deduped: List[str] = []
    seen: set[str] = set()
    for alias in aliases:
        normalized = alias.strip().lower()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        deduped.append(alias)
    return deduped


def media_preset_model_options(catalog: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    options: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for preset in catalog:
        for model in preset.get("compatible_models") or []:
            value = str(model.get("value") or "").strip()
            if not value or value in seen:
                continue
            seen.add(value)
            options.append({"value": value, "label": str(model.get("label") or title_from_key(value))})
    return options


def media_preset_input_ports(catalog: Iterable[Dict[str, Any]]) -> List[GraphNodePort]:
    merged: Dict[str, Dict[str, Any]] = {}
    for preset in catalog:
        preset_id = str(preset.get("preset_id") or "")
        for slot in preset.get("image_slots") or []:
            key = str(slot.get("key") or "").strip()
            if not key:
                continue
            port_id = f"slot__{slug(key)}"
            entry = merged.setdefault(
                port_id,
                {
                    "label": str(slot.get("label") or title_from_key(key)),
                    "max_files": 1,
                    "preset_ids": [],
                },
            )
            entry["preset_ids"].append(preset_id)
            entry["max_files"] = max(int(entry["max_files"]), int(slot.get("max_files") or 1))
    ports: List[GraphNodePort] = []
    for port_id, entry in sorted(merged.items(), key=lambda item: str(item[1]["label"]).lower()):
        ports.append(
            GraphNodePort(
                id=port_id,
                label=str(entry["label"]),
                type="image",
                array=True,
                min=0,
                max=int(entry["max_files"]) or None,
                required=False,
                accepts=["image"],
                description="Image input for the selected Media Preset.",
                visible_if={"field": "preset_id", "in": sorted({str(item) for item in entry["preset_ids"]})},
            )
        )
    return ports


def media_preset_dynamic_fields(catalog: Iterable[Dict[str, Any]]) -> List[GraphNodeField]:
    merged: Dict[str, Dict[str, Any]] = {}
    for preset in catalog:
        preset_id = str(preset.get("preset_id") or "")
        for field in preset.get("text_fields") or []:
            key = str(field.get("key") or "").strip()
            if not key:
                continue
            field_id = f"text__{slug(key)}"
            entry = merged.setdefault(
                field_id,
                {
                    "label": str(field.get("label") or title_from_key(key)),
                    "type": str(field.get("type") or "text"),
                    "placeholder": str(field.get("placeholder") or ""),
                    "help_text": str(field.get("display_help_text") or field.get("help_text") or ""),
                    "preset_ids": [],
                },
            )
            entry["preset_ids"].append(preset_id)
    fields: List[GraphNodeField] = []
    for field_id, entry in sorted(merged.items(), key=lambda item: str(item[1]["label"]).lower()):
        fields.append(
            GraphNodeField(
                id=field_id,
                label=str(entry["label"]),
                type=str(entry["type"]),
                required=False,
                default=None,
                placeholder=str(entry.get("placeholder") or "") or None,
                options=list(entry.get("options") or []),
                help_text=str(entry.get("help_text") or "") or None,
                visible_if={"field": "preset_id", "in": sorted({str(item) for item in entry["preset_ids"]})},
            )
        )
    return fields
