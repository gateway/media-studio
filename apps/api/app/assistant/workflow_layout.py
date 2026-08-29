from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Set

from ..graph.registry import registry
from ..graph.schemas import GraphWorkflow, GraphWorkflowNode
from ..graph.validator import visible_condition_passes


WORKFLOW_COLUMN_GAP = 320.0
WORKFLOW_ROW_GAP = 160.0
WORKFLOW_NODE_GAP = 96.0
WORKFLOW_GROUP_PADDING = 96.0


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


def _node_title(node: GraphWorkflowNode) -> str:
    metadata = node.metadata if isinstance(node.metadata, dict) else {}
    ui = metadata.get("ui") if isinstance(metadata.get("ui"), dict) else {}
    return str(ui.get("customTitle") or node.type or node.id)


def _shot_number(title: str) -> int | None:
    match = re.search(r"\bshot\s*0*(\d+)\b", title, re.IGNORECASE)
    return int(match.group(1)) if match else None


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


def _node_levels(node_ids: List[str], workflow: GraphWorkflow) -> Dict[str, int]:
    eligible = set(node_ids)
    outgoing: Dict[str, Set[str]] = {node_id: set() for node_id in node_ids}
    indegree = {node_id: 0 for node_id in node_ids}
    for edge in workflow.edges:
        if edge.source not in eligible or edge.target not in eligible or edge.source == edge.target:
            continue
        if edge.target in outgoing[edge.source]:
            continue
        outgoing[edge.source].add(edge.target)
        indegree[edge.target] += 1
    levels = {node_id: 0 for node_id in node_ids}
    pending = sorted(node_id for node_id, degree in indegree.items() if degree == 0)
    visited: Set[str] = set()
    while pending:
        node_id = pending.pop(0)
        visited.add(node_id)
        for target_id in sorted(outgoing[node_id]):
            levels[target_id] = max(levels[target_id], levels[node_id] + 1)
            indegree[target_id] -= 1
            if indegree[target_id] == 0:
                pending.append(target_id)
                pending.sort()
    for node_id in set(node_ids) - visited:
        levels[node_id] = 0
    return levels


def _arrange_nodes(node_ids: List[str], workflow: GraphWorkflow, nodes_by_id: Dict[str, GraphWorkflowNode]) -> None:
    if len(node_ids) < 2:
        return
    levels = _node_levels(node_ids, workflow)
    columns: Dict[int, List[GraphWorkflowNode]] = {}
    for node_id in node_ids:
        columns.setdefault(levels[node_id], []).append(nodes_by_id[node_id])
    for column in columns.values():
        column.sort(key=lambda node: (_node_title(node).casefold(), node.id))
    column_widths = {
        level: max(node_layout_size(node.type, node.fields)[0] for node in column)
        for level, column in columns.items()
    }
    column_heights = {level: sum(node_layout_size(node.type, node.fields)[1] for node in column) + WORKFLOW_NODE_GAP * (len(column) - 1) for level, column in columns.items()}
    max_height = max(column_heights.values())
    x = 0.0
    for level in sorted(columns):
        y = (max_height - column_heights[level]) / 2
        for node in columns[level]:
            width, height = node_layout_size(node.type, node.fields)
            node.position = {
                "x": x + (column_widths[level] - width) / 2,
                "y": y,
            }
            y += height + WORKFLOW_NODE_GAP
        x += column_widths[level] + WORKFLOW_NODE_GAP


@dataclass
class _LayoutBlock:
    id: str
    title: str
    node_ids: List[str]
    order: float
    group_id: str | None = None
    level: int = 0
    bounds: Dict[str, float] | None = None


def _block_center_x(block: _LayoutBlock) -> float:
    bounds = block.bounds or {}
    return float(bounds.get("x") or 0) + float(bounds.get("width") or 0) / 2


def _ungrouped_components(
    ungrouped_ids: Set[str],
    workflow: GraphWorkflow,
) -> List[List[str]]:
    neighbors: Dict[str, Set[str]] = {node_id: set() for node_id in ungrouped_ids}
    for edge in workflow.edges:
        if edge.source not in ungrouped_ids or edge.target not in ungrouped_ids:
            continue
        neighbors[edge.source].add(edge.target)
        neighbors[edge.target].add(edge.source)
    components: List[List[str]] = []
    remaining = set(ungrouped_ids)
    while remaining:
        first = min(remaining)
        component = {first}
        pending = [first]
        remaining.remove(first)
        while pending:
            node_id = pending.pop()
            for neighbor_id in sorted(neighbors[node_id] & remaining):
                remaining.remove(neighbor_id)
                component.add(neighbor_id)
                pending.append(neighbor_id)
        components.append(sorted(component))
    return components


