from __future__ import annotations

import re
from typing import Any, Dict, List

from ..graph.preset_catalog import media_preset_catalog
from ..graph.registry import registry
from ..graph.schemas import GraphWorkflow
from .graph_templates import (
    I2I_SANDBOX_TEMPLATE_ID,
    T2I_SANDBOX_TEMPLATE_ID,
    instantiate_preset_sandbox_template,
    instantiate_saved_preset_template,
)
from .preset_builder import (
    build_preset_builder_proposal,
    is_reference_preset_request,
)
from .preset_capabilities import (
    match_preset_capability,
    match_refinement_capability,
    refinement_details,
    render_capability_template,
    sample_year,
    wants_sandbox_example,
    wants_text_only_preset,
)
from .preset_fields import infer_explicit_preset_fields
from .preset_slots import infer_runtime_image_slots_from_text
from .schemas import AssistantGraphOperation, AssistantGraphPlan
from .style_brief import (
    BRIEF_MARKER,
    compile_reference_style_i2i_prompt,
    compile_reference_style_prompt,
    compile_reference_style_t2i_prompt,
    extract_reference_style_brief_from_message,
    has_concrete_style_traits,
    merge_reference_style_contract_into_proposal,
    sync_reference_style_brief_with_visible_setup,
)


IMAGE_TO_IMAGE_TYPES = ["model.kie.gpt_image_2_image_to_image", "model.kie.nano_banana_2", "model.kie.nano_banana_pro"]
TEXT_TO_IMAGE_TYPES = ["model.kie.gpt_image_2_text_to_image", "model.kie.nano_banana_2", "model.kie.nano_banana_pro"]


def _available_type(candidates: List[str]) -> str | None:
    definitions = registry.definitions_by_type()
    return next((node_type for node_type in candidates if node_type in definitions), None)


def _intent(message: str) -> str:
    text = message.lower()
    if "image to image" in text or "image-to-image" in text or "edit image" in text or "source image" in text:
        return "image_to_image"
    if "text to image" in text or "text-to-image" in text or "generate image" in text or "image model" in text:
        return "text_to_image"
    return "answer"


def _base_x(workflow: GraphWorkflow) -> float:
    if not workflow.nodes:
        return 120
    return max(node.position.get("x", 0) for node in workflow.nodes) + 640


def _prompt_from_message(message: str) -> str:
    cleaned = " ".join(message.split())
    if len(cleaned) > 420:
        return cleaned[:417].rstrip() + "..."
    return cleaned or "Create a polished image from this prompt."


def _note_body(title: str, model_label: str) -> str:
    return "\n\n".join(
        [
            f"### {title}",
            f"- Uses {model_label}.",
            "- Replace the prompt text before running.",
            "- Review pricing before starting the graph run.",
            "- Save the workflow when the layout looks right.",
        ]
    )


def _slug(value: str) -> str:
    return re.sub(r"_+", "_", re.sub(r"[^a-z0-9]+", "_", value.strip().lower())).strip("_")


def _runtime_image_warning(label: str, *, sandbox: bool) -> str:
    surface = "test workflow" if sandbox else "preset workflow"
    return (
        f"Attach the actual {label} image before running the {surface}. "
        "Reference/style images attached to the assistant are inspiration only unless the user intentionally picks one as the subject image."
    )


def _uses_extracted_style_prompt_sandbox(message: str) -> bool:
    text = " ".join(str(message or "").lower().split())
    return (
        "extracted text style prompt" in text
        or "extract the attached" in text
        or "temporary sandbox" in text
        or "create the sandbox" in text
        or "create the test workflow" in text
        or "text-to-image test graph" in text
        or "text-to-image test workflow" in text
        or "run from text only" in text
        or "do not connect or require the attached style reference" in text
        or "do not use the style reference image as a runtime image input" in text
        or "without requiring the style reference image" in text
    )


def _prior_style_analysis(message: str) -> str:
    marker = "Prior assistant reference-style analysis:"
    if marker not in message:
        return ""
    analysis = message.split(marker, 1)[1]
    analysis = re.split(r"\b(Use inputs \+ test|Minimal \+ test|Create sandbox graph|Create test workflow)\b", analysis, maxsplit=1)[0]
    analysis = re.split(r"\bTwo (short|quick) questions:\b", analysis, maxsplit=1, flags=re.IGNORECASE)[0]
    analysis = re.sub(r"Reference Style PresetReference-driven.*$", "", analysis, flags=re.IGNORECASE | re.DOTALL)
    normalized = " ".join(analysis.split())
    normalized = re.sub(r"\bthe attached image should be treated as a style reference\b", "The attached image contributes style traits", normalized, flags=re.IGNORECASE)
    normalized = re.sub(r"\bnot a required runtime input\b", "", normalized, flags=re.IGNORECASE)
    normalized = re.sub(r"\bnot a runtime input\b", "", normalized, flags=re.IGNORECASE)
    normalized = re.sub(r"\bruntime image input[s]?\b", "", normalized, flags=re.IGNORECASE)
    sentences = [sentence.strip(" -") for sentence in re.split(r"(?<=[.!?])\s+", normalized) if sentence.strip(" -")]
    style_terms = (
        "style",
        "palette",
        "color",
        "lighting",
        "texture",
        "composition",
        "poster",
        "illustration",
        "cartoon",
        "line",
        "shape",
        "mood",
        "typography",
        "graffiti",
        "clutter",
        "room",
        "bedroom",
        "ink",
        "doodle",
        "hand-drawn",
        "hand-lettered",
        "ochre",
        "mustard",
        "caricature",
        "sticker",
        "comic",
    )
    rejected_terms = (
        "i can shape",
        "i would extract",
        "do you want",
        "should this preset",
        "should the preset",
        "should it",
        "if you want",
        "editable field",
        "temporary test graph",
        "ask me to create",
        "create an example",
    )
    useful = [
        sentence
        for sentence in sentences
        if any(term in sentence.lower() for term in style_terms) and not any(term in sentence.lower() for term in rejected_terms)
    ]
    if useful:
        return " ".join(useful)[:900]
    return " ".join(sentences[:2])[:900]


def _has_concrete_style_analysis(analysis: str) -> bool:
    text = " ".join(str(analysis or "").lower().split())
    if not text:
        return False
    generic_only = (
        "reference style preset",
        "reference-driven visual preset",
        "style reference",
        "style references",
        "analysis-only style sources",
        "extract the look into the prompt",
        "future images",
        "media preset",
    )
    stripped = text
    for term in generic_only:
        stripped = stripped.replace(term, "")
    concrete_terms = (
        "palette",
        "ochre",
        "mustard",
        "black",
        "ink",
        "line",
        "hand-drawn",
        "hand-lettered",
        "typography",
        "poster",
        "graffiti",
        "doodle",
        "sticker",
        "clutter",
        "bedroom",
        "room",
        "cartoon",
        "comic",
        "caricature",
        "lighting",
        "texture",
        "composition",
        "character",
        "mood",
    )
    return len(stripped.split()) >= 8 and sum(1 for term in concrete_terms if term in stripped) >= 2


def _extracted_style_sandbox_prompt(message: str) -> str:
    style_brief = extract_reference_style_brief_from_message(message)
    if style_brief and has_concrete_style_traits(style_brief):
        compiled = compile_reference_style_t2i_prompt(style_brief)
        if compiled:
            return compiled
    analysis = _prior_style_analysis(message)
    if not _has_concrete_style_analysis(analysis):
        return ""
    return (
        "Create a new original image from text only. "
        f"Use these extracted style notes as the full reusable direction: {analysis}. "
        "Make a fresh scene that demonstrates those concrete traits without using the original reference image as an input. "
        "Preserve the extracted palette logic, line or shape language, texture, lighting, composition rhythm, subject treatment, typography energy, and mood. "
        "Do not recreate the reference image, do not trace it, and do not copy any exact character, layout, logo, or readable text from it. "
        "Use a clear original subject and environment that demonstrate the reusable preset style. "
        "Avoid style drift, photorealism unless the extracted style calls for it, extra limbs, duplicate subjects, and accidental reference copying."
    )


