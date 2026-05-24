from __future__ import annotations

import math
from typing import Any, Dict, List, Optional

from .. import enhancement_provider, kie_adapter, store
from ..pricing import summarize_estimated_cost
from .executors.kie_model import _select_task_mode
from .normalization import materialize_workflow_defaults
from .registry import registry
from .schemas import GraphError, GraphEstimateNode, GraphEstimateResponse, GraphNodeDefinition, GraphWorkflow, GraphWorkflowNode
from .validator import validate_workflow


ZERO_PRICING_SUMMARY = {
    "currency": "USD",
    "is_known": True,
    "has_numeric_estimate": True,
    "is_authoritative": True,
    "per_output": {"estimated_credits": 0.0, "estimated_cost_usd": 0.0},
    "total": {"estimated_credits": 0.0, "estimated_cost_usd": 0.0},
}

UNKNOWN_EXTERNAL_LLM_PRICING_SUMMARY = {
    "currency": "USD",
    "is_known": False,
    "has_numeric_estimate": False,
    "has_unknown_pricing": True,
    "is_authoritative": False,
    "pricing_status": "unknown_external",
    "per_output": {"estimated_credits": None, "estimated_cost_usd": None},
    "total": {"estimated_credits": None, "estimated_cost_usd": None},
}

SUBSCRIPTION_EXTERNAL_LLM_PRICING_SUMMARY = {
    "currency": "USD",
    "is_known": True,
    "has_numeric_estimate": False,
    "has_unknown_pricing": False,
    "is_authoritative": False,
    "pricing_status": "subscription_included",
    "billing_kind": "subscription",
    "per_output": {"estimated_credits": None, "estimated_cost_usd": None},
    "total": {"estimated_credits": None, "estimated_cost_usd": None},
}

STUDIO_ENHANCEMENT_CONFIG_KEY = "__studio_enhancement__"
DEFAULT_EXTERNAL_PROMPT_TOKEN_CHARS = 4.0
DEFAULT_EXTERNAL_MESSAGE_OVERHEAD_TOKENS = 80
DEFAULT_EXTERNAL_IMAGE_TOKEN_ESTIMATE = 1024
DEFAULT_PROMPT_LLM_COMPLETION_RATIO = 0.55
DEFAULT_PROMPT_RECIPE_FINAL_COMPLETION_RATIO = 0.6
DEFAULT_PROMPT_RECIPE_ANALYSIS_COMPLETION_TOKENS = 400


