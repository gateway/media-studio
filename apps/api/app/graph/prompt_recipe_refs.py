from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Callable, Iterable


@dataclass(frozen=True)
class PromptRecipeImageRole:
    port_id: str
    label: str
    prompt_role: str
    model_role: str
    max_refs: int | None = 1


PROMPT_RECIPE_TYPED_IMAGE_ROLES: tuple[PromptRecipeImageRole, ...] = (
    PromptRecipeImageRole(
        port_id="character_ref",
        label="Character Ref",
        prompt_role="Character Sheet or primary character/person reference",
        model_role="identity, face, body, wardrobe, and character continuity",
    ),
    PromptRecipeImageRole(
        port_id="environment_ref",
        label="Environment Ref",
        prompt_role="Environment Sheet or location reference",
        model_role="location geography, lighting, landmarks, entrances/exits, set dressing, and spatial continuity",
    ),
    PromptRecipeImageRole(
        port_id="prop_refs",
        label="Prop Refs",
        prompt_role="Prop Sheet or key object references",
        model_role="important objects, food, tools, weapons, symbols, product details, and prop continuity",
        max_refs=None,
    ),
    PromptRecipeImageRole(
        port_id="style_ref",
        label="Style Ref",
        prompt_role="Style reference",
        model_role="visual treatment, layout language, lighting mood, material style, palette, and cinematic finish",
    ),
    PromptRecipeImageRole(
        port_id="storyboard_ref",
        label="Storyboard Ref",
        prompt_role="Previous storyboard or storyboard sheet reference",
        model_role="prior panel order, final visible state, layout geometry, metadata geometry, and visual handoff continuity",
    ),
    PromptRecipeImageRole(
        port_id="additional_refs",
        label="Additional Refs",
        prompt_role="Additional supporting references",
        model_role="supporting visual details that must not override character, environment, or prop roles",
        max_refs=None,
    ),
)

PROMPT_RECIPE_GENERIC_IMAGE_PORT = "image_refs"
PROMPT_RECIPE_IMAGE_PORTS: tuple[str, ...] = (
    *(role.port_id for role in PROMPT_RECIPE_TYPED_IMAGE_ROLES),
    PROMPT_RECIPE_GENERIC_IMAGE_PORT,
)
PROMPT_RECIPE_FIELD_INPUT_KINDS = {"none", "text", "image"}
PROMPT_RECIPE_FIELD_REFERENCE_ROLES = {
    "none",
    "character",
    "environment",
    "prop",
    "style",
    "storyboard",
    "additional",
    "generic",
}
PROMPT_RECIPE_FIELD_REFERENCE_ROLE_PORT_IDS = {
    "character": "character_ref",
    "environment": "environment_ref",
    "prop": "prop_refs",
    "style": "style_ref",
    "storyboard": "storyboard_ref",
    "additional": "additional_refs",
    "generic": PROMPT_RECIPE_GENERIC_IMAGE_PORT,
}
PROMPT_RECIPE_DEFAULT_TEXT_INPUT_KEYS = {
    "user_prompt",
    "source_prompt",
    "previous_output",
    "previous_storyboard_prompt",
    "continuation_brief",
}


def prompt_recipe_field_input_kind(item: Mapping[str, Any], *, key: str | None = None) -> str:
    raw_key = str(key if key is not None else item.get("key") or "").strip()
    raw_kind = str(item.get("input_kind") or "").strip().lower()
    if raw_kind in PROMPT_RECIPE_FIELD_INPUT_KINDS:
        return raw_kind
    if raw_key in PROMPT_RECIPE_DEFAULT_TEXT_INPUT_KEYS:
        return "text"
    return "none"


def prompt_recipe_field_reference_role(item: Mapping[str, Any], *, key: str | None = None) -> str:
    if prompt_recipe_field_input_kind(item, key=key) != "image":
        return "none"
    raw_role = str(item.get("reference_role") or item.get("referenceRole") or "").strip().lower()
    if raw_role in PROMPT_RECIPE_FIELD_REFERENCE_ROLES:
        return raw_role
    return "none"


def prompt_recipe_reference_role_port_id(reference_role: str) -> str | None:
    return PROMPT_RECIPE_FIELD_REFERENCE_ROLE_PORT_IDS.get(str(reference_role or "").strip().lower())


