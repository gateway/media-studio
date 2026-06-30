from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List

from .limits import is_image_attachment


CAPABILITY_DEFAULT_ID = "reference_style_preset"


def _text(value: str) -> str:
    return " ".join(str(value or "").lower().split())


def _attachment_labels(attachments: List[Dict[str, Any]]) -> str:
    return " ".join(str(item.get("label") or item.get("reference_id") or "") for item in attachments)


def image_attachment_count(attachments: List[Dict[str, Any]]) -> int:
    return len([attachment for attachment in attachments if is_image_attachment(attachment)])


def wants_face_body_slots(message: str) -> bool:
    text = _text(message)
    return (
        ("face" in text and ("body" in text or "full body" in text or "full-body" in text))
        or "two input images" in text
        or "two runtime image inputs" in text
        or "2 input images" in text
        or "2 runtime image inputs" in text
        or ("image 1" in text and "image 2" in text)
    )


def wants_single_personal_reference_slot(message: str) -> bool:
    text = _text(message)
    if wants_face_body_slots(message):
        return False
    if any(
        token in text
        for token in (
            "do not use the style reference image as a runtime image input",
            "do not use the style reference",
            "no runtime image input",
            "without a runtime image input",
            "text-driven",
            "text only",
            "run from text only",
        )
    ):
        return False
    return any(
        token in text
        for token in (
            "one personal reference image",
            "single personal reference image",
            "one reference image of me",
            "one picture of me",
            "one photo of me",
            "picture of me",
            "photo of me",
            "image of me",
            "image of a person",
            "image-to-image",
            "image to image",
            "person image",
            "person input image",
            "input image of a person",
            "input image",
            "runtime image of a person",
            "runtime person image",
            "runtime subject image",
            "personal reference image",
            "subject reference image",
            "source image",
            "source image input",
            "runtime image input",
            "subject image input",
            "subject image",
            "attach a source image",
            "attach a picture",
            "attach one picture",
            "attach an image",
            "one input image",
            "single input image",
        )
    )


def wants_text_only_preset(message: str) -> bool:
    text = _text(message)
    explicit_no_image = any(
        token in text
        for token in (
            "no runtime image input",
            "no runtime image inputs",
            "no image input",
            "no image inputs",
            "do not use any runtime image input",
            "do not use any runtime image inputs",
            "do not use any image input",
            "do not use any image inputs",
            "without a runtime image input",
            "without runtime image inputs",
            "without image input",
            "without image inputs",
            "run from text only",
        )
    )
    explicit_image_input = any(
        token in text
        for token in (
            "image-to-image",
            "image to image",
            "image input",
            "input image",
            "source image",
            "subject image",
            "runtime image",
        )
    )
    if any(
        token in text
        for token in (
            "not sure whether",
            "whether it should be",
            "whether this should be",
            "text-only or",
            "text only or",
            "text-to-image or",
            "text to image or",
        )
    ):
        return False
    if explicit_image_input and not explicit_no_image:
        return False
    return any(
        token in text
        for token in (
            "no runtime image input",
            "no runtime image inputs",
            "no image input",
            "no image inputs",
            "do not use any runtime image input",
            "do not use any runtime image inputs",
            "do not use any image input",
            "do not use any image inputs",
            "without a runtime image input",
            "without runtime image inputs",
            "without image input",
            "without image inputs",
            "text-driven",
            "text driven",
            "text only",
            "text-only",
            "text to image",
            "text-to-image",
            "run from text only",
        )
    )


def wants_year_field(message: str) -> bool:
    text = _text(message)
    return any(
        token in text
        for token in (
            "year field",
            "year input",
            "year value",
            "enter a year",
            "enter the year",
            "input a year",
            "provide a year",
            "choose a year",
            "type a year",
            "take a year",
            "takes a year",
            "using the year",
        )
    )


def wants_sandbox_example(message: str) -> bool:
    text = _text(message)
    return any(
        token in text
        for token in (
            "example",
            "sandbox",
            "test it",
            "try it",
            "test graph",
            "test workflow",
            "example workflow",
            "sample workflow",
            "use inputs + test",
            "minimal + test",
            "create test workflow",
        )
    )


def is_ambiguous_preset_lane_request(message: str) -> bool:
    text = _text(message)
    return any(
        token in text
        for token in (
            "not sure if",
            "not sure whether",
            "whether it should be",
            "whether this should be",
            "image-to-image, text-to-image, or both",
            "image to image, text to image, or both",
            "text-to-image, image-to-image, or both",
            "text to image, image to image, or both",
        )
    )


def has_image_reference(message: str, attachments: List[Dict[str, Any]]) -> bool:
    if image_attachment_count(attachments) > 0:
        return True
    text = _text(message)
    return any(token in text for token in ("image", "photo", "reference", "portrait", "uploaded"))


def _features(message: str, attachments: List[Dict[str, Any]], *, extra_text: str = "") -> Dict[str, bool]:
    combined = " ".join(part for part in (message, extra_text) if part)
    return {
        "face_body_slots": wants_face_body_slots(combined),
        "personal_reference_slot": wants_single_personal_reference_slot(combined) and not is_ambiguous_preset_lane_request(combined),
        "year_field": wants_year_field(combined),
        "image_reference": has_image_reference(combined, attachments),
        "attachment_image": image_attachment_count(attachments) > 0,
    }


