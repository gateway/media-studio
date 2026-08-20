from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List

from .storyboard_metadata_preflight import (
    compact_storyboard_camera_contract,
    compact_storyboard_metadata_capsules,
    storyboard_camera_contract_missing,
    storyboard_metadata_semantic_fragments,
    storyboard_metadata_value_is_semantic_fragment,
    storyboard_shot_has_meaningful_description,
)

GPT_IMAGE_2_COMPACT_PROMPT_CHARS = 4200


@dataclass(frozen=True)
class PromptShapeResult:
    prompt: str
    changed: bool
    strategy: str
    original_chars: int
    final_chars: int
    target_chars: int


def _normalized_model_key(model_key: str) -> str:
    return str(model_key or "").strip().lower().replace("_", "-")


def _clean_spaces(value: str) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return re.sub(r"\bthe\s+the character\b", "the character", text, flags=re.IGNORECASE)


def _sentence_limit(value: str, max_chars: int) -> str:
    text = _clean_spaces(value)
    if max_chars <= 0:
        return ""
    if len(text) <= max_chars:
        return text
    cutoff = text[:max_chars].rstrip()
    minimum_boundary = int(max_chars * 0.55)
    punctuation_boundary = max(cutoff.rfind(". "), cutoff.rfind("; "), cutoff.rfind(", "))
    whitespace_boundary = cutoff.rfind(" ")
    if punctuation_boundary >= minimum_boundary:
        cutoff = cutoff[: punctuation_boundary + 1].rstrip()
    elif whitespace_boundary >= minimum_boundary:
        cutoff = cutoff[:whitespace_boundary].rstrip()
    elif punctuation_boundary >= 0:
        cutoff = cutoff[: punctuation_boundary + 1].rstrip()
    elif whitespace_boundary >= 0:
        cutoff = cutoff[:whitespace_boundary].rstrip()
    else:
        # A visibly clipped first word is worse than an empty optional value.
        # Storyboard metadata must use complete words so the image model does
        # not reproduce fragments such as "doorwa." in the rendered rows.
        return ""
    return cutoff.rstrip(" ,;:-") + "."


def _metadata_limit(value: str, max_chars: int) -> str:
    """Compact a metadata value without leaving a visibly dangling clause."""
    text = _clean_spaces(value)
    text = re.sub(r"^(?:and|then|while|with|to)\s+", "", text, flags=re.IGNORECASE)
    if len(text) <= max_chars:
        result = re.sub(
            r"(^|[.!?]\s+)([a-z])",
            lambda match: match.group(1) + match.group(2).upper(),
            text,
        )
        return re.sub(
            r"\s+(?:he|she|they|it|this|that|these|those|who|which)\.$",
            "",
            result,
            flags=re.IGNORECASE,
        ).strip()
    window = text[:max_chars]
    minimum_boundary = int(max_chars * 0.2)
    sentence_boundaries = [
        match.start()
        for match in re.finditer(
            r"\.\s+|;",
            window,
            flags=re.IGNORECASE,
        )
        if match.start() >= minimum_boundary
    ]
    connector_boundaries = [
        match.start()
        for match in re.finditer(
            r"\s+(?:and|as|when|because|while|timed\s+to)\s+",
            window,
            flags=re.IGNORECASE,
        )
        if match.start() >= minimum_boundary
    ]
    comma_boundaries = [
        match.start()
        for match in re.finditer(r",", window)
        if match.start() >= minimum_boundary
    ]
    weak_boundaries = [
        match.start()
        for match in re.finditer(
            r"\s+(?:with|from|into|through|past|beside|behind|above|below|toward|towards)\s+",
            window,
            flags=re.IGNORECASE,
        )
        if match.start() >= minimum_boundary
    ]
    if sentence_boundaries or connector_boundaries or comma_boundaries or weak_boundaries:
        if sentence_boundaries:
            boundary = max(sentence_boundaries)
        elif comma_boundaries:
            boundary = max(comma_boundaries)
        elif connector_boundaries:
            boundary = min(connector_boundaries)
        else:
            boundary = min(weak_boundaries)
        compact = window[:boundary].rstrip(" ,;:-")
        result = compact + "." if compact else _sentence_limit(text, max_chars)
    else:
        result = _sentence_limit(text, max_chars)
    stem = result.rstrip(".")
    dangling_tail = re.compile(
        r"\s+(?:a|an|the|and|or|with|to|toward|towards|in|on|at|from|for|of|as|while|into|by)$",
        flags=re.IGNORECASE,
    )
    while dangling_tail.search(stem):
        stem = dangling_tail.sub("", stem).rstrip(" ,;:-")
    result = stem + "." if stem else ""
    return re.sub(
        r"(^|[.!?]\s+)([a-z])",
        lambda match: match.group(1) + match.group(2).upper(),
        result,
    )


def _extract_user_owned_directive(text: str, label: str, *, max_chars: int) -> str:
    match = re.search(
        rf"(?im)^\s*{re.escape(label)}\s*:\s*([^\r\n]+)",
        text,
    )
    return _sentence_limit(match.group(1), max_chars) if match else ""


def _strip_nonvisual_future_clauses(value: str) -> str:
    clauses = re.split(r"(?<=[.!?;])\s+", str(value or ""))
    future_absence = re.compile(
        r"\b(?:not visible(?: yet)?|out of sight|do not reveal|must not appear|not shown(?: yet)?)\b",
        flags=re.IGNORECASE,
    )
    return " ".join(clause for clause in clauses if clause and not future_absence.search(clause))


