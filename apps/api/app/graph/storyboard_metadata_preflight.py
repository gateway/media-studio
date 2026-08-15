from __future__ import annotations

from dataclasses import dataclass
import re


STORYBOARD_METADATA_LABELS = ("SHOT", "CAMERA", "ACTION", "MOTION", "DIALOG", "NOTES")
REQUIRED_STORYBOARD_METADATA_LABELS = ("SHOT", "CAMERA", "ACTION", "MOTION", "NOTES")
STORYBOARD_NARRATIVE_METADATA_LABELS = ("ACTION", "MOTION", "NOTES")
_STORYBOARD_NARRATIVE_METADATA_PAIRS = (
    ("ACTION", "MOTION"),
    ("ACTION", "NOTES"),
    ("MOTION", "NOTES"),
)
_PLACEHOLDER_VALUES = {
    "-",
    "—",
    "n/a",
    "na",
    "no dialog",
    "no dialogue",
    "none",
    "silence",
    "silent",
}
_CONCISE_PREDICATE_WORDS = {
    "advances",
    "arrives",
    "close",
    "closes",
    "departs",
    "eases",
    "fall",
    "falls",
    "glow",
    "glides",
    "glows",
    "hold",
    "holds",
    "lock",
    "locks",
    "move",
    "moves",
    "open",
    "opens",
    "recedes",
    "resolves",
    "rise",
    "rises",
    "settle",
    "settles",
    "slide",
    "slides",
    "snap",
    "snaps",
    "stabilize",
    "stabilizes",
    "stop",
    "stops",
    "swing",
    "swings",
    "tighten",
    "tightens",
    "turn",
    "turns",
    "wait",
    "waits",
    "walk",
    "walks",
}
_LIKELY_TRANSITIVE_PREDICATES = {
    "checks",
    "closes",
    "completes",
    "finishes",
    "holds",
    "opens",
    "places",
    "preserves",
    "releases",
    "removes",
    "repairs",
    "secures",
    "starts",
}
_STRICT_TRANSITIVE_PREDICATES = {
    "grips",
    "places",
    "preserves",
    "releases",
    "removes",
    "repairs",
    "secures",
}
_CAMERA_CONTRACT_PATTERNS = {
    "angle": re.compile(
        r"\b(?:angle|aerial|bird'?s[- ]eye|eye[- ]level|front|high|low|over(?:[- ]the)?[- ]shoulder|"
        r"overhead|pov|profile|rear|shoulder[- ]height|side|three[- ]quarter|top[- ]down|waist[- ]height)\b",
        flags=re.IGNORECASE,
    ),
    "movement": re.compile(
        r"\b(?:crane|dolly|drift|handheld|locked(?:[- ]off)?|orbit|pan|pull(?:[- ]?back)?|push(?:[- ]?in)?|"
        r"rack[- ]focus|rise|slide|stabili[sz]ed|static|steady|tilt|track(?:ing)?|zoom)\b",
        flags=re.IGNORECASE,
    ),
    "lens": re.compile(
        r"\b(?:\d{1,3}\s*mm|anamorphic|depth[- ]of[- ]field|fisheye|lens|macro|telephoto|wide[- ]angle)\b",
        flags=re.IGNORECASE,
    ),
}


@dataclass(frozen=True)
class StoryboardMetadataPreflightResult:
    panel_count: int


STORYBOARD_METADATA_PROMPT_SEMANTICS = "storyboard_sheet_with_metadata"
PROMPT_SEMANTICS_WITHOUT_STORYBOARD_METADATA = {
    "environment_sheet",
    "storyboard_art_only",
    "character_reference",
    "ordinary_image_prompt",
}


def _normalized_model_key(value: str) -> str:
    return str(value or "").strip().lower().replace("_", "-")


