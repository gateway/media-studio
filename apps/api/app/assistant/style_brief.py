from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, Field, ValidationError

from ..store_support import new_id
from .preset_skill import PromptQualityResult, score_preset_prompt


BRIEF_MARKER = "Reference style brief JSON:"
PROVIDER_BRIEF_JSON_OPEN = "REFERENCE_STYLE_BRIEF_JSON_START"
PROVIDER_BRIEF_JSON_CLOSE = "REFERENCE_STYLE_BRIEF_JSON_END"
STYLE_BRIEF_VERSION = 1
REFERENCE_STYLE_PROMPT_MAX_CHARS = 6000

META_PROMPT_PATTERNS = (
    "extract the reusable visual style",
    "prior attached references",
    "prior references",
    "chat context",
    "hidden reasoning",
)

GENERATION_PROMPT_BLOCKLIST = (
    *META_PROMPT_PATTERNS,
    "media preset",
    "graph studio",
    "temporary test",
    "temporary sandbox",
    "runtime image input",
    "runtime image inputs",
    "runtime subject",
    "source image slot",
    "best image input",
    "actual preset",
    "assistant",
)


class ReferenceStylePresetDirection(BaseModel):
    title: str = "Reference Style Preset"
    one_line_summary: str = ""
    target_model_mode: str = "undecided"
    description: str = ""
    key: str = ""
    workflow_key: str = ""
    preset_kind: Literal["generator", "image_transform", "pipeline", "undecided"] = "undecided"
    input_mode: Literal["no_image", "image_required", "image_optional", "undecided"] = "undecided"


class ReferenceStylePresetField(BaseModel):
    key: str
    label: str
    purpose: str = ""
    required: bool = False
    default_value: str = ""


class ReferenceStyleImageSlot(BaseModel):
    key: str
    label: str
    purpose: str = ""
    required: bool = False


class ReferenceStylePresetContract(BaseModel):
    fields: List[ReferenceStylePresetField] = Field(default_factory=list)
    image_slots: List[ReferenceStyleImageSlot] = Field(default_factory=list)


class ReferenceStylePromptTemplate(BaseModel):
    prompt: str = ""
    model_mode: str = "undecided"
    field_keys: List[str] = Field(default_factory=list)
    image_slot_keys: List[str] = Field(default_factory=list)
    quality_score: int = 0
    quality_issues: List[str] = Field(default_factory=list)


class ReferenceStylePromptBlueprint(BaseModel):
    fixed_style_ingredients: List[str] = Field(default_factory=list)
    variable_ingredients: List[str] = Field(default_factory=list)
    negative_guidance: List[str] = Field(default_factory=list)


class ReferenceStyleVerificationTargets(BaseModel):
    must_match: List[str] = Field(default_factory=list)
    may_vary: List[str] = Field(default_factory=list)
    must_not_copy: List[str] = Field(default_factory=list)


class ReferenceStyleBrief(BaseModel):
    brief_id: str
    source_attachment_ids: List[str] = Field(default_factory=list)
    source_reference_ids: List[str] = Field(default_factory=list)
    created_from_message_id: Optional[str] = None
    version: int = STYLE_BRIEF_VERSION
    status: str = "draft"
    preset_direction: ReferenceStylePresetDirection = Field(default_factory=ReferenceStylePresetDirection)
    visual_analysis: Dict[str, List[str]] = Field(default_factory=dict)
    preset_contract: ReferenceStylePresetContract = Field(default_factory=ReferenceStylePresetContract)
    prompt_template: ReferenceStylePromptTemplate = Field(default_factory=ReferenceStylePromptTemplate)
    prompt_blueprint: ReferenceStylePromptBlueprint = Field(default_factory=ReferenceStylePromptBlueprint)
    verification_targets: ReferenceStyleVerificationTargets = Field(default_factory=ReferenceStyleVerificationTargets)
    fixed_style_traits: List[str] = Field(default_factory=list)
    replaceable_elements: List[str] = Field(default_factory=list)
    source_specific_exclusions: List[str] = Field(default_factory=list)
    recommended_fields: List[ReferenceStylePresetField] = Field(default_factory=list)
    recommended_image_slots: List[ReferenceStyleImageSlot] = Field(default_factory=list)
    validation_warnings: List[str] = Field(default_factory=list)


class ReferenceStyleOutputCheck(BaseModel):
    match_summary: str = ""
    missing_traits: List[str] = Field(default_factory=list)
    prompt_delta: str = ""
    next_action: str = "ask_user"
    latest_output_asset_id: Optional[str] = None
    reference_ids: List[str] = Field(default_factory=list)


class ReferenceStylePromptCompileResult(BaseModel):
    prompt: str = ""
    model_mode: str = "text_to_image"
    prompt_quality_score: int = 0
    prompt_quality_passed: bool = False
    prompt_quality_issues: List[str] = Field(default_factory=list)
    fixmyphoto_planner_score: int = 0
    fixmyphoto_planner_issues: List[str] = Field(default_factory=list)
    generation_directness_score: int = 0
    generation_directness_issues: List[str] = Field(default_factory=list)
    field_keys: List[str] = Field(default_factory=list)
    image_slot_keys: List[str] = Field(default_factory=list)
    contract_validation_status: str = "valid"
    contract_validation_issues: List[str] = Field(default_factory=list)


class ReferenceStylePresetContractValidation(BaseModel):
    status: Literal["valid", "invalid"] = "valid"
    issues: List[str] = Field(default_factory=list)
    field_keys: List[str] = Field(default_factory=list)
    image_slot_keys: List[str] = Field(default_factory=list)
    input_mode: str = "undecided"


def _clean_text(value: Any) -> str:
    text = re.sub(r"```.*?```", " ", str(value or ""), flags=re.DOTALL)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _clean_label(value: Any) -> str:
    label = _clean_text(value).replace("_", " ").strip(" .,:;`\"'*_")
    if label and label == label.lower():
        label = label.title()
    return label


def _short_field_label(value: Any) -> str:
    label = _clean_label(value)
    label = re.split(r"\s+(?:for|to)\s+", label, maxsplit=1, flags=re.IGNORECASE)[0]
    return _clean_label(label)[:48]


def _human_reference_field_terms(key: str, label: str, purpose: str) -> tuple[str, str, str]:
    """Keep provider/planner taxonomy out of user-facing preset fields."""
    normalized = _clean_text(f"{key} {label}").lower().replace("_", " ")
    if any(term in normalized for term in ("full body figure", "full-body figure", "lead figure", "central figure")):
        return (
            "main_character",
            "Main Character",
            "Main character, subject, or role the user wants rendered in this style.",
        )
    if any(term in normalized for term in ("fandom theme", "fandom mix", "fan theme", "companion cast", "supporting cast", "character cast", "character ensemble theme", "ensemble theme")):
        return (
            "companion_characters",
            "Companion Characters",
            "Original supporting characters, creatures, collectibles, or fan-world details that surround the main focus.",
        )
    if any(term in normalized for term in ("companion motif", "spirit motif", "accent creature")):
        return (
            "companion_creature",
            "Companion Creature",
            "Creature, spirit, symbol, or accent companion that supports the main subject.",
        )
    if any(term in normalized for term in ("celestial disc", "moon disc", "sun disc", "eclipse disc")):
        return (
            "moon_sun_disc",
            "Moon / Sun Disc",
            "Moon, sun, eclipse, portal, or glowing disc element in the scene.",
        )
    if any(term in normalized for term in ("celestial body", "moon body", "sun body", "eclipse body")):
        return (
            "moon_sun_disc",
            "Moon / Sun Disc",
            "Moon, sun, eclipse, planet, portal, or glowing disc element in the scene.",
        )
    if any(term in normalized for term in ("sky motif", "celestial motif", "celestial element", "celestial form", "celestial event", "moon motif", "sun motif", "star motif")):
        return (
            "moon_sky_element",
            "Moon / Sky Element",
            "Moon, sun, stars, clouds, eclipse, or sky element that anchors the scene.",
        )
    if "mythic motif" in normalized or "featured motif" in normalized:
        return (
            "mythic_symbol",
            "Mythic Symbol",
            "Mythic symbol, creature mark, celestial sign, or magical emblem that supports the scene.",
        )
    if any(term in normalized for term in ("graphic mood", "extra doodle", "extra doodles", "doodle symbols", "doodle marks")):
        return (
            "graphic_symbols",
            "Graphic Symbols",
            "Doodles, symbols, marks, stickers, or graphic accents the user wants included in the design.",
        )
    if any(term in normalized for term in ("main motif", "central motif", "key motif")):
        return (
            "graphic_symbol",
            "Graphic Symbol",
            "Graphic symbol, badge, icon, motif, or visual mark the user wants repeated in the design.",
        )
    if any(term in normalized for term in ("element contrast", "elemental contrast", "elemental theme", "color contrast", "colour contrast")):
        return (
            "color_contrast",
            "Color Contrast",
            "Main color or elemental contrast, such as blue mist against gold fire.",
        )
    if any(term in normalized for term in ("battle damage", "damage level", "wear level", "weathering level", "scratches level", "surface wear", "paint wear")):
        return (
            "surface_wear_damage",
            "Surface Wear / Damage",
            "Visible scratches, dents, chipped paint, scuffs, battle damage, or weathering on the subject.",
        )
    if any(term in normalized for term in ("augmentation level", "augmentation amount", "cybernetic augmentation", "cybernetic augmentations", "mechanical augmentation", "mechanical augmentations")):
        return (
            "cybernetic_augmentations",
            "Cybernetic Augmentations",
            "Cybernetic limbs, mechanical implants, prosthetics, armor panels, exposed cables, or tech upgrades on the subject.",
        )
    if any(term in normalized for term in ("side quote", "quote text", "margin quote", "side caption")):
        return (
            "side_text",
            "Side Text",
            "Short side caption, quote, label, or marginal text that fits the typography layout.",
        )
    if any(term in normalized for term in ("collection theme", "collector theme", "collectible theme")):
        return (
            "collectibles",
            "Collectibles",
            "Figures, books, posters, props, creatures, or display objects that fill the collection scene.",
        )
    if any(term in normalized for term in ("outfit style", "outfit theme", "outfit direction", "outfit gear direction", "outfit vibe", "wardrobe style", "wardrobe theme", "wardrobe direction", "wardrobe gear direction", "wardrobe vibe", "clothing style", "clothing theme", "clothing direction", "clothing gear direction", "clothing vibe", "gear direction")):
        return (
            "outfit_wardrobe",
            "Outfit / Wardrobe",
            "Wardrobe, outfit, armor, clothing, or styling details for the subject.",
        )
    if any(term in normalized for term in ("armor design", "armor tech details", "armor details", "armor notes", "tech design", "tech details", "tech notes", "augmentation design", "augmentation details", "augmentation notes", "gear augmentation notes", "mechanical design", "mechanical details", "mechanical notes")):
        return (
            "armor_tech_gear",
            "Armor / Tech Gear",
            "Armor, cybernetic gear, mechanical augmentations, panels, cables, or technical markings for the subject.",
        )
    if any(term in normalized for term in ("outfit details", "wardrobe details", "clothing details", "fashion details")):
        return (
            "outfit_wardrobe",
            "Outfit / Wardrobe",
            "Wardrobe, outfit, clothing, footwear, or styling details for the subject.",
        )
    if any(term in normalized for term in ("room decor theme", "decor theme", "room theme", "room style", "room vibe", "interior style", "interior vibe")):
        return (
            "room_decor",
            "Room Decor",
            "Room decor, shelves, posters, furniture, collectibles, and background props.",
        )
    if "landmark" in normalized and any(term in normalized for term in ("detail", "details", "scene", "architecture", "destination")):
        return (
            "destination_landmark",
            "Destination / Landmark",
            "Destination, landmark, architecture, route, or scenic place details that drive the environment.",
        )
    if (
        normalized in {"environment", "scene environment", "environment backdrop"}
        or any(term in normalized for term in ("environment setting", "scene setting", "setting backdrop", "scene backdrop"))
        or (normalized.endswith(" environment") and not any(term in normalized for term in ("room environment", "interior environment")))
    ):
        return (
            "scene_setting",
            "Scene / Setting",
            "Scene environment, backdrop, atmosphere, location type, and supporting context.",
        )
    if any(term in normalized for term in ("accessory details", "accessories details", "prop details", "props details", "accessory notes", "prop notes")):
        return (
            "accessories_props",
            "Accessories / Props",
            "Accessories, props, objects, patches, pins, gear, or small carried details in the scene.",
        )
    if any(term in normalized for term in ("scene brief", "scene prompt", "scene focus")):
        return (
            "scene_setting",
            "Scene / Setting",
            "Scene, setting, or subject direction the user wants rendered in this style.",
        )
    if normalized.strip() in {"environment", "environment environment"}:
        return (
            "scene_setting",
            "Scene / Setting",
            "Scene, setting, backdrop, atmosphere, or world context the user wants rendered in this style.",
        )
    if any(term in normalized for term in ("detail notes", "optional detail notes", "style notes", "optional notes")):
        return (
            "additional_details",
            "Additional Details",
            "Specific props, details, or constraints the user wants included in this style.",
        )
    if any(term in normalized for term in ("hero archetype", "subject archetype", "character archetype", "hero brief", "character role")):
        return (
            "main_character",
            "Main Character",
            "Main character, subject, or role the user wants rendered in this style.",
        )
    if any(term in normalized for term in ("subject brief", "subject concept", "subject direction")):
        return key, label, purpose
    if any(term in normalized for term in ("hero object", "hero prop")):
        return (
            "main_prop",
            "Main Prop",
            "Primary prop or object the user wants featured in this style.",
        )
    if "accent motif" in normalized:
        return (
            "graphic_symbol",
            "Graphic Symbol",
            "Graphic symbol, badge, icon, or motif the user wants repeated in the design.",
        )
    return key, label, purpose


def _human_reference_slot_terms(
    key: str,
    label: str,
    purpose: str,
    *,
    visual_analysis: Dict[str, List[str]] | None = None,
    title: str = "",
) -> tuple[str, str, str]:
    """Keep runtime image slots specific enough for users to understand."""

    normalized = _clean_text(f"{key} {label} {purpose}").lower().replace("_", " ")
    slot_identity = _clean_text(f"{key} {label}").lower().replace("_", " ")
    if "face" in slot_identity or "portrait" in slot_identity:
        return "face_reference", "Face Reference", purpose or "Face or portrait image used for identity and likeness."
    if any(term in slot_identity for term in ("body", "full body", "full-body")):
        return "body_reference", "Body Reference", purpose or "Body, pose, outfit, and silhouette image."
    if "product reference" in slot_identity:
        return key, label, purpose or "Product image used for shape, material, and details."
    if "vehicle reference" in slot_identity or "car reference" in slot_identity:
        return key, label, purpose or "Vehicle image used for shape, paint, and proportions."
    label_normalized = _clean_text(label).lower()
    key_normalized = _clean_text(key).lower().replace("_", " ")
    generic_subject_slot = (
        label_normalized in {
            "base image",
            "main image",
            "source image",
            "source reference",
            "input image",
            "subject image",
            "subject reference",
            "main subject reference",
            "main subject image",
            "portrait image",
        }
        or key_normalized in {
            "base image",
            "main image",
            "source image",
            "source reference",
            "input image",
            "subject image",
            "subject reference",
            "main subject reference",
            "main subject image",
            "portrait image",
        }
        or any(term in label_normalized for term in ("subject image", "subject reference", "main subject reference", "main subject image"))
    )
    if generic_subject_slot:
        analysis = _analysis_text(visual_analysis or {}, [title])
        if not analysis.strip():
            return key, label, purpose
        if any(term in analysis for term in ("dragon", "creature", "monster", "animal", "beast", "spirit form")):
            return "creature_subject", "Creature / Main Subject", purpose or "Creature, animal, or fantasy subject image."
        if any(term in analysis for term in ("warrior", "samurai", "person", "human", "portrait", "character", "elf", "figure")):
            return "person_character", "Person / Character", purpose or "Person or character image used for identity, pose, and proportions."
        return "main_subject", "Main Subject", purpose or "Main subject image used for identity, shape, and composition."
    return key, label, purpose


def _limit_reference_style_prompt(prompt: str, *, max_chars: int = REFERENCE_STYLE_PROMPT_MAX_CHARS) -> str:
    text = _clean_text(prompt)
    if len(text) <= max_chars:
        return text
    cutoff = text[:max_chars].rstrip()
    sentence_boundaries = [
        cutoff.rfind(". "),
        cutoff.rfind("! "),
        cutoff.rfind("? "),
        cutoff.rfind("; "),
    ]
    boundary = max(sentence_boundaries)
    if boundary >= int(max_chars * 0.75):
        trimmed = cutoff[: boundary + 1].rstrip()
    else:
        trimmed = cutoff.rsplit(" ", 1)[0].rstrip(" ,;:")
    if trimmed and trimmed[-1] not in ".!?":
        trimmed += "."
    return trimmed


def _prompt_field_tokens(prompt: str) -> set[str]:
    return {
        match.group(1).strip()
        for match in re.finditer(r"\{\{(?!choice:)([a-zA-Z0-9_]+)\}\}", str(prompt or ""))
        if match.group(1).strip()
    }


def _unsupported_choice_tokens(prompt: str) -> set[str]:
    return {
        match.group(1).strip()
        for match in re.finditer(r"\{\{choice:([a-zA-Z0-9_]+)\}\}", str(prompt or ""))
        if match.group(1).strip()
    }


def _prompt_slot_tokens(prompt: str) -> set[str]:
    return {
        match.group(1).strip()
        for match in re.finditer(r"\[\[([a-zA-Z0-9_]+)\]\]", str(prompt or ""))
        if match.group(1).strip()
    }


