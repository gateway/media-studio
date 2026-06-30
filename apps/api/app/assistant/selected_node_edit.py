from __future__ import annotations

import re
from typing import Any

from ..graph.schemas import GraphWorkflow
from .canvas_context import compact_canvas_context
from .schemas import AssistantGraphOperation, AssistantGraphPlan


GUARDED_ACTION_WARNING = "This only updates the selected node locally. It does not run, save, submit, upload, export, or call a provider."


def _normalized(value: str) -> str:
    return " ".join(str(value or "").strip().lower().split())


def _node_title(node: Any) -> str:
    metadata = getattr(node, "metadata", None)
    ui = metadata.get("ui") if isinstance(metadata, dict) else None
    custom_title = str(ui.get("customTitle") or "").strip() if isinstance(ui, dict) else ""
    return custom_title or str(getattr(node, "type", "") or getattr(node, "id", "")).strip()


def _is_character_sheet_recipe_node(node: Any) -> bool:
    if str(getattr(node, "type", "") or "") != "prompt.recipe":
        return False
    fields = getattr(node, "fields", {}) if isinstance(getattr(node, "fields", {}), dict) else {}
    field_keys = set(fields)
    character_sheet_markers = {"user_prompt", "character_name", "age", "variant_label", "background_mode"}
    if {"user_prompt", "character_name"}.issubset(field_keys):
        return True
    if len(character_sheet_markers.intersection(field_keys)) >= 3:
        return True
    title = _normalized(_node_title(node))
    return "character sheet" in title or "chr sheet" in title or "reference sheet" in title


def _is_storyboard_recipe_node(node: Any) -> bool:
    if str(getattr(node, "type", "") or "") != "prompt.recipe":
        return False
    fields = getattr(node, "fields", {}) if isinstance(getattr(node, "fields", {}), dict) else {}
    title = _normalized(_node_title(node))
    recipe_id = _normalized(str(fields.get("recipe_id") or fields.get("recipe_key") or ""))
    field_keys = set(fields)
    if "storyboard" in title or "storyboard" in recipe_id:
        return True
    return {"user_prompt", "previous_output", "shot_count"}.issubset(field_keys)


def _looks_like_character_sheet_creative_edit(message: str) -> bool:
    normalized = _normalized(message)
    if not normalized:
        return False
    if re.search(r"\b(?:what|why|how|show|share|give|list|print|recall|explain)\b", normalized) and "?" in normalized:
        return False
    if re.search(r"\b(?:storyboard|story board|seedance|seed dance|graph|workflow)\b", normalized):
        return False
    if re.search(r"\bnodes?\b", normalized) and not re.search(r"\b(?:selected|current|this)\s+node\b", normalized):
        return False
    if re.search(r"\b(?:run|save|submit|upload|export|delete|archive)\b", normalized) and not re.search(
        r"\b(?:do not|don't|dont|without|no)\b.{0,80}\b(?:run|save|submit|upload|export|delete|archive)\b",
        normalized,
    ):
        return False
    subject_context = re.search(
        r"\b(?:her|him|them|chr|character|person|subject|woman|female|man|male|outfit|clothing|wardrobe|look|style|pose|action|scene|background)\b",
        normalized,
    )
    edit_language = re.search(
        r"\b(?:want|try|update|make|create|build|design|turn|change|adjust|revise|replace|tighten|put|dress|give|have|wear|wearing|carry|carrying|hold|holding|doing|inspect|inspecting)\b",
        normalized,
    )
    return bool(subject_context and edit_language)