def estimate_graph_workflow(workflow: GraphWorkflow) -> GraphEstimateResponse:
    workflow = materialize_workflow_defaults(workflow)
    definitions = registry.definitions_by_type()
    warnings: List[GraphError] = []
    validation = validate_workflow(workflow)
    warnings.extend(validation.warnings)
    warnings.extend(validation.errors)

    has_kie_nodes = any(str(definitions[node.type].source.get("kind") or "") == "kie_model" for node in workflow.nodes if node.type in definitions)
    snapshot = (
        kie_adapter.pricing_snapshot(force_refresh=False)
        if has_kie_nodes
        else {
            "currency": "USD",
            "is_authoritative": True,
            "is_stale": False,
            "priced_model_keys": [],
            "missing_model_keys": [],
            "source_kind": "external_llm_catalog",
            "pricing_status": "estimated",
            "version": None,
        }
    )
    if has_kie_nodes and snapshot.get("is_stale"):
        warnings.append(GraphError(code="stale_pricing", message="Pricing snapshot is stale; graph estimate may be out of date."))
    if has_kie_nodes and snapshot.get("refresh_error"):
        warnings.append(GraphError(code="pricing_refresh_failed", message=str(snapshot.get("refresh_error"))))

    nodes: Dict[str, GraphEstimateNode] = {}
    total_credits = 0.0
    total_usd = 0.0
    has_credits = False
    has_usd = False
    has_unknown = False
    has_stale = bool(snapshot.get("is_stale"))
    all_authoritative = bool(snapshot.get("is_authoritative", False))
    has_external_estimate = False
    has_subscription_included = False

    for node in workflow.nodes:
        definition = definitions.get(node.type)
        if not definition:
            continue
        source_kind = str(definition.source.get("kind") or "")
        if source_kind == "kie_model":
            estimate = _estimate_model_node(workflow, node, definition, definitions, snapshot)
        elif source_kind == "external_llm":
            estimate = _estimate_external_llm_node(workflow, node, definition, definitions)
        else:
            continue
        nodes[node.id] = estimate
        warnings.extend(estimate.warnings)
        summary = estimate.pricing_summary
        if str(summary.get("pricing_status") or "").strip() == "estimated_external_llm":
            has_external_estimate = True
        if str(summary.get("pricing_status") or "").strip() == "subscription_included":
            has_subscription_included = True
        if summary.get("has_numeric_estimate"):
            credits = _number(summary.get("total", {}).get("estimated_credits"))
            usd = _number(summary.get("total", {}).get("estimated_cost_usd"))
            if credits is not None:
                total_credits += credits
                has_credits = True
            if usd is not None:
                total_usd += usd
                has_usd = True
        elif summary.get("has_unknown_pricing"):
            has_unknown = True
        all_authoritative = all_authoritative and bool(summary.get("is_authoritative"))

    currency = str(snapshot.get("currency") or "USD")
    pricing_source_kind = snapshot.get("source_kind") or snapshot.get("source")
    pricing_status = snapshot.get("pricing_status")
    if has_unknown:
        pricing_status = "unknown"
    elif has_external_estimate and has_kie_nodes:
        pricing_source_kind = "mixed_provider_catalog"
        pricing_status = "mixed_estimated"
    elif has_external_estimate:
        pricing_source_kind = "external_llm_catalog"
        pricing_status = "estimated_external_llm"
    elif has_subscription_included:
        pricing_source_kind = "subscription_local_provider"
        pricing_status = "subscription_included"
    pricing_summary = {
        "currency": currency,
        "total": {
            "estimated_credits": round(total_credits, 4) if has_credits else None,
            "estimated_cost_usd": round(total_usd, 4) if has_usd else None,
        },
        "has_numeric_estimate": has_credits or has_usd,
        "has_unknown_pricing": has_unknown,
        "is_authoritative": all_authoritative and not has_unknown,
        "is_stale": has_stale,
        "pricing_version": snapshot.get("version"),
        "pricing_source_kind": pricing_source_kind,
        "pricing_status": pricing_status,
        "priced_model_count": len(snapshot.get("priced_model_keys") or []),
        "missing_model_count": len(snapshot.get("missing_model_keys") or []),
    }
    return GraphEstimateResponse(pricing_summary=pricing_summary, nodes=nodes, warnings=warnings)