def _looks_like_text_free_storyboard_art_source(value: str) -> bool:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return bool(
        re.search(r"\bstoryboard\s+art\s+source\s+contract\s*:", text, flags=re.IGNORECASE)
        and re.search(r"\b(?:text[- ]free|show\s+art\s+only)\b", text, flags=re.IGNORECASE)
        and re.search(
            r"\bno\b[^.]{0,160}\b(?:metadata|production[- ]sheet\s+chrome)\b",
            text,
            flags=re.IGNORECASE,
        )
    )


def _looks_like_storyboard(value: str) -> bool:
    if _looks_like_text_free_storyboard_art_source(value):
        return False
    signal = re.sub(
        r"\b(?:no|avoid|without)\s+(?:any\s+)?storyboards?(?:\s+panels?)?",
        "",
        str(value or ""),
        flags=re.IGNORECASE,
    )
    has_panel_structure = bool(
        re.search(r"\b(?:PANEL|SHOT)\s+COUNT\s*:", signal, flags=re.IGNORECASE)
        or re.search(r"\b(?:PANEL|CELL)\s+0?\d{1,2}\b", signal, flags=re.IGNORECASE)
        or re.search(r"Panel plan with metadata rows\s*:", signal, flags=re.IGNORECASE)
    )
    has_metadata_contract = all(
        re.search(rf"\b{label}\s*:", signal, flags=re.IGNORECASE)
        for label in STORYBOARD_METADATA_LABELS
    )
    return has_panel_structure and (
        bool(re.search(r"\bstoryboard\b", signal, flags=re.IGNORECASE)) or has_metadata_contract
    )


def _expected_panel_count(original_prompt: str) -> int:
    match = re.search(
        r"\b(?:PANEL|SHOT)\s+COUNT\s*:\s*(\d{1,2})\b",
        original_prompt,
        flags=re.IGNORECASE,
    )
    if not match:
        panel_numbers = [
            int(value)
            for value in re.findall(
                r"(?im)^[ \t]*(?:\d+\.\s*)?(?:PANEL|CELL)\s+0?(\d{1,2})\b",
                original_prompt,
            )
        ]
        return max(panel_numbers) if panel_numbers else 6
    count = int(match.group(1))
    if count < 1 or count > 16:
        raise ValueError(f"Storyboard preflight failed: panel count {count} is outside the supported 1-16 range.")
    return count


def _compact_panel_bodies(prompt: str) -> list[tuple[int, str]]:
    marker = re.search(r"Panel plan with metadata rows\s*:\s*", prompt, flags=re.IGNORECASE)
    if not marker:
        return []
    panel_text = prompt[marker.end() :]
    panel_text = re.split(r"\n\s*\nContinuity\s*:", panel_text, maxsplit=1, flags=re.IGNORECASE)[0]
    pattern = re.compile(
        r"(?:^|\|\s*)(?P<number>\d{1,2})\s*:\s*(?P<body>.*?)(?=\s*\|\s*\d{1,2}\s*:|$)",
        flags=re.DOTALL,
    )
    return [(int(match.group("number")), match.group("body").strip()) for match in pattern.finditer(panel_text)]


def _raw_panel_bodies(prompt: str) -> list[tuple[int, str]]:
    heading = re.compile(
        r"(?im)^[ \t]*(?:\d+\.\s*)?(?:PANEL|CELL)\s+0?(?P<number>\d{1,2})"
        r"(?:\s+IMAGE(?:\s+AND\s+METADATA)?)?\s*(?:[:\-—][ \t]*|$)",
    )
    matches = list(heading.finditer(prompt))
    return [
        (
            int(match.group("number")),
            prompt[match.end() : matches[index + 1].start() if index + 1 < len(matches) else len(prompt)].strip(),
        )
        for index, match in enumerate(matches)
    ]