def _message_without_style_brief_marker(message: str) -> str:
    text = str(message or "").split(BRIEF_MARKER, 1)[0]
    text = re.split(r"\bLocked preset-loop lane\s*:", text, maxsplit=1, flags=re.IGNORECASE)[0]
    return text.strip()


def _wants_style_prompt_update(message: str) -> bool:
    text = _message_without_style_brief_marker(message).lower()
    if not any(term in text for term in ("update", "refine", "adjust", "strengthen", "improve", "replace", "rewrite")):
        return False
    return any(term in text for term in ("draft preset prompt", "prompt", "style details", "style analysis", "inferred"))


def _fields_are_generic_image_loop_defaults(fields: List[Dict[str, Any]]) -> bool:
    labels = {str(field.get("label") or "").strip().lower() for field in fields if isinstance(field, dict)}
    labels.discard("")
    generic_labels = {
        "pose / framing",
        "style notes",
        "scene / subject",
        "subject / concept",
        "subject direction",
        "scene brief",
        "optional detail notes",
    }
    return bool(labels) and labels.issubset(generic_labels)


def _fields_include_setup_parse_leak(fields: List[Dict[str, Any]]) -> bool:
    for field in fields:
        if not isinstance(field, dict):
            continue
        text = " ".join(str(field.get(key) or "") for key in ("key", "label", "placeholder", "purpose")).lower()
        if "image input" in text or "image_input" in text:
            return True
    return False


def _fields_with_inline_values(fields: List[Dict[str, Any]], message: str) -> List[Dict[str, Any]]:
    if not fields:
        return fields
    text = " ".join(str(message or "").split())
    if not text:
        return fields
    normalized: List[Dict[str, Any]] = []
    field_labels = [str(field.get("label") or field.get("key") or "").strip() for field in fields if isinstance(field, dict)]
    for field in fields:
        if not isinstance(field, dict):
            continue
        next_field = dict(field)
        if str(next_field.get("default_value") or "").strip():
            normalized.append(next_field)
            continue
        label = str(next_field.get("label") or next_field.get("key") or "").strip()
        if not label:
            normalized.append(next_field)
            continue
        stop_labels = [other for other in field_labels if other and other.lower() != label.lower()]
        stop_pattern = "|".join(re.escape(other) for other in stop_labels)
        if stop_pattern:
            pattern = rf"\b{re.escape(label)}\s*(?:\:|=|should be|as)\s*(.+?)(?=(?:\s*(?:;|,|\band\b)\s*(?:{stop_pattern})\s*(?:\:|=|should be|as))|(?:\.|$))"
        else:
            pattern = rf"\b{re.escape(label)}\s*(?:\:|=|should be|as)\s*(.+?)(?:\.|$)"
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            value = match.group(1).strip(" .,:;-")
            if value and not _field_value_looks_like_control_text(value):
                next_field["default_value"] = value[:120]
        normalized.append(next_field)
    return normalized


def _field_value_looks_like_control_text(value: str) -> bool:
    text = " ".join(str(value or "").lower().split())
    if not text:
        return True
    control_terms = (
        "assistant",
        "attached reference",
        "editable field",
        "graph",
        "media preset",
        "reference image",
        "runtime image input",
        "sandbox",
        "style source",
        "test graph",
        "temporary",
        "workflow",
    )
    if any(term in text for term in control_terms):
        return True
    return bool(re.search(r"\b(create|build|make|prepare|start|generate|wire)\b.{0,60}\b(preset|sandbox|graph|workflow)\b", text))


def _sandbox_fields_with_values(fields: List[Dict[str, Any]], message: str) -> List[Dict[str, Any]]:
    if not fields:
        return fields
    text = " ".join(str(message or "").split())
    lower = text.lower()
    values: Dict[str, str] = {}
    scene_matches = [
        match.group(1).strip(" .,:;-")
        for match in re.finditer(r"\bscene brief\s+(.+?)(?:\s+and\s+detail notes\b|\s+detail notes\b|$)", text, flags=re.IGNORECASE)
    ]
    scene_matches = [
        value
        for value in scene_matches
        if value and value.lower() not in {"and", "detail notes"} and not _field_value_looks_like_control_text(value)
    ]
    if scene_matches:
        values["scene_brief"] = scene_matches[-1]
    detail_starts = list(re.finditer(r"\bdetail notes\s+", text, flags=re.IGNORECASE))
    if detail_starts:
        detail_value = text[detail_starts[-1].end() :].strip(" .,:;-")
        if detail_value and not _field_value_looks_like_control_text(detail_value):
            values["detail_notes"] = detail_value
    if not values and " with " in lower:
        with_value = text.rsplit(" with ", 1)[-1].strip(" .,:;-")
        if with_value and not _field_value_looks_like_control_text(with_value):
            values["scene_brief"] = with_value
    normalized: List[Dict[str, Any]] = []
    for field in fields:
        if not isinstance(field, dict):
            continue
        next_field = dict(field)
        key = str(next_field.get("key") or "")
        if values.get(key) and not str(next_field.get("default_value") or "").strip():
            next_field["default_value"] = values[key]
        normalized.append(next_field)
    return normalized


def _fields_with_sandbox_prompt_values(fields: List[Dict[str, Any]], style_brief: Any | None = None) -> List[Dict[str, Any]]:
    """Use sample values in runnable test prompts without changing the preset contract."""
    normalized: List[Dict[str, Any]] = []
    for field in fields:
        if not isinstance(field, dict):
            continue
        next_field = dict(field)
        if not str(next_field.get("default_value") or "").strip():
            next_field["default_value"] = _sandbox_value_from_style_brief(next_field, style_brief) or _smoke_test_value_for_field(next_field)
        normalized.append(next_field)
    return normalized


def _fields_for_compiled_test_prompt(fields: List[Dict[str, Any]], message: str) -> List[Dict[str, Any]]:
    """Keep broad user controls as instructions unless the user supplied a concrete value."""
    normalized: List[Dict[str, Any]] = []
    message_text = " ".join(str(message or "").lower().split())
    for field in fields:
        if not isinstance(field, dict):
            continue
        next_field = dict(field)
        default_value = str(next_field.get("default_value") or "").strip()
        if default_value and _broad_subject_field(next_field) and default_value.lower() not in message_text:
            next_field["default_value"] = ""
        normalized.append(next_field)
    return normalized


def _broad_subject_field(field: Dict[str, Any]) -> bool:
    text = _slug_for_match(
        " ".join(
            str(field.get(key) or "")
            for key in ("key", "label", "purpose", "placeholder", "help_text", "display_help_text")
        )
    )
    if not text:
        return False
    return _matches_any(
        text,
        (
            "main_subject",
            "main_character",
            "central_subject",
            "primary_subject",
            "character_role",
            "subject_role",
            "animal_companion",
            "companion_animal",
            "companion_creature",
            "companion_characters",
            "character_lineup",
            "character_universe",
            "supporting_characters",
            "supporting_cast",
            "pet",
            "mascot",
        ),
    )