def _estimate_external_llm_node(
    workflow: GraphWorkflow,
    node: GraphWorkflowNode,
    definition: GraphNodeDefinition,
    definitions: Dict[str, GraphNodeDefinition],
) -> GraphEstimateNode:
    mode = _node_execution_mode(node)
    provider_details = _external_llm_provider_details(node)
    provider = provider_details["provider"]
    provider_kind = provider_details["provider_kind"]
    model_id = provider_details["model_id"] or provider
    if mode != "enabled":
        return GraphEstimateNode(
            node_id=node.id,
            node_type=node.type,
            model_key=model_id,
            pricing_summary={**ZERO_PRICING_SUMMARY, "model_key": model_id, "output_count": 1},
            assumptions=[f"Execution mode {mode} reuses or skips outputs and does not add new external LLM spend."],
        )
    if provider_kind != "openrouter":
        if provider_kind == "codex_local":
            return GraphEstimateNode(
                node_id=node.id,
                node_type=node.type,
                model_key=model_id,
                output_count=1,
                pricing_summary={**SUBSCRIPTION_EXTERNAL_LLM_PRICING_SUMMARY, "model_key": model_id, "provider": provider, "output_count": 1},
                assumptions=["Codex Local uses the operator's existing Codex or ChatGPT plan and is not dollar-metered by Media Studio."],
                warnings=[],
            )
        return _unknown_external_llm_node(
            node=node,
            provider=provider,
            model_id=model_id,
            message="Only OpenRouter-backed LLM nodes have pre-run cost estimates right now.",
        )
    if not model_id:
        return _unknown_external_llm_node(
            node=node,
            provider=provider,
            model_id=model_id,
            message="OpenRouter model pricing requires a selected model id.",
        )
    model_pricing = _openrouter_model_pricing(model_id)
    if not model_pricing:
        return _unknown_external_llm_node(
            node=node,
            provider=provider,
            model_id=model_id,
            message=f"OpenRouter pricing metadata for {model_id} is unavailable.",
        )
    call_estimates = _external_llm_call_estimates(workflow, node, definition, definitions)
    if not call_estimates:
        return _unknown_external_llm_node(
            node=node,
            provider=provider,
            model_id=model_id,
            message="External LLM estimate could not derive a request shape for this node.",
        )

    total_prompt_tokens = 0
    total_completion_tokens = 0
    total_cost_usd = 0.0
    call_count = 0
    image_count = 0
    assumptions: List[str] = []
    for call in call_estimates:
        prompt_tokens = int(call.get("prompt_tokens") or 0)
        completion_tokens = int(call.get("completion_tokens") or 0)
        prompt_rate = _number(model_pricing.get("prompt")) or 0.0
        completion_rate = _number(model_pricing.get("completion")) or 0.0
        flat_image_rate = _number(model_pricing.get("image"))
        current_image_count = int(call.get("image_count") or 0)
        if flat_image_rate is None and current_image_count > 0:
            prompt_tokens += current_image_count * DEFAULT_EXTERNAL_IMAGE_TOKEN_ESTIMATE
        prompt_cost = prompt_tokens * prompt_rate
        completion_cost = completion_tokens * completion_rate
        image_cost = (flat_image_rate or 0.0) * current_image_count if flat_image_rate is not None else 0.0
        total_prompt_tokens += prompt_tokens
        total_completion_tokens += completion_tokens
        total_cost_usd += prompt_cost + completion_cost + image_cost
        call_count += 1
        image_count += current_image_count
        note = str(call.get("assumption") or "").strip()
        if note:
            assumptions.append(note)

    assumptions.append("OpenRouter token pricing uses the provider model catalog and a pre-run token heuristic.")
    if image_count and _number(model_pricing.get("image")) is None:
        assumptions.append(
            f"Image input cost assumes roughly {DEFAULT_EXTERNAL_IMAGE_TOKEN_ESTIMATE} prompt tokens per connected image because this model does not publish a flat image price."
        )
    pricing_summary = {
        "currency": "USD",
        "is_known": True,
        "has_numeric_estimate": True,
        "has_unknown_pricing": False,
        "is_authoritative": False,
        "pricing_status": "estimated_external_llm",
        "pricing_source_kind": "openrouter_model_catalog",
        "model_key": model_id,
        "provider": provider,
        "output_count": 1,
        "estimated_prompt_tokens": total_prompt_tokens,
        "estimated_completion_tokens": total_completion_tokens,
        "estimated_request_count": call_count,
        "estimated_image_count": image_count,
        "per_output": {"estimated_credits": None, "estimated_cost_usd": round(total_cost_usd, 6)},
        "total": {"estimated_credits": None, "estimated_cost_usd": round(total_cost_usd, 6)},
    }
    return GraphEstimateNode(
        node_id=node.id,
        node_type=node.type,
        model_key=model_id,
        output_count=1,
        pricing_summary=pricing_summary,
        assumptions=assumptions,
        warnings=[],
    )


