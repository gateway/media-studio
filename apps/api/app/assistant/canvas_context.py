from __future__ import annotations

from typing import Any, Dict, Iterable, List, Tuple


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
                "prompt_summaries": _dict_list(item.get("prompt_summaries"), limit=MAX_CANVAS_PROMPT_SUMMARIES),
                "media_refs": _dict_list(item.get("media_refs"), limit=MAX_CANVAS_MEDIA_REFS),
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
                "node_ids": _string_list(item.get("node_ids"), limit=MAX_CANVAS_NODES),
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
        "selected_node_ids": _string_list(payload.get("selected_node_ids"), limit=MAX_CANVAS_NODES),
        "selected_group_ids": _string_list(payload.get("selected_group_ids"), limit=MAX_CANVAS_GROUPS),
        "nodes": nodes,
        "edges": edges,
        "groups": groups,
        "layout": {
            "bounds": _bounds(layout.get("bounds")),
            "next_section_hint": _position(layout.get("next_section_hint")) if isinstance(layout.get("next_section_hint"), dict) else None,
        },
    }


def _wants_canvas_inventory(message: str) -> bool:
    lowered = " ".join(_string(message).lower().split())
    if not lowered:
        return False
    if "preset" in lowered and any(term in lowered for term in ("what preset", "recommend", "preset shape", "turn this", "make this")):
        return False
    sees_graph_nodes = any(term in lowered for term in ("do you see", "can you see")) and any(
        term in lowered for term in ("graph", "canvas", "node", "nodes", "storyboard")
    )
    direct_terms = (
        "what do you see",
        "what can you see",
        "current canvas",
        "current graph",
        "live canvas",
        "exact node titles",
        "node titles",
        "nodes on the graph",
        "nodes in the graph",
        "on this graph",
        "on my graph",
        "inspect the canvas",
        "inspect this canvas",
        "inspect the graph",
        "inspect this graph",
        "review this workflow",
        "review the workflow",
        "review this graph",
        "review the graph",
        "check this workflow",
        "check the workflow",
        "before i run it",
        "before we run it",
    )
    return sees_graph_nodes or any(term in lowered for term in direct_terms)


def _wants_concise_reply(message: str) -> bool:
    lowered = " ".join(_string(message).lower().split())
    return any(term in lowered for term in ("keep it short", "concise", "brief", "summarize", "quick check"))


def _title_lines(nodes: Iterable[Dict[str, Any]]) -> List[str]:
    lines = []
    for node in nodes:
        title = _string(node.get("title")) or _string(node.get("type")) or _string(node.get("id"))
        node_type = _string(node.get("type"))
        if node_type and node_type != title:
            lines.append(f"- {title} ({node_type})")
        elif title:
            lines.append(f"- {title}")
    return lines


def _group_lines(groups: Iterable[Dict[str, Any]]) -> List[str]:
    lines = []
    for group in groups:
        title = _string(group.get("title")) or _string(group.get("id"))
        node_ids = group.get("node_ids") if isinstance(group.get("node_ids"), list) else []
        if title:
            lines.append(f"- {title}: {len(node_ids)} nodes")
    return lines


def _storyboard_summary_lines(nodes: Iterable[Dict[str, Any]]) -> List[str]:
    storyboard: Dict[str, List[str]] = {}
    for node in nodes:
        title = _string(node.get("title")) or _string(node.get("type")) or _string(node.get("id"))
        lowered = title.lower()
        for index in range(1, 10):
            marker = f"storyboard {index}"
            if marker in lowered:
                suffix = title[len(marker) :].strip(" -:") if lowered.startswith(marker) else title
                storyboard.setdefault(str(index), []).append(suffix or title)
                break
    lines = []
    for index in sorted(storyboard, key=int):
        labels = ", ".join(dict.fromkeys(storyboard[index]))
        lines.append(f"- Storyboard {index}: {labels}")
    return lines


