from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List, Tuple

from ..graph.normalization import materialize_workflow_defaults
from ..graph.registry import registry
from ..graph.schemas import GraphWorkflow, GraphWorkflowEdge, GraphWorkflowNode
from .schemas import AssistantGraphOperation, AssistantGraphPlan

ASSISTANT_GRAPH_SECTION_GAP = 320.0


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-") or "node"


def _unique_id(base: str, existing: set[str]) -> str:
    candidate = base
    suffix = 2
    while candidate in existing:
        candidate = f"{base}-{suffix}"
        suffix += 1
    existing.add(candidate)
    return candidate


def _default_fields(node_type: str) -> Dict[str, Any]:
    definition = registry.get_definition(node_type)
    fields: Dict[str, Any] = {}
    for field in definition.fields:
        if field.default is not None:
            fields[field.id] = field.default
    return fields


def _default_size(node_type: str) -> tuple[float, float]:
    definition = registry.get_definition(node_type)
    size = definition.ui.get("default_size") if isinstance(definition.ui, dict) else None
    if isinstance(size, dict):
        return float(size.get("width") or 320), float(size.get("height") or 260)
    return 320.0, 260.0


def _node_layout_size_for_bounds(node_type: str) -> tuple[float, float]:
    definition = registry.get_definition(node_type)
    default_width, default_height = _default_size(node_type)
    ui = definition.ui if isinstance(definition.ui, dict) else {}
    min_size = ui.get("min_size") if isinstance(ui.get("min_size"), dict) else {}
    min_width = float(min_size.get("width") or 0)
    min_height = float(min_size.get("height") or 0)
    visible_fields = [field for field in definition.fields if not field.hidden]
    visible_ports = [
        port
        for port in [*definition.ports.get("inputs", []), *definition.ports.get("outputs", [])]
        if not port.advanced
    ]
    textarea_count = sum(1 for field in visible_fields if field.type == "textarea")
    has_preview = bool(ui.get("preview")) or node_type.startswith("media.load_") or node_type.startswith("media.save_")
    content_height = 132 + len(visible_fields) * 52 + len(visible_ports) * 28 + textarea_count * 70 + (140 if has_preview else 0)
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


def _port_ids(node_type: str, direction: str) -> set[str]:
    definition = registry.get_definition(node_type)
    return {port.id for port in definition.ports.get(direction, [])}


def _compute_group_bounds(nodes: Iterable[GraphWorkflowNode]) -> Dict[str, float]:
    members = list(nodes)
    if not members:
        return {"x": 0, "y": 0, "width": 260, "height": 220}
    padding = 80
    left = min(node.position.get("x", 0) for node in members)
    top = min(node.position.get("y", 0) for node in members)
    right = max(node.position.get("x", 0) + _node_layout_size_for_bounds(node.type)[0] for node in members)
    bottom = max(node.position.get("y", 0) + _node_layout_size_for_bounds(node.type)[1] for node in members)
    return {
        "x": left - padding,
        "y": top - padding,
        "width": max(220, right - left + padding * 2),
        "height": max(220, bottom - top + padding * 2),
    }


def _rects_overlap(first: Dict[str, float], second: Dict[str, float]) -> bool:
    return not (
        first["x"] + first["width"] <= second["x"]
        or second["x"] + second["width"] <= first["x"]
        or first["y"] + first["height"] <= second["y"]
        or second["y"] + second["height"] <= first["y"]
    )


def _expand_bounds(bounds: Dict[str, float], padding: float) -> Dict[str, float]:
    return {
        "x": float(bounds.get("x", 0)) - padding,
        "y": float(bounds.get("y", 0)) - padding,
        "width": float(bounds.get("width", 0)) + padding * 2,
        "height": float(bounds.get("height", 0)) + padding * 2,
    }


def _bounds_for_node(node: GraphWorkflowNode) -> Dict[str, float]:
    width, height = _node_layout_size_for_bounds(node.type)
    return {
        "x": float(node.position.get("x", 0)),
        "y": float(node.position.get("y", 0)),
        "width": width,
        "height": height,
    }