def _unknown_external_llm_node(*, node: GraphWorkflowNode, provider: str, model_id: str, message: str) -> GraphEstimateNode:
    warning = GraphError(code="unknown_external_llm_pricing", message=message, node_id=node.id)
    return GraphEstimateNode(
        node_id=node.id,
        node_type=node.type,
        model_key=model_id,
        output_count=1,
        pricing_summary={**UNKNOWN_EXTERNAL_LLM_PRICING_SUMMARY, "model_key": model_id, "provider": provider, "output_count": 1},
        assumptions=["External LLM token pricing is provider/model dependent and currently requires spend confirmation."],
        warnings=[warning],
    )


def _external_llm_provider_details(node: GraphWorkflowNode) -> Dict[str, str]:
    provider = str(node.fields.get("provider") or "studio_default").strip() or "studio_default"
    if provider != "studio_default":
        return {"provider": provider, "provider_kind": provider, "model_id": str(node.fields.get("model_id") or "").strip()}
    config = store.get_enhancement_config(STUDIO_ENHANCEMENT_CONFIG_KEY) or {}
    provider_kind = str(config.get("provider_kind") or "builtin").strip() or "builtin"
    return {
        "provider": provider,
        "provider_kind": provider_kind,
        "model_id": str(config.get("provider_model_id") or "").strip(),
    }


def _openrouter_model_pricing(model_id: str) -> Optional[Dict[str, Any]]:
    try:
        models = enhancement_provider.list_openrouter_models()
    except Exception:
        return None
    selected = next((item for item in models if str(item.get("id") or "").strip() == model_id), None)
    if not selected:
        return None
    raw = selected.get("raw") if isinstance(selected.get("raw"), dict) else {}
    pricing = raw.get("pricing") if isinstance(raw.get("pricing"), dict) else selected.get("pricing")
    return pricing if isinstance(pricing, dict) and pricing else None


def _external_llm_call_estimates(
    workflow: GraphWorkflow,
    node: GraphWorkflowNode,
    definition: GraphNodeDefinition,
    definitions: Dict[str, GraphNodeDefinition],
) -> List[Dict[str, Any]]:
    if node.type == "prompt.llm":
        return [_estimate_prompt_llm_call(workflow, node, definition, definitions)]
    if node.type == "prompt.recipe":
        return _estimate_prompt_recipe_calls(workflow, node, definitions)
    return [_estimate_generic_external_llm_call(node, definition)]


def _estimate_prompt_llm_call(
    workflow: GraphWorkflow,
    node: GraphWorkflowNode,
    definition: GraphNodeDefinition,
    definitions: Dict[str, GraphNodeDefinition],
) -> Dict[str, Any]:
    prompt_tokens = _estimate_prompt_tokens(
        [
            str(node.fields.get("system_prompt") or ""),
            str(node.fields.get("user_prompt") or ""),
            str(node.fields.get("image_instruction") or ""),
            str(node.fields.get("mode") or ""),
        ]
    )
    max_tokens = _bounded_int(
        node.fields.get("max_tokens"),
        fallback=int(((definition.limits or {}).get("max_tokens") or {}).get("default") or 1200),
        minimum=64,
        maximum=4000,
    )
    completion_tokens = max(64, min(max_tokens, int(math.ceil(max_tokens * DEFAULT_PROMPT_LLM_COMPLETION_RATIO))))
    image_count = _incoming_edge_count(workflow, node.id, "image", definitions=definitions, expected_type="image")
    return {
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "image_count": image_count,
        "assumption": f"LLM Prompt estimates about {prompt_tokens} input tokens and up to {completion_tokens} completion tokens before execution.",
    }


