from __future__ import annotations

from dataclasses import asdict, dataclass
import re
from typing import Any, Mapping, Sequence

from .storyboard_metadata_preflight import (
    STORYBOARD_METADATA_LABELS,
    compact_storyboard_camera_contract,
    parse_storyboard_metadata_panels,
    storyboard_camera_contract_missing,
    storyboard_metadata_duplicate_pairs,
    storyboard_metadata_value_is_semantic_fragment,
    storyboard_shot_has_meaningful_description,
)
from .prompt_shaping import compact_storyboard_display_value, positive_visual_directive


STORYBOARD_SHEET_CONTRACT_ID = "storyboard_sheet_spec"
STORYBOARD_SHEET_CONTRACT_VERSION = "1"
STORYBOARD_LAYOUT_ID = "storyboard_v2_3x2_rows"
STORYBOARD_LAYOUT_VERSION = "4"
STORYBOARD_ART_SOURCE_CONTRACT = "storyboard_art_grid_v1"
STORYBOARD_ART_SOURCE_GRID = "2x3"
STORYBOARD_SUPPORTED_PANEL_COUNTS = (4, 6, 9)
STORYBOARD_ART_SOURCE_GRIDS = {4: "2x2", 6: STORYBOARD_ART_SOURCE_GRID, 9: "3x3"}
STORYBOARD_ART_SOURCE_ASPECT_RATIOS = {4: "square", 6: "4:3", 9: "square"}
PRODUCTION_METADATA_KEYS = ("PROJECT", "SEQUENCE", "LOCATION", "DATE", "ARTIST")
STORYBOARD_METADATA_DISPLAY_LIMITS = {
    "SHOT": 64,
    "CAMERA": 136,
    "ACTION": 136,
    "MOTION": 136,
    "DIALOG": 160,
    "NOTES": 140,
}


def storyboard_final_grid_for_panel_count(panel_count: int) -> tuple[int, int]:
    if panel_count == 4:
        return (2, 2)
    if panel_count == 6:
        return (3, 2)
    if panel_count == 9:
        return (3, 3)
    raise ValueError("Storyboard sheet supports only 4, 6, or 9 panels.")


def storyboard_source_grid_for_panel_count(panel_count: int) -> tuple[int, int]:
    if panel_count == 4:
        return (2, 2)
    if panel_count == 6:
        return (2, 3)
    if panel_count == 9:
        return (3, 3)
    raise ValueError("Storyboard art source supports only 4, 6, or 9 panels.")


def storyboard_source_grid_id_for_panel_count(panel_count: int) -> str:
    return STORYBOARD_ART_SOURCE_GRIDS[panel_count]


def storyboard_source_plate_aspect_for_panel_count(panel_count: int) -> str:
    return STORYBOARD_ART_SOURCE_ASPECT_RATIOS[panel_count]


def _panel_count_label(panel_count: int) -> str:
    return {4: "four", 6: "six", 9: "nine"}[panel_count]


def _source_plate_aspect_for_panel_count(panel_count: int) -> str:
    return storyboard_source_plate_aspect_for_panel_count(panel_count)


def _ordered_panel_numbers(numbers: Sequence[int]) -> list[int]:
    if len(numbers) not in STORYBOARD_SUPPORTED_PANEL_COUNTS:
        raise ValueError(
            "Storyboard sheet spec supports only 4, 6, or 9 ordered panels; "
            f"received {numbers or 'none'}."
        )
    expected = list(range(1, len(numbers) + 1))
    if numbers != expected:
        raise ValueError(
            f"Storyboard sheet spec requires panels 1-{len(expected)} in order; received {numbers or 'none'}."
        )
    return expected


@dataclass(frozen=True)
class StoryboardPanelSpec:
    number: int
    shot: str
    camera: str
    action: str
    motion: str
    dialog: str
    notes: str


