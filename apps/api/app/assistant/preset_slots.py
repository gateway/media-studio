from __future__ import annotations

import re
from typing import Any, Dict, Optional

from ..schemas import PresetUpsertRequest


_PRESET_LANES = {"text_to_image", "image_to_image"}
_WORD_RE = re.compile(r"[a-z0-9]+")


def _normalized_phrase(value: Any) -> str:
    return " ".join(_WORD_RE.findall(str(value or "").lower()))


def validate_assistant_preset_slots(
    draft: PresetUpsertRequest,
    *,
    user_text: str = "",
    current_draft: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    lane = str(draft.rules_json.get("preset_lane") or "").strip()
    slots = draft.input_slots_json
    task_modes = {str(value) for value in draft.applies_to_task_modes}
    input_patterns = {str(value) for value in draft.applies_to_input_patterns}
    runtime_roles = draft.rules_json.get("runtime_image_roles")
    current_rules = (
        current_draft.get("rules_json")
        if isinstance(current_draft, dict) and isinstance(current_draft.get("rules_json"), dict)
        else {}
    )
    current_runtime_roles = current_rules.get("runtime_image_roles")
    user_phrase_haystack = f" {_normalized_phrase(user_text)} "
    issues: list[str] = []

    if lane not in _PRESET_LANES:
        issues.append("Choose one preset lane: text_to_image or image_to_image.")
    elif lane == "text_to_image":
        if slots or draft.requires_image or runtime_roles:
            issues.append("Text-to-image presets cannot define runtime image slots.")
        if "text_to_image" not in task_modes or "image_edit" in task_modes:
            issues.append("Text-to-image presets must use only the text_to_image task mode.")
        if input_patterns != {"prompt_only"}:
            issues.append("Text-to-image presets must use the prompt_only input pattern.")
    else:
        if not slots or not draft.requires_image or not any(slot.get("required") for slot in slots):
            issues.append("Image-to-image presets need a required runtime image slot.")
        if "image_edit" not in task_modes or "text_to_image" in task_modes:
            issues.append("Image-to-image presets must use only the image_edit task mode.")
        if not input_patterns.intersection({"image_edit", "single_image"}) or "prompt_only" in input_patterns:
            issues.append(
                "Image-to-image presets must use a catalog-supported image input pattern."
            )
        slot_keys = {str(slot.get("key") or "").strip() for slot in slots}
        if not isinstance(runtime_roles, dict) or set(runtime_roles) != slot_keys:
            issues.append(
                "Add rules_json.runtime_image_roles keyed by slot key; each value needs "
                "role and exact user_evidence."
            )
        else:
            for slot in slots:
                key = str(slot.get("key") or "").strip()
                role = runtime_roles.get(key)
                if not isinstance(role, dict) or not str(role.get("role") or "").strip():
                    issues.append(
                        f'rules_json.runtime_image_roles["{key}"] needs a named role.'
                    )
                    continue
                evidence = _normalized_phrase(role.get("user_evidence"))
                role_was_approved = (
                    isinstance(current_runtime_roles, dict)
                    and current_runtime_roles.get(key) == role
                )
                if (
                    not role_was_approved
                    and (not evidence or f" {evidence} " not in user_phrase_haystack)
                ):
                    issues.append(
                        f'rules_json.runtime_image_roles["{key}"] needs exact '
                        "user_evidence from the user request."
                    )

    if issues:
        raise ValueError(" ".join(issues))
    return {
        "lane": lane,
        "runtime_slot_count": len(slots),
        "input_patterns": sorted(input_patterns),
        "style_reference_role": "analysis_only",
        "runtime_roles": {
            key: value.get("role")
            for key, value in (runtime_roles.items() if isinstance(runtime_roles, dict) else [])
            if isinstance(value, dict)
        },
    }
