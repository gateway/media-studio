from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List, Tuple

from ..graph.normalization import materialize_workflow_defaults
from ..graph.registry import registry
from ..graph.schemas import GraphWorkflow, GraphWorkflowEdge, GraphWorkflowNode
from .schemas import AssistantGraphOperation, AssistantGraphPlan

ASSISTANT_GRAPH_SECTION_GAP = 320.0
ASSISTANT_GRAPH_NODE_GAP = 96.0
ASSISTANT_GRAPH_GROUP_PADDING = 96.0


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
    padding = ASSISTANT_GRAPH_GROUP_PADDING
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


def _rects_have_gap(first: Dict[str, float], second: Dict[str, float], gap: float) -> bool:
    return not _rects_overlap(_expand_bounds(first, gap / 2), _expand_bounds(second, gap / 2))


def _space_added_nodes(nodes: List[GraphWorkflowNode]) -> None:
    if len(nodes) < 2:
        return
    original_positions = {node.id: dict(node.position) for node in nodes}
    placed: List[GraphWorkflowNode] = []
    for node in nodes:
        width = _node_layout_size_for_bounds(node.type)[0]
        while True:
            node_bounds = _bounds_for_node(node)
            conflict = next(
                (
                    candidate
                    for candidate in placed
                    if not _rects_have_gap(
                        node_bounds,
                        _bounds_for_node(candidate),
                        ASSISTANT_GRAPH_NODE_GAP,
                    )
                ),
                None,
            )
            if conflict is None:
                break
            conflict_bounds = _bounds_for_node(conflict)
            conflict_width = _node_layout_size_for_bounds(conflict.type)[0]
            same_column = abs(
                float(original_positions[node.id].get("x", 0))
                - float(original_positions[conflict.id].get("x", 0))
            ) < min(width, conflict_width) / 2
            if same_column:
                node.position = {
                    "x": float(node.position.get("x", 0)),
                    "y": conflict_bounds["y"] + conflict_bounds["height"] + ASSISTANT_GRAPH_NODE_GAP,
                }
            else:
                node.position = {
                    "x": conflict_bounds["x"] + conflict_bounds["width"] + ASSISTANT_GRAPH_NODE_GAP,
                    "y": float(node.position.get("y", 0)),
                }
        placed.append(node)


def _layout_added_nodes(nodes_by_id: Dict[str, GraphWorkflowNode], added_node_ids: List[str]) -> None:
    added_nodes = [nodes_by_id[node_id] for node_id in added_node_ids if node_id in nodes_by_id]
    notes = [node for node in added_nodes if node.type == "utility.note"]
    graph_nodes = [node for node in added_nodes if node.type != "utility.note"]
    _space_added_nodes(notes)
    _space_added_nodes(graph_nodes)
    if not notes or not graph_nodes:
        return
    note_bounds = [_bounds_for_node(node) for node in notes]
    note_bottom = max(bounds["y"] + bounds["height"] for bounds in note_bounds)
    graph_top = min(_bounds_for_node(node)["y"] for node in graph_nodes)
    minimum_graph_top = note_bottom + ASSISTANT_GRAPH_NODE_GAP + ASSISTANT_GRAPH_GROUP_PADDING
    if graph_top >= minimum_graph_top:
        return
    offset = minimum_graph_top - graph_top
    for node in graph_nodes:
        node.position = {
            "x": float(node.position.get("x", 0)),
            "y": float(node.position.get("y", 0)) + offset,
        }


def _shift_added_section_from_existing(
    workflow: GraphWorkflow,
    nodes_by_id: Dict[str, GraphWorkflowNode],
    added_node_ids: List[str],
) -> None:
    existing_bounds = _existing_graph_section_bounds(workflow)
    added_bounds = _bounds_union(
        _bounds_for_node(nodes_by_id[node_id])
        for node_id in added_node_ids
        if node_id in nodes_by_id
    )
    if not existing_bounds or not added_bounds:
        return
    if not _rects_overlap(_expand_bounds(existing_bounds, ASSISTANT_GRAPH_SECTION_GAP), added_bounds):
        return
    offset_x = existing_bounds["x"] + existing_bounds["width"] + ASSISTANT_GRAPH_SECTION_GAP - added_bounds["x"]
    for node_id in added_node_ids:
        node = nodes_by_id.get(node_id)
        if not node:
            continue
        node.position = {
            "x": float(node.position.get("x", 0)) + offset_x,
            "y": float(node.position.get("y", 0)),
        }