def _panel_fields(body: str) -> dict[str, list[str]]:
    label_group = "|".join(STORYBOARD_METADATA_LABELS)
    pattern = re.compile(
        rf"(?:^|;[ \t]*)(?P<label>{label_group})[ \t]*:[ \t]*(?P<value>.*?)"
        rf"(?=;[ \t]*(?:{label_group})[ \t]*:|\r?\n|$)",
        flags=re.IGNORECASE | re.MULTILINE | re.DOTALL,
    )
    fields = {label: [] for label in STORYBOARD_METADATA_LABELS}
    for match in pattern.finditer(body):
        fields[match.group("label").upper()].append(re.sub(r"\s+", " ", match.group("value")).strip())
    return fields


def _placeholder_key(value: str) -> str:
    return value.strip().lower().strip(" .,:;\"'()[]")


def storyboard_camera_contract_missing(value: str) -> tuple[str, ...]:
    """Return missing generic CAMERA contract components in stable order."""

    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return tuple(
        component
        for component in ("angle", "movement", "lens")
        if not _CAMERA_CONTRACT_PATTERNS[component].search(text)
    )


def compact_storyboard_camera_contract(value: str) -> str:
    """Compress CAMERA semantics while retaining angle, movement, and lens cues."""

    text = re.sub(r"\s+", " ", str(value or "")).strip()
    angle_tokens = [
        token.lower()
        for token in _CAMERA_CONTRACT_PATTERNS["angle"].findall(text)
        if token.lower() != "angle"
    ]
    movement_tokens = [token.lower() for token in _CAMERA_CONTRACT_PATTERNS["movement"].findall(text)]
    lens_tokens = [token.lower().replace(" ", "") for token in _CAMERA_CONTRACT_PATTERNS["lens"].findall(text)]

    angle = " ".join(dict.fromkeys(angle_tokens[:2]))
    angle = f"{angle} angle" if angle else "neutral eye-level angle"
    movement = " ".join(dict.fromkeys(movement_tokens[:2])) or "locked-off frame"
    focal_length = next((token for token in lens_tokens if token.endswith("mm")), "")
    lens = f"{focal_length} lens" if focal_length else "natural lens"
    return f"{angle}, {movement}, {lens}."


def storyboard_shot_has_meaningful_description(value: str) -> bool:
    """Return whether SHOT contains more than its label, number, and punctuation."""

    text = re.sub(r"\b(?:shot|panel)\b", " ", str(value or ""), flags=re.IGNORECASE)
    text = re.sub(r"\d+", " ", text)
    words = [word.lower() for word in re.findall(r"[A-Za-z]+(?:[-'][A-Za-z]+)*", text)]
    return any(
        len(word) >= 2 and word not in {"a", "an", "the", "of", "to", "and", "or"}
        for word in words
    )


