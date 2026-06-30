from __future__ import annotations

import re
from typing import Any


STORY_PROJECT_STATE_VERSION = 1
MAX_STATE_TEXT_CHARS = 1200
MAX_LEDGER_ITEMS = 8
MAX_STORY_SEGMENTS = 6
MAX_SHOTS_PER_SEGMENT = 12
STORYBOARD_TURN_KINDS = {"storyboard", "storyboard_continuation"}


def _clean_text(value: Any, limit: int = MAX_STATE_TEXT_CHARS) -> str:
    text = " ".join(str(value or "").strip().split())
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "..."


def _trim_story_graph_instructions(text: str) -> str:
    value = _clean_text(text, MAX_STATE_TEXT_CHARS).strip(" .:-")
    if not value:
        return ""
    stop_match = re.search(
        r"\b(?:use\s+gpt\s+image|use\s+one\s+shared|use\s+the\s+reusable|no\s+seedance|no\s+video|do\s+not|don't|dont|add\s+the\s+graph|add\s+the\s+workflow)\b",
        value,
        flags=re.IGNORECASE,
    )
    if stop_match and stop_match.start() >= 18:
        value = value[: stop_match.start()]
    return _clean_text(value, 1000).strip(" .:-")


def _story_brief_from_user_request(text: str) -> str:
    source = _clean_text(text, MAX_STATE_TEXT_CHARS)
    for label in ("story arc", "story direction", "creative direction", "story brief", "storyboard brief", "scene brief", "board brief", "for this story", "story"):
        match = re.search(rf"\b{re.escape(label)}\s*:\s*(.+)", source, flags=re.IGNORECASE)
        if match:
            brief = _trim_story_graph_instructions(match.group(1))
            if brief:
                return brief
    match = re.search(
        r"\bfor\s+(?:a|an|the)?\s*([^.;]*(?:escape|adventure|story|sequence|scene|storyboard)[^.;]*)",
        source,
        flags=re.IGNORECASE,
    )
    if match:
        brief = _trim_story_graph_instructions(match.group(1))
        if brief:
            return brief
    return _trim_story_graph_instructions(source) or _clean_text(source, 500)


def _normalized_text(value: Any) -> str:
    return " ".join(str(value or "").lower().split())


