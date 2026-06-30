from __future__ import annotations

from typing import Any, Dict, List

from .preset_capabilities import (
    capability_fields,
    capability_image_slots,
    image_attachment_count,
    match_preset_capability,
    wants_text_only_preset,
)
from .preset_fields import infer_preset_contract_fields, preset_field
from .preset_skill import initial_media_preset_builder_state
from .preset_slots import infer_runtime_image_slots_from_text


PRESET_BUILDER_STAGE_INTAKE = "contract_proposal"


def _text(message: str) -> str:
    return " ".join(str(message or "").lower().split())


def is_reference_preset_request(message: str, attachments: List[Dict[str, Any]]) -> bool:
    text = _text(message)
    if "preset" not in text:
        return False
    if image_attachment_count(attachments) > 0:
        return True
    return any(token in text for token in ("reference image", "uploaded image", "attached image", "style reference", "turn this into"))


def _explicit_both_preset(message: str) -> bool:
    text = _text(message)
    return any(
        token in text
        for token in (
            "both",
            "text-to-image and image-to-image",
            "text to image and image to image",
            "image-to-image and text-to-image",
            "image to image and text to image",
            "text or image",
            "image or text",
        )
    )


def _reference_style_source(message: str, attachments: List[Dict[str, Any]]) -> bool:
    text = _text(message)
    return image_attachment_count(attachments) > 0 or any(
        token in text
        for token in (
            "reference image",
            "style reference",
            "attached image",
            "uploaded image",
            "from this image",
            "from a reference",
            "turn this into",
        )
    )


def _fallback_reference_image_slot() -> Dict[str, Any]:
    return {
        "key": "subject_reference",
        "label": "Subject Reference",
        "max_files": 1,
        "help_text": "Optional source image when the preset should restyle a person, object, product, or scene.",
        "required": False,
    }


def _fallback_reference_fields(*, has_runtime_image_slot: bool) -> List[Dict[str, Any]]:
    if has_runtime_image_slot:
        return [
            preset_field("scene_setting", "Scene / Setting", required=False, placeholder="Optional place, background, or environment."),
            preset_field("mood", "Mood", required=False, placeholder="Optional tone, genre, or emotional direction."),
            preset_field("detail_notes", "Detail Notes", required=False, placeholder="Optional details to preserve or emphasize."),
        ]
    return [
        preset_field("subject", "Subject", required=True, placeholder="Main person, object, creature, or scene."),
        preset_field("scene_setting", "Scene / Setting", required=False, placeholder="Place, background, or environment."),
        preset_field("mood", "Mood", required=False, placeholder="Tone, genre, or emotional direction."),
    ]


def _recommended_preset_shape(message: str, attachments: List[Dict[str, Any]], *, explicit_text_only: bool, image_slots: List[Dict[str, Any]]) -> str:
    if explicit_text_only:
        return "text_to_image"
    text = _text(message)
    explicit_image_only = any(token in text for token in ("image-to-image only", "image to image only", "just image-to-image", "just image to image"))
    if explicit_image_only:
        return "image_to_image"
    if _explicit_both_preset(message):
        return "both"
    if image_slots:
        return "image_to_image"
    return "text_to_image"


def build_preset_builder_proposal(message: str, attachments: List[Dict[str, Any]]) -> Dict[str, Any]:
    capability = match_preset_capability(message, attachments)
    explicit_text_only = wants_text_only_preset(message)
    image_slots = capability_image_slots(capability)
    explicit_image_slots = infer_runtime_image_slots_from_text(message)
    if explicit_image_slots:
        image_slots = explicit_image_slots
    if explicit_text_only:
        image_slots = []
    recommended_shape = _recommended_preset_shape(
        message,
        attachments,
        explicit_text_only=explicit_text_only,
        image_slots=image_slots,
    )
    if not image_slots and (recommended_shape == "image_to_image" or _explicit_both_preset(message)):
        image_slots = [_fallback_reference_image_slot()]
    fields = infer_preset_contract_fields(
        message,
        base_fields=capability_fields(capability),
        has_runtime_image_slot=bool(image_slots),
        has_style_reference=image_attachment_count(attachments) > 0,
    )
    fields = fields[:3]
    questions = [str(question) for question in (capability.get("questions") or []) if str(question).strip()]
    if explicit_text_only:
        questions = [question for question in questions if "runtime image" not in question.lower() and "image input" not in question.lower()]
        if not questions:
            questions = ["Should I create a text-only test graph with these fields now?"]
    questions = questions[:1] if explicit_text_only else questions[:2]
    field_choices = fields
    image_slot_choices = image_slots
    return {
        "intent": "draft_media_preset",
        "stage": PRESET_BUILDER_STAGE_INTAKE,
        "skill_state": initial_media_preset_builder_state(
            status="contract_proposal",
            lane=recommended_shape,
            reference_image_ids=[
                str(item.get("reference_id") or "")
                for item in attachments
                if str(item.get("reference_id") or "").strip()
            ],
            field_choices=field_choices,
            image_slot_choices=image_slot_choices,
        ),
        "capability_id": capability.get("id"),
        "explicit_text_only": explicit_text_only,
        "recommended_preset_shape": recommended_shape,
        "reference_role": capability.get("reference_role") or ("mixed" if image_slots else "inspiration"),
        "title": capability.get("title") or "Reference Style Preset",
        "description": capability.get("description") or "Create a reusable Media Preset from the attached reference style.",
        "visual_summary": {
            "style": capability.get("style") or "Reference-driven visual preset",
            "fixed_ingredients": capability.get("fixed_ingredients") or [],
            "variable_ingredients": capability.get("variable_ingredients") or [],
        },
        "preset_contract": {
            "capability_id": capability.get("id"),
            "title": capability.get("title") or "Reference Style Preset",
            "description": capability.get("description") or "Create a reusable Media Preset from the attached reference style.",
            "image_slots": image_slots,
            "fields": fields,
            "model_hint": "image_edit" if image_slots else "text_to_image",
            "requires_sandbox_test": True,
        },
        "questions": questions,
    }