def storyboard_metadata_value_is_semantic_fragment(label: str, value: str) -> bool:
    """Detect generic whole-word fragments that still lack a complete meaning."""

    normalized_label = str(label or "").strip().upper()
    if normalized_label not in {"ACTION", "MOTION", "NOTES"}:
        return False
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if not text:
        return True
    stem = text.strip(" .,:;\"'()[]")
    if not stem or re.search(r"[—-]\s*$", stem):
        return True
    clauses = [
        clause.strip()
        for clause in re.split(r";|(?<=[.!?])\s+", text)
        if clause.strip()
    ]
    if len(clauses) > 1 and any(
        storyboard_metadata_value_is_semantic_fragment(normalized_label, clause)
        for clause in clauses
    ):
        return True
    words = re.findall(r"[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*", stem)
    if not words:
        return True
    lowered = [word.lower() for word in words]
    if re.search(r"['’](?:s)?\s*$", stem):
        return True
    if lowered[-1] in {
        "a",
        "an",
        "after",
        "along",
        "around",
        "before",
        "fully",
        "partly",
        "successive",
        "the",
        "until",
        "visibly",
    }:
        return True
    if len(words) <= 4 and lowered[-1] in {"its", "their"}:
        return True
    if re.match(
        r"^(?:seated|positioned|located|shown|held|secured|placed)\s+"
        r"(?:at|beside|in|inside|on|outside|within)\b",
        stem,
        flags=re.IGNORECASE,
    ):
        return True
    if normalized_label in {"ACTION", "MOTION"} and re.match(
        r"^[A-Za-z-]+ing\s+(?:a|an|the|his|her|its|their)\b",
        stem,
        flags=re.IGNORECASE,
    ):
        return True
    if re.search(
        r"\b(?:fully|partly|clearly|visibly)\s+"
        r"(?:open|closed|ready|secure|stable|visible|reachable)\s*$",
        stem,
        flags=re.IGNORECASE,
    ) and not re.search(r"\b(?:is|are|was|were|becomes?|remains?)\b", stem, flags=re.IGNORECASE):
        return True
    if re.search(r":\s*(?:keep|preserve|show)\s*$", stem, flags=re.IGNORECASE):
        return True
    if lowered[-1] in {
        "is",
        "are",
        "was",
        "were",
        "be",
        "been",
        "being",
        "become",
        "becomes",
        "seem",
        "seems",
        "remain",
        "remains",
        "begins",
    }:
        return True
    if normalized_label in {"ACTION", "MOTION"} and lowered[0] in {
        "from",
        "continuing",
        "into",
        "through",
        "toward",
        "towards",
        "with",
    }:
        return True
    if lowered[0] in {"show", "make", "preserve", "only", "end"} and len(words) <= 5 and lowered[-1] in {
        "a",
        "an",
        "exact",
        "same",
        "the",
        "this",
        "that",
        "these",
        "those",
    }:
        return True
    if len(words) <= 6 and lowered[0] in {"the", "this", "that", "these", "those"} and lowered[-1] in {
        "now",
        "then",
        "here",
        "there",
        "nearby",
        "inside",
        "outside",
    }:
        return True
    if len(words) <= 6 and lowered[:2] in (["the", "same"], ["the", "current"]) and lowered[-1].endswith("ly"):
        return True
    if lowered[0] in {"my", "your", "his", "her", "its", "our", "their"} and len(words) <= 4:
        if lowered[-1] not in _CONCISE_PREDICATE_WORDS and not lowered[-1].endswith(("ed", "ing")):
            return True
    if lowered[0] in {"both", "each", "every", "either", "neither"} and len(words) <= 4:
        if lowered[-1] not in _CONCISE_PREDICATE_WORDS and not lowered[-1].endswith(("ed", "ing")):
            return True
    if re.search(r"\b(?:a|an|the)\s+[A-Za-z0-9-]+(?:ed|en)\s*$", stem, flags=re.IGNORECASE):
        return True
    if len(words) == 1:
        return True
    if normalized_label in {"ACTION", "MOTION"} and lowered[-1] in _STRICT_TRANSITIVE_PREDICATES:
        return True
    if normalized_label in {"ACTION", "MOTION"} and re.search(
        r"\bsuccessive\s+[A-Za-z0-9-]+\s*$",
        stem,
        flags=re.IGNORECASE,
    ) and not lowered[-1].endswith("s"):
        return True
    if normalized_label in {"ACTION", "MOTION"} and re.search(
        r"\b(?:a|an|the)\s+(?:[A-Za-z0-9-]+\s+){0,3}(?:aft|forward|port|rear|starboard)\s*$",
        stem,
        flags=re.IGNORECASE,
    ) and not any(
        word
        in (
            _CONCISE_PREDICATE_WORDS
            | _LIKELY_TRANSITIVE_PREDICATES
            | _STRICT_TRANSITIVE_PREDICATES
            | {"is", "are", "was", "were", "become", "becomes", "remain", "remains"}
        )
        for word in lowered
    ):
        return True
    if re.search(
        r"\b(?:a|an|the)\s+(?:clean|closed|current|exact|failed|final|first|matching|new|next|old|open|"
        r"previous|sealed|worn)\s*$",
        stem,
        flags=re.IGNORECASE,
    ):
        return True
    if normalized_label in {"ACTION", "MOTION"} and len(words) <= 10 and re.match(
        r"^(?:a|an|the|this|that|these|those)\s+[^,.;]+,\s+[^,.;]+$",
        stem,
        flags=re.IGNORECASE,
    ) and not any(
        word
        in (
            _CONCISE_PREDICATE_WORDS
            | _LIKELY_TRANSITIVE_PREDICATES
            | _STRICT_TRANSITIVE_PREDICATES
            | {"is", "are", "was", "were", "become", "becomes", "remain", "remains"}
        )
        for word in lowered
    ):
        return True
    if len(words) == 2:
        # Keep concise complete clauses such as ``Door closes`` and compact
        # user-owned title/state notes such as ``AMBER CUE``. Reject noun-only
        # truncations such as ``Cyan neutral`` without requiring a story- or
        # language-specific dictionary.
        uppercase_note = normalized_label == "NOTES" and stem.upper() == stem
        return not (uppercase_note or lowered[-1] in _CONCISE_PREDICATE_WORDS)
    if (
        len(words) <= 4
        and lowered[0] in {"a", "an", "the", "this", "that"}
        and lowered[-1] in _LIKELY_TRANSITIVE_PREDICATES
    ):
        return True
    if lowered[0] in {"a", "an", "the", "this", "that", "these", "those"} and len(words) <= 4:
        final_word = lowered[-1]
        has_predicate = any(
            word
            in (
                _CONCISE_PREDICATE_WORDS
                | _LIKELY_TRANSITIVE_PREDICATES
                | _STRICT_TRANSITIVE_PREDICATES
                | {"is", "are", "was", "were", "become", "becomes", "remain", "remains"}
            )
            for word in lowered
        )
        if not has_predicate and final_word not in _CONCISE_PREDICATE_WORDS and not final_word.endswith(("s", "ed", "ing")):
            return True
    if re.search(
        r"\b(?:exact|same)\s+[A-Za-z0-9-]+(?:ed|ing)\s*$",
        stem,
        flags=re.IGNORECASE,
    ):
        return True
    return False


