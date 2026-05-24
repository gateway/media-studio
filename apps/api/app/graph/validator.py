from __future__ import annotations

from collections import defaultdict, deque
import json
from typing import Any, Dict, List, Set

from .. import store
from .execution_cache import cached_artifacts_available, cached_output_for_node, cached_output_media_available
from .normalization import materialize_workflow_defaults
from .registry import registry
from .schemas import GraphError, GraphValidationResult, GraphWorkflow, GraphWorkflowEdge, GraphWorkflowNode
from .validator_prompt_recipe import (
    validate_prompt_recipe_node_setup,
    validate_prompt_recipe_runtime,
)

GLOBAL_ENHANCEMENT_CONFIG_KEY = "__studio_enhancement__"


def _port_map(definition, direction: str) -> Dict[str, object]:
    return {port.id: port for port in definition.ports.get(direction, [])}


def _port_accepts(source_type: str, target_port: object) -> bool:
    target_type = getattr(target_port, "type", "")
    if source_type == "any" or target_type == "any":
        return True
    accepted = getattr(target_port, "accepts", None) or [target_type]
    return source_type in accepted or "any" in accepted


def _empty_field(value: Any) -> bool:
    return value is None or value == "" or value == [] or value == {}


def _dict_field(value: Any) -> Dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _slug(value: str) -> str:
    return "".join(character if character.isalnum() else "_" for character in value.lower()).strip("_")


def _preset_id_for_node(node: GraphWorkflowNode, definition) -> str:
    preset_id = str(node.fields.get("preset_id") or "").strip()
    if preset_id:
        return preset_id
    return ""


def _preset_model_key_for_node(node: GraphWorkflowNode, preset: Dict[str, Any]) -> tuple[str, List[str]]:
    compatible = [str(item).strip() for item in (preset.get("applies_to_models_json") or []) if str(item).strip()]
    default_model = str(preset.get("model_key") or "").strip()
    if default_model and default_model not in compatible:
        compatible.insert(0, default_model)
    selected = str(node.fields.get("preset_model_key") or "").strip()
    return selected or (compatible[0] if compatible else default_model), compatible


def _node_execution_mode(node: GraphWorkflowNode) -> str:
    execution = node.metadata.get("execution") if isinstance(node.metadata.get("execution"), dict) else {}
    mode = str(execution.get("mode") or "enabled")
    return mode if mode in {"enabled", "frozen", "bypassed", "muted"} else "enabled"


def _prompt_node_provider_supports_images(node: GraphWorkflowNode) -> bool | None:
    requested_provider = str(node.fields.get("provider") or "studio_default").strip()
    if requested_provider == "studio_default":
        config = store.get_enhancement_config(GLOBAL_ENHANCEMENT_CONFIG_KEY) or {}
        provider_kind = str(config.get("provider_kind") or "builtin").strip()
        if provider_kind == "builtin":
            return None
        if config.get("provider_supports_images") is None:
            return None
        return bool(config.get("provider_supports_images"))
    capabilities = _dict_field(node.fields.get("provider_capabilities_json"))
    for key in ("supports_image_input", "supports_images"):
        value = capabilities.get(key)
        if isinstance(value, bool):
            return value
    explicit = node.fields.get("provider_supports_images")
    if isinstance(explicit, bool):
        return explicit
    legacy = node.fields.get("model_supports_images")
    if isinstance(legacy, bool):
        return legacy
    return None