def positive_visual_directive(value: str) -> str:
    """Keep provider-facing visual direction affirmative and story-agnostic."""
    text = _clean_spaces(value)
    if not text:
        return ""
    quoted_values: list[str] = []

    def protect_quote(match: re.Match[str]) -> str:
        quoted_values.append(match.group(0))
        return f"§Q{len(quoted_values) - 1}§"

    text = re.sub(r'"[^"\r\n]*"|“[^”\r\n]*”', protect_quote, text)
    negative_start = re.compile(
        r"(?:,\s*)?\b(?:but|and)\s+(?:it\s+)?(?:must\s+not|should\s+not|do\s+not|does\s+not|never)\b"
        r"|\b(?:must\s+not|should\s+not|do\s+not|does\s+not|don't|never|without|not|no)\b",
        flags=re.IGNORECASE,
    )
    kept: List[str] = []
    for clause in re.split(r"(?<=[.!?;])\s+", text):
        clean = clause.strip(" ,;:-")
        if not clean:
            continue
        match = negative_start.search(clean)
        if match:
            clean = clean[: match.start()].strip(" ,;:-")
        words = re.findall(r"[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*", clean)
        orphaned_subject = (
            len(words) == 1
            and words[0].lower() in {"he", "she", "they", "it", "this", "that", "these", "those"}
        ) or (
            len(words) == 2
            and words[0].lower() in {"a", "an", "the", "this", "that", "these", "those"}
        )
        if clean and not orphaned_subject and not re.search(
            r"\b(?:but|and|or|with|to|as|while)$", clean, flags=re.IGNORECASE
        ):
            # A protected exact dialogue quote already carries its own user-
            # owned terminal punctuation. Do not manufacture ``\".`` or
            # ``?”.`` after the closing quote at the provider boundary.
            kept.append(clean if re.search(r"§Q\d+§$", clean) else clean.rstrip(". ") + ".")
    result = " ".join(kept).strip()
    for index, quoted in enumerate(quoted_values):
        result = result.replace(f"§Q{index}§", quoted)
    return result


def _combine_camera_and_framing(camera: str, framing: str) -> str:
    """Return one concise camera row in the canonical camera-then-framing order."""
    camera_value = _metadata_limit(camera, 140) if camera else ""
    framing_value = _metadata_limit(framing, 160) if framing else ""
    if camera_value and framing_value:
        combined = f"{camera_value.rstrip('. ')}; {framing_value}"
    elif camera_value or framing_value:
        combined = camera_value or framing_value
    else:
        combined = "Purposeful production angle; readable subject and environment."
    return _ensure_camera_contract(combined)


def _ensure_camera_contract(value: str) -> str:
    """Fill only missing generic camera semantics; never invent story content."""

    text = _clean_spaces(value).strip(" .")
    camera, framing = (part.strip() for part in text.split(";", 1)) if ";" in text else (text, "")
    missing = storyboard_camera_contract_missing(text)
    defaults = {
        "angle": "neutral eye-level angle",
        "movement": "static",
        "lens": "natural lens",
    }
    camera_parts = [camera] if camera else []
    camera_parts.extend(defaults[component] for component in missing)
    combined = ", ".join(part.strip(" .") for part in camera_parts if part.strip(" ."))
    if framing:
        combined = f"{combined}; {framing.strip(' .')}"
    return combined.rstrip(" .") + "."


def _fit_combined_camera(value: str, max_chars: int) -> str:
    """Shorten both halves of a merged CAMERA row instead of dropping framing."""
    value = _ensure_camera_contract(value)
    direct = _metadata_limit(value, max_chars)
    if (
        direct
        and len(direct) <= max_chars
        and not storyboard_camera_contract_missing(direct)
    ):
        return direct
    compact_contract = compact_storyboard_camera_contract(value)
    if ";" in value and len(compact_contract) + 3 < max_chars:
        framing = value.split(";", 1)[1].strip()
        framing_budget = max_chars - len(compact_contract) - 2
        framing_value = _metadata_limit(framing, framing_budget)
        combined = f"{compact_contract.rstrip('. ')}; {framing_value}" if framing_value else ""
        if combined and len(combined) <= max_chars:
            return combined
    if len(compact_contract) <= max_chars:
        return compact_contract
    if ";" not in value or max_chars < 40:
        return direct
    camera, framing = (part.strip() for part in value.split(";", 1))
    available = max_chars - 2
    camera_budget = max(24, int(available * 0.6))
    framing_budget = max(14, available - camera_budget)
    camera_value = _metadata_limit(camera, camera_budget)
    framing_value = _metadata_limit(framing, framing_budget)
    if camera_value and framing_value:
        combined = f"{camera_value.rstrip('. ')}; {framing_value}"
        if (
            len(combined) <= max_chars
            and not storyboard_camera_contract_missing(combined)
        ):
            return combined
    combined = camera_value or framing_value or direct
    if (
        combined
        and len(combined) <= max_chars
        and not storyboard_camera_contract_missing(combined)
    ):
        return combined
    bounded_contract = _metadata_limit(compact_contract, max_chars)
    return bounded_contract if len(bounded_contract) <= max_chars else ""


def _fit_action_value(value: str, max_chars: int) -> str:
    """Keep a concise causal/state-change tail when the whole ACTION will not fit."""
    compact = _metadata_limit(value, max_chars)
    dangling_tail = re.compile(
        r"\s+(?:a|aft|an|after|along|around|before|forward|fully|her|his|its|partly|port|rear|"
        r"starboard|successive|the|their|until|visibly)$",
        flags=re.IGNORECASE,
    )

    def trim_fragment_tail(candidate: str) -> str:
        stem = _clean_spaces(candidate).rstrip(" .,:;-")
        while stem and dangling_tail.search(stem):
            stem = dangling_tail.sub("", stem).rstrip(" .,:;-")
        return f"{stem}." if stem else ""

    def complete(candidate: str) -> bool:
        return bool(
            candidate
            and len(candidate) <= max_chars
            and not storyboard_metadata_value_is_semantic_fragment("ACTION", candidate)
        )

    if len(_clean_spaces(value)) <= max_chars:
        if complete(compact):
            return compact
        trimmed = trim_fragment_tail(compact)
        if complete(trimmed):
            return trimmed
    comma_parts = [part.strip(" ,;:-") for part in _clean_spaces(value).split(",") if part.strip(" ,;:-")]
    for count in range(len(comma_parts), 0, -1):
        candidate = ", ".join(comma_parts[:count]).rstrip(" ,;:-") + "."
        if complete(candidate):
            return candidate
    for connector in (" as ", " while ", " after ", " before "):
        if connector not in value.lower():
            continue
        prefix, tail = re.split(connector, value, maxsplit=1, flags=re.IGNORECASE)
        if connector == " while ":
            # In ordinary action prose, the clause before ``while`` is the
            # primary visible state/action and the tail is concurrent
            # background activity. Preserve that primary clause first.
            prefix_value = _metadata_limit(prefix, max_chars)
            if prefix_value and not storyboard_metadata_value_is_semantic_fragment("ACTION", prefix_value):
                available = max_chars - len(prefix_value) - 2
                tail_value = _metadata_limit(tail, available) if available > 8 else ""
                if tail_value and not storyboard_metadata_value_is_semantic_fragment("ACTION", tail_value):
                    combined = f"{prefix_value.rstrip('. ')}; {tail_value}"
                    if complete(combined):
                        return combined
                return prefix_value
        tail_value = _metadata_limit(tail, max_chars)
        if not tail_value or storyboard_metadata_value_is_semantic_fragment("ACTION", tail_value):
            continue
        available = max_chars - len(tail_value) - 2
        prefix_value = _metadata_limit(prefix, available) if available > 8 else ""
        if prefix_value and not storyboard_metadata_value_is_semantic_fragment("ACTION", prefix_value):
            combined = f"{prefix_value.rstrip('. ')}; {tail_value}"
            if complete(combined):
                return combined
        if complete(tail_value):
            return tail_value
    if complete(compact):
        return compact
    trimmed = trim_fragment_tail(compact)
    return trimmed if complete(trimmed) else ""


