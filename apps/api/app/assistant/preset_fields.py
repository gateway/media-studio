from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List


def slug_field_key(value: str, fallback: str = "custom_field") -> str:
    slug = re.sub(r"_+", "_", re.sub(r"[^a-z0-9]+", "_", value.strip().lower())).strip("_")
    return slug or fallback


def preset_field(key: str, label: str, *, required: bool = True, placeholder: str | None = None) -> Dict[str, Any]:
    return {
        "key": key,
        "label": label,
        "placeholder": placeholder or f"{label}.",
        "default_value": "",
        "required": required,
    }


def _text(value: str) -> str:
    return " ".join(str(value or "").lower().split())


def _title_label(value: str) -> str:
    cleaned = re.sub(r"[_-]+", " ", str(value or ""))
    cleaned = re.sub(r"\s*/\s*", " / ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" .,:;\"'")
    return cleaned.title()


def _valid_field_label(label: str) -> bool:
    normalized = _text(label)
    if len(normalized) < 3 or len(normalized) > 48:
        return False
    blocked_exact = {
        "field",
        "fields",
        "form field",
        "form fields",
        "input",
        "inputs",
        "image",
        "images",
        "runtime image",
        "that make sense",
        "minimal",
        "useful fields",
        "minimal fields",
    }
    if normalized in blocked_exact:
        return False
    return not any(token in normalized for token in ("sandbox", "preset", "runtime image", "input image"))


def _dedupe_fields(fields: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    unique_fields: Dict[str, Dict[str, Any]] = {}
    for field in fields:
        key = str(field.get("key") or "").strip()
        label = str(field.get("label") or "").strip()
        if not key or not label:
            continue
        unique_fields[key] = field
    return list(unique_fields.values())


def _split_field_list(value: str) -> List[str]:
    cleaned = re.sub(r"\b(and|plus)\b", ",", str(value or ""), flags=re.IGNORECASE)
    return [_title_label(part) for part in cleaned.split(",") if _valid_field_label(part)]


def _named_fields_from_message(message: str) -> List[Dict[str, Any]]:
    text = _text(message)
    candidates: List[str] = []
    patterns = [
        r"\buse\s+(.{3,120}?)\s+as\s+(?:the\s+)?(?:(?:one|two|three|four|\d+)\s+)?fields?\b",
        r"\bkeep\s+(?:the\s+)?(?:approved\s+)?fields?\s+(.{3,120}?)(?:\.|,|$|\b(?:before|then|create|build|make|test|sandbox|save|do not)\b)",
        r"\bfields?\s*:\s+(.{3,120}?)(?:\.|$|\b(?:before|then|create|build|make|test|sandbox|save)\b)",
        r"\bfields?\s+(?:called|named|for|as|should be|are)\s+(.{3,120}?)(?:\.|$|\b(?:before|then|create|build|make|test|sandbox)\b)",
        r"\b(?:the\s+)?(?:one|two|three|four|\d+)\s+fields?\s+(?!called\b|named\b|for\b|as\b)(.{3,120}?)(?:\.|$|\b(?:before|then|create|build|make|test|sandbox)\b)",
        r"\badd\s+(?:the\s+)?fields?\s+(?!for\b)(.{3,120}?)(?:\.|$|\b(?:before|then|create|build|make|test|sandbox)\b)",
    ]
    for pattern in patterns:
        for match in re.finditer(pattern, text):
            candidates.extend(_split_field_list(match.group(1)))

    named_match = re.search(r"\bfield named\s+([a-z0-9 _/-]{2,48})", text)
    if named_match:
        candidates.append(_title_label(named_match.group(1)))

    return [
        preset_field(slug_field_key(label), label, required=True)
        for label in candidates
        if _valid_field_label(label)
    ][:4]


def wants_suggested_preset_fields(message: str) -> bool:
    text = _text(message)
    return any(
        token in text
        for token in (
            "suggest two useful fields",
            "suggest useful fields",
            "recommend minimal useful",
            "few form fields",
            "form fields that make sense",
            "fields that make sense",
            "one or two editable fields",
            "editable fields",
            "input fields",
        )
    )


def default_reference_style_fields(*, has_runtime_image_slot: bool) -> List[Dict[str, Any]]:
    if has_runtime_image_slot:
        return [
            preset_field("pose_framing", "Pose / Framing", required=False, placeholder="Optional pose, crop, or composition guidance."),
        ]
    return []


def infer_explicit_preset_fields(message: str) -> List[Dict[str, Any]]:
    text = _text(message)
    named_fields = _named_fields_from_message(message)
    if named_fields:
        return named_fields
    fields: List[Dict[str, Any]] = []
    field_specs = [
        ("scene_setting", "Scene / Setting", ("scene details", "scene direction")),
        ("color_accent", "Color Accent", ("color accent", "accent color", "color palette")),
        ("text_or_slogan", "Text or Slogan", ("text or slogan", "slogan text", "slogan", "caption text")),
        ("visual_style", "Visual Style", ("visual style field", "visual_style")),
        ("product_name", "Product Name", ("product name", "product_name")),
        ("product_details", "Product Details", ("product details",)),
        ("year", "Year", ("year field", "year input", "year value", "enter a year", "enter the year", "input a year", "provide a year", "choose a year", "type a year", "take a year", "takes a year", "using the year")),
    ]
    for key, label, terms in field_specs:
        if any(term in text for term in terms):
            fields.append(preset_field(key, label, required=key not in {"detail_notes", "visual_style"}))
    return _dedupe_fields(fields)


def infer_preset_contract_fields(
    message: str,
    *,
    base_fields: List[Dict[str, Any]] | None = None,
    has_runtime_image_slot: bool,
    has_style_reference: bool,
) -> List[Dict[str, Any]]:
    base_fields = base_fields or []
    explicit_fields = infer_explicit_preset_fields(message)
    if explicit_fields:
        return explicit_fields
    if base_fields and has_style_reference and not wants_suggested_preset_fields(message):
        return _dedupe_fields(base_fields)
    if wants_suggested_preset_fields(message) or (has_style_reference and not base_fields):
        default_fields = default_reference_style_fields(has_runtime_image_slot=has_runtime_image_slot)
        return _dedupe_fields([*base_fields, *default_fields])
    return []