def _validate_seedance_input_mode(
    node: GraphWorkflowNode,
    definition,
    *,
    available_incoming_by_target_port: Dict[tuple[str, str], int],
    errors: List[GraphError],
) -> None:
    source = definition.source if isinstance(definition.source, dict) else {}
    if source.get("kind") != "kie_model" or str(source.get("model_key") or "") != "seedance-2.0":
        return

    start_count = available_incoming_by_target_port[(node.id, "start_frame")]
    end_count = available_incoming_by_target_port[(node.id, "end_frame")]
    reference_counts = {
        "reference_images": available_incoming_by_target_port[(node.id, "reference_images")]
        + available_incoming_by_target_port[(node.id, "image_refs")],
        "reference_videos": available_incoming_by_target_port[(node.id, "reference_videos")]
        + available_incoming_by_target_port[(node.id, "video_refs")],
        "reference_audios": available_incoming_by_target_port[(node.id, "reference_audios")]
        + available_incoming_by_target_port[(node.id, "audio_refs")],
    }
    has_frame_mode = start_count > 0 or end_count > 0
    has_reference_mode = any(count > 0 for count in reference_counts.values())

    if end_count > 0 and start_count == 0:
        errors.append(
            GraphError(
                code="seedance_last_frame_requires_start_frame",
                message="Seedance 2.0 needs a Start Frame when an End Frame is connected.",
                node_id=node.id,
                port_id="end_frame",
            )
        )
    if has_frame_mode and has_reference_mode:
        errors.append(
            GraphError(
                code="seedance_input_modes_are_mutually_exclusive",
                message="Seedance 2.0 can use Start/End Frames or multimodal references, but not both in the same run.",
                node_id=node.id,
                port_id="start_frame" if start_count > 0 else "end_frame",
            )
        )


