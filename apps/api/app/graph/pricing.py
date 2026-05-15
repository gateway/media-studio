from __future__ import annotations

from typing import Any, Dict, List, Optional

from .. import kie_adapter
from ..pricing import summarize_estimated_cost
from .executors.kie_model import _select_task_mode
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


def estimate_graph_workflow(workflow: GraphWorkflow) -> GraphEstimateResponse:
    definitions = registry.definitions_by_type()
    warnings: List[GraphError] = []
    validation = validate_workflow(workflow)
    warnings.extend(validation.warnings)
    warnings.extend(validation.errors)

    snapshot = kie_adapter.pricing_snapshot(force_refresh=False)
    if snapshot.get("is_stale"):
        warnings.append(GraphError(code="stale_pricing", message="Pricing snapshot is stale; graph estimate may be out of date."))
    if snapshot.get("refresh_error"):
        warnings.append(GraphError(code="pricing_refresh_failed", message=str(snapshot.get("refresh_error"))))

    nodes: Dict[str, GraphEstimateNode] = {}
    total_credits = 0.0
    total_usd = 0.0
    has_credits = False
    has_usd = False
    has_unknown = False
    has_stale = bool(snapshot.get("is_stale"))
    all_authoritative = bool(snapshot.get("is_authoritative", False))

    for node in workflow.nodes:
        definition = definitions.get(node.type)
        if not definition:
            continue
        source_kind = str(definition.source.get("kind") or "")
        if source_kind == "kie_model":
            estimate = _estimate_model_node(workflow, node, definition, definitions, snapshot)
        elif source_kind == "external_llm":
            estimate = _estimate_external_llm_node(node)
        else:
            continue
        nodes[node.id] = estimate
        warnings.extend(estimate.warnings)
        summary = estimate.pricing_summary
        if summary.get("has_numeric_estimate"):
            credits = _number(summary.get("total", {}).get("estimated_credits"))
            usd = _number(summary.get("total", {}).get("estimated_cost_usd"))
            if credits is not None:
                total_credits += credits
                has_credits = True
            if usd is not None:
                total_usd += usd
                has_usd = True
        else:
            has_unknown = True
        all_authoritative = all_authoritative and bool(summary.get("is_authoritative"))

    currency = str(snapshot.get("currency") or "USD")
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
        "pricing_source_kind": snapshot.get("source_kind") or snapshot.get("source"),
        "pricing_status": snapshot.get("pricing_status"),
        "priced_model_count": len(snapshot.get("priced_model_keys") or []),
        "missing_model_count": len(snapshot.get("missing_model_keys") or []),
    }
    return GraphEstimateResponse(pricing_summary=pricing_summary, nodes=nodes, warnings=warnings)


def _estimate_external_llm_node(node: GraphWorkflowNode) -> GraphEstimateNode:
    mode = _node_execution_mode(node)
    provider = str(node.fields.get("provider") or "studio_default")
    model_id = str(node.fields.get("model_id") or "").strip() or provider
    if mode != "enabled":
        return GraphEstimateNode(
            node_id=node.id,
            node_type=node.type,
            model_key=model_id,
            pricing_summary={**ZERO_PRICING_SUMMARY, "model_key": model_id, "output_count": 1},
            assumptions=[f"Execution mode {mode} reuses or skips outputs and does not add new external LLM spend."],
        )
    warning = GraphError(
        code="unknown_external_llm_pricing",
        message="External LLM pricing is not mapped for Graph Studio yet.",
        node_id=node.id,
    )
    return GraphEstimateNode(
        node_id=node.id,
        node_type=node.type,
        model_key=model_id,
        output_count=1,
        pricing_summary={**UNKNOWN_EXTERNAL_LLM_PRICING_SUMMARY, "model_key": model_id, "provider": provider, "output_count": 1},
        assumptions=["External LLM token pricing is provider/model dependent and currently requires spend confirmation."],
        warnings=[warning],
    )


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
    input_types = _incoming_media_types(workflow, node.id, definitions)
    task_mode = _select_task_mode(
        [str(item) for item in (definition.source.get("task_modes") or [])],
        output_media_type=output_media_type,
        has_images="image" in input_types,
        has_videos="video" in input_types,
        has_audios="audio" in input_types,
    )
    raw_request = {
        "model_key": model_key,
        "task_mode": task_mode,
        "prompt": str(node.fields.get("prompt") or "Graph pricing estimate"),
        "images": [_pricing_media_placeholder("image")] if "image" in input_types else [],
        "videos": [_pricing_media_placeholder("video")] if "video" in input_types else [],
        "audios": [_pricing_media_placeholder("audio")] if "audio" in input_types else [],
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


def _pricing_media_placeholder(media_type: str) -> Dict[str, str]:
    extension = "jpg" if media_type == "image" else "mp4" if media_type == "video" else "wav"
    return {
        "media_type": media_type,
        "url": f"https://example.com/media-studio-graph-estimate.{extension}",
        "source": "remote",
    }


def _output_port(definition: Optional[GraphNodeDefinition], port_id: str):
    if not definition:
        return None
    return next((port for port in definition.ports.get("outputs", []) if port.id == port_id), None)


def _model_options(node: GraphWorkflowNode, definition: GraphNodeDefinition) -> Dict[str, Any]:
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
    return None