def _looks_like_storyboard_brief_edit(message: str) -> bool:
    normalized = _normalized(message)
    if not normalized:
        return False
    if re.search(r"\b(?:what|why|how|show|share|give|list|print|recall|explain)\b", normalized) and "?" in normalized:
        return False
    if re.search(r"\b(?:run|save|submit|upload|export|delete|archive)\b", normalized) and not re.search(
        r"\b(?:do not|don't|dont|without|no)\b.{0,80}\b(?:run|save|submit|upload|export|delete|archive)\b",
        normalized,
    ):
        return False
    subject_context = re.search(
        r"\b(?:story|storyboard|board|scene|shot|dialogue|dialog|character|woman|man|girl|guy|hero|subject|portal|dungeon|castle|escape|chase)\b",
        normalized,
    )
    edit_language = re.search(r"\b(?:want|try|update|make|turn|change|adjust|revise|replace|set|have|create)\b", normalized)
    return bool(subject_context and edit_language)


def _explicitly_targets_storyboard_brief(message: str) -> bool:
    normalized = _normalized(message)
    return bool(
        re.search(
            r"\b(?:story\s+brief|scene\s+brief|storyboard\s+brief|storyboard\s+prompt|board\s+prompt|storyboard\s+v2)\b",
            normalized,
        )
    )


def _looks_like_selected_edit(message: str) -> bool:
    normalized = _normalized(message)
    if not normalized:
        return False
    if re.search(r"\b(?:duplicate|copy|another|new)\b.{0,80}\b(?:branch|variant|version)\b", normalized):
        return False
    if re.search(r"\b(?:this|selected|current)\s+(?:branch|variant|version)\b", normalized):
        return False
    if re.search(r"\b(?:run|save|submit|upload|export|delete|archive)\b", normalized) and not re.search(
        r"\b(?:do not|don't|dont|without|no)\b.{0,60}\b(?:run|save|submit|upload|export|delete|archive)\b",
        normalized,
    ):
        return False
    graph_creation_request = re.search(r"\b(?:build|create|add|wire)\b.{0,80}\b(?:graph|workflow|storyboard|section|node)\b", normalized)
    graph_creation_negated = re.search(
        r"\b(?:do not|don't|dont|without|no)\b.{0,80}\b(?:build|create|add|wire)\b.{0,80}\b(?:graph|workflow|storyboard|section|node)\b",
        normalized,
    )
    if graph_creation_request and not graph_creation_negated:
        return False
    selected_target = (
        re.search(r"\b(?:selected|current|this)\s+node\b", normalized)
        or re.search(r"\bselected\b.{0,80}\b(?:prompt|user prompt|text|title|field|node)\b", normalized)
        or re.search(r"\b(?:selected|current|this)\b.{0,80}\b(?:story\s+brief|scene\s+brief|storyboard\s+brief|storyboard\s+prompt|board\s+prompt)\b", normalized)
        or re.search(r"\b(?:selected|current|this)\b.{0,80}\b(?:character\s+name|visible\s+name|printed\s+name|sheet\s+name|display\s+name|name\s+field)\b", normalized)
        or "user prompt" in normalized
    )
    edit_intent = re.search(r"\b(?:update|change|replace|set|rename|title|call|adjust|make|create|build|design|draft|turn)\b", normalized)
    creative_tweak = re.search(
        r"\b(?:wearing|wear|cyborg|space suit|spacesuit|futuristic|western|badass|sexy|style|outfit|"
        r"darker|haunted|moody|ominous|horror|fantasy|sci[- ]?fi|cinematic|dramatic|dangerous|"
        r"lighting|moonlight|shadow|shadows|storm|dungeon|castle|portal|escape|cowboy|marshal|"
        r"warrior|wizard|armor|armour|sleek|elegant|rugged|gritty|polished|production|reference|"
        r"widescreen|vertical|portrait|landscape|square|ultrawide|aspect|resolution|[124]k)\b",
        normalized,
    )
    return bool((selected_target and edit_intent) or creative_tweak)