def _bounds_union(bounds: Iterable[Dict[str, float]]) -> Dict[str, float] | None:
    items = list(bounds)
    if not items:
        return None
    left = min(float(item.get("x", 0)) for item in items)
    top = min(float(item.get("y", 0)) for item in items)
    right = max(float(item.get("x", 0)) + float(item.get("width", 0)) for item in items)
    bottom = max(float(item.get("y", 0)) + float(item.get("height", 0)) for item in items)
    return {"x": left, "y": top, "width": right - left, "height": bottom - top}


def _existing_graph_section_bounds(workflow: GraphWorkflow) -> Dict[str, float] | None:
    bounds = [_bounds_for_node(node) for node in workflow.nodes]
    groups = workflow.metadata.get("groups") if isinstance(workflow.metadata, dict) else []
    for group in groups if isinstance(groups, list) else []:
        if not isinstance(group, dict) or not isinstance(group.get("bounds"), dict):
            continue
        group_bounds = group["bounds"]
        bounds.append(
            {
                "x": float(group_bounds.get("x") or 0),
                "y": float(group_bounds.get("y") or 0),
                "width": float(group_bounds.get("width") or 0),
                "height": float(group_bounds.get("height") or 0),
            }
        )
    return _bounds_union(bounds)


def _new_graph_section_bounds(operations: Iterable[AssistantGraphOperation], definitions: Dict[str, Any]) -> Dict[str, float] | None:
    bounds = []
    for operation in operations:
        if operation.op == "add_note":
            node_type = "utility.note"
        elif operation.op == "add_node" and operation.node_type:
            node_type = operation.node_type
        else:
            continue
        if node_type not in definitions:
            continue
        width, height = _node_layout_size_for_bounds(node_type)
        bounds.append(
            {
                "x": float(operation.position.get("x", 0)),
                "y": float(operation.position.get("y", 0)),
                "width": width,
                "height": height,
            }
        )
    return _bounds_union(bounds)


def _new_graph_section_offset(workflow: GraphWorkflow, operations: Iterable[AssistantGraphOperation], definitions: Dict[str, Any]) -> Dict[str, float]:
    existing_bounds = _existing_graph_section_bounds(workflow)
    new_bounds = _new_graph_section_bounds(operations, definitions)
    if not existing_bounds or not new_bounds:
        return {"x": 0.0, "y": 0.0}
    if not _rects_overlap(_expand_bounds(existing_bounds, ASSISTANT_GRAPH_SECTION_GAP), new_bounds):
        return {"x": 0.0, "y": 0.0}
    return {
        "x": existing_bounds["x"] + existing_bounds["width"] + ASSISTANT_GRAPH_SECTION_GAP - new_bounds["x"],
        "y": 0.0,
    }


def _shifted_position(position: Dict[str, Any], offset: Dict[str, float]) -> Dict[str, float]:
    return {
        "x": float(position.get("x", 0)) + float(offset.get("x", 0)),
        "y": float(position.get("y", 0)) + float(offset.get("y", 0)),
    }