def _sandbox_value_from_style_brief(field: Dict[str, Any], style_brief: Any | None) -> str:
    """Pick a concrete paid-test value from the active image analysis, not from generic defaults."""
    visual_analysis = getattr(style_brief, "visual_analysis", None)
    if not isinstance(visual_analysis, dict):
        return ""
    field_text = _slug_for_match(
        " ".join(
            str(field.get(key) or "")
            for key in ("key", "label", "purpose", "placeholder", "help_text", "display_help_text")
        )
    )
    if not field_text:
        return ""
    if _matches_any(field_text, ("title", "headline", "slogan", "tagline", "caption", "poster_text", "top_text", "bottom_text", "word", "phrase", "message")):
        return ""
    candidate_segments = _brief_candidate_segments(visual_analysis)
    if _matches_any(field_text, ("destination", "location", "city", "place", "landmark", "region", "route", "travel")):
        value = _first_matching_brief_value(
            candidate_segments,
            (
                "city",
                "coast",
                "country",
                "destination",
                "highway",
                "landmark",
                "mountain",
                "pagoda",
                "place",
                "region",
                "road",
                "route",
                "scenery",
                "shrine",
                "temple",
                "torii",
                "travel",
            ),
            prefer=(
                "landmark",
                "mountain",
                "temple",
                "pagoda",
                "shrine",
                "torii",
                "city",
                "coast",
                "road",
                "route",
                "destination",
            ),
            reject=("human", "person", "portrait", "face", "figure", "subject", "character", "motion", "spray", "streaking"),
        )
        if value:
            return value
    if _matches_any(
        field_text,
        (
            "companion_characters",
            "companion_cast",
            "supporting_characters",
            "supporting_cast",
            "character_lineup",
            "lineup",
            "series_mix",
            "fandom",
            "ensemble",
            "universe",
        ),
    ):
        analysis_text = " ".join(candidate_segments).lower()
        if any(term in analysis_text for term in ("anime", "manga", "comic", "collector", "fandom", "fan world")):
            return "invented anime-style companion cast"
        return "original supporting character cast"
    if _matches_any(field_text, ("pet", "animal", "creature", "companion_creature", "mascot")):
        value = _first_matching_brief_value(
            candidate_segments,
            (
                "pet",
                "animal",
                "dog",
                "puppy",
                "cat",
                "kitten",
                "bird",
                "fish",
                "koi",
                "horse",
                "frog",
                "rabbit",
                "creature",
                "mascot",
                "spirit",
            ),
            prefer=("koi", "fish", "spirit", "bird", "creature", "mascot", "dog", "puppy", "cat", "kitten", "pet", "animal"),
        )
        if value:
            return value
    if _matches_any(field_text, ("character", "person", "portrait", "subject", "main_subject", "main_character", "face", "hero")):
        value = _first_matching_brief_value(
            candidate_segments,
            (
                "human",
                "person",
                "figure",
                "warrior",
                "swordsman",
                "companion",
                "character",
                "subject",
                "hero",
                "portrait",
            ),
            prefer=(
                "central",
                "main",
                "seated",
                "standing",
                "full-body",
                "hero",
                "warrior",
                "swordsman",
                "human subject",
                "human figure",
                "person",
                "figure",
                "character",
                "subject",
            ),
            reject=("negative space", "open space", "background", "surrounding", "supporting", "companion", "cast", "ensemble"),
        )
        if value:
            return value
    if _matches_any(field_text, ("treat", "food", "snack", "fruit", "dessert", "drink", "prop", "accessory", "object", "item")):
        value = _first_matching_brief_value(
            candidate_segments,
            (
                "prop",
                "accessory",
                "object",
                "item",
                "food",
                "treat",
                "snack",
                "fruit",
                "slice",
                "bottle",
                "can",
                "shoe",
                "sneaker",
                "flower",
                "toy",
                "tool",
            ),
            prefer=("used as", "hero prop", "prop", "treat", "food", "snack", "fruit", "slice", "shoe", "sneaker"),
        )
        if value:
            return value
    if _matches_any(field_text, ("setting", "scene", "environment", "backdrop", "room", "background", "location", "destination")):
        value = _first_matching_brief_value(
            candidate_segments,
            (
                "alley",
                "street",
                "room",
                "city",
                "sky",
                "beach",
                "water",
                "landscape",
                "mountain",
                "desert",
                "forest",
                "studio",
            ),
            prefer=("alley", "street", "room", "city", "landscape", "mountain", "studio"),
        )
        if value:
            return value
    return ""


def _brief_candidate_segments(visual_analysis: Dict[str, Any]) -> List[str]:
    preferred_categories = (
        "replaceable_elements",
        "subject_treatment",
        "environment_props",
        "composition",
        "line_shape_language",
        "medium",
    )
    raw_items: List[str] = []
    for category in preferred_categories:
        values = visual_analysis.get(category) or []
        if isinstance(values, list):
            raw_items.extend(str(value or "") for value in values)
    if not raw_items:
        for values in visual_analysis.values():
            if isinstance(values, list):
                raw_items.extend(str(value or "") for value in values)
    segments: List[str] = []
    for item in raw_items:
        for segment in re.split(r"[.;]\s+|\s+\band\b\s+|,\s+", item):
            clean = _clean_brief_sample_segment(segment)
            if clean:
                segments.append(clean)
    return segments


def _first_matching_brief_value(
    segments: List[str],
    markers: tuple[str, ...],
    *,
    prefer: tuple[str, ...] = (),
    reject: tuple[str, ...] = (),
) -> str:
    ranked: List[tuple[int, str]] = []
    for index, segment in enumerate(segments):
        lowered = segment.lower()
        if not any(marker in lowered for marker in markers):
            continue
        if any(marker in lowered for marker in reject):
            continue
        score = 100 - index
        score += sum(25 for marker in prefer if marker in lowered)
        ranked.append((score, segment))
    for _, segment in sorted(ranked, key=lambda item: item[0], reverse=True):
        value = _brief_segment_to_sample_value(segment)
        if value:
            return value
    return ""


def _brief_segment_to_sample_value(segment: str) -> str:
    value = _clean_brief_sample_segment(segment)
    if re.search(
        r"^(?:(?:main|central|primary|foreground)\s+)?(?:pet|animal|creature|subject|character|figure|person)\s+is\b",
        value,
        flags=re.IGNORECASE,
    ):
        return ""
    phrase = _explicit_brief_phrase(value)
    if phrase:
        return phrase
    value = re.sub(r"\b(?:used|rendered|placed|shown|tucked|framing|dominating|scattered)\b.*$", "", value, flags=re.IGNORECASE)
    value = re.sub(r"\btreated\s+as\b.*$", "", value, flags=re.IGNORECASE)
    value = re.sub(r"\b(?:as|with|near|inside|behind|around|toward|through|under|over)\b.*$", "", value, flags=re.IGNORECASE)
    value = re.sub(r"^(?:front-centered|front centered|featured|main|primary|hero)\s+", "", value, flags=re.IGNORECASE)
    value = _clean_brief_sample_segment(value)
    words = value.split()
    if len(words) > 5:
        value = " ".join(words[:5])
    return value


def _explicit_brief_phrase(value: str) -> str:
    lowered = value.lower()
    phrase_patterns = (
        r"\b(central seated human subject)\b",
        r"\b(central seated subject)\b",
        r"\b(central seated hero)\b",
        r"\b(towering human companion)\b",
        r"\b(towering human figure)\b",
        r"\b(human companion)\b",
        r"\b(human figure)\b",
        r"\b(foreground pet)\b",
        r"\b(?:tiny|small|cute|playful|foreground|oversized|fluffy|plush)\s+(?:dog|puppy|cat|kitten|pet|animal|creature)\b",
        r"\b[a-z][a-z-]*(?:\s+[a-z][a-z-]*){0,2}\s+(?:slice|bottle|can|shoe|sneaker|flower|flowers|toy|tool|prop|snack|treat)\b",
    )
    for pattern in phrase_patterns:
        match = re.search(pattern, lowered, flags=re.IGNORECASE)
        if match:
            return _clean_brief_sample_segment(match.group(0))
    return ""


def _clean_brief_sample_segment(value: str) -> str:
    value = " ".join(str(value or "").split()).strip(" .,:;-")
    value = re.sub(r"^(?:carrying|holding|wearing|using|with)\s+(?:a|an|the)\s+", "", value, flags=re.IGNORECASE)
    value = re.sub(r"^(?:carrying|holding|wearing|using)\s+", "", value, flags=re.IGNORECASE)
    if not value:
        return ""
    weak_terms = (
        "no visible typography",
        "no typography",
        "style",
        "mood",
        "palette",
        "composition",
        "lighting",
        "texture",
        "generic",
    )
    lowered = value.lower()
    if lowered in weak_terms or len(value) < 3:
        return ""
    return value[:120]