def _provider_brief_json_match(text: str) -> Optional[re.Match[str]]:
    return re.search(
        rf"{PROVIDER_BRIEF_JSON_OPEN}\s*(\{{.*?\}})\s*{PROVIDER_BRIEF_JSON_CLOSE}",
        str(text or ""),
        flags=re.DOTALL,
    )


def extract_provider_reference_style_payload(text: str) -> Optional[Dict[str, Any]]:
    match = _provider_brief_json_match(text)
    if not match:
        return None
    try:
        payload = json.loads(match.group(1))
    except (TypeError, ValueError):
        return None
    return payload if isinstance(payload, dict) else None


def strip_provider_reference_style_payload(text: str) -> str:
    stripped = re.sub(
        rf"\s*{PROVIDER_BRIEF_JSON_OPEN}\s*\{{.*?\}}\s*{PROVIDER_BRIEF_JSON_CLOSE}\s*",
        " ",
        str(text or ""),
        flags=re.DOTALL,
    )
    return _clean_text(stripped)


def _slug(value: str, fallback: str) -> str:
    slug = re.sub(r"_+", "_", re.sub(r"[^a-z0-9]+", "_", value.strip().lower())).strip("_")
    return slug or fallback


def _sentences(text: str) -> List[str]:
    raw = _clean_text(text)
    items: List[str] = []
    style_read_match = re.search(
        r"style read:\s*(.*?)(?:\s+suggested fields?:|\s+useful fields?:|\s+media input:|\s+input:|\s+one question|\s+question:|$)",
        raw,
        flags=re.IGNORECASE,
    )
    if style_read_match:
        style_read_text = re.split(
            r"\brunnable sandbox draft\s*:|\bsandbox draft\s*:|\bdraft prompt\s*:|\bprompt\s*:",
            style_read_match.group(1),
            maxsplit=1,
            flags=re.IGNORECASE,
        )[0]
        items.extend(part.strip(" -") for part in re.split(r",\s*|;\s*", style_read_text) if part.strip(" -"))
    for sentence in [item.strip(" -") for item in re.split(r"(?<=[.!?])\s+", raw) if item.strip(" -")]:
        lowered = sentence.lower()
        if "reusable direction:" in lowered:
            sentence = sentence.split(":", 1)[1].strip()
            items.extend(part.strip(" -") for part in re.split(r",\s*|;\s*", sentence) if part.strip(" -"))
        else:
            items.append(sentence)
    return items


def _looks_like_control_title(value: str) -> bool:
    cleaned = _clean_text(value).strip(" .,\"'`*_")
    lowered = cleaned.lower()
    words = cleaned.split()
    return (
        not cleaned
        or "media preset" in lowered
        or "not an existing" in lowered
        or "attached reference" in lowered
        or "reads as" in lowered
        or " likely preset" in lowered
        or " preset for " in lowered
        or " style for " in lowered
        or "editable field" in lowered
        or (len(words) > 5 and cleaned[:1].islower())
    )


def _looks_like_control_trait(value: str) -> bool:
    cleaned = _clean_text(value).strip(" .,\"'`*_")
    lowered = cleaned.lower()
    return (
        not cleaned
        or "media preset" in lowered
        or "not an existing" in lowered
        or "attached reference" in lowered
        or " likely preset" in lowered
        or " preset for " in lowered
        or " style for " in lowered
        or "editable field" in lowered
    )


def _title_from_text(text: str, fallback: str) -> str:
    patterns = (
        r"reads as\s+(?:a|an)\s+([^:.\n]{4,90}?)(?:\s+style)?\s*:",
        r"likely preset:\s*`([^`]{4,90})`",
        r"likely preset:\s*([^.\n]{4,90})",
        r"something like\s*`([^`]{4,90})`",
        r"this looks like\s*`([^`]{4,90})`",
        r"called\s+`?([^`.\n]{4,90})`?",
    )
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            title = " ".join(match.group(1).split()).strip(" .,\"'`*_")
            if not _looks_like_control_title(title):
                return title[:80]
    return fallback


