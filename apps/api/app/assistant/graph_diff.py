from __future__ import annotations

from typing import Any, Dict, Iterable, List

from ..graph.normalization import materialize_workflow_defaults
from ..graph.schemas import GraphError, GraphValidationResult, GraphWorkflow, GraphWorkflowNode
from .schemas import AssistantGraphPlan


def _node_title(node: GraphWorkflowNode) -> str:
    metadata = node.metadata if isinstance(node.metadata, dict) else {}
    ui = metadata.get("ui") if isinstance(metadata.get("ui"), dict) else {}
    return str(ui.get("customTitle") or node.type or node.id)


def _groups(workflow: GraphWorkflow) -> List[Dict[str, Any]]:
    groups = workflow.metadata.get("groups") if isinstance(workflow.metadata, dict) else []
    if not isinstance(groups, list):
        return []
    return [group for group in groups if isinstance(group, dict)]


def _bounds(group: Dict[str, Any]) -> Dict[str, float] | None:
    raw = group.get("bounds") if isinstance(group.get("bounds"), dict) else None
    if not raw:
        return None
    return {
        "x": float(raw.get("x") or 0),
        "y": float(raw.get("y") or 0),
        "width": float(raw.get("width") or 0),
        "height": float(raw.get("height") or 0),
    }


def _overlaps(first: Dict[str, float], second: Dict[str, float]) -> bool:
    return not (
        first["x"] + first["width"] <= second["x"]
        or second["x"] + second["width"] <= first["x"]
        or first["y"] + first["height"] <= second["y"]
        or second["y"] + second["height"] <= first["y"]
    )


def _validation_summary(validation: GraphValidationResult | None) -> Dict[str, Any]:
    if validation is None:
        return {}
    return {
        "valid": validation.valid,
        "error_count": len(validation.errors),
        "warning_count": len(validation.warnings),
        "error_codes": [error.code for error in validation.errors[:8]],
        "warning_codes": [warning.code for warning in validation.warnings[:8]],
    }


def graph_plan_layout_errors(base_workflow: GraphWorkflow, next_workflow: GraphWorkflow, graph_plan: AssistantGraphPlan) -> List[GraphError]:
    if not graph_plan.operations:
        return []
    base_groups = _groups(base_workflow)
    base_group_ids = {str(group.get("id") or "") for group in base_groups}
    new_groups = [group for group in _groups(next_workflow) if str(group.get("id") or "") not in base_group_ids]
    errors: List[GraphError] = []
    for new_group in new_groups:
        new_bounds = _bounds(new_group)
        if not new_bounds:
            continue
        for existing_group in base_groups:
            existing_bounds = _bounds(existing_group)
            if not existing_bounds:
                continue
            if _overlaps(existing_bounds, new_bounds):
                errors.append(
                    GraphError(
                        code="assistant_group_overlap",
                        message=f"Assistant group `{new_group.get('title') or new_group.get('id')}` overlaps existing group `{existing_group.get('title') or existing_group.get('id')}`.",
                    )
                )
                break
    return errors


def graph_plan_diff_summary(
    base_workflow: GraphWorkflow,
    next_workflow: GraphWorkflow,
    graph_plan: AssistantGraphPlan,
    *,
    validation: GraphValidationResult | None = None,
    layout_errors: Iterable[GraphError] | None = None,
) -> Dict[str, Any]:
    base_workflow = materialize_workflow_defaults(base_workflow)
    base_nodes = {node.id: node for node in base_workflow.nodes}
    next_nodes = {node.id: node for node in next_workflow.nodes}
    base_edges = {edge.id: edge for edge in base_workflow.edges}
    next_edges = {edge.id: edge for edge in next_workflow.edges}
    base_group_ids = {str(group.get("id") or "") for group in _groups(base_workflow)}
    changed_nodes = []
    for node_id, next_node in next_nodes.items():
        base_node = base_nodes.get(node_id)
        if not base_node:
            continue
        changed: List[str] = []
        if _node_title(base_node) != _node_title(next_node):
            changed.append("title")
        field_keys = sorted(key for key in set(base_node.fields.keys()) | set(next_node.fields.keys()) if base_node.fields.get(key) != next_node.fields.get(key))
        if field_keys:
            changed.append("fields")
        if changed:
            changed_nodes.append({"id": node_id, "title": _node_title(next_node), "changed": changed, "field_keys": field_keys[:20]})
    return {
        "operation_kinds": [operation.op for operation in graph_plan.operations],
        "operation_count": len(graph_plan.operations),
        "nodes_added": [
            {"id": node.id, "type": node.type, "title": _node_title(node)}
            for node_id, node in next_nodes.items()
            if node_id not in base_nodes
        ],
        "nodes_changed": changed_nodes,
        "edges_added": [
            {
                "id": edge.id,
                "source": edge.source,
                "source_port": edge.source_port,
                "target": edge.target,
                "target_port": edge.target_port,
            }
            for edge_id, edge in next_edges.items()
            if edge_id not in base_edges
        ],
        "groups_added": [
            {
                "id": str(group.get("id") or ""),
                "title": str(group.get("title") or ""),
                "node_count": len(group.get("node_ids") if isinstance(group.get("node_ids"), list) else []),
                "bounds": group.get("bounds"),
            }
            for group in _groups(next_workflow)
            if str(group.get("id") or "") not in base_group_ids
        ],
        "warnings": list(graph_plan.warnings[:8]),
        "layout_errors": [error.model_dump(mode="json") for error in list(layout_errors or [])[:8]],
        "validation": _validation_summary(validation),
    }