def validate_workflow(workflow: GraphWorkflow) -> GraphValidationResult:
    workflow = materialize_workflow_defaults(workflow)
    definitions = registry.definitions_by_type()
    errors: List[GraphError] = []
    warnings: List[GraphError] = []
    workflow_id = workflow.workflow_id or str(workflow.metadata.get("workflow_id") or "")
    frozen_cache_by_node_id: Dict[str, Dict[str, Any] | None] = {}
    prompt_recipe_context_by_node_id: Dict[str, Dict[str, Any]] = {}

    node_ids: Set[str] = set()
    nodes_by_id: Dict[str, GraphWorkflowNode] = {}
    for node in workflow.nodes:
        if node.id in node_ids:
            errors.append(GraphError(code="duplicate_node_id", message=f"Duplicate node id: {node.id}", node_id=node.id))
            continue
        node_ids.add(node.id)
        nodes_by_id[node.id] = node
        definition = definitions.get(node.type)
        if not definition:
            errors.append(GraphError(code="missing_node_type", message=f"Unknown node type: {node.type}", node_id=node.id))
            continue
        execution_mode = _node_execution_mode(node)
        if execution_mode == "frozen":
            cached = cached_output_for_node(workflow_id, node) if workflow_id else None
            frozen_cache_by_node_id[node.id] = cached
            cached_run_id = str(cached.get("run_id") or "") if cached else None
            if cached and not cached_artifacts_available(node, cached_run_id):
                errors.append(
                    GraphError(
                        code="frozen_artifact_missing",
                        message="Frozen node references cached artifacts that no longer exist.",
                        node_id=node.id,
                    )
                )
            elif cached and not cached_output_media_available(cached.get("output_snapshot_json") or {}):
                errors.append(
                    GraphError(
                        code="frozen_media_missing",
                        message="Frozen node references cached media that no longer exists.",
                        node_id=node.id,
                    )
                )
        if execution_mode == "bypassed" and not isinstance(definition.execution.get("bypass_mode"), dict):
            errors.append(
                GraphError(
                    code="unsupported_bypass",
                    message="This node type does not support bypass.",
                    node_id=node.id,
                )
            )
        if execution_mode in {"muted", "bypassed", "frozen"}:
            continue
        for field in definition.fields:
            if field.required and _empty_field(node.fields.get(field.id)):
                errors.append(
                    GraphError(code="missing_required_field", message=f"Missing required field: {field.label}", node_id=node.id, field_id=field.id)
                )
        if node.fields.get("asset_id") and not store.get_asset(str(node.fields["asset_id"])):
            errors.append(GraphError(code="missing_asset", message="Referenced asset does not exist.", node_id=node.id, field_id="asset_id"))
        if node.fields.get("reference_id") and not store.get_reference_media(str(node.fields["reference_id"])):
            errors.append(GraphError(code="missing_reference_media", message="Referenced reference media does not exist.", node_id=node.id, field_id="reference_id"))
        preset_id = _preset_id_for_node(node, definition)
        if node.type == "preset.render" and preset_id:
            preset = store.get_preset(preset_id)
            if not preset:
                errors.append(GraphError(code="missing_preset", message="Referenced preset does not exist.", node_id=node.id, field_id="preset_id"))
            else:
                text_values = _dict_field(node.fields.get("text_values") or node.fields.get("text_values_json"))
                for field in preset.get("input_schema_json") or []:
                    key = str(field.get("key") or "").strip()
                    dynamic_value = node.fields.get(f"text__{_slug(key)}")
                    if key and dynamic_value is not None and dynamic_value != "":
                        text_values[key] = dynamic_value
                for field in preset.get("input_schema_json") or []:
                    key = str(field.get("key") or "").strip()
                    if field.get("required") and not str(text_values.get(key) or field.get("default_value") or "").strip():
                        errors.append(
                            GraphError(
                                code="missing_preset_text",
                                message=f"Missing required preset text field: {key}",
                                node_id=node.id,
                                field_id=f"text__{_slug(key)}",
                            )
                        )
                for group in preset.get("choice_groups_json") or []:
                    key = str(group.get("key") or group.get("id") or "").strip()
                    if key and group.get("required") and not str(node.fields.get(f"choice__{_slug(key)}") or group.get("default") or "").strip():
                        errors.append(
                            GraphError(
                                code="missing_preset_choice",
                                message=f"Missing required preset choice: {key}",
                                node_id=node.id,
                                field_id=f"choice__{_slug(key)}",
                            )
                        )
                model_key, compatible_models = _preset_model_key_for_node(node, preset)
                if not model_key:
                    errors.append(GraphError(code="missing_preset_model", message="Media Preset has no compatible model.", node_id=node.id, field_id="preset_model_key"))
                elif compatible_models and model_key not in compatible_models:
                    errors.append(
                        GraphError(
                            code="preset_model_not_compatible",
                            message="Selected model is not compatible with this Media Preset.",
                            node_id=node.id,
                            field_id="preset_model_key",
                        )
                    )
        if node.type == "prompt.recipe" or node.type.startswith("prompt.recipe."):
            prompt_recipe_context = validate_prompt_recipe_node_setup(node, definition, errors=errors)
            if prompt_recipe_context:
                prompt_recipe_context_by_node_id[node.id] = prompt_recipe_context

    edge_ids: Set[str] = set()
    incoming_by_target_port: Dict[tuple[str, str], int] = defaultdict(int)
    available_incoming_by_target_port: Dict[tuple[str, str], int] = defaultdict(int)
    outgoing: Dict[str, List[str]] = defaultdict(list)
    outgoing_by_source_port: Dict[tuple[str, str], int] = defaultdict(int)
    indegree: Dict[str, int] = {node.id: 0 for node in workflow.nodes}
    for edge in workflow.edges:
        if edge.id in edge_ids:
            errors.append(GraphError(code="duplicate_edge_id", message=f"Duplicate edge id: {edge.id}", edge_id=edge.id))
            continue
        edge_ids.add(edge.id)
        source = nodes_by_id.get(edge.source)
        target = nodes_by_id.get(edge.target)
        if not source or not target:
            errors.append(GraphError(code="missing_edge_node", message="Edge references a missing node.", edge_id=edge.id))
            continue
        source_def = definitions.get(source.type)
        target_def = definitions.get(target.type)
        if not source_def or not target_def:
            continue
        source_port = _port_map(source_def, "outputs").get(edge.source_port)
        target_port = _port_map(target_def, "inputs").get(edge.target_port)
        if not source_port:
            errors.append(GraphError(code="missing_source_port", message=f"Unknown source port: {edge.source_port}", edge_id=edge.id, port_id=edge.source_port))
            continue
        if not target_port:
            errors.append(GraphError(code="missing_target_port", message=f"Unknown target port: {edge.target_port}", edge_id=edge.id, port_id=edge.target_port))
            continue
        source_type = getattr(source_port, "type", "")
        if not _port_accepts(source_type, target_port):
            errors.append(GraphError(code="incompatible_edge", message=f"Cannot connect {source_type} to {getattr(target_port, 'type', '')}.", edge_id=edge.id))
        if _node_execution_mode(source) == "muted":
            if getattr(target_port, "required", False):
                errors.append(
                    GraphError(
                        code="muted_required_dependency",
                        message="Required input depends on a muted node.",
                        node_id=target.id,
                        edge_id=edge.id,
                        port_id=edge.target_port,
                    )
                )
            else:
                warnings.append(
                    GraphError(
                        code="muted_optional_dependency",
                        message="Optional input depends on a muted node and will receive no data.",
                        node_id=target.id,
                        edge_id=edge.id,
                        port_id=edge.target_port,
                    )
                )
        source_mode = _node_execution_mode(source)
        target_mode = _node_execution_mode(target)
        source_has_available_output = source_mode != "muted" and not (source_mode == "frozen" and not frozen_cache_by_node_id.get(source.id))
        if source_mode == "frozen" and not frozen_cache_by_node_id.get(source.id) and target_mode in {"enabled", "bypassed"}:
            if getattr(target_port, "required", False):
                errors.append(
                    GraphError(
                        code="frozen_dependency_missing",
                        message="Required input depends on a muted node with no cached output.",
                        node_id=target.id,
                        edge_id=edge.id,
                        port_id=edge.target_port,
                    )
                )
            else:
                warnings.append(
                    GraphError(
                        code="frozen_optional_dependency_missing",
                        message="Optional input depends on a muted node with no cached output and will receive no data.",
                        node_id=target.id,
                        edge_id=edge.id,
                        port_id=edge.target_port,
                    )
                )
        if source.type in {"media.load_image", "media.load_video", "media.load_audio"} and not source.fields.get("asset_id") and not source.fields.get("reference_id"):
            if getattr(target_port, "required", False):
                errors.append(
                    GraphError(
                        code="missing_media_reference",
                        message="Load media needs an asset or reference media for this required input.",
                        node_id=source.id,
                        edge_id=edge.id,
                    )
                )
            else:
                warnings.append(
                    GraphError(
                        code="empty_optional_media_input",
                        message="Empty Load Image is connected to an optional input and will be skipped.",
                        node_id=source.id,
                        edge_id=edge.id,
                    )
                )
        key = (edge.target, edge.target_port)
        incoming_by_target_port[key] += 1
        if source_has_available_output:
            available_incoming_by_target_port[key] += 1
        max_count = getattr(target_port, "max", None)
        if not getattr(target_port, "array", False) and incoming_by_target_port[key] > 1:
            errors.append(GraphError(code="input_cardinality_exceeded", message="Only one edge can connect to this input.", edge_id=edge.id, port_id=edge.target_port))
        elif max_count is not None and incoming_by_target_port[key] > max_count:
            errors.append(GraphError(code="input_cardinality_exceeded", message="Too many edges connected to input.", edge_id=edge.id, port_id=edge.target_port))
        outgoing[edge.source].append(edge.target)
        outgoing_by_source_port[(edge.source, edge.source_port)] += 1
        indegree[edge.target] = indegree.get(edge.target, 0) + 1

    for node in workflow.nodes:
        definition = definitions.get(node.type)
        if not definition:
            continue
        execution_mode = _node_execution_mode(node)
        if execution_mode == "muted":
            continue
        if execution_mode == "bypassed":
            bypass_mode = definition.execution.get("bypass_mode") if isinstance(definition.execution.get("bypass_mode"), dict) else {}
            input_port = str(bypass_mode.get("input") or "")
            if not input_port or available_incoming_by_target_port[(node.id, input_port)] < 1:
                errors.append(
                    GraphError(
                        code="missing_bypass_input",
                        message="Bypassed node needs a compatible input to pass through.",
                        node_id=node.id,
                        port_id=input_port or None,
                    )
                )
            continue
        if execution_mode == "frozen":
            continue
        for port in definition.ports.get("inputs", []):
            if port.required and available_incoming_by_target_port[(node.id, port.id)] < max(1, port.min):
                errors.append(GraphError(code="missing_required_input", message=f"Missing required input: {port.label}", node_id=node.id, port_id=port.id))
        if node.type == "prompt.llm" and available_incoming_by_target_port[(node.id, "image")] > 0:
            supports_images = _prompt_node_provider_supports_images(node)
            image_field_id = "model_id" if str(node.fields.get("provider") or "studio_default").strip() != "studio_default" else "provider"
            if supports_images is None:
                errors.append(
                    GraphError(
                        code="prompt_llm_image_capability_unknown",
                        message="Refresh and reselect the LLM model before using image input.",
                        node_id=node.id,
                        field_id=image_field_id,
                    )
                )
            elif not supports_images:
                errors.append(
                    GraphError(
                        code="prompt_llm_model_not_image_capable",
                        message="The selected LLM Prompt model is not marked as image-capable.",
                        node_id=node.id,
                        field_id=image_field_id,
                    )
                )
        if definition.source.get("kind") == "kie_model":
            _validate_seedance_input_mode(
                node,
                definition,
                available_incoming_by_target_port=available_incoming_by_target_port,
                errors=errors,
            )
            media_output_ports = [port for port in definition.ports.get("outputs", []) if getattr(port, "type", "") in {"image", "video", "audio"}]
            if media_output_ports and not any(outgoing_by_source_port[(node.id, port.id)] > 0 for port in media_output_ports):
                labels = ", ".join(getattr(port, "label", port.id) for port in media_output_ports)
                errors.append(
                    GraphError(
                        code="model_output_unconnected",
                        message=f"Connect the model output before running. Unused output: {labels}.",
                        node_id=node.id,
                        port_id=media_output_ports[0].id,
                    )
                )
        preset_id = _preset_id_for_node(node, definition)
        if node.type == "preset.render" and preset_id:
            preset = store.get_preset(preset_id)
            if preset:
                for slot in preset.get("input_slots_json") or []:
                    key = str(slot.get("key") or "").strip()
                    port_id = f"slot__{_slug(key)}"
                    connected_count = incoming_by_target_port[(node.id, port_id)]
                    available_count = available_incoming_by_target_port[(node.id, port_id)]
                    if slot.get("required") and available_count <= 0:
                        errors.append(
                            GraphError(
                                code="missing_preset_image_slot",
                                message=f"Missing required preset image slot: {key}",
                                node_id=node.id,
                                port_id=port_id,
                            )
                        )
                    max_files = int(slot.get("max_files") or 1)
                    if max_files > 0 and connected_count > max_files:
                        errors.append(
                            GraphError(
                                code="preset_image_slot_max_exceeded",
                                message=f"Too many images connected to preset image slot: {key}",
                                node_id=node.id,
                                port_id=port_id,
                            )
                        )
        if node.type == "prompt.recipe" or node.type.startswith("prompt.recipe."):
            prompt_recipe_context = prompt_recipe_context_by_node_id.get(node.id)
            if prompt_recipe_context:
                validate_prompt_recipe_runtime(
                    node,
                    prompt_recipe_context=prompt_recipe_context,
                    incoming_by_target_port=incoming_by_target_port,
                    available_incoming_by_target_port=available_incoming_by_target_port,
                    empty_field=_empty_field,
                    errors=errors,
                    warnings=warnings,
                )

    visited_count = 0
    queue = deque([node_id for node_id, count in indegree.items() if count == 0])
    while queue:
        node_id = queue.popleft()
        visited_count += 1
        for target_id in outgoing[node_id]:
            indegree[target_id] -= 1
            if indegree[target_id] == 0:
                queue.append(target_id)
    if workflow.nodes and visited_count != len(workflow.nodes):
        errors.append(GraphError(code="cycle_detected", message="Workflow contains a cycle."))

    connected_node_ids = {edge.source for edge in workflow.edges} | {edge.target for edge in workflow.edges}
    for node in workflow.nodes:
        if len(workflow.nodes) > 1 and node.id not in connected_node_ids:
            warnings.append(GraphError(code="disconnected_node", message="Node is disconnected.", node_id=node.id))

    return GraphValidationResult(valid=not errors, errors=errors, warnings=warnings)