def _title_from_visual_analysis(visual_analysis: Dict[str, List[str]], fallback: str) -> str:
    candidates = [
        *(visual_analysis.get("medium") or []),
        *(visual_analysis.get("subject_treatment") or []),
        *(visual_analysis.get("composition") or []),
        *(visual_analysis.get("environment_props") or []),
        *(visual_analysis.get("texture_lighting") or []),
        *(visual_analysis.get("typography_text_energy") or []),
        *(visual_analysis.get("line_shape_language") or []),
        *(visual_analysis.get("mood") or []),
        *(visual_analysis.get("palette") or []),
    ]
    for candidate in candidates:
        cleaned = re.sub(r"\bart\b", "", str(candidate), flags=re.IGNORECASE)
        cleaned = re.sub(r"^\s*(the\s+)?attached reference reads as:\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"^\s*this reference reads as:\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.split(r"\bwith\b|\band\b", cleaned, maxsplit=1, flags=re.IGNORECASE)[0]
        cleaned = " ".join(cleaned.strip(" .,:;`\"'").split())
        lowered = cleaned.lower()
        if len(cleaned.split()) >= 2 and not _looks_like_control_title(cleaned):
            return cleaned[:70].title()
    return fallback


def _weak_reference_style_title(title: str) -> bool:
    cleaned = _clean_text(title).strip(" .`")
    if not cleaned:
        return True
    lowered = cleaned.lower()
    words = re.findall(r"[a-z0-9]+", lowered)
    palette_terms = {
        "black",
        "blue",
        "brown",
        "cyan",
        "gold",
        "green",
        "hot",
        "magenta",
        "neon",
        "orange",
        "pink",
        "purple",
        "red",
        "teal",
        "white",
        "yellow",
    }
    generic_terms = {"style", "preset", "reference", "image", "visual", "direction"}
    if len(words) <= 2 and any(word in palette_terms for word in words):
        return True
    return len(words) <= 3 and all(word in palette_terms or word in generic_terms for word in words)


STYLE_CATEGORIES: Dict[str, tuple[str, ...]] = {
    "medium": ("illustration", "poster", "comic", "cartoon", "render", "photo", "painting", "collage", "graphic"),
    "palette": ("palette", "color", "colour", "ochre", "mustard", "black", "red", "blue", "green", "teal", "orange", "pink", "magenta", "muted", "neon", "warm", "cool"),
    "line_shape_language": ("line", "outline", "ink", "shape", "scratch", "hand-drawn", "hand drawn", "brush", "stroke"),
    "composition": ("composition", "layout", "angle", "wide", "close-up", "center", "grid", "poster", "framing", "rhythm", "vertical"),
    "subject_treatment": ("subject", "character", "caricature", "proportion", "expressive", "portrait", "face", "body", "pose", "identity", "accessory", "accessories", "jewelry", "mech", "cybernetic", "augmentation"),
    "environment_props": ("room", "bedroom", "wall", "prop", "clutter", "sticker", "poster", "vinyl", "doodle", "graffiti", "object", "hud", "label", "barcode", "warning"),
    "texture_lighting": ("texture", "paper", "grain", "gritty", "lighting", "shadow", "glow", "lamp", "cinematic", "contrast", "distressed", "worn"),
    "typography_text_energy": ("typography", "lettered", "hand-lettered", "hand lettered", "slogan", "text", "banner", "graffiti", "words", "type", "japanese", "editorial"),
    "mood": ("mood", "energy", "playful", "anxious", "nostalgic", "chaotic", "grunge", "punk", "calm", "dramatic", "whimsical", "cyberpunk"),
}

GENERIC_FIELD_KEYS = {
    "accent_palette",
    "character_brief",
    "detail_notes",
    "scene_brief",
    "style_notes",
    "subject_brief",
    "subject_concept",
    "subject_direction",
    "pose_framing",
}
GENERIC_FIELD_LABELS = {
    "accent palette",
    "character brief",
    "scene brief",
    "detail notes",
    "optional detail notes",
    "subject brief",
    "subject direction",
    "style notes",
    "pose / framing",
    "subject / concept",
}

FIXED_STYLE_FIELD_TERMS = (
    "accent palette",
    "color palette",
    "colour palette",
    "palette",
    "style notes",
    "style direction",
    "visual style",
)

ABSTRACT_FIELD_TERMS = (
    "archetype",
    "attitude",
    "brief",
    "concept",
    "direction",
    "feeling",
    "mood",
    "notes",
    "style",
    "vibe",
)

CONCRETE_FIELD_TERMS = (
    "accessories",
    "accessory",
    "animal",
    "augmentation",
    "augmentations",
    "background",
    "banner",
    "brand",
    "car",
    "cast",
    "character",
    "code",
    "collectible",
    "companion",
    "creature",
    "decor",
    "destination",
    "damage",
    "environment",
    "era",
    "gear",
    "headline",
    "label",
    "landmark",
    "location",
    "logo",
    "message",
    "model",
    "moon",
    "name",
    "number",
    "object",
    "outfit",
    "pet",
    "place",
    "planet",
    "portal",
    "product",
    "prop",
    "room",
    "route",
    "setting",
    "slogan",
    "subject",
    "symbol",
    "tagline",
    "title",
    "vehicle",
    "wardrobe",
    "weapon",
    "wear",
    "weathering",
    "year",
)

CONCRETE_LEADING_FIELD_TERMS = (
    "accessories",
    "accessory",
    "animal",
    "augmentation",
    "augmentations",
    "banner",
    "brand",
    "car",
    "cast",
    "code",
    "companion",
    "creature",
    "destination",
    "damage",
    "environment",
    "era",
    "gear",
    "headline",
    "label",
    "landmark",
    "location",
    "logo",
    "message",
    "model",
    "number",
    "outfit",
    "pet",
    "place",
    "product",
    "prop",
    "room",
    "route",
    "setting",
    "slogan",
    "symbol",
    "tagline",
    "title",
    "vehicle",
    "wardrobe",
    "weapon",
    "wear",
    "weathering",
    "year",
)

QUESTION_OR_CONTROL_TERMS = (
    "i can shape",
    "i would extract",
    "analysis-only style sources",
    "likely preset",
    "do you want",
    "should i",
    "should this",
    "should the",
    "the preset should",
    "this should be",
    "it should be",
    "keep this image",
    "if you want",
    "if you answer",
    "if not",
    "if this",
    "it can stay",
    "i’d make",
    "i'd make",
    "i would make",
    "accepts a separate user-provided image",
    "accept a separate user-provided image",
    "no required image",
    "something like",
    "good fit for",
    "ask me",
    "create an example",
    "attached reference",
    "style reference",
    "style source",
    "input shape works",
    "shape looks right",
    "draft the sandbox",
    "sandbox recipe",
    "sandbox shape",
    "create the sandbox",
    "create the image-to-image",
    "create the text-to-image",
    "test graph",
    "temporary sandbox",
    "runtime media",
    "runtime input",
    "runtime image input",
    "runtime subject",
    "image slot",
    "image input type",
    "best image input",
    "source image slot",
    "personal reference",
    "target model",
    "media preset",
    "text-to-image media preset",
    "image-to-image media preset",
    "turn this into",
    "turn them into",
    "reusable preset",
    "reusable media preset",
    "nano banana",
    "gpt image",
    "suggested field",
    "suggested input",
    "useful field",
    "likely editable field",
    "editable field",
    "form field",
    "field:",
    "fields:",
    "two short questions",
    "one short question",
    "question before sandbox",
    "before sandbox",
    "actual preset",
    "i’d keep",
    "i'd keep",
)


def _is_control_trait(text: str) -> bool:
    lowered = str(text or "").lower()
    return any(term in lowered for term in QUESTION_OR_CONTROL_TERMS)


def _normalize_style_trait(value: Any) -> str:
    cleaned = _clean_text(value).strip(" .,:;`\"'")
    cleaned = re.sub(r"^(?:and|or|plus|with)\s+", "", cleaned, flags=re.IGNORECASE).strip(" .,:;`\"'")
    cleaned = re.sub(r"^(?:the\s+)?(?:style|look|reference)\s+(?:has|uses|is)\s+", "", cleaned, flags=re.IGNORECASE).strip(" .,:;`\"'")
    return cleaned


def _append_style_trait(items: List[str], candidate: Any) -> bool:
    cleaned = _normalize_style_trait(candidate)
    if not cleaned or _is_control_trait(cleaned) or _looks_like_control_trait(cleaned):
        return False
    candidate_lowered = cleaned.lower()
    for existing in items:
        existing_lowered = existing.lower()
        if candidate_lowered == existing_lowered:
            return False
        if candidate_lowered in existing_lowered and len(candidate_lowered) < len(existing_lowered):
            return False
    for index in reversed(range(len(items))):
        existing_lowered = items[index].lower()
        if existing_lowered in candidate_lowered and len(existing_lowered) < len(candidate_lowered):
            del items[index]
    items.append(cleaned)
    return True


def _payload_text_list(payload: Dict[str, Any], key: str, limit: int = 8) -> List[str]:
    value = payload.get(key)
    if isinstance(value, str):
        candidates = [value]
    elif isinstance(value, list):
        candidates = value
    else:
        return []
    items: List[str] = []
    for candidate in candidates:
        _append_style_trait(items, candidate)
        if len(items) >= limit:
            break
    return items


def _structured_visual_analysis(payload: Optional[Dict[str, Any]]) -> Dict[str, List[str]]:
    if not payload:
        return {}
    raw_visual = payload.get("visual_analysis")
    if not isinstance(raw_visual, dict):
        raw_visual = {}
    visual: Dict[str, List[str]] = {}
    for category in STYLE_CATEGORIES:
        visual[category] = _payload_text_list(raw_visual, category, limit=6)
    return visual


def _category_items(text: str, category: str, limit: int = 5) -> List[str]:
    terms = STYLE_CATEGORIES[category]
    items: List[str] = []
    for sentence in _sentences(text):
        lowered = sentence.lower()
        if any(term in lowered for term in terms):
            cleaned = re.sub(r"\bnot a required runtime input\b", "", sentence, flags=re.IGNORECASE)
            cleaned = re.sub(r"\bnot a runtime input\b", "", cleaned, flags=re.IGNORECASE)
            cleaned = re.sub(r"^\s*(the\s+)?attached reference reads as:\s*", "", cleaned, flags=re.IGNORECASE)
            cleaned = re.sub(r"^\s*this reference reads as:\s*", "", cleaned, flags=re.IGNORECASE)
            cleaned = re.sub(r"^\s*this looks like\s+`?[^`.]{2,90}`?\.?\s*", "", cleaned, flags=re.IGNORECASE)
            cleaned = cleaned.strip(" .,:;")
            cleaned = re.sub(r"^\s*style read:\s*", "", cleaned, flags=re.IGNORECASE)
            cleaned = re.sub(r"^\s*(i\s+would|i['’]d)\s+lock\s+the\s+style\s+around:?\s*", "", cleaned, flags=re.IGNORECASE)
            cleaned = re.split(
                (
                    r"\brunnable sandbox draft\s*:|\bsandbox draft\s*:|\bdraft prompt\s*:|\bprompt\s*:"
                    r"|\bsuggested preset shape\s*:|\bsuggested sandbox shape\s*:|\bsuggested inputs?\s*:|\bmedia slot\s*:|\bimage inputs?\s*:|\bsuggested fields?\s*:"
                ),
                cleaned,
                maxsplit=1,
                flags=re.IGNORECASE,
            )[0]
            cleaned = re.sub(r"\[[^\]]{1,80}\]", "", cleaned)
            cleaned = re.sub(r"\s+", " ", cleaned).strip(" .")
            clauses = [part.strip(" .") for part in re.split(r"\s*;\s*", cleaned) if part.strip(" .")]
            if not clauses:
                clauses = [cleaned]
            for clause in clauses:
                clause_lowered = clause.lower()
                if _is_control_trait(clause_lowered):
                    continue
                if any(term in clause_lowered for term in terms) and _append_style_trait(items, clause):
                    if len(items) >= limit:
                        break
        if len(items) >= limit:
            break
    return items


def _fields_from_contract(contract: Dict[str, Any]) -> List[ReferenceStylePresetField]:
    fields: List[ReferenceStylePresetField] = []
    for field in (contract.get("fields") or [])[:6]:
        if not isinstance(field, dict):
            continue
        key = _slug(str(field.get("key") or "").strip(), "")
        label = _short_field_label(field.get("label") or key or "")
        if not key or not label:
            continue
        fields.append(
            ReferenceStylePresetField(
                key=key,
                label=label,
                purpose=str(field.get("help_text") or field.get("placeholder") or ""),
                required=bool(field.get("required")),
                default_value=str(field.get("default_value") or ""),
            )
        )
    return fields


def _slots_from_contract(contract: Dict[str, Any]) -> List[ReferenceStyleImageSlot]:
    slots: List[ReferenceStyleImageSlot] = []
    for slot in (contract.get("image_slots") or [])[:4]:
        if not isinstance(slot, dict):
            continue
        key = _slug(str(slot.get("key") or "").strip(), "")
        label = str(slot.get("label") or key or "").strip()
        if not key or not label:
            continue
        key, label, purpose = _human_reference_slot_terms(
            key,
            label,
            str(slot.get("help_text") or ""),
        )
        slots.append(
            ReferenceStyleImageSlot(
                key=key,
                label=label,
                purpose=purpose,
                required=bool(slot.get("required")),
            )
        )
    return slots


def _fields_from_payload(payload: Dict[str, Any]) -> List[ReferenceStylePresetField]:
    fields: List[ReferenceStylePresetField] = []
    for index, field in enumerate((payload.get("recommended_fields") or [])[:4]):
        if isinstance(field, str):
            label = _short_field_label(field)
            key = _slug(label, f"field_{index + 1}")
            purpose = ""
            required = index == 0
            default_value = ""
        elif isinstance(field, dict):
            label = _short_field_label(field.get("label") or field.get("key") or "")
            key = _slug(_clean_text(field.get("key") or label), f"field_{index + 1}")
            purpose = _clean_text(field.get("purpose") or field.get("help_text") or field.get("placeholder") or "")
            required = bool(field.get("required"))
            default_value = _clean_text(field.get("default_value") or "")
        else:
            continue
        if not key or not label:
            continue
        key, label, purpose = _human_reference_field_terms(key, label, purpose)
        fields.append(
            ReferenceStylePresetField(
                key=key,
                label=label[:48],
                purpose=purpose,
                required=required,
                default_value=default_value,
            )
        )
    return _dedupe_reference_fields(fields)


def _fields_from_setup_text(text: str) -> List[ReferenceStylePresetField]:
    fields: List[ReferenceStylePresetField] = []
    normalized = _clean_text(text)

    def _setup_label(raw: str) -> str:
        label = _clean_label(raw)
        label = re.split(r"\s+(?:for|to)\s+", label, maxsplit=1, flags=re.IGNORECASE)[0]
        label = _clean_label(label)
        if label and label == label.lower():
            label = label.title()
        return label

    for index, match in enumerate(
        re.finditer(
            r"(?:^|\s)-\s*Field:\s*(.{2,64}?)(?=\s+-\s*(?:Field|Image input):|\s+(?:Create|Should|Do you|Would you)\b|$)",
            normalized,
            flags=re.IGNORECASE,
        )
    ):
        label = _setup_label(match.group(1))
        if not label:
            continue
        key = _slug(label, f"field_{index + 1}")
        purpose = f"{label} value the user can adjust for this preset."
        key, label, purpose = _human_reference_field_terms(key, label, purpose)
        fields.append(
            ReferenceStylePresetField(
                key=key,
                label=label[:48],
                purpose=purpose,
                required=index == 0,
            )
        )
    if not fields:
        match = re.search(
            r"\b(?:Useful|Suggested)\s+fields:\s*(.{3,140}?)(?=\s+(?:Input|Image input|One short question|Create|Should|Do you|Would you)\b|$)",
            normalized,
            flags=re.IGNORECASE,
        )
        if match:
            raw_items = re.sub(r"\b(and|plus)\b", ",", match.group(1), flags=re.IGNORECASE)
            for index, item in enumerate(raw_items.split(",")):
                label = _setup_label(item)
                if not label or len(label) > 48:
                    continue
                key = _slug(label, f"field_{index + 1}")
                purpose = f"{label} value the user can adjust for this preset."
                key, label, purpose = _human_reference_field_terms(key, label, purpose)
                fields.append(
                    ReferenceStylePresetField(
                        key=key,
                        label=label[:48],
                        purpose=purpose,
                        required=index == 0,
                    )
                )
    if not fields:
        match = re.search(
            r"\bplus\s+(.{3,120}?)(?=\.|\s+(?:Input|Image input|One short question|Create|Should|Do you|Would you)\b|$)",
            normalized,
            flags=re.IGNORECASE,
        )
        if match:
            raw_items = re.sub(r"\b(and|plus)\b", ",", match.group(1), flags=re.IGNORECASE)
            for index, item in enumerate(raw_items.split(",")):
                label = _setup_label(item)
                lowered = label.lower()
                if not label or len(label) > 48 or any(term in lowered for term in ("image", "input", "reference")):
                    continue
                key = _slug(label, f"field_{index + 1}")
                purpose = f"{label} value the user can adjust for this preset."
                key, label, purpose = _human_reference_field_terms(key, label, purpose)
                fields.append(
                    ReferenceStylePresetField(
                        key=key,
                        label=label[:48],
                        purpose=purpose,
                        required=index == 0,
                    )
                )
    return _dedupe_reference_fields(fields)


def _fallback_fields_from_visual_analysis(
    visual_analysis: Dict[str, List[str]],
    *,
    source_text: str,
    title: str,
    has_image_slots: bool,
) -> List[ReferenceStylePresetField]:
    """Derive concrete fields when provider intake produced only a generic summary."""
    analysis = _analysis_text(visual_analysis, [source_text, title])
    has_typography = _style_has_typography_system(visual_analysis)
    typography_negated = any(
        term in analysis
        for term in (
            "no visible typography",
            "no readable typography",
            "no readable text",
            "no typography",
            "no text system",
            "without typography",
        )
    )
    fields: List[ReferenceStylePresetField] = []

    def add(key: str, label: str, purpose: str) -> None:
        if len(fields) >= 2:
            return
        if any(field.key == key for field in fields):
            return
        if any(_field_has_semantic(fields, semantic) for semantic in _field_semantics([ReferenceStylePresetField(key=key, label=label, purpose=purpose)])):
            return
        fields.append(
            _make_reference_field(
                key=key,
                label=label,
                purpose=purpose,
                required=not fields,
                visual_analysis=visual_analysis,
                title=title,
            )
        )

    if has_typography or (
        not typography_negated
        and any(
            term in analysis for term in ("text field", "text fields", "headline", "title", "lettering", "typography", "word", "phrase", "quote", "slogan")
        )
    ):
        add("poster_text", "Poster Text", "Short visible copy, headline, quote, or phrase that fits the typography layout.")
    if not has_image_slots and any(
        term in analysis for term in ("character", "creature", "mascot", "subject", "portrait", "figure", "person", "hero")
    ):
        add("main_subject", "Main Subject", "Main person, character, creature, object, or subject rendered in the fixed style.")
    if any(term in analysis for term in ("outfit", "wardrobe", "clothing", "footwear", "sneaker", "armor", "gear")):
        add("outfit_wardrobe", "Outfit / Wardrobe", "Wardrobe, outfit, clothing, footwear, armor, or gear details for the subject.")
    if any(term in analysis for term in ("room", "bedroom", "interior", "decor", "shelf", "poster-filled", "clutter")):
        add("room_decor", "Room Decor", "Room decor, shelves, posters, furniture, collectibles, and background props.")
    if any(term in analysis for term in ("prop", "object", "accessory", "symbol", "doodle", "sticker", "mark", "icon")):
        add("main_prop", "Main Prop", "Featured prop, accessory, symbol, object, or graphic accent.")
    if any(term in analysis for term in ("mythic", "dragon", "eclipse", "sun disc", "moon disc", "celestial disc", "circular disc", "sigil")):
        add("mythic_symbol", "Mythic Symbol", "Mythic symbol, creature mark, celestial sign, or magical emblem that supports the scene.")
    if any(term in analysis for term in ("vehicle", "car", "automobile", "motorcycle", "truck")):
        add("vehicle_model", "Vehicle Model", "Vehicle type, model, silhouette, or build direction.")
    if _style_supports_location_field(visual_analysis):
        add("destination", "Destination", "Destination, route, landmark set, or scenic theme.")
    if not fields:
        add("main_subject", "Main Subject", "Main person, character, object, or subject rendered in the fixed style.")
    return _dedupe_reference_fields(fields)


def _alternative_field_candidates_from_analysis(
    visual_analysis: Dict[str, List[str]],
    *,
    title: str,
    has_image_slots: bool,
) -> List[ReferenceStylePresetField]:
    """Suggest second-pass fields from visible replaceable controls."""

    analysis = _analysis_text(visual_analysis, [title])
    candidates: List[ReferenceStylePresetField] = []

    def add(key: str, label: str, purpose: str) -> None:
        if len(candidates) >= 5:
            return
        if any(field.key == key or field.label.lower() == label.lower() for field in candidates):
            return
        candidates.append(
            _make_reference_field(
                key=key,
                label=label,
                purpose=purpose,
                required=not candidates,
                visual_analysis=visual_analysis,
                title=title,
            )
        )

    if _style_supports_location_field(visual_analysis):
        if any(term in analysis for term in ("route", "road", "path", "journey", "coast", "highway")):
            add("route_place", "Route / Place", "Route, place, or journey setting that drives the scenic details.")
        add("landmark_scene_details", "Landmark / Scene Details", "Landmark set, scenic elements, or destination details to weave into the composition.")
    if _style_has_typography_system(visual_analysis) or any(
        term in analysis for term in ("headline", "title", "subtitle", "tagline", "label", "typography", "lettering", "masthead")
    ):
        add("subtitle_tagline", "Subtitle / Tagline", "Secondary visible copy, tagline, caption, or supporting poster text.")
        add("top_banner_text", "Top Banner Text", "Short top-line or masthead text that fits the typography hierarchy.")
    if any(term in analysis for term in ("traveler", "small figure", "foreground figure", "silhouette")):
        add("traveler_detail", "Traveler Detail", "Small traveler, foreground figure, or journey cue included in the scene.")
    if any(term in analysis for term in ("room", "bedroom", "interior", "decor", "shelf", "furniture", "collectible")):
        add("room_setting", "Room Setting", "Room, decor, furniture, collectibles, and background details.")
    if any(term in analysis for term in ("vehicle", "car", "automobile", "motorcycle", "truck", "train", "tram")):
        add("vehicle_model", "Vehicle Model", "Vehicle type, model, era, or silhouette to feature.")
        add("paint_decal_text", "Paint / Decal Text", "Short lettering, numbers, decal, or livery detail on the vehicle.")
    if any(term in analysis for term in ("product", "package", "bottle", "can", "shoe", "watch", "device")):
        add("product_type", "Product Type", "Product or object category to feature.")
        add("label_text", "Label Text", "Visible package, product, sign, or badge text.")
    if any(term in analysis for term in ("outfit", "wardrobe", "clothing", "footwear", "sneaker", "armor", "gear", "uniform")):
        add("outfit_gear", "Outfit / Gear", "Wardrobe, armor, footwear, accessories, or gear details.")
    if any(term in analysis for term in ("prop", "object", "accessory", "symbol", "badge", "emblem", "sticker", "weapon", "tool")):
        add("featured_prop", "Featured Prop", "Main prop, accessory, symbol, object, or graphic badge.")
    if not has_image_slots and any(term in analysis for term in ("character", "creature", "mascot", "subject", "portrait", "figure", "person")):
        add("main_subject", "Main Subject", "Main person, creature, character, object, or subject to render.")
    if any(term in analysis for term in ("year", "decade", "era", "period", "retro", "nostalgic")):
        add("year_era", "Year / Era", "Year, decade, or period that drives props, decor, and typography.")

    return _filter_unsupported_reference_fields(candidates, visual_analysis=visual_analysis, title=title)


def reference_style_brief_with_alternative_fields(
    brief_payload: Union[ReferenceStyleBrief, Dict[str, Any], None],
) -> Optional[ReferenceStyleBrief]:
    """Replace current fields with concrete alternatives from the same image analysis."""

    brief = brief_payload if isinstance(brief_payload, ReferenceStyleBrief) else parse_reference_style_brief(brief_payload)
    if not brief or not has_concrete_style_traits(brief):
        return brief

    existing_fields = list(brief.preset_contract.fields or [])
    existing_keys = {field.key.lower().strip() for field in existing_fields}
    existing_labels = {field.label.lower().strip() for field in existing_fields}
    existing_label_parts = {label for label in existing_labels if len(label) >= 4}
    existing_semantics = _field_semantics(existing_fields)
    title = brief.preset_direction.title
    candidate_groups = [
        _alternative_field_candidates_from_analysis(
            brief.visual_analysis,
            title=title,
            has_image_slots=bool(brief.preset_contract.image_slots),
        ),
        _fields_from_replaceable_elements(
            brief.replaceable_elements,
            visual_analysis=brief.visual_analysis,
            title=title,
            has_image_slots=bool(brief.preset_contract.image_slots),
        ),
        _fallback_fields_from_visual_analysis(
            brief.visual_analysis,
            source_text=" ".join(_flat_traits(brief)),
            title=title,
            has_image_slots=bool(brief.preset_contract.image_slots),
        ),
    ]
    alternatives: List[ReferenceStylePresetField] = []
    for group in candidate_groups:
        for field in group:
            if field.key.lower().strip() in existing_keys:
                continue
            candidate_label = field.label.lower().strip()
            if candidate_label in existing_labels:
                continue
            if any(label_part in candidate_label for label_part in existing_label_parts):
                continue
            candidate_semantics = _field_semantics([field])
            if "location" in candidate_semantics and "location" in existing_semantics:
                continue
            if any(candidate_semantics and candidate_semantics == _field_semantics([existing]) for existing in alternatives):
                continue
            if _field_is_weak_for_reference_style(field):
                continue
            alternatives.append(field.model_copy(update={"required": not alternatives}))
            if len(alternatives) >= 2:
                break
        if len(alternatives) >= 2:
            break

    if not alternatives:
        return brief

    updated = brief.model_copy(
        update={
            "preset_contract": brief.preset_contract.model_copy(update={"fields": alternatives}),
            "recommended_fields": alternatives,
        }
    )
    return updated


def _image_slots_from_setup_text(text: str) -> List[ReferenceStyleImageSlot]:
    slots: List[ReferenceStyleImageSlot] = []
    normalized = _clean_text(text)
    for index, match in enumerate(
        re.finditer(
            r"(?:^|\s)-\s*Image input:\s*(.{2,64}?)(?=\s+-\s*(?:Field|Image input):|\s+(?:Create|Should|Do you|Would you)\b|$)",
            normalized,
            flags=re.IGNORECASE,
        )
    ):
        label = _clean_label(match.group(1))
        lowered = label.lower().strip(" .,:;`\"'")
        if lowered in {"none", "no", "no image", "no image input", "not yet", "maybe", "optional"}:
            continue
        if not label:
            continue
        key, label, purpose = _human_reference_slot_terms(
            _slug(label, f"image_{index + 1}"),
            label,
            f"{label} image the user provides for this preset.",
        )
        slots.append(
            ReferenceStyleImageSlot(
                key=key,
                label=label[:48],
                purpose=purpose,
                required=index == 0,
            )
        )
    return _dedupe_reference_slots(slots)


def sync_reference_style_brief_with_visible_setup(
    brief_payload: Union[ReferenceStyleBrief, Dict[str, Any], None],
    source_text: str,
) -> Optional[ReferenceStyleBrief]:
    """Apply the latest user-visible setup bullets to a structured style brief.

    Follow-up assistant turns can revise fields or image inputs after the
    initial image analysis. Planning must use that latest visible contract, not
    the older hidden JSON emitted during intake.
    """

    brief = brief_payload if isinstance(brief_payload, ReferenceStyleBrief) else parse_reference_style_brief(brief_payload)
    if not brief or not has_concrete_style_traits(brief):
        return brief
    fields = _fields_from_setup_text(source_text)
    slots = _image_slots_from_setup_text(source_text)
    image_policy = _setup_text_image_policy(source_text)
    if not fields and not slots and not image_policy:
        return brief

    updated_fields = fields if fields else list(brief.preset_contract.fields or [])
    updated_slots = list(brief.preset_contract.image_slots or [])
    direction_updates: Dict[str, Any] = {}
    if image_policy == "text_to_image":
        updated_slots = []
        direction_updates.update({"target_model_mode": "text_to_image", "input_mode": "no_image"})
    elif slots:
        updated_slots = slots
        direction_updates.update({"target_model_mode": "image_edit", "input_mode": "image_required"})

    updated = brief.model_copy(
        update={
            "preset_direction": brief.preset_direction.model_copy(update=direction_updates)
            if direction_updates
            else brief.preset_direction,
            "preset_contract": brief.preset_contract.model_copy(
                update={"fields": updated_fields, "image_slots": updated_slots}
            ),
            "recommended_fields": updated_fields,
            "recommended_image_slots": updated_slots,
        }
    )
    return normalize_reference_style_brief_contract(updated, source_text=source_text)


def _field_has_semantic(fields: List[ReferenceStylePresetField], semantic: str) -> bool:
    return semantic in _field_semantics(fields)


def _field_is_fixed_style_control(field: ReferenceStylePresetField) -> bool:
    text = " ".join([field.key, field.label, field.purpose]).lower()
    return any(term in text for term in FIXED_STYLE_FIELD_TERMS)


def _field_is_weak_for_reference_style(field: ReferenceStylePresetField) -> bool:
    key = field.key.lower().strip()
    label = field.label.lower().strip()
    combined = f"{key} {label}"
    purpose = field.purpose.lower().strip()
    all_text = f"{combined} {purpose}"
    if any(
        term in all_text
        for term in (
            "i can ",
            "turn this into",
            "first prompt draft",
            "prompt draft",
            "draft next",
            "create a test workflow",
            "create the test workflow",
            "workflow with this setup",
        )
    ):
        return True
    if any(term in combined for term in ("one_or_two_short_text_fields", "one or two short text fields", "short text fields")):
        return True
    if key in GENERIC_FIELD_KEYS or label in GENERIC_FIELD_LABELS or _field_is_fixed_style_control(field):
        return True
    if any(term in combined for term in ("destination", "location", "route")):
        return False
    has_abstract_term = any(_semantic_keyword_in_text(term, combined) for term in ABSTRACT_FIELD_TERMS)
    if not has_abstract_term:
        return bool(re.search(r"\b(?:motif|theme|focus|concept|direction)\b$", label))
    if any(_semantic_keyword_in_text(term, combined) for term in CONCRETE_FIELD_TERMS):
        # A concrete noun plus an abstract modifier is acceptable when the field
        # still tells a normal user what value to type, such as "Tagline / Mood"
        # or "Outfit Theme". Broad subject abstractions like "Character Vibe"
        # are still repaired to a clearer role such as "Main Character".
        if any(_semantic_keyword_in_text(term, combined) for term in CONCRETE_LEADING_FIELD_TERMS):
            return False
        return True
    return True


def _analysis_text(visual_analysis: Dict[str, List[str]], extra: List[str] | None = None) -> str:
    parts: List[str] = list(extra or [])
    for category in STYLE_CATEGORIES:
        parts.extend(visual_analysis.get(category) or [])
    return " ".join(parts).lower()


def _make_reference_field(
    *,
    key: str,
    label: str,
    purpose: str,
    required: bool,
    visual_analysis: Dict[str, List[str]],
    title: str,
) -> ReferenceStylePresetField:
    field = ReferenceStylePresetField(key=key, label=label, purpose=purpose, required=required)
    field.default_value = _sample_value_for_field(field, visual_analysis=visual_analysis, title=title)
    return field


def _fields_from_replaceable_elements(
    replaceable_elements: List[str],
    *,
    visual_analysis: Dict[str, List[str]],
    title: str,
    has_image_slots: bool,
) -> List[ReferenceStylePresetField]:
    replaceable_text = " ".join(str(item or "") for item in replaceable_elements).lower()
    text = _analysis_text(visual_analysis, replaceable_elements)
    fields: List[ReferenceStylePresetField] = []

    def add(key: str, label: str, purpose: str, required: bool = False) -> None:
        if _field_has_semantic(fields, key) or any(field.key == key for field in fields):
            return
        fields.append(
            _make_reference_field(
                key=key,
                label=label,
                purpose=purpose,
                required=required or not fields,
                visual_analysis=visual_analysis,
                title=title,
            )
        )

    if any(term in replaceable_text for term in ("car", "vehicle", "automobile", "motorcycle", "truck")):
        add("vehicle_model", "Vehicle / Model", "Vehicle type, model, or silhouette the user wants in the style.", True)
    if any(term in replaceable_text for term in ("product", "package", "bottle", "can", "shoe", "watch", "device")):
        add("product_type", "Product Type", "Product or object category the user wants featured.", True)
    if any(term in replaceable_text for term in ("year", "decade", "era", "period")):
        add("year", "Year", "Year or era that drives period-specific props, typography, and decor.", True)
    if _style_supports_location_field(visual_analysis) and any(term in replaceable_text for term in ("destination", "location", "landmark", "route", "city", "travel", "place", "setting")):
        if any(term in replaceable_text for term in ("route", "road", "highway", "drive", "coast")):
            add("route", "Route / Place", "Route, place, or destination that drives the scene details.", True)
        else:
            add("location", "Location", "Location, landmark set, or destination that drives the scene details.", True)
    if not has_image_slots and any(term in replaceable_text for term in ("character", "mascot", "hero", "subject", "person", "creature")):
        add("main_character", "Main Character", "Main character, subject, or role the user wants rendered in the style.", not fields)
    if any(term in replaceable_text for term in ("headline", "title", "slogan", "tagline", "poster text", "message", "wording", "typography")):
        add("headline", "Headline", "Short visible title, message, or poster text.", not fields)
    if any(term in replaceable_text for term in ("outfit", "wardrobe", "clothing", "streetwear", "uniform", "armor", "armour")):
        add("outfit_theme", "Outfit / Wardrobe", "Wardrobe, outfit, or armor direction that fits the style.", False)
    if any(term in replaceable_text for term in ("room", "environment", "background", "interior", "world", "industrial", "bedroom")):
        add("setting", "Setting", "Environment, room, or world context to stage the style.", not fields)
    if any(term in replaceable_text for term in ("prop", "object", "item", "hero object", "accessory")):
        add("main_prop", "Main Prop", "Primary prop or object to feature in the style.", not fields)

    return _dedupe_reference_fields(fields)


def _sample_value_for_field(
    field: ReferenceStylePresetField,
    *,
    visual_analysis: Dict[str, List[str]],
    title: str,
) -> str:
    del field, visual_analysis, title
    return ""


def _style_supports_location_field(visual_analysis: Dict[str, List[str]]) -> bool:
    traits = " ".join(
        item
        for category in STYLE_CATEGORIES
        for item in (visual_analysis.get(category) or [])
    ).lower()
    non_location_portrait_markers = (
        "armor",
        "armour",
        "boombox",
        "cassette",
        "character",
        "cybernetic",
        "cyborg",
        "exosuit",
        "mech",
        "mechanical",
        "music-room",
        "neon",
        "portrait",
        "retro",
        "sci-fi character",
        "stereo",
        "subject fills",
        "year numerals",
    )
    true_location_markers = (
        "city",
        "coast",
        "country",
        "destination",
        "highway",
        "landmark",
        "road",
        "route",
        "temple",
        "travel",
    )
    fantasy_non_location_markers = (
        "celestial",
        "dragon",
        "fantasy",
        "mythic",
        "mythological",
        "spirit creature",
    )
    explicit_place_markers = (
        "city",
        "country",
        "destination",
        "landmark",
        "region",
        "road",
        "route",
        "temple",
        "tourism",
        "travel",
    )
    if any(marker in traits for marker in fantasy_non_location_markers) and not any(
        marker in traits for marker in explicit_place_markers
    ):
        return False
    if any(marker in traits for marker in non_location_portrait_markers) and not any(
        marker in traits for marker in true_location_markers
    ):
        return False
    destination_markers = (
        "city",
        "coast",
        "country",
        "destination",
        "journey",
        "landmark",
        "map overlay",
        "pagoda",
        "postcard",
        "road trip",
        "route",
        "scenery",
        "shrine",
        "temple",
        "tourism",
        "travel",
        "torii",
    )
    return any(marker in traits for marker in destination_markers)


def _repair_unsupported_location_field(
    field: ReferenceStylePresetField,
    *,
    visual_analysis: Dict[str, List[str]],
    title: str,
) -> ReferenceStylePresetField:
    text = _analysis_text(visual_analysis, [title])
    if any(term in text for term in ("cyborg", "cybernetic", "mech", "armor", "armour", "exosuit", "dropship", "landing zone")):
        return _make_reference_field(
            key="environment",
            label="Environment",
            purpose="Environment, backdrop, atmosphere, and supporting scene details.",
            required=field.required,
            visual_analysis=visual_analysis,
            title=title,
        )
    if any(term in text for term in ("year numerals", "boombox", "stereo", "cassette", "music-room", "retro music", "neon room")):
        return _make_reference_field(
            key="era_setting",
            label="Era Setting",
            purpose="Room, decor, era props, and atmosphere that stage the retro year style.",
            required=field.required,
            visual_analysis=visual_analysis,
            title=title,
        )
    return field


def _filter_unsupported_reference_fields(
    fields: List[ReferenceStylePresetField],
    *,
    visual_analysis: Dict[str, List[str]],
    title: str = "",
) -> List[ReferenceStylePresetField]:
    if not fields:
        return []
    supports_location = _style_supports_location_field(visual_analysis)
    filtered: List[ReferenceStylePresetField] = []
    for field in fields:
        semantics = _field_semantics([field])
        if "location" in semantics and "environment" not in semantics and not supports_location:
            repaired = _repair_unsupported_location_field(field, visual_analysis=visual_analysis, title=title)
            if repaired.key != field.key:
                filtered.append(repaired)
            continue
        filtered.append(field)
    return filtered


def _merge_high_signal_reference_fields(
    fields: List[ReferenceStylePresetField],
    *,
    visual_analysis: Dict[str, List[str]],
    source_text: str,
    has_image_slots: bool,
    replaceable_elements: List[str] | None = None,
    title: str = "",
    lock_fields: bool = False,
) -> List[ReferenceStylePresetField]:
    fields = _filter_unsupported_reference_fields(fields, visual_analysis=visual_analysis, title=title)
    had_weak_fields = any(_field_is_weak_for_reference_style(field) for field in fields)
    if lock_fields:
        for field in fields:
            if not field.default_value:
                field.default_value = _sample_value_for_field(field, visual_analysis=visual_analysis, title=title)
        return _dedupe_reference_fields(fields)
    if len(fields) >= 2 and not any(_field_is_weak_for_reference_style(field) for field in fields):
        for field in fields:
            if not field.default_value:
                field.default_value = _sample_value_for_field(field, visual_analysis=visual_analysis, title=title)
        return _dedupe_reference_fields(fields)
    repaired = _fields_from_replaceable_elements(
        replaceable_elements or [],
        visual_analysis=visual_analysis,
        title=title,
        has_image_slots=has_image_slots,
    )
    if _style_supports_location_field(visual_analysis) and not _field_has_semantic(repaired, "location"):
        repaired.insert(
            0,
            _make_reference_field(
                key="location",
                label="Location",
                purpose="Location, landmark set, or destination that drives the scene details.",
                required=True,
                visual_analysis=visual_analysis,
                title=title,
            ),
        )
    if repaired and (not fields or all(_field_is_weak_for_reference_style(field) for field in fields)):
        fields = repaired
    fields = [field for field in fields if not _field_is_weak_for_reference_style(field)]
    for field in fields:
        if not field.default_value:
            field.default_value = _sample_value_for_field(field, visual_analysis=visual_analysis, title=title)
    derived = repaired
    if not derived:
        return _dedupe_reference_fields(_filter_unsupported_reference_fields(fields, visual_analysis=visual_analysis, title=title))
    if not fields:
        return _dedupe_reference_fields(_filter_unsupported_reference_fields(derived, visual_analysis=visual_analysis, title=title))
    merged = list(fields)
    for field in reversed(derived):
        candidate_semantics = _field_semantics([field])
        if not candidate_semantics:
            continue
        if any(_field_has_semantic(merged, semantic) for semantic in candidate_semantics):
            continue
        if "location" in candidate_semantics:
            merged.insert(0, field)
    if had_weak_fields and len(merged) < 2:
        for field in derived:
            candidate_semantics = _field_semantics([field])
            if candidate_semantics and any(_field_has_semantic(merged, semantic) for semantic in candidate_semantics):
                continue
            merged.append(field)
            if len(merged) >= 2:
                break
    return _dedupe_reference_fields(_filter_unsupported_reference_fields(merged, visual_analysis=visual_analysis, title=title))


def _setup_text_image_policy(text: str) -> str:
    normalized = _clean_text(text).lower()
    match = re.search(r"(?:^|\s)-\s*image input:\s*(.{2,80}?)(?=\s+-\s*(?:field|image input):|\s+(?:create|should|do you|would you)\b|$)", normalized)
    if not match:
        return ""
    value = match.group(1).strip(" .,:;`\"'")
    if value in {"none", "no", "no image", "no image input", "not needed"}:
        return "text_to_image"
    if value and value not in {"not yet", "maybe", "optional"}:
        return "image_edit"
    return "undecided"


def _slots_from_payload(payload: Dict[str, Any]) -> List[ReferenceStyleImageSlot]:
    slots: List[ReferenceStyleImageSlot] = []
    for index, slot in enumerate((payload.get("recommended_image_slots") or [])[:4]):
        if isinstance(slot, str):
            label = _clean_text(slot)
            key = _slug(label, f"image_{index + 1}")
            purpose = ""
            required = index == 0
        elif isinstance(slot, dict):
            label = _clean_text(slot.get("label") or slot.get("key") or "")
            key = _slug(_clean_text(slot.get("key") or label), f"image_{index + 1}")
            purpose = _clean_text(slot.get("purpose") or slot.get("help_text") or "")
            required = bool(slot.get("required"))
        else:
            continue
        if not key or not label:
            continue
        key, label, purpose = _human_reference_slot_terms(key, label, purpose)
        slots.append(
            ReferenceStyleImageSlot(
                key=key,
                label=label[:48],
                purpose=purpose,
                required=required,
            )
        )
    return _dedupe_reference_slots(slots)


def _dedupe_reference_fields(fields: List[ReferenceStylePresetField]) -> List[ReferenceStylePresetField]:
    deduped: Dict[str, ReferenceStylePresetField] = {}
    for field in fields:
        deduped[field.key] = field
    return list(deduped.values())[:2]


def _dedupe_reference_slots(slots: List[ReferenceStyleImageSlot]) -> List[ReferenceStyleImageSlot]:
    deduped: Dict[str, ReferenceStyleImageSlot] = {}
    for slot in slots:
        deduped[slot.key] = slot
    return list(deduped.values())[:3]


def _fields_are_generic(fields: List[ReferenceStylePresetField]) -> bool:
    if not fields:
        return True
    generic_count = 0
    for field in fields:
        key = field.key.lower()
        label = field.label.lower().strip()
        if key in GENERIC_FIELD_KEYS or label in GENERIC_FIELD_LABELS:
            generic_count += 1
    return generic_count == len(fields)


def _repair_reference_slots_with_analysis(
    slots: List[ReferenceStyleImageSlot],
    *,
    visual_analysis: Dict[str, List[str]],
    title: str,
) -> List[ReferenceStyleImageSlot]:
    repaired: List[ReferenceStyleImageSlot] = []
    for slot in slots:
        key, label, purpose = _human_reference_slot_terms(
            slot.key,
            slot.label,
            slot.purpose,
            visual_analysis=visual_analysis,
            title=title,
        )
        repaired.append(slot.model_copy(update={"key": key, "label": label, "purpose": purpose}))
    return _dedupe_reference_slots(repaired)


def _style_text_for_field_detection(visual_analysis: Dict[str, List[str]], source_text: str) -> str:
    parts = [source_text]
    for category in STYLE_CATEGORIES:
        parts.extend(visual_analysis.get(category) or [])
    return " ".join(parts).lower()


def _derived_reference_fields(
    *,
    visual_analysis: Dict[str, List[str]],
    source_text: str,
    has_image_slots: bool,
) -> List[ReferenceStylePresetField]:
    text = _style_text_for_field_detection(visual_analysis, source_text)
    fields: List[ReferenceStylePresetField] = []
    if _style_supports_location_field(visual_analysis):
        fields.append(
            ReferenceStylePresetField(
                key="location",
                label="Location",
                purpose="Destination, city, or landmark that drives the poster environment and exposure details.",
                required=True,
            )
        )
    if re.search(r"\b(year|decade|era|period-specific|period specific|retro year)\b", text):
        fields.append(
            ReferenceStylePresetField(
                key="year",
                label="Year",
                purpose="Year or era that controls period details.",
                required=True,
            )
        )
    if any(term in text for term in ("headline", "slogan", "tagline", "poster text", "title text", "large text", "typography")) and len(fields) < 2:
        fields.append(
            ReferenceStylePresetField(
                key="poster_text",
                label="Poster Text",
                purpose="Short title, tagline, or visible poster wording.",
                required=False,
            )
        )
    if fields:
        return _dedupe_reference_fields(fields)
    if has_image_slots:
        return [
            ReferenceStylePresetField(
                key="pose_framing",
                label="Pose / Framing",
                purpose="Optional crop, pose, or composition guidance for the provided image.",
                required=False,
            )
        ]
    return [
        ReferenceStylePresetField(
            key="main_subject",
            label="Main Subject",
            purpose="Main subject, scene idea, or focal concept to render in the extracted style.",
            required=True,
        )
    ]


def _reference_style_preset_key(title: str) -> str:
    return _slug(title, "reference_style_preset")


def _reference_style_workflow_key(title: str) -> str:
    return "media_preset." + _reference_style_preset_key(title).replace("_", ".") + ".v1"


def _preset_kind_from_payload(payload: Dict[str, Any], *, has_slots: bool) -> str:
    value = _slug(_clean_text(payload.get("preset_kind") or payload.get("kind") or ""), "")
    if value in {"generator", "image_transform", "pipeline"}:
        return value
    return "image_transform" if has_slots else "generator"


def _input_mode_from_payload(payload: Dict[str, Any], *, has_slots: bool) -> str:
    value = _slug(_clean_text(payload.get("input_mode") or ""), "")
    if value in {"no_image", "image_required", "image_optional"}:
        return value
    if has_slots:
        return "image_required"
    target_mode = str(payload.get("target_model_mode") or "").lower()
    return "no_image" if target_mode == "text_to_image" else "undecided"


def normalize_reference_style_brief_contract(brief: ReferenceStyleBrief, *, source_text: str = "") -> ReferenceStyleBrief:
    fields = list(brief.preset_contract.fields or [])
    slots = list(brief.preset_contract.image_slots or [])
    setup_fields = _fields_from_setup_text(source_text)
    lock_setup_fields = False
    if setup_fields and len(setup_fields) >= 2:
        fields = setup_fields
        lock_setup_fields = True
    if setup_fields and (not fields or _fields_are_generic(fields)):
        fields = setup_fields
    fields = _merge_high_signal_reference_fields(
        fields,
        visual_analysis=brief.visual_analysis,
        source_text=source_text,
        has_image_slots=bool(slots),
        replaceable_elements=brief.replaceable_elements,
        title=brief.preset_direction.title,
        lock_fields=lock_setup_fields,
    )
    slots = _repair_reference_slots_with_analysis(
        slots,
        visual_analysis=brief.visual_analysis,
        title=brief.preset_direction.title,
    )
    brief.preset_contract.fields = _dedupe_reference_fields(fields)
    brief.preset_contract.image_slots = _dedupe_reference_slots(slots)
    brief.recommended_fields = brief.preset_contract.fields
    brief.recommended_image_slots = brief.preset_contract.image_slots
    return brief


def merge_reference_style_contract_into_proposal(proposal: Dict[str, Any], brief: ReferenceStyleBrief) -> Dict[str, Any]:
    updated = dict(proposal or {})
    contract = dict(updated.get("preset_contract") if isinstance(updated.get("preset_contract"), dict) else {})
    contract["fields"] = [
        {
            "key": field.key,
            "label": field.label,
            "required": field.required,
            "placeholder": field.purpose or f"{field.label}.",
            "default_value": field.default_value,
        }
        for field in brief.preset_contract.fields
    ]
    contract["image_slots"] = [
        {
            "key": slot.key,
            "label": slot.label,
            "required": slot.required,
            "help_text": slot.purpose,
        }
        for slot in brief.preset_contract.image_slots
    ]
    updated["preset_contract"] = contract
    return updated


def _flat_traits(brief: ReferenceStyleBrief) -> List[str]:
    traits: List[str] = []
    for key in STYLE_CATEGORIES:
        for item in brief.visual_analysis.get(key, []):
            _append_style_trait(traits, item)
    return traits


def _safe_style_title(title: str) -> str:
    cleaned = _clean_text(title).strip(" .`")
    if not cleaned:
        return ""
    lowered = cleaned.lower()
    if any(pattern in lowered for pattern in GENERATION_PROMPT_BLOCKLIST):
        return ""
    if len(cleaned.split()) > 8:
        return ""
    return cleaned[:80]


def _clip_prompt_trait(value: Any, limit: int = 180) -> str:
    cleaned = _clean_text(value).strip(" .,:;`\"'")
    if len(cleaned) <= limit:
        return cleaned
    clipped = cleaned[:limit]
    for marker in (". ", "; ", ", "):
        index = clipped.rfind(marker)
        if index >= 80:
            return clipped[: index + len(marker.rstrip())].strip(" .,:;")
    return clipped.rstrip(" .,:;")


FANDOM_IP_MARKERS = (
    "anime",
    "comic",
    "collector",
    "fandom",
    "fan world",
    "manga",
    "mascot",
    "superhero",
)


def _brief_needs_original_fandom_guardrails(brief: ReferenceStyleBrief, field_models: Optional[List[ReferenceStylePresetField]] = None) -> bool:
    analysis = _analysis_text(
        brief.visual_analysis,
        [
            brief.preset_direction.title,
            *(field.label for field in (field_models or []) if field.label),
            *(field.key for field in (field_models or []) if field.key),
        ],
    )
    return any(term in analysis for term in FANDOM_IP_MARKERS)


def _rewrite_fandom_ip_prompt_item(value: str, *, needs_guardrails: bool) -> str:
    text = _clean_text(value)
    if not text:
        return ""
    text = re.sub(
        r"\bvisible\s+branded\s+book\s+spines\s+and\s+graphic\s+merchandise\s+text\b",
        "invented collectible book spines and decorative graphic set dressing with no real brands",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(r"\bbranded\s+book\s+spines\b", "invented collectible book spines", text, flags=re.IGNORECASE)
    text = re.sub(
        r"\bgraphic\s+merchandise\s+text\b",
        "decorative graphic set dressing with no real brands",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(r"\bvisible\s+branded\b", "invented decorative", text, flags=re.IGNORECASE)
    text = re.sub(r"\bmerchandise\s+text\b", "decorative graphic detail", text, flags=re.IGNORECASE)
    if not needs_guardrails:
        return text
    replacements = (
        (r"\biconic stylized companions\b", "original non-franchise stylized companion figures"),
        (r"\biconic character(?:s)?\b", "original non-franchise character-like figures"),
        (r"\bsupporting figures read as iconic\b", "supporting figures read as original non-franchise"),
        (r"\bfandom-inspired figures\b", "invented fan-world figures"),
        (r"\bfandom density\b", "collector-world density"),
        (r"\banime-fandom\b", "original animation-inspired collector-world"),
        (r"\bmanga pages\b", "invented comic-style pages"),
        (r"\bgraphic companion figures\b", "original stylized companion figures"),
    )
    rewritten = text
    for pattern, replacement in replacements:
        rewritten = re.sub(pattern, replacement, rewritten, flags=re.IGNORECASE)
    return rewritten


def _brief_has_dense_visual_layout(brief: ReferenceStyleBrief) -> bool:
    traits = " ".join(_flat_traits(brief) + list(brief.fixed_style_traits or [])).lower()
    dense_markers = (
        "poster",
        "typography",
        "headline",
        "title",
        "microtype",
        "editorial",
        "travel",
        "double exposure",
        "double-exposure",
        "collage",
        "photomontage",
        "photo composite",
        "photo-composite",
    )
    return any(marker in traits for marker in dense_markers)


def _prompt_category_item_limit(category: str, brief: ReferenceStyleBrief) -> int:
    if not _brief_has_dense_visual_layout(brief):
        return 2
    if category == "environment_props":
        return 5
    if category in {"composition", "typography_text_energy"}:
        return 4
    if category in {"line_shape_language", "subject_treatment", "texture_lighting"}:
        return 3
    return 2


FIELD_SEMANTIC_KEYWORDS: Dict[str, tuple[str, ...]] = {
    "location": (
        "city",
        "country",
        "destination",
        "landmark",
        "landmark set",
        "locale",
        "location",
        "place",
        "region",
        "scene theme",
        "travel",
    ),
    "text": (
        "caption",
        "callout",
        "callsign",
        "copy",
        "headline",
        "label",
        "labels",
        "poster title",
        "phrase",
        "quote",
        "slogan",
        "tagline",
        "text",
        "title",
        "unit code",
        "word",
        "wording",
    ),
    "role": (
        "archetype",
        "character",
        "character role",
        "main character",
        "main subject",
        "hero",
        "person",
        "role",
        "subject",
        "subject type",
    ),
    "gear": (
        "accessory",
        "accessories",
        "detail notes",
        "gear",
        "outfit",
        "prop",
        "props",
        "wardrobe",
    ),
    "era": (
        "date",
        "decade",
        "era",
        "marker",
        "period",
        "time period",
        "year",
    ),
    "vehicle": (
        "automobile",
        "bus",
        "car",
        "coupe",
        "metro",
        "model",
        "motorcycle",
        "subway",
        "train",
        "tram",
        "transit",
        "transport",
        "transportation",
        "truck",
        "vehicle",
    ),
    "environment": (
        "backdrop",
        "background",
        "environment",
        "interior",
        "room",
        "setting",
        "world",
        "zone",
    ),
}

LOCATION_STYLE_WORDS = (
    "destination",
    "journey",
    "landmark",
    "landscape",
    "location",
    "map",
    "path",
    "scenery",
    "scene",
    "travel",
    "traveler",
    "vista",
)

LOCATION_SOURCE_SPECIFIC_WORDS = (
    "cherry blossom",
    "eiffel",
    "fuji",
    "japanese",
    "lantern",
    "pagoda",
    "shrine",
    "specific landmark",
    "temple",
    "torii",
)

ROLE_SOURCE_SPECIFIC_WORDS = (
    "boy",
    "girl",
    "male",
    "female",
    "man",
    "woman",
    "warrior",
    "young",
)


def _field_semantics(fields: List[ReferenceStylePresetField]) -> set[str]:
    semantics: set[str] = set()
    for field in fields:
        text = " ".join([field.key, field.label, field.purpose]).lower()
        for semantic, keywords in FIELD_SEMANTIC_KEYWORDS.items():
            if any(_semantic_keyword_in_text(keyword, text) for keyword in keywords):
                semantics.add(semantic)
    return semantics


def _semantic_keyword_in_text(keyword: str, text: str) -> bool:
    keyword = keyword.lower().strip()
    if not keyword or not text:
        return False
    if " " in keyword:
        return keyword in text
    return bool(re.search(rf"(?<![a-z0-9]){re.escape(keyword)}(?![a-z0-9])", text))


def _field_prompt_value(field: ReferenceStylePresetField, *, saved_template: bool) -> str:
    if saved_template and field.key:
        return f"{{{{{field.key}}}}}"
    if field.default_value:
        return field.default_value
    return ""


def _style_prompt_opening(
    *,
    title: str,
    slot_models: List[ReferenceStyleImageSlot],
    saved_template: bool,
) -> str:
    clean_title = title or "reference-inspired image"
    if slot_models:
        def _slot_text(slot: ReferenceStyleImageSlot) -> str:
            role = _slot_prompt_role(slot)
            if saved_template:
                return f"[[{slot.key}]] as the {role}"
            label = _clean_text(slot.label) or "provided input"
            suffix = "" if any(term in label.lower() for term in ("image", "photo", "picture", "portrait", "reference")) else " image"
            return f"the provided {label}{suffix} as the {role}"

        slot_text = "; ".join(
            _slot_text(slot)
            for slot in slot_models
        )
        return f"Use {slot_text}. Transform the provided visual input into {clean_title}:"
    return f"{clean_title}:"


def _slot_prompt_role(slot: ReferenceStyleImageSlot) -> str:
    text = " ".join([slot.key, slot.label, slot.purpose]).lower()
    if any(term in text for term in ("face", "portrait", "person", "selfie", "likeness", "subject", "personal")):
        return "identity and likeness source"
    if any(term in text for term in ("body", "full-body", "full body", "pose", "stance")):
        return "body pose, proportions, wardrobe, and silhouette source"
    if any(term in text for term in ("product", "item", "package", "bottle", "can")):
        return "product shape, material, branding, and detail source"
    if any(term in text for term in ("vehicle", "car", "bike", "motorcycle")):
        return "vehicle shape, paint, proportions, and detail source"
    if any(term in text for term in ("room", "interior", "space", "background")):
        return "environment layout and atmosphere source"
    if any(term in text for term in ("logo", "mark", "brand")):
        return "logo and brand-mark source"
    if any(term in text for term in ("outfit", "wardrobe", "clothing", "garment")):
        return "wardrobe, garment, and material source"
    return "visual subject and control source"


def _empty_field_prompt_instruction(field: ReferenceStylePresetField, semantics: set[str]) -> str:
    field_label = _clean_text(field.label or field.key)
    if not field_label:
        return ""
    field_text = f"{field.key} {field.label} {field.purpose}".lower()
    field_semantics = _field_semantics([field])
    prefix = f"Set the {field_label} as"
    if "text" in field_semantics or any(term in field_text for term in ("headline", "title", "slogan", "tagline", "message", "wording")):
        return f"{prefix} short visible copy that fits the typography hierarchy and graphic layout."
    if any(term in field_text for term in ("bus", "metro", "subway", "train", "tram", "transit", "transport", "transportation")):
        return f"{prefix} a transportation subject, ticket/pass object, route cue, or transit detail that fits the style."
    if any(term in field_text for term in ("vehicle", "car", "model")):
        return f"{prefix} a concrete vehicle type, model, silhouette, or build direction that becomes the hero subject."
    if "location" in field_semantics:
        return f"{prefix} a specific destination, route, landmark set, or scenic theme that drives the environment and supporting details."
    if any(term in field_text for term in ("product", "object", "item", "hero object")):
        return f"{prefix} a concrete product or object category that becomes the hero subject."
    if any(term in field_text for term in ("prop", "accessory", "accessories", "toy", "tool", "object")):
        return f"{prefix} the featured prop, accessory, object, or playful detail the subject carries, holds, wears, or interacts with."
    if any(term in field_text for term in ("weapon", "sword", "blade", "staff", "bow", "shield")):
        return f"{prefix} the weapon, blade, staff, shield, or held combat prop that shapes the pose and silhouette."
    if any(term in field_text for term in ("symbol", "emblem", "sigil", "mark", "badge")):
        return f"{prefix} a clear symbol, emblem, sigil, or magical mark that fits the style and supports the main subject."
    if any(term in field_text for term in ("ensemble", "lineup", "cast", "supporting characters", "companion characters", "character theme", "fandom theme", "universe")):
        return (
            f"{prefix} an original non-franchise fan world, genre cues, invented supporting characters, "
            "creatures, collectibles, or secondary subjects that shape the scene around the main focus; avoid existing character names, logos, or recognizable franchise designs."
        )
    if any(term in field_text for term in ("moon", "sun", "disc", "disk", "celestial", "sky", "star", "eclipse", "portal", "cloud")):
        return f"{prefix} the moon, sun, eclipse, portal, cloud, star, or sky element that anchors the scene."
    if any(term in field_text for term in ("collectible", "collectibles", "figure", "figures", "shelf props", "display objects")):
        return f"{prefix} the figures, books, posters, props, creatures, or display objects that fill the scene."
    if any(term in field_text for term in ("pet", "animal", "creature")):
        return f"{prefix} the main animal subject, species, personality, expression, and scale relationship for the scene."
    if any(term in field_text for term in ("treat", "food", "snack", "fruit", "dessert", "drink")):
        return f"{prefix} the featured food, treat, or playful prop the subject carries, holds, or interacts with."
    if "time" in field_semantics or any(term in field_text for term in ("year", "decade", "era")):
        return f"{prefix} a specific year, decade, or era that drives period props, typography, palette, and decor."
    if any(term in field_text for term in ("outfit", "wardrobe", "clothing", "armor", "armour")):
        return f"{prefix} wardrobe, outfit, clothing, footwear, or armor details that fit the analyzed subject treatment."
    if any(term in field_text for term in ("word", "phrase")):
        return f"{prefix} short visible copy that fits the typography hierarchy and graphic layout."
    if any(term in field_text for term in ("background", "backdrop", "environment", "foreground", "landscape", "setting", "room", "world")):
        return f"{prefix} the scene environment, backdrop, atmosphere, and supporting context."
    if any(term in field_text for term in ("main subject", "lead subject", "central subject", "primary subject")):
        return f"{prefix} the central person, character, object, or idea the composition is built around."
    if any(term in field_text for term in ("character", "role", "subject", "mascot", "hero")):
        return f"{prefix} the main character, subject, or scene idea rendered through the fixed style."
    if semantics:
        return f"{prefix} a concise creative direction that fits this style and stays specific to this field."
    return f"{prefix} a concise value that fits this field and the fixed style."


def _style_prompt_field_instruction(
    field: ReferenceStylePresetField,
    semantics: set[str],
    *,
    saved_template: bool,
    supports_location: bool,
) -> str:
    value = _field_prompt_value(field, saved_template=saved_template)
    if not value:
        if saved_template:
            return ""
        return _empty_field_prompt_instruction(field, semantics)
    field_text = f"{field.key} {field.label} {field.purpose}".lower()
    field_identity_text = f"{field.key} {field.label}".lower()
    field_semantics = _field_semantics([field])
    prefix = f"Use {value}"
    field_label = _clean_text(field.label)
    field_context = f" as the {field_label}" if field_label else ""
    value_text = str(value or "").lower()
    location_value_is_backdrop = (
        "location" in field_semantics
        and any(
            _semantic_keyword_in_text(keyword, value_text)
            for keyword in (
                "backdrop",
                "background",
                "checkerboard",
                "interior",
                "room",
                "studio",
                "wall",
            )
        )
        and not any(
            _semantic_keyword_in_text(keyword, value_text)
            for keyword in (
                "city",
                "country",
                "destination",
                "highway",
                "landmark",
                "mountain",
                "route",
                "temple",
                "travel",
            )
        )
    )
    if "vehicle" in field_semantics and any(
        _semantic_keyword_in_text(keyword, field_identity_text)
        for keyword in ("bus", "metro", "subway", "train", "tram", "transit", "transport", "transportation")
    ):
        return f"{prefix}{field_context} to define the transportation subject, ticket/pass object, route cues, and transit details while keeping the fixed poster style."
    if "vehicle" in field_semantics and any(_semantic_keyword_in_text(keyword, field_text) for keyword in FIELD_SEMANTIC_KEYWORDS["vehicle"]):
        return f"{prefix}{field_context} to define the vehicle type, body shape, period, paint character, and road presence while keeping the fixed poster style."
    if location_value_is_backdrop:
        return f"{prefix} to define the backdrop, texture, atmosphere, and supporting scene details while keeping the fixed style."
    if any(_semantic_keyword_in_text(keyword, field_identity_text) for keyword in ("ensemble", "lineup", "cast", "supporting characters", "companion characters", "character theme", "fandom theme", "universe")):
        return (
            f"{prefix}{field_context} to define an original non-franchise fan world, genre cues, invented supporting "
            "characters, creatures, collectibles, or secondary subjects that shape the scene around the main focus; avoid existing character names, logos, or recognizable franchise designs."
        )
    if any(_semantic_keyword_in_text(keyword, field_text) for keyword in ("moon", "sun", "disc", "disk", "celestial", "sky", "star", "eclipse", "portal", "cloud")):
        return f"{prefix}{field_context} to define the moon, sun, eclipse, portal, cloud, star, or sky element that anchors the scene."
    if any(_semantic_keyword_in_text(keyword, field_text) for keyword in ("collectible", "collectibles", "figure", "figures", "shelf props", "display objects")):
        return f"{prefix}{field_context} to define the figures, books, posters, props, creatures, or display objects that fill the scene."
    if any(_semantic_keyword_in_text(keyword, field_identity_text) for keyword in ("main subject", "lead subject", "central subject", "primary subject")):
        return f"{prefix}{field_context} to define the central person, character, object, or idea the composition is built around."
    if "gear" in field_semantics and any(_semantic_keyword_in_text(keyword, field_text) for keyword in FIELD_SEMANTIC_KEYWORDS["gear"]):
        return f"{prefix}{field_context} for props, wardrobe, clothing, footwear, gear, or accessory details that fit the style."
    if any(_semantic_keyword_in_text(keyword, field_text) for keyword in ("prop", "accessory", "accessories", "toy", "tool", "object")):
        return f"{prefix}{field_context} to define the featured prop, accessory, object, or playful detail the subject carries, holds, wears, or interacts with."
    if any(_semantic_keyword_in_text(keyword, field_text) for keyword in ("weapon", "sword", "blade", "staff", "bow", "shield")):
        return f"{prefix}{field_context} to define the weapon, blade, staff, shield, or held combat prop that shapes the pose and silhouette."
    if any(_semantic_keyword_in_text(keyword, field_text) for keyword in ("symbol", "emblem", "sigil", "mark", "badge")):
        return f"{prefix}{field_context} to define a clear symbol, emblem, sigil, or magical mark that fits the style and supports the main subject."
    if any(_semantic_keyword_in_text(keyword, field_text) for keyword in ("pet", "animal", "creature")):
        return f"{prefix}{field_context} to define the animal subject, species, personality, expression, and scale relationship for the scene."
    if any(_semantic_keyword_in_text(keyword, field_text) for keyword in ("treat", "food", "snack", "fruit", "dessert", "drink")):
        return f"{prefix}{field_context} to define the featured food, treat, or playful prop the subject carries, holds, or interacts with."
    if "text" in field_semantics and any(_semantic_keyword_in_text(keyword, field_text) for keyword in FIELD_SEMANTIC_KEYWORDS["text"]):
        return f"{prefix}{field_context}, preserving the typography hierarchy and graphic layout."
    if any(_semantic_keyword_in_text(keyword, field_identity_text) for keyword in ("background", "backdrop", "environment", "environment scene", "foreground", "interior", "landscape", "room", "setting")):
        return f"{prefix}{field_context} to define the environment, backdrop, atmosphere, and supporting scene details while keeping the fixed style."
    if "era" in field_semantics and any(_semantic_keyword_in_text(keyword, field_text) for keyword in FIELD_SEMANTIC_KEYWORDS["era"]):
        return f"{prefix}{field_context} to drive the era-specific props, palette references, design details, and cultural cues."
    if (
        supports_location
        and "location" in field_semantics
        and any(_semantic_keyword_in_text(keyword, field_text) for keyword in FIELD_SEMANTIC_KEYWORDS["location"])
    ):
        return (
            f"{prefix}{field_context} to choose the destination, landmarks, architecture, landscape, atmosphere, "
            "and supporting travel details while keeping the fixed poster style."
        )
    if "location" in field_semantics and not supports_location:
        return ""
    if "role" in field_semantics and any(_semantic_keyword_in_text(keyword, field_text) for keyword in FIELD_SEMANTIC_KEYWORDS["role"]):
        return f"{prefix}{field_context} to define the main character, subject type, or scene idea without changing the core style."
    if "environment" in field_semantics and any(_semantic_keyword_in_text(keyword, field_text) for keyword in FIELD_SEMANTIC_KEYWORDS["environment"]):
        return f"{prefix}{field_context} to define the environment, backdrop, atmosphere, and supporting scene details while keeping the fixed style."
    return f"{prefix}{field_context}."


def _style_prompt_field_sentence(
    fields: List[ReferenceStylePresetField],
    *,
    saved_template: bool,
    supports_location: bool,
) -> str:
    if not fields:
        return "Use an original subject and setting that clearly demonstrates this style."
    semantics = _field_semantics(fields)
    return " ".join(
        instruction
        for field in fields
        for instruction in [
            _style_prompt_field_instruction(
                field,
                semantics,
                saved_template=saved_template,
                supports_location=supports_location,
            )
        ]
        if instruction
    )


def _safe_generation_negative(value: Any) -> str:
    cleaned = _clean_text(value).strip(" .")
    if not cleaned:
        return ""
    lowered = cleaned.lower()
    if any(term in lowered for term in ("source", "reference", "copy", "copied", "copying", "carry over")):
        if any(term in lowered for term in ("text", "word", "headline", "slogan", "logo", "brand")):
            return "avoid unwanted readable brand marks, logos, or stray text"
        if any(term in lowered for term in ("pose", "layout", "composition")):
            return "avoid stiff duplicated poses or rigid duplicated layouts"
        if any(term in lowered for term in ("prop", "accessory", "shoe", "skull", "goggle", "badge")):
            return "avoid unrequested duplicate props, accessories, badges, or brand-like details"
        if any(term in lowered for term in ("face", "identity", "character")):
            return "avoid unintended identity drift or unrequested character details"
        return ""
    return cleaned


def _direct_field_keys(fields: List[ReferenceStylePresetField]) -> List[str]:
    return [field.key for field in fields if field.key]


def _direct_slot_keys(slots: List[ReferenceStyleImageSlot]) -> List[str]:
    return [slot.key for slot in slots if slot.key]


def _score_fixmyphoto_planner_quality(
    prompt: str,
    *,
    fields: List[ReferenceStylePresetField],
    slots: List[ReferenceStyleImageSlot],
    traits: List[str],
    saved_template: bool,
) -> PromptQualityResult:
    text = _clean_text(prompt)
    lowered = text.lower()
    score = 10
    issues: List[str] = []
    if len(text.split()) < 75:
        score -= 2
        issues.append("prompt is too short to preserve a reusable preset direction")
    if len(fields) > 4:
        score -= 2
        issues.append("too many user-facing fields for a focused preset")
    if len(fields) > 3:
        score -= 1
        issues.append("field count should usually stay at three or fewer")
    if saved_template:
        missing_fields = [field.key for field in fields if field.key and f"{{{{{field.key}}}}}" not in text]
        missing_slots = [slot.key for slot in slots if slot.key and f"[[{slot.key}]]" not in text]
    else:
        missing_fields = [
            field.key
            for field in fields
            if field.key
            and not _contains_concrete_field_reference(text, field)
        ]
        missing_slots = [
            slot.key
            for slot in slots
            if slot.key
            and slot.label.lower() not in lowered
            and "provided" not in lowered
        ]
    if missing_fields:
        score -= 2
        issues.append("missing field coverage: " + ", ".join(missing_fields[:4]))
    if missing_slots:
        score -= 2
        issues.append("missing image-slot coverage: " + ", ".join(missing_slots[:4]))
    if slots:
        role_terms = ("identity", "likeness", "shape", "material", "branding", "layout", "source", "reference")
        if not any(term in lowered for term in role_terms):
            score -= 2
            issues.append("image slots do not have clear preservation/control roles")
    if _trait_coverage_for_prompt(text, traits) < 4:
        score -= 2
        issues.append("fixed art direction coverage is weak")
    if any(term in lowered for term in GENERATION_PROMPT_BLOCKLIST):
        score -= 3
        issues.append("prompt contains product/planner/meta wording")
    return PromptQualityResult(score=max(0, min(10, score)), passed=score >= 9, issues=issues)


def _normalized_prompt_words(value: Any) -> set[str]:
    return {
        token
        for token in re.findall(r"[a-z0-9]+", str(value or "").lower().replace("_", " "))
        if token
    }


def _contains_concrete_field_reference(prompt: str, field: ReferenceStylePresetField) -> bool:
    lowered = prompt.lower()
    if field.key and (field.key in lowered or field.key.replace("_", " ") in lowered):
        return True
    label = _clean_text(field.label).lower()
    if label and label in lowered:
        return True
    key_words = _normalized_prompt_words(field.key)
    label_words = _normalized_prompt_words(field.label)
    prompt_words = _normalized_prompt_words(prompt)
    return bool(key_words and key_words.issubset(prompt_words)) or bool(label_words and label_words.issubset(prompt_words))


def _score_generation_directness_quality(
    prompt: str,
    *,
    has_slots: bool,
    saved_template: bool,
) -> PromptQualityResult:
    text = _clean_text(prompt)
    lowered = text.lower()
    score = 10
    issues: List[str] = []
    compiler_terms = (
        "render it as",
        "shape the image with",
        "compose it with",
        "treat the subject as",
        "visual direction",
        "visual mechanics",
        "fixed visual style",
        "signature style locks",
    )
    found_compiler = [term for term in compiler_terms if term in lowered]
    if found_compiler:
        score -= min(4, len(found_compiler))
        issues.append("compiler-sounding wording: " + ", ".join(found_compiler[:4]))
    if re.match(r"^create an? [a-z0-9 -]{2,90}\s+using\b", lowered):
        score -= 2
        issues.append("starts with create/title/using wrapper")
    if has_slots and not lowered.startswith(("use ", "edit ", "transform ")):
        score -= 1
        issues.append("image-edit prompt should start with slot/edit intent")
    if not has_slots and any(term in lowered for term in ("uploaded image", "provided image", "[[", "attached reference", "style source")):
        score -= 2
        issues.append("text-to-image prompt depends on hidden or uploaded references")
    mechanics_hits = sum(
        1
        for term in (
            "composition",
            "palette",
            "lighting",
            "texture",
            "typography",
            "line",
            "shape",
            "mood",
            "poster",
            "portrait",
            "silhouette",
            "background",
            "paper",
            "grain",
            "haze",
            "headline",
            "title",
            "microtype",
        )
        if term in lowered
    )
    if mechanics_hits < 3:
        score -= 1
        issues.append("prompt does not directly name enough visual mechanics")
    if has_slots and not any(term in lowered for term in ("preserve", "recognizable", "identity", "likeness", "proportions", "shape", "material")):
        score -= 2
        issues.append("image-edit prompt lacks preservation language")
    if "{{" in text or "[[" in text:
        if not saved_template:
            score -= 1
            issues.append("test workflow prompt contains raw preset placeholders")
    if not any(term in lowered for term in ("avoid", "do not", "must not")):
        score -= 1
        issues.append("prompt lacks direct negative constraints")
    return PromptQualityResult(score=max(0, min(10, score)), passed=score >= 9, issues=issues)


def _trait_coverage_for_prompt(prompt: str, traits: List[str]) -> int:
    prompt_words = {token for token in re.findall(r"[a-z0-9]{3,}", prompt.lower())}
    coverage = 0
    for trait in traits[:16]:
        trait_words = {token for token in re.findall(r"[a-z0-9]{3,}", str(trait).lower())}
        if trait_words and len(prompt_words & trait_words) >= min(2, len(trait_words)):
            coverage += 1
    return coverage


def validate_reference_style_preset_contract(
    brief_payload: Union[ReferenceStyleBrief, Dict[str, Any]],
    *,
    prompt_template: str,
    fields: Optional[List[Dict[str, Any]]] = None,
    image_slots: Optional[List[Dict[str, Any]]] = None,
    input_mode: Optional[str] = None,
    max_image_inputs: int = 14,
    saved_template: bool = True,
) -> ReferenceStylePresetContractValidation:
    brief = brief_payload if isinstance(brief_payload, ReferenceStyleBrief) else parse_reference_style_brief(brief_payload)
    if not brief:
        return ReferenceStylePresetContractValidation(status="invalid", issues=["missing reference style brief"])
    field_models = _contract_fields(fields, brief)
    slot_models = _contract_slots(image_slots, brief)
    direct_field_keys = _direct_field_keys(field_models)
    direct_slot_keys = _direct_slot_keys(slot_models)
    prompt = str(prompt_template or "")
    field_tokens = _prompt_field_tokens(prompt)
    slot_tokens = _prompt_slot_tokens(prompt)
    unsupported_choice_tokens = _unsupported_choice_tokens(prompt)
    configured_field_keys = {field.key for field in field_models if field.key}
    configured_slot_keys = {slot.key for slot in slot_models if slot.key}
    issues: List[str] = []

    for key in direct_field_keys:
        if saved_template and key not in field_tokens:
            issues.append(f"configured field missing from prompt_template: {key}")
    for key in direct_slot_keys:
        if saved_template and key not in slot_tokens:
            issues.append(f"configured image slot missing from prompt_template: {key}")

    for key in sorted(field_tokens - configured_field_keys):
        issues.append(f"undefined field placeholder in prompt_template: {key}")
    for key in sorted(slot_tokens - configured_slot_keys):
        issues.append(f"undefined image slot placeholder in prompt_template: {key}")
    for key in sorted(unsupported_choice_tokens):
        issues.append(f"unsupported choice placeholder in prompt_template: {key}")

    if saved_template:
        for key in sorted(configured_field_keys - field_tokens):
            issues.append(f"configured field unused by prompt_template: {key}")
    if saved_template:
        for key in sorted(configured_slot_keys - slot_tokens):
            issues.append(f"configured image slot unused by prompt_template: {key}")

    resolved_input_mode = input_mode or brief.preset_direction.input_mode or "undecided"
    if resolved_input_mode == "no_image" and slot_models:
        issues.append("no_image presets cannot define image slots")
    if len(slot_models) > max_image_inputs:
        issues.append(f"image input count exceeds max of {max_image_inputs}")

    return ReferenceStylePresetContractValidation(
        status="invalid" if issues else "valid",
        issues=issues,
        field_keys=[field.key for field in field_models],
        image_slot_keys=[slot.key for slot in slot_models],
        input_mode=resolved_input_mode,
    )


def _style_prompt_sentence(category: str, items: List[str]) -> str:
    joined = "; ".join(items)
    if category == "medium":
        return joined + "."
    if category == "palette":
        return joined + "."
    if category == "line_shape_language":
        return joined + "."
    if category == "composition":
        return joined + "."
    if category == "subject_treatment":
        if joined.lower().startswith("subject used as "):
            return f"Use the subject as {joined[len('subject used as '):]}."
        if joined.lower().startswith("subject "):
            return f"Show the {joined}."
        return joined + "."
    if category == "environment_props":
        return joined + "."
    if category == "texture_lighting":
        return joined + "."
    if category == "typography_text_energy":
        return joined + "."
    if category == "mood":
        return joined + "."
    return f"Use {joined}."


def _trait_conflicts_with_field_semantics(category: str, value: str, semantics: set[str]) -> bool:
    lowered = str(value or "").lower()
    if "location" in semantics:
        if any(term in lowered for term in LOCATION_SOURCE_SPECIFIC_WORDS):
            return True
        if category == "environment_props" and not any(term in lowered for term in LOCATION_STYLE_WORDS):
            return True
    if "text" in semantics and category == "typography_text_energy":
        if any(term in lowered for term in ("exact source text", "readable source text", "source wording")):
            return True
    if "role" in semantics and category == "subject_treatment":
        if any(term in lowered for term in ROLE_SOURCE_SPECIFIC_WORDS) and not any(
            term in lowered for term in ("expression", "portrait", "silhouette", "identity", "proportion")
        ):
            return True
    return False


def _non_source_prompt_items(
    items: List[str],
    brief: ReferenceStyleBrief,
    *,
    has_image_slots: bool,
    limit: int,
    field_semantics: Optional[set[str]] = None,
    category: str = "",
) -> List[str]:
    selected: List[str] = []
    seen: set[str] = set()
    needs_fandom_guardrails = _brief_needs_original_fandom_guardrails(brief)
    for item in items:
        if (
            _is_source_specific_trait(item, brief.source_specific_exclusions or [])
            or _is_legacy_identity_overfit_trait(item, has_image_slots=has_image_slots)
            or _trait_conflicts_with_field_semantics(category, item, field_semantics or set())
        ):
            continue
        clipped = _clip_prompt_trait(item)
        if not clipped:
            continue
        clipped = _rewrite_fandom_ip_prompt_item(clipped, needs_guardrails=needs_fandom_guardrails)
        key = clipped.lower()
        if key in seen:
            continue
        seen.add(key)
        selected.append(clipped)
        if len(selected) >= limit:
            break
    return selected


def _style_has_typography_system(visual_analysis: Dict[str, List[str]]) -> bool:
    text = _analysis_text(
        {
            "typography_text_energy": visual_analysis.get("typography_text_energy") or [],
            "composition": visual_analysis.get("composition") or [],
            "fixed": visual_analysis.get("fixed") or [],
        },
        [],
    )
    if any(term in text for term in ("no visible typography", "no readable typography", "no readable text", "no typography", "no text system", "without typography")):
        return False
    typography_terms = (
        "typography",
        "headline",
        "title",
        "lettering",
        "masthead",
        "caption",
        "microtype",
        "text block",
        "vertical text",
        "type hierarchy",
    )
    incidental_markers = (
        "clutter",
        "environmental",
        "incidental",
        "not as",
        "only as prop",
        "prop detail",
        "rather than",
        "secondary",
        "without becoming",
    )
    return any(
        any(term in sentence for term in typography_terms)
        and not any(marker in sentence for marker in incidental_markers)
        for sentence in _sentences(text)
    )


def has_concrete_style_traits(brief: Optional[Union[ReferenceStyleBrief, Dict[str, Any]]]) -> bool:
    if not brief:
        return False
    if isinstance(brief, dict):
        brief = parse_reference_style_brief(brief)
    if not brief:
        return False
    traits = " ".join(_flat_traits(brief)).lower()
    if any(pattern in traits for pattern in META_PROMPT_PATTERNS):
        return False
    populated_categories = sum(1 for key in STYLE_CATEGORIES if brief.visual_analysis.get(key))
    concrete_terms = {
        term
        for terms in STYLE_CATEGORIES.values()
        for term in terms
        if term in traits
    }
    # Broad repeated summaries can mention enough keywords to look "concrete"
    # while still being too thin to drive a preset prompt. Require at least one
    # rendering-surface cue beyond medium/palette/composition/subject labels.
    if not (brief.visual_analysis.get("line_shape_language") or brief.visual_analysis.get("texture_lighting") or brief.visual_analysis.get("mood")):
        return False
    return populated_categories >= 3 and len(concrete_terms) >= 4 and len(traits.split()) >= 12


def parse_reference_style_brief(payload: Optional[Dict[str, Any]]) -> Optional[ReferenceStyleBrief]:
    if not isinstance(payload, dict):
        return None
    try:
        brief = ReferenceStyleBrief(**payload)
    except ValidationError:
        return None
    return normalize_reference_style_brief_contract(brief)


def build_reference_style_brief(
    *,
    user_text: str,
    assistant_text: str,
    proposal: Dict[str, Any],
    attachments: List[Dict[str, Any]],
    created_from_message_id: Optional[str] = None,
) -> ReferenceStyleBrief:
    contract = proposal.get("preset_contract") if isinstance(proposal.get("preset_contract"), dict) else {}
    structured_payload = extract_provider_reference_style_payload(assistant_text)
    source_text = strip_provider_reference_style_payload(assistant_text)
    setup_image_policy = _setup_text_image_policy(source_text)
    visual_analysis = _structured_visual_analysis(structured_payload)
    for category in STYLE_CATEGORIES:
        if not visual_analysis.get(category):
            visual_analysis[category] = _category_items(source_text, category)
    title = _clean_text(str((structured_payload or {}).get("title") or ""))
    if not title:
        title = _title_from_text(source_text, str(proposal.get("title") or "Reference Style Preset"))
    lowered_title = title.lower()
    if (
        "reference style preset" in lowered_title
        or "single-image reference preset" in lowered_title
        or "single image reference preset" in lowered_title
        or "media preset" in lowered_title
        or "not an existing" in lowered_title
        or _weak_reference_style_title(title)
    ):
        title = _title_from_visual_analysis(visual_analysis, title)
    traits = [item for items in visual_analysis.values() for item in items]
    fixed_ingredients = (
        _payload_text_list(structured_payload or {}, "fixed_style_traits", limit=10)
        or _payload_text_list(structured_payload or {}, "fixed_style_ingredients", limit=10)
        or traits[:8]
    )
    variable_ingredients = [
        str(field.get("label") or field.get("key") or "")
        for field in (contract.get("fields") or [])[:4]
        if isinstance(field, dict)
    ]
    variable_ingredients.extend(
        str(slot.get("label") or slot.get("key") or "")
        for slot in (contract.get("image_slots") or [])[:4]
        if isinstance(slot, dict)
    )
    source_exclusions = _payload_text_list(structured_payload or {}, "source_specific_exclusions", limit=10)
    replaceable_elements = _payload_text_list(structured_payload or {}, "replaceable_elements", limit=8) or [
        item for item in variable_ingredients if item
    ]
    fields = _fields_from_payload(structured_payload or {}) or _fields_from_contract(contract)
    setup_fields = _fields_from_setup_text(source_text)
    if setup_fields and not _fields_from_payload(structured_payload or {}):
        fields = setup_fields
    fields = _merge_high_signal_reference_fields(
        fields,
        visual_analysis=visual_analysis,
        source_text=source_text,
        has_image_slots=bool(_slots_from_payload(structured_payload or {}) or _slots_from_contract(contract)),
        replaceable_elements=replaceable_elements,
        title=title,
    )
    slots = _slots_from_payload(structured_payload or {}) or _slots_from_contract(contract)
    if not fields:
        fields = _fallback_fields_from_visual_analysis(
            visual_analysis,
            source_text=source_text,
            title=title,
            has_image_slots=bool(slots),
        )
    description = _clean_text(
        str(
            (structured_payload or {}).get("description")
            or (structured_payload or {}).get("summary")
            or proposal.get("description")
            or "Reusable reference style preset."
        )
    )[:220]
    preset_key = _slug(_clean_text((structured_payload or {}).get("key") or ""), "") or _reference_style_preset_key(title)
    workflow_key = (
        _clean_text((structured_payload or {}).get("workflow_key") or "")
        or _reference_style_workflow_key(title)
    )[:120]
    brief = ReferenceStyleBrief(
        brief_id=new_id("rsb"),
        source_attachment_ids=[str(item.get("assistant_attachment_id") or "") for item in attachments if str(item.get("assistant_attachment_id") or "").strip()],
        source_reference_ids=[str(item.get("reference_id") or "") for item in attachments if str(item.get("reference_id") or "").strip()],
        created_from_message_id=created_from_message_id,
        preset_direction=ReferenceStylePresetDirection(
            title=title,
            one_line_summary=_clean_text(str((structured_payload or {}).get("summary") or proposal.get("description") or "Reusable reference style preset."))[:220],
            description=description,
            key=preset_key,
            workflow_key=workflow_key,
            preset_kind=_preset_kind_from_payload(structured_payload or contract, has_slots=bool(slots)),
            input_mode=_input_mode_from_payload(structured_payload or contract, has_slots=bool(slots)),
            target_model_mode=str(
                (structured_payload or {}).get("target_model_mode")
                or setup_image_policy
                or ("text_to_image" if proposal.get("explicit_text_only") else "image_edit" if slots else "undecided")
            ),
        ),
        visual_analysis=visual_analysis,
        preset_contract=ReferenceStylePresetContract(
            fields=fields,
            image_slots=slots,
        ),
        prompt_blueprint=ReferenceStylePromptBlueprint(
            fixed_style_ingredients=fixed_ingredients,
            variable_ingredients=[item for item in variable_ingredients if item],
            negative_guidance=_payload_text_list(structured_payload or {}, "negative_guidance", limit=6) or [
                "avoid generic style drift",
                "avoid clean unstyled outputs",
            ],
        ),
        verification_targets=ReferenceStyleVerificationTargets(
            must_match=_payload_text_list(((structured_payload or {}).get("verification_targets") or {}) if isinstance((structured_payload or {}).get("verification_targets"), dict) else {}, "must_match", limit=8)
            or ["palette", "linework", "composition rhythm", "texture", "mood"],
            may_vary=_payload_text_list(((structured_payload or {}).get("verification_targets") or {}) if isinstance((structured_payload or {}).get("verification_targets"), dict) else {}, "may_vary", limit=8)
            or ["specific character", "exact text", "exact layout"],
            must_not_copy=_payload_text_list(((structured_payload or {}).get("verification_targets") or {}) if isinstance((structured_payload or {}).get("verification_targets"), dict) else {}, "must_not_copy", limit=8)
            or ["readable source text", "logos", "exact character pose"],
        ),
        fixed_style_traits=fixed_ingredients,
        replaceable_elements=replaceable_elements,
        source_specific_exclusions=source_exclusions,
        recommended_fields=fields,
        recommended_image_slots=slots,
    )
    brief = normalize_reference_style_brief_contract(brief, source_text=source_text)
    if not has_concrete_style_traits(brief):
        brief.status = "needs_analysis"
        brief.validation_warnings.append("Reference style analysis is not concrete enough to compile a runnable prompt yet.")
    return brief


def _contract_fields(fields: Optional[List[Dict[str, Any]]], brief: ReferenceStyleBrief) -> List[ReferenceStylePresetField]:
    if fields is None:
        return brief.preset_contract.fields
    normalized: List[ReferenceStylePresetField] = []
    for field in fields:
        key = _slug(str(field.get("key") or "").strip(), "")
        label = str(field.get("label") or key or "").strip()
        if key and label:
            purpose = str(field.get("purpose") or field.get("help_text") or field.get("placeholder") or "")
            _human_key, label, purpose = _human_reference_field_terms(key, label, purpose)
            normalized.append(
                ReferenceStylePresetField(
                    key=key,
                    label=label,
                    purpose=purpose,
                    required=bool(field.get("required")),
                    default_value=str(field.get("default_value") or ""),
                )
            )
    return normalized


def _contract_slots(slots: Optional[List[Dict[str, Any]]], brief: ReferenceStyleBrief) -> List[ReferenceStyleImageSlot]:
    if slots is None:
        return brief.preset_contract.image_slots
    normalized: List[ReferenceStyleImageSlot] = []
    for slot in slots:
        key = _slug(str(slot.get("key") or "").strip(), "")
        label = str(slot.get("label") or key or "").strip()
        if key and label:
            normalized.append(
                ReferenceStyleImageSlot(
                    key=key,
                    label=label,
                    purpose=str(slot.get("purpose") or slot.get("help_text") or ""),
                    required=bool(slot.get("required")),
                )
            )
    return normalized


def _is_source_specific_trait(value: str, exclusions: List[str]) -> bool:
    lowered = str(value or "").lower()
    for exclusion in exclusions:
        cleaned = _clean_text(exclusion).lower().strip(" .,:;")
        if cleaned and cleaned in lowered:
            return True
        marker_terms = (
            "accessory",
            "accessories",
            "beard",
            "expression",
            "face",
            "facial",
            "glasses",
            "hair",
            "hairstyle",
            "jewelry",
            "pose",
            "sunglasses",
            "wardrobe",
        )
        if any(term in cleaned for term in ("dread", "dreadlock")) and any(
            term in lowered for term in ("dread", "dreadlock")
        ):
            return True
        if any(term in cleaned for term in marker_terms) and any(term in lowered for term in marker_terms):
            return True
    return False


def _is_legacy_identity_overfit_trait(value: str, *, has_image_slots: bool) -> bool:
    if not has_image_slots:
        return False
    lowered = str(value or "").lower()
    source_markers = (
        "glasses",
        "beard",
        "mustache",
        "moustache",
        "facial hair",
        "dreadlock",
        "dreadlocked",
        "young male",
        "young female",
        "young man",
        "young woman",
        "male cyber",
        "female cyber",
        "male portrait",
        "female portrait",
        "man portrait",
        "woman portrait",
        "source subject",
        "source character",
        "source person",
        "reference subject",
        "reference person",
    )
    return any(marker in lowered for marker in source_markers)


def repair_reference_style_prompt(
    prompt: str,
    brief_payload: Union[ReferenceStyleBrief, Dict[str, Any]],
    *,
    fields: Optional[List[Dict[str, Any]]] = None,
    image_slots: Optional[List[Dict[str, Any]]] = None,
    saved_template: bool = False,
) -> str:
    brief = brief_payload if isinstance(brief_payload, ReferenceStyleBrief) else parse_reference_style_brief(brief_payload)
    base = _clean_text(prompt)
    if not brief or not has_concrete_style_traits(brief) or not base:
        return base
    field_models = _contract_fields(fields, brief)
    slot_models = _contract_slots(image_slots, brief)
    field_semantics = _field_semantics(field_models)
    repair_parts: List[str] = []
    mechanics: List[str] = []
    for category in (
        "medium",
        "palette",
        "composition",
        "line_shape_language",
        "texture_lighting",
        "typography_text_energy",
        "mood",
    ):
        items = [
            item
            for item in (brief.visual_analysis.get(category) or [])
            if not _is_source_specific_trait(item, brief.source_specific_exclusions or [])
            and not _is_legacy_identity_overfit_trait(item, has_image_slots=bool(slot_models))
            and not _trait_conflicts_with_field_semantics(category, item, field_semantics)
        ]
        if items:
            mechanics.append(_style_prompt_sentence(category, items[:2]))
    if mechanics:
        repair_parts.extend(mechanics)
    if field_models:
        missing_fields = [field for field in field_models if f"{{{{{field.key}}}}}" not in base]
        if missing_fields:
            repair_parts.append(
                _style_prompt_field_sentence(
                    missing_fields,
                    saved_template=saved_template,
                    supports_location=_style_supports_location_field(brief.visual_analysis),
                )
            )
    if slot_models:
        missing_slots = [
            slot
            for slot in slot_models
            if saved_template
            and f"[[{slot.key}]]" not in base
        ]
        if missing_slots:
            repair_parts.append(
                " ".join(f"Use [[{slot.key}]] as the {slot.label}." for slot in missing_slots)
            )
        if "preserve" not in base.lower() or "identity" not in base.lower():
            repair_parts.append(
                "Preserve the recognizable identity, structure, proportions, and important details from each provided image."
            )
    if not any(term in base.lower() for term in ("do not", "avoid", "must not")):
        repair_parts.append("Avoid unwanted readable brand marks, stray text, stiff duplicated poses, and generic style drift.")
    repaired = " ".join(part for part in [base, *repair_parts] if part).strip()
    return _limit_reference_style_prompt(repaired)


def compile_reference_style_prompt(
    brief_payload: Union[ReferenceStyleBrief, Dict[str, Any]],
    *,
    fields: Optional[List[Dict[str, Any]]] = None,
    image_slots: Optional[List[Dict[str, Any]]] = None,
    saved_template: bool = False,
) -> str:
    brief = brief_payload if isinstance(brief_payload, ReferenceStyleBrief) else parse_reference_style_brief(brief_payload)
    if not brief or not has_concrete_style_traits(brief):
        return ""
    traits = _flat_traits(brief)[:12]
    field_models = _contract_fields(fields, brief)
    field_models = _filter_unsupported_reference_fields(
        field_models,
        visual_analysis=brief.visual_analysis,
        title=brief.preset_direction.title,
    )
    slot_models = _contract_slots(image_slots, brief)
    field_semantics = _field_semantics(field_models)
    field_sentence = _style_prompt_field_sentence(
        field_models,
        saved_template=saved_template,
        supports_location=_style_supports_location_field(brief.visual_analysis),
    )
    prompt_parts: List[str] = []
    safe_title = _safe_style_title(brief.preset_direction.title)
    prompt_parts.append(
        _style_prompt_opening(
            title=safe_title,
            slot_models=slot_models,
            saved_template=saved_template,
        )
    )
    if slot_models:
        prompt_parts.append(
            "Preserve the recognizable identity, structure, proportions, pose logic, and important visible details from the provided subject while changing the image into the target style."
        )
    if field_sentence:
        prompt_parts.append(field_sentence)
    section_parts: List[str] = []
    seen_section_parts: set[str] = set()
    for category in (
        "medium",
        "palette",
        "line_shape_language",
        "composition",
        "subject_treatment",
        "environment_props",
        "texture_lighting",
        "typography_text_energy",
        "mood",
    ):
        items = _non_source_prompt_items(
            brief.visual_analysis.get(category) or [],
            brief,
            has_image_slots=bool(slot_models),
            limit=_prompt_category_item_limit(category, brief),
            field_semantics=field_semantics,
            category=category,
        )
        if items:
            sentence = _style_prompt_sentence(category, items)
            sentence_key = sentence.lower()
            if sentence_key not in seen_section_parts:
                seen_section_parts.add(sentence_key)
                section_parts.append(sentence)
    if section_parts:
        prompt_parts.extend(section_parts)
    else:
        prompt_parts.append("Use " + "; ".join(traits) + ".")
    signature_items = _non_source_prompt_items(
        list(brief.prompt_blueprint.fixed_style_ingredients or brief.fixed_style_traits or []),
        brief,
        has_image_slots=bool(slot_models),
        limit=6,
        field_semantics=field_semantics,
        category="signature",
    )
    if signature_items:
        prompt_parts.append("Keep " + "; ".join(signature_items) + ".")
    if slot_models:
        prompt_parts.append(
            "Do not invent identity details, accessories, hairstyle, wardrobe, logos, or location details unless they are visible in the provided image or requested in the fields."
        )
    negative_items: List[str] = []
    for item in brief.prompt_blueprint.negative_guidance or []:
        cleaned = _safe_generation_negative(item)
        if not cleaned:
            continue
        if cleaned not in negative_items:
            negative_items.append(cleaned)
    negative = "; ".join(negative_items)
    base_negative_items = ["generic style drift"]
    if _style_has_typography_system(brief.visual_analysis):
        base_negative_items.append("weak typography hierarchy")
    analysis_for_negatives = _analysis_text(
        brief.visual_analysis,
        [brief.preset_direction.title, *(field.label for field in field_models if field.label)],
    )
    if any(term in analysis_for_negatives for term in FANDOM_IP_MARKERS):
        base_negative_items.extend(
            [
                "existing franchise names",
                "recognizable copyrighted characters",
                "recognizable character silhouettes, costumes, powers, or hairstyles from known media",
            ]
        )
    base_negative_items.extend(["unwanted logos", "stray unreadable text"])
    prompt_parts.append("Avoid " + ", ".join(base_negative_items) + "." + (f" {negative}." if negative else ""))
    prompt = " ".join(part.strip() for part in prompt_parts if part.strip())
    lowered = prompt.lower()
    if any(pattern in lowered for pattern in GENERATION_PROMPT_BLOCKLIST):
        return ""
    quality = score_preset_prompt(
        prompt,
        style_traits=[*traits, *(brief.fixed_style_traits or [])],
        field_keys=_direct_field_keys(field_models),
        image_slot_keys=_direct_slot_keys(slot_models),
        source_specific_exclusions=brief.source_specific_exclusions,
        saved_template=saved_template,
    )
    if not quality.passed:
        repaired_prompt = repair_reference_style_prompt(
            prompt,
            brief,
            fields=fields,
            image_slots=image_slots,
            saved_template=saved_template,
        )
        repaired_lowered = repaired_prompt.lower()
        if any(pattern in repaired_lowered for pattern in GENERATION_PROMPT_BLOCKLIST):
            return ""
        repaired_quality = score_preset_prompt(
            repaired_prompt,
            style_traits=[*traits, *(brief.fixed_style_traits or [])],
            field_keys=_direct_field_keys(field_models),
            image_slot_keys=_direct_slot_keys(slot_models),
            source_specific_exclusions=brief.source_specific_exclusions,
            saved_template=saved_template,
        )
        if not repaired_quality.passed:
            return ""
        return _limit_reference_style_prompt(repaired_prompt)
    return _limit_reference_style_prompt(prompt)


def compile_reference_style_t2i_prompt(
    brief_payload: Union[ReferenceStyleBrief, Dict[str, Any]],
    *,
    fields: Optional[List[Dict[str, Any]]] = None,
    saved_template: bool = False,
) -> str:
    return compile_reference_style_prompt(
        brief_payload,
        fields=fields,
        image_slots=[],
        saved_template=saved_template,
    )


def compile_reference_style_i2i_prompt(
    brief_payload: Union[ReferenceStyleBrief, Dict[str, Any]],
    *,
    fields: Optional[List[Dict[str, Any]]] = None,
    image_slots: Optional[List[Dict[str, Any]]] = None,
    saved_template: bool = False,
) -> str:
    brief = brief_payload if isinstance(brief_payload, ReferenceStyleBrief) else parse_reference_style_brief(brief_payload)
    if not brief:
        return ""
    slot_models = _contract_slots(image_slots, brief)
    if not slot_models:
        return ""
    return compile_reference_style_prompt(
        brief,
        fields=fields,
        image_slots=[slot.model_dump(mode="json") for slot in slot_models],
        saved_template=saved_template,
    )


def score_reference_style_prompt_text(
    prompt: str,
    brief_payload: Union[ReferenceStyleBrief, Dict[str, Any]],
    *,
    fields: Optional[List[Dict[str, Any]]] = None,
    image_slots: Optional[List[Dict[str, Any]]] = None,
    saved_template: bool = False,
) -> ReferenceStylePromptCompileResult:
    brief = brief_payload if isinstance(brief_payload, ReferenceStyleBrief) else parse_reference_style_brief(brief_payload)
    field_models = _contract_fields(fields, brief) if brief else []
    slot_models = _contract_slots(image_slots, brief) if brief else []
    if brief:
        field_models = _filter_unsupported_reference_fields(
            field_models,
            visual_analysis=brief.visual_analysis,
            title=brief.preset_direction.title,
        )
        if not saved_template:
            field_models = [field for field in field_models if not _field_is_weak_for_reference_style(field)]
    scoring_fields = [field.model_dump(mode="json") for field in field_models]
    scoring_slots = [slot.model_dump(mode="json") for slot in slot_models]
    field_keys = [field.key for field in field_models]
    image_slot_keys = [slot.key for slot in slot_models]
    contract_validation = (
        validate_reference_style_preset_contract(
            brief,
            prompt_template=prompt,
            fields=scoring_fields,
            image_slots=scoring_slots,
            input_mode=brief.preset_direction.input_mode,
            saved_template=saved_template,
        )
        if brief
        else None
    )
    if not brief:
        return ReferenceStylePromptCompileResult(
            prompt="",
            model_mode="image_to_image" if image_slot_keys else "text_to_image",
            prompt_quality_score=0,
            prompt_quality_passed=False,
            prompt_quality_issues=["missing reference style brief"],
            field_keys=field_keys,
            image_slot_keys=image_slot_keys,
            contract_validation_status="invalid",
            contract_validation_issues=["missing reference style brief"],
        )
    quality = score_preset_prompt(
        prompt,
        style_traits=[*_flat_traits(brief), *(brief.fixed_style_traits or [])],
        field_keys=_direct_field_keys(field_models),
        image_slot_keys=_direct_slot_keys(slot_models),
        source_specific_exclusions=brief.source_specific_exclusions,
        saved_template=saved_template,
    )
    fix_quality = _score_fixmyphoto_planner_quality(
        prompt,
        fields=field_models,
        slots=slot_models,
        traits=[*_flat_traits(brief), *(brief.fixed_style_traits or [])],
        saved_template=saved_template,
    )
    direct_quality = _score_generation_directness_quality(
        prompt,
        has_slots=bool(slot_models),
        saved_template=saved_template,
    )
    combined_score = min(quality.score, fix_quality.score, direct_quality.score)
    combined_issues = [
        *quality.issues,
        *(f"FixMyPhoto planner: {issue}" for issue in fix_quality.issues),
        *(f"GPT/Nano directness: {issue}" for issue in direct_quality.issues),
    ]
    return ReferenceStylePromptCompileResult(
        prompt=prompt,
        model_mode="image_to_image" if image_slot_keys else "text_to_image",
        prompt_quality_score=combined_score,
        prompt_quality_passed=combined_score >= 9 and not combined_issues,
        prompt_quality_issues=combined_issues,
        fixmyphoto_planner_score=fix_quality.score,
        fixmyphoto_planner_issues=fix_quality.issues,
        generation_directness_score=direct_quality.score,
        generation_directness_issues=direct_quality.issues,
        field_keys=field_keys,
        image_slot_keys=image_slot_keys,
        contract_validation_status=contract_validation.status if contract_validation else "valid",
        contract_validation_issues=contract_validation.issues if contract_validation else [],
    )


def compile_reference_style_prompt_result(
    brief_payload: Union[ReferenceStyleBrief, Dict[str, Any]],
    *,
    fields: Optional[List[Dict[str, Any]]] = None,
    image_slots: Optional[List[Dict[str, Any]]] = None,
    saved_template: bool = False,
) -> ReferenceStylePromptCompileResult:
    prompt = compile_reference_style_prompt(
        brief_payload,
        fields=fields,
        image_slots=image_slots,
        saved_template=saved_template,
    )
    return score_reference_style_prompt_text(
        prompt,
        brief_payload,
        fields=fields,
        image_slots=image_slots,
        saved_template=saved_template,
    )


def compile_reference_style_t2i_prompt_result(
    brief_payload: Union[ReferenceStyleBrief, Dict[str, Any]],
    *,
    fields: Optional[List[Dict[str, Any]]] = None,
    saved_template: bool = False,
) -> ReferenceStylePromptCompileResult:
    prompt = compile_reference_style_t2i_prompt(
        brief_payload,
        fields=fields,
        saved_template=saved_template,
    )
    return score_reference_style_prompt_text(
        prompt,
        brief_payload,
        fields=fields,
        image_slots=[],
        saved_template=saved_template,
    )


def compile_reference_style_i2i_prompt_result(
    brief_payload: Union[ReferenceStyleBrief, Dict[str, Any]],
    *,
    fields: Optional[List[Dict[str, Any]]] = None,
    image_slots: Optional[List[Dict[str, Any]]] = None,
    saved_template: bool = False,
) -> ReferenceStylePromptCompileResult:
    prompt = compile_reference_style_i2i_prompt(
        brief_payload,
        fields=fields,
        image_slots=image_slots,
        saved_template=saved_template,
    )
    return score_reference_style_prompt_text(
        prompt,
        brief_payload,
        fields=fields,
        image_slots=image_slots,
        saved_template=saved_template,
    )


def reference_style_brief_to_analysis_text(brief_payload: Optional[Union[ReferenceStyleBrief, Dict[str, Any]]]) -> str:
    brief = brief_payload if isinstance(brief_payload, ReferenceStyleBrief) else parse_reference_style_brief(brief_payload)
    if not brief:
        return ""
    traits = _flat_traits(brief)
    if not traits:
        return ""
    return f"Likely preset: `{brief.preset_direction.title}`. " + " ".join(traits[:10])


def encode_reference_style_brief_marker(brief_payload: Union[ReferenceStyleBrief, Dict[str, Any]]) -> str:
    brief = brief_payload if isinstance(brief_payload, ReferenceStyleBrief) else parse_reference_style_brief(brief_payload)
    if not brief:
        return ""
    return f"{BRIEF_MARKER}\n{json.dumps(brief.model_dump(mode='json'), ensure_ascii=False, sort_keys=True)}"


def reference_style_brief_hash(brief_payload: Union[ReferenceStyleBrief, Dict[str, Any], None]) -> str:
    brief = brief_payload if isinstance(brief_payload, ReferenceStyleBrief) else parse_reference_style_brief(brief_payload)
    if not brief:
        return ""
    payload = brief.model_dump(mode="json")
    payload.pop("brief_id", None)
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()


def extract_reference_style_brief_from_message(message: str) -> Optional[ReferenceStyleBrief]:
    if BRIEF_MARKER not in str(message or ""):
        return None
    raw = str(message).split(BRIEF_MARKER, 1)[1].strip()
    json_text = raw.split("\n\n", 1)[0].strip()
    try:
        payload = json.loads(json_text)
    except json.JSONDecodeError:
        return None
    return parse_reference_style_brief(payload)


def _format_label_list(labels: List[str]) -> str:
    cleaned = [str(label).strip() for label in labels if str(label).strip()]
    if not cleaned:
        return ""
    if len(cleaned) == 1:
        return cleaned[0]
    if len(cleaned) == 2:
        return f"{cleaned[0]} and {cleaned[1]}"
    return ", ".join(cleaned[:-1]) + f", and {cleaned[-1]}"


def compact_style_brief_reply(brief_payload: Union[ReferenceStyleBrief, Dict[str, Any]], proposal: Dict[str, Any]) -> str:
    brief = brief_payload if isinstance(brief_payload, ReferenceStyleBrief) else parse_reference_style_brief(brief_payload)
    if not brief or not has_concrete_style_traits(brief):
        return (
            "I can start a Media Preset from these style sources, but I need a more concrete style read before creating a test graph. "
            "Do you want this to stay text-only, or should it accept one image input too?"
        )
    traits = _flat_traits(brief)[:4]
    fields = [field for field in brief.preset_contract.fields if not _field_is_weak_for_reference_style(field)]
    slots = brief.preset_contract.image_slots
    if not fields:
        fields = _fallback_fields_from_visual_analysis(
            brief.visual_analysis,
            source_text=" ".join(traits),
            title=brief.preset_direction.title,
            has_image_slots=bool(slots),
        )
    field_labels = [field.label for field in fields[:3]]
    title = brief.preset_direction.title
    if _weak_reference_style_title(title) or "reference style preset" in title.lower():
        title = _title_from_visual_analysis(brief.visual_analysis, title)
    explicit_text_only = bool(proposal.get("explicit_text_only")) if isinstance(proposal, dict) else False
    explicit_text_only = explicit_text_only or brief.preset_direction.target_model_mode == "text_to_image"
    recommended_shape = str(proposal.get("recommended_preset_shape") or "").strip() if isinstance(proposal, dict) else ""
    field_text = _format_label_list(field_labels) if field_labels else "no editable fields yet"
    if recommended_shape == "both":
        shape_sentence = "I recommend both: a text-to-image version for prompt-only use and an image-to-image version when you have a source image."
    elif slots:
        shape_sentence = "I recommend image-to-image for this preset."
    else:
        shape_sentence = "I recommend text-to-image for this preset."
    if slots:
        slot_text = _format_label_list([slot.label for slot in slots[:2]])
        image_input_sentence = f"Image slot: {slot_text}."
    elif explicit_text_only:
        image_input_sentence = "Image slot: none."
    else:
        image_input_sentence = "Image slot: none yet."
    questions = proposal.get("questions") if isinstance(proposal, dict) and isinstance(proposal.get("questions"), list) else []
    question_text = " ".join(str(question).strip() for question in questions[:1] if str(question).strip())
    next_question = question_text or "Want adjustments, or should I create the local test graph?"
    return (
        f"I would turn this into a `{title}` preset. The reusable style is {'; '.join(traits)}.\n\n"
        f"{shape_sentence}\n\n"
        f"Useful fields: {field_text}. {image_input_sentence}\n\n"
        f"{next_question}"
    )


def build_reference_style_output_check(
    provider_text: str,
    *,
    latest_output_asset_id: Optional[str] = None,
    reference_ids: Optional[List[str]] = None,
) -> ReferenceStyleOutputCheck:
    def _low_information_comparison_line(value: str) -> bool:
        text = _clean_text(value)
        text = re.sub(
            r"^\s*(matches?|what matches|missing|what is missing(?:\s+or\s+drifting)?|improve|prompt tweak|best prompt update|next prompt change|prompt delta|next change|suggested update|refine once(?:\s+or\s+save)?|recommendation|preset status)\s*:?\s*",
            "",
            text,
            flags=re.IGNORECASE,
        ).strip(" .;:-")
        lowered = text.lower()
        if not lowered:
            return True
        visual_terms = (
            "palette",
            "color",
            "orange",
            "magenta",
            "black",
            "ink",
            "splatter",
            "drip",
            "paint",
            "silhouette",
            "composition",
            "background",
            "foreground",
            "prop",
            "texture",
            "lighting",
            "pose",
            "anatomy",
            "typography",
            "lettering",
            "contrast",
            "line",
            "shape",
            "figure",
            "subject",
            "identity",
            "likeness",
            "style",
            "layout",
            "detail",
        )
        score_only = "similarity score" in lowered or re.search(r"\b\d{1,3}\s*/\s*100\b", lowered)
        if score_only and not any(term in lowered for term in visual_terms):
            return True
        if re.fullmatch(r"(?:very\s+)?close(?:,\s*)?(?:one refinement is worth testing|minor prompt refinement recommended|refine once)?", lowered):
            return True
        return False

    def _clean_output_prompt_delta(value: str) -> str:
        if _low_information_comparison_line(value):
            return ""
        text = _clean_text(value)
        lowered_text = text.lower()
        if any(
            phrase in lowered_text
            for phrase in (
                "already consistent enough",
                "consistent enough for a reusable preset",
                "already close enough",
                "already save-ready",
                "ready to save",
                "ready for saving",
                "save as a media preset",
                "save it as the media preset",
                "create the preset",
            )
        ):
            return ""
        text = re.sub(
            r"^\s*(prompt tweak|best prompt update|next prompt change|prompt delta|next change|suggested update|refine once(?:\s+or\s+save)?|recommendation|what is missing(?:\s+or\s+drifting)?)\s*:\s*",
            "",
            text,
            flags=re.IGNORECASE,
        ).strip()
        text = re.sub(r"\bwhat is missing(?:\s+or\s+drifting)?\s*:\s*", "", text, flags=re.IGNORECASE).strip(" ;")
        push_match = re.search(
            r"\bI[’']?d\s+push(?:\s+the\s+prompt)?\s+toward\s+(.+?)(?:\s+before\s+saving(?:\s+the\s+preset)?\.?)?$",
            text,
            flags=re.IGNORECASE,
        )
        if push_match:
            text = push_match.group(1).strip()
        tighten_match = re.search(
            r"\bI[’']?d\s+tighten\s+(.+)$",
            text,
            flags=re.IGNORECASE,
        )
        if tighten_match:
            text = f"tighter {tighten_match.group(1).strip()}"
            text = re.sub(r"\btighter\s+the\s+", "tighter ", text, flags=re.IGNORECASE)
        else:
            text = re.sub(
                r"\b(?:the|this)\s+(?:output|result|image|version)\s+"
                r"(?:shifts?|drifts?|leans|moves)\s+(?:into|toward|towards|to)\s+[^.;]+"
                r"(?:instead\s+of\s+[^.;]+)?[.;]?\s*",
                "",
                text,
                flags=re.IGNORECASE,
            )
        text = re.sub(r"\s*;\s*refine once\.?\s*", ". ", text, flags=re.IGNORECASE)
        text = re.sub(r"\brefine once\.?\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\bbefore saving(?:\s+the\s+preset)?\.?", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s+", " ", text).strip(" .;")
        return text

    raw_lines = [_clean_text(line.strip(" -\t")) for line in str(provider_text or "").splitlines()]
    lines: List[str] = []
    for raw_line in raw_lines:
        if not raw_line:
            continue
        # Providers often merge multiple labeled comparison fields into one sentence.
        # Split those labels before classifying so missing traits do not absorb prompt deltas.
        split_line = re.sub(
            r";\s*((?:prompt tweak|next prompt change|prompt delta|next change|suggested update|refine once|recommendation)\s*:)",
            r"\n\1",
            raw_line,
            flags=re.IGNORECASE,
        )
        lines.extend(
            _clean_text(part.strip(" -\t"))
            for part in split_line.splitlines()
            if part.strip(" -\t") and not _low_information_comparison_line(part)
        )
    lowered = " ".join(lines).lower()
    prompt_delta_candidates = [
        line
        for line in lines
        if re.match(r"^\s*(prompt tweak|next prompt change|prompt delta|next change|suggested update|refine once)\s*:", line, flags=re.IGNORECASE)
    ][:2]
    missing = [
        line
        for line in lines
        if any(
            term in line.lower()
            for term in (
                "missing",
                "needs",
                "lacks",
                "too much",
                "too polished",
                "too clean",
                "closer",
                "underweighted",
                "add",
                "stronger",
                "push",
                "tweak",
                "adjust",
                "refine",
            )
        )
        and not re.match(r"^\s*(prompt tweak|next prompt change|prompt delta|next change|suggested update|refine once)\s*:", line, flags=re.IGNORECASE)
    ][:3]
    match_lines = [
        line
        for line in lines
        if any(term in line.lower() for term in ("match", "close", "works", "good", "captures"))
    ][:2]
    if not match_lines:
        match_lines = ["Comparison response did not include concrete visual traits."]
    strong_save_ready = any(
        phrase in lowered
        for phrase in (
            "ready to save",
            "final signoff",
            "good enough for final signoff",
            "consistent enough for a reusable preset",
            "already consistent enough",
            "already close enough",
            "save as a media preset",
            "save it as the media preset",
            "if you like this result, i can save",
        )
    )
    weak_save_ready = any(phrase in lowered for phrase in ("good enough", "close enough"))
    if strong_save_ready or (weak_save_ready and not missing and not prompt_delta_candidates):
        next_action = "save_preset"
    elif missing:
        next_action = "update_prompt"
    else:
        next_action = "ask_user"
    def _clip_delta(value: str, limit: int = 700) -> str:
        text = " ".join(str(value or "").split())
        if len(text) <= limit:
            return text
        candidate = text[:limit]
        for marker in (". ", "; ", ", "):
            index = candidate.rfind(marker)
            if index >= 220:
                return candidate[: index + len(marker.rstrip())].rstrip()
        return candidate.rstrip()

    if next_action == "save_preset":
        prompt_delta = ""
    elif prompt_delta_candidates:
        prompt_delta = "; ".join(_clean_output_prompt_delta(candidate) for candidate in prompt_delta_candidates if _clean_output_prompt_delta(candidate))
    elif missing:
        prompt_delta = "; ".join(_clean_output_prompt_delta(item) for item in missing[:2] if _clean_output_prompt_delta(item))
    else:
        prompt_delta = "Ask the user whether to save or run one more refinement."
    return ReferenceStyleOutputCheck(
        match_summary=_clip_delta(" ".join(match_lines), limit=420),
        missing_traits=missing,
        prompt_delta=_clip_delta(prompt_delta),
        next_action=next_action,
        latest_output_asset_id=latest_output_asset_id,
        reference_ids=reference_ids or [],
    )
