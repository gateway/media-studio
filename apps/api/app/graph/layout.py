from __future__ import annotations

import json
from typing import Any, Dict, Iterable

from .registry import registry
from .schemas import GraphWorkflowNode
from .validator import visible_condition_passes


WORKFLOW_COLUMN_GAP = 320.0
WORKFLOW_ROW_GAP = 160.0
WORKFLOW_NODE_GAP = 96.0
WORKFLOW_GROUP_PADDING = 96.0


def _selected_preset_layout_metrics(definition: Any, fields: Dict[str, Any]) -> tuple[int, int]:
    if definition.type != "preset.render":
        return 0, 0
    selected = fields.get("__preset_catalog_item_json")
    if isinstance(selected, str):
        try:
            selected = json.loads(selected)
        except (TypeError, ValueError):
            return 0, 0
    if not isinstance(selected, dict) or str(selected.get("preset_id") or "") != str(fields.get("preset_id") or ""):
        return 0, 0

    raw_text_fields = selected.get("text_fields") or selected.get("input_schema_json") or []
    text_fields = [item for item in raw_text_fields if isinstance(item, dict) and str(item.get("key") or "").strip()]
    textarea_count = sum(1 for item in text_fields if item.get("type") == "textarea" or item.get("multiline") is True)

    model_key = str(fields.get("preset_model_key") or selected.get("default_model_key") or selected.get("model_key") or "")
    if not model_key:
        compatible_models = selected.get("compatible_models") or []
        if compatible_models:
            first_model = compatible_models[0]
            model_key = str(first_model.get("value") if isinstance(first_model, dict) else first_model)
    source = definition.source if isinstance(definition.source, dict) else {}
    fields_by_model = source.get("model_option_fields_by_model")
    raw_option_fields = fields_by_model.get(model_key, []) if isinstance(fields_by_model, dict) else []
    option_fields = [
        item
        for item in raw_option_fields
        if isinstance(item, dict)
        and not item.get("hidden")
        and visible_condition_passes(item.get("visible_if"), fields, definition)
    ]
    primary_options = [item for item in option_fields if not item.get("advanced")]
    advanced_row_count = 1 if any(item.get("advanced") for item in option_fields) else 0
    textarea_count += sum(1 for item in primary_options if item.get("type") == "textarea")

    # The browser renders two compact selection-summary rows above the selected
    # preset's model options and text inputs.
    layout_field_count = 2 + len(primary_options) + advanced_row_count + len(text_fields)
    return layout_field_count, textarea_count


def _default_size(node_type: str) -> tuple[float, float]:
    definition = registry.get_definition(node_type)
    size = definition.ui.get("default_size") if isinstance(definition.ui, dict) else None
    if isinstance(size, dict):
        return float(size.get("width") or 320), float(size.get("height") or 260)
    return 320.0, 260.0


def node_layout_size(node_type: str, fields: Dict[str, Any] | None = None) -> tuple[float, float]:
    definition = registry.get_definition(node_type)
    fields = fields or {}
    default_width, default_height = _default_size(node_type)
    ui = definition.ui if isinstance(definition.ui, dict) else {}
    min_size = ui.get("min_size") if isinstance(ui.get("min_size"), dict) else {}
    min_width = float(min_size.get("width") or 0)
    min_height = float(min_size.get("height") or 0)
    visible_fields = [field for field in definition.fields if not field.hidden and visible_condition_passes(field.visible_if, fields, definition)]
    visible_ports = [
        port
        for port in [*definition.ports.get("inputs", []), *definition.ports.get("outputs", [])]
        if not port.advanced and visible_condition_passes(port.visible_if, fields, definition)
    ]
    textarea_count = sum(1 for field in visible_fields if field.type == "textarea")
    dynamic_field_count, dynamic_textarea_count = _selected_preset_layout_metrics(definition, fields)
    textarea_count += dynamic_textarea_count
    has_preview = bool(ui.get("preview")) or node_type.startswith("media.load_") or node_type.startswith("media.save_")
    content_height = 132 + len(visible_fields) * 52 + dynamic_field_count * 96 + len(visible_ports) * 28 + textarea_count * 70 + (140 if has_preview else 0)
    preview_width = 0
    preview_height = 0
    if has_preview and ("video" in node_type or any(port.type == "video" for port in visible_ports)):
        preview_width = 380
        preview_height = 360
    elif has_preview and ("image" in node_type or any(port.type == "image" for port in visible_ports)):
        preview_width = 360
        preview_height = 360
    return (
        max(default_width, min_width, preview_width, 240.0),
        max(default_height, min_height, preview_height, float(content_height), 170.0),
    )


def node_bounds(node: GraphWorkflowNode) -> Dict[str, float]:
    width, height = node_layout_size(node.type, node.fields)
    return {
        "x": float(node.position.get("x", 0)),
        "y": float(node.position.get("y", 0)),
        "width": width,
        "height": height,
    }


def bounds_union(bounds: Iterable[Dict[str, float]]) -> Dict[str, float] | None:
    items = list(bounds)
    if not items:
        return None
    left = min(item["x"] for item in items)
    top = min(item["y"] for item in items)
    right = max(item["x"] + item["width"] for item in items)
    bottom = max(item["y"] + item["height"] for item in items)
    return {"x": left, "y": top, "width": right - left, "height": bottom - top}


def compute_group_bounds(
    nodes: Iterable[GraphWorkflowNode],
    *,
    title: str = "",
) -> Dict[str, float]:
    members = list(nodes)
    if not members:
        return {"x": 0, "y": 0, "width": 260, "height": 220}
    content = bounds_union(node_bounds(node) for node in members)
    assert content is not None
    title_width = max(0.0, len(title.strip()) * 8.5)
    width = max(
        220.0,
        content["width"] + WORKFLOW_GROUP_PADDING * 2,
        title_width + WORKFLOW_GROUP_PADDING * 2,
    )
    return {
        "x": content["x"] - WORKFLOW_GROUP_PADDING,
        "y": content["y"] - WORKFLOW_GROUP_PADDING,
        "width": width,
        "height": max(220.0, content["height"] + WORKFLOW_GROUP_PADDING * 2),
    }


def expand_bounds(bounds: Dict[str, float], padding: float) -> Dict[str, float]:
    return {
        "x": float(bounds.get("x", 0)) - padding,
        "y": float(bounds.get("y", 0)) - padding,
        "width": float(bounds.get("width", 0)) + padding * 2,
        "height": float(bounds.get("height", 0)) + padding * 2,
    }


def rects_overlap(first: Dict[str, float], second: Dict[str, float]) -> bool:
    return not (
        first["x"] + first["width"] <= second["x"]
        or second["x"] + second["width"] <= first["x"]
        or first["y"] + first["height"] <= second["y"]
        or second["y"] + second["height"] <= first["y"]
    )


def rects_have_gap(first: Dict[str, float], second: Dict[str, float], gap: float) -> bool:
    return not rects_overlap(expand_bounds(first, gap / 2), expand_bounds(second, gap / 2))