def _explicit_runtime_image_slots(message: str) -> List[Dict[str, Any]]:
    return infer_runtime_image_slots_from_text(message)


def _preset_catalog_match(message: str) -> Dict | None:
    text = " ".join(str(message or "").lower().split())
    if not text:
        return None
    presets = media_preset_catalog(status="active")
    keyed_matches: List[tuple[int, Dict]] = []
    for preset in presets:
        key = str(preset.get("key") or "").strip().lower()
        preset_id = str(preset.get("preset_id") or "").strip().lower()
        matched_lengths = [len(value) for value in (key, preset_id) if value and value in text]
        if matched_lengths:
            keyed_matches.append((max(matched_lengths), preset))
    if keyed_matches:
        keyed_matches.sort(key=lambda item: item[0], reverse=True)
        return keyed_matches[0][1]
    best_match = None
    best_score = 0
    for preset in presets:
        label = str(preset.get("label") or "").strip()
        score = 0
        if label and label.lower() in text:
            score = max(score, len(label))
        if score > best_score:
            best_score = score
            best_match = preset
    return best_match


def _saved_preset_reuse_request(message: str) -> bool:
    text = " ".join(str(message or "").lower().split())
    if not text:
        return False
    saved_markers = (
        "saved media preset",
        "saved preset",
        "test saved preset",
        "use saved preset",
        "use the saved preset",
        "uses the saved media preset",
        "use media preset key",
        "with key",
        "preset key",
        "preset_id",
        "preset id",
    )
    return any(marker in text for marker in saved_markers)


def _new_preset_build_request(message: str) -> bool:
    text = " ".join(str(message or "").lower().split())
    if not text or _saved_preset_reuse_request(message):
        return False
    if not re.search(r"\b(create|build|make|turn|convert)\b", text):
        return False
    if "preset" not in text:
        return False
    creation_markers = (
        "from this reference",
        "from this image",
        "from refs",
        "from the reference",
        "from the attached",
        "image-to-image media preset",
        "text-to-image media preset",
        "create a preset",
        "create an image-to-image preset",
        "create a text-to-image preset",
        "build preset from refs",
        "turn their visual style into",
        "turn this style into",
    )
    return any(marker in text for marker in creation_markers)


def _placeholder_value(field: Dict[str, Any]) -> str:
    default_value = str(field.get("default_value") or "").strip()
    if default_value:
        return default_value
    if not bool(field.get("required")):
        return ""
    return _smoke_test_value_for_field(field)


def _smoke_test_value_for_field(field: Dict[str, Any]) -> str:
    label = str(field.get("label") or "").strip()
    key = str(field.get("key") or "").strip()
    help_text = str(field.get("help_text") or field.get("display_help_text") or field.get("placeholder") or "").strip()
    text = _slug_for_match(" ".join(value for value in (key, label, help_text) if value))
    if not text:
        return "Original detail"
    if _matches_any(text, ("year", "era", "decade")):
        return "1989"
    if _matches_any(text, ("title", "headline", "slogan", "tagline", "caption", "poster_text", "top_text", "bottom_text", "word", "phrase", "message")):
        if _matches_any(text, ("transit", "pass", "ticket")):
            return "City Day Pass"
        return "Midnight City Guide"
    if _matches_any(text, ("scenic_route", "coastal_route", "road_route", "highway_route")):
        return "Pacific Coast Highway"
    if _matches_any(text, ("transit_line", "route", "rail_line", "subway_line", "bus_line", "train_line")):
        return "M7 Express"
    if _matches_any(text, ("destination", "location", "city", "place", "landmark", "region", "country", "neighborhood")):
        return "New York City"
    if _matches_any(text, ("transit", "transport", "transportation", "subway", "metro", "bus", "train", "tram", "ticket", "pass")):
        return "subway day pass"
    if _matches_any(text, ("vehicle", "car", "auto", "truck", "motorcycle", "bike", "scooter")):
        return "1970s sports coupe"
    if _matches_any(text, ("product", "item", "object", "prop", "featured_object", "main_prop")):
        return "glass soda bottle"
    if _matches_any(
        text,
        (
            "companion_characters",
            "companion_cast",
            "supporting_characters",
            "supporting_cast",
            "character_lineup",
            "lineup",
            "series_mix",
            "fandom",
            "ensemble",
            "universe",
        ),
    ):
        return "invented anime-style companion cast"
    if _matches_any(text, ("companion_creature", "spirit_animal", "spirit_creature", "creature_motif")):
        return "original spirit creature"
    if _matches_any(text, ("pet", "animal", "creature", "mascot")):
        return "playful golden retriever puppy"
    if _matches_any(text, ("treat", "food", "snack", "fruit", "dessert", "drink")):
        return "oversized watermelon slice"
    if _matches_any(text, ("weapon", "sword", "blade", "staff", "shield")):
        return "weathered katana"
    if _matches_any(text, ("outfit", "wardrobe", "clothing", "fashion", "costume", "styling")):
        return "yellow windbreaker and vintage sneakers"
    if _matches_any(text, ("character", "person", "portrait", "subject", "main_subject", "main_character", "face")):
        return "curious street photographer"
    if _matches_any(text, ("setting", "scene", "environment", "backdrop", "room", "background")):
        return "rainy downtown street"
    if _matches_any(text, ("palette", "color", "accent", "tone")):
        return "warm amber and deep navy"
    if _matches_any(text, ("symbol", "icon", "motif", "graphic")):
        return "hand-drawn starburst"
    if _matches_any(text, ("mood", "vibe", "feeling", "emotion")):
        return "nostalgic and energetic"
    if label:
        return f"Original {label.lower()}"
    return ""


def _slug_for_match(value: str) -> str:
    return re.sub(r"_+", "_", re.sub(r"[^a-z0-9]+", "_", value.strip().lower())).strip("_")


def _matches_any(text: str, terms: tuple[str, ...]) -> bool:
    return any(term in text for term in terms)


def _prefill_reference_id(attachments: List[Dict], index: int, *, message: str) -> str:
    text = str(message or "").lower()
    if "leave both image loaders unfilled" in text or "leave the image loaders unfilled" in text or "leave both loaders unfilled" in text:
        return ""
    explicit_reference_phrases = (
        "use the attached image",
        "use the attached images",
        "use attached image",
        "use attached images",
        "use the attached reference",
        "use the attached references",
        "use the source image",
        "use these references",
        "use these images",
        "prefill the image loaders",
        "prefill the loaders",
    )
    if not any(phrase in text for phrase in explicit_reference_phrases):
        return ""
    if index < len(attachments):
        return str(attachments[index].get("reference_id") or "")
    return ""


def _graph_existing_preset_plan(message: str, workflow: GraphWorkflow, attachments: List[Dict]) -> AssistantGraphPlan:
    preset = _preset_catalog_match(message)
    if not preset:
        return AssistantGraphPlan(
            capability="answer_question",
            summary="I could not match the requested Media Preset to an active saved preset yet.",
            questions=["Which saved Media Preset should this workflow use?"],
            warnings=["Mention the preset name exactly so I can wire the correct preset node."],
            requires_confirmation=False,
        )

    x = _base_x(workflow)
    image_slots = [slot for slot in (preset.get("image_slots") or []) if str(slot.get("key") or "").strip()]
    text_fields = [field for field in (preset.get("text_fields") or []) if str(field.get("key") or "").strip()]
    field_values: Dict[str, str] = {}
    for field in text_fields:
        key = str(field.get("key") or "").strip()
        if key:
            field_values[key] = _placeholder_value(field)
    warnings: List[str] = []
    image_loader_fields: List[Dict[str, str]] = []
    for index, slot in enumerate(image_slots):
        load_fields = {}
        key = str(slot.get("key") or "").strip()
        label = str(slot.get("label") or key or f"Reference {index + 1}")
        reference_id = _prefill_reference_id(attachments, index, message=message)
        if reference_id:
            load_fields["reference_id"] = reference_id
        else:
            warnings.append(_runtime_image_warning(label, sandbox=False))
        image_loader_fields.append(load_fields)
    return instantiate_saved_preset_template(
        base_x=x,
        preset=preset,
        image_slots=image_slots,
        text_fields=text_fields,
        field_values=field_values,
        image_loader_fields=image_loader_fields,
        warnings=warnings,
    )