def _estimate_prompt_recipe_calls(
    workflow: GraphWorkflow,
    node: GraphWorkflowNode,
    definitions: Dict[str, GraphNodeDefinition],
) -> List[Dict[str, Any]]:
    recipe_id = str(node.fields.get("recipe_id") or "").strip()
    recipe = store.get_prompt_recipe(recipe_id) if recipe_id else None
    image_input = recipe.get("image_input_json") if isinstance(recipe, dict) and isinstance(recipe.get("image_input_json"), dict) else {}
    image_enabled = bool(image_input.get("enabled"))
    image_mode = str(image_input.get("mode") or "none").strip() or "none"
    image_count = _incoming_edge_count(workflow, node.id, "image_refs", definitions=definitions, expected_type="image")
    output_format = str(recipe.get("output_format") or "single_prompt") if isinstance(recipe, dict) else "single_prompt"
    final_max_tokens = _bounded_int(
        node.fields.get("max_tokens"),
        fallback=int((((recipe or {}).get("default_options_json") or {}).get("max_output_tokens") or 1600)),
        minimum=64,
        maximum=4000,
    )
    base_text_parts = [
        str((recipe or {}).get("system_prompt_template") or ""),
        str((recipe or {}).get("image_analysis_prompt") or ""),
        str(node.fields.get("user_prompt") or ""),
        str(node.fields.get("source_prompt") or ""),
        str(node.fields.get("source_image_prompt") or ""),
        str(node.fields.get("previous_output") or ""),
        str(node.fields.get("style_direction") or ""),
        str(node.fields.get("aspect_ratio") or ""),
        str(node.fields.get("shot_count") or ""),
        str(node.fields.get("duration_seconds") or ""),
        str(node.fields.get("external_variables_json") or ""),
    ]
    calls: List[Dict[str, Any]] = []
    if image_enabled and image_count > 0 and image_mode in {"analyze_then_inject", "both"} and str((recipe or {}).get("image_analysis_prompt") or "").strip():
        calls.append(
            {
                "prompt_tokens": _estimate_prompt_tokens(base_text_parts[:4]),
                "completion_tokens": DEFAULT_PROMPT_RECIPE_ANALYSIS_COMPLETION_TOKENS,
                "image_count": image_count,
                "assumption": f"Prompt Recipe includes one image-analysis pass for {image_count} connected image reference(s).",
            }
        )
    final_completion_tokens = max(64, min(final_max_tokens, int(math.ceil(final_max_tokens * DEFAULT_PROMPT_RECIPE_FINAL_COMPLETION_RATIO))))
    final_image_count = image_count if image_enabled and image_mode in {"direct_reference", "both"} else 0
    calls.append(
        {
            "prompt_tokens": _estimate_prompt_tokens(base_text_parts + [output_format]),
            "completion_tokens": final_completion_tokens,
            "image_count": final_image_count,
            "assumption": f"Prompt Recipe final pass estimates about {final_completion_tokens} completion tokens for {output_format.replace('_', ' ')} output.",
        }
    )
    return calls


def _estimate_generic_external_llm_call(node: GraphWorkflowNode, definition: GraphNodeDefinition) -> Dict[str, Any]:
    max_tokens = _bounded_int(
        node.fields.get("max_tokens"),
        fallback=int(((definition.limits or {}).get("max_tokens") or {}).get("default") or 1200),
        minimum=64,
        maximum=4000,
    )
    return {
        "prompt_tokens": _estimate_prompt_tokens([str(value) for value in node.fields.values() if value not in {None, ""}]),
        "completion_tokens": max(64, min(max_tokens, int(math.ceil(max_tokens * DEFAULT_PROMPT_LLM_COMPLETION_RATIO)))),
        "image_count": 0,
        "assumption": "External LLM estimate uses visible node field text and max token settings before execution.",
    }


def _estimate_prompt_tokens(text_parts: List[str]) -> int:
    text = "\n".join(part.strip() for part in text_parts if str(part or "").strip())
    text_tokens = int(math.ceil(len(text) / DEFAULT_EXTERNAL_PROMPT_TOKEN_CHARS)) if text else 0
    return max(1, text_tokens + DEFAULT_EXTERNAL_MESSAGE_OVERHEAD_TOKENS)


