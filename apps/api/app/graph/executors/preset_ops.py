from __future__ import annotations

import json
from typing import Any, Dict, List

from ... import kie_adapter, store
from ...schemas import MediaRefInput, ValidateRequest
from ..preset_catalog import MODEL_OPTION_FIELD_PREFIX
from ..schemas import GraphOutputRef, GraphWorkflowNode
from .base import GraphExecutionContext, GraphExecutor
from .kie_model import _select_task_mode, submit_and_wait_for_kie_request


def _dict_field(value: Any) -> Dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value.strip():
        parsed = json.loads(value)
        if isinstance(parsed, dict):
            return parsed
    return {}


def _graph_ref_to_media_input(ref: GraphOutputRef) -> MediaRefInput:
    return MediaRefInput(asset_id=ref.asset_id, reference_id=ref.reference_id)


def _graph_ref_to_media_ref(ref: GraphOutputRef) -> Dict[str, Any]:
    return _graph_ref_to_media_input(ref).model_dump(exclude_none=True)


def _model_option_keys(model_key: str) -> set[str]:
    model = next((item for item in kie_adapter.list_models() if str(item.get("key") or "") == model_key), {})
    raw = model.get("raw") if isinstance(model, dict) else {}
    options = raw.get("options") if isinstance(raw, dict) else {}
    return {str(key) for key in options.keys()} if isinstance(options, dict) else set()


def _preset_model_options(node: GraphWorkflowNode, preset: Dict[str, Any], model_key: str) -> Dict[str, Any]:
    options = dict(preset.get("default_options_json") if isinstance(preset.get("default_options_json"), dict) else {})
    supported_options = _model_option_keys(model_key)
    for field_id, value in node.fields.items():
        if not str(field_id).startswith(MODEL_OPTION_FIELD_PREFIX):
            continue
        if value is None or value == "":
            continue
        option_key = str(field_id)[len(MODEL_OPTION_FIELD_PREFIX):]
        if supported_options and option_key not in supported_options:
            continue
        if option_key:
            options[option_key] = value
    return options


class PresetRenderExecutor(GraphExecutor):
    node_type = "preset.render"

    def execute(self, node: GraphWorkflowNode, context: GraphExecutionContext) -> Dict[str, List[GraphOutputRef]]:
        preset_id = str(node.fields.get("preset_id") or "").strip()
        if not preset_id:
            raise ValueError("Media Preset requires a preset.")
        preset = store.get_preset(preset_id)
        if not preset:
            raise ValueError("Media Preset does not exist.")

        text_values: Dict[str, str] = {
            key: str(value)
            for key, value in _dict_field(node.fields.get("text_values") or node.fields.get("text_values_json")).items()
            if value is not None and value != ""
        }
        image_slots: Dict[str, List[MediaRefInput]] = {}
        for field in preset.get("input_schema_json") or []:
            key = str(field.get("key") or "").strip()
            if not key:
                continue
            dynamic_value = node.fields.get(f"text__{_slug(key)}")
            if dynamic_value is not None and dynamic_value != "":
                text_values[key] = str(dynamic_value)
        for slot in preset.get("input_slots_json") or []:
            key = str(slot.get("key") or "").strip()
            if not key:
                continue
            selected = [_graph_ref_to_media_input(ref) for ref in context.inputs_for(node, f"slot__{_slug(key)}")]
            if selected:
                image_slots[key] = selected
        image_inputs = [item for refs in image_slots.values() for item in refs]
        model_key = self._selected_model_key(node, preset)
        if not model_key:
            raise ValueError("Media Preset does not define a compatible model.")
        model = next((item for item in kie_adapter.list_models() if str(item.get("key") or "") == model_key), {})
        task_modes = [str(item) for item in ((model or {}).get("task_modes") or ((model or {}).get("raw") or {}).get("task_modes") or [])]
        task_mode = _select_task_mode(
            task_modes,
            output_media_type="image",
            has_images=bool(image_inputs),
            has_videos=False,
            has_audios=False,
            model_key=model_key,
        )
        options = _preset_model_options(node, preset, model_key)
        context.record_node_metric(node, "preset_text_field_count", len(text_values))
        context.record_node_metric(node, "preset_image_ref_count", len(image_inputs))
        request = ValidateRequest(
            model_key=model_key,
            task_mode=task_mode,
            prompt="",
            images=image_inputs,
            options=options,
            preset_id=preset_id,
            preset_text_values=text_values,
            preset_image_slots=image_slots,
            output_count=1,
        )
        return submit_and_wait_for_kie_request(node=node, context=context, request=request, model_key=model_key)

    def _selected_model_key(self, node: GraphWorkflowNode, preset: Dict[str, Any]) -> str:
        compatible = [str(item).strip() for item in (preset.get("applies_to_models_json") or []) if str(item).strip()]
        default_model = str(preset.get("model_key") or "").strip()
        if default_model and default_model not in compatible:
            compatible.insert(0, default_model)
        selected = str(node.fields.get("preset_model_key") or "").strip()
        if selected and (not compatible or selected in compatible):
            return selected
        return compatible[0] if compatible else default_model


def _slug(value: str) -> str:
    return "".join(character if character.isalnum() else "_" for character in value.lower()).strip("_")