def _graph_image_to_image_plan(message: str, workflow: GraphWorkflow, attachments: List[Dict]) -> AssistantGraphPlan:
    model_type = _available_type(IMAGE_TO_IMAGE_TYPES)
    if not model_type:
        return AssistantGraphPlan(
            summary="I could not find an available image-to-image model node.",
            questions=["Which image model should Media Studio use once it is enabled?"],
            warnings=["No image-to-image model node is currently available."],
        )
    x = _base_x(workflow)
    reference_id = str(attachments[0].get("reference_id") or "") if attachments else ""
    load_fields = {"reference_id": reference_id} if reference_id else {}
    model_label = registry.get_definition(model_type).title
    return AssistantGraphPlan(
        summary="Create an image-to-image workflow with a source image, prompt, model, preview, and save output.",
        operations=[
            AssistantGraphOperation(op="add_node", node_ref="note", node_type="utility.note", title="Guide", position={"x": x, "y": 0}, fields={"body": _note_body("Image-to-image workflow", model_label)}),
            AssistantGraphOperation(op="add_node", node_ref="source", node_type="media.load_image", title="Source image", position={"x": x, "y": 300}, fields=load_fields),
            AssistantGraphOperation(op="add_node", node_ref="prompt", node_type="prompt.text", title="Prompt", position={"x": x, "y": 820}, fields={"text": _prompt_from_message(message)}),
            AssistantGraphOperation(op="add_node", node_ref="model", node_type=model_type, title=model_label, position={"x": x + 500, "y": 520}),
            AssistantGraphOperation(op="add_node", node_ref="preview", node_type="preview.image", title="Preview", position={"x": x + 980, "y": 300}),
            AssistantGraphOperation(op="add_node", node_ref="save", node_type="media.save_image", title="Save image", position={"x": x + 980, "y": 820}),
            AssistantGraphOperation(op="connect_nodes", source_ref="source", source_port="image", target_ref="model", target_port="image_refs"),
            AssistantGraphOperation(op="connect_nodes", source_ref="prompt", source_port="text", target_ref="model", target_port="prompt"),
            AssistantGraphOperation(op="connect_nodes", source_ref="model", source_port="image", target_ref="preview", target_port="image"),
            AssistantGraphOperation(op="connect_nodes", source_ref="model", source_port="image", target_ref="save", target_port="image"),
            AssistantGraphOperation(op="group_nodes", group_ref="image-to-image", title="Image-to-image workflow", color="blue", node_refs=["note", "source", "prompt", "model", "preview", "save"]),
        ],
        warnings=[] if reference_id else ["Attach or select a source image before running this workflow."],
    )


def _graph_text_to_image_plan(message: str, workflow: GraphWorkflow) -> AssistantGraphPlan:
    model_type = _available_type(TEXT_TO_IMAGE_TYPES)
    if not model_type:
        return AssistantGraphPlan(
            summary="I could not find an available text-to-image model node.",
            questions=["Which image model should Media Studio use once it is enabled?"],
            warnings=["No text-to-image model node is currently available."],
        )
    x = _base_x(workflow)
    model_label = registry.get_definition(model_type).title
    return AssistantGraphPlan(
        summary="Create a text-to-image workflow with a prompt, model, preview, and save output.",
        operations=[
            AssistantGraphOperation(op="add_node", node_ref="note", node_type="utility.note", title="Guide", position={"x": x, "y": 0}, fields={"body": _note_body("Text-to-image workflow", model_label)}),
            AssistantGraphOperation(op="add_node", node_ref="prompt", node_type="prompt.text", title="Prompt", position={"x": x, "y": 360}, fields={"text": _prompt_from_message(message)}),
            AssistantGraphOperation(op="add_node", node_ref="model", node_type=model_type, title=model_label, position={"x": x + 500, "y": 360}),
            AssistantGraphOperation(op="add_node", node_ref="preview", node_type="preview.image", title="Preview", position={"x": x + 980, "y": 220}),
            AssistantGraphOperation(op="add_node", node_ref="save", node_type="media.save_image", title="Save image", position={"x": x + 980, "y": 740}),
            AssistantGraphOperation(op="connect_nodes", source_ref="prompt", source_port="text", target_ref="model", target_port="prompt"),
            AssistantGraphOperation(op="connect_nodes", source_ref="model", source_port="image", target_ref="preview", target_port="image"),
            AssistantGraphOperation(op="connect_nodes", source_ref="model", source_port="image", target_ref="save", target_port="image"),
            AssistantGraphOperation(op="group_nodes", group_ref="text-to-image", title="Text-to-image workflow", color="blue", node_refs=["note", "prompt", "model", "preview", "save"]),
        ],
    )


