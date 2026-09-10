"""Catalog-backed image model choices shared by settings and Assistant builders."""
from __future__ import annotations

from . import kie_adapter, store
from .graph.registry import registry
from .graph.schemas import GraphNodeDefinition
from .service_errors import ServiceError


def assistant_image_model_defaults() -> dict:
    config = store.get_prompt_recipe_drafting_config("media_assistant") or {}
    return config.get("image_model_defaults_json") or {}


def resolve_image_model(mode: str, model_key: str | None = None) -> GraphNodeDefinition:
    task_mode = {"text_to_image": "text_to_image", "image_to_image": "image_edit"}.get(mode)
    if not task_mode:
        raise ServiceError("Choose text-to-image or image-to-image before selecting an image model.")
    key = model_key or assistant_image_model_defaults().get(mode)
    if not key:
        raise ServiceError(f"Choose a {mode.replace('_', '-')} model or set its default in AI Settings.")
    model = next((item for item in kie_adapter.list_models() if item.get("key") == key), None)
    disabled = any(item.get("model_key") == key and item.get("enabled") is False for item in store.list_model_queue_policies())
    if not model or model.get("studio_exposed") is False or disabled:
        raise ServiceError(f"The selected image model '{key}' is unavailable. Ask for another model; do not substitute one.")
    if task_mode not in model.get("task_modes", []):
        raise ServiceError(f"The selected model '{key}' does not support {mode.replace('_', '-')}.")
    definition = next((item for item in registry.definitions_by_type().values() if (item.source or {}).get("model_key") == key), None)
    if definition is None or not any(port.id == "image" and port.type == "image" for port in definition.ports.get("outputs", [])):
        raise ServiceError(f"The selected model '{key}' has no supported image output node.")
    if not any(port.id == "prompt" and port.type == "text" for port in definition.ports.get("inputs", [])):
        raise ServiceError(f"The selected model '{key}' has no supported prompt input.")
    if mode == "image_to_image" and not any(port.id == "image_refs" and port.type == "image" for port in definition.ports.get("inputs", [])):
        raise ServiceError(f"The selected model '{key}' has no supported reference-image input.")
    return definition


def assistant_image_model_choices() -> dict:
    choices = {"text_to_image": [], "image_to_image": []}
    for mode in choices:
        for model in kie_adapter.list_models():
            try:
                resolve_image_model(mode, model["key"])
            except ServiceError:
                continue
            choices[mode].append({"key": model["key"], "label": model["label"]})
    return choices