def _fit_shot_value(value: str, max_chars: int) -> str:
    """Keep the single above-image SHOT heading concise and grammatically closed."""

    text = _clean_spaces(value)
    fitted = _metadata_limit(text, max_chars) if len(text) > max_chars else text
    prefix_match = re.match(r"^(?P<prefix>\d{1,2}\s*[—-]\s*)(?P<body>.*)$", fitted)
    prefix = prefix_match.group("prefix") if prefix_match else ""
    body = prefix_match.group("body") if prefix_match else fitted
    dangling = re.compile(
        r"\s+(?:a|an|and|as|at|before|for|from|in|into|of|on|or|the|to|"
        r"until(?:\s+(?:a|an|one|the))?|while|with)$",
        flags=re.IGNORECASE,
    )
    had_dangling = bool(dangling.search(body.rstrip(" .,:;-")))
    if had_dangling and "," in body:
        body = body.split(",", 1)[0]
    stem = body.rstrip(" .,:;-")
    while stem and dangling.search(stem):
        stem = dangling.sub("", stem).rstrip(" .,:;-")
    return f"{prefix}{stem}".strip() if stem else ""


def compact_storyboard_display_value(label: str, value: str, max_chars: int) -> str:
    """Compact a generated display field at complete semantic boundaries.

    DIALOG and NOTES are user-owned and intentionally excluded by callers.
    The typed sheet compiler remains the final semantic and length validator.
    """

    normalized_label = str(label or "").strip().upper()
    if normalized_label == "CAMERA":
        return _fit_combined_camera(value, max_chars)
    if normalized_label == "SHOT":
        return _fit_shot_value(value, max_chars)
    if normalized_label in {"ACTION", "MOTION"}:
        return _fit_action_value(value, max_chars)
    return _metadata_limit(value, max_chars)


def _extract_reference_lock(text: str) -> str:
    anchor_pattern = re.compile(
        r"\b(?:use|treat)\s+(?:connected\s+)?(?P<token>@image[123])\b",
        flags=re.IGNORECASE,
    )
    anchors = list(anchor_pattern.finditer(text))
    anchored_refs: dict[str, str] = {}
    for index, match in enumerate(anchors):
        token = match.group("token").lower()
        next_anchor = anchors[index + 1].start() if index + 1 < len(anchors) else len(text)
        paragraph_end = text.find("\n\n", match.end())
        segment_end = min(next_anchor, paragraph_end) if paragraph_end >= 0 else next_anchor
        segment = text[match.start() : segment_end].strip(" \t\r\n;,.:")
        if token not in anchored_refs and segment:
            anchored_refs[token] = _sentence_limit(segment, 210)
    if anchored_refs:
        return _sentence_limit(
            " ".join(anchored_refs[token] for token in ("@image1", "@image2", "@image3") if token in anchored_refs),
            700,
        )

    paragraphs = [paragraph for paragraph in re.split(r"\n\s*\n", text) if _clean_spaces(paragraph)]
    refs: List[str] = []
    used_paragraphs: set[str] = set()
    for token in ("@image1", "@image2", "@image3"):
        candidates = [candidate for candidate in paragraphs if token in candidate]
        paragraph = next(
            (
                candidate
                for candidate in candidates
                if re.search(rf"\b(?:use|treat)\s+{re.escape(token)}\b", candidate, flags=re.IGNORECASE)
            ),
            candidates[0] if candidates else "",
        )
        if not paragraph or paragraph in used_paragraphs:
            continue
        used_paragraphs.add(paragraph)
        refs.append(_sentence_limit(paragraph, 220))
    return _sentence_limit(" ".join(refs), 700)