def _graph_preset_sandbox_plan(message: str, workflow: GraphWorkflow, attachments: List[Dict]) -> AssistantGraphPlan:
    proposal_message = _message_without_style_brief_marker(message)
    raw_message_intent = _intent(message)
    proposal_intent = _intent(proposal_message)
    capability = match_preset_capability(proposal_message, attachments)
    proposal = build_preset_builder_proposal(proposal_message, attachments)
    style_brief = extract_reference_style_brief_from_message(message)
    if style_brief and has_concrete_style_traits(style_brief) and "Suggested setup" in proposal_message:
        synced_style_brief = sync_reference_style_brief_with_visible_setup(style_brief, proposal_message)
        if synced_style_brief and has_concrete_style_traits(synced_style_brief):
            style_brief = synced_style_brief
    initial_contract = proposal.get("preset_contract") if isinstance(proposal.get("preset_contract"), dict) else {}
    initial_fields = initial_contract.get("fields") if isinstance(initial_contract.get("fields"), list) else []
    explicit_field_override = bool(infer_explicit_preset_fields(proposal_message))
    if (
        style_brief
        and has_concrete_style_traits(style_brief)
        and (style_brief.preset_contract.fields or style_brief.preset_contract.image_slots)
        and not explicit_field_override
    ):
        proposal = merge_reference_style_contract_into_proposal(proposal, style_brief)
    elif (
        style_brief
        and has_concrete_style_traits(style_brief)
        and (
            not initial_fields
            or _fields_are_generic_image_loop_defaults(initial_fields)
            or _fields_include_setup_parse_leak(initial_fields)
        )
    ):
        proposal = merge_reference_style_contract_into_proposal(proposal, style_brief)
    contract = proposal.get("preset_contract") if isinstance(proposal.get("preset_contract"), dict) else {}
    fields = contract.get("fields") if isinstance(contract.get("fields"), list) else []
    if (
        style_brief
        and has_concrete_style_traits(style_brief)
        and style_brief.preset_contract.fields
        and not explicit_field_override
    ):
        fields = [
            {
                "key": field.key,
                "label": field.label,
                "required": field.required,
                "placeholder": field.purpose or f"{field.label}.",
                "default_value": field.default_value,
            }
            for field in style_brief.preset_contract.fields
        ]
    fields = _fields_with_inline_values(_sandbox_fields_with_values(fields, proposal_message), proposal_message)
    contract_slots = contract.get("image_slots") if isinstance(contract.get("image_slots"), list) else []
    explicit_slots = _explicit_runtime_image_slots(proposal_message)
    if explicit_slots:
        contract_slots = explicit_slots
    explicit_image_intent = proposal_intent == "image_to_image" or (
        proposal_intent != "text_to_image" and raw_message_intent == "image_to_image"
    )
    brief_text_only = bool(
        style_brief
        and has_concrete_style_traits(style_brief)
        and not explicit_image_intent
        and not explicit_slots
        and (
            style_brief.preset_direction.target_model_mode == "text_to_image"
            or style_brief.preset_direction.input_mode == "no_image"
            or (not style_brief.preset_contract.image_slots and not contract_slots and wants_text_only_preset(proposal_message))
        )
    )
    if brief_text_only:
        contract_slots = []
    explicit_image_input = explicit_image_intent or bool(contract_slots)
    use_style_extraction_prompt = _uses_extracted_style_prompt_sandbox(message) and not explicit_image_input
    explicit_text_only = (brief_text_only or wants_text_only_preset(proposal_message)) and not explicit_image_intent
    if explicit_text_only:
        contract_slots = []
    style_reference_text_only = (
        explicit_text_only
        or use_style_extraction_prompt
        or (capability.get("id") == "reference_style_preset" and not contract_slots and not explicit_image_intent)
    )
    model_type = _available_type(
        TEXT_TO_IMAGE_TYPES
        if style_reference_text_only
        else IMAGE_TO_IMAGE_TYPES
        if attachments or contract_slots or explicit_image_input
        else TEXT_TO_IMAGE_TYPES
    )
    if not model_type:
        return AssistantGraphPlan(
            summary="I could not find an available image model node for the preset test workflow.",
            questions=["Which image model should Media Studio use once it is enabled?"],
            warnings=["No compatible image model node is currently available."],
        )
    x = _base_x(workflow)
    model_label = registry.get_definition(model_type).title
    if style_reference_text_only:
        slot_specs = []
    elif contract_slots:
        slot_specs = [
            {
                "key": _slug(str(slot.get("key") or f"image_{index + 1}")),
                "label": str(slot.get("label") or slot.get("key") or f"Image Input {index + 1}"),
                "reference_id": "",
            }
            for index, slot in enumerate(contract_slots)
            if isinstance(slot, dict)
        ]
    else:
        slot_specs = [{"key": "runtime_reference", "label": "Runtime Reference", "reference_id": ""}]

    plan_title = str(proposal.get("title") or "Media Preset")
    if style_brief and has_concrete_style_traits(style_brief):
        plan_title = str(style_brief.preset_direction.title or plan_title)
    style_placeholder = "polished reference-derived style, cohesive subject details, cinematic lighting"
    if fields and isinstance(fields[0], dict):
        style_placeholder = str(fields[0].get("placeholder") or style_placeholder).replace("Example: ", "")
    compiled_style_prompt = ""
    prompt_fields = _fields_with_sandbox_prompt_values(fields, style_brief) if style_reference_text_only else fields
    if style_reference_text_only:
        prompt_fields = _fields_for_compiled_test_prompt(prompt_fields, proposal_message)
    if style_brief and has_concrete_style_traits(style_brief):
        if style_reference_text_only:
            compiled_style_prompt = compile_reference_style_t2i_prompt(style_brief, fields=prompt_fields)
        else:
            compiled_style_prompt = compile_reference_style_i2i_prompt(
                style_brief,
                fields=prompt_fields,
                image_slots=slot_specs,
            )
    if style_reference_text_only:
        prompt_text = compiled_style_prompt or _extracted_style_sandbox_prompt(message)
    else:
        prompt_text = compiled_style_prompt
    if not prompt_text:
        return AssistantGraphPlan(
            summary="I need a concrete style read before creating a runnable preset test workflow.",
            questions=[
                "Analyze the attached reference images first, then create the test workflow from that extracted style."
            ],
            warnings=[
                "I did not create a generic placeholder graph because the style details were not concrete enough yet."
            ],
            requires_confirmation=False,
        )

    warnings: List[str] = []
    normalized_slots: List[Dict[str, Any]] = []
    for index, slot in enumerate(slot_specs):
        node_ref = str(slot.get("key") or f"image_{index + 1}")
        label = str(slot.get("label") or f"Image Input {index + 1}")
        reference_id = str(slot.get("reference_id") or "")
        if not reference_id:
            warnings.append(_runtime_image_warning(label, sandbox=True))
        normalized_slots.append(
            {
                **slot,
                "node_ref": node_ref,
                "key": node_ref,
                "label": label,
                "reference_id": reference_id,
            }
        )
    template_id = T2I_SANDBOX_TEMPLATE_ID if style_reference_text_only else I2I_SANDBOX_TEMPLATE_ID
    return instantiate_preset_sandbox_template(
        template_id=template_id,
        base_x=x,
        title=plan_title,
        prompt=prompt_text,
        model_type=model_type,
        model_label=model_label,
        image_slots=normalized_slots,
        text_fields=fields,
        warnings=warnings,
        style_reference_text_only=style_reference_text_only,
    )


def _node_title(node) -> str:
    metadata = node.metadata if isinstance(node.metadata, dict) else {}
    ui = metadata.get("ui") if isinstance(metadata.get("ui"), dict) else {}
    return str(ui.get("customTitle") or "")


def _semantic_ref(node) -> str:
    metadata = node.metadata if isinstance(node.metadata, dict) else {}
    assistant = metadata.get("assistant") if isinstance(metadata.get("assistant"), dict) else {}
    return str(assistant.get("semantic_ref") or "")


def _sandbox_prompt_node(workflow: GraphWorkflow):
    for node in workflow.nodes:
        if node.type == "prompt.text" and _semantic_ref(node) == "prompt":
            return node
    for node in workflow.nodes:
        if node.type == "prompt.text" and _node_title(node).lower() == "draft preset prompt":
            return node
    return None


def _latest_run_has_image_output(latest_run: Dict[str, Any] | None) -> bool:
    if not isinstance(latest_run, dict):
        return False
    artifacts = latest_run.get("artifacts")
    if not isinstance(artifacts, list):
        return False
    for artifact in artifacts:
        if not isinstance(artifact, dict):
            continue
        media_type = str(artifact.get("media_type") or artifact.get("kind") or "").lower()
        if media_type in {"", "image"}:
            return True
    return False


def _is_output_aware_refinement_request(message: str, workflow: GraphWorkflow, latest_run: Dict[str, Any] | None) -> bool:
    if not _latest_run_has_image_output(latest_run):
        return False
    if not _sandbox_prompt_node(workflow):
        return False
    text = message.lower()
    if not any(term in text for term in ("compare", "comparison", "current output", "latest output", "new output", "result", "generated")):
        return False
    return any(term in text for term in ("reference", "refs", "style", "closer", "match", "missing", "push", "refine", "adjust", "update"))


def _is_preset_sandbox_refinement_request(message: str, workflow: GraphWorkflow) -> bool:
    text = re.split(r"Reference style brief JSON:|Prior assistant reference-style analysis:", str(message or ""), maxsplit=1)[0].lower()
    if not _sandbox_prompt_node(workflow):
        return False
    if any(term in text for term in ("create", "build", "make", "new")) and any(
        term in text for term in ("temporary sandbox", "test graph", "sandbox graph", "workflow")
    ):
        return False
    if not any(term in text for term in ("refine", "closer", "compare", "match", "style", "tweak", "adjust", "honed", "hone", "update", "apply")):
        return False
    return any(term in text for term in ("current output", "output", "reference", "refs", "sandbox", "draft preset prompt", "prompt", "that"))