def storyboard_metadata_values_duplicate(left: str, right: str) -> bool:
    """Return whether two narrative rows express substantially identical text."""

    left_text = re.sub(r"[^a-z0-9]+", " ", str(left or "").lower()).strip()
    right_text = re.sub(r"[^a-z0-9]+", " ", str(right or "").lower()).strip()
    if not left_text or not right_text:
        return False
    if left_text == right_text:
        return True
    left_tokens = set(left_text.split())
    right_tokens = set(right_text.split())
    shorter = min(len(left_tokens), len(right_tokens))
    if shorter < 6:
        return False
    shared = len(left_tokens & right_tokens)
    longer = max(len(left_tokens), len(right_tokens))
    return shared / shorter >= 0.9 and shared / longer >= 0.75


def storyboard_metadata_duplicate_pairs(fields: dict[str, str]) -> list[tuple[str, str]]:
    """Return conflicting narrative labels in stable production-row order."""

    return [
        (left, right)
        for left, right in _STORYBOARD_NARRATIVE_METADATA_PAIRS
        if storyboard_metadata_values_duplicate(fields.get(left, ""), fields.get(right, ""))
    ]


def storyboard_metadata_semantic_fragments(submitted_prompt: str) -> list[tuple[int, str, str]]:
    """Return semantic fragment locations using the canonical storyboard row parser."""

    fragments: list[tuple[int, str, str]] = []
    for panel_number, body in _compact_panel_bodies(submitted_prompt) or _raw_panel_bodies(submitted_prompt):
        fields = _panel_fields(body)
        for label in ("ACTION", "MOTION", "NOTES"):
            values = fields[label]
            if len(values) == 1 and values[0] and storyboard_metadata_value_is_semantic_fragment(label, values[0]):
                fragments.append((panel_number, label, values[0]))
    return fragments


def compact_storyboard_metadata_capsules(submitted_prompt: str) -> list[str]:
    """Return canonical compact capsules without duplicating row parsing."""

    return [f"{panel_number:02d}: {body}" for panel_number, body in _compact_panel_bodies(submitted_prompt)]


