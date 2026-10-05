"""Conservative replies for successful typed terminal artifacts without prose."""
from __future__ import annotations
from typing import Any

def terminal_artifact_reply(kind: str | None, result: dict[str, Any]) -> str:
    if kind == "graph_proposal":
        summary = str(result.get("summary") or "").strip()
        if summary:
            return "Graph changes are prepared for review. " + summary
        operations = result.get("operations") or []
        if operations and all(item.get("op") in {"set_node_field", "set_node_title", "set_node_execution_mode"} for item in operations):
            return "The requested node changes are prepared for review."
        return "A graph proposal is prepared for review. Applying it remains a separate action."
    if kind in {"preset_draft", "recipe_draft"}:
        draft = result.get("draft") or {}
        name = str(draft.get("label") or draft.get("title") or "").strip()
        artifact = "Media Preset" if kind == "preset_draft" else "Prompt Recipe"
        return f"{artifact}{' ‘' + name + '’' if name else ''} draft prepared for review. This draft has not been saved."
    if kind == "recipe_continuation":
        return "A Prompt Recipe is needed before this graph can be prepared. Review the continuation choice."
    return ""