def _dedupe(items: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for item in items:
        normalized = item.strip()
        key = normalized.lower()
        if not normalized or key in seen:
            continue
        seen.add(key)
        result.append(normalized)
    return result


def _candidate_character_names(text: str) -> list[str]:
    names: list[str] = []
    for match in re.finditer(r"\b(?:characters?|for)\s*:?\s*([A-Z][a-zA-Z'-]{1,32})(?:,|\s+and\s+)([A-Z][a-zA-Z'-]{1,32})", text):
        names.extend([match.group(1), match.group(2)])
    for match in re.finditer(r"\b([A-Z][a-zA-Z'-]{1,32})\s+and\s+([A-Z][a-zA-Z'-]{1,32})\b", text):
        left, right = match.group(1), match.group(2)
        if left.lower() not in {"story", "seed", "media"} and right.lower() not in {"dance", "studio"}:
            names.extend([left, right])
    for match in re.finditer(r"\*\*([A-Z][a-zA-Z'-]{1,32})\s*:\*\*", text):
        names.append(match.group(1))
    return _dedupe(names)[:8]


def _merge_characters(existing: list[dict[str, Any]], names: list[str]) -> list[dict[str, Any]]:
    characters: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in existing:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name or name.lower() in seen:
            continue
        seen.add(name.lower())
        characters.append(dict(item))
    for name in names:
        if name.lower() in seen:
            continue
        seen.add(name.lower())
        characters.append(
            {
                "character_id": re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_") or name.lower(),
                "name": name,
                "continuity_prompt_fragment": "",
            }
        )
    return characters[:8]


def _requested_shot_count(text: str) -> int | None:
    match = re.search(r"\b(\d{1,2})\s*[- ]?(?:shot|scene)\b", text, flags=re.IGNORECASE)
    if not match:
        return None
    try:
        count = int(match.group(1))
    except ValueError:
        return None
    return count if 1 <= count <= 12 else None


def _bounded_shot_count(value: Any, fallback: int = 6) -> int:
    try:
        count = int(value)
    except (TypeError, ValueError):
        count = fallback
    return max(1, min(MAX_SHOTS_PER_SEGMENT, count))


def _requested_duration_seconds(text: str) -> int | None:
    match = re.search(r"\b(\d{1,3})\s*(?:second|seconds|sec|secs|s)\b", text, flags=re.IGNORECASE)
    if not match:
        return None
    try:
        seconds = int(match.group(1))
    except ValueError:
        return None
    return seconds if 1 <= seconds <= 300 else None


def _turn_kind(text: str) -> str:
    normalized = _normalized_text(text)
    graph_negated = any(
        phrase in normalized
        for phrase in (
            "do not build a graph",
            "don't build a graph",
            "dont build a graph",
            "do not create a graph",
            "don't create a graph",
            "dont create a graph",
            "do not build a workflow",
            "don't build a workflow",
            "dont build a workflow",
            "text only",
            "chat text only",
        )
    )
    if "continue" in normalized or "next storyboard" in normalized or "next segment" in normalized:
        return "storyboard_continuation"
    if "rewrite" in normalized and "shot" in normalized:
        return "prompt_rewrite"
    if "show" in normalized and "prompt" in normalized:
        return "prompt_recall"
    if ("graph" in normalized or "workflow" in normalized) and not graph_negated:
        return "graph_review"
    if "storyboard" in normalized or "shot" in normalized or "scene" in normalized:
        return "storyboard"
    if "character sheet" in normalized or "character prompt" in normalized:
        return "character_sheet"
    return "story_bible"


def _mentions_approved_character_sheet(text: str) -> bool:
    normalized = _normalized_text(text)
    return any(
        phrase in normalized
        for phrase in (
            "approved character sheet",
            "character sheet is approved",
            "character sheet approved",
            "use the character sheet",
            "from the character sheet",
            "using the character sheet",
        )
    )


def _storyboard_stills_intent(text: str) -> bool:
    normalized = _normalized_text(text)
    has_storyboard = any(term in normalized for term in ("storyboard", "story board", "scene sheet", "shot sheet"))
    has_image_model = any(
        term in normalized
        for term in (
            "gpt image 2",
            "gpt 2 image",
            "gpt-image-2",
            "image-to-image",
            "image to image",
            "storyboard still",
            "storyboard image",
            "storyboard sheet",
        )
    )
    return has_storyboard and has_image_model


def _seedance_video_intent(text: str) -> bool:
    normalized = _normalized_text(text)
    if any(
        term in normalized
        for term in (
            "not seedance",
            "no seedance",
            "without seedance",
            "not video",
            "no video",
            "without video",
            "seedance is only for videos later",
        )
    ):
        return False
    return any(term in normalized for term in ("seed dance", "seedance", "video", "clip", "clips"))


def _graph_review_includes_first_storyboard_request(text: str, story_segments: list[dict[str, Any]]) -> bool:
    if story_segments:
        return False
    normalized = _normalized_text(text)
    if any(term in normalized for term in ("combine", "stitch", "join the clips", "clip assembly", "assemble the clips")):
        return False
    return _storyboard_stills_intent(text) and any(
        term in normalized
        for term in (
            "storyboard",
            "story board",
            "story:",
            "story brief",
            "scene",
            "shot",
        )
    )


def _style_terms(text: str) -> list[str]:
    normalized = _normalized_text(text)
    terms = []
    for term in ("sci-fi", "science fiction", "fantasy", "horror", "mythic", "eclipse", "cathedral", "orbital"):
        if term in normalized:
            terms.append(term)
    return _dedupe(terms)


def _story_line_broken_text(text: str) -> str:
    source = str(text or "").replace("\r\n", "\n").replace("\r", "\n")
    source = re.sub(r"\s+(?=(?:[-*]\s*)?(?:shot|scene)\s+\d{1,2}\b)", "\n", source, flags=re.IGNORECASE)
    source = re.sub(r"\s+(?=(?:[-*]\s*)?\*{1,2}(?:shot|scene)\s+\d{1,2}\b)", "\n", source, flags=re.IGNORECASE)
    source = re.sub(r"\s+(?=\d{1,2}[.)]\s+)", "\n", source)
    return source


def _extract_labeled_value(block: str, label: str) -> str:
    labels = "duration|camera|action|motion|prompt|continuity|environment|characters"
    match = re.search(
        rf"(?is)\b{re.escape(label)}\s*:\s*(.+?)(?=\s+\b(?:{labels})\s*:|\n\s*(?:[-*]\s*)?(?:shot|scene)?\s*\d{{1,2}}[.)\]:-]|\Z)",
        block,
    )
    return _clean_text(match.group(1), 900) if match else ""


def _duration_from_text(text: str) -> float | None:
    match = re.search(r"\b(\d+(?:\.\d+)?)\s*(?:second|seconds|sec|secs|s)\b", text, flags=re.IGNORECASE)
    if not match:
        return None
    try:
        seconds = float(match.group(1))
    except ValueError:
        return None
    return seconds if seconds > 0 else None


def _duration_per_shot(total_duration_seconds: int | None, shot_count: int) -> float | None:
    if not total_duration_seconds or shot_count <= 0:
        return None
    return round(total_duration_seconds / shot_count, 2)


def _extract_storyboard_shots(
    assistant_text: str,
    *,
    requested_count: int,
    total_duration_seconds: int | None,
) -> list[dict[str, Any]]:
    source = _story_line_broken_text(assistant_text)
    pattern = re.compile(
        r"(?im)^\s*(?:[-*]\s*)?(?:\*{1,2})?(?:(?:shot|scene)\s*(\d{1,2})(?:[.)\]:-]|\s+-|\s+)|(\d{1,2})[.)]\s+)\s*(.*?)(?:\*{1,2})?$"
    )
    matches = list(pattern.finditer(source))
    shots: list[dict[str, Any]] = []
    default_duration = _duration_per_shot(total_duration_seconds, requested_count)
    for index, match in enumerate(matches):
        if len(shots) >= MAX_SHOTS_PER_SEGMENT:
            break
        start = match.start()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(source)
        block = source[start:end].strip()
        try:
            shot_number = int(match.group(1) or match.group(2))
        except ValueError:
            shot_number = len(shots) + 1
        heading = _clean_text(match.group(3), 500)
        duration = _duration_from_text(block) or default_duration
        prompt = _extract_labeled_value(block, "prompt")
        action = _extract_labeled_value(block, "action")
        camera = _extract_labeled_value(block, "camera")
        motion = _extract_labeled_value(block, "motion")
        continuity = _extract_labeled_value(block, "continuity")
        environment = _extract_labeled_value(block, "environment")
        characters = _extract_labeled_value(block, "characters")
        story_beat = heading or action or prompt or _clean_text(block, 500)
        shots.append(
            {
                "shot_number": shot_number,
                "duration_seconds": duration,
                "story_beat": story_beat,
                "camera": camera,
                "action": action,
                "motion": motion,
                "characters": [item.strip() for item in re.split(r",|\band\b", characters) if item.strip()] if characters else [],
                "environment": environment,
                "prompt": prompt or story_beat,
                "continuity_notes": continuity,
            }
        )
    return shots


def _segment_handoff(segment: dict[str, Any]) -> str:
    explicit = _clean_text(segment.get("handoff"), 500)
    if explicit:
        return explicit
    shots = segment.get("shots") if isinstance(segment.get("shots"), list) else []
    last_shot = next((shot for shot in reversed(shots) if isinstance(shot, dict)), None)
    if not last_shot:
        return ""
    return _clean_text(
        last_shot.get("continuity_notes")
        or last_shot.get("story_beat")
        or last_shot.get("prompt"),
        500,
    )


def _latest_segment(story_segments: list[dict[str, Any]]) -> dict[str, Any] | None:
    for segment in reversed(story_segments):
        if isinstance(segment, dict):
            return segment
    return None


def _append_storyboard_segment(
    story_segments: list[dict[str, Any]],
    *,
    turn_kind: str,
    user_text: str,
    assistant_text: str,
    output_preferences: dict[str, Any],
) -> list[dict[str, Any]]:
    requested_count = _bounded_shot_count(
        _requested_shot_count(user_text) or output_preferences.get("default_shot_count") or 6
    )
    total_duration_seconds = _requested_duration_seconds(user_text) or output_preferences.get("segment_duration_seconds")
    try:
        total_duration = int(total_duration_seconds) if total_duration_seconds else None
    except (TypeError, ValueError):
        total_duration = None
    shots = _extract_storyboard_shots(
        assistant_text,
        requested_count=requested_count,
        total_duration_seconds=total_duration,
    )
    previous = _latest_segment(story_segments)
    sequence_index = len(story_segments) + 1
    handoff = _segment_handoff({"shots": shots}) or _clean_text(assistant_text, 500)
    segment = {
        "segment_id": f"segment_{sequence_index}",
        "sequence_index": sequence_index,
        "title": f"Storyboard Segment {sequence_index}",
        "goal": _story_brief_from_user_request(user_text),
        "previous_segment_handoff": _segment_handoff(previous) if previous and turn_kind == "storyboard_continuation" else "",
        "shot_count": len(shots) or requested_count,
        "requested_shot_count": requested_count,
        "total_duration_seconds": total_duration,
        "target_model": output_preferences.get("storyboard_image_model") or output_preferences.get("target_model") or "seedance-2.0",
        "shots": shots,
        "handoff": handoff,
        "continuity_notes": _clean_text(assistant_text, 700),
        "approved_outputs": [],
    }
    return [*story_segments, segment][-MAX_STORY_SEGMENTS:]


def _append_prompt_revision(
    story_segments: list[dict[str, Any]],
    *,
    user_text: str,
    assistant_text: str,
) -> list[dict[str, Any]]:
    latest = _latest_segment(story_segments)
    if not latest:
        return story_segments
    updated_latest = dict(latest)
    revisions = list(updated_latest.get("prompt_revisions") if isinstance(updated_latest.get("prompt_revisions"), list) else [])
    revisions.append(
        {
            "user_request": _clean_text(user_text, 500),
            "assistant_summary": _clean_text(assistant_text, 700),
        }
    )
    updated_latest["prompt_revisions"] = revisions[-4:]
    return [*story_segments[:-1], updated_latest]


def story_project_from_session(summary_json: dict[str, Any] | None, state_snapshot_json: dict[str, Any] | None) -> dict[str, Any] | None:
    for payload in (state_snapshot_json, summary_json):
        if not isinstance(payload, dict):
            continue
        story_project = payload.get("story_project")
        if isinstance(story_project, dict):
            return dict(story_project)
    return None


def merge_story_project_state(
    existing: dict[str, Any] | None,
    *,
    user_text: str,
    assistant_text: str,
) -> dict[str, Any]:
    current = dict(existing or {})
    names = _candidate_character_names(f"{user_text}\n{assistant_text}")
    characters = _merge_characters(
        current.get("characters") if isinstance(current.get("characters"), list) else [],
        names,
    )
    continuity_ledger = list(current.get("continuity_ledger") if isinstance(current.get("continuity_ledger"), list) else [])
    turn_kind = _turn_kind(user_text)
    shot_count = _requested_shot_count(user_text)
    duration_seconds = _requested_duration_seconds(user_text)
    continuity_ledger.append(
        {
            "kind": turn_kind,
            "user_request": _clean_text(user_text, 500),
            "assistant_summary": _clean_text(assistant_text, 700),
            "shot_count": shot_count,
            "duration_seconds": duration_seconds,
        }
    )
    output_preferences = dict(current.get("output_preferences") if isinstance(current.get("output_preferences"), dict) else {})
    combined_text = f"{user_text}\n{assistant_text}"
    if _storyboard_stills_intent(combined_text):
        output_preferences["graph_output_intent"] = "storyboard_stills"
        output_preferences["storyboard_image_model"] = "gpt-image-2-image-to-image"
        output_preferences["video_model_stage"] = "seedance_after_storyboard_approval"
    if _seedance_video_intent(user_text):
        output_preferences["target_model"] = "seedance-2.0"
    if duration_seconds:
        output_preferences["segment_duration_seconds"] = duration_seconds
    if shot_count:
        output_preferences["default_shot_count"] = shot_count
    story_segments = [
        dict(segment)
        for segment in (current.get("story_segments") if isinstance(current.get("story_segments"), list) else [])
        if isinstance(segment, dict)
    ][-MAX_STORY_SEGMENTS:]
    if turn_kind in STORYBOARD_TURN_KINDS or _graph_review_includes_first_storyboard_request(combined_text, story_segments):
        story_segments = _append_storyboard_segment(
            story_segments,
            turn_kind=turn_kind,
            user_text=user_text,
            assistant_text=assistant_text,
            output_preferences=output_preferences,
        )
    elif turn_kind in {"prompt_recall", "prompt_rewrite"}:
        story_segments = _append_prompt_revision(
            story_segments,
            user_text=user_text,
            assistant_text=assistant_text,
        )
    visual_terms = _dedupe([
        *(current.get("visual_style_terms") if isinstance(current.get("visual_style_terms"), list) else []),
        *_style_terms(f"{user_text}\n{assistant_text}"),
    ])
    approved_character_sheet = dict(current.get("approved_character_sheet") if isinstance(current.get("approved_character_sheet"), dict) else {})
    if _mentions_approved_character_sheet(combined_text):
        approved_character_sheet = {
            **approved_character_sheet,
            "status": "approved",
            "label": approved_character_sheet.get("label") or "Approved Character Sheet",
            "source": approved_character_sheet.get("source") or "conversation",
        }
    return {
        "version": STORY_PROJECT_STATE_VERSION,
        "status": "draft",
        "latest_turn_kind": turn_kind,
        "story_bible": {
            "source_user_request": _clean_text(current.get("story_bible", {}).get("source_user_request") if isinstance(current.get("story_bible"), dict) else user_text, 500)
            or _clean_text(user_text, 500),
            "latest_summary": _clean_text(assistant_text),
        },
        "characters": characters,
        "story_segments": story_segments,
        "visual_style_terms": visual_terms,
        "continuity_ledger": continuity_ledger[-MAX_LEDGER_ITEMS:],
        "output_preferences": output_preferences,
        **({"approved_character_sheet": approved_character_sheet} if approved_character_sheet else {}),
    }
