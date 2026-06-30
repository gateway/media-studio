from __future__ import annotations

import re
from typing import Any

from .. import store
from ..graph.schemas import GraphWorkflow
from .canvas_context import compact_canvas_context
from .character_sheet_recipe import (
    CHARACTER_SHEET_TEMPLATE_ID,
    ROLE_BODY_SHAPE,
    ROLE_FACE_IDENTITY,
    ROLE_LABELS,
    ROLE_SCOPES,
    CharacterSheetReferenceRole,
    character_sheet_prompt_recipe_external_variables,
)
from .intent import is_graph_creation_negated
from .schemas import AssistantGraphOperation, AssistantGraphPlan
from .story_state import _story_brief_from_user_request


STORY_SEGMENT_TEMPLATE_ID = "story_seedance_segment_v1"
STORYBOARD_STILLS_TEMPLATE_ID = "story_gpt_image_2_storyboard_stills_v1"
STORYBOARD_V2_RECIPE_FALLBACK_ID = "prompt-recipe-storyboard-v2-gpt-image-2"
STORYBOARD_V2_RECIPE_KEYS = ("storyboard-v2-gpt-image-2", "storyboard_v2", "cinematic_3x2_storyboard_v2")
STORYBOARD_CONTINUATION_RECIPE_FALLBACK_ID = "prompt-recipe-storyboard-continuation-v1"
STORYBOARD_CONTINUATION_RECIPE_KEYS = ("storyboard-continuation-v1",)
STORY_COMBINE_TEMPLATE_ID = "story_clip_combine_v1"
STORY_COMBINE_GUARD_TEMPLATE_ID = "story_clip_combine_guard_v1"
CHARACTER_STORYBOARD_TEMPLATE_ID = "story_character_sheet_to_storyboard_v1"
STORY_LAYOUT_INPUT_X = 0
STORY_LAYOUT_MODEL_X = 620
STORY_LAYOUT_OUTPUT_X = 1240
STORY_LAYOUT_ROW_GAP = 520
STORYBOARD_SECTION_Y_GAP = 4800
SUPPORTED_STORYBOARD_PANEL_COUNTS = {4, 6, 9}
CHARACTER_STORYBOARD_LOAD_X = 0
CHARACTER_STORYBOARD_RECIPE_X = 460
CHARACTER_STORYBOARD_MODEL_X = 1040
CHARACTER_STORYBOARD_OUTPUT_X = 1640
CHARACTER_STORYBOARD_BOARD_RECIPE_X = 2240
CHARACTER_STORYBOARD_BOARD_MODEL_X = 2820
CHARACTER_STORYBOARD_BOARD_OUTPUT_X = 3420
GENERIC_STORY_CHARACTER_NAMES = {
    "character",
    "sheet",
    "storyboard",
    "story",
    "image",
    "gpt",
    "workflow",
}


def _normalized_text(value: Any) -> str:
    return " ".join(str(value or "").lower().split())


def _wants_story_graph(message: str) -> bool:
    text = _normalized_text(message)
    if is_graph_creation_negated(text):
        return False
    if _wants_storyboard_continuation_action(text):
        return True
    if not any(term in text for term in ("graph", "workflow", "add it", "add this", "wire", "nodes")):
        return False
    if any(term in text for term in ("do not build", "don't build", "dont build", "text only", "chat only")):
        return False
    return _has_story_graph_term(text)


def _has_story_graph_term(text: str) -> bool:
    return bool(
        re.search(
            r"\b(?:story|storyboards?|story boards?|segments?|seed dance|seedance|clips?|combine|stitch)\b",
            _normalized_text(text),
        )
    )


def _wants_storyboard_continuation_action(text: str) -> bool:
    normalized = _normalized_text(text)
    if is_graph_creation_negated(normalized):
        return False
    return bool(
        re.search(r"\bcontinue\b.{0,80}\b(?:storyboards?|story boards?|boards?|sections?)\b", normalized)
        or re.search(r"\b(?:storyboards?|story boards?|boards?|sections?)\b.{0,80}\bcontinue\b", normalized)
        or re.search(r"\b(?:next|another|follow[- ]?up|continuation)\b.{0,50}\b(?:storyboards?|story boards?|boards?|sections?)\b", normalized)
        or re.search(r"\b(?:storyboards?|story boards?|boards?|sections?)\b.{0,50}\b(?:next|another|follow[- ]?up|continuation)\b", normalized)
        or re.search(
            r"\b(?:add|create|make|build)\b.{0,80}\b(?:next|another|more|new|continuation|follow[- ]?up)\b.{0,80}\b(?:storyboards?|story boards?|boards?|sections?)\b",
            normalized,
        )
        or re.search(r"\b(?:add|create|make|build)\b.{0,50}\b(?:storyboards?|story boards?)\s*[2-9]\b", normalized)
    )


def _wants_clip_combine(message: str) -> bool:
    text = _normalized_text(message)
    return any(term in text for term in ("combine", "stitch", "join the clips", "clip assembly", "assemble the clips"))


def _wants_video_clip_graph(message: str) -> bool:
    text = _normalized_text(message)
    if any(
        term in text
        for term in (
            "stills only",
            "still images only",
            "storyboard stills only",
            "storyboard images only",
            "not seedance",
            "no seedance",
            "without seedance",
            "do not create seedance",
            "don't create seedance",
            "dont create seedance",
            "not video",
            "no video",
            "without video",
            "do not create video",
            "don't create video",
            "dont create video",
        )
    ):
        return False
    if _storyboard_stills_text_intent(text):
        return False
    return any(term in text for term in ("seed dance", "seedance", "video", "clip"))


def _story_segments(story_project: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        dict(segment)
        for segment in (story_project.get("story_segments") if isinstance(story_project.get("story_segments"), list) else [])
        if isinstance(segment, dict)
    ]


def _provider_safe_story_text(value: Any) -> str:
    text = str(value or "")
    return re.sub(r"\b(?:sadi|sadie)\b", "the character", text, flags=re.IGNORECASE)


def _latest_story_segment(story_project: dict[str, Any]) -> dict[str, Any] | None:
    segments = _story_segments(story_project)
    return segments[-1] if segments else None


def _shot_prompt_text(segment: dict[str, Any]) -> str:
    shots = [dict(shot) for shot in (segment.get("shots") if isinstance(segment.get("shots"), list) else []) if isinstance(shot, dict)]
    if not shots:
        return str(segment.get("continuity_notes") or segment.get("goal") or "").strip()
    lines = [
        f"{segment.get('title') or 'Storyboard segment'}",
        f"Duration budget: {segment.get('total_duration_seconds') or 'model default'} seconds.",
        "",
    ]
    for shot in shots:
        number = shot.get("shot_number") or len(lines)
        duration = shot.get("duration_seconds")
        prompt = _provider_safe_story_text(shot.get("prompt") or shot.get("story_beat") or "").strip()
        camera = str(shot.get("camera") or "").strip()
        motion = str(shot.get("motion") or "").strip()
        continuity = str(shot.get("continuity_notes") or "").strip()
        details = [value for value in (camera, motion, continuity) if value]
        suffix = f" {' '.join(details)}" if details else ""
        duration_text = f" ({duration}s)" if duration else ""
        lines.append(f"Shot {number}{duration_text}: {prompt}{suffix}".strip())
    return "\n".join(line for line in lines if line is not None).strip()


def _storyboard_still_prompt_text(story_project: dict[str, Any], segment: dict[str, Any]) -> str:
    characters = [
        str(character.get("name") or "").strip()
        for character in (story_project.get("characters") if isinstance(story_project.get("characters"), list) else [])
        if isinstance(character, dict)
        and str(character.get("name") or "").strip()
        and str(character.get("name") or "").strip().lower() not in {"sadi", "sadie", *GENERIC_STORY_CHARACTER_NAMES}
    ]
    style_terms = [
        str(term).strip()
        for term in (story_project.get("visual_style_terms") if isinstance(story_project.get("visual_style_terms"), list) else [])
        if str(term).strip()
    ]
    shots = [dict(shot) for shot in (segment.get("shots") if isinstance(segment.get("shots"), list) else []) if isinstance(shot, dict)]
    panel_count = _storyboard_panel_count(segment)
    lines = [f"Storyboard title: {segment.get('title') or 'Storyboard segment'}."]
    goal = _storyboard_clean_story_goal(segment)
    if goal:
        lines.append(f"Story / scene brief: {goal}.")
        lines.append(
            "Mandatory story beats, do not omit: "
            f"{goal}. If there are more beats than panels, combine nearby atmosphere or setup beats first; "
            "do not drop named actions, opponents, props, escape mechanics, ending beats, or dialogue preferences."
        )
        lines.append(
            "Quantity precision: preserve exact quantities from the user's story brief in the final panel ACTION/NOTES text; "
            "for example, two guards must remain two guards and must not be reduced to one guard."
        )
        normalized_goal = _normalized_text(goal)
        if any(term in normalized_goal for term in ("dialogue", "dialog", "speaks", "speak", "talks", "talk", "line", "says")) and not any(
            term in normalized_goal for term in ("no dialogue", "no dialog", "without dialogue", "without dialog", "wordless", "silent")
        ):
            lines.append(
                "Dialogue preference: sparse spoken lines are requested. Include at least one short in-character DIALOG value where it clarifies the beat; keep other DIALOG values blank."
            )
    if characters:
        lines.append(f"Characters: {', '.join(characters[:6])}.")
    if style_terms:
        lines.append(f"Style continuity: {', '.join(style_terms[:6])}.")
    lines.append(f"Panel count: {panel_count} panels.")
    lines.append("")
    for shot in shots:
        number = shot.get("shot_number") or len(lines)
        prompt = _provider_safe_story_text(shot.get("prompt") or shot.get("story_beat") or "").strip()
        camera = str(shot.get("camera") or "").strip()
        action = str(shot.get("action") or "").strip()
        continuity = str(shot.get("continuity_notes") or "").strip()
        details = [value for value in (camera, action, continuity) if value]
        suffix = f" {' '.join(details)}" if details else ""
        lines.append(f"Panel {number}: {prompt}{suffix}".strip())
    return "\n".join(lines).strip()