def _extract_panel_capsules(text: str, *, max_panels: int = 16) -> List[str]:
    for number, heading in enumerate(
        (
            r"TOP[\s_-]+LEFT",
            r"TOP[\s_-]+(?:CENTER|MIDDLE)",
            r"TOP[\s_-]+RIGHT",
            r"BOTTOM[\s_-]+LEFT",
            r"BOTTOM[\s_-]+(?:CENTER|MIDDLE)",
            r"BOTTOM[\s_-]+RIGHT",
        ),
        start=1,
    ):
        text = re.sub(
            rf"(?im)^(\s*){heading}\s+PANEL(?:\s+IMAGE)?\s*:\s*",
            rf"\1PANEL {number}: ",
            text,
        )
    text = re.sub(
        r"(?im)^(\s*)SHOT\s+0?(\d{1,2})\s+image\s*[:\-—]\s*",
        r"\1PANEL \2: ",
        text,
    )
    text = re.sub(
        r"(?im)^(\s*)CELL\s+0?(\d{1,2})(?:\s+image)?\s*[:\-—]\s*",
        r"\1PANEL \2: ",
        text,
    )
    text = re.sub(
        r"(?im)^(\s*)PANEL\s+0?(\d{1,2})\s+image\s+and\s+metadata\s*:\s*",
        r"\1PANEL \2: ",
        text,
    )
    text = re.sub(
        r"(?im)^(\s*)PANEL\s+0?(\d{1,2})\s+image\s*[:\-—]\s*",
        r"\1PANEL \2: ",
        text,
    )
    text = re.sub(
        r"(?im)^(\s*)PANEL\s+0?(\d{1,2})\s*$",
        r"\1PANEL \2:",
        text,
    )
    panel_prefix = r"(?:\d+\.\s*)?(?:PANEL|Panel)\s+0?\d{1,2}\s*[:\-—]"
    pattern = re.compile(
        r"(?:^|\n)\s*(?:\d+\.\s*)?(?:PANEL|Panel)\s+0?(\d{1,2})\s*[:\-—]\s*(.*?)(?=(?:\n\s*"
        + panel_prefix
        + r")|\Z)",
        re.DOTALL,
    )
    capsules: List[str] = []
    for match in pattern.finditer(text):
        number = int(match.group(1))
        body = match.group(2)
        raw_fields: dict[str, str] = {}
        matched_field_count = 0
        for label, pattern_label, limit in (
            ("SHOT", "SHOT", 100),
            ("CAMERA", "CAMERA", 220),
            ("FRAMING", "FRAMING", 240),
            ("ACTION", "ACTION", 300),
            ("MOTION", "MOTION|ANIMATION", 240),
            ("DIALOG", "DIALOGUE|DIALOG", 220),
            ("NOTES", "CONTINUITY|NOTES", 260),
        ):
            line_field_match = re.search(
                rf"^[ \t]*(?:{pattern_label})[ \t]*:[ \t]*([^\r\n]*)",
                body,
                flags=re.IGNORECASE | re.MULTILINE,
            )
            field_match = line_field_match or re.search(
                rf"\b(?:{pattern_label})\s*:\s*(.*?)(?=\s+\b(?:SHOT|CAMERA|FRAMING|ACTION|MOTION|DIALOGUE|DIALOG|SFX/AUDIO|SFX|AUDIO|ANIMATION|CONTINUITY|NOTES)\s*:|$)",
                body,
                flags=re.IGNORECASE | re.DOTALL,
            )
            field_value = field_match.group(1) if field_match else ""
            field_value = positive_visual_directive(_strip_nonvisual_future_clauses(field_value))
            if field_match:
                matched_field_count += 1
            raw_fields[label] = _metadata_limit(field_value, limit)
        if matched_field_count < 4:
            continue

        raw_fields["CAMERA"] = _combine_camera_and_framing(
            raw_fields.get("CAMERA", ""), raw_fields.get("FRAMING", "")
        )
        # Keep required narrative roles independent. Missing ACTION, MOTION, or
        # NOTES must remain missing so the shared preflight can stop before a
        # paid provider request instead of masking the recipe defect.
        fields: List[tuple[str, str]] = []
        for label, limit in (
            ("SHOT", 100),
            ("CAMERA", 300),
            ("ACTION", 300),
            ("MOTION", 240),
            ("DIALOG", 220),
            ("NOTES", 260),
        ):
            value = _metadata_limit(raw_fields.get(label, ""), limit)
            value = value.replace("glass shards", "safe glass fragments")
            value = value.replace("broken glass", "safe glass fragments")
            if value and value.lower() not in {"none.", "none"}:
                fields.append((label, value))
            else:
                fields.append((label, ""))
        capsule = "; ".join(f"{label}: {value}".rstrip() for label, value in fields)
        if capsule:
            capsules.append(f"{number:02d}: {capsule}")
        if len(capsules) >= max_panels:
            break
    return capsules