def apply_graph_plan(workflow: GraphWorkflow, plan: AssistantGraphPlan) -> GraphWorkflow:
    definitions = registry.definitions_by_type()
    next_workflow = materialize_workflow_defaults(workflow).model_copy(deep=True)
    graph_section_offset = _new_graph_section_offset(next_workflow, plan.operations, definitions)
    existing_ids = {node.id for node in next_workflow.nodes}
    node_refs: Dict[str, str] = {}
    nodes_by_id: Dict[str, GraphWorkflowNode] = {node.id: node for node in next_workflow.nodes}
    edges_by_id = {edge.id for edge in next_workflow.edges}

    for operation in plan.operations:
        if operation.op == "add_node":
            if not operation.node_type or operation.node_type not in definitions:
                raise ValueError(f"Unknown node type: {operation.node_type or 'missing'}")
            base_id = operation.node_id or f"assistant-{_slug(operation.node_ref or operation.node_type)}"
            node_id = _unique_id(base_id, existing_ids)
            fields = {**_default_fields(operation.node_type), **operation.fields}
            metadata: Dict[str, Any] = {}
            if operation.title:
                metadata["ui"] = {"customTitle": operation.title}
            if operation.node_ref:
                metadata["assistant"] = {"semantic_ref": operation.node_ref}
            node = GraphWorkflowNode(
                id=node_id,
                type=operation.node_type,
                position=_shifted_position(operation.position, graph_section_offset),
                fields=fields,
                metadata=metadata,
            )
            next_workflow.nodes.append(node)
            nodes_by_id[node_id] = node
            if operation.node_ref:
                node_refs[operation.node_ref] = node_id
            continue

        if operation.op == "set_node_field":
            node_id = node_refs.get(operation.node_ref or "") or operation.node_id
            if not node_id or node_id not in nodes_by_id:
                raise ValueError("Cannot set a field on an unknown node.")
            nodes_by_id[node_id].fields.update(operation.fields)
            continue

        if operation.op == "set_node_title":
            node_id = node_refs.get(operation.node_ref or "") or operation.node_id
            if not node_id or node_id not in nodes_by_id:
                raise ValueError("Cannot set a title on an unknown node.")
            metadata = dict(nodes_by_id[node_id].metadata)
            ui = dict(metadata.get("ui") or {})
            ui["customTitle"] = operation.title or ""
            metadata["ui"] = ui
            nodes_by_id[node_id].metadata = metadata
            continue

        if operation.op == "add_note":
            node_type = "utility.note"
            if node_type not in definitions:
                raise ValueError("The note node is not available.")
            base_id = operation.node_id or f"assistant-{_slug(operation.node_ref or node_type)}"
            node_id = _unique_id(base_id, existing_ids)
            node = GraphWorkflowNode(
                id=node_id,
                type=node_type,
                position=_shifted_position(operation.position, graph_section_offset),
                fields={**_default_fields(node_type), "body": operation.body or operation.fields.get("body") or ""},
                metadata={"ui": {"customTitle": operation.title or "Guide"}},
            )
            next_workflow.nodes.append(node)
            nodes_by_id[node_id] = node
            if operation.node_ref:
                node_refs[operation.node_ref] = node_id
            continue

        if operation.op == "connect_nodes":
            source_id = node_refs.get(operation.source_ref or "") or operation.node_id
            target_id = node_refs.get(operation.target_ref or "")
            if not source_id or source_id not in nodes_by_id or not target_id or target_id not in nodes_by_id:
                raise ValueError("Cannot connect unknown nodes.")
            if not operation.source_port or operation.source_port not in _port_ids(nodes_by_id[source_id].type, "outputs"):
                raise ValueError(f"Unknown source port: {operation.source_port or 'missing'}")
            if not operation.target_port or operation.target_port not in _port_ids(nodes_by_id[target_id].type, "inputs"):
                raise ValueError(f"Unknown target port: {operation.target_port or 'missing'}")
            edge_id = _unique_id(f"edge-{source_id}-{operation.source_port}-{target_id}-{operation.target_port}", edges_by_id)
            next_workflow.edges.append(
                GraphWorkflowEdge(
                    id=edge_id,
                    source=source_id,
                    source_port=operation.source_port,
                    target=target_id,
                    target_port=operation.target_port,
                )
            )
            continue

        if operation.op == "group_nodes":
            refs = [node_refs.get(ref, ref) for ref in operation.node_refs]
            node_ids = [node_id for node_id in refs if node_id in nodes_by_id]
            if not node_ids:
                raise ValueError("Cannot create an empty group.")
            metadata = dict(next_workflow.metadata)
            groups = list(metadata.get("groups") or [])
            group_id = _unique_id(f"assistant-group-{_slug(operation.group_ref or operation.title or 'group')}", {str(group.get("id")) for group in groups if isinstance(group, dict)})
            group_nodes = [nodes_by_id[node_id] for node_id in node_ids]
            groups.append(
                {
                    "id": group_id,
                    "title": operation.title or "Assistant workflow",
                    "color": operation.color or "blue",
                    "node_ids": node_ids,
                    "bounds": _compute_group_bounds(group_nodes),
                    "execution": {"mode": "enabled"},
                }
            )
            metadata["groups"] = groups
            next_workflow.metadata = metadata
            continue

        if operation.op in {"layout_nodes", "save_workflow", "set_provider_model", "set_execution_mode"}:
            continue

        raise ValueError(f"Unsupported assistant graph operation: {operation.op}")

    if plan.metadata:
        metadata = dict(next_workflow.metadata)
        metadata["assistant_plan"] = dict(plan.metadata)
        next_workflow.metadata = metadata
    return materialize_workflow_defaults(next_workflow)
