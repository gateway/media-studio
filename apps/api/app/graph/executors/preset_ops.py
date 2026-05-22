from __future__ import annotations

import json
from typing import Any, Dict, List

from ... import service, store
from ...schemas import MediaRefInput
from ..schemas import GraphOutputRef, GraphWorkflowNode
from .base import GraphExecutionContext, GraphExecutor


def _dict_field(value: Any) -> Dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value.strip():
        parsed = json.loads(value)
        if isinstance(parsed, dict):
            return parsed
    return {}


def _graph_ref_to_media_ref(ref: GraphOutputRef) -> Dict[str, Any]:
    return MediaRefInput(asset_id=ref.asset_id, reference_id=ref.reference_id).model_dump(exclude_none=True)


class PresetRenderExecutor(GraphExecutor):
    node_type = "preset.render"

    def execute(self, node: GraphWorkflowNode, context: GraphExecutionContext) -> Dict[str, List[GraphOutputRef]]:
        preset_id = str(node.fields.get("preset_id") or "").strip()
        if not preset_id and node.type.startswith("preset.render."):
            from ..registry import registry

            preset_id = str(registry.get_definition(node.type).source.get("preset_id") or "").strip()
        if not preset_id:
            raise ValueError("Preset Render requires a preset.")
        preset = store.get_preset(preset_id)
        if not preset:
            raise ValueError("Preset Render preset does not exist.")

        text_values = _dict_field(node.fields.get("text_values") or node.fields.get("text_values_json"))
        image_slots = _dict_field(node.fields.get("image_slots") or node.fields.get("image_slots_json"))
        for field in preset.get("input_schema_json") or []:
            key = str(field.get("key") or "").strip()
            if not key:
                continue
            dynamic_value = node.fields.get(f"text__{_slug(key)}")
            if dynamic_value is not None and dynamic_value != "":
                text_values[key] = dynamic_value
        for group in preset.get("choice_groups_json") or []:
            key = str(group.get("key") or group.get("id") or "").strip()
            if not key:
                continue
            dynamic_value = node.fields.get(f"choice__{_slug(key)}")
            if dynamic_value is not None and dynamic_value != "":
                text_values[key] = dynamic_value
        connected_images = [_graph_ref_to_media_ref(ref) for ref in context.inputs_for(node, "image_refs")]

        cursor = 0
        for slot in preset.get("input_slots_json") or []:
            key = str(slot.get("key") or "").strip()
            if not key or image_slots.get(key):
                continue
            dynamic_slot_refs = [_graph_ref_to_media_ref(ref) for ref in context.inputs_for(node, f"slot__{_slug(key)}")]
            if dynamic_slot_refs:
                image_slots[key] = dynamic_slot_refs
                continue
            max_files = int(slot.get("max_files") or 1)
            selected = connected_images[cursor : cursor + max_files]
            cursor += len(selected)
            if selected:
                image_slots[key] = selected

        missing_text = []
        for field in preset.get("input_schema_json") or []:
            key = str(field.get("key") or "").strip()
            if field.get("required") and not str(text_values.get(key) or field.get("default_value") or "").strip():
                missing_text.append(key)
            if key and key not in text_values and field.get("default_value"):
                text_values[key] = str(field.get("default_value"))
        if missing_text:
            raise ValueError("Preset Render missing required text field: %s" % ", ".join(missing_text))

        missing_slots = []
        for slot in preset.get("input_slots_json") or []:
            key = str(slot.get("key") or "").strip()
            if slot.get("required") and not image_slots.get(key):
                missing_slots.append(key)
        if missing_slots:
            raise ValueError("Preset Render missing required image slot: %s" % ", ".join(missing_slots))

        rendered_prompt = service._render_preset_prompt(str(preset.get("prompt_template") or ""), text_values, image_slots)
        image_refs = []
        for refs in image_slots.values():
            if isinstance(refs, list):
                for item in refs:
                    if not isinstance(item, dict):
                        continue
                    image_refs.append(
                        GraphOutputRef(
                            kind="reference_media" if item.get("reference_id") else "asset",
                            media_type="image",
                            asset_id=item.get("asset_id"),
                            reference_id=item.get("reference_id"),
                        )
                    )
        context.record_node_metric(node, "preset_text_field_count", len(text_values))
        context.record_node_metric(node, "preset_image_ref_count", len(image_refs))
        return {
            "prompt": [GraphOutputRef(kind="value", value=rendered_prompt, metadata={"type": "text", "preset_id": preset_id})],
            "image_refs": image_refs,
            "preset": [
                GraphOutputRef(
                    kind="value",
                    value={
                        "preset_id": preset_id,
                        "key": preset.get("key"),
                        "label": preset.get("label"),
                        "recommended_models": preset.get("applies_to_models_json") or [],
                    },
                    metadata={"type": "json"},
                )
            ],
            "recommended_models": [
                GraphOutputRef(
                    kind="value",
                    value=preset.get("applies_to_models_json") or [],
                    metadata={"type": "json", "preset_id": preset_id},
                )
            ],
        }


def _slug(value: str) -> str:
    return "".join(character if character.isalnum() else "_" for character in value.lower()).strip("_")