def _connected_added_node_ids(
    workflow: GraphWorkflow,
    nodes_by_id: Dict[str, GraphWorkflowNode],
    added_node_ids: List[str],
    member_ids: List[str],
) -> List[str]:
    eligible_ids = {
        node_id
        for node_id in added_node_ids
        if node_id in nodes_by_id and nodes_by_id[node_id].type != "utility.note"
    }
    neighbors = {node_id: set() for node_id in eligible_ids}
    for edge in workflow.edges:
        if edge.source not in eligible_ids or edge.target not in eligible_ids:
            continue
        neighbors[edge.source].add(edge.target)
        neighbors[edge.target].add(edge.source)
    connected_ids = {node_id for node_id in member_ids if node_id in eligible_ids}
    pending = list(connected_ids)
    while pending:
        node_id = pending.pop()
        for neighbor_id in neighbors[node_id] - connected_ids:
            connected_ids.add(neighbor_id)
            pending.append(neighbor_id)
    return [node_id for node_id in added_node_ids if node_id in connected_ids]


def apply_graph_plan(workflow: GraphWorkflow, plan: AssistantGraphPlan) -> GraphWorkflow:
    definitions = registry.definitions_by_type()
    next_workflow = materialize_workflow_defaults(workflow).model_copy(deep=True)
    existing_ids = {node.id for node in next_workflow.nodes}
    node_refs: Dict[str, str] = {}
    nodes_by_id: Dict[str, GraphWorkflowNode] = {node.id: node for node in next_workflow.nodes}
    edges_by_id = {edge.id for edge in next_workflow.edges}
    added_node_ids: List[str] = []
    added_group_ids: set[str] = set()

    def resolve_node_id(reference: str | None, explicit_id: str | None = None) -> str | None:
        return node_refs.get(reference or "") or (
            reference if reference in nodes_by_id else None
        ) or explicit_id

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
                position={"x": float(operation.position.get("x", 0)), "y": float(operation.position.get("y", 0))},
                fields=fields,
                metadata=metadata,
            )
            next_workflow.nodes.append(node)
            nodes_by_id[node_id] = node
            added_node_ids.append(node_id)
            if operation.node_ref:
                node_refs[operation.node_ref] = node_id
            continue

        if operation.op == "set_node_field":
            node_id = resolve_node_id(operation.node_ref, operation.node_id)
            if not node_id or node_id not in nodes_by_id:
                raise ValueError("Cannot set a field on an unknown node.")
            nodes_by_id[node_id].fields.update(operation.fields)
            continue

        if operation.op == "set_node_title":
            node_id = resolve_node_id(operation.node_ref, operation.node_id)
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
                position={"x": float(operation.position.get("x", 0)), "y": float(operation.position.get("y", 0))},
                fields={**_default_fields(node_type), "body": operation.body or operation.fields.get("body") or ""},
                metadata={"ui": {"customTitle": operation.title or "Guide"}},
            )
            next_workflow.nodes.append(node)
            nodes_by_id[node_id] = node
            added_node_ids.append(node_id)
            if operation.node_ref:
                node_refs[operation.node_ref] = node_id
            continue

        if operation.op == "connect_nodes":
            source_id = resolve_node_id(operation.source_ref, operation.node_id)
            target_id = resolve_node_id(operation.target_ref)
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
            added_group_ids.add(group_id)
            metadata["groups"] = groups
            next_workflow.metadata = metadata
            continue

        if operation.op in {"layout_nodes", "save_workflow", "set_provider_model", "set_execution_mode"}:
            continue

        raise ValueError(f"Unsupported assistant graph operation: {operation.op}")

    _layout_added_nodes(nodes_by_id, added_node_ids)
    _shift_added_section_from_existing(workflow, nodes_by_id, added_node_ids)
    if added_group_ids:
        metadata = dict(next_workflow.metadata)
        groups = [dict(group) for group in metadata.get("groups") or []]
        normalized_groups = []
        for group in groups:
            if str(group.get("id") or "") not in added_group_ids:
                normalized_groups.append(group)
                continue
            node_ids = group.get("node_ids") if isinstance(group.get("node_ids"), list) else []
            node_ids = [
                node_id
                for node_id in node_ids
                if node_id in nodes_by_id and nodes_by_id[node_id].type != "utility.note"
            ]
            if len(added_group_ids) == 1:
                expanded_node_ids = _connected_added_node_ids(
                    next_workflow,
                    nodes_by_id,
                    added_node_ids,
                    node_ids,
                )
                node_ids = [*node_ids, *(node_id for node_id in expanded_node_ids if node_id not in node_ids)]
            if not node_ids:
                continue
            group["node_ids"] = node_ids
            group["bounds"] = _compute_group_bounds(
                nodes_by_id[node_id]
                for node_id in node_ids
                if node_id in nodes_by_id
            )
            normalized_groups.append(group)
        metadata["groups"] = normalized_groups
        next_workflow.metadata = metadata
    if plan.metadata:
        metadata = dict(next_workflow.metadata)
        metadata["assistant_plan"] = dict(plan.metadata)
        next_workflow.metadata = metadata
    return materialize_workflow_defaults(next_workflow)