def apply_provider_image_input_hint(proposal: Dict[str, Any], assistant_text: str) -> Dict[str, Any]:
    """Let a compact provider recommendation promote intake from undecided to one image input."""
    contract = proposal.get("preset_contract") if isinstance(proposal.get("preset_contract"), dict) else {}
    existing_slots = contract.get("image_slots") if isinstance(contract.get("image_slots"), list) else []
    has_only_generic_fallback_slot = (
        len(existing_slots) == 1
        and isinstance(existing_slots[0], dict)
        and str(existing_slots[0].get("key") or "") == "subject_reference"
        and existing_slots[0].get("required") is False
    )
    if proposal.get("explicit_text_only") or (existing_slots and not has_only_generic_fallback_slot):
        return proposal
    text = _text(assistant_text)
    if any(
        blocker in text
        for blocker in (
            "not a required runtime input",
            "not a required image input",
            "stay text-only or accept",
            "stay text only or accept",
            "text-only or accept",
            "text only or accept",
            "image input: none",
            "input: keep it text-only",
            "input: keep it text only",
            "keep it text-only",
            "keep it text only",
        )
    ):
        return proposal
    hints = (
        "accepts a separate user-provided image",
        "accept a separate user-provided image",
        "accepts one image input",
        "accept one image input",
        "use an image input",
        "not text-only",
        "not text only",
        "image-to-image",
        "image to image",
        "user-provided image",
        "source image",
        "subject image",
        "portrait styling",
        "face-forward",
    )
    if not any(hint in text for hint in hints):
        return proposal
    updated = dict(proposal)
    updated_contract = dict(contract)
    updated_contract["image_slots"] = [
        {
            "key": "personal_reference",
            "label": "Personal Reference",
            "max_files": 1,
            "help_text": "Runtime image requested by the user, such as a face, body, product, object, scene, or background.",
            "required": True,
        }
    ]
    updated_contract["model_hint"] = "image_edit"
    updated["reference_role"] = "mixed"
    updated["recommended_preset_shape"] = "image_to_image"
    updated["preset_contract"] = updated_contract
    updated["questions"] = ["Should this image input be required every time, or optional?"]
    return updated


def preset_builder_chat_text(proposal: Dict[str, Any]) -> str:
    contract = proposal.get("preset_contract") if isinstance(proposal.get("preset_contract"), dict) else {}
    slots = contract.get("image_slots") if isinstance(contract.get("image_slots"), list) else []
    fields = contract.get("fields") if isinstance(contract.get("fields"), list) else []
    slot_labels = ", ".join(str(slot.get("label") or slot.get("key")) for slot in slots if isinstance(slot, dict))
    shape = str(proposal.get("recommended_preset_shape") or contract.get("model_hint") or "").strip()
    display_fields = fields[:3]
    if not display_fields and shape in {"both", "text_to_image", "image_to_image", "image_edit"}:
        display_fields = _fallback_reference_fields(has_runtime_image_slot=bool(slots))
    field_labels = ", ".join(str(field.get("label") or field.get("key")) for field in display_fields[:3] if isinstance(field, dict))
    questions = proposal.get("questions") if isinstance(proposal.get("questions"), list) else []
    question_text = " ".join(str(question) for question in questions[:1])
    if shape == "both":
        shape_sentence = "I recommend both: a text-to-image version for prompt-only use and an image-to-image version when you have a source image."
    elif shape in {"image_to_image", "image_edit"}:
        shape_sentence = "I recommend image-to-image for this preset."
    else:
        shape_sentence = "I recommend text-to-image for this preset."
    if slot_labels:
        image_input_text = f"Image slot: {slot_labels}."
    elif shape == "both":
        image_input_text = "Image slot suggestion: Subject Reference for the image-to-image version."
    elif str(proposal.get("reference_role") or "") == "inspiration":
        image_input_text = "Image slot: none; reference images stay as style sources only."
    else:
        image_input_text = "Image slot: none."
    field_text = f"Useful fields: {field_labels}." if field_labels else "Useful fields: none yet."
    next_step = question_text or "Want adjustments, or should I create the local test graph?"
    return "\n\n".join(
        part
        for part in (
            f"I would make this a `{proposal.get('title') or 'Media Preset'}` preset.",
            shape_sentence,
            f"{field_text} {image_input_text}",
            next_step,
        )
        if part.strip()
    ).strip()