def _incoming_edge_count(
    workflow: GraphWorkflow,
    node_id: str,
    target_port: str,
    *,
    definitions: Dict[str, GraphNodeDefinition],
    expected_type: str,
) -> int:
    source_by_id = {node.id: node for node in workflow.nodes}
    count = 0
    for edge in workflow.edges:
        if edge.target != node_id or edge.target_port != target_port:
            continue
        source = source_by_id.get(edge.source)
        definition = definitions.get(source.type) if source else None
        port = _output_port(definition, edge.source_port)
        if port and port.type == expected_type:
            count += 1
    return count


def _estimate_model_node(
    workflow: GraphWorkflow,
    node: GraphWorkflowNode,
    definition: GraphNodeDefinition,
    definitions: Dict[str, GraphNodeDefinition],
    snapshot: Dict[str, Any],
) -> GraphEstimateNode:
    mode = _node_execution_mode(node)
    model_key = str(definition.source.get("model_key") or node.type.replace("model.kie.", "").replace("_", "-"))
    output_count = _node_output_count(node, definition)
    node_warnings: List[GraphError] = []
    if mode != "enabled":
        return GraphEstimateNode(
            node_id=node.id,
            node_type=node.type,
            model_key=model_key,
            output_count=output_count,
            pricing_summary={**ZERO_PRICING_SUMMARY, "model_key": model_key, "output_count": output_count},
            assumptions=[f"Execution mode {mode} reuses or skips outputs and does not add new KIE spend."],
        )

    output_media_type = str(definition.source.get("output_media_type") or "image")
    request_media = _pricing_request_media(workflow, node, definition, definitions)
    task_mode = _select_task_mode(
        [str(item) for item in (definition.source.get("task_modes") or [])],
        output_media_type=output_media_type,
        has_images=bool(request_media["images"]),
        has_videos=bool(request_media["videos"]),
        has_audios=bool(request_media["audios"]),
        model_key=model_key,
    )
    raw_request = {
        "model_key": model_key,
        "task_mode": task_mode,
        "prompt": str(node.fields.get("prompt") or "Graph pricing estimate"),
        "images": request_media["images"],
        "videos": request_media["videos"],
        "audios": request_media["audios"],
        "options": _model_options(node, definition),
        "metadata": {"output_count": output_count},
    }
    try:
        summary = summarize_estimated_cost(kie_adapter.estimate_request_cost(raw_request), output_count=output_count)
    except Exception as exc:
        summary = summarize_estimated_cost(None, output_count=output_count)
        node_warnings.append(GraphError(code="graph_pricing_estimate_failed", message=str(exc), node_id=node.id))

    missing_keys = set(str(item) for item in (snapshot.get("missing_model_keys") or []))
    if model_key in missing_keys or not summary.get("has_numeric_estimate"):
        node_warnings.append(GraphError(code="missing_model_pricing", message=f"Missing pricing for {model_key}.", node_id=node.id))
    if snapshot.get("is_stale"):
        node_warnings.append(GraphError(code="stale_pricing", message="Pricing snapshot is stale for this estimate.", node_id=node.id))
    return GraphEstimateNode(
        node_id=node.id,
        node_type=node.type,
        model_key=model_key,
        task_mode=task_mode,
        output_count=output_count,
        pricing_summary=summary,
        assumptions=list(summary.get("assumptions") or []),
        warnings=node_warnings,
    )


def _incoming_media_types(workflow: GraphWorkflow, node_id: str, definitions: Dict[str, GraphNodeDefinition]) -> set[str]:
    source_by_id = {node.id: node for node in workflow.nodes}
    media_types: set[str] = set()
    for edge in workflow.edges:
        if edge.target != node_id:
            continue
        source = source_by_id.get(edge.source)
        definition = definitions.get(source.type) if source else None
        port = _output_port(definition, edge.source_port)
        if port and port.type in {"image", "video", "audio"}:
            media_types.add(port.type)
    return media_types