def _stage_floor(block: _LayoutBlock, nodes_by_id: Dict[str, GraphWorkflowNode]) -> int:
    if _shot_number(block.title) is None:
        return 0
    output_types = set()
    for node_id in block.node_ids:
        definition = registry.get_definition(nodes_by_id[node_id].type)
        if not nodes_by_id[node_id].type.startswith("model."):
            continue
        output_types.update(port.type for port in definition.ports.get("outputs", []))
    if "video" in output_types:
        return 2
    if "image" in output_types:
        return 1
    return 0


def _assign_block_levels(
    blocks: List[_LayoutBlock],
    workflow: GraphWorkflow,
    block_by_node_id: Dict[str, str],
    nodes_by_id: Dict[str, GraphWorkflowNode],
) -> None:
    by_id = {block.id: block for block in blocks}
    outgoing: Dict[str, Set[str]] = {block.id: set() for block in blocks}
    indegree = {block.id: 0 for block in blocks}
    for edge in workflow.edges:
        source_id = block_by_node_id.get(edge.source)
        target_id = block_by_node_id.get(edge.target)
        if not source_id or not target_id or source_id == target_id or target_id in outgoing[source_id]:
            continue
        outgoing[source_id].add(target_id)
        indegree[target_id] += 1
    for block in blocks:
        block.level = max(block.level, _stage_floor(block, nodes_by_id))
    pending = sorted(
        (block for block in blocks if indegree[block.id] == 0),
        key=lambda block: (block.order, block.title.casefold(), block.id),
    )
    visited: Set[str] = set()
    while pending:
        block = pending.pop(0)
        visited.add(block.id)
        for target_id in sorted(outgoing[block.id]):
            target = by_id[target_id]
            target.level = max(target.level, block.level + 1)
            indegree[target_id] -= 1
            if indegree[target_id] == 0:
                pending.append(target)
                pending.sort(key=lambda item: (item.order, item.title.casefold(), item.id))
    for block in blocks:
        if block.id not in visited:
            block.level = _stage_floor(block, nodes_by_id)