@dataclass(frozen=True)
class StoryboardSheetSpec:
    contract_id: str
    contract_version: str
    layout_id: str
    layout_version: str
    source_recipe_key: str
    board_title: str
    production_metadata: dict[str, str]
    panels: tuple[StoryboardPanelSpec, ...]
    visual_context: dict[str, str]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _clean(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


_REFERENCE_TOKEN_PATTERN = r"(?:\[\s*image\s+reference\s+\d+\s*\]|@image\d+)"
_REFERENCE_TOKEN_WITH_SOURCE_PREPOSITION_RE = re.compile(
    rf"(?i)\b(?:from|using|with|via|per|according to)\s+{_REFERENCE_TOKEN_PATTERN}"
)
_REFERENCE_TOKEN_RE = re.compile(rf"(?i){_REFERENCE_TOKEN_PATTERN}")


def _clean_visible_storyboard_text(value: object) -> str:
    text = _clean(value)
    if not text:
        return ""
    text = _REFERENCE_TOKEN_WITH_SOURCE_PREPOSITION_RE.sub("", text)
    text = _REFERENCE_TOKEN_RE.sub("", text)
    text = re.sub(r"\s+([,.;:])", r"\1", text)
    text = re.sub(r"\s{2,}", " ", text)
    text = re.sub(r"\s+([)\]])", r"\1", text)
    text = re.sub(r"([(])\s+", r"\1", text)
    return text.strip(" ,;:-")


def _last_directive(text: str, label: str) -> str:
    matches = re.findall(
        rf"(?im)^\s*{re.escape(label)}\s*:\s*([^\r\n]*)",
        text,
    )
    return _clean(matches[-1]) if matches else ""


def _section(text: str, label: str) -> str:
    match = re.search(
        rf"(?ims)^\s*{re.escape(label)}\s*:\s*(.*?)"
        r"(?=^\s*[A-Z][A-Z0-9 /&_-]{2,}\s*:\s*|^\s*PANEL\s+\d{1,2}\s*:|\Z)",
        text,
    )
    return _clean(match.group(1)) if match else ""


def _panel_cue_values(raw: object) -> dict[int, str]:
    text = str(raw or "")
    values: dict[int, str] = {}
    for match in re.finditer(
        r"(?is)(?:^|\s)PANEL\s+0?(?P<number>\d{1,2})\s*(?:[:\-—])\s*"
        r"(?P<value>.*?)"
        r"(?=(?:\s+PANEL\s+0?\d{1,2}\s*(?:[:\-—]))|\s*$)",
        text,
    ):
        value = _clean(match.group("value"))
        if value:
            values[int(match.group("number"))] = value
    return values


def _quoted_dialogue_values(raw: object) -> tuple[str, ...]:
    text = str(raw or "")
    values: list[str] = []
    seen: set[str] = set()
    for match in re.finditer(r'"([^"\r\n]+)"|“([^”\r\n]+)”', text):
        value = match.group(1) if match.group(1) is not None else match.group(2)
        value = str(value or "")
        if value and value not in seen:
            seen.add(value)
            values.append(value)
    return tuple(values)


def _validate_requested_dialogue(panels: Sequence[StoryboardPanelSpec], raw_cues: object) -> None:
    requested = _quoted_dialogue_values(raw_cues)
    if not requested:
        return
    rendered_dialogue = "\n".join(panel.dialog for panel in panels)
    for exact_line in requested:
        if exact_line not in rendered_dialogue:
            raise ValueError(f"Storyboard sheet spec is missing exact requested dialogue: {exact_line!r}.")


def _board_title(text: str) -> str:
    directive = _last_directive(text, "BOARD TITLE")
    if directive:
        return directive.strip("“”\"")
    titled = re.search(r"(?i)\btitled\s+(?:exactly\s+)?[“\"]([^”\"]+)[”\"]", text)
    if titled:
        return _clean(titled.group(1))
    heading = re.search(r"(?im)^\s*(BOARD\s+\d+\s+OF\s+\d+\s*[—-]\s*[^\r\n]+)", text)
    if heading:
        return _clean(heading.group(1))
    raise ValueError("Storyboard sheet spec requires a user-owned board title.")


def _production_metadata(text: str) -> dict[str, str]:
    directive = _last_directive(text, "PRODUCTION METADATA")
    search_text = directive or text
    values: dict[str, str] = {}
    for index, key in enumerate(PRODUCTION_METADATA_KEYS):
        following = "|".join(PRODUCTION_METADATA_KEYS[index + 1 :])
        boundary = rf"(?=\s*;?\s*(?:{following})\s*:|$)" if following else r"(?=\s*$)"
        match = re.search(rf"\b{key}\s*:\s*(.*?)" + boundary, search_text, flags=re.IGNORECASE)
        if not match and not directive:
            match = re.search(rf"(?im)^\s*{key}\s*:\s*([^\r\n]*)", text)
        values[key] = _clean_visible_storyboard_text(match.group(1)).strip("; ") if match else ""
    missing = [key for key, value in values.items() if not value]
    if missing:
        raise ValueError(f"Storyboard sheet spec is missing production metadata: {', '.join(missing)}.")
    return values


def _meaningful_shot(number: int, fields: Mapping[str, str]) -> str:
    shot = _clean(fields.get("SHOT"))
    if storyboard_shot_has_meaningful_description(shot):
        return shot
    for label in ("ACTION", "MOTION", "NOTES"):
        candidate = _clean(fields.get(label))
        words = candidate.rstrip(" .").split()
        if words:
            repaired = f"{number:02d} — {' '.join(words[:8])}"
            if storyboard_shot_has_meaningful_description(repaired):
                return repaired
    raise ValueError(f"Storyboard sheet spec Panel {number:02d} SHOT has no meaningful description.")


def _camera_contract_signature(value: str) -> set[str]:
    compact = compact_storyboard_camera_contract(value).casefold()
    tokens = set(re.findall(r"\b\d+mm\b|[a-z]+(?:-[a-z]+)?", compact))
    return tokens - {"angle", "camera", "frame", "lens", "shot"}


def _deduplicate_camera_contract_clauses(value: str) -> str:
    """Remove a repeated full camera clause while preserving subject framing."""

    kept: list[str] = []
    for raw_clause in value.split(";"):
        clause = raw_clause.strip(" .")
        if not clause:
            continue
        if kept and not storyboard_camera_contract_missing(clause):
            preceding = "; ".join(kept)
            clause_signature = _camera_contract_signature(clause)
            if (
                not storyboard_camera_contract_missing(preceding)
                and clause_signature
                and clause_signature <= _camera_contract_signature(preceding)
            ):
                continue
        kept.append(clause)
    return "; ".join(kept)


def _panel_spec(number: int, raw_fields: Mapping[str, str]) -> StoryboardPanelSpec:
    fields = {
        label: (_clean(raw_fields.get(label)) if label == "DIALOG" else _clean_visible_storyboard_text(raw_fields.get(label)))
        for label in STORYBOARD_METADATA_LABELS
    }
    fields["CAMERA"] = _deduplicate_camera_contract_clauses(fields["CAMERA"])
    for label in ("ACTION", "MOTION", "NOTES"):
        if not fields[label]:
            raise ValueError(f"Storyboard sheet spec Panel {number:02d} {label} is empty.")
    duplicates = storyboard_metadata_duplicate_pairs(fields)
    if duplicates:
        left, right = duplicates[0]
        raise ValueError(
            f"Storyboard sheet spec Panel {number:02d} {left} and {right} "
            "duplicate the same production meaning."
        )
    fields["SHOT"] = _meaningful_shot(number, fields)
    for label in ("ACTION", "MOTION", "NOTES"):
        # The compact validator is intentionally conservative around short
        # provider-bound rows. Raw recipe clauses can be longer and contain
        # multiple complete subclauses that resemble a clipped tail only after
        # independent regex inspection. Preserve those full clauses here and
        # fail closed on the short fragment family the validator owns.
        if len(fields[label]) <= 80 and storyboard_metadata_value_is_semantic_fragment(label, fields[label]):
            raise ValueError(f"Storyboard sheet spec Panel {number:02d} {label} is not a complete semantic value.")
    if storyboard_camera_contract_missing(fields["CAMERA"]):
        fields["CAMERA"] = _clean(
            f"{fields['CAMERA']}; {compact_storyboard_camera_contract(fields['CAMERA'])}"
        )
    for label in ("SHOT", "CAMERA", "ACTION", "MOTION"):
        limit = STORYBOARD_METADATA_DISPLAY_LIMITS[label]
        if label != "SHOT" and len(fields[label]) <= limit:
            continue
        compacted = _clean(compact_storyboard_display_value(label, fields[label], limit))
        if not compacted or len(compacted) > limit:
            raise ValueError(
                f"Storyboard sheet spec Panel {number:02d} {label} cannot be compacted "
                f"into the readable display limit of {limit} characters."
            )
        fields[label] = compacted
    if not storyboard_shot_has_meaningful_description(fields["SHOT"]):
        raise ValueError(f"Storyboard sheet spec Panel {number:02d} SHOT has no meaningful description.")
    for label in ("ACTION", "MOTION"):
        if storyboard_metadata_value_is_semantic_fragment(label, fields[label]):
            raise ValueError(
                f"Storyboard sheet spec Panel {number:02d} {label} is not a complete semantic value: "
                f"{fields[label]!r}."
            )
    if storyboard_camera_contract_missing(fields["CAMERA"]):
        raise ValueError(f"Storyboard sheet spec Panel {number:02d} CAMERA is incomplete.")
    for label, limit in STORYBOARD_METADATA_DISPLAY_LIMITS.items():
        if len(fields[label]) > limit:
            raise ValueError(
                f"Storyboard sheet spec Panel {number:02d} {label} exceeds the readable display limit "
                f"of {limit} characters ({len(fields[label])} supplied)."
            )
    return StoryboardPanelSpec(
        number=number,
        shot=fields["SHOT"],
        camera=fields["CAMERA"],
        action=fields["ACTION"],
        motion=fields["MOTION"],
        dialog=fields["DIALOG"],
        notes=fields["NOTES"],
    )


def storyboard_sheet_spec_from_recipe_result(value: Mapping[str, Any]) -> StoryboardSheetSpec:
    raw_text = str(value.get("raw_text") or value.get("final_text") or "").strip()
    if not raw_text:
        raise ValueError("Storyboard compiler requires a Prompt Recipe result containing raw_text or final_text.")
    raw_panels = parse_storyboard_metadata_panels(raw_text)
    numbers = [number for number, _ in raw_panels]
    _ordered_panel_numbers(numbers)
    note_overrides = _panel_cue_values(value.get("panel_notes_cues"))
    panels = tuple(
        _panel_spec(
            number,
            {**fields, **({"NOTES": note_overrides[number]} if number in note_overrides else {})},
        )
        for number, fields in raw_panels
    )
    _validate_requested_dialogue(panels, value.get("dialogue_cues"))
    visual_context = {
        "reference": _section(raw_text, "REFERENCE LOCKS")
        or _section(raw_text, "REFERENCE ROLE LOCK")
        or _section(raw_text, "REFERENCE AUTHORITY"),
        "visual_continuity": _section(raw_text, "VISUAL CONTINUITY"),
        "character_continuity": _section(raw_text, "CHARACTER CONTINUITY"),
        "wardrobe": _section(raw_text, "WARDROBE CUES") or _last_directive(raw_text, "WARDROBE CUES"),
        "subject_design": _section(raw_text, "SUBJECT DESIGN CUES")
        or _last_directive(raw_text, "SUBJECT DESIGN CUES"),
        "state_continuity": _section(raw_text, "PROP AND STATE CONTINUITY"),
        "style": _section(raw_text, "STYLE DIRECTION")
        or _last_directive(raw_text, "STYLE DIRECTION")
        or _section(raw_text, "STYLE")
        or _last_directive(raw_text, "STYLE"),
    }
    return StoryboardSheetSpec(
        contract_id=STORYBOARD_SHEET_CONTRACT_ID,
        contract_version=STORYBOARD_SHEET_CONTRACT_VERSION,
        layout_id=STORYBOARD_LAYOUT_ID,
        layout_version=STORYBOARD_LAYOUT_VERSION,
        source_recipe_key=_clean(value.get("recipe_key")),
        board_title=_board_title(raw_text),
        production_metadata=_production_metadata(raw_text),
        panels=panels,
        visual_context={key: content for key, content in visual_context.items() if content},
    )


def storyboard_sheet_spec_from_mapping(value: Mapping[str, Any]) -> StoryboardSheetSpec:
    if str(value.get("contract_id") or "") != STORYBOARD_SHEET_CONTRACT_ID:
        raise ValueError("Storyboard sheet spec contract_id is unsupported.")
    if str(value.get("contract_version") or "") != STORYBOARD_SHEET_CONTRACT_VERSION:
        raise ValueError("Storyboard sheet spec contract_version is unsupported.")
    if str(value.get("layout_id") or "") != STORYBOARD_LAYOUT_ID:
        raise ValueError("Storyboard sheet spec layout_id is unsupported.")
    if str(value.get("layout_version") or "") != STORYBOARD_LAYOUT_VERSION:
        raise ValueError("Storyboard sheet spec layout_version is unsupported.")
    board_title = _clean(value.get("board_title"))
    if not board_title:
        raise ValueError("Storyboard sheet spec requires a board title.")
    raw_panels = value.get("panels")
    if not isinstance(raw_panels, Sequence) or isinstance(raw_panels, (str, bytes)):
        raise ValueError("Storyboard sheet spec panels must be an ordered array.")
    panels = tuple(
        _panel_spec(int(panel.get("number") or 0), {label: panel.get(label.lower(), "") for label in STORYBOARD_METADATA_LABELS})
        for panel in raw_panels
        if isinstance(panel, Mapping)
    )
    _ordered_panel_numbers([panel.number for panel in panels])
    production = value.get("production_metadata")
    if not isinstance(production, Mapping):
        raise ValueError("Storyboard sheet spec production_metadata must be an object.")
    metadata = {key: _clean(production.get(key)) for key in PRODUCTION_METADATA_KEYS}
    missing = [key for key, item in metadata.items() if not item]
    if missing:
        raise ValueError(f"Storyboard sheet spec is missing production metadata: {', '.join(missing)}.")
    visual_context = value.get("visual_context") if isinstance(value.get("visual_context"), Mapping) else {}
    _validate_requested_dialogue(panels, value.get("dialogue_cues"))
    return StoryboardSheetSpec(
        contract_id=STORYBOARD_SHEET_CONTRACT_ID,
        contract_version=STORYBOARD_SHEET_CONTRACT_VERSION,
        layout_id=STORYBOARD_LAYOUT_ID,
        layout_version=STORYBOARD_LAYOUT_VERSION,
        source_recipe_key=_clean(value.get("source_recipe_key")),
        board_title=board_title,
        production_metadata=metadata,
        panels=panels,
        visual_context={str(key): _clean(item) for key, item in visual_context.items() if _clean(item)},
    )


def _bounded_art_clause(value: str, limit: int) -> str:
    """Compact provider-bound prose at a complete clause boundary."""

    text = _clean(value)
    if len(text) <= limit:
        return text if text.endswith((".", "!", "?", "\u201d", '"')) else f"{text}."
    window = text[:limit].rstrip()
    minimum_boundary = int(limit * 0.35)
    boundaries = [
        match.start()
        for match in re.finditer(
            r"\.\s+|;\s+|,\s+|\s+(?:and|as|while|when|because|with|from|into|through|toward|towards|before|after)\s+",
            window,
            flags=re.IGNORECASE,
        )
        if match.start() >= minimum_boundary
    ]
    if boundaries:
        compact = window[: max(boundaries)]
    else:
        boundary = window.rfind(" ")
        compact = window[:boundary] if boundary >= minimum_boundary else ""
    compact = compact.rstrip(" ,;:-")
    dangling_tail = re.compile(
        r"\s+(?:a|an|the|and|or|with|to|toward|towards|in|on|at|from|for|of|as|while|into|by)$",
        flags=re.IGNORECASE,
    )
    while dangling_tail.search(compact):
        compact = dangling_tail.sub("", compact).rstrip(" ,;:-")
    if not compact:
        raise ValueError("Storyboard art prompt cannot compact a complete provider-bound clause.")
    return compact if compact.endswith((".", "!", "?", "\u201d", '"')) else f"{compact}."


def storyboard_art_prompt(spec: StoryboardSheetSpec) -> str:
    panel_count = len(spec.panels)
    source_columns, source_rows = storyboard_source_grid_for_panel_count(panel_count)
    source_grid_id = storyboard_source_grid_id_for_panel_count(panel_count)
    source_aspect = _source_plate_aspect_for_panel_count(panel_count)
    panel_count_label = _panel_count_label(panel_count)
    style_authority = positive_visual_directive(spec.visual_context.get("style", ""))
    cell_style_contract = (
        f"Every cell follows this visual style authority: {_bounded_art_clause(style_authority, 280)} "
        "Preserve cinematic composition, plausible lighting, atmospheric depth, restrained color discipline, and continuity."
        if style_authority
        else "Every cell is a photoreal live-action feature-film still with physical materials, real lens behavior, plausible lighting, atmospheric depth, restrained film color, and continuity."
    )
    parts = [
        f"Storyboard art source contract: {STORYBOARD_ART_SOURCE_CONTRACT}. "
        f"Source grid: {source_grid_id}. "
        f"Create one text-free {source_aspect} source plate with exactly {panel_count_label} equal cinematic frames "
        f"in a clean {source_columns}-column by {source_rows}-row source grid, ordered left-to-right then top-to-bottom. "
        f"{cell_style_contract}",
        "Compose every cell for an approximately 1.9:1 final extraction. Keep the complete action, principal subjects, essential props, and environment landmarks inside the central 58% vertical safe band; only expendable background may extend beyond it. Favor action-readable wide or medium blocking; avoid repetitive close-ups unless required by the user beat. Show art only: no titles, words, letters, numbers, captions, metadata, borders, dashboards, speech bubbles, logos, watermarks, or production-sheet chrome.",
    ]
    context_labels = (
        ("style", "Visual style authority", 280),
        ("reference", "Reference authority", 220),
        ("wardrobe", "Wardrobe authority", 480),
        ("subject_design", "Subject design authority", 680),
    )
    for key, label, limit in context_labels:
        if spec.visual_context.get(key):
            provider_direction = positive_visual_directive(spec.visual_context[key])
            if provider_direction:
                parts.append(f"{label}: {_bounded_art_clause(provider_direction, limit)}")
    for panel in spec.panels:
        spoken = (
            f" Spoken beat for performance only: {_bounded_art_clause(panel.dialog, 140)}"
            if panel.dialog
            else ""
        )
        parts.append(
            f"Cell {panel.number:02d}: {_bounded_art_clause(panel.action, 170)} "
            f"{compact_storyboard_camera_contract(panel.camera)} "
            f"{_bounded_art_clause(panel.motion, 100)} "
            f"{_bounded_art_clause(panel.notes, 80)}{spoken}"
        )
    prompt = "\n\n".join(parts)
    if len(prompt) > 4200:
        raise ValueError("Storyboard art prompt exceeds the deterministic compiler limit.")
    return prompt


def storyboard_art_source_prompt_is_compatible(value: object, *, panel_count: int | None = None) -> bool:
    prompt = _clean(value).lower()
    if not prompt:
        return False
    if STORYBOARD_ART_SOURCE_CONTRACT.lower() in prompt:
        if panel_count is None:
            return True
        source_columns, source_rows = storyboard_source_grid_for_panel_count(panel_count)
        source_grid_id = storyboard_source_grid_id_for_panel_count(panel_count)
        source_aspect = _source_plate_aspect_for_panel_count(panel_count)
        return all(
            marker in prompt
            for marker in (
                f"source grid: {source_grid_id}",
                f"text-free {source_aspect} source plate",
                f"{source_columns}-column by {source_rows}-row source grid",
            )
        )
    if panel_count not in (None, 6):
        return False
    # Phase 27 generated one accepted art-only source before the explicit
    # contract marker existed. Its two structural clauses prove the same
    # source shape without coupling compatibility to a story or asset id.
    return all(
        marker in prompt
        for marker in (
            "text-free 4:3 source plate",
            "2-column by 3-row source grid",
            "no titles, words, letters, numbers, captions, metadata, borders",
        )
    )


def storyboard_panel_prompts(spec: StoryboardSheetSpec) -> list[str]:
    shared = " ".join(value for key, value in spec.visual_context.items() if key != "style")
    style_authority = positive_visual_directive(spec.visual_context.get("style", "")).rstrip(" .")
    prefix = (
        f"Production storyboard still following this visual style authority: {style_authority}."
        if style_authority
        else "Photoreal live-action feature-film production still."
    )
    return [
        _clean(
            f"{prefix} "
            f"{shared.rstrip(' .')}. {panel.camera.rstrip(' .')}. {panel.action.rstrip(' .')}. "
            f"{panel.motion.rstrip(' .')}. {panel.notes.rstrip(' .')}. "
            "No visible text, captions, metadata, borders, logos, or watermarks."
        )
        for panel in spec.panels
    ]