def _storyboard_panel_count(segment: dict[str, Any]) -> int:
    shots = [shot for shot in (segment.get("shots") if isinstance(segment.get("shots"), list) else []) if isinstance(shot, dict)]
    for value in (segment.get("shot_count"), len(shots) if shots else None):
        try:
            count = int(value)
        except (TypeError, ValueError):
            continue
        if count in SUPPORTED_STORYBOARD_PANEL_COUNTS:
            return count
    return 6


def _storyboard_clean_story_goal(segment: dict[str, Any]) -> str:
    goal = _provider_safe_story_text(_story_brief_from_user_request(str(segment.get("goal") or ""))).strip()
    normalized = _normalized_text(goal)
    graph_terms = (
        "gpt image",
        "image-to-image",
        "image to image",
        "storyboard continuation",
        "storyboard v2 recipe",
        "character sheet ref loader",
        "shared character sheet",
        "no seedance",
        "no video",
        "video nodes",
        "do not run",
        "do not save",
        "add the graph",
        "add the workflow",
        "workflow",
        "graph",
        "provider",
        "upload",
        "delete",
        "import",
        "export",
    )
    if goal and not any(term in normalized for term in graph_terms):
        return goal
    shots = [
        _provider_safe_story_text(shot.get("prompt") or shot.get("story_beat") or "").strip()
        for shot in (segment.get("shots") if isinstance(segment.get("shots"), list) else [])
        if isinstance(shot, dict)
    ]
    shot_goal = " ".join(shot for shot in shots if shot).strip()
    if shot_goal:
        return shot_goal
    return "the requested continuous storyboard arc"


def _storyboard_v2_recipe_id() -> str:
    for key in STORYBOARD_V2_RECIPE_KEYS:
        try:
            recipe = store.get_prompt_recipe_by_key(key)
        except Exception:
            recipe = None
        if recipe and str(recipe.get("status") or "active") == "active":
            recipe_id = str(recipe.get("recipe_id") or "").strip()
            if recipe_id:
                return recipe_id
    return STORYBOARD_V2_RECIPE_FALLBACK_ID


def _storyboard_continuation_recipe_id() -> str:
    for key in STORYBOARD_CONTINUATION_RECIPE_KEYS:
        try:
            recipe = store.get_prompt_recipe_by_key(key)
        except Exception:
            recipe = None
        if recipe and str(recipe.get("status") or "active") == "active":
            recipe_id = str(recipe.get("recipe_id") or "").strip()
            if recipe_id:
                return recipe_id
    return STORYBOARD_CONTINUATION_RECIPE_FALLBACK_ID


def _character_sheet_v1_recipe_id() -> str:
    try:
        recipe = store.get_prompt_recipe_by_key(CHARACTER_SHEET_TEMPLATE_ID)
    except Exception:
        recipe = None
    if recipe and str(recipe.get("status") or "active") == "active":
        recipe_id = str(recipe.get("recipe_id") or "").strip()
        if recipe_id:
            return recipe_id
    return CHARACTER_SHEET_TEMPLATE_ID


def _storyboard_style_direction(story_project: dict[str, Any]) -> str:
    style_terms = [
        str(term).strip()
        for term in (story_project.get("visual_style_terms") if isinstance(story_project.get("visual_style_terms"), list) else [])
        if str(term).strip()
    ]
    if style_terms:
        return ", ".join(style_terms[:8])
    return "cinematic production storyboard, consistent character continuity"


def _storyboard_previous_handoff(segment: dict[str, Any]) -> str:
    previous = str(segment.get("previous_segment_handoff") or "").strip()
    if previous:
        return previous
    try:
        sequence_index = int(segment.get("sequence_index") or 1)
    except (TypeError, ValueError):
        sequence_index = 1
    if sequence_index > 1:
        handoff = str(segment.get("handoff") or "").strip()
        if handoff:
            return handoff
    return "No previous board handoff provided."


def _storyboard_request_focus(message: str) -> str:
    source = str(message or "").strip()
    patterns = (
        r"\b(?:where|as|with|about)\s+(?P<value>.+)$",
        r"\b(?:next|another|new|follow[- ]?up|continuation)\s+(?:storyboard|story board|board|section)\s+(?P<value>.+)$",
    )
    for pattern in patterns:
        match = re.search(pattern, source, flags=re.IGNORECASE | re.DOTALL)
        if not match:
            continue
        value = _story_brief_from_user_request(match.group("value")).strip()
        if value:
            return value
    return ""


def _storyboard_section_focus(offset: int, section_count: int) -> str:
    if section_count <= 1:
        return "focused continuation beat"
    if offset == 0:
        return "opening setup and inciting action for this requested arc"
    if offset == section_count - 1:
        return "payoff, reveal, or handoff image that makes the next creative choice clear"
    if section_count == 3 and offset == 1:
        return "escalation, complication, and decisive mid-sequence action"
    return "next distinct escalation beat in the continuous story"


def _storyboard_spatial_pacing_guidance(offset: int, section_count: int) -> str:
    if section_count <= 1:
        return (
            "Spatial continuity: every panel must show how the character moves from the previous location or state "
            "to the next; do not jump from a locked door, restraint, or obstacle to a solved escape without showing "
            "the discovery, path, tool, or action that caused the change."
        )
    if offset == 0:
        return (
            "Opening-board pacing: establish the place, threat, confinement, and first attempted solution. Do not resolve "
            "the main escape, final portal, destination reveal, or final payoff on this board unless the user explicitly "
            "asked this board to finish the whole story."
        )
    if offset == section_count - 1:
        return (
            "Final-board pacing: pay off the prior boards by showing the earned route to escape or resolution. The final "
            "location change must follow visibly from the previous board's ending, not appear as a sudden teleport."
        )
    return (
        "Middle-board pacing: show the causal bridge between setup and payoff. Focus on the tool, discovery, fight, chase, "
        "unlocking action, or route that explains how the character moves from trapped/problem state toward the final board."
    )


def _storyboard_previous_output_for_section(segment: dict[str, Any], storyboard_number: int, offset: int) -> str:
    if offset <= 0:
        if storyboard_number > 1:
            handoff = str(segment.get("handoff") or "").strip()
            if handoff:
                return handoff
        return _storyboard_previous_handoff(segment)
    return (
        f"Continue from Storyboard {storyboard_number - 1}: preserve the same character sheet, wardrobe, "
        "lighting logic, location continuity, and final-beat direction from the previous board in this requested set."
    )


def _storyboard_section_prompt_text(
    base_prompt: str,
    *,
    message_focus: str,
    section_brief: str,
    storyboard_number: int,
    first_storyboard_number: int,
    section_count: int,
    offset: int,
) -> str:
    if section_brief and section_count > 1:
        lines = _storyboard_segment_specific_prompt_lines(base_prompt, section_brief, storyboard_number)
    else:
        lines = [base_prompt.strip()]
    if message_focus:
        lines.append(f"Requested continuation beat: {message_focus}.")
    if section_brief:
        lines.extend(
            [
                "",
                f"Required segment story beat: {section_brief}.",
                "Preserve this specific segment beat; do not replace it with a generic fantasy journey, ally-gathering, or unrelated battle sequence.",
            ]
        )
    if section_count > 1:
        last_storyboard_number = first_storyboard_number + section_count - 1
        lines.extend(
            [
                "",
                "Multi-board story planning:",
                f"This is Storyboard {storyboard_number} of {last_storyboard_number}, segment {offset + 1} of {section_count} in one continuous arc.",
                "Treat this board as roughly one compact 15-second visual segment if the approved stills are later adapted into motion.",
                f"Segment focus: {_storyboard_section_focus(offset, section_count)}.",
                _storyboard_spatial_pacing_guidance(offset, section_count),
                "Start from the previous board's final state when there is one, then end with a clear visual handoff into the next board.",
                "Do not repeat the same six beats across boards; advance the story with a distinct location, action, obstacle, reveal, or emotional turn.",
            ]
        )
    elif storyboard_number > 1:
        lines.extend(
            [
                "",
                "Continuation planning:",
                "Treat this as the next board in the existing storyboard sequence. Start from the prior board's ending and advance one clear story beat.",
                "End with a visual handoff that makes the following board easy to plan.",
            ]
        )
    return "\n".join(line for line in lines if line is not None).strip()