def _has_explicit_selected_edit_target(message: str) -> bool:
    normalized = _normalized(message)
    return bool(
        re.search(r"\b(?:selected|current|this)\s+node\b", normalized)
        or re.search(r"\bselected\b.{0,80}\b(?:prompt|user prompt|text|title|field|node)\b", normalized)
        or re.search(r"\b(?:selected|current|this)\b.{0,80}\b(?:story\s+brief|scene\s+brief|storyboard\s+brief|storyboard\s+prompt|board\s+prompt)\b", normalized)
        or re.search(r"\b(?:selected|current|this)\b.{0,80}\b(?:character\s+name|visible\s+name|printed\s+name|sheet\s+name|display\s+name|name\s+field)\b", normalized)
        or re.search(r"\b(?:user\s+prompt|prompt\s+text|node\s+title)\b", normalized)
    )


def _selected_node(workflow: GraphWorkflow, canvas_context: dict[str, Any] | None) -> tuple[Any | None, AssistantGraphPlan | None]:
    context = compact_canvas_context(canvas_context)
    selected_ids = context.get("selected_node_ids") if isinstance(context, dict) and isinstance(context.get("selected_node_ids"), list) else []
    if len(selected_ids) != 1:
        question = (
            "Select one target node, then tell me the exact field change."
            if not selected_ids
            else "I see multiple selected nodes. Select one node, or name the exact node I should update."
        )
        return None, AssistantGraphPlan(
            summary="I need the target node before changing the canvas.",
            questions=[question],
            operations=[],
            warnings=[GUARDED_ACTION_WARNING],
            requires_confirmation=True,
            metadata={"template_id": "selected_node_field_edit_v1", "selection_required": True},
        )
    selected_id = str(selected_ids[0])
    node = next((item for item in workflow.nodes if item.id == selected_id), None)
    if node:
        return node, None
    return None, AssistantGraphPlan(
        summary="I could not find the selected node in the current workflow snapshot.",
        questions=["Reload the graph or reselect the node, then ask me again."],
        operations=[],
        warnings=[GUARDED_ACTION_WARNING],
        requires_confirmation=True,
        metadata={"template_id": "selected_node_field_edit_v1", "selection_missing_from_workflow": selected_id},
    )