def parse_storyboard_metadata_panels(prompt: str) -> list[tuple[int, dict[str, str]]]:
    """Return ordered panel metadata through the canonical row parser."""

    panels = _compact_panel_bodies(prompt) or _raw_panel_bodies(prompt)
    parsed: list[tuple[int, dict[str, str]]] = []
    for panel_number, body in panels:
        values = _panel_fields(body)
        parsed.append(
            (
                panel_number,
                {
                    label: fields[0] if len(fields) == 1 else ""
                    for label, fields in values.items()
                },
            )
        )
    return parsed


def validate_storyboard_metadata_preflight(
    *,
    model_key: str,
    original_prompt: str,
    submitted_prompt: str,
    prompt_semantics: str = "",
) -> StoryboardMetadataPreflightResult | None:
    """Fail before provider submission when a storyboard metadata row is malformed."""

    if not _normalized_model_key(model_key).startswith("gpt-image-2"):
        return None
    if prompt_semantics in PROMPT_SEMANTICS_WITHOUT_STORYBOARD_METADATA:
        return None
    if prompt_semantics != STORYBOARD_METADATA_PROMPT_SEMANTICS and not _looks_like_storyboard(original_prompt):
        return None

    expected_count = _expected_panel_count(original_prompt)
    return validate_storyboard_metadata_rows(submitted_prompt, expected_count=expected_count)


def validate_storyboard_metadata_rows(
    submitted_prompt: str,
    *,
    expected_count: int = 6,
) -> StoryboardMetadataPreflightResult:
    """Validate final storyboard rows without inferring or changing story content."""

    panels = _compact_panel_bodies(submitted_prompt) or _raw_panel_bodies(submitted_prompt)
    expected_numbers = list(range(1, expected_count + 1))
    actual_numbers = [number for number, _ in panels]
    if actual_numbers != expected_numbers:
        raise ValueError(
            "Storyboard preflight failed: panel sequence is "
            f"{actual_numbers or 'empty'}; expected {expected_numbers}."
        )

    for panel_number, body in panels:
        fields = _panel_fields(body)
        panel_values: dict[str, str] = {}
        for label in STORYBOARD_METADATA_LABELS:
            values = fields[label]
            if len(values) != 1:
                raise ValueError(
                    f"Storyboard preflight failed: Panel {panel_number:02d} {label} row count is "
                    f"{len(values)}; expected 1."
                )
            value = values[0]
            panel_values[label] = value
            if label in REQUIRED_STORYBOARD_METADATA_LABELS and not value:
                raise ValueError(f"Storyboard preflight failed: Panel {panel_number:02d} {label} is empty.")
            if label == "SHOT" and value and not storyboard_shot_has_meaningful_description(value):
                raise ValueError(
                    f"Storyboard preflight failed: Panel {panel_number:02d} SHOT must include a meaningful description."
                )
            if value and _placeholder_key(value) in _PLACEHOLDER_VALUES:
                raise ValueError(
                    f"Storyboard preflight failed: Panel {panel_number:02d} {label} uses placeholder value {value!r}."
                )
            if label == "CAMERA" and value and storyboard_camera_contract_missing(value):
                raise ValueError(
                    f"Storyboard preflight failed: Panel {panel_number:02d} CAMERA must include angle, movement, and lens direction."
                )
            if value and storyboard_metadata_value_is_semantic_fragment(label, value):
                raise ValueError(
                    f"Storyboard preflight failed: Panel {panel_number:02d} {label} is not a complete semantic value."
                )
        duplicates = storyboard_metadata_duplicate_pairs(panel_values)
        if duplicates:
            left, right = duplicates[0]
            raise ValueError(
                f"Storyboard preflight failed: Panel {panel_number:02d} {left} and {right} "
                "duplicate the same production meaning."
            )

    return StoryboardMetadataPreflightResult(panel_count=expected_count)