@lru_cache(maxsize=1)
def preset_builder_capabilities() -> List[Dict[str, Any]]:
    path = Path(__file__).with_name("preset_capabilities.json")
    payload = json.loads(path.read_text(encoding="utf-8"))
    capabilities = payload.get("capabilities") if isinstance(payload, dict) else []
    return sorted(
        [capability for capability in capabilities if isinstance(capability, dict)],
        key=lambda item: int(item.get("priority") or 0),
        reverse=True,
    )


def _capability_matches(capability: Dict[str, Any], *, text: str, features: Dict[str, bool]) -> bool:
    match = capability.get("match") if isinstance(capability.get("match"), dict) else {}
    if match.get("default"):
        return True
    for feature in match.get("features") or []:
        if not features.get(str(feature)):
            return False
    any_terms = [str(term).lower() for term in (match.get("any_terms") or []) if str(term).strip()]
    if any_terms and not any(term in text for term in any_terms):
        return False
    all_terms = [str(term).lower() for term in (match.get("all_terms") or []) if str(term).strip()]
    if all_terms and not all(term in text for term in all_terms):
        return False
    return bool(match.get("features") or any_terms or all_terms)


def match_preset_capability(message: str, attachments: List[Dict[str, Any]] | None = None, *, extra_text: str = "") -> Dict[str, Any]:
    attachments = attachments or []
    text = _text(f"{message} {_attachment_labels(attachments)} {extra_text}")
    features = _features(message, attachments, extra_text=extra_text)
    default_capability: Dict[str, Any] | None = None
    for capability in preset_builder_capabilities():
        if capability.get("id") == CAPABILITY_DEFAULT_ID:
            default_capability = capability
        if _capability_matches(capability, text=text, features=features):
            return capability
    return default_capability or {}


def sample_year(message: str, attachments: List[Dict[str, Any]], *, extra_text: str = "") -> str:
    text = " ".join([str(message or ""), str(extra_text or ""), *[str(item.get("label") or "") for item in attachments]])
    match = re.search(r"\b(19\d{2}|20\d{2})\b", text)
    return match.group(1) if match else "the requested year"


def render_capability_template(template: str, values: Dict[str, str]) -> str:
    rendered = str(template or "")
    for key, value in values.items():
        rendered = rendered.replace(f"[[{key}]]", str(value))
    return rendered


def capability_fields(capability: Dict[str, Any]) -> List[Dict[str, Any]]:
    return [dict(field) for field in (capability.get("fields") or []) if isinstance(field, dict)]


def capability_image_slots(capability: Dict[str, Any]) -> List[Dict[str, Any]]:
    return [dict(slot) for slot in (capability.get("image_slots") or []) if isinstance(slot, dict)]


def capability_uses_prompt_template(capability: Dict[str, Any]) -> bool:
    return bool(str(capability.get("save_prompt_template") or "").strip())


def match_refinement_capability(message: str, existing_prompt: str) -> Dict[str, Any]:
    text = _text(f"{message} {existing_prompt}")
    default_capability: Dict[str, Any] | None = None
    for capability in preset_builder_capabilities():
        if capability.get("id") == CAPABILITY_DEFAULT_ID:
            default_capability = capability
    if "prior assistant reference-style analysis" in text and default_capability:
        return default_capability
    for capability in preset_builder_capabilities():
        if capability.get("id") == CAPABILITY_DEFAULT_ID:
            default_capability = capability
        refinement = capability.get("refinement") if isinstance(capability.get("refinement"), dict) else {}
        terms = [str(term).lower() for term in (refinement.get("context_terms") or []) if str(term).strip()]
        if terms and any(term in text for term in terms):
            return capability
    return default_capability or {}


def _reference_style_hint(message: str) -> str:
    blacklist = {
        "subject reference",
        "style reference",
        "scene brief",
        "optional text / detail notes",
        "reference style preset",
        "media preset",
    }
    candidates = re.findall(r"`([^`]{4,90})`", str(message or ""))
    match = re.search(r"likely preset:\s*`?([^`.\n]{4,90})`?", str(message or ""), flags=re.IGNORECASE)
    if match:
        candidates.insert(0, match.group(1))
    hints: List[str] = []
    for candidate in candidates:
        normalized = _text(candidate)
        if normalized and normalized not in blacklist and not normalized.endswith("reference"):
            hints.append(" ".join(str(candidate).split()))
        if len(hints) >= 3:
            break
    return "; ".join(dict.fromkeys(hints))


def refinement_details(capability: Dict[str, Any], message: str, *, output_aware: bool, year: str) -> str:
    refinement = capability.get("refinement") if isinstance(capability.get("refinement"), dict) else {}
    text = _text(message)
    details: List[str] = []
    if output_aware and refinement.get("output_aware_detail"):
        details.extend(str(refinement.get("output_aware_detail")).split("; "))
    if capability.get("id") == CAPABILITY_DEFAULT_ID:
        style_hint = _reference_style_hint(message)
        if style_hint:
            details.append(f"preserve the inferred style direction: {style_hint}")
    for rule in refinement.get("detail_rules") or []:
        if not isinstance(rule, dict):
            continue
        terms = [str(term).lower() for term in (rule.get("terms") or []) if str(term).strip()]
        if terms and any(term in text for term in terms):
            detail = render_capability_template(str(rule.get("detail") or ""), {"year": year})
            if detail:
                details.append(detail)
    if not details and refinement.get("default_detail"):
        details.append(str(refinement.get("default_detail")))
    return "; ".join(dict.fromkeys(details))