def _prior_output_comparison_notes(message: str) -> str:
    marker = "Prior assistant output comparison:"
    if marker not in str(message or ""):
        return ""
    notes = str(message).split(marker, 1)[1]
    notes = re.split(r"\n\n|Reference style brief JSON:|Prior assistant reference-style analysis:", notes, maxsplit=1)[0]
    raw_lines = [line.strip(" -\t") for line in notes.splitlines() if line.strip(" -\t")]
    lines: List[str] = []
    for raw_line in raw_lines:
        split_line = re.sub(
            r";\s*((?:improve|missing|prompt tweak|next prompt change|prompt delta|next change|suggested update|refine once|recommendation)\s*:)",
            r"\n\1",
            raw_line,
            flags=re.IGNORECASE,
        )
        lines.extend(part.strip(" -\t") for part in split_line.splitlines() if part.strip(" -\t"))
    accepted: List[str] = []
    rejected_terms = ("full prompt", "```", "reviewable graph plan", "plan card")
    for line in lines:
        lowered = line.lower()
        if re.match(r"^\s*matches?\s*:", line, flags=re.IGNORECASE):
            continue
        if any(term in lowered for term in rejected_terms):
            continue
        if len(line) > 700:
            line = line[:697].rstrip() + "..."
        if line and line not in accepted:
            accepted.append(line)
        if len(accepted) >= 3:
            break
    return "; ".join(accepted)


def _requested_refinement_emphasis(message: str) -> str:
    text = " ".join(str(message or "").split())
    text = re.split(r"Prior assistant output comparison:|Reference style brief JSON:|Prior assistant reference-style analysis:", text, maxsplit=1)[0]
    exact_delta_match = re.search(
        r"\b(?:using\s+this\s+)?exact\s+comparison\s+delta\s+only\s*:\s*(.+?)(?:\.\s*Do\s+not\b|$)",
        text,
        flags=re.IGNORECASE,
    )
    if exact_delta_match:
        emphasis = exact_delta_match.group(1).strip(" .,:;")
        if emphasis:
            return emphasis[:260]
    patterns = (
        r"\bpush\b[^.]{0,80}?\b(?:closer|toward|towards)\b(?:\s+to)?\s+([^.\n]{8,260})",
        r"\bmissing\b\s+([^.\n]{8,220})",
        r"\bmore\b\s+([^.\n]{8,220})",
    )
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if not match:
            continue
        emphasis = match.group(1).strip(" .,:;")
        emphasis = re.sub(r"\b(and then|then create|create a reviewable|apply it|test it again)\b.*$", "", emphasis, flags=re.IGNORECASE).strip(" .,:;")
        if emphasis:
            return emphasis[:260]
    return ""


def _should_compile_refinement_base_from_style_brief(existing_prompt: str) -> bool:
    text = " ".join(str(existing_prompt or "").lower().split())
    if not text:
        return True
    generic_markers = (
        "create a polished media image using the attached references as fixed style inspiration",
        "create a polished image from this prompt",
        "using the attached references as fixed style inspiration",
    )
    return any(marker in text for marker in generic_markers)