def _storyboard_segment_specific_prompt_lines(base_prompt: str, section_brief: str, storyboard_number: int) -> list[str]:
    clean_brief = _provider_safe_story_text(section_brief).strip(" .:-")
    lines = [
        f"Storyboard title: Storyboard Segment {storyboard_number}.",
        f"Story / scene brief: {clean_brief}.",
        (
            "Mandatory story beats, do not omit: "
            f"{clean_brief}. If there are more beats than panels, combine nearby atmosphere or setup beats first; "
            "do not drop named actions, opponents, props, escape mechanics, ending beats, or dialogue preferences."
        ),
    ]
    base_lines = [line.strip() for line in str(base_prompt or "").splitlines() if line.strip()]
    copied_prefixes = (
        "Quantity precision:",
        "Dialogue preference:",
        "Characters:",
        "Style continuity:",
        "Panel count:",
    )
    copied: set[str] = set()
    for line in base_lines:
        if not line.startswith(copied_prefixes):
            continue
        prefix = line.split(":", 1)[0]
        if prefix in copied:
            continue
        copied.add(prefix)
        lines.append(line)
    if "Panel count" not in copied:
        lines.append("Panel count: 6 panels.")
    return lines


def _storyboard_message_section_briefs(message: str, section_count: int) -> list[str]:
    source = str(message or "").strip()
    if not source or section_count <= 0:
        return []
    briefs: dict[int, str] = {}
    pattern = re.compile(
        r"\b(?:storyboard|story board|board|segment)\s*(?P<number>[1-9])\s*(?::|\bshould\b\s*|(?=\b(?:establishes|establish|shows|show|pays|pay|continues|continue)\b))(?P<value>.*?)(?=\b(?:storyboard|story board|board|segment)\s*[1-9]\s*(?::|\bshould\b\s*|(?=\b(?:establishes|establish|shows|show|pays|pay|continues|continue)\b))|$)",
        flags=re.IGNORECASE | re.DOTALL,
    )
    for match in pattern.finditer(source):
        try:
            number = int(match.group("number"))
        except (TypeError, ValueError):
            continue
        if number < 1 or number > section_count:
            continue
        value = _provider_safe_story_text(match.group("value")).strip()
        stop_match = re.search(
            r"\b(?:use\s+one\s+shared|use\s+the\s+reusable|no\s+seedance|no\s+video|do\s+not|don't|dont|build\s+this|add\s+the\s+graph|add\s+the\s+workflow)\b",
            value,
            flags=re.IGNORECASE,
        )
        if stop_match:
            value = value[: stop_match.start()]
        value = " ".join(value.strip(" .:-").split())
        if value:
            briefs[number] = value
    return [briefs.get(index, "") for index in range(1, section_count + 1)]


def _storyboard_dialogue_mode(*values: str) -> str:
    text = _normalized_text(" ".join(value for value in values if value))
    if any(term in text for term in ("no dialogue", "no dialog", "without dialogue", "without dialog", "wordless", "silent")):
        return "none"
    if any(term in text for term in ("exact dialogue", "quoted dialogue", "user specified dialogue", "user-specified dialogue")):
        return "user_specified"
    if any(term in text for term in ("full dialogue", "full dialog", "dialogue heavy", "lots of dialogue", "lots of dialog")):
        return "full"
    if any(term in text for term in ("medium dialogue", "medium dialog", "cinematic dialogue", "cinematic dialog")):
        return "cinematic"
    if any(term in text for term in ("dialogue", "dialog", "speaks", "speak", "talks", "talk", "line", "says")):
        return "light"
    return "light"


def _storyboard_continuation_fields(
    *,
    segment: dict[str, Any],
    section_prompt: str,
    previous_output: str,
    storyboard_number: int,
    first_storyboard_number: int,
    section_count: int,
    message_focus: str,
    story_project: dict[str, Any],
) -> dict[str, Any]:
    last_storyboard_number = first_storyboard_number + max(section_count, 1) - 1
    continuation_brief = section_prompt.strip()
    previous_prompt = previous_output.strip()
    if storyboard_number > first_storyboard_number:
        previous_prompt = (
            f"{previous_output.strip()}\n"
            f"The prior board was part of the same requested multi-board arc. Continue without repeating its setup."
        ).strip()
    return {
        "recipe_id": _storyboard_continuation_recipe_id(),
        "recipe_category": "image",
        "previous_storyboard_prompt": previous_prompt,
        "continuation_brief": continuation_brief,
        "segment_number": str(storyboard_number),
        "total_segments": str(last_storyboard_number),
        "target_duration_seconds": "15",
        "panel_count": str(_storyboard_panel_count(segment)),
        "dialogue_mode": _storyboard_dialogue_mode(section_prompt, previous_output),
        "style_direction": _storyboard_style_direction(story_project),
        "provider": "openrouter",
        "model_id": "openai/gpt-4o-mini",
        "provider_supports_images": True,
    }


def _workflow_node_title(node: Any) -> str:
    metadata = getattr(node, "metadata", None)
    metadata = metadata if isinstance(metadata, dict) else {}
    ui = metadata.get("ui") if isinstance(metadata.get("ui"), dict) else {}
    return str(ui.get("customTitle") or getattr(node, "type", "") or getattr(node, "id", "")).strip()


def _canvas_storyboard_number_candidates(workflow: GraphWorkflow, canvas_context: dict[str, Any] | None) -> list[int]:
    values: list[str] = []
    context = compact_canvas_context(canvas_context)
    if context:
        for node in context.get("nodes") if isinstance(context.get("nodes"), list) else []:
            if isinstance(node, dict):
                values.append(str(node.get("title") or ""))
        for group in context.get("groups") if isinstance(context.get("groups"), list) else []:
            if isinstance(group, dict):
                values.append(str(group.get("title") or ""))
    for node in workflow.nodes:
        values.append(_workflow_node_title(node))
    groups = workflow.metadata.get("groups") if isinstance(workflow.metadata, dict) else []
    for group in groups if isinstance(groups, list) else []:
        if isinstance(group, dict):
            values.append(str(group.get("title") or ""))
    numbers: list[int] = []
    for value in values:
        normalized = _normalized_text(value)
        for match in re.finditer(r"story\s*board\s*(\d+)|storyboard\s*(\d+)", normalized):
            number = match.group(1) or match.group(2)
            if number:
                numbers.append(int(number))
    return numbers


def _storyboard_model_node_id_for_number(workflow: GraphWorkflow, canvas_context: dict[str, Any] | None, storyboard_number: int) -> str:
    title_patterns = (
        f"storyboard {storyboard_number} gpt",
        f"storyboard {storyboard_number} model",
        f"story board {storyboard_number} gpt",
        f"story board {storyboard_number} model",
    )
    context = compact_canvas_context(canvas_context)
    if context:
        for node in context.get("nodes") if isinstance(context.get("nodes"), list) else []:
            if not isinstance(node, dict):
                continue
            node_type = _normalized_text(node.get("type"))
            title = _normalized_text(node.get("title"))
            if "gpt_image" not in node_type and "gpt image" not in title:
                continue
            if any(pattern in title for pattern in title_patterns):
                return str(node.get("id") or "").strip()
    for node in workflow.nodes:
        node_type = _normalized_text(getattr(node, "type", ""))
        title = _normalized_text(_workflow_node_title(node))
        if "gpt_image" not in node_type and "gpt image" not in title:
            continue
        if any(pattern in title for pattern in title_patterns):
            return str(getattr(node, "id", "") or "").strip()
    return ""


def _storyboard_prompt_node_id_for_number(workflow: GraphWorkflow, canvas_context: dict[str, Any] | None, storyboard_number: int) -> str:
    title_patterns = (
        f"storyboard {storyboard_number} recipe",
        f"storyboard {storyboard_number} continuation",
        f"storyboard {storyboard_number} prompt",
        f"story board {storyboard_number} recipe",
        f"story board {storyboard_number} continuation",
        f"story board {storyboard_number} prompt",
    )
    context = compact_canvas_context(canvas_context)
    if context:
        for node in context.get("nodes") if isinstance(context.get("nodes"), list) else []:
            if not isinstance(node, dict):
                continue
            node_type = _normalized_text(node.get("type"))
            title = _normalized_text(node.get("title"))
            if "prompt.recipe" not in node_type and "recipe" not in title and "continuation" not in title:
                continue
            if any(pattern in title for pattern in title_patterns):
                return str(node.get("id") or "").strip()
    for node in workflow.nodes:
        node_type = _normalized_text(getattr(node, "type", ""))
        title = _normalized_text(_workflow_node_title(node))
        if "prompt.recipe" not in node_type and "recipe" not in title and "continuation" not in title:
            continue
        if any(pattern in title for pattern in title_patterns):
            return str(getattr(node, "id", "") or "").strip()
    return ""


def _next_storyboard_number(workflow: GraphWorkflow, canvas_context: dict[str, Any] | None) -> int:
    numbers = _canvas_storyboard_number_candidates(workflow, canvas_context)
    return max(numbers, default=0) + 1