def _pricing_request_media(
    workflow: GraphWorkflow,
    node: GraphWorkflowNode,
    definition: GraphNodeDefinition,
    definitions: Dict[str, GraphNodeDefinition],
) -> Dict[str, List[Dict[str, str]]]:
    model_key = str(definition.source.get("model_key") or node.type.replace("model.kie.", "").replace("_", "-"))
    if model_key != "seedance-2.0":
        input_types = _incoming_media_types(workflow, node.id, definitions)
        return {
            "images": [_pricing_media_placeholder("image")] if "image" in input_types else [],
            "videos": [_pricing_media_placeholder("video")] if "video" in input_types else [],
            "audios": [_pricing_media_placeholder("audio")] if "audio" in input_types else [],
        }

    return {
        "images": [
            *[
                _pricing_media_placeholder("image", role="first_frame")
                for _ in range(_incoming_edge_count(workflow, node.id, "start_frame", definitions=definitions, expected_type="image"))
            ],
            *[
                _pricing_media_placeholder("image", role="last_frame")
                for _ in range(_incoming_edge_count(workflow, node.id, "end_frame", definitions=definitions, expected_type="image"))
            ],
            *[
                _pricing_media_placeholder("image", role="reference")
                for _ in range(
                    _incoming_edge_count(workflow, node.id, "reference_images", definitions=definitions, expected_type="image")
                    + _incoming_edge_count(workflow, node.id, "image_refs", definitions=definitions, expected_type="image")
                )
            ],
        ],
        "videos": [
            _pricing_media_placeholder("video", role="reference")
            for _ in range(
                _incoming_edge_count(workflow, node.id, "reference_videos", definitions=definitions, expected_type="video")
                + _incoming_edge_count(workflow, node.id, "video_refs", definitions=definitions, expected_type="video")
            )
        ],
        "audios": [
            _pricing_media_placeholder("audio", role="reference")
            for _ in range(
                _incoming_edge_count(workflow, node.id, "reference_audios", definitions=definitions, expected_type="audio")
                + _incoming_edge_count(workflow, node.id, "audio_refs", definitions=definitions, expected_type="audio")
            )
        ],
    }


def _pricing_media_placeholder(media_type: str, *, role: str | None = None) -> Dict[str, str]:
    extension = "jpg" if media_type == "image" else "mp4" if media_type == "video" else "wav"
    placeholder = {
        "media_type": media_type,
        "url": f"https://example.com/media-studio-graph-estimate.{extension}",
        "source": "remote",
    }
    if role:
        placeholder["role"] = role
    return placeholder


def _output_port(definition: Optional[GraphNodeDefinition], port_id: str):
    if not definition:
        return None
    return next((port for port in definition.ports.get("outputs", []) if port.id == port_id), None)


def _model_options(node: GraphWorkflowNode, definition: GraphNodeDefinition) -> Dict[str, Any]:
    if definition.source.get("preset_id"):
        return {}
    keys = {field.id for field in definition.fields if field.id not in {"prompt", "output_count"}}
    return {key: value for key, value in node.fields.items() if key in keys and value is not None and value != ""}


def _node_output_count(node: GraphWorkflowNode, definition: GraphNodeDefinition) -> int:
    raw = node.fields.get("output_count")
    if raw is None:
        output_limit = definition.limits.get("output_count") if isinstance(definition.limits, dict) else None
        raw = output_limit.get("default") if isinstance(output_limit, dict) else None
    try:
        return max(1, int(raw or 1))
    except (TypeError, ValueError):
        return 1


def _node_execution_mode(node: GraphWorkflowNode) -> str:
    execution = node.metadata.get("execution") if isinstance(node.metadata.get("execution"), dict) else {}
    mode = str(execution.get("mode") or "enabled")
    return mode if mode in {"enabled", "bypassed", "frozen", "muted"} else "enabled"


def _number(value: Any) -> Optional[float]:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.strip())
        except ValueError:
            return None
    return None


def _bounded_int(value: Any, *, fallback: int, minimum: int, maximum: int) -> int:
    parsed = _number(value)
    if parsed is None:
        parsed = fallback
    return max(minimum, min(maximum, int(parsed)))