def canvas_inventory_reply(message: str, canvas_context: Dict[str, Any] | None) -> Tuple[str, Dict[str, Any]] | None:
    context = compact_canvas_context(canvas_context)
    if not context or not _wants_canvas_inventory(message):
        return None
    nodes = context.get("nodes") if isinstance(context.get("nodes"), list) else []
    groups = context.get("groups") if isinstance(context.get("groups"), list) else []
    if not nodes:
        return (
            "I can see the current graph, but it does not have any nodes yet.",
            {
                "mode": "deterministic_canvas_inventory",
                "suggested_action": None,
                "canvas_context_used": True,
                "canvas_node_count": 0,
                "canvas_edge_count": int(context.get("edge_count") or 0),
            },
        )
    title_lines = _title_lines(nodes[:24])
    group_lines = _group_lines(groups[:8])
    if _wants_concise_reply(message):
        image_nodes = [
            _string(node.get("title")) or _string(node.get("type")) or _string(node.get("id"))
            for node in nodes
            if _string(node.get("type")) == "media.load_image"
        ]
        concise_lines = [
            f"I see `{context.get('workflow_name') or 'this graph'}` with {context.get('node_count')} nodes and {context.get('edge_count')} edges.",
        ]
        if image_nodes:
            concise_lines.extend(["", "Character/reference anchor:", *[f"- {title}" for title in image_nodes[:4]]])
        if group_lines:
            concise_lines.extend(["", "Storyboard groups:", *group_lines])
        storyboard_lines = _storyboard_summary_lines(nodes[:24])
        if storyboard_lines:
            concise_lines.extend(["", "Storyboard nodes:", *storyboard_lines])
        concise_lines.extend(["", "I can give the full node list if you want it."])
        return (
            "\n".join(concise_lines),
            {
                "mode": "deterministic_canvas_inventory",
                "suggested_action": None,
                "canvas_context_used": True,
                "canvas_node_count": int(context.get("node_count") or len(nodes)),
                "canvas_edge_count": int(context.get("edge_count") or 0),
                "canvas_group_count": len(groups),
                "reply_style": "concise",
            },
        )
    group_text = "\n\nGroups:\n" + "\n".join(group_lines) if group_lines else ""
    selected = context.get("selected_node_ids") if isinstance(context.get("selected_node_ids"), list) else []
    selection_text = "\n\nSelected nodes: " + ", ".join(selected) if selected else "\n\nNo selected nodes were included in the canvas snapshot."
    text = (
        f"I can see `{context.get('workflow_name') or 'this graph'}` with {context.get('node_count')} nodes and {context.get('edge_count')} edges.\n\n"
        "Visible nodes:\n"
        + "\n".join(title_lines)
        + group_text
        + selection_text
    )
    return (
        text,
        {
            "mode": "deterministic_canvas_inventory",
            "suggested_action": None,
            "canvas_context_used": True,
            "canvas_node_count": int(context.get("node_count") or len(nodes)),
            "canvas_edge_count": int(context.get("edge_count") or 0),
            "canvas_group_count": len(groups),
        },
    )


def _wants_canvas_preset_shape(message: str) -> bool:
    lowered = " ".join(_string(message).lower().split())
    if "preset" not in lowered:
        return False
    return any(
        term in lowered
        for term in (
            "current graph",
            "this graph",
            "what preset",
            "recommend",
            "preset shape",
            "turn this",
            "make this",
            "from this workflow",
            "from this canvas",
        )
    )


def _prompt_summary_text(nodes: Iterable[Dict[str, Any]]) -> str:
    parts: List[str] = []
    for node in nodes:
        for summary in node.get("prompt_summaries") if isinstance(node.get("prompt_summaries"), list) else []:
            if isinstance(summary, dict):
                parts.append(_string(summary.get("text") or summary.get("preview") or summary.get("summary")))
    return " ".join(part for part in parts if part).lower()


def _preset_fields_from_canvas(nodes: Iterable[Dict[str, Any]]) -> List[str]:
    text = _prompt_summary_text(nodes)
    titles = " ".join(_string(node.get("title")) for node in nodes).lower()
    source = f"{text} {titles}"
    fields: List[str] = []
    if any(term in source for term in ("character", "person", "subject", "portrait", "hero")):
        fields.append("Subject / Character")
    if any(term in source for term in ("scene", "environment", "setting", "location", "world", "background")):
        fields.append("Scene / Setting")
    if any(term in source for term in ("mood", "tone", "style", "cinematic", "fantasy", "sci-fi", "horror", "lighting")):
        fields.append("Mood / Style Notes")
    if any(term in source for term in ("dialog", "dialogue", "caption", "title", "text", "slogan")):
        fields.append("Text / Dialogue")
    if not fields:
        fields = ["Subject", "Scene / Setting", "Style Notes"]
    deduped: List[str] = []
    for field in fields:
        if field not in deduped:
            deduped.append(field)
    return deduped[:3]


def canvas_preset_shape_reply(message: str, canvas_context: Dict[str, Any] | None) -> Tuple[str, Dict[str, Any]] | None:
    context = compact_canvas_context(canvas_context)
    if not context or not _wants_canvas_preset_shape(message):
        return None
    nodes = context.get("nodes") if isinstance(context.get("nodes"), list) else []
    if not nodes:
        return None
    has_image_input = any(_string(node.get("type")) == "media.load_image" for node in nodes)
    has_prompt = any(_string(node.get("type")) in {"prompt.text", "prompt.recipe"} for node in nodes)
    image_slot = "Character / Subject Reference" if has_image_input else ""
    if has_image_input and has_prompt:
        shape_sentence = "I would start with image-to-image, with a text-to-image variant if you want the style to work without a source image."
        shape_key = "image_to_image"
    elif has_image_input:
        shape_sentence = "I would make this an image-to-image preset."
        shape_key = "image_to_image"
    else:
        shape_sentence = "I would make this a text-to-image preset."
        shape_key = "text_to_image"
    fields = _preset_fields_from_canvas(nodes)
    lines = [
        shape_sentence,
        "Useful fields:",
        *[f"- {field}" for field in fields],
    ]
    if image_slot:
        lines.extend(["Image slot:", f"- {image_slot}"])
    lines.append("I can create the local test graph from this setup when you are ready.")
    return (
        "\n".join(lines),
        {
            "mode": "deterministic_canvas_preset_shape",
            "suggested_action": None,
            "canvas_context_used": True,
            "recommended_preset_shape": shape_key,
            "recommended_fields": fields,
            "recommended_image_slots": [image_slot] if image_slot else [],
            "canvas_node_count": int(context.get("node_count") or len(nodes)),
        },
    )