def _requested_storyboard_section_count(message: str) -> int:
    text = _normalized_text(message)
    word_numbers = {
        "one": 1,
        "two": 2,
        "three": 3,
        "four": 4,
    }
    for word, count in word_numbers.items():
        if f"{word} more storyboard" in text or f"next {word} storyboard" in text or f"add {word} storyboard" in text:
            return count
        if re.search(rf"\b(?:exactly\s+)?{word}\s+(?:connected\s+|separate\s+|new\s+)?(?:storyboard|story board)", text):
            return count
        if re.search(rf"\b(?:exactly\s+)?{word}\s+(?:connected|separate|new|more)\b.{{0,100}}\b(?:storyboard|story board)", text):
            return count
        if "storyboard" in text and re.search(rf"\b(?:exactly\s+)?{word}\s+(?:connected\s+|separate\s+|new\s+)?(?:sections?|chapters?|parts?)\b", text):
            return count
        if "storyboard" in text and re.search(rf"\b(?:exactly\s+)?{word}\s+(?:connected|separate|new|more)\b.{{0,100}}\b(?:sections?|chapters?|parts?)\b", text):
            return count
    match = re.search(r"\b([1-4])\s+(?:more\s+|next\s+)?storyboards?\b", text)
    if match:
        return int(match.group(1))
    match = re.search(r"\b(?:add|create|make)\s+([1-4])\s+(?:more\s+)?storyboards?\b", text)
    if match:
        return int(match.group(1))
    match = re.search(r"\b(?:exactly\s+)?([1-4])\s+(?:connected\s+|separate\s+|new\s+)?(?:storyboard|story board)", text)
    if match:
        return int(match.group(1))
    match = re.search(r"\b(?:exactly\s+)?([1-4])\s+(?:connected|separate|new|more)\b.{0,100}\b(?:storyboard|story board)", text)
    if match:
        return int(match.group(1))
    match = re.search(r"\b(?:exactly\s+)?([1-4])\s+(?:connected\s+|separate\s+|new\s+)?(?:sections?|chapters?|parts?)\b", text)
    if match and "storyboard" in text:
        return int(match.group(1))
    match = re.search(r"\b(?:exactly\s+)?([1-4])\s+(?:connected|separate|new|more)\b.{0,100}\b(?:sections?|chapters?|parts?)\b", text)
    if match and "storyboard" in text:
        return int(match.group(1))
    return 1


def _canvas_character_sheet_candidates(workflow: GraphWorkflow, canvas_context: dict[str, Any] | None) -> list[dict[str, Any]]:
    context = compact_canvas_context(canvas_context)
    selected_ids = set(context.get("selected_node_ids") if isinstance(context, dict) and isinstance(context.get("selected_node_ids"), list) else [])
    canvas_by_id: dict[str, dict[str, Any]] = {}
    if context:
        for node in context.get("nodes") if isinstance(context.get("nodes"), list) else []:
            if isinstance(node, dict) and str(node.get("id") or "").strip():
                canvas_by_id[str(node["id"])] = node
    load_image_nodes = [node for node in workflow.nodes if node.type == "media.load_image"]
    candidates: list[dict[str, Any]] = []
    for node in load_image_nodes:
        canvas_node = canvas_by_id.get(node.id, {})
        title = str(canvas_node.get("title") or _workflow_node_title(node))
        normalized = _normalized_text(title)
        score = 0
        if "character sheet" in normalized:
            score += 6
        if "character" in normalized:
            score += 3
        if "sheet" in normalized:
            score += 2
        if "reference" in normalized or " ref" in f" {normalized}":
            score += 2
        if node.id in selected_ids:
            score += 3
        media_refs = canvas_node.get("media_refs") if isinstance(canvas_node.get("media_refs"), list) else []
        if media_refs:
            score += 1
        has_direct_media_field = bool(
            str(node.fields.get("asset_id") or node.fields.get("media_asset_id") or node.fields.get("reference_id") or "").strip()
        )
        if len(load_image_nodes) == 1 and (media_refs or has_direct_media_field):
            score += 4
        if score >= 5:
            candidates.append({"node_id": node.id, "title": title or node.id, "score": score})
    candidates.sort(key=lambda item: (-int(item["score"]), str(item["title"])))
    return candidates


def _canvas_character_sheet_anchor(workflow: GraphWorkflow, canvas_context: dict[str, Any] | None) -> tuple[dict[str, Any] | None, str]:
    candidates = _canvas_character_sheet_candidates(workflow, canvas_context)
    if not candidates:
        return None, "missing"
    if len(candidates) > 1 and candidates[0]["score"] == candidates[1]["score"]:
        return None, "ambiguous"
    return candidates[0], "found"


def _approved_character_sheet_fields(story_project: dict[str, Any]) -> dict[str, str]:
    sheet = story_project.get("approved_character_sheet") if isinstance(story_project.get("approved_character_sheet"), dict) else {}
    reference_id = str(sheet.get("reference_id") or "").strip()
    asset_id = str(sheet.get("asset_id") or "").strip()
    if reference_id:
        return {"reference_id": reference_id}
    if asset_id:
        return {"asset_id": asset_id}
    return {}


def _storyboard_stills_text_intent(text: str) -> bool:
    normalized = _normalized_text(text)
    return any(
        term in normalized
        for term in (
            "gpt image 2",
            "gpt 2 image",
            "gpt-image-2",
            "image-to-image",
            "image to image",
            "image still",
            "image-still",
            "stills only",
            "still images",
            "storyboard still",
            "storyboard image",
            "storyboard sheet",
        )
    ) and any(term in normalized for term in ("storyboard", "story board", "scene sheet", "shot sheet", "stills"))


def _wants_storyboard_stills_graph(message: str, story_project: dict[str, Any]) -> bool:
    text = _normalized_text(message)
    if is_graph_creation_negated(text):
        return False
    explicit_stills = _storyboard_stills_text_intent(text) or "character sheet" in text
    continuation_action = _wants_storyboard_continuation_action(text)
    if _wants_clip_combine(message) or (_wants_video_clip_graph(message) and not explicit_stills):
        return False
    if not any(term in text for term in ("graph", "workflow", "add it", "add this", "wire", "nodes")) and not continuation_action:
        return False
    output_preferences = story_project.get("output_preferences") if isinstance(story_project.get("output_preferences"), dict) else {}
    implied_stills = output_preferences.get("graph_output_intent") == "storyboard_stills" and any(
        term in text for term in ("storyboard", "that", "this", "it", "graph", "workflow")
    )
    return bool(_latest_story_segment(story_project) and (explicit_stills or implied_stills or continuation_action))


def _seedance_duration(segment: dict[str, Any]) -> tuple[int, list[str]]:
    try:
        duration = int(segment.get("total_duration_seconds") or 5)
    except (TypeError, ValueError):
        duration = 5
    if duration in {5, 10}:
        return duration, []
    return 5, [
        "The storyboard duration stays in the prompt notes. The Seedance node uses a safe existing duration value until you choose final run settings."
    ]


def _wants_character_sheet_to_storyboard_graph(message: str) -> bool:
    text = _normalized_text(message)
    if is_graph_creation_negated(text):
        return False
    if not any(term in text for term in ("character sheet", "chr sheet", "character reference sheet", "reference sheet")):
        return False
    if re.search(r"\b(?:current|existing|approved)\s+(?:character|chr)\s+sheet\b", text):
        return False
    if not any(term in text for term in ("storyboard", "story board", "storyboard recipe", "board recipe")):
        return False
    if "approved character sheet" in text and not re.search(r"\b(?:character|chr)\s+sheet\b.{0,50}\bfirst\b", text):
        return False
    creates_character_sheet = bool(
        re.search(r"\b(?:build|create|make|add|have)\b.{0,100}\b(?:character|chr)\s+sheet\b", text)
        or re.search(r"\b(?:character|chr)\s+sheet\b.{0,50}\bfirst\b", text)
    )
    if not creates_character_sheet:
        return False
    return any(term in text for term in ("graph", "workflow", "build", "create", "make", "add", "wire", "nodes"))