def _generation_refinement_directive(details: str) -> str:
    text = " ".join(str(details or "").split())
    if not text:
        return ""
    needs_style_weight = bool(re.search(r"\breference style needs to be weighted harder\b", text, flags=re.IGNORECASE))
    text = re.sub(
        r"\bcompare against the latest generated output and push the next prompt closer to the currently attached references;?\s*",
        "",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r"\bcompare against the latest generated output and strengthen the missing visual traits from the approved reference style;?\s*",
        "",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(r"\buser-requested emphasis:\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\bvisual comparison notes:\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\bMatches:\s*[^.;]+[.;]\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\b(?:Missing|Improve|Prompt tweak|Recommendation):\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\b(?:Next prompt change|Prompt delta|Next change|Suggested update)\s*:\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\bEmphasize this in the prompt\s*:\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\bRefine(?:\s+once)?\s*:\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\bClose enough to justify one last paid refinement\b[.;]?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\bNeeds one minor refinement[^.;]*[.;]?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\bone\s+more\s+prompt\s+pass\s+should\s+(?:push|increase|add|strengthen)\s+", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\bI\s+would\s+update\s+once\s+more\s+rather\s+than\s+save\s+yet\b[.;]?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\bthe latest output is usable\b[.;]?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\bthe reference style needs to be weighted harder\b[.;]?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(
        r"\b(?:the\s+)?reference(?:\s+style)?\s+(?:has|needs|uses|feels|is)\s+(?:a\s+|an\s+|the\s+)?",
        "",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(r"\bthe next step should be a focused test prompt update\b[^.;]*[.;]?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\bnot a saved preset yet\b[.;]?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\b(?:save|saved|saving)\s+(?:the\s+)?(?:media\s+)?preset\b[^.;]*[.;]?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(
        r"\b(?:the|this)\s+(?:output|result|image)\s+(?:feels|looks|is|leans)\s+[^.;]+[.;]\s*(?:the\s+reference\s+(?:has|is|feels|uses)\s+)?",
        "",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r"\b(?:the|this)\s+(?:output|result|image|version)\s+(?:still\s+)?(?:feels|looks|is|leans)\s+[^.;]+[.;]?\s*",
        "",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r"\b(?:a\s+few\s+)?branded/readable\s+merch\s+details\s+still\s+pulling\s+focus\b[.;]?\s*",
        "suppress readable text, logos, and branded merch accents",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r"\b(?:the|this)?\s*(?:output|result|image)\s+reads\s+too\s+much\s+like\s+[^.;]+[.;]?\s*",
        "",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r"\b(?:the|this)\s+(?:output|result|image|version)\s+"
        r"(?:shifts?|drifts?|moves|leans)\s+(?:into|toward|towards|to)\s+[^.;]+"
        r"(?:instead\s+of\s+[^.;]+)?[.;]?\s*",
        "",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(r"\bpush\s+(?:the\s+)?(?:prompt|result|image|output|it)\s+toward\s+", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\bI(?:'|’)d\s+tighten\s+", "tighter ", text, flags=re.IGNORECASE)
    text = re.sub(r"\bI\s+would\s+tighten\s+", "tighter ", text, flags=re.IGNORECASE)
    text = re.sub(r"\btighter\s+the\s+", "tighter ", text, flags=re.IGNORECASE)
    text = re.sub(
        r"\b(?:close,?\s+but\s+)?I(?:'|’)d\s+do\s+one\s+more\s+pass\s+to\s+",
        "",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(r"\bbefore saving(?:\s+the\s+preset)?\b", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\bbefore\b(?=[.;\s]*$)", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\bthe preset\b", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\bthis version leans\s+", "reduce ", text, flags=re.IGNORECASE)
    text = re.sub(r"\bwith less\s+", "add more ", text, flags=re.IGNORECASE)
    text = re.sub(r"^\s*push\s+(?:for\s+|the\s+prompt\s+to\s+)?", "", text, flags=re.IGNORECASE)
    text = re.sub(r"(?<=;)\s*push\s+(?:for\s+|the\s+prompt\s+to\s+)?", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"\bpush\s+a\s+(slightly|more|stronger|clearer|denser|softer|brighter|darker)\b", r"\1", text, flags=re.IGNORECASE)
    text = re.sub(
        r"\b[^.;]*(?:\bis\s+there\b|\breads\s+clearly\b|\bnow\s+has\b|\bare\s+landing\s+well\b)[^.;]*[.;]?\s*",
        "",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(r"^\s*a\s+(slightly|more|stronger|clearer|denser|softer|brighter|darker)\b", r"\1", text, flags=re.IGNORECASE)
    text = re.sub(r"^\s*the\s+", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\bI can prepare\b.*$", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\bWant me\b.*$", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\bprep that final prompt tweak\b[?]?", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\bapply it\b.*$", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\btest it again\b.*$", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\b(?:and\s+)?then\s+(?:run|rerun|test|try)\s+(?:it\s+|the\s+workflow\s+|the\s+graph\s+)?again\b.*$", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\b(?:and\s+)?(?:run|rerun|test|try)\s+(?:it\s+|the\s+workflow\s+|the\s+graph\s+)?again\b.*$", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*;\s*", "; ", text)
    text = re.sub(r"(?:^|;\s*)[.;:\s]*(?=;|$)", "", text)
    text = re.sub(r";\s*;", "; ", text)
    text = re.sub(r"\s*,\s*\.", ".", text)
    text = re.sub(r"\s*,\s*$", "", text)
    text = re.sub(r"\s+", " ", text).strip(" .;")
    if needs_style_weight and not text:
        return (
            "stronger weighting of the fixed visual mechanics above, especially camera angle, scale relationship, "
            "palette, lighting, rendering texture, and primary subject hierarchy"
        )
    return text[:900]


def _generation_refinement_sentence(details: str) -> str:
    clean = " ".join(str(details or "").split()).strip(" .;")
    if not clean:
        return ""
    lowered = clean.lower()
    if lowered.startswith(("tighter ", "cleaner ", "looser ", "stronger ", "clearer ", "denser ", "softer ", "brighter ", "darker ")):
        return f"Use a {clean}."
    if lowered.startswith(("more ", "less ", "extra ", "additional ")):
        return f"Add {clean}."
    if lowered.startswith(("reduce ", "avoid ", "remove ")):
        return clean[0].upper() + clean[1:] + "."
    return f"Emphasize {clean}."


def _sanitize_existing_generation_prompt(prompt: str) -> str:
    text = str(prompt or "")
    if not text:
        return ""
    replacements = (
        (
            r"\bvisible\s+branded\s+book\s+spines\s+and\s+graphic\s+merchandise\s+text\b",
            "invented collectible book spines and decorative graphic set dressing with no real brands",
        ),
        (r"\bbranded\s+book\s+spines\b", "invented collectible book spines"),
        (r"\bgraphic\s+merchandise\s+text\b", "decorative graphic set dressing with no real brands"),
        (r"\bvisible\s+branded\b", "invented decorative"),
        (r"\bmerchandise\s+text\b", "decorative graphic detail"),
    )
    for pattern, replacement in replacements:
        text = re.sub(pattern, replacement, text, flags=re.IGNORECASE)
    return text


def _refined_sandbox_prompt(message: str, existing_prompt: str, *, output_aware: bool = False) -> str:
    capability = match_refinement_capability(message, existing_prompt)
    refinement = capability.get("refinement") if isinstance(capability.get("refinement"), dict) else {}
    year = sample_year(message, [], extra_text=existing_prompt)
    details = refinement_details(capability, message, output_aware=output_aware, year=year)
    comparison_notes = _prior_output_comparison_notes(message) if output_aware else ""
    requested_emphasis = _requested_refinement_emphasis(message)
    if requested_emphasis:
        details = "; ".join(item for item in [details, f"user-requested emphasis: {requested_emphasis}"] if item)
    if comparison_notes:
        details = "; ".join(item for item in [details, f"visual comparison notes: {comparison_notes}"] if item)
    base_source = re.sub(
        r"\s+(?:Additional visual direction\s*:|Strengthen the next version (?:by adding more of|with)\b|Increase\b|Emphasize\b|Add\b|Use a\b)\s*.*$",
        "",
        str(existing_prompt or ""),
        flags=re.IGNORECASE | re.DOTALL,
    )
    base_prompt = _sanitize_existing_generation_prompt(" ".join(base_source.split())) or "Create a polished media image using the attached references as fixed style inspiration."
    style_brief = extract_reference_style_brief_from_message(message)
    explicit_fields = _fields_with_inline_values(
        infer_explicit_preset_fields(_message_without_style_brief_marker(message)),
        _message_without_style_brief_marker(message),
    )
    wants_field_specific_recompile = bool(explicit_fields) and any(
        term in _message_without_style_brief_marker(message).lower()
        for term in ("field instruction", "field-specific", "specific to what it controls", "approved fields")
    )
    if (
        (_should_compile_refinement_base_from_style_brief(existing_prompt) or wants_field_specific_recompile)
        and style_brief
        and has_concrete_style_traits(style_brief)
    ):
        proposal = build_preset_builder_proposal(_message_without_style_brief_marker(message), [])
        contract = proposal.get("preset_contract") if isinstance(proposal.get("preset_contract"), dict) else {}
        contract_fields = explicit_fields or (contract.get("fields") if isinstance(contract.get("fields"), list) else [])
        contract_slots = contract.get("image_slots") if isinstance(contract.get("image_slots"), list) else []
        compiled = (
            compile_reference_style_i2i_prompt(style_brief, fields=contract_fields, image_slots=contract_slots)
            if contract_slots
            else compile_reference_style_t2i_prompt(style_brief, fields=contract_fields)
        )
        if compiled:
            base_prompt = compiled
            if wants_field_specific_recompile and not output_aware:
                return base_prompt
    clean_details = _generation_refinement_directive(details)
    if not clean_details:
        clean_details = "the visible reference style while preserving the existing subject image and core composition"
    clean_details = clean_details.rstrip(" .;")
    directive = _generation_refinement_sentence(clean_details)
    return f"{base_prompt}\n\n{directive}"


def _graph_preset_sandbox_refinement_plan(message: str, workflow: GraphWorkflow, *, latest_run: Dict[str, Any] | None = None) -> AssistantGraphPlan:
    prompt_node = _sandbox_prompt_node(workflow)
    existing_prompt = str((prompt_node.fields or {}).get("text") or "") if prompt_node else ""
    output_aware = _is_output_aware_refinement_request(message, workflow, latest_run) or "Prior assistant output comparison:" in str(message or "")
    capability = match_refinement_capability(message, existing_prompt)
    refinement = capability.get("refinement") if isinstance(capability.get("refinement"), dict) else {}
    target_label = str(refinement.get("target_label") or "attached style references")
    return AssistantGraphPlan(
        summary=(
            f"Compare the latest generated output against the {target_label} and update the test prompt for the next run."
            if output_aware
            else f"Refine the existing preset test prompt so the next run matches the {target_label} more closely."
        ),
        operations=[
            AssistantGraphOperation(
                op="set_node_field",
                node_id=prompt_node.id if prompt_node else None,
                fields={"text": _refined_sandbox_prompt(message, existing_prompt, output_aware=output_aware)},
            )
        ],
        warnings=[
            (
                "This uses the latest completed run output as comparison context, then only updates the editable Draft preset prompt. "
                "It does not run the graph or save a Media Preset."
            )
            if output_aware
            else "This only updates the editable Draft preset prompt. It does not run the graph or save a Media Preset."
        ],
    )


def plan_graph_from_message(message: str, workflow: GraphWorkflow, attachments: List[Dict], latest_run: Dict[str, Any] | None = None) -> AssistantGraphPlan:
    intent = _intent(message)
    if _is_output_aware_refinement_request(message, workflow, latest_run):
        return _graph_preset_sandbox_refinement_plan(message, workflow, latest_run=latest_run)
    if _is_preset_sandbox_refinement_request(message, workflow):
        return _graph_preset_sandbox_refinement_plan(message, workflow)
    if _sandbox_prompt_node(workflow) and _wants_style_prompt_update(message):
        return _graph_preset_sandbox_refinement_plan(message, workflow)
    if _saved_preset_reuse_request(message):
        return _graph_existing_preset_plan(message, workflow, attachments)
    if (
        is_reference_preset_request(message, attachments)
        or _uses_extracted_style_prompt_sandbox(message)
    ) and wants_sandbox_example(message):
        return _graph_preset_sandbox_plan(message, workflow, attachments)
    preset_plan = _graph_existing_preset_plan(message, workflow, attachments)
    if preset_plan.capability == "plan_graph" and not _new_preset_build_request(message):
        return preset_plan
    if ("preset" in message.lower() or "media preset" in message.lower()) and not _new_preset_build_request(message):
        return preset_plan
    if intent == "image_to_image":
        return _graph_image_to_image_plan(message, workflow, attachments)
    if intent == "text_to_image":
        return _graph_text_to_image_plan(message, workflow)
    return AssistantGraphPlan(
        capability="answer_question",
        summary="I can help plan Media Studio graphs, recipes, and presets. Tell me what you want to build and I will propose a validated graph plan before changing the canvas.",
        questions=["What should this workflow create, and what media should it use?"],
        operations=[],
        requires_confirmation=False,
    )