def arrange_workflow(workflow: GraphWorkflow) -> GraphWorkflow:
    """Return a deterministic geometry-only arrangement of the complete workflow."""

    arranged = workflow.model_copy(deep=True)
    if not arranged.nodes:
        return arranged
    nodes_by_id = {node.id: node for node in arranged.nodes}
    metadata = dict(arranged.metadata)
    raw_groups = metadata.get("groups") if isinstance(metadata.get("groups"), list) else []
    groups = [dict(group) if isinstance(group, dict) else group for group in raw_groups]
    metadata["groups"] = groups
    arranged.metadata = metadata

    blocks: List[_LayoutBlock] = []
    claimed_node_ids: Set[str] = set()
    for order, group in enumerate(groups):
        if not isinstance(group, dict):
            continue
        group_id = str(group.get("id") or "")
        member_ids = [str(node_id) for node_id in group.get("node_ids", []) if str(node_id) in nodes_by_id]
        duplicates = claimed_node_ids.intersection(member_ids)
        if duplicates:
            duplicate = sorted(duplicates)[0]
            raise ValueError(f"Cannot arrange a workflow whose node `{duplicate}` belongs to multiple groups.")
        claimed_node_ids.update(member_ids)
        if not group_id or not member_ids:
            continue
        blocks.append(
            _LayoutBlock(
                id=f"group:{group_id}", title=str(group.get("title") or group_id), node_ids=member_ids,
                order=order, group_id=group_id, bounds=dict(group.get("bounds") or {}),
            )
        )

    group_blocks = tuple(blocks)
    group_centers = sorted(_block_center_x(block) for block in group_blocks)
    for block in group_blocks:
        block.level = sum(1 for center in group_centers if center + WORKFLOW_COLUMN_GAP <= _block_center_x(block))
    for level, block in enumerate(block for block in group_blocks if _shot_number(block.title) is None):
        block.level = level % 3
    ungrouped_ids = set(nodes_by_id) - claimed_node_ids
    for component_index, component in enumerate(_ungrouped_components(ungrouped_ids, arranged)):
        first = nodes_by_id[component[0]]
        order = float(len(groups) + component_index)
        level = 0
        if group_blocks and all(nodes_by_id[node_id].type == "utility.note" for node_id in component):
            x, y = float(first.position.get("x", 0)), float(first.position.get("y", 0))
            title_tokens = set(re.findall(r"[a-z0-9]+", _node_title(first).casefold())) - {"continuity", "group", "note", "notes", "production", "section", "shot"}
            anchor = min(
                group_blocks,
                key=lambda block: (
                    -len(title_tokens & (set(re.findall(r"[a-z0-9]+", block.title.casefold())) - {"group", "production", "section", "shot"})),
                    ((block.bounds or {})["x"] + (block.bounds or {})["width"] / 2 - x) ** 2 + ((block.bounds or {})["y"] + (block.bounds or {})["height"] / 2 - y) ** 2,
                ),
            )
            order, level = anchor.order + 0.5, anchor.level
        blocks.append(_LayoutBlock(id=f"nodes:{component[0]}", title=_node_title(first), node_ids=component, order=order, level=level))

    block_by_node_id = {node_id: block.id for block in blocks for node_id in block.node_ids}
    for block in blocks:
        _arrange_nodes(block.node_ids, arranged, nodes_by_id)
        if block.group_id:
            block.bounds = compute_group_bounds(
                (nodes_by_id[node_id] for node_id in block.node_ids),
                title=block.title,
            )
        else:
            block.bounds = bounds_union(node_bounds(nodes_by_id[node_id]) for node_id in block.node_ids)
    _assign_block_levels(blocks, arranged, block_by_node_id, nodes_by_id)
    columns: Dict[int, List[_LayoutBlock]] = {}
    for block in blocks:
        columns.setdefault(block.level, []).append(block)
    blocks_by_id = {block.id: block for block in blocks}
    same_shot_downstream_count: Dict[str, int] = {block.id: 0 for block in blocks}
    for edge in arranged.edges:
        source_block = blocks_by_id.get(block_by_node_id.get(edge.source, ""))
        target_block = blocks_by_id.get(block_by_node_id.get(edge.target, ""))
        if not source_block or not target_block or source_block.id == target_block.id:
            continue
        source_shot = _shot_number(source_block.title)
        if source_shot is not None and source_shot == _shot_number(target_block.title):
            same_shot_downstream_count[source_block.id] += 1
    for column in columns.values():
        column.sort(
            key=lambda block: (
                _shot_number(block.title) is None,
                _shot_number(block.title) or 0,
                -same_shot_downstream_count[block.id],
                block.order,
                block.title.casefold(),
                block.id,
            )
        )
    column_widths = {level: max((block.bounds or {})["width"] for block in column) for level, column in columns.items()}
    shot_numbers = sorted(
        {
            shot_number
            for block in blocks
            if (shot_number := _shot_number(block.title)) is not None
        }
    )
    shot_row_heights: Dict[int, float] = {}
    for shot_number in shot_numbers:
        per_column_heights = []
        for column in columns.values():
            row_blocks = [block for block in column if _shot_number(block.title) == shot_number]
            if row_blocks:
                per_column_heights.append(
                    sum((block.bounds or {})["height"] for block in row_blocks)
                    + WORKFLOW_ROW_GAP * (len(row_blocks) - 1)
                )
        shot_row_heights[shot_number] = max(per_column_heights)
    shot_row_y: Dict[int, float] = {}
    y = 0.0
    for shot_number in shot_numbers:
        shot_row_y[shot_number] = y
        y += shot_row_heights[shot_number] + WORKFLOW_ROW_GAP
    shot_region_height = max(0.0, y - (WORKFLOW_ROW_GAP if shot_numbers else 0.0))
    group_by_id = {str(group.get("id") or ""): group for group in groups if isinstance(group, dict) and str(group.get("id") or "")}
    x = 0.0
    for level in sorted(columns):
        column = columns[level]
        shot_blocks = [block for block in column if _shot_number(block.title) is not None]
        other_blocks = [block for block in column if _shot_number(block.title) is None]
        targets: Dict[str, float] = {}
        for shot_number in shot_numbers:
            row_y = shot_row_y[shot_number]
            for block in [item for item in shot_blocks if _shot_number(item.title) == shot_number]:
                targets[block.id] = row_y
                row_y += (block.bounds or {})["height"] + WORKFLOW_ROW_GAP
        other_height = (
            sum((block.bounds or {})["height"] for block in other_blocks)
            + WORKFLOW_ROW_GAP * max(0, len(other_blocks) - 1)
        )
        if shot_blocks:
            other_y = shot_region_height + (WORKFLOW_ROW_GAP if other_blocks else 0.0)
        else:
            other_y = max(0.0, (shot_region_height - other_height) / 2)
        for block in other_blocks:
            targets[block.id] = other_y
            other_y += (block.bounds or {})["height"] + WORKFLOW_ROW_GAP
        for block in column:
            assert block.bounds is not None
            target_x = x + (column_widths[level] - block.bounds["width"]) / 2
            delta_x = target_x - block.bounds["x"]
            delta_y = targets[block.id] - block.bounds["y"]
            for node_id in block.node_ids:
                node = nodes_by_id[node_id]
                node.position = {
                    "x": float(node.position.get("x", 0)) + delta_x,
                    "y": float(node.position.get("y", 0)) + delta_y,
                }
            if block.group_id:
                group_by_id[block.group_id]["bounds"] = compute_group_bounds(
                    (nodes_by_id[node_id] for node_id in block.node_ids),
                    title=block.title,
                )
        x += column_widths[level] + WORKFLOW_COLUMN_GAP
    return arranged
