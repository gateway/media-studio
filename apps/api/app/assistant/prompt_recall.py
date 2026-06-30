from __future__ import annotations

import re
from typing import Any

from .. import store
from ..graph.schemas import GraphWorkflow


def is_full_prompt_request(text: str) -> bool:
    normalized = " ".join(str(text or "").lower().strip().split())
    if "prompt" not in normalized:
        return False
    if any(
        phrase in normalized
        for phrase in (
            "prompt from this image",
            "prompt from the image",
            "prompt from this reference",
            "prompt from the reference",
            "prompt from the attached image",
            "prompt from attached image",
            "prompt for this image",
            "prompt for the image",
            "prompt for this reference",
            "prompt for the reference",
            "prompt for the attached image",
            "prompt for attached image",
        )
    ):
        return False
    for term in ("apply", "update", "refine", "adjust", "change", "run it", "run again"):
        if term not in normalized:
            continue
        negated = re.search(
            rf"\b(?:do not|don't|dont|without|no)\b[^.?!]{{0,80}}\b{re.escape(term)}\b",
            normalized,
        )
        if not negated:
            return False
    return any(
        phrase in normalized
        for phrase in (
            "full prompt",
            "show me the prompt",
            "give me the prompt",
            "what prompt",
            "current prompt",
            "draft preset prompt",
            "prompt it created",
            "prompt you created",
            "prompt that you used",
            "prompt you used",
            "prompt used",
        )
    )


def _node_title_for_prompt_recall(node: Any) -> str:
    metadata = getattr(node, "metadata", None)
    if isinstance(metadata, dict):
        ui = metadata.get("ui") if isinstance(metadata.get("ui"), dict) else {}
        title = str(ui.get("customTitle") or "").strip()
        if title:
            return title
    return str(getattr(node, "type", "") or "Prompt").strip() or "Prompt"


def _prompt_text_from_workflow_node(node: Any) -> str:
    fields = getattr(node, "fields", None)
    if not isinstance(fields, dict):
        return ""
    if getattr(node, "type", "") == "prompt.text":
        return str(fields.get("text") or "").strip()
    for key in ("prompt", "prompt_template", "text", "system_prompt_template"):
        value = fields.get(key)
        if isinstance(value, str) and len(value.strip()) >= 120:
            return value.strip()
    return ""


def _preset_prompt_from_node(node: Any) -> str:
    if getattr(node, "type", "") != "preset.render":
        return ""
    fields = getattr(node, "fields", None)
    if not isinstance(fields, dict):
        return ""
    preset_id = str(fields.get("preset_id") or "").strip()
    preset_key = str(fields.get("preset_key") or fields.get("key") or "").strip()
    preset = store.get_preset(preset_id) if preset_id else None
    if not preset and preset_key:
        preset = store.get_preset_by_key(preset_key)
    if not preset:
        return ""
    return str(preset.get("prompt_template") or "").strip()


def _latest_prompt_from_workflow(workflow: GraphWorkflow | None) -> tuple[str, str]:
    if not workflow:
        return "", ""
    candidates: list[tuple[int, str, str]] = []
    for index, node in enumerate(workflow.nodes or []):
        title = _node_title_for_prompt_recall(node)
        prompt = _prompt_text_from_workflow_node(node)
        if prompt:
            priority = 30 if "draft preset prompt" in title.lower() else 20
            candidates.append((priority + index, title, prompt))
            continue
        preset_prompt = _preset_prompt_from_node(node)
        if preset_prompt:
            candidates.append((10 + index, title or "Saved Media Preset", preset_prompt))
    if not candidates:
        return "", ""
    _, title, prompt = sorted(candidates, key=lambda item: item[0], reverse=True)[0]
    return title, prompt


def prompt_recall_chat_reply(workflow: GraphWorkflow | None) -> tuple[str, dict[str, Any]]:
    title, prompt = _latest_prompt_from_workflow(workflow)
    if not prompt:
        return (
            "I do not see a generated prompt in the current graph yet. Create the graph first, then ask me again and I will paste the exact prompt here.",
            {"mode": "deterministic_prompt_recall", "prompt_found": False},
        )
    return (
        f"Here is the current graph prompt from `{title}`:\n\n```text\n{prompt}\n```",
        {
            "mode": "deterministic_prompt_recall",
            "prompt_found": True,
            "prompt_source": title,
            "prompt_chars": len(prompt),
        },
    )