def _prompt_recipe_field_items(recipe: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    raw_items: list[Any] = []
    raw_items.extend(recipe.get("input_variables_json") or recipe.get("input_variables") or [])
    raw_items.extend(recipe.get("custom_fields_json") or recipe.get("custom_fields") or [])
    return [item for item in raw_items if isinstance(item, Mapping)]


def prompt_recipe_field_input_port_ids(recipe: Mapping[str, Any], *, input_kind: str | None = None) -> tuple[str, ...]:
    port_ids: list[str] = []
    seen: set[str] = set()
    normalized_kind = str(input_kind or "").strip().lower()
    for item in _prompt_recipe_field_items(recipe):
        key = str(item.get("key") or "").strip()
        if not key or key in seen:
            continue
        kind = prompt_recipe_field_input_kind(item, key=key)
        if normalized_kind and kind != normalized_kind:
            continue
        if not normalized_kind and kind == "none":
            continue
        seen.add(key)
        port_ids.append(key)
    return tuple(port_ids)


def prompt_recipe_field_image_port_ids(recipe: Mapping[str, Any]) -> tuple[str, ...]:
    return prompt_recipe_field_input_port_ids(recipe, input_kind="image")


def prompt_recipe_typed_image_port_ids() -> tuple[str, ...]:
    return tuple(role.port_id for role in PROMPT_RECIPE_TYPED_IMAGE_ROLES)


def prompt_recipe_image_port_ids(*, include_generic: bool = True) -> tuple[str, ...]:
    if include_generic:
        return PROMPT_RECIPE_IMAGE_PORTS
    return prompt_recipe_typed_image_port_ids()


def prompt_recipe_reference_role_lines(connected_counts: Mapping[str, int]) -> list[str]:
    lines: list[str] = []
    index = 1
    for role in PROMPT_RECIPE_TYPED_IMAGE_ROLES:
        count = max(0, int(connected_counts.get(role.port_id) or 0))
        for offset in range(count):
            suffix = f" {offset + 1}" if count > 1 else ""
            lines.append(f"[image reference {index}] = {role.prompt_role}{suffix} (@image{index}). Use for {role.model_role}.")
            index += 1
    generic_count = max(0, int(connected_counts.get(PROMPT_RECIPE_GENERIC_IMAGE_PORT) or 0))
    for offset in range(generic_count):
        lines.append(
            f"[image reference {index}] = Generic image reference {offset + 1} (@image{index}). "
            "Use only as supporting visual context."
        )
        index += 1
    return lines


def prompt_recipe_reference_role_block(connected_counts: Mapping[str, int]) -> str:
    lines = prompt_recipe_reference_role_lines(connected_counts)
    return "\n".join(lines)


def prompt_recipe_reference_priority_rule(connected_counts: Mapping[str, int]) -> str:
    connected = {port_id for port_id, count in connected_counts.items() if int(count or 0) > 0}
    if not connected:
        return ""
    rules: list[str] = []
    if "character_ref" in connected:
        rules.append("Character identity, face, body, wardrobe, and character continuity come from the connected character reference.")
    if "environment_ref" in connected:
        rules.append("Environment geography, lighting, landmarks, entrances/exits, set dressing, and spatial continuity come from the connected environment reference only.")
    if "prop_refs" in connected:
        rules.append("Prop references control only the specific objects they depict and must not alter character identity or environment geography.")
    if "style_ref" in connected:
        rules.append("Style reference controls treatment and finish only; it must not override identity, environment geography, or prop facts.")
    if "storyboard_ref" in connected:
        rules.append("Storyboard reference controls prior panel order, final visible state, layout geometry, metadata geometry, and visual handoff continuity only.")
    if "additional_refs" in connected or PROMPT_RECIPE_GENERIC_IMAGE_PORT in connected:
        rules.append("Additional and generic references are supporting context only and must not override typed character, environment, prop, or style references.")
    return " ".join(rules)


def prompt_recipe_total_image_count(port_counts: Mapping[str, int], *, include_generic: bool = True) -> int:
    return sum(max(0, int(port_counts.get(port_id) or 0)) for port_id in prompt_recipe_image_port_ids(include_generic=include_generic))


def prompt_recipe_ordered_port_counts(
    *,
    port_ids: Iterable[str],
    count_for_port: Callable[[str], int],
) -> dict[str, int]:
    return {port_id: max(0, int(count_for_port(port_id) or 0)) for port_id in port_ids}