def _strip_guard_phrasing(value: str) -> str:
    cleaned = str(value or "").strip()
    cleaned = re.split(
        r"(?:\b(?:do not|don't|dont|without)\b.{0,80}\b(?:run|save|submit|upload|export|delete|archive|provider|paid)\b|\bno\s+(?:run|save|submit|upload|export|delete|archive|provider|paid)\b).*$",
        cleaned,
        maxsplit=1,
        flags=re.IGNORECASE,
    )[0]
    cleaned = re.split(
        r"\bkeep\s+it\s+as\s+(?:the\s+)?(?:story\s+brief|scene\s+brief|storyboard\s+brief)\s+only\b.*$",
        cleaned,
        maxsplit=1,
        flags=re.IGNORECASE,
    )[0]
    cleaned = re.split(
        r"\bkeep\s+it\s+as\s+(?:the\s+)?(?:character[-\s]?sheet\s+)?(?:user\s+prompt|creative\s+brief|prompt)\s+only\b.*$",
        cleaned,
        maxsplit=1,
        flags=re.IGNORECASE,
    )[0]
    cleaned = re.split(
        r"\bkeep\s+this\s+as\s+(?:a\s+)?(?:compact\s+)?(?:character[-\s]sheet\s+)?(?:creative\s+)?brief\s+only\b.*$",
        cleaned,
        maxsplit=1,
        flags=re.IGNORECASE,
    )[0]
    cleaned = re.sub(r"\b(?:please|can you|could you)\b", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(
        r"^\s*(?:update|change|replace|set|adjust)\s+(?:only\s+)?(?:the\s+)?(?:selected|current|this)?\s*(?:node\s+)?(?:storyboard\s+v2\s+)?(?:user\s+prompt|prompt|text|field|story\s+brief|scene\s+brief|storyboard\s+brief|storyboard\s+prompt|board\s+prompt)\s*(?:to|with|as|:|=)?\s*",
        "",
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(
        r"^\s*(?:update|change|replace|set|adjust)\s+(?:only\s+)?(?:the\s+)?(?:selected|current|this)?\s*(?:node\s+)?(?:character\s+sheet\s+)?(?:user\s+prompt|prompt|field)\s*[\.;:=-]\s*",
        "",
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(r"\bchr\b", "character", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\bspace suite\b", "space suit", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"^\s*[:=]\s*", "", cleaned)
    cleaned = re.sub(r"^\s*(?:this|it)\s+", "", cleaned, flags=re.IGNORECASE)
    cleaned = " ".join(cleaned.strip(" \t\n\r\"'`").split())
    return cleaned


def _strip_character_sheet_creative_framing(value: str) -> str:
    cleaned = _strip_guard_phrasing(value)
    cleaned = re.sub(r"\bchr\b", "character", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\bgunslinder\b", "gunslinger", cleaned, flags=re.IGNORECASE)
    scaffold_match = re.search(
        r"\b(?:a\s+)?(?:compact\s+)?(?:creative\s+)?brief(?:\s+(?:only|for\s+(?:the\s+)?(?:sheet|character\s+sheet)))?\s*:\s*(?P<value>.+)$",
        cleaned,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if scaffold_match:
        cleaned = scaffold_match.group("value").strip()
    direction_match = re.search(
        r"\b(?:use\s+(?:this\s+)?direction|direction|creative\s+brief|brief)\s*:\s*(?P<value>.+)$",
        cleaned,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if direction_match:
        cleaned = direction_match.group("value").strip()
    cleaned = re.split(
        r"\b(?:update|change|set)\s+(?:the\s+)?(?:selected\s+)?(?:node\s+)?(?:field|user\s+prompt|prompt)\s+only\b.*$",
        cleaned,
        maxsplit=1,
        flags=re.IGNORECASE,
    )[0]
    cleaned = re.sub(
        r"^\s*(?:ok(?:ay)?\s+)?(?:let(?:'s|s)\s+)?(?:please\s+)?(?:try\s+to\s+|start\s+by\s+|go\s+ahead\s+and\s+)?",
        "",
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(r"^\s*(?:i\s+want(?:\s+to)?|i'd\s+like(?:\s+to)?|id\s+like(?:\s+to)?|can\s+we|could\s+we)\s+", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(
        r"^\s*(?:create|make|build|design|try|draft)\s+(?:a\s+|an\s+|the\s+)?(?:new\s+)?(?:character|character\s+sheet\s+character|character\s+sheet|reference\s+sheet)\s+(?:for|as|into|to\s+be|with)?\s*",
        "",
        cleaned,
        count=1,
        flags=re.IGNORECASE,
    )
    subject = r"(?:her|him|them|the\s+character|this\s+character|the\s+subject|this\s+subject|sadi)"
    replacements = [
        (rf"^\s*(?:create|make|turn|change|adjust|revise|replace)\s+{subject}\s+(?:as|into|to\s+be)\s+", ""),
        (rf"^\s*(?:create|make|turn|change|adjust|revise|replace)\s+{subject}\s+(?:a|an)\s+", ""),
        (rf"^\s*(?:change|adjust|revise|replace)\s+{subject}\s+(?:outfit|clothing|wardrobe|look|style)\s+(?:to|into|with|as)\s+", ""),
        (rf"^\s*(?:put|dress)\s+{subject}\s+(?:in|with)\s+", "the character wearing "),
        (rf"^\s*(?:give)\s+{subject}\s+", "the character with "),
        (rf"^\s*(?:have)\s+{subject}\s+", "the character "),
        (rf"^\s*(?:make|turn|change|adjust|revise|replace)\s+{subject}\s+", "the character "),
        (rf"^\s*{subject}\s+", "the character "),
    ]
    for pattern, replacement in replacements:
        next_cleaned = re.sub(pattern, replacement, cleaned, count=1, flags=re.IGNORECASE).strip()
        if next_cleaned != cleaned:
            cleaned = next_cleaned
            break
    cleaned = re.sub(r"^\s*(?:for|as|into|to\s+be|with)\s+", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"^\s*(?:a\s+)?new\s+", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(
        r"^\s*a\s+((?:adult|dark|sci[- ]?fi|cyber|western|fantasy|female|male|woman|man|rogue|ranger|warrior|wizard|cyborg|gunslinger)\b)",
        r"\1",
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" .?")
    return cleaned + "." if cleaned and cleaned[-1] not in ".!?" else cleaned


def _strip_generic_recipe_prompt_framing(value: str) -> str:
    cleaned = _strip_guard_phrasing(value)
    cleaned = re.sub(r"\bchr\b", "character", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\bgunslinder\b", "gunslinger", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(
        r"^\s*(?:ok(?:ay)?\s+)?(?:let(?:'s|s)\s+)?(?:please\s+)?(?:can\s+we|could\s+we|i\s+want(?:\s+to)?|i'd\s+like(?:\s+to)?|id\s+like(?:\s+to)?)\s+",
        "",
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(
        r"^\s*(?:update|change|replace|set|adjust)\s+(?:only\s+)?(?:the\s+)?(?:selected|current|this)?\s*(?:node\s+)?(?:recipe\s+)?(?:user\s+prompt|prompt|field)\s*(?:to|with|as|:|=)?\s*",
        "",
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(
        r"^\s*(?:create|make|build|design|draft)\s+(?:a\s+|an\s+|the\s+)?(?:user\s+prompt|prompt|brief|idea)\s+(?:for|as|with|about)?\s*",
        "",
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(
        r"^\s*(?:a\s+|an\s+|the\s+)?(?:user\s+prompt|prompt|brief|idea)\s+(?:for|as|with|about)\s+",
        "",
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = " ".join(cleaned.strip(" \t\n\r\"'`.:?").split())
    return cleaned + "." if cleaned and cleaned[-1] not in ".!?" else cleaned


def _strip_storyboard_brief_framing(value: str) -> str:
    cleaned = _strip_guard_phrasing(value)
    scaffold_match = re.search(
        r"\b(?:story\s+brief|scene\s+brief|storyboard\s+brief|storyboard\s+prompt|board\s+prompt|brief)\s*:\s*(?P<value>.+)$",
        cleaned,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if scaffold_match:
        cleaned = scaffold_match.group("value").strip()
    cleaned = re.sub(
        r"^\s*(?:ok(?:ay)?\s+)?(?:let(?:'s|s)\s+)?(?:please\s+)?(?:can\s+you\s+|could\s+you\s+)?(?:update|change|replace|set|adjust|make|create)\s+(?:the\s+)?(?:selected|current|this)?\s*(?:node\s+)?(?:storyboard\s+v2\s+)?(?:story\s+brief|scene\s+brief|storyboard\s+brief|storyboard\s+prompt|board\s+prompt|prompt|user\s+prompt)?\s*(?:to|with|as|:|=)?\s*",
        "",
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(r"\b(?:sadi|sadie)\b", "the character", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(
        r"\b(?:use\s+gpt\s+image\s+2|gpt\s+image\s+2|image[- ]to[- ]image|recipe|node|workflow|graph)\b",
        "",
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" .")
    return cleaned + "." if cleaned and cleaned[-1] not in ".!?" else cleaned


def _field_value_from_message(message: str) -> str:
    raw = str(message or "").strip()
    patterns = [
        r"(?:storyboard\s+v2\s+)?(?:story\s+brief|scene\s+brief|storyboard\s+brief|storyboard\s+prompt|board\s+prompt)\s*(?:(?:to|with|as)\s*:?\s*|[:=]\s*)(?P<value>.+)$",
        r"(?:user\s+prompt|prompt|text)\s*(?:(?:to|with|as)\s*:?\s*|[:=]\s*)(?P<value>.+)$",
        r"(?:make|turn|change|update|adjust)\s+(?P<value>(?:her|him|them|the character|this character|sadi).+)$",
        r"(?:can\s+we|could\s+we|let(?:'s|s))\s+(?:create|make|build|design|draft)\s+(?P<value>.+)$",
        r"(?:i\s+want|make|turn)\s+(?P<value>.+)$",
    ]
    for pattern in patterns:
        match = re.search(pattern, raw, flags=re.IGNORECASE | re.DOTALL)
        if match:
            value = _strip_guard_phrasing(match.group("value"))
            if value:
                return value
    return _strip_guard_phrasing(raw)


def _looks_like_character_sheet_name_field_edit(message: str) -> bool:
    normalized = _normalized(message)
    if not normalized:
        return False
    name_target = re.search(
        r"\b(?:character\s+name|visible\s+name|printed\s+name|print(?:ed)?\s+label|sheet\s+name|name\s+field|display\s+name)\b",
        normalized,
    )
    generic_target = re.search(
        r"\b(?:generic|internal|private|local)\b.{0,60}\b(?:name|label)\b|\b(?:name|label)\b.{0,60}\b(?:generic|internal|private|local)\b",
        normalized,
    )
    edit_intent = re.search(r"\b(?:set|update|change|replace|make|use|call|label)\b", normalized)
    return bool((name_target or generic_target) and edit_intent)


def _character_sheet_name_value_from_message(message: str) -> str:
    raw = str(message or "").strip()
    normalized = _normalized(raw)
    if re.search(r"\b(?:generic|internal|private|local|no\s+visible|without\s+(?:a\s+)?name|do\s+not\s+(?:show|print|display))\b", normalized):
        return "Character"
    patterns = [
        r"(?:character\s+name|visible\s+name|printed\s+name|display\s+name|sheet\s+name|name\s+field|print(?:ed)?\s+label|label)\s*(?:(?:to|as)\s*:?\s*|[:=]\s*)(?P<value>.+)$",
        r"(?:call|label)\s+(?:the\s+)?(?:selected|current|this)?\s*(?:character\s+sheet|sheet|node)?\s*(?:to|as)?\s*(?P<value>.+)$",
    ]
    for pattern in patterns:
        match = re.search(pattern, raw, flags=re.IGNORECASE | re.DOTALL)
        if not match:
            continue
        value = _strip_guard_phrasing(match.group("value"))
        value = re.split(r"\b(?:instead|so|because|for\s+storyboard)\b", value, maxsplit=1, flags=re.IGNORECASE)[0]
        value = " ".join(value.strip(" \t\n\r\"'`.:").split())
        if value:
            return value[:40]
    return "Character"


def _title_from_message(message: str) -> str:
    match = re.search(
        r"(?:rename|call|title)\s+(?:the\s+)?(?:selected|current|this)?\s*(?:node\s+)?(?:to|as)?\s*(?P<title>.+)$",
        str(message or ""),
        flags=re.IGNORECASE | re.DOTALL,
    )
    if not match:
        return ""
    title = _strip_guard_phrasing(match.group("title"))
    return title[:80].strip(" .")


def _model_settings_from_message(message: str, node: Any) -> dict[str, Any]:
    normalized = _normalized(message)
    if not str(getattr(node, "type", "") or "").startswith("model."):
        return {}
    fields = getattr(node, "fields", {}) if isinstance(getattr(node, "fields", {}), dict) else {}
    updates: dict[str, Any] = {}
    aspect_match = re.search(r"\b(1:1|16:9|9:16|4:3|3:4|21:9)\b", normalized)
    resolution_match = re.search(r"\b(1k|2k|4k|720p|1080p|2048x1152|1024x1024|1152x2048)\b", normalized)
    semantic_aspect = ""
    if any(term in normalized for term in ("widescreen", "wide screen", "landscape", "horizontal")):
        semantic_aspect = "16:9"
    elif any(term in normalized for term in ("vertical", "portrait", "phone", "mobile", "tall")):
        semantic_aspect = "9:16"
    elif "square" in normalized:
        semantic_aspect = "1:1"
    elif any(term in normalized for term in ("ultrawide", "ultra wide", "cinematic wide", "cinemascope")):
        semantic_aspect = "21:9"
    if aspect_match and ("aspect_ratio" in fields or "aspect" in normalized):
        updates["aspect_ratio"] = aspect_match.group(1)
    elif semantic_aspect and "aspect_ratio" in fields:
        updates["aspect_ratio"] = semantic_aspect
    if resolution_match and ("resolution" in fields or "resolution" in normalized or resolution_match.group(1).endswith("k")):
        resolution = resolution_match.group(1)
        updates["resolution"] = resolution.upper() if resolution.endswith("k") else resolution
    return updates


def _target_prompt_field(message: str, node: Any) -> str:
    node_type = str(getattr(node, "type", "") or "")
    fields = getattr(node, "fields", {}) if isinstance(getattr(node, "fields", {}), dict) else {}
    normalized = _normalized(message)
    if node_type == "prompt.recipe":
        if _is_character_sheet_recipe_node(node) and "character_name" in fields and _looks_like_character_sheet_name_field_edit(message):
            return "character_name"
        if "user_prompt" in fields or "user prompt" in normalized or "prompt" in normalized:
            return "user_prompt"
    if node_type == "prompt.text":
        return "text"
    if "prompt" in fields:
        return "prompt"
    if "text" in fields:
        return "text"
    return ""


def selected_node_field_edit_plan_from_context(
    message: str,
    workflow: GraphWorkflow,
    canvas_context: dict[str, Any] | None,
) -> AssistantGraphPlan | None:
    context = compact_canvas_context(canvas_context)
    selected_ids = context.get("selected_node_ids") if isinstance(context, dict) and isinstance(context.get("selected_node_ids"), list) else []
    selected_node = next((item for item in workflow.nodes if len(selected_ids) == 1 and item.id == str(selected_ids[0])), None)
    selected_character_sheet_creative_edit = bool(
        selected_node is not None
        and _is_character_sheet_recipe_node(selected_node)
        and _looks_like_character_sheet_creative_edit(message)
    )
    selected_storyboard_brief_edit = bool(
        selected_node is not None
        and _is_storyboard_recipe_node(selected_node)
        and _looks_like_storyboard_brief_edit(message)
    )
    if not _looks_like_selected_edit(message) and not selected_character_sheet_creative_edit and not selected_storyboard_brief_edit:
        return None
    if not selected_ids and not _has_explicit_selected_edit_target(message):
        return None
    node, blocked_plan = _selected_node(workflow, canvas_context)
    if blocked_plan:
        return blocked_plan
    if node is None:
        return None

    node_id = str(getattr(node, "id", "") or "").strip()
    title = _node_title(node)
    normalized = _normalized(message)
    if re.search(r"\b(?:rename|title|call)\b", normalized):
        next_title = _title_from_message(message)
        if not next_title:
            return AssistantGraphPlan(
                summary=f"I need the new title before renaming `{title}`.",
                questions=["What should I call the selected node?"],
                operations=[],
                warnings=[GUARDED_ACTION_WARNING],
                requires_confirmation=True,
                metadata={"template_id": "selected_node_title_edit_v1", "target_node_id": node_id},
            )
        return AssistantGraphPlan(
            summary=f"I renamed `{title}` to `{next_title}`.",
            operations=[AssistantGraphOperation(op="set_node_title", node_id=node_id, title=next_title)],
            warnings=[GUARDED_ACTION_WARNING],
            requires_confirmation=False,
            metadata={"template_id": "selected_node_title_edit_v1", "target_node_id": node_id, "target_title": next_title},
        )

    model_updates = _model_settings_from_message(message, node)
    if model_updates:
        changed = ", ".join(f"{key}={value}" for key, value in model_updates.items())
        return AssistantGraphPlan(
            summary=f"I updated `{title}` settings: {changed}.",
            operations=[AssistantGraphOperation(op="set_node_field", node_id=node_id, fields=model_updates)],
            warnings=[GUARDED_ACTION_WARNING],
            requires_confirmation=False,
            metadata={"template_id": "selected_model_settings_edit_v1", "target_node_id": node_id, "field_keys": sorted(model_updates)},
        )

    field_id = _target_prompt_field(message, node)
    if not field_id:
        return AssistantGraphPlan(
            summary=f"I need a supported editable field on `{title}` before changing it.",
            questions=["I can update selected Prompt Recipe `user_prompt`, Prompt Text `text`, model aspect/resolution, or the node title."],
            operations=[],
            warnings=[GUARDED_ACTION_WARNING],
            requires_confirmation=True,
            metadata={"template_id": "selected_node_field_edit_v1", "target_node_id": node_id, "unsupported_node_type": getattr(node, "type", "")},
        )

    explicit_prompt_assignment = re.search(
        r"(?:user\s+prompt|prompt|text)\s*(?:(?:to|with|as)\s*:?\s*|[:=]\s*)",
        str(message or ""),
        flags=re.IGNORECASE,
    )
    next_value = (
        _character_sheet_name_value_from_message(message)
        if _is_character_sheet_recipe_node(node) and field_id == "character_name"
        else _strip_character_sheet_creative_framing(message)
        if selected_character_sheet_creative_edit and field_id == "user_prompt" and not explicit_prompt_assignment
        else _strip_storyboard_brief_framing(message)
        if selected_storyboard_brief_edit and field_id == "user_prompt" and not explicit_prompt_assignment
        else _field_value_from_message(message)
    )
    has_character_sheet_scaffold = bool(
        re.search(r"\b(?:compact\s+)?(?:creative\s+)?brief\b.{0,80}:", next_value, flags=re.IGNORECASE)
        or re.search(
            r"\b(?:update|change|set)\s+(?:the\s+)?(?:selected\s+)?(?:node\s+)?(?:field|user\s+prompt|prompt)\s+only\b",
            next_value,
            flags=re.IGNORECASE,
        )
    )
    is_character_sheet_user_prompt = _is_character_sheet_recipe_node(node) and field_id == "user_prompt"
    if (
        is_character_sheet_user_prompt
        and next_value
        and not _explicitly_targets_storyboard_brief(message)
        and (not explicit_prompt_assignment or has_character_sheet_scaffold)
    ):
        next_value = _strip_character_sheet_creative_framing(next_value)
    if _is_storyboard_recipe_node(node) and field_id == "user_prompt" and next_value:
        next_value = _strip_storyboard_brief_framing(next_value)
    if (
        str(getattr(node, "type", "") or "") == "prompt.recipe"
        and field_id == "user_prompt"
        and next_value
        and not is_character_sheet_user_prompt
        and not _is_storyboard_recipe_node(node)
    ):
        next_value = _strip_generic_recipe_prompt_framing(next_value)
    if not next_value:
        return AssistantGraphPlan(
            summary=f"I need the new {field_id.replace('_', ' ')} before changing `{title}`.",
            questions=[f"What should the selected node's {field_id.replace('_', ' ')} be?"],
            operations=[],
            warnings=[GUARDED_ACTION_WARNING],
            requires_confirmation=True,
            metadata={"template_id": "selected_node_field_edit_v1", "target_node_id": node_id, "target_field": field_id},
        )
    return AssistantGraphPlan(
        summary=f"I updated `{title}` {field_id.replace('_', ' ')}.",
        operations=[AssistantGraphOperation(op="set_node_field", node_id=node_id, fields={field_id: next_value})],
        warnings=[GUARDED_ACTION_WARNING],
        requires_confirmation=False,
        metadata={"template_id": "selected_node_field_edit_v1", "target_node_id": node_id, "target_field": field_id},
    )