def _first_labeled_section(message: str, labels: tuple[str, ...], stop_labels: tuple[str, ...]) -> str:
    source = str(message or "")
    label_pattern = "|".join(re.escape(label) for label in labels)
    stop_pattern = "|".join(re.escape(label) for label in stop_labels)
    match = re.search(
        rf"(?:{label_pattern})\s*[:\-]\s*(?P<value>.*?)(?=(?:{stop_pattern})\s*[:\-]|$)",
        source,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if not match:
        return ""
    return " ".join(match.group("value").split()).strip(" .:-")


def _character_storyboard_character_name(message: str, story_project: dict[str, Any]) -> str:
    explicit = re.search(r"\b(?:named|called|title(?:d)?)\s+([A-Z][A-Za-z0-9_-]{1,40})\b", str(message or ""))
    if explicit and explicit.group(1).lower() not in GENERIC_STORY_CHARACTER_NAMES:
        return explicit.group(1)
    private_name = re.search(r"\b(sadi|sadie)\b", str(message or ""), flags=re.IGNORECASE)
    if private_name:
        return "Sadie" if private_name.group(1).lower() == "sadie" else "Sadi"
    for character in story_project.get("characters") if isinstance(story_project.get("characters"), list) else []:
        if isinstance(character, dict):
            name = str(character.get("name") or "").strip()
            if name and name.lower() not in GENERIC_STORY_CHARACTER_NAMES:
                return name
    return "Character"


def _character_storyboard_character_brief(message: str, character_name: str) -> str:
    labeled = _first_labeled_section(
        message,
        (
            "character user prompt",
            "character prompt",
            "character brief",
            "character sheet brief",
            "chr sheet brief",
            "look",
            "character look",
        ),
        ("storyboard story brief", "story brief", "storyboard brief", "scene brief", "story", "board brief"),
    )
    if labeled:
        cleaned = re.split(
            r"\bthen\s+(?:build|create|make)\b.{0,120}\b(?:storyboard|story board)\b",
            labeled,
            maxsplit=1,
            flags=re.IGNORECASE,
        )[0]
        return cleaned.strip(" .:-") or labeled
    return (
        "Create the lead character as a production-ready design for the requested storyboard. "
        "Use the face reference only for identity, the body reference only for body shape and proportions, "
        "and derive wardrobe, world, mood, and adventure styling from the story brief."
    )


def _image_attachments(attachments: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    return [
        attachment
        for attachment in attachments or []
        if str(attachment.get("reference_id") or "").strip()
        and str(attachment.get("kind") or "image").lower() == "image"
    ]


def _attachment_label(attachment: dict[str, Any]) -> str:
    return str(attachment.get("label") or attachment.get("original_filename") or attachment.get("reference_id") or "").strip()


def _attachment_role_from_text(message: str, label: str) -> str:
    normalized = _normalized_text(message)
    normalized_label = _normalized_text(label)
    candidates = [normalized_label]
    if "." in normalized_label:
        candidates.append(normalized_label.rsplit(".", 1)[0])
    for candidate in [value for value in candidates if value]:
        index = normalized.find(candidate)
        if index < 0:
            continue
        window = normalized[max(0, index - 120) : index + len(candidate) + 120]
        if any(term in window for term in ("face", "identity", "id lock", "identity lock")):
            return ROLE_FACE_IDENTITY
        if any(term in window for term in ("body", "shape", "body lock", "shape lock", "proportions")):
            return ROLE_BODY_SHAPE
    return ""


def _attachment_role_from_label(label: str) -> str:
    normalized = _normalized_text(label)
    if any(term in normalized for term in ("face", "identity", "headshot", "portrait")):
        return ROLE_FACE_IDENTITY
    if any(term in normalized for term in ("body", "shape", "front", "full body", "full-body", "pose")):
        return ROLE_BODY_SHAPE
    return ""


def _character_storyboard_reference_fields(
    message: str,
    attachments: list[dict[str, Any]] | None,
) -> tuple[dict[str, str], dict[str, str], list[str]]:
    face: dict[str, str] = {}
    body: dict[str, str] = {}
    warnings: list[str] = []
    for attachment in _image_attachments(attachments):
        reference_id = str(attachment.get("reference_id") or "").strip()
        label = _attachment_label(attachment)
        role = _attachment_role_from_label(label) or _attachment_role_from_text(message, label)
        if role == ROLE_FACE_IDENTITY and not face:
            face = {"reference_id": reference_id}
        elif role == ROLE_BODY_SHAPE and not body:
            body = {"reference_id": reference_id}
    if not face:
        warnings.append("Choose the face / identity reference before running.")
    if not body:
        warnings.append("Choose the body / shape reference before running.")
    return face, body, warnings


def _character_sheet_placeholder_roles(character_model_ref: str = "character-sheet-model") -> list[CharacterSheetReferenceRole]:
    return [
        CharacterSheetReferenceRole(
            reference_number=1,
            source_node_id="character-face-ref",
            source_port="image",
            target_node_id=character_model_ref,
            target_port="image_refs",
            role_key=ROLE_FACE_IDENTITY,
            role_label=ROLE_LABELS[ROLE_FACE_IDENTITY],
            scope=ROLE_SCOPES[ROLE_FACE_IDENTITY],
            confidence="high",
            needs_clarification=False,
            evidence=("assistant_placeholder:face_identity",),
        ),
        CharacterSheetReferenceRole(
            reference_number=2,
            source_node_id="character-body-ref",
            source_port="image",
            target_node_id=character_model_ref,
            target_port="image_refs",
            role_key=ROLE_BODY_SHAPE,
            role_label=ROLE_LABELS[ROLE_BODY_SHAPE],
            scope=ROLE_SCOPES[ROLE_BODY_SHAPE],
            confidence="high",
            needs_clarification=False,
            evidence=("assistant_placeholder:body_shape",),
        ),
    ]


def _character_sheet_to_storyboard_plan(
    story_project: dict[str, Any],
    workflow: GraphWorkflow,
    *,
    message: str,
    attachments: list[dict[str, Any]] | None = None,
    canvas_context: dict[str, Any] | None = None,
) -> AssistantGraphPlan:
    segment = _latest_story_segment(story_project)
    if not segment:
        return AssistantGraphPlan(
            summary="I need a story brief before I can build the Character Sheet to Storyboard workflow.",
            questions=["Tell me the character direction and the storyboard story beat, then ask me to build the graph."],
            operations=[],
            warnings=[],
            requires_confirmation=True,
            metadata={"template_id": STORYBOARD_STILLS_TEMPLATE_ID, "subtemplate_id": CHARACTER_STORYBOARD_TEMPLATE_ID, "missing_story_segment": True},
        )

    character_name = _character_storyboard_character_name(message, story_project)
    character_brief = _character_storyboard_character_brief(message, character_name)
    character_recipe_prompt = character_brief
    if character_name != "Character" and character_name.lower() not in character_brief.lower():
        character_recipe_prompt = f"Character name: {character_name}. {character_brief}".strip()
    roles = _character_sheet_placeholder_roles()
    external_variables = character_sheet_prompt_recipe_external_variables(roles, background_mode="cinematic_dark_ui")
    storyboard_number = _next_storyboard_number(workflow, canvas_context)
    story_prompt = _storyboard_still_prompt_text(story_project, segment)
    if character_brief:
        story_prompt = (
            f"{story_prompt}\n"
            "Character Sheet visual continuity: preserve the connected generated character sheet's face identity, body shape, "
            f"wardrobe, amulet, weapons, silhouette, palette, and genre styling. Character design brief: {character_brief}."
        ).strip()
    character_recipe_id = _character_sheet_v1_recipe_id()
    storyboard_recipe_id = _storyboard_v2_recipe_id()
    character_title_prefix = "" if character_name == "Character" else f"{character_name} "
    character_sheet_label = "Character Sheet" if character_name == "Character" else f"{character_name} Character Sheet"
    face_fields, body_fields, reference_warnings = _character_storyboard_reference_fields(message, attachments)
    has_bound_refs = bool(face_fields and body_fields)
    operations: list[AssistantGraphOperation] = [
        AssistantGraphOperation(
            op="add_note",
            node_ref="character-storyboard-overview",
            title="Character To Storyboard Plan",
            position={"x": CHARACTER_STORYBOARD_LOAD_X, "y": -260},
            body=(
                (
                    "1. Face and body refs are bound from the assistant reference tray.\n"
                    if has_bound_refs
                    else "1. Pick the face and body refs in the two Load Image nodes.\n"
                )
                + "2. Run Character Sheet v1 to make the continuity sheet.\n"
                "3. Run Storyboard v2 with face ref + generated character sheet.\n"
                "No Seedance or video nodes are included in this still-storyboard workflow."
            ),
        ),
        AssistantGraphOperation(
            op="add_node",
            node_ref="character-face-ref",
            node_type="media.load_image",
            title=f"{character_title_prefix}Face / Identity Ref",
            position={"x": CHARACTER_STORYBOARD_LOAD_X, "y": 120},
            fields=face_fields,
        ),
        AssistantGraphOperation(
            op="add_node",
            node_ref="character-body-ref",
            node_type="media.load_image",
            title=f"{character_title_prefix}Body / Shape Ref",
            position={"x": CHARACTER_STORYBOARD_LOAD_X, "y": 520},
            fields=body_fields,
        ),
        AssistantGraphOperation(
            op="add_node",
            node_ref="character-sheet-recipe",
            node_type="prompt.recipe",
            title="Character Sheet v1 Recipe",
            position={"x": CHARACTER_STORYBOARD_RECIPE_X, "y": 180},
            fields={
                "recipe_id": character_recipe_id,
                "recipe_category": "image",
                "user_prompt": character_recipe_prompt,
                "character_name": character_name,
                "age": "26",
                "variant_label": "Storyboard Source",
                "background_mode": "cinematic_dark_ui",
                "external_variables_json": external_variables,
                "provider": "openrouter",
                "model_id": "openai/gpt-4o-mini",
                "provider_supports_images": True,
            },
        ),
        AssistantGraphOperation(
            op="add_node",
            node_ref="character-sheet-model",
            node_type="model.kie.gpt_image_2_image_to_image",
            title=f"{character_title_prefix}Character Sheet GPT Image 2",
            position={"x": CHARACTER_STORYBOARD_MODEL_X, "y": 220},
            fields={"aspect_ratio": "16:9", "resolution": "2K"},
        ),
        AssistantGraphOperation(
            op="add_node",
            node_ref="character-sheet-preview",
            node_type="preview.image",
            title=f"{character_title_prefix}Character Sheet Preview",
            position={"x": CHARACTER_STORYBOARD_OUTPUT_X, "y": 80},
            fields={},
        ),
        AssistantGraphOperation(
            op="add_node",
            node_ref="character-sheet-save",
            node_type="media.save_image",
            title=f"{character_title_prefix}Character Sheet Save",
            position={"x": CHARACTER_STORYBOARD_OUTPUT_X, "y": 660},
            fields={
                "filename_prefix": "character-sheet-storyboard-source",
                "label": character_sheet_label,
            },
        ),
        AssistantGraphOperation(
            op="add_node",
            node_ref="storyboard-recipe",
            node_type="prompt.recipe",
            title=f"Storyboard {storyboard_number} v2 Recipe",
            position={"x": CHARACTER_STORYBOARD_BOARD_RECIPE_X, "y": 180},
            fields={
                "recipe_id": storyboard_recipe_id,
                "recipe_category": "image",
                "user_prompt": story_prompt,
                "previous_output": _storyboard_previous_handoff(segment),
                "style_direction": _storyboard_style_direction(story_project),
                "shot_count": str(_storyboard_panel_count(segment)),
                "aspect_ratio": "16:9",
                "dialogue_mode": _storyboard_dialogue_mode(story_prompt, message),
                "provider": "openrouter",
                "model_id": "openai/gpt-4o-mini",
                "provider_supports_images": True,
            },
        ),
        AssistantGraphOperation(
            op="add_node",
            node_ref="storyboard-model",
            node_type="model.kie.gpt_image_2_image_to_image",
            title=f"Storyboard {storyboard_number} GPT Image 2",
            position={"x": CHARACTER_STORYBOARD_BOARD_MODEL_X, "y": 220},
            fields={"aspect_ratio": "16:9", "resolution": "2K"},
        ),
        AssistantGraphOperation(
            op="add_node",
            node_ref="storyboard-preview",
            node_type="preview.image",
            title=f"Storyboard {storyboard_number} Preview",
            position={"x": CHARACTER_STORYBOARD_BOARD_OUTPUT_X, "y": 80},
            fields={},
        ),
        AssistantGraphOperation(
            op="add_node",
            node_ref="storyboard-save",
            node_type="media.save_image",
            title=f"Storyboard {storyboard_number} Save",
            position={"x": CHARACTER_STORYBOARD_BOARD_OUTPUT_X, "y": 660},
            fields={"filename_prefix": f"storyboard-{storyboard_number}", "label": f"Storyboard {storyboard_number} stills sheet"},
        ),
        AssistantGraphOperation(op="connect_nodes", source_ref="character-face-ref", source_port="image", target_ref="character-sheet-recipe", target_port="image_refs"),
        AssistantGraphOperation(op="connect_nodes", source_ref="character-body-ref", source_port="image", target_ref="character-sheet-recipe", target_port="image_refs"),
        AssistantGraphOperation(op="connect_nodes", source_ref="character-face-ref", source_port="image", target_ref="character-sheet-model", target_port="image_refs"),
        AssistantGraphOperation(op="connect_nodes", source_ref="character-body-ref", source_port="image", target_ref="character-sheet-model", target_port="image_refs"),
        AssistantGraphOperation(op="connect_nodes", source_ref="character-sheet-recipe", source_port="text", target_ref="character-sheet-model", target_port="prompt"),
        AssistantGraphOperation(op="connect_nodes", source_ref="character-sheet-model", source_port="image", target_ref="character-sheet-preview", target_port="image"),
        AssistantGraphOperation(op="connect_nodes", source_ref="character-sheet-model", source_port="image", target_ref="character-sheet-save", target_port="image"),
        AssistantGraphOperation(op="connect_nodes", source_ref="character-face-ref", source_port="image", target_ref="storyboard-recipe", target_port="image_refs"),
        AssistantGraphOperation(op="connect_nodes", source_ref="character-sheet-model", source_port="image", target_ref="storyboard-recipe", target_port="image_refs"),
        AssistantGraphOperation(op="connect_nodes", source_ref="character-face-ref", source_port="image", target_ref="storyboard-model", target_port="image_refs"),
        AssistantGraphOperation(op="connect_nodes", source_ref="character-sheet-model", source_port="image", target_ref="storyboard-model", target_port="image_refs"),
        AssistantGraphOperation(op="connect_nodes", source_ref="storyboard-recipe", source_port="text", target_ref="storyboard-model", target_port="prompt"),
        AssistantGraphOperation(op="connect_nodes", source_ref="storyboard-model", source_port="image", target_ref="storyboard-preview", target_port="image"),
        AssistantGraphOperation(op="connect_nodes", source_ref="storyboard-model", source_port="image", target_ref="storyboard-save", target_port="image"),
        AssistantGraphOperation(
            op="group_nodes",
            group_ref="character-sheet-source",
            title=f"{character_sheet_label} Source",
            color="purple",
            node_refs=[
                "character-storyboard-overview",
                "character-face-ref",
                "character-body-ref",
                "character-sheet-recipe",
                "character-sheet-model",
                "character-sheet-preview",
                "character-sheet-save",
            ],
        ),
        AssistantGraphOperation(
            op="group_nodes",
            group_ref=f"storyboard-{storyboard_number}",
            title=f"Storyboard {storyboard_number}",
            color="blue",
            node_refs=["storyboard-recipe", "storyboard-model", "storyboard-preview", "storyboard-save"],
        ),
    ]
    return AssistantGraphPlan(
        summary=(
            f"I made a two-stage workflow: Character Sheet v1 first, then Storyboard {storyboard_number} with the Storyboard v2 recipe. "
            + (
                "The attached face and body references are already bound; review the prompts, then run the graph when ready."
                if has_bound_refs
                else "Choose the face and body refs, review the prompts, then run the graph when ready."
            )
        ),
        questions=[],
        operations=operations,
        warnings=reference_warnings,
        requires_confirmation=True,
        metadata={
            "template_id": STORYBOARD_STILLS_TEMPLATE_ID,
            "subtemplate_id": CHARACTER_STORYBOARD_TEMPLATE_ID,
            "story_project": True,
            "uses_seedance": False,
            "created_character_sheet_branch": True,
            "character_sheet_recipe_id": character_recipe_id,
            "storyboard_v2_recipe_id": storyboard_recipe_id,
            "storyboard_numbers": [storyboard_number],
            "required_reference_roles": [ROLE_FACE_IDENTITY, ROLE_BODY_SHAPE],
            "bound_reference_ids": {
                "face_identity": face_fields.get("reference_id"),
                "body_shape": body_fields.get("reference_id"),
            },
            "base_node_count": len(workflow.nodes),
        },
    )


def _story_segment_plan(story_project: dict[str, Any], workflow: GraphWorkflow) -> AssistantGraphPlan:
    segment = _latest_story_segment(story_project)
    if not segment:
        return AssistantGraphPlan(
            summary="I need an approved storyboard segment before I can build the story graph.",
            questions=["Create or approve a storyboard segment first, then ask me to build the graph."],
            operations=[],
            warnings=[],
            requires_confirmation=True,
            metadata={"template_id": STORY_SEGMENT_TEMPLATE_ID, "story_project": True, "missing_story_segment": True},
        )
    prompt_text = _shot_prompt_text(segment)
    duration, warnings = _seedance_duration(segment)
    operation_refs = ["story-note", "story-prompt", "story-seedance", "story-preview", "story-save"]
    operations = [
        AssistantGraphOperation(
            op="add_note",
            node_ref="story-note",
            title="Story Segment Notes",
            position={"x": STORY_LAYOUT_INPUT_X, "y": -260},
            body=(
                f"{segment.get('title') or 'Story segment'}\n"
                f"Shot count: {_storyboard_panel_count(segment)}\n"
                f"Continuity handoff: {segment.get('previous_segment_handoff') or segment.get('handoff') or 'Use current story continuity.'}"
            ),
        ),
        AssistantGraphOperation(
            op="add_node",
            node_ref="story-prompt",
            node_type="prompt.text",
            title="Story Segment Prompt",
            position={"x": STORY_LAYOUT_INPUT_X, "y": 220},
            fields={"mode": "replace", "text": prompt_text},
        ),
        AssistantGraphOperation(
            op="add_node",
            node_ref="story-seedance",
            node_type="model.kie.seedance_2_0",
            title="Seedance Story Clip",
            position={"x": STORY_LAYOUT_MODEL_X, "y": 120},
            fields={"duration": duration, "resolution": "720p", "aspect_ratio": "16:9", "generate_audio": False},
        ),
        AssistantGraphOperation(
            op="add_node",
            node_ref="story-preview",
            node_type="preview.video",
            title="Preview Story Clip",
            position={"x": STORY_LAYOUT_OUTPUT_X, "y": 40},
            fields={},
        ),
        AssistantGraphOperation(
            op="add_node",
            node_ref="story-save",
            node_type="media.save_video",
            title="Save Story Clip",
            position={"x": STORY_LAYOUT_OUTPUT_X, "y": 620},
            fields={"filename_prefix": "story-segment", "format": "source_original", "label": "Story segment clip"},
        ),
        AssistantGraphOperation(op="connect_nodes", source_ref="story-prompt", source_port="text", target_ref="story-seedance", target_port="prompt"),
        AssistantGraphOperation(op="connect_nodes", source_ref="story-seedance", source_port="video", target_ref="story-preview", target_port="video"),
        AssistantGraphOperation(op="connect_nodes", source_ref="story-seedance", source_port="video", target_ref="story-save", target_port="video"),
        AssistantGraphOperation(
            op="group_nodes",
            group_ref="story-segment",
            title="Story Segment Review",
            color="purple",
            node_refs=operation_refs,
        ),
    ]
    return AssistantGraphPlan(
        summary="I made a Seed Dance story graph from the latest storyboard segment. Review the choices, adjust anything you want, then run it when ready.",
        questions=[],
        operations=operations,
        warnings=warnings,
        requires_confirmation=True,
        metadata={
            "template_id": STORY_SEGMENT_TEMPLATE_ID,
            "story_project": True,
            "segment_id": segment.get("segment_id"),
            "story_shot_count": segment.get("shot_count"),
            "base_node_count": len(workflow.nodes),
        },
    )


def _storyboard_stills_plan(
    story_project: dict[str, Any],
    workflow: GraphWorkflow,
    *,
    message: str = "",
    canvas_context: dict[str, Any] | None = None,
) -> AssistantGraphPlan:
    segment = _latest_story_segment(story_project)
    if not segment:
        return AssistantGraphPlan(
            summary="I need an approved storyboard scene list before I can build the storyboard stills graph.",
            questions=["Create or approve the storyboard first, then ask me to build the GPT Image 2 graph."],
            operations=[],
            warnings=[],
            requires_confirmation=True,
            metadata={"template_id": STORYBOARD_STILLS_TEMPLATE_ID, "story_project": True, "missing_story_segment": True},
        )
    first_storyboard_number = _next_storyboard_number(workflow, canvas_context)
    section_count = _requested_storyboard_section_count(message)
    prompt_text = _storyboard_still_prompt_text(story_project, segment)
    message_focus = _storyboard_request_focus(message) if _wants_storyboard_continuation_action(message) else ""
    section_briefs = _storyboard_message_section_briefs(message, section_count)
    sheet_fields = _approved_character_sheet_fields(story_project)
    anchor, anchor_status = _canvas_character_sheet_anchor(workflow, canvas_context)
    if canvas_context and anchor_status == "ambiguous":
        return AssistantGraphPlan(
            summary="I found more than one possible character sheet on the canvas.",
            questions=["Which image node should anchor the next storyboard sections?"],
            operations=[],
            warnings=[],
            requires_confirmation=True,
            metadata={"template_id": STORYBOARD_STILLS_TEMPLATE_ID, "story_project": True, "ambiguous_character_sheet_anchor": True},
        )
    if canvas_context and anchor_status == "missing" and workflow.nodes:
        return AssistantGraphPlan(
            summary="I need one clear character sheet image node before I add storyboard sections.",
            questions=["Select or rename the character sheet image node, then ask me to create the storyboard sections again."],
            operations=[],
            warnings=[],
            requires_confirmation=True,
            metadata={"template_id": STORYBOARD_STILLS_TEMPLATE_ID, "story_project": True, "missing_character_sheet_anchor": True},
        )

    operations: list[AssistantGraphOperation] = []
    warnings = [] if (anchor or sheet_fields) else ["Attach or select the approved character sheet in the loader before running this graph."]
    created_storyboard_numbers: list[int] = []
    shared_loader_ref = "storyboard-character-sheet"
    shared_loader_title = "Character Sheet Ref"
    if not anchor:
        operations.append(
            AssistantGraphOperation(
                op="add_node",
                node_ref=shared_loader_ref,
                node_type="media.load_image",
                title=shared_loader_title,
                position={"x": STORY_LAYOUT_INPUT_X, "y": 120},
                fields=sheet_fields,
            )
        )
    for offset in range(section_count):
        storyboard_number = first_storyboard_number + offset
        created_storyboard_numbers.append(storyboard_number)
        node_prefix = f"storyboard-{storyboard_number}"
        y_offset = offset * STORYBOARD_SECTION_Y_GAP
        section_prompt = _storyboard_section_prompt_text(
            prompt_text,
            message_focus=message_focus,
            section_brief=section_briefs[offset] if offset < len(section_briefs) else "",
            storyboard_number=storyboard_number,
            first_storyboard_number=first_storyboard_number,
            section_count=section_count,
            offset=offset,
        )
        previous_output = _storyboard_previous_output_for_section(segment, storyboard_number, offset)
        uses_continuation_recipe = storyboard_number > 1
        prompt_node_title = f"Storyboard {storyboard_number} Continuation" if uses_continuation_recipe else f"Storyboard {storyboard_number} Recipe"
        prompt_node_fields = (
            _storyboard_continuation_fields(
                segment=segment,
                section_prompt=section_prompt,
                previous_output=previous_output,
                storyboard_number=storyboard_number,
                first_storyboard_number=first_storyboard_number,
                section_count=section_count,
                message_focus=message_focus,
                story_project=story_project,
            )
            if uses_continuation_recipe
            else {
                "recipe_id": _storyboard_v2_recipe_id(),
                "recipe_category": "image",
                "user_prompt": section_prompt,
                "previous_output": previous_output,
                "style_direction": _storyboard_style_direction(story_project),
                "shot_count": str(segment.get("shot_count") or len(segment.get("shots") or []) or 6),
                "aspect_ratio": "16:9",
                "dialogue_mode": _storyboard_dialogue_mode(section_prompt, previous_output, message),
                "provider": "openrouter",
                "model_id": "openai/gpt-4o-mini",
                "provider_supports_images": True,
            }
        )
        previous_storyboard_ref = f"storyboard-{storyboard_number - 1}-model" if offset > 0 and uses_continuation_recipe else ""
        previous_storyboard_prompt_ref = f"storyboard-{storyboard_number - 1}-prompt" if offset > 0 and uses_continuation_recipe else ""
        previous_storyboard_node_id = (
            _storyboard_model_node_id_for_number(workflow, canvas_context, storyboard_number - 1)
            if uses_continuation_recipe and not previous_storyboard_ref
            else ""
        )
        previous_storyboard_prompt_node_id = (
            _storyboard_prompt_node_id_for_number(workflow, canvas_context, storyboard_number - 1)
            if uses_continuation_recipe and not previous_storyboard_prompt_ref
            else ""
        )
        operation_refs = [f"{node_prefix}-note", f"{node_prefix}-prompt", f"{node_prefix}-model", f"{node_prefix}-preview", f"{node_prefix}-save"]
        operations.append(
            AssistantGraphOperation(
                op="add_note",
                node_ref=f"{node_prefix}-note",
                title=f"Storyboard {storyboard_number} Notes",
                position={"x": STORY_LAYOUT_INPUT_X, "y": -300 + y_offset},
                body=(
                f"GPT Image 2 storyboard stills for Storyboard {storyboard_number}.\n"
                f"Shot count: {segment.get('shot_count') or 'unknown'}\n"
                    f"Character anchor: {(anchor or {}).get('title') or shared_loader_title}\n"
                    "Seedance is intentionally not included here; use it after storyboard stills are approved."
                ),
            )
        )
        operations.extend(
            [
                AssistantGraphOperation(
                    op="add_node",
                    node_ref=f"{node_prefix}-prompt",
                    node_type="prompt.recipe",
                    title=prompt_node_title,
                    position={"x": STORY_LAYOUT_INPUT_X, "y": 680 + y_offset},
                    fields=prompt_node_fields,
                ),
                AssistantGraphOperation(
                    op="add_node",
                    node_ref=f"{node_prefix}-model",
                    node_type="model.kie.gpt_image_2_image_to_image",
                    title=f"Storyboard {storyboard_number} GPT Image 2",
                    position={"x": STORY_LAYOUT_MODEL_X, "y": 360 + y_offset},
                    fields={"aspect_ratio": "16:9", "resolution": "2K"},
                ),
                AssistantGraphOperation(
                    op="add_node",
                    node_ref=f"{node_prefix}-preview",
                    node_type="preview.image",
                    title=f"Storyboard {storyboard_number} Preview",
                    position={"x": STORY_LAYOUT_OUTPUT_X, "y": 180 + y_offset},
                    fields={},
                ),
                AssistantGraphOperation(
                    op="add_node",
                    node_ref=f"{node_prefix}-save",
                    node_type="media.save_image",
                    title=f"Storyboard {storyboard_number} Save",
                    position={"x": STORY_LAYOUT_OUTPUT_X, "y": 720 + y_offset},
                    fields={"filename_prefix": f"storyboard-{storyboard_number}", "label": f"Storyboard {storyboard_number} stills sheet"},
                ),
            ]
        )
        if anchor:
            operations.append(
                AssistantGraphOperation(
                    op="connect_nodes",
                    node_id=anchor["node_id"],
                    source_port="image",
                    target_ref=f"{node_prefix}-model",
                    target_port="image_refs",
                )
            )
            operations.append(
                AssistantGraphOperation(
                    op="connect_nodes",
                    node_id=anchor["node_id"],
                    source_port="image",
                    target_ref=f"{node_prefix}-prompt",
                    target_port="image_refs",
                )
            )
        else:
            operations.append(
                AssistantGraphOperation(
                    op="connect_nodes",
                    source_ref=shared_loader_ref,
                    source_port="image",
                    target_ref=f"{node_prefix}-model",
                    target_port="image_refs",
                )
            )
            operations.append(
                AssistantGraphOperation(
                    op="connect_nodes",
                    source_ref=shared_loader_ref,
                    source_port="image",
                    target_ref=f"{node_prefix}-prompt",
                    target_port="image_refs",
                )
            )
        operations.extend(
            [
                AssistantGraphOperation(op="connect_nodes", source_ref=f"{node_prefix}-prompt", source_port="text", target_ref=f"{node_prefix}-model", target_port="prompt"),
                AssistantGraphOperation(op="connect_nodes", source_ref=f"{node_prefix}-model", source_port="image", target_ref=f"{node_prefix}-preview", target_port="image"),
                AssistantGraphOperation(op="connect_nodes", source_ref=f"{node_prefix}-model", source_port="image", target_ref=f"{node_prefix}-save", target_port="image"),
                AssistantGraphOperation(
                    op="group_nodes",
                    group_ref=f"storyboard-{storyboard_number}",
                    title=f"Storyboard {storyboard_number}",
                    color="blue",
                    node_refs=operation_refs,
                ),
            ]
        )
        if previous_storyboard_ref:
            operations.append(
                AssistantGraphOperation(
                    op="connect_nodes",
                    source_ref=previous_storyboard_ref,
                    source_port="image",
                    target_ref=f"{node_prefix}-prompt",
                    target_port="image_refs",
                )
            )
            operations.append(
                AssistantGraphOperation(
                    op="connect_nodes",
                    source_ref=previous_storyboard_ref,
                    source_port="image",
                    target_ref=f"{node_prefix}-model",
                    target_port="image_refs",
                )
            )
            operations.append(
                AssistantGraphOperation(
                    op="connect_nodes",
                    source_ref=previous_storyboard_prompt_ref,
                    source_port="text",
                    target_ref=f"{node_prefix}-prompt",
                    target_port="previous_storyboard_prompt",
                )
            )
        elif previous_storyboard_node_id:
            operations.append(
                AssistantGraphOperation(
                    op="connect_nodes",
                    node_id=previous_storyboard_node_id,
                    source_port="image",
                    target_ref=f"{node_prefix}-prompt",
                    target_port="image_refs",
                )
            )
            if previous_storyboard_prompt_node_id:
                operations.append(
                    AssistantGraphOperation(
                        op="connect_nodes",
                        node_id=previous_storyboard_prompt_node_id,
                        source_port="text",
                        target_ref=f"{node_prefix}-prompt",
                        target_port="previous_storyboard_prompt",
                    )
                )
            operations.append(
                AssistantGraphOperation(
                    op="connect_nodes",
                    node_id=previous_storyboard_node_id,
                    source_port="image",
                    target_ref=f"{node_prefix}-model",
                    target_port="image_refs",
                )
            )
    storyboard_list = ", ".join(f"Storyboard {number}" for number in created_storyboard_numbers)
    if any(number > 1 for number in created_storyboard_numbers):
        summary = (
            f"I made {storyboard_list} as continuation storyboard sections. "
            "They keep the same character sheet, carry the prior-board handoff forward, and stay local until you choose to run them."
        )
    else:
        summary = f"I made {storyboard_list} with GPT Image 2 image-to-image. Review the prompt nodes, adjust the story beats if needed, then run them when you are ready."
    return AssistantGraphPlan(
        summary=summary,
        questions=[],
        operations=operations,
        warnings=warnings,
        requires_confirmation=True,
        metadata={
            "template_id": STORYBOARD_STILLS_TEMPLATE_ID,
            "story_project": True,
            "segment_id": segment.get("segment_id"),
            "story_shot_count": segment.get("shot_count"),
            "uses_seedance": False,
            "storyboard_numbers": created_storyboard_numbers,
            "character_sheet_anchor_node_id": (anchor or {}).get("node_id"),
            "character_sheet_anchor_title": (anchor or {}).get("title"),
            "created_character_sheet_loader": None if anchor else shared_loader_ref,
            "multi_board_pacing": section_count > 1,
            "base_node_count": len(workflow.nodes),
        },
    )


def _approved_video_outputs(story_project: dict[str, Any]) -> list[dict[str, str]]:
    approved: list[dict[str, str]] = []
    for segment in _story_segments(story_project):
        outputs = segment.get("approved_outputs") if isinstance(segment.get("approved_outputs"), list) else []
        for output in outputs:
            if not isinstance(output, dict):
                continue
            kind = _normalized_text(output.get("kind") or output.get("media_type"))
            if kind != "video":
                continue
            reference_id = str(output.get("reference_id") or "").strip()
            asset_id = str(output.get("asset_id") or "").strip()
            if reference_id:
                approved.append({"reference_id": reference_id})
            elif asset_id:
                approved.append({"asset_id": asset_id})
    return approved[:12]


def _combine_plan(story_project: dict[str, Any]) -> AssistantGraphPlan:
    approved = _approved_video_outputs(story_project)
    if len(approved) < 2:
        return AssistantGraphPlan(
            summary="I need at least two approved story clips before I can stitch them.",
            questions=["Approve or identify the story clip outputs you want stitched together, then ask me to build the combine graph."],
            operations=[],
            warnings=["No combine nodes were created because there are not enough approved video clips in story state."],
            requires_confirmation=True,
            metadata={"template_id": STORY_COMBINE_GUARD_TEMPLATE_ID, "story_project": True, "approved_clip_count": len(approved)},
        )
    operations: list[AssistantGraphOperation] = [
        AssistantGraphOperation(
            op="add_note",
            node_ref="combine-note",
            title="Story Clip Assembly Notes",
            position={"x": STORY_LAYOUT_INPUT_X, "y": -320},
            body="Review these approved story clips before running the combine node. No provider run is started by this plan.",
        )
    ]
    for index, clip in enumerate(approved, start=1):
        operations.append(
            AssistantGraphOperation(
                op="add_node",
                node_ref=f"clip-{index}",
                node_type="media.load_video",
                title=f"Approved Clip {index}",
                position={"x": STORY_LAYOUT_INPUT_X, "y": 120 + ((index - 1) * STORY_LAYOUT_ROW_GAP)},
                fields=clip,
            )
        )
    operations.extend(
        [
            AssistantGraphOperation(
                op="add_node",
                node_ref="combine",
                node_type="video.combine",
                title="Combine Story Clips",
                position={"x": STORY_LAYOUT_MODEL_X, "y": 220},
                fields={"clip_count": len(approved), "transition": "hard_cut", "title": "Combined Story Sequence"},
            ),
            AssistantGraphOperation(
                op="add_node",
                node_ref="combine-preview",
                node_type="preview.video",
                title="Preview Combined Story",
                position={"x": STORY_LAYOUT_OUTPUT_X, "y": 180},
            ),
            AssistantGraphOperation(
                op="add_node",
                node_ref="combine-save",
                node_type="media.save_video",
                title="Save Combined Story",
                position={"x": STORY_LAYOUT_OUTPUT_X, "y": 760},
                fields={"filename_prefix": "story-sequence", "format": "source_original", "label": "Combined story sequence"},
            ),
        ]
    )
    for index in range(1, len(approved) + 1):
        operations.append(
            AssistantGraphOperation(
                op="connect_nodes",
                source_ref=f"clip-{index}",
                source_port="video",
                target_ref="combine",
                target_port=f"video_{index}",
            )
        )
    operations.extend(
        [
            AssistantGraphOperation(op="connect_nodes", source_ref="combine", source_port="video", target_ref="combine-preview", target_port="video"),
            AssistantGraphOperation(op="connect_nodes", source_ref="combine", source_port="video", target_ref="combine-save", target_port="video"),
            AssistantGraphOperation(
                op="group_nodes",
                group_ref="story-combine",
                title="Story Clip Assembly",
                color="green",
                node_refs=["combine-note", *[f"clip-{index}" for index in range(1, len(approved) + 1)], "combine", "combine-preview", "combine-save"],
            ),
        ]
    )
    return AssistantGraphPlan(
        summary="I made a story clip assembly graph from the approved clips. Review the order, adjust anything you want, then run it when ready.",
        operations=operations,
        warnings=[],
        requires_confirmation=True,
        metadata={"template_id": STORY_COMBINE_TEMPLATE_ID, "story_project": True, "approved_clip_count": len(approved)},
    )


def story_graph_plan_from_state(
    *,
    message: str,
    story_project: dict[str, Any] | None,
    workflow: GraphWorkflow,
    attachments: list[dict[str, Any]] | None = None,
    canvas_context: dict[str, Any] | None = None,
) -> AssistantGraphPlan | None:
    if not story_project or not _wants_story_graph(message):
        return None
    if _wants_clip_combine(message):
        return _combine_plan(story_project)
    if _wants_character_sheet_to_storyboard_graph(message):
        return _character_sheet_to_storyboard_plan(story_project, workflow, message=message, attachments=attachments, canvas_context=canvas_context)
    if _wants_storyboard_stills_graph(message, story_project):
        return _storyboard_stills_plan(story_project, workflow, message=message, canvas_context=canvas_context)
    return _story_segment_plan(story_project, workflow)