def _fit_panel_capsule(capsule: str, *, max_chars: int) -> str:
    number_match = re.match(r"(?P<number>\d{2}):\s*", capsule)
    number = number_match.group("number") if number_match else "00"
    fields: list[tuple[str, str]] = []
    for label in ("SHOT", "CAMERA", "ACTION", "MOTION", "DIALOG", "NOTES"):
        match = re.search(
            rf"\b{label}:\s*(.*?)(?=;\s*(?:SHOT|CAMERA|ACTION|MOTION|DIALOG|NOTES):|$)",
            capsule,
            flags=re.IGNORECASE,
        )
        field_value = _clean_spaces(match.group(1)) if match else ""
        fields.append((label, _ensure_camera_contract(field_value) if label == "CAMERA" else field_value))

    def render(values: list[tuple[str, str]]) -> str:
        return f"{number}: " + "; ".join(f"{label}: {value}".rstrip() for label, value in values)

    def repair_semantic_fragments(
        fitted_values: list[tuple[str, str]],
        budgets_by_label: dict[str, int],
    ) -> list[tuple[str, str]]:
        source_values = dict(fields)
        repaired_values = dict(fitted_values)

        def complete_candidate(label: str, value: str, budget: int) -> str:
            if not value or budget <= 0:
                return ""
            same_field_candidates = [value]
            same_field_candidates.extend(
                clause.strip()
                for clause in re.split(r";|,\s*(?:(?:and|but|then|while)\s+)?", value)
                if clause.strip() and clause.strip() != value.strip()
            )
            for same_field_value in same_field_candidates:
                lower_bound = max(8, min(budget, len(same_field_value)) // 2)
                for candidate_budget in range(min(budget, len(same_field_value)), lower_bound - 1, -1):
                    compact = _metadata_limit(same_field_value, candidate_budget)
                    if compact and not storyboard_metadata_value_is_semantic_fragment(label, compact):
                        return compact
            return ""

        current_shot = repaired_values.get("SHOT", "")
        if not storyboard_shot_has_meaningful_description(current_shot):
            shot_budget = max(16, budgets_by_label.get("SHOT", len(current_shot)))
            for source_label in ("ACTION", "MOTION", "NOTES"):
                candidate = _metadata_limit(source_values.get(source_label, ""), max(8, shot_budget - 5))
                if not candidate:
                    continue
                repaired_shot = _metadata_limit(f"{number} — {candidate}", shot_budget)
                if storyboard_shot_has_meaningful_description(repaired_shot):
                    repaired_values["SHOT"] = repaired_shot
                    break

        for label in ("ACTION", "MOTION", "NOTES"):
            current = repaired_values.get(label, "")
            if not storyboard_metadata_value_is_semantic_fragment(label, current):
                continue
            budget = max(0, budgets_by_label.get(label, len(current)))
            candidates = [source_values.get(label, "")]
            for candidate in candidates:
                compact_candidate = complete_candidate(label, candidate, budget)
                if compact_candidate:
                    repaired_values[label] = compact_candidate
                    break
        return [(label, repaired_values.get(label, "")) for label, _ in fitted_values]

    # Repair before allocating the capsule budget. A source fragment such as
    # ``Pilot.`` cannot become a meaningful clause inside its original six
    # characters; give required narrative rows the same small readability
    # floor used below, then let the normal allocator reclaim that space from
    # longer rows while preserving exact dialogue.
    fields = repair_semantic_fragments(
        fields,
        {
            label: (
                max(len(value), 64)
                if label in {"ACTION", "MOTION", "NOTES"}
                else max(len(value), 48)
                if label == "SHOT"
                else len(value)
            )
            for label, value in fields
        },
    )
    rendered = render(fields)
    if len(rendered) <= max_chars:
        return rendered

    fixed_chars = len(render([(label, "") for label, _ in fields]))
    value_budget = max(0, max_chars - fixed_chars)
    values = dict(fields)
    # Preserve a useful shot/camera anchor and the exact user-owned spoken line
    # before distributing the remaining space. CAMERA includes both the camera
    # direction and former framing language.
    budgets = {label: 0 for label, _ in fields}
    remaining_budget = value_budget
    dialogue_budget = len(values.get("DIALOG", ""))
    budgets["DIALOG"] = min(dialogue_budget, remaining_budget)
    remaining_budget -= budgets["DIALOG"]

    # Reserve complete semantic clauses for the three narrative rows before
    # spending space on verbose shot/camera prose. A repair can be longer than
    # the malformed source (for example ``The pilot closes`` may fall back to
    # ``The panel settles flush``), so allocating camera first can recreate a
    # fragment in NOTES even after the initial repair succeeded.
    def minimum_complete_budget(label: str, value: str) -> int:
        if not value:
            return 0
        for candidate_budget in range(8, len(value) + 1):
            candidate = (
                _fit_action_value(value, candidate_budget)
                if label == "ACTION"
                else _metadata_limit(value, candidate_budget)
            )
            if candidate and not storyboard_metadata_value_is_semantic_fragment(label, candidate):
                return candidate_budget
        return len(value)

    def minimum_camera_budget(value: str) -> int:
        if not value:
            return 0
        requires_framing = ";" in value
        for candidate_budget in range(40, len(value) + 1):
            candidate = _fit_combined_camera(value, candidate_budget)
            if (
                candidate
                and not storyboard_camera_contract_missing(candidate)
                and (not requires_framing or ";" in candidate)
            ):
                return candidate_budget
        return len(value)

    camera_minimum = min(minimum_camera_budget(values.get("CAMERA", "")), remaining_budget)
    budgets["CAMERA"] = camera_minimum
    remaining_budget -= camera_minimum

    for label in ("ACTION", "MOTION", "NOTES"):
        allocation = min(
            minimum_complete_budget(label, values.get(label, "")),
            remaining_budget,
        )
        budgets[label] = allocation
        remaining_budget -= allocation

    shot_floor = min(len(values.get("SHOT", "")), 32, remaining_budget)
    budgets["SHOT"] = shot_floor
    remaining_budget -= shot_floor
    camera_extra = min(max(0, 64 - budgets["CAMERA"]), remaining_budget)
    budgets["CAMERA"] += camera_extra
    remaining_budget -= camera_extra

    preferred_minimums = {"ACTION": 144, "MOTION": 60, "NOTES": 44}
    for label in ("ACTION", "MOTION", "NOTES"):
        preferred_extra = max(0, preferred_minimums[label] - budgets[label])
        allocation = min(
            max(0, len(values.get(label, "")) - budgets[label]),
            preferred_extra,
            remaining_budget,
        )
        budgets[label] += allocation
        remaining_budget -= allocation

    weights = {"SHOT": 1, "CAMERA": 2, "ACTION": 4, "MOTION": 2, "NOTES": 2}
    while remaining_budget > 0:
        expandable = [
            label
            for label in weights
            if budgets[label] < len(values.get(label, ""))
        ]
        if not expandable:
            break
        weight_total = sum(weights[label] for label in expandable)
        progressed = False
        for label in expandable:
            share = max(1, int(remaining_budget * weights[label] / weight_total))
            added = min(share, len(values.get(label, "")) - budgets[label], remaining_budget)
            budgets[label] += added
            remaining_budget -= added
            progressed = progressed or added > 0
            if remaining_budget <= 0:
                break
        if not progressed:
            break

    fitted: list[tuple[str, str]] = []
    for label, value in fields:
        limit = budgets[label]
        if label == "CAMERA" and value and limit:
            fitted.append((label, _fit_combined_camera(value, limit)))
        elif label == "ACTION" and value and limit:
            fitted.append((label, _fit_action_value(value, limit)))
        else:
            fitted.append((label, _metadata_limit(value, limit) if value and limit else ""))
    return render(repair_semantic_fragments(fitted, budgets))


def _storyboard_prompt_has_semantic_fragments(prompt: str) -> bool:
    if storyboard_metadata_semantic_fragments(prompt):
        return True
    for capsule in compact_storyboard_metadata_capsules(prompt):
        match = re.search(r"\bCAMERA:\s*(.*?)(?=;\s*(?:ACTION|MOTION|DIALOG|NOTES):|$)", capsule, flags=re.IGNORECASE)
        if match and storyboard_camera_contract_missing(match.group(1)):
            return True
    return False


def _normalize_compact_storyboard_metadata(prompt: str) -> str:
    marker = re.search(r"Panel plan with metadata rows\s*:\s*", prompt, flags=re.IGNORECASE)
    capsules = compact_storyboard_metadata_capsules(prompt)
    if not marker or not capsules:
        return prompt
    continuity = re.search(r"\n\s*\nContinuity\s*:", prompt[marker.end() :], flags=re.IGNORECASE)
    panel_end = marker.end() + continuity.start() if continuity else len(prompt)
    normalized_capsules = [
        _fit_panel_capsule(capsule, max_chars=len(capsule))
        for capsule in capsules
    ]
    return prompt[: marker.end()] + " | ".join(normalized_capsules) + prompt[panel_end:]


def _fit_panel_capsules_to_budget(capsules: List[str], *, total_chars: int) -> List[str]:
    """Spend the whole panel budget while preserving dialogue-heavy cells.

    Equal per-cell limits leave unused space when silent or concise panels fit
    early, while a dialogue cell can lose CAMERA/MOTION metadata. Reallocate
    that unused capacity to cells that still have complete source text.
    """
    if not capsules:
        return []
    separator_chars = 3 * (len(capsules) - 1)  # len(" | ")
    content_budget = max(len(capsules) * 130, total_chars - separator_chars)
    budgets = [max(130, content_budget // len(capsules)) for _ in capsules]
    dialogue_indexes = [
        index for index, capsule in enumerate(capsules) if bool(re.search(r"\bDIALOG:\s*[^;|\s]", capsule))
    ]
    silent_indexes = [index for index in range(len(capsules)) if index not in dialogue_indexes]
    if dialogue_indexes and silent_indexes:
        donor_floor = max(252, int(budgets[0] * 0.80))
        available_total = sum(max(0, budgets[index] - donor_floor) for index in silent_indexes)
        bonus_each = min(160, available_total // len(dialogue_indexes))
        for dialogue_index in dialogue_indexes:
            needed = bonus_each
            for donor_index in silent_indexes:
                available = max(0, budgets[donor_index] - donor_floor)
                transfer = min(available, needed)
                budgets[donor_index] -= transfer
                budgets[dialogue_index] += transfer
                needed -= transfer
            if needed <= 0:
                break
    fitted = [_fit_panel_capsule(capsule, max_chars=budget) for capsule, budget in zip(capsules, budgets)]

    while True:
        used = sum(len(panel) for panel in fitted)
        remaining = content_budget - used
        # A fitted capsule can remain shorter than its source even after it has
        # received the full source-length budget because normalization removes
        # redundant punctuation or replaces a fragment with a shorter complete
        # clause. Track allocatable budget headroom—not rendered-length delta—
        # so that semantic normalization cannot leave this redistribution loop
        # expanding an already-saturated capsule forever.
        deficits = [max(0, len(capsule) - budget) for capsule, budget in zip(capsules, budgets)]
        expandable = [index for index, deficit in enumerate(deficits) if deficit > 0]
        if remaining <= 0 or not expandable:
            break
        # Dialogue cells receive the first claim on spare capacity so an exact
        # spoken line remains intact alongside the reserved camera/action data.
        expandable.sort(
            key=lambda index: (
                bool(re.search(r"\bDIALOG:\s*[^;|\s]", capsules[index])),
                deficits[index],
            ),
            reverse=True,
        )
        progressed = False
        for index in expandable:
            share = max(8, remaining // len(expandable))
            added = min(share, deficits[index], remaining)
            if added <= 0:
                continue
            budgets[index] += added
            fitted[index] = _fit_panel_capsule(capsules[index], max_chars=budgets[index])
            remaining = content_budget - sum(len(panel) for panel in fitted)
            progressed = True
            if remaining <= 0:
                break
        if not progressed:
            break
    return fitted


def _normalize_storyboard_title(value: str) -> str:
    title = _clean_spaces(value).rstrip(" ,;:-")
    match = re.match(
        r"^(?P<core>.+?)\s*[—-]\s*(?:board\s*)?(?P<index>\d+)\s+of\s+(?P<total>\d+)$",
        title,
        flags=re.IGNORECASE,
    )
    if not match:
        match = re.match(
            r"^(?P<core>.+)\s*[—-]\s*(?P<label>(?!board\b)[^—\d]{1,50})\s+(?P<index>\d+)\s+of\s+(?P<total>\d+)$",
            title,
            flags=re.IGNORECASE,
        )
    if match:
        return f"{match.group('core').strip()} — BOARD {match.group('index')} OF {match.group('total')}"
    return title


def _extract_title(text: str) -> str:
    titled_match = re.search(
        r"\btitled(?:\s+exactly)?\s+[\"“](.+?)[\"”]",
        text,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if titled_match:
        title = _normalize_storyboard_title(titled_match.group(1))
        trailing = text[titled_match.end() : titled_match.end() + 60]
        suffix_match = re.match(
            r"\s*,?\s*(?:[—-]\s*)?BOARD\s+(\d+)\s+OF\s+(\d+)",
            trailing,
            flags=re.IGNORECASE,
        )
        if suffix_match and not re.search(r"\bBOARD\s+\d+\s+OF\s+\d+\b", title, flags=re.IGNORECASE):
            title = f"{title.rstrip(' ,;:-')} — BOARD {suffix_match.group(1)} OF {suffix_match.group(2)}"
        return _sentence_limit(title, 140)
    for pattern in (
        r"top header band reading\s+[\"“](.+?)[\"”]",
        r"TITLE:\s*[\"“]?(.+?)(?:[\"”]?[;|\n]|$)",
        r"Create\s+(?:a|an)\s+(.+?)(?:\.|\n)",
    ):
        match = re.search(pattern, text, flags=re.IGNORECASE | re.DOTALL)
        if match:
            return _sentence_limit(_normalize_storyboard_title(match.group(1)), 140)
    return ""


def _looks_like_environment_prompt(text: str) -> bool:
    normalized = text.lower()
    return any(
        phrase in normalized
        for phrase in (
            "environment continuity sheet",
            "environment reference sheet",
            "environment design sheet",
            "production-ready environment",
            "environment-only",
            "environment only",
            "location continuity",
            "key zones:",
            "layout mode:",
        )
    )


def _looks_like_storyboard_prompt(text: str) -> bool:
    signal_text = re.sub(
        r"\b(?:no|avoid|without)\s+(?:any\s+)?storyboards?(?:\s+panels?)?",
        "",
        text,
        flags=re.IGNORECASE,
    )
    return bool(
        re.search(
            r"\b(?:PANEL|Panel|CELL|Cell)\s+0?\d{1,2}(?:\s+image(?:\s+and\s+metadata)?)?\s*[:\-—]",
            signal_text,
            flags=re.IGNORECASE,
        )
    ) or bool(
        re.search(r"(?im)^\s*(?:PANEL|CELL)\s+0?\d{1,2}\s*$", signal_text)
    ) or bool(
        re.search(
            r"\b(?:TOP|BOTTOM)[\s_-]+(?:LEFT|CENTER|MIDDLE|RIGHT)\s+PANEL(?:\s+IMAGE)?\s*:",
            signal_text,
            flags=re.IGNORECASE,
        )
    ) or bool(
        re.search(
            r"\b(?:storyboard\s+(?:production\s+)?(?:sheet|grid|panel|panels|cell|cells|layout)|numbered\s+panel\s+grid|panel\s+plan)\b",
            signal_text,
            flags=re.IGNORECASE,
        )
    ) or (
        bool(re.search(r"(?im)^\s*PANEL COUNT\s*:\s*\d+\s*$", signal_text))
        and all(re.search(rf"(?im)^\s*{label}\s*:", signal_text) for label in ("SHOT", "CAMERA", "ACTION", "MOTION", "DIALOG", "NOTES"))
    )


def _looks_like_time_freeze_prompt(text: str) -> bool:
    signal_text = re.sub(
        r"\b(?:no|avoid|without)\s+(?:any\s+)?(?:time[-\s]?freeze|freeze trigger|frozen objects?|stopped time)\b",
        "",
        text,
        flags=re.IGNORECASE,
    )
    return bool(
        re.search(
            r"\b(?:time[-\s]?freeze|freeze trigger|freeze activation|finger snap|reverse snap|frozen suspended|stopped time)\b",
            signal_text,
            flags=re.IGNORECASE,
        )
    )


def _story_specific_time_freeze_text(text: str) -> str:
    briefs = re.findall(
        r"(?:^|\n)\s*(?:USER STORY BRIEF|CONTINUATION BRIEF)\s*:\s*(.*?)(?=\n\s*\n|\Z)",
        text,
        flags=re.IGNORECASE | re.DOTALL,
    )
    story_text = " ".join(_clean_spaces(brief) for brief in briefs if _clean_spaces(brief))
    return story_text or text


def _compact_environment_prompt(prompt: str, *, target_chars: int) -> str:
    intro = (
        "Create one clean 16:9 cinematic environment continuity/reference sheet. "
        "Environment only: no people, characters, faces, bodies, dialogue rows, SFX rows, storyboard panels, or time-freeze sequence. "
        "Show one consistent location with readable zones, materials, lighting, scale cues, and continuity anchors."
    )
    return _sentence_limit(f"{intro}\n\n{prompt}", target_chars)


def _storyboard_panel_layout(
    prompt: str,
    *,
    extracted_panel_count: int | None = None,
) -> tuple[int, str]:
    match = re.search(
        r"\b(?:PANEL|SHOT)\s+COUNT\s*:\s*(4|6|9)\b",
        prompt,
        flags=re.IGNORECASE,
    )
    if match:
        panel_count = int(match.group(1))
    elif extracted_panel_count in {4, 6, 9}:
        panel_count = extracted_panel_count
    else:
        inline_match = re.search(
            r"\b(?:SHOTS?\s*:\s*|exactly\s+|one\s+)(4|6|9)(?:\s*[- ]panel|\s+panels?|\s+shots?\b)",
            prompt,
            flags=re.IGNORECASE,
        )
        panel_count = int(inline_match.group(1)) if inline_match else 6
    return panel_count, {4: "2x2", 6: "3x2", 9: "3x3"}[panel_count]


def _compact_storyboard_prompt(prompt: str, *, target_chars: int) -> str:
    panels = _extract_panel_capsules(prompt)
    panel_count, grid_layout = _storyboard_panel_layout(
        prompt,
        extracted_panel_count=len(panels),
    )
    title = _extract_title(prompt)
    board_match = re.search(
        r"\bBOARD\s+(\d+)\s+OF\s+(\d+)\b",
        " ".join(part for part in (title, prompt[:1200]) if part),
        flags=re.IGNORECASE,
    )
    leading_board_match = re.match(r"^BOARD\s+(\d+)\s*[—-]", title, flags=re.IGNORECASE)
    board_number = int(board_match.group(1)) if board_match else int(leading_board_match.group(1)) if leading_board_match else None
    reference_lock = _extract_reference_lock(prompt)
    dialogue_values = []
    for panel in panels:
        dialogue_match = re.search(r"\bDIALOG:\s*([^;|]*)", panel, flags=re.IGNORECASE)
        if dialogue_match and _clean_spaces(dialogue_match.group(1)):
            dialogue_values.append(_clean_spaces(dialogue_match.group(1)))
    is_time_freeze = _looks_like_time_freeze_prompt(_story_specific_time_freeze_text(prompt))
    handoff_advance = _extract_user_owned_directive(prompt, "HANDOFF ADVANCE", max_chars=220)
    board_title_directive = _extract_user_owned_directive(prompt, "BOARD TITLE", max_chars=180)
    production_metadata = _extract_user_owned_directive(prompt, "PRODUCTION METADATA", max_chars=300)
    dialogue_cues = _extract_user_owned_directive(prompt, "DIALOGUE CUES", max_chars=260)
    wardrobe_directive = _extract_user_owned_directive(prompt, "WARDROBE CUES", max_chars=340) or _extract_user_owned_directive(
        prompt, "USER WARDROBE", max_chars=340
    )
    subject_design_cues = _extract_user_owned_directive(prompt, "SUBJECT DESIGN CUES", max_chars=460)
    identity_wardrobe_lock = ""
    if re.search(r"@image1\b", prompt, flags=re.IGNORECASE):
        identity_wardrobe_lock = (
            "@image1 locks recognizable identity and subject construction; user wardrobe directions define the clothing. "
        )
    environment_authority_lock = ""
    if re.search(r"@image2\b", prompt, flags=re.IGNORECASE):
        environment_authority_lock = (
            "@image2 is the spatial, vehicle, material, geography, and lighting authority, locking routes, landmarks, orientation, and depth. "
        )
    handoff_match_lock = ""
    if board_number in {2, 3} and re.search(
        r"@image3\b", prompt, flags=re.IGNORECASE
    ):
        handoff_match_lock = (
            "Handoff continuity: @image3 locks prior Panel 06; Panel 01 preserves that state, then advances one visible action with a purposeful "
            "camera or movement delta. "
        )
    intro = (
        f"Footer-free 16:9 fixed sequence template. Every one of the {panel_count} cells contains a finished photoreal live-action cinematic image: a feature-film production still photographed on a physical set with real lens optics, natural skin and material texture, physically plausible production lighting, atmospheric depth, and clean production typography outside the image. "
        f"LAYOUT: upper-left title; top PROJECT, SEQUENCE, LOCATION, DATE, ARTIST strip; exact {grid_layout} grid; identical borders, image sizes, row heights, metadata proportions, spacing, typography, dark chrome, yellow rules. "
        "Under each image use six separate full-width horizontal rows stacked vertically in SHOT, CAMERA, ACTION, MOTION, DIALOG, NOTES order. Use one label and value per row. Copy every label exactly and completely in every cell; spell each label exactly and completely. CAMERA starts with angle, movement, lens. Only silent DIALOG may be blank; every other row value must be non-empty and may not use a placeholder. "
        "Each image begins below its border; the SHOT row is the only per-panel title region. "
        f"{'Exact DIALOG text stays verbatim, complete, and assigned to one row. ' if dialogue_values else ''}"
        f"{'Each spoken row uses its supplied SPEAKER [voice hint] and identifies its speaker explicitly. ' if dialogue_values else ''}"
        f"{'@image1 locks recognizable identity and subject construction; user wardrobe directions define the clothing. ' if identity_wardrobe_lock else ''}"
        f"{'@image2 is the spatial, vehicle, material, geography, and lighting authority. ' if environment_authority_lock else ''}"
        f"{'Handoff continuity: @image3 locks prior Panel 06; Panel 01 preserves that state, then advances one visible action with a purposeful camera or movement delta. ' if handoff_match_lock else ''}"
        "Use task-focused professional framing."
    )
    if identity_wardrobe_lock and reference_lock:
        reference_lock = re.sub(
            r"\bUse @image1\b.*?(?=@image[234]\b|$)",
            "@image1 supplies recognizable identity and subject construction. ",
            reference_lock,
            flags=re.IGNORECASE,
        ).strip()
    if handoff_match_lock and reference_lock:
        reference_lock = re.sub(
            r"\b(?:Use|Treat) @image3\b.*$",
            "@image3 supplies the exact prior Panel 06 visual state.",
            reference_lock,
            flags=re.IGNORECASE,
        ).strip()
    reference_lock = _sentence_limit(positive_visual_directive(reference_lock), 300)

    directive_parts = []
    for label, value, limit in (
        ("User board title", board_title_directive or title, 120),
        # Visible production text is user-owned and must survive provider-budget
        # header compaction. Keep it immediately after the title so a long
        # subject or wardrobe lock cannot push it past the truncation boundary.
        ("User production metadata", production_metadata, 180),
        ("User subject design", positive_visual_directive(subject_design_cues), 380),
        ("User wardrobe", positive_visual_directive(wardrobe_directive), 300),
        ("User handoff advance", positive_visual_directive(handoff_advance), 110),
        # The exact attributed line already lives in its cell capsule. Repeat
        # the user cue only when the generated panel plan omitted it.
        ("User dialogue cues", positive_visual_directive(dialogue_cues) if not dialogue_values else "", 170),
    ):
        compact_value = _metadata_limit(value, limit) if value else ""
        if compact_value:
            directive_parts.append(f"{label}: {compact_value}")

    header_parts = [intro]
    if reference_lock and not (identity_wardrobe_lock or environment_authority_lock or handoff_match_lock):
        header_parts.append(f"Reference use: {reference_lock}")
    header_parts.extend(directive_parts)
    header = "\n\n".join(header_parts)
    continuity = "Continuity: preserve identity, wardrobe, geography, lighting, props, vehicles, and story order. "
    if is_time_freeze:
        continuity += (
            "Preserve exact causal order: NORMAL -> FREEZE TRIGGER -> FROZEN INTERVENTION -> UNFREEZE TRIGGER -> RESUMED. "
            "Show normal motion before the trigger, suspended objects during the freeze, and resumed motion after release. "
        )
    if not panels:
        fallback = _sentence_limit(positive_visual_directive(prompt), min(1600, target_chars - len(header) - 200))
        return _sentence_limit("\n\n".join(part for part in (header, fallback, continuity) if part), target_chars)

    panel_prefix = "Panel plan with metadata rows: "
    separator_chars = len("\n\n") * 2 + len(panel_prefix) + len(continuity)
    panel_budget = max(len(panels) * 150, target_chars - len(header) - separator_chars)
    fitted_panels = _fit_panel_capsules_to_budget(panels, total_chars=panel_budget)
    candidate = f"{header}\n\n{panel_prefix}{' | '.join(fitted_panels)}\n\n{continuity}"
    if len(candidate) > target_chars:
        fitted_panels = _fit_panel_capsules_to_budget(
            panels,
            total_chars=max(len(panels) * 130, panel_budget - (len(candidate) - target_chars) - len(panels) * 2),
        )
        candidate = f"{header}\n\n{panel_prefix}{' | '.join(fitted_panels)}\n\n{continuity}"
    if len(candidate) > target_chars:
        protected = f"{panel_prefix}{' | '.join(fitted_panels)}\n\n{continuity}"
        header_budget = max(320, target_chars - len(protected) - 2)
        header = _sentence_limit(header, header_budget)
        # Return the space released by header compaction to the panel owner.
        # Otherwise a final prompt can finish far below the provider budget
        # while still dropping CAMERA framing or the end of a complete action.
        reclaimed_panel_budget = max(
            len(panels) * 130,
            target_chars - len(header) - separator_chars,
        )
        fitted_panels = _fit_panel_capsules_to_budget(
            panels,
            total_chars=reclaimed_panel_budget,
        )
        candidate = f"{header}\n\n{panel_prefix}{' | '.join(fitted_panels)}\n\n{continuity}"
        if len(candidate) > target_chars:
            header = _sentence_limit(header, max(320, len(header) - (len(candidate) - target_chars)))
            candidate = f"{header}\n\n{panel_prefix}{' | '.join(fitted_panels)}\n\n{continuity}"
    return candidate


def shape_kie_graph_prompt(model_key: str, prompt: str, *, task_mode: str = "", max_chars: int | None = None) -> PromptShapeResult:
    text = str(prompt or "").strip()
    original_chars = len(text)
    normalized_model = _normalized_model_key(model_key)
    hard_limit = max_chars if isinstance(max_chars, int) and max_chars > 0 else None
    target_chars = GPT_IMAGE_2_COMPACT_PROMPT_CHARS
    if hard_limit is not None:
        target_chars = min(target_chars, max(1200, hard_limit - 500))
    if not normalized_model.startswith("gpt-image-2"):
        return PromptShapeResult(
            prompt=text,
            changed=False,
            strategy="none",
            original_chars=original_chars,
            final_chars=original_chars,
            target_chars=target_chars,
        )
    looks_like_storyboard = _looks_like_storyboard_prompt(text)
    if original_chars <= target_chars:
        if looks_like_storyboard and _storyboard_prompt_has_semantic_fragments(text):
            shaped = _normalize_compact_storyboard_metadata(text)
            return PromptShapeResult(
                prompt=shaped,
                changed=shaped != text,
                strategy="gpt_image_2_storyboard_metadata_normalized",
                original_chars=original_chars,
                final_chars=len(shaped),
                target_chars=target_chars,
            )
        return PromptShapeResult(
            prompt=text,
            changed=False,
            strategy="none",
            original_chars=original_chars,
            final_chars=original_chars,
            target_chars=target_chars,
        )
    looks_like_environment = not looks_like_storyboard and _looks_like_environment_prompt(text)
    if looks_like_environment:
        shaped = _compact_environment_prompt(text, target_chars=target_chars)
        strategy = "gpt_image_2_environment_compact"
    elif looks_like_storyboard:
        shaped = _compact_storyboard_prompt(text, target_chars=target_chars)
        strategy = "gpt_image_2_storyboard_compact"
    else:
        shaped = _sentence_limit(text, target_chars)
        strategy = "gpt_image_2_compact"
    return PromptShapeResult(
        prompt=shaped,
        changed=shaped != text,
        strategy=strategy,
        original_chars=original_chars,
        final_chars=len(shaped),
        target_chars=target_chars,
    )
