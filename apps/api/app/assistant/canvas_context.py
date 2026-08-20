from __future__ import annotations

from typing import Any, Dict, List


MAX_CANVAS_NODES = 80
MAX_CANVAS_EDGES = 160
MAX_CANVAS_GROUPS = 32
MAX_CANVAS_PROMPT_SUMMARIES = 6
MAX_CANVAS_MEDIA_REFS = 12


def _string(value: Any) -> str:
    return str(value or "").strip()


def _number(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _position(value: Any) -> Dict[str, float]:
    payload = value if isinstance(value, dict) else {}
    return {"x": _number(payload.get("x")), "y": _number(payload.get("y"))}


def _bounds(value: Any) -> Dict[str, float] | None:
    payload = value if isinstance(value, dict) else {}
    if not payload:
        return None
    return {
        "x": _number(payload.get("x")),
        "y": _number(payload.get("y")),
        "width": max(0.0, _number(payload.get("width"))),
        "height": max(0.0, _number(payload.get("height"))),
    }


def _string_list(values: Any, *, limit: int) -> List[str]:
    if not isinstance(values, list):
        return []
    return [_string(value) for value in values[:limit] if _string(value)]


def _dict_list(values: Any, *, limit: int) -> List[Dict[str, Any]]:
    if not isinstance(values, list):
        return []
    return [dict(value) for value in values[:limit] if isinstance(value, dict)]


def compact_canvas_context(payload: Any) -> Dict[str, Any] | None:
    if not isinstance(payload, dict):
        return None
    nodes: List[Dict[str, Any]] = []
    for item in payload.get("nodes") if isinstance(payload.get("nodes"), list) else []:
        if not isinstance(item, dict):
            continue
        nodes.append(
            {
                "id": _string(item.get("id")),
                "type": _string(item.get("type")),
                "title": _string(item.get("title")) or _string(item.get("type")),
                "position": _position(item.get("position")),
                "field_keys": _string_list(item.get("field_keys"), limit=80),
                "prompt_summaries": _dict_list(
                    item.get("prompt_summaries"),
                    limit=MAX_CANVAS_PROMPT_SUMMARIES,
                ),
                "media_refs": _dict_list(
                    item.get("media_refs"),
                    limit=MAX_CANVAS_MEDIA_REFS,
                ),
            }
        )
        if len(nodes) >= MAX_CANVAS_NODES:
            break
    edges = []
    for item in payload.get("edges") if isinstance(payload.get("edges"), list) else []:
        if not isinstance(item, dict):
            continue
        edges.append(
            {
                "id": _string(item.get("id")),
                "source": _string(item.get("source")),
                "source_port": _string(item.get("source_port")),
                "target": _string(item.get("target")),
                "target_port": _string(item.get("target_port")),
            }
        )
        if len(edges) >= MAX_CANVAS_EDGES:
            break
    groups = []
    for item in payload.get("groups") if isinstance(payload.get("groups"), list) else []:
        if not isinstance(item, dict):
            continue
        groups.append(
            {
                "id": _string(item.get("id")),
                "title": _string(item.get("title")),
                "node_ids": _string_list(
                    item.get("node_ids"),
                    limit=MAX_CANVAS_NODES,
                ),
                "bounds": _bounds(item.get("bounds")),
            }
        )
        if len(groups) >= MAX_CANVAS_GROUPS:
            break
    layout = payload.get("layout") if isinstance(payload.get("layout"), dict) else {}
    return {
        "version": 1,
        "workflow_id": _string(payload.get("workflow_id")) or None,
        "workflow_name": _string(payload.get("workflow_name")),
        "node_count": int(payload.get("node_count") or len(nodes)),
        "edge_count": int(payload.get("edge_count") or len(edges)),
        "selection_available": bool(payload.get("selection_available")),
        "selected_node_ids": _string_list(
            payload.get("selected_node_ids"),
            limit=MAX_CANVAS_NODES,
        ),
        "selected_group_ids": _string_list(
            payload.get("selected_group_ids"),
            limit=MAX_CANVAS_GROUPS,
        ),
        "nodes": nodes,
        "edges": edges,
        "groups": groups,
        "layout": {
            "bounds": _bounds(layout.get("bounds")),
            "next_section_hint": (
                _position(layout.get("next_section_hint"))
                if isinstance(layout.get("next_section_hint"), dict)
                else None
            ),
        },
    }
