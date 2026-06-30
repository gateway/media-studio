from __future__ import annotations

import re
from typing import Any, Dict, List

from .. import kie_adapter, store
from ..graph.schemas import GraphWorkflow
from ..schemas import PresetUpsertRequest, PromptRecipeUpsertRequest
from ..service_errors import ServiceError
from ..service_preset_validation import validate_preset_payload
from ..service_prompt_recipe_validation import validate_prompt_recipe_payload
from .character_sheet_recipe import character_sheet_prompt_recipe_draft, character_sheet_prompt_recipe_request
from .context import build_attachment_summary
from .preset_capabilities import (
    capability_fields,
    capability_image_slots,
    capability_uses_prompt_template,
    has_image_reference,
    match_preset_capability,
    wants_face_body_slots,
    wants_single_personal_reference_slot,
    wants_year_field,
)
from .preset_fields import infer_explicit_preset_fields, infer_preset_contract_fields
from .preset_slots import infer_runtime_image_slots_from_text
from .style_brief import compile_reference_style_prompt, has_concrete_style_traits, parse_reference_style_brief


def _slug(value: str, fallback: str) -> str:
    slug = re.sub(r"_+", "_", re.sub(r"[^a-z0-9]+", "_", value.strip().lower())).strip("_")
    return slug or fallback


def _unique_recipe_key(base: str) -> str:
    key = base
    index = 2
    while store.get_prompt_recipe_by_key(key):
        key = f"{base}_{index}"
        index += 1
    return key


def _unique_preset_key(base: str) -> str:
    key = base
    index = 2
    while store.get_preset_by_key(key):
        key = f"{base}_{index}"
        index += 1
    return key


def _title_from_message(message: str, fallback: str) -> str:
    cleaned = " ".join(str(message or "").split())
    if not cleaned:
        return fallback
    explicit_title = _explicit_title_from_message(cleaned)
    if explicit_title:
        return explicit_title
    called_match = re.search(r"\bcalled\s+(.+?)(?:[.!?]|$)", cleaned, flags=re.IGNORECASE)
    if called_match:
        title = called_match.group(1).strip(" .,\"'")
        if title:
            return title[:52].rstrip(" .,")
    return cleaned[:52].rstrip(" .,")


def _explicit_title_from_message(message: str) -> str:
    cleaned = " ".join(str(message or "").split())
    stop_words = r"(?:\s+(?:from|using|use|with|based on|as)\b|[.!?]|$)"
    match = re.search(r"\b(?:called|name it|title it)\s+(.+?)" + stop_words, cleaned, flags=re.IGNORECASE)
    if not match:
        match = re.search(r"\b(?:media\s+preset|preset)\s+named\s+(.+?)" + stop_words, cleaned, flags=re.IGNORECASE)
    if not match:
        return ""
    title = match.group(1).strip(" .,\"'`")
    return title[:80].rstrip(" .,")


def _sanitize_preset_title(title: str, fallback: str) -> str:
    cleaned = " ".join(str(title or "").split()).strip(" .,\"'`*_")
    return cleaned[:80].rstrip(" .,") or fallback


def _sanitize_saved_prompt_template(prompt: str) -> str:
    cleaned = str(prompt or "")
    cleaned = re.sub(r"`\*([^`]+?)`", r"`\1`", cleaned)
    cleaned = re.sub(r"(^|[.:;]\s+)\*([A-Za-z0-9])", r"\1\2", cleaned)
    cleaned = _strip_output_review_scaffolding(cleaned)
    legacy_field_terms = {
        "Hero Archetype": "Main Character",
        "Subject Archetype": "Main Subject",
        "Hero Brief": "Main Character",
        "Subject Brief": "Main Subject",
        "Subject Direction": "Main Subject",
        "Character Role": "Main Character",
        "Scene Brief": "Scene / Setting",
        "Detail Notes": "Additional Details",
        "Optional Detail Notes": "Additional Details",
        "Style Notes": "Additional Details",
    }
    for old, new in legacy_field_terms.items():
        cleaned = re.sub(rf"\b{re.escape(old)}\b", new, cleaned)
    return cleaned


def _strip_output_review_scaffolding(prompt: str) -> str:
    """Remove assistant review labels that should never become saved preset prompt text."""
    text = str(prompt or "")
    if not text.strip():
        return ""
    review_label_re = r"(?:Matches|Missing|Improve|Prompt tweak|Next prompt change|Recommendation)"
    text = re.sub(r"\bStrengthen\s+the\s+next\s+version\s+(?:by\s+adding\s+more\s+of|with)\s+", "\n", text, flags=re.IGNORECASE)
    text = re.sub(rf"(?<!^)([.;])\s+({review_label_re})\s*:", r"\1\n\2:", text, flags=re.IGNORECASE)
    sanitized_lines: List[str] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            sanitized_lines.append(raw_line)
            continue
        label_match = re.match(rf"^[-*\s]*({review_label_re})\s*:\s*(.+)$", line, flags=re.IGNORECASE)
        if not label_match:
            if re.search(r"\b(?:this output|this result|generated output|generated result|reference style has)\b", line, flags=re.IGNORECASE):
                continue
            sanitized_lines.append(raw_line)
            continue
        continue
    cleaned = "\n".join(sanitized_lines)
    cleaned = re.sub(rf"\b({review_label_re})\s*:\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def _negative_runtime_image_intent(message: str) -> bool:
    text = str(message or "").lower()
    return any(
        token in text
        for token in (
            "text only",
            "text-only",
            "text driven",
            "text-driven",
            "no image",
            "no runtime image",
            "no runtime image input",
            "without image",
            "without a runtime image",
            "without a runtime image input",
            "do not use the style reference image as a runtime image input",
        )
    )


def _has_image_reference(message: str, attachments: List[Dict[str, Any]]) -> bool:
    return has_image_reference(message, attachments)


def _explicit_preset_fields(message: str) -> List[Dict[str, Any]]:
    return infer_explicit_preset_fields(message)


def _recipe_field_from_preset_field(field: Dict[str, Any]) -> Dict[str, Any]:
    key = str(field.get("key") or "").strip()
    label = str(field.get("label") or key).strip()
    field_type = "textarea" if any(token in key for token in ("notes", "subject", "scene", "brief")) else "text"
    return {
        "key": key,
        "label": label,
        "type": field_type,
        "placeholder": str(field.get("placeholder") or f"{label}."),
        "default_value": str(field.get("default_value") or ""),
        "required": bool(field.get("required", True)),
        "help_text": f"Reusable {label.lower()} direction for this prompt recipe.",
    }


def _dedupe_preset_fields(fields: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    unique_fields: Dict[str, Dict[str, Any]] = {}
    for field in fields:
        key = str(field.get("key") or "").strip()
        if key:
            unique_fields[key] = field
    return list(unique_fields.values())


def _recipe_custom_fields(message: str) -> List[Dict[str, Any]]:
    text = str(message or "").lower()
    explicit_fields = [
        _recipe_field_from_preset_field(field)
        for field in _explicit_preset_fields(message)
        if str(field.get("key") or "").strip()
    ]
    if explicit_fields:
        return explicit_fields
    if "product" in text:
        return [
            {
                "key": "product_name",
                "label": "Product Name",
                "type": "text",
                "placeholder": "Product or offer name.",
                "default_value": "",
                "required": True,
                "help_text": "The product or offer the prompt should feature.",
            },
            {
                "key": "detail_notes",
                "label": "Additional Details",
                "type": "textarea",
                "placeholder": "Optional reusable details, constraints, or tone.",
                "default_value": "",
                "required": False,
                "help_text": "Optional direction to keep reusable.",
            },
        ]
    if "storyboard" in text:
        return [
            {
                "key": "layout_notes",
                "label": "Layout Notes",
                "type": "text",
                "placeholder": "Panel count, frame structure, or layout guidance.",
                "default_value": "",
                "required": True,
                "help_text": "Controls the requested panel or frame structure.",
            },
            {
                "key": "detail_notes",
                "label": "Additional Details",
                "type": "textarea",
                "placeholder": "Optional reusable details, constraints, or tone.",
                "default_value": "",
                "required": False,
                "help_text": "Optional direction to keep reusable.",
            },
        ]
    if "character" in text:
        return [
            {
                "key": "subject_details",
                "label": "Subject Details",
                "type": "textarea",
                "placeholder": "Reusable subject details, pose, setting, or constraints.",
                "default_value": "",
                "required": True,
                "help_text": "Reusable subject ingredients for the generated prompt.",
            },
            {
                "key": "detail_notes",
                "label": "Additional Details",
                "type": "textarea",
                "placeholder": "Optional reusable details, constraints, or tone.",
                "default_value": "",
                "required": False,
                "help_text": "Optional creative direction for this recipe.",
            },
        ]
    return []


def _recipe_uses_runtime_image_input(message: str, attachments: List[Dict[str, Any]]) -> bool:
    if _negative_runtime_image_intent(message):
        return False
    return _has_image_reference(message, attachments)


def _storyboard_v2_prompt_recipe_request(message: str) -> bool:
    normalized = " ".join(str(message or "").lower().split())
    return (
        "storyboard v2" in normalized
        or (
            "3x2 cinematic storyboard" in normalized
            and "[image reference 1]" in normalized
            and "[image reference 2]" in normalized
        )
    )


def _storyboard_v2_prompt_shell(message: str) -> str:
    text = str(message or "")
    marker = re.search(r"\bbase prompt shell\s*:\s*", text, flags=re.IGNORECASE)
    if marker:
        shell = text[marker.end() :].strip()
    else:
        start = re.search(r"create a high-quality 3x2 cinematic storyboard sheet", text, flags=re.IGNORECASE)
        shell = text[start.start() :].strip() if start else ""
    if not shell:
        shell = (
            "Create a high-quality 3x2 cinematic storyboard sheet from the creative direction in {user_prompt}. "
            "Use [image reference 1] as the facial lock / identity reference and [image reference 2] as the character sheet / body, outfit, and style reference.\n\n"
            "Create exactly 6 storyboard cells in a 3x2 grid. Each cell must reserve a readable metadata strip below the image with concise English director notes for SHOT, CAMERA, FRAMING, ACTION, MOTION, DIALOG, and optional NOTES. "
            "Use a premium pencil-sketch / inked cinematic concept-art storyboard style with a dark production-board background, thin yellow-orange UI lines, readable labels, and clear video-director handoff value."
        )
    shell = re.sub(r"--\s*Start User prompt:\s*\{user_prompt\}\s*--\s*End User Prompt\s*", "", shell, flags=re.IGNORECASE).strip()
    shell = shell.replace("do not pus speech bubbles", "do not put speech bubbles")
    shell = re.sub(r"(?<!\{)\{user_prompt\}(?!\})", "{{user_prompt}}", shell)
    shell = re.sub(r"\{\{\{user_prompt\}\}\}", "{{user_prompt}}", shell)
    return shell


def storyboard_v2_prompt_recipe_draft(message: str) -> PromptRecipeUpsertRequest:
    shell = _storyboard_v2_prompt_shell(message)
    template = (
        "You are Media Studio's Storyboard v2 prompt compiler for GPT Image 2 image-to-image and multimodal storyboard stills.\n"
        "Return only the final image-generation prompt. Do not explain, do not use markdown, and do not return JSON.\n\n"
        "OPTIONAL STYLE DIRECTION:\n{{style_direction}}\n\n"
        "OPTIONAL PREVIOUS BOARD HANDOFF:\n{{previous_output}}\n\n"
        f"{shell}\n\n"
        "RECIPE OUTPUT RULES:\n"
        "- Preserve the user's story brief as the source of truth.\n"
        "- Preserve ordered reference semantics: [image reference 1] is face / identity lock or the primary approved character sheet when it is the only connected image; [image reference 2] is character sheet / body / outfit / design lock when connected separately.\n"
        "- Treat additional references as optional set, prop, wardrobe, creature, product, vehicle, atmosphere, or environment support. Do not let them override character identity.\n"
        "- If previous board handoff is provided, make the new board continue from that ending beat.\n"
        "- For long arcs, make one board read as one compact story segment with setup, escalation, payoff, and a final handoff into the next board.\n"
        "- Every panel must earn the next panel. Do not jump from a problem state to a solved state without showing the action, tool, discovery, choice, or consequence that caused the change.\n"
        "- When a story includes a restraint, locked door, trap, chase, injury, transformation, vehicle launch, magic effect, weapon use, escape, rescue, or other obstacle-to-resolution beat, reserve one panel or a clear ACTION/MOTION/NOTES bridge that shows how that state changes.\n"
        "- Every storyboard cell must keep a readable below-image metadata strip. Do not drop camera/action/dialog/action notes to make images larger.\n"
        "- Use consistent per-cell metadata labels: SHOT, CAMERA, FRAMING, ACTION, MOTION, DIALOG, and optional NOTES.\n"
        "- ACTION should describe what the character, important item, prop, creature, vehicle, or scene element is doing.\n"
        "- DIALOG should stay blank after the colon when no spoken line is needed. Use sparse short spoken lines only when the user asks for dialogue or provides exact dialogue.\n"
        "- Keep labels and director notes short enough to be readable on the final sheet.\n"
        "- Do not add biographies, stats, powers lists, workflow text, provider notes, or internal planning text."
    )
    return PromptRecipeUpsertRequest(
        key=_unique_recipe_key("storyboard_v2"),
        label="Storyboard v2",
        description="Compiles a story brief plus ordered character/set references into one cinematic storyboard-sheet prompt.",
        category="image",
        status="active",
        system_prompt_template=_sanitize_saved_prompt_template(template),
        image_analysis_prompt="",
        user_prompt_placeholder="{{user_prompt}}",
        output_format="single_prompt",
        output_contract_json={"type": "text", "description": "A single GPT Image storyboard-sheet prompt."},
        input_variables=[
            {
                "key": "user_prompt",
                "token": "{{user_prompt}}",
                "label": "Story / Scene Brief",
                "enabled": True,
                "required": True,
                "default_value": "",
                "description": "The story, action, dialogue, camera direction, and ending beat to turn into a 3x2 storyboard sheet.",
            },
            {
                "key": "style_direction",
                "token": "{{style_direction}}",
                "label": "Style Direction",
                "enabled": True,
                "required": False,
                "default_value": "premium pencil-sketch / inked cinematic concept-art storyboard styling",
                "description": "Optional visual style override.",
            },
            {
                "key": "previous_output",
                "token": "{{previous_output}}",
                "label": "Previous Board Handoff",
                "enabled": True,
                "required": False,
                "default_value": "No previous board handoff provided.",
                "description": "Optional ending state or continuity note from the prior storyboard.",
            },
        ],
        custom_fields=[],
        image_input={
            "enabled": True,
            "required": True,
            "mode": "direct_reference",
            "analysis_variable": "image_analysis",
            "max_files": 4,
        },
        default_options_json={"temperature": 0.25, "max_output_tokens": 2200, "strict_output": True},
        rules={
            "return_only_final_output": True,
            "allow_markdown": False,
            "allow_external_variables": True,
            "requires_ordered_image_refs": True,
            "required_image_reference_roles": ["face_identity_lock", "character_sheet_design_lock"],
        },
        notes="Use image reference 1 for face/identity and image reference 2 for character sheet/body/outfit/design. Review before saving.",
        source_kind="custom",
        version="2.3",
        priority=0,
    )


def draft_prompt_recipe(message: str, attachments: List[Dict[str, Any]]) -> Dict[str, Any]:
    if _storyboard_v2_prompt_recipe_request(message):
        draft = storyboard_v2_prompt_recipe_draft(message)
        validated = validate_prompt_recipe_payload(draft)
        return {
            "draft": PromptRecipeUpsertRequest(**validated),
            "validation_warnings": list(validated.get("validation_warnings_json") or []),
            "media_summary": build_attachment_summary(attachments),
        }
    if character_sheet_prompt_recipe_request(message):
        draft = character_sheet_prompt_recipe_draft()
        validated = validate_prompt_recipe_payload(draft)
        return {
            "draft": PromptRecipeUpsertRequest(**validated),
            "validation_warnings": list(validated.get("validation_warnings_json") or []),
            "media_summary": build_attachment_summary(attachments),
        }

    title = _sanitize_preset_title(_title_from_message(message, "Assistant recipe draft"), "Assistant recipe draft")
    key = _unique_recipe_key(f"assistant_{_slug(title, 'recipe')}")
    image_enabled = _recipe_uses_runtime_image_input(message, attachments)
    custom_fields = _recipe_custom_fields(message)
    image_input = {
        "enabled": image_enabled,
        "required": False,
        "mode": "analyze_then_inject" if image_enabled else "none",
        "analysis_variable": "image_analysis",
        "max_files": 1 if image_enabled else 0,
    }
    template_lines = [
        "You are a Media Studio prompt recipe writer.",
        "Turn {{user_prompt}} into one polished generation prompt.",
    ]
    if image_enabled:
        template_lines.append("Use {{image_analysis}} as visual reference context when it is available.")
    for field in custom_fields:
        template_lines.append(f"Use {{{{{field['key']}}}}} when it is provided.")
    draft = PromptRecipeUpsertRequest(
        key=key,
        label=title,
        description="Assistant draft for review before saving.",
        category="image",
        status="active",
        system_prompt_template=_sanitize_saved_prompt_template("\n".join(template_lines)),
        image_analysis_prompt=(
            "Describe the attached image for identity, composition, style, lighting, and reusable visual constraints."
            if image_enabled
            else ""
        ),
        output_format="single_prompt",
        image_input=image_input,
        input_variables=[
            {
                "key": "user_prompt",
                "token": "{{user_prompt}}",
                "label": "User Prompt",
                "enabled": True,
                "required": True,
                "default_value": "",
                "description": "Creative goal or source prompt.",
            }
        ],
        custom_fields=custom_fields,
        notes="Review this assistant draft before saving. It has not been saved.",
        source_kind="custom",
        priority=0,
    )
    validated = validate_prompt_recipe_payload(draft)
    return {
        "draft": PromptRecipeUpsertRequest(**validated),
        "validation_warnings": list(validated.get("validation_warnings_json") or []),
        "media_summary": build_attachment_summary(attachments),
    }


def _style_brief_text_fields(style_brief: Dict[str, Any] | None) -> List[Dict[str, Any]]:
    parsed_brief = parse_reference_style_brief(style_brief)
    if not (parsed_brief and has_concrete_style_traits(parsed_brief)):
        return []
    fields: List[Dict[str, Any]] = []
    for field in parsed_brief.preset_contract.fields:
        key = str(field.key or "").strip()
        label = str(field.label or key).strip()
        if not key or not label:
            continue
        fields.append(
            {
                "key": key,
                "label": label,
                "placeholder": str(field.purpose or f"{label}."),
                "default_value": str(field.default_value or ""),
                "required": bool(field.required),
            }
        )
    return fields


def _preset_text_fields(
    message: str,
    attachments: List[Dict[str, Any]] | None = None,
    *,
    style_brief: Dict[str, Any] | None = None,
    has_runtime_image_slot: bool | None = None,
) -> List[Dict[str, Any]]:
    attachments = attachments or []
    explicit_fields = infer_explicit_preset_fields(message)
    if explicit_fields:
        return _dedupe_preset_fields(explicit_fields)
    style_fields = _style_brief_text_fields(style_brief)
    if style_fields:
        return _dedupe_preset_fields(style_fields)
    capability = match_preset_capability(message, attachments)
    capability_defined_fields = capability_fields(capability)
    has_runtime_slot = (
        bool(has_runtime_image_slot)
        if has_runtime_image_slot is not None
        else bool(capability_image_slots(capability)) or wants_single_personal_reference_slot(message) or wants_face_body_slots(message)
    )
    fields = infer_preset_contract_fields(
        message,
        base_fields=capability_defined_fields,
        has_runtime_image_slot=has_runtime_slot,
        has_style_reference=_has_image_reference(message, attachments),
    )
    if fields:
        return _dedupe_preset_fields(fields)
    return [
        {
            "key": "creative_brief",
            "label": "Creative Brief",
            "placeholder": "Describe what this preset should create.",
            "default_value": "",
            "required": True,
        }
    ]


def _should_include_preset_image_slot(message: str, attachments: List[Dict[str, Any]]) -> bool:
    capability = match_preset_capability(message, attachments)
    text = str(message or "").lower()
    if _negative_runtime_image_intent(message):
        return False
    if infer_runtime_image_slots_from_text(message):
        return True
    explicit_runtime_image_request = any(
        token in text
        for token in (
            "image input",
            "input image",
            "reference image input",
            "optional reference image",
            "runtime image",
            "attach an image",
            "attach a picture",
        )
    )
    if capability.get("id") == "reference_style_preset":
        return explicit_runtime_image_request
    if capability_image_slots(capability):
        return True
    if wants_face_body_slots(message):
        return True
    has_reference = _has_image_reference(message, attachments)
    if not has_reference:
        return False
    return True


def _workflow_runtime_image_slots(workflow: GraphWorkflow | None) -> List[Dict[str, Any]]:
    if not workflow:
        return []
    nodes_by_id = {node.id: node for node in workflow.nodes}
    model_node_ids = {
        node.id
        for node in workflow.nodes
        if node.type.startswith("model.kie.") or node.type.startswith("model.openai.") or node.type == "preset.render"
    }
    slots: List[Dict[str, Any]] = []
    seen_keys: set[str] = set()
    for edge in workflow.edges:
        source = nodes_by_id.get(edge.source)
        if not source or source.type != "media.load_image" or edge.target not in model_node_ids:
            continue
        metadata = source.metadata if isinstance(source.metadata, dict) else {}
        ui = metadata.get("ui") if isinstance(metadata.get("ui"), dict) else {}
        label = str(ui.get("customTitle") or source.fields.get("title") or source.id or "Reference Image").strip()
        key = _slug(label, _slug(source.id, "reference_image"))
        if key in seen_keys:
            continue
        seen_keys.add(key)
        slots.append(
            {
                "key": key,
                "label": label,
                "max_files": 1,
                "help_text": f"Attach the {label} image for this preset.",
                "required": True,
            }
        )
    return slots


def _image_slot_required(message: str) -> bool:
    capability = match_preset_capability(message, [])
    if capability.get("id") == "reference_style_preset":
        return False
    slots = capability_image_slots(capability)
    if slots and capability.get("id") != "reference_style_preset":
        return any(bool(slot.get("required")) for slot in slots)
    text = str(message or "").lower()
    if "optional" in text:
        return False
    return _has_image_reference(message, [])


def _preset_title(message: str, attachments: List[Dict[str, Any]] | None = None) -> str:
    attachments = attachments or []
    capability = match_preset_capability(message, attachments)
    if capability.get("id") != "reference_style_preset" and capability.get("title"):
        return str(capability.get("title"))
    return _title_from_message(message, "Assistant media preset")


def _preset_prompt_template(
    message: str,
    text_fields: List[Dict[str, Any]],
    *,
    include_image_slot: bool,
    image_slots: List[Dict[str, Any]] | None = None,
    attachments: List[Dict[str, Any]] | None = None,
    style_brief: Dict[str, Any] | None = None,
) -> str:
    attachments = attachments or []
    capability = match_preset_capability(message, attachments)
    capability_field_keys = [str(field.get("key") or "") for field in capability_fields(capability)]
    text_field_keys = [str(field.get("key") or "") for field in text_fields]
    parsed_brief = parse_reference_style_brief(style_brief)
    if parsed_brief and has_concrete_style_traits(parsed_brief):
        slots = image_slots if include_image_slot and image_slots is not None else capability_image_slots(capability) if include_image_slot else []
        compiled = compile_reference_style_prompt(
            parsed_brief,
            fields=text_fields,
            image_slots=slots,
            saved_template=True,
        )
        if compiled:
            return compiled
    use_capability_template = capability.get("id") != "reference_style_preset" or (
        include_image_slot and bool(attachments) and bool(capability_image_slots(capability))
    )
    if capability.get("id") == "reference_style_preset" and capability_field_keys != text_field_keys:
        use_capability_template = False
    if use_capability_template and capability_uses_prompt_template(capability):
        prompt = str(capability.get("save_prompt_template") or "")
        if include_image_slot and not capability_image_slots(capability):
            prompt += "\nUse [[reference_image]] as the visual reference."
        return prompt
    prompt_lines = ["Create a polished media output using these fields:"]
    prompt_lines.extend(f"- {field['label']}: {{{{{field['key']}}}}}" for field in text_fields)
    prompt_template = "\n".join(prompt_lines)
    if include_image_slot:
        slots = image_slots if image_slots is not None else capability_image_slots(capability) if capability.get("id") != "reference_style_preset" or attachments else []
        if slots:
            for slot in slots:
                slot_key = str(slot.get("key") or "").strip()
                slot_label = str(slot.get("label") or slot_key or "Reference Image").strip()
                if slot_key:
                    prompt_template += f"\nUse [[{slot_key}]] as {slot_label}."
        else:
            prompt_template += "\nUse [[reference_image]] as the visual reference."
    return prompt_template


def _sandbox_prompt_from_workflow(workflow: GraphWorkflow | None, message: str = "", image_slots: List[Dict[str, Any]] | None = None) -> str:
    if not workflow:
        return ""
    capability = match_preset_capability(message, [])
    slots = image_slots if image_slots is not None else capability_image_slots(capability)
    slot_keys = [str(slot.get("key") or "").strip() for slot in slots if str(slot.get("key") or "").strip()]
    slot_labels = {str(slot.get("key") or "").strip(): str(slot.get("label") or slot.get("key") or "Reference Image") for slot in slots}
    field_keys = [str(field.get("key") or "").strip() for field in capability_fields(capability) if str(field.get("key") or "").strip()]
    for field in _explicit_preset_fields(message):
        field_key = str(field.get("key") or "").strip()
        if field_key and field_key not in field_keys:
            field_keys.append(field_key)
    workflow_fields = _workflow_prompt_text_fields(workflow)
    field_labels = {str(field.get("key") or ""): str(field.get("label") or field.get("key") or "") for field in workflow_fields}
    for field in workflow_fields:
        field_key = str(field.get("key") or "").strip()
        if field_key and field_key not in field_keys:
            field_keys.append(field_key)
    if wants_year_field(message) and "year" not in field_keys:
        field_keys.append("year")
    for node in workflow.nodes:
        metadata = node.metadata if isinstance(node.metadata, dict) else {}
        ui = metadata.get("ui") if isinstance(metadata.get("ui"), dict) else {}
        title = str(ui.get("customTitle") or "")
        if node.type == "prompt.text" and title.lower() == "draft preset prompt":
            prompt = str((node.fields or {}).get("text") or "").strip()
            if len(slot_keys) >= 1:
                prompt = re.sub(r"\bimage reference 1\b", f"[[{slot_keys[0]}]]", prompt, flags=re.IGNORECASE)
            if len(slot_keys) >= 2:
                prompt = re.sub(r"\bimage reference 2\b", f"[[{slot_keys[1]}]]", prompt, flags=re.IGNORECASE)
            if "year" in field_keys:
                prompt = re.sub(r"\b(19\d{2}|20\d{2})\b", "{{year}}", prompt)
            for field_key in field_keys:
                label = field_labels.get(field_key) or _label_from_field_key(field_key)
                if not label:
                    continue
                prompt = re.sub(
                    rf"\bUse\s+[^.;\n]+?\s+as\s+the\s+{re.escape(label)}(?=\s+to\b|[.,;]|$)",
                    f"Use {{{{{field_key}}}}} as the {label}",
                    prompt,
                    count=1,
                    flags=re.IGNORECASE,
                )
            if "personal_reference" in slot_keys:
                prompt = re.sub(r"\bpersonal reference image\b", "[[personal_reference]]", prompt, flags=re.IGNORECASE)
            missing_slot_lines = [
                f"Use [[{slot_key}]] as the {slot_labels.get(slot_key, slot_key)} input."
                for slot_key in slot_keys
                if f"[[{slot_key}]]" not in prompt
            ]
            if missing_slot_lines:
                prompt = "\n".join([*missing_slot_lines, prompt])
            return prompt
    return ""


def _label_from_field_key(field_key: str) -> str:
    return re.sub(r"\s+", " ", str(field_key or "").replace("_", " ")).strip().title()


def _workflow_prompt_text_fields(workflow: GraphWorkflow | None) -> List[Dict[str, Any]]:
    if not workflow:
        return []
    prompt = ""
    for node in workflow.nodes:
        metadata = node.metadata if isinstance(node.metadata, dict) else {}
        ui = metadata.get("ui") if isinstance(metadata.get("ui"), dict) else {}
        title = str(ui.get("customTitle") or "")
        if node.type == "prompt.text" and title.lower() == "draft preset prompt":
            prompt = str((node.fields or {}).get("text") or "").strip()
            break
    if not prompt:
        return []
    fields: List[Dict[str, Any]] = []
    seen: set[str] = set()
    patterns = (
        r"\bSet\s+the\s+(.{2,48}?)\s+as\s+",
        r"\bUse\s+.{2,140}?\s+as\s+the\s+(.{2,48}?)(?:\s+to\b|[.,;]|$)",
    )
    for pattern in patterns:
        for match in re.finditer(pattern, prompt, flags=re.IGNORECASE):
            raw = match.group(0)
            if "[[" in raw or "{{" in raw:
                continue
            label = re.sub(r"\s+", " ", match.group(1)).strip(" .,:;`\"'")
            if not label or label.lower() in {"field", "fields", "identity and likeness source", "visual subject and control source"}:
                continue
            key = _slug(label, "field")
            if not key or key in seen:
                continue
            seen.add(key)
            fields.append(
                {
                    "key": key,
                    "label": label,
                    "placeholder": f"{label}.",
                    "default_value": "",
                    "required": len(fields) == 0,
                }
            )
            if len(fields) >= 4:
                return fields
    return fields


def _saved_prompt_field_instruction(field: Dict[str, Any]) -> str:
    field_key = str(field.get("key") or "").strip()
    if not field_key:
        return ""
    field_label = re.sub(r"\s+", " ", str(field.get("label") or _label_from_field_key(field_key))).strip()
    field_context = f" as the {field_label}" if field_label else ""
    field_text = " ".join(
        str(field.get(key) or "")
        for key in ("key", "label", "placeholder", "help_text", "purpose")
    ).lower()
    token = f"{{{{{field_key}}}}}"
    if any(
        term in field_text
        for term in (
            "ensemble",
            "lineup",
            "cast",
            "supporting characters",
            "companion characters",
            "character theme",
            "fandom theme",
        )
    ):
        return (
            f"Use {token}{field_context} to define an original non-franchise fan world, genre cues, invented supporting "
            "characters, creatures, collectibles, or secondary subjects that shape the scene around the main focus. "
            "Do not use recognizable existing character names, costumes, silhouettes, powers, hairstyles, logos, or franchise titles."
        )
    if any(term in field_text for term in ("main subject", "lead subject", "central subject", "primary subject")):
        return f"Use {token}{field_context} to define the central person, character, object, or idea the composition is built around."
    if any(term in field_text for term in ("headline", "title", "slogan", "tagline", "message", "wording")):
        return f"Use {token}{field_context} as short visible copy that fits the typography hierarchy and graphic layout."
    if any(term in field_text for term in ("vehicle", "car", "model")):
        return f"Use {token}{field_context} to define the vehicle type, body shape, period, paint character, and road presence."
    if any(term in field_text for term in ("location", "destination", "landmark", "place", "route", "scene theme")):
        return f"Use {token}{field_context} to define the destination, landmarks, architecture, landscape, atmosphere, and supporting travel details."
    if any(term in field_text for term in ("pet", "animal", "companion", "creature")):
        return f"Use {token}{field_context} to define the animal subject, species, personality, expression, and scale relationship for the scene."
    if any(term in field_text for term in ("background", "backdrop", "environment", "setting", "room", "world")):
        return f"Use {token}{field_context} to define the environment, backdrop, atmosphere, and supporting scene details."
    return f"Use {token}{field_context} as a concise, style-specific creative direction."


def _latest_run_thumbnail(run_id: str | None) -> tuple[str | None, str | None]:
    resolved_run_id = str(run_id or "").strip()
    if not resolved_run_id:
        return None, None
    for artifact in store.list_graph_artifacts_for_run(resolved_run_id):
        media_type = str(artifact.get("media_type") or artifact.get("kind") or "").lower()
        if media_type and media_type != "image":
            continue
        asset = store.get_asset(str(artifact.get("asset_id") or "")) if artifact.get("asset_id") else None
        if not asset:
            continue
        thumb_path = str(asset.get("hero_thumb_path") or asset.get("hero_web_path") or asset.get("hero_poster_path") or asset.get("hero_original_path") or "").strip()
        if thumb_path:
            return thumb_path, f"/api/control/files/{thumb_path}"
    return None, None


def _validated_preset_for_model(
    message: str,
    model_key: str,
    *,
    include_image_slot: bool,
    attachments: List[Dict[str, Any]],
    workflow: GraphWorkflow | None = None,
    run_id: str | None = None,
    style_brief: Dict[str, Any] | None = None,
) -> PresetUpsertRequest | None:
    parsed_brief = parse_reference_style_brief(style_brief)
    explicit_title = _explicit_title_from_message(message)
    raw_title = explicit_title or (parsed_brief.preset_direction.title if parsed_brief and parsed_brief.preset_direction.title else _preset_title(message, attachments))
    title = _sanitize_preset_title(raw_title, "Assistant media preset")
    key = _unique_preset_key(f"assistant_{_slug(title, 'media_preset')}")
    capability = match_preset_capability(message, attachments)
    explicit_slots = infer_runtime_image_slots_from_text(message)
    capability_slots = capability_image_slots(capability)
    workflow_slots = _workflow_runtime_image_slots(workflow)
    if workflow_slots:
        include_image_slot = True
    text_fields = _preset_text_fields(
        message,
        attachments,
        style_brief=style_brief,
        has_runtime_image_slot=bool(workflow_slots) or include_image_slot,
    )
    workflow_text_fields = _workflow_prompt_text_fields(workflow)
    if workflow_text_fields:
        text_fields = workflow_text_fields
    use_capability_slots = include_image_slot and bool(capability_slots) and not (capability.get("id") == "reference_style_preset" and not attachments)
    if explicit_slots:
        image_slots = [
            {
                "key": str(slot.get("key") or "").strip(),
                "label": str(slot.get("label") or slot.get("key") or "").strip(),
                "max_files": int(slot.get("max_files") or 1),
                "help_text": str(slot.get("help_text") or f"{slot.get('label') or slot.get('key')} image input for this preset.").strip(),
                "required": bool(slot.get("required", True)),
            }
            for slot in explicit_slots
            if str(slot.get("key") or "").strip()
        ]
        image_required = any(bool(slot.get("required")) for slot in image_slots)
    elif use_capability_slots:
        image_slots = capability_slots
        image_required = any(bool(slot.get("required")) for slot in image_slots)
    elif workflow_slots:
        image_slots = workflow_slots
        image_required = any(bool(slot.get("required")) for slot in image_slots)
    else:
        image_required = include_image_slot and _image_slot_required(message)
        image_slots = (
            [
                {
                    "key": "reference_image",
                    "label": "Reference Image",
                    "max_files": 1,
                    "help_text": "Optional visual direction for this preset.",
                    "required": image_required,
                }
            ]
            if include_image_slot
            else []
        )
    prompt_template = _sandbox_prompt_from_workflow(workflow, message, image_slots=image_slots) or _preset_prompt_template(
        message,
        text_fields,
        include_image_slot=include_image_slot,
        image_slots=image_slots,
        attachments=attachments,
        style_brief=style_brief,
    )
    for field in text_fields:
        field_key = str(field.get("key") or "").strip()
        if field_key and f"{{{{{field_key}}}}}" not in prompt_template:
            instruction = _saved_prompt_field_instruction(field)
            if instruction:
                prompt_template = f"{prompt_template}\n{instruction}"
    prompt_template = _sanitize_saved_prompt_template(prompt_template)
    thumbnail_path, thumbnail_url = _latest_run_thumbnail(run_id)
    draft = PresetUpsertRequest(
        key=key,
        label=title,
        description="Assistant draft for review before saving.",
        status="active",
        model_key=model_key,
        applies_to_models=[model_key],
        prompt_template=prompt_template,
        requires_image=image_required,
        input_schema_json=text_fields,
        input_slots_json=image_slots,
        thumbnail_path=thumbnail_path,
        thumbnail_url=thumbnail_url,
        notes="Review this assistant draft before saving. It has not been saved.",
        source_kind="custom",
        priority=0,
    )
    try:
        validated = validate_preset_payload(draft)
    except ServiceError:
        return None
    return PresetUpsertRequest(**validated)


def draft_media_preset(
    message: str,
    attachments: List[Dict[str, Any]],
    *,
    workflow: GraphWorkflow | None = None,
    run_id: str | None = None,
    style_brief: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    include_image_slot = _should_include_preset_image_slot(message, attachments)
    for model in kie_adapter.list_models():
        model_key = str(model.get("key") or "").strip()
        if not model_key:
            continue
        draft = _validated_preset_for_model(
            message,
            model_key,
            include_image_slot=include_image_slot,
            attachments=attachments,
            workflow=workflow,
            run_id=run_id,
            style_brief=style_brief,
        )
        if draft:
            return {
                "draft": draft,
                "validation_warnings": [],
                "media_summary": build_attachment_summary(attachments),
            }
    raise ServiceError("No compatible image model is available for an assistant Media Preset draft.")


def reconcile_media_preset_draft_for_save(
    draft: PresetUpsertRequest,
    message: str,
    attachments: List[Dict[str, Any]],
    *,
    workflow: GraphWorkflow | None = None,
    run_id: str | None = None,
    style_brief: Dict[str, Any] | None = None,
) -> PresetUpsertRequest:
    """Keep the approved test workflow authoritative over stale frontend draft state."""
    if not workflow:
        return draft
    workflow_prompt = _sandbox_prompt_from_workflow(workflow, message, image_slots=draft.input_slots_json)
    workflow_fields = _workflow_prompt_text_fields(workflow)
    workflow_slots = _workflow_runtime_image_slots(workflow)
    if not workflow_prompt and not workflow_fields and not workflow_slots:
        return draft
    rebuilt = _validated_preset_for_model(
        message,
        draft.model_key,
        include_image_slot=bool(draft.requires_image or workflow_slots or draft.input_slots_json),
        attachments=attachments,
        workflow=workflow,
        run_id=run_id,
        style_brief=style_brief,
    )
    if rebuilt is None:
        return draft
    reconciled = rebuilt.model_copy(
        update={
            "key": draft.key,
            "label": draft.label,
            "description": draft.description,
            "status": draft.status,
            "source_kind": draft.source_kind,
            "priority": draft.priority,
            "notes": draft.notes,
        }
    )
    validated = validate_preset_payload(reconciled)
    return PresetUpsertRequest(**validated)
