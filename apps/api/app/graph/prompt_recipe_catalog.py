from __future__ import annotations

import sqlite3
from typing import Any, Dict, Iterable, List

from .. import store
from .schemas import GraphNodeField, GraphNodePort
from .prompt_recipe_refs import (
    PROMPT_RECIPE_DEFAULT_TEXT_INPUT_KEYS,
    PROMPT_RECIPE_FIELD_REFERENCE_ROLE_PORT_IDS,
    PROMPT_RECIPE_TYPED_IMAGE_ROLES,
    PROMPT_RECIPE_GENERIC_IMAGE_PORT,
    prompt_recipe_field_reference_role,
    prompt_recipe_field_input_kind,
    prompt_recipe_image_port_ids,
)


PROMPT_RECIPE_CATEGORY_ORDER = ("image", "video", "analysis", "utility")
PROMPT_RECIPE_TEXTAREA_KEYS = {
    "user_prompt",
    "source_prompt",
    "previous_output",
    "previous_storyboard_prompt",
    "continuation_brief",
    "style_direction",
    "continuity_notes",
    "handoff_goal",
}
PROMPT_RECIPE_INTERNAL_VARIABLES = {
    "image_analysis",
    "source_image_prompt",
    "reference_role_block",
    "reference_priority_rule",
    "background_mode_block",
}
PROMPT_RECIPE_TEXT_PORT_KEYS = PROMPT_RECIPE_DEFAULT_TEXT_INPUT_KEYS
PROMPT_RECIPE_FIELD_ORDER = {
    "user_prompt": 10,
    "source_prompt": 20,
    "previous_output": 30,
    "previous_storyboard_prompt": 35,
    "continuation_brief": 36,
    "style_direction": 40,
    "continuity_notes": 45,
    "handoff_goal": 46,
    "aspect_ratio": 50,
    "shot_count": 60,
    "panel_count": 61,
    "segment_number": 62,
    "total_segments": 63,
    "target_duration_seconds": 64,
    "dialogue_mode": 65,
    "duration_seconds": 70,
    "output_format": 80,
}


def slug(value: str) -> str:
    return "".join(character if character.isalnum() else "_" for character in value.lower()).strip("_")


def title_from_key(value: str) -> str:
    return " ".join(part.capitalize() for part in value.replace("_", " ").replace("-", " ").split())


def _category_sort_key(value: str) -> tuple[int, str]:
    if value in PROMPT_RECIPE_CATEGORY_ORDER:
        return PROMPT_RECIPE_CATEGORY_ORDER.index(value), value
    return len(PROMPT_RECIPE_CATEGORY_ORDER), value


def _output_format_label(value: str) -> str:
    return value.replace("_", " ").replace("-", " ").strip()


def _display_help_text(*, required: bool, detail: str) -> str:
    prefix = "Required." if required else "Optional."
    return f"{prefix} {detail}".strip() if detail else prefix


def _image_input_summary(image_input: Dict[str, Any]) -> str:
    if not bool(image_input.get("enabled")):
        return "Images: none"
    max_files = int(image_input.get("max_files") or 0)
    summary = f"Images: {'required' if bool(image_input.get('required')) else 'optional'}"
    if max_files:
        summary = f"{summary}, up to {max_files}"
    return summary


def _normalized_image_reference_roles(image_input: Dict[str, Any]) -> List[str]:
    raw_roles = image_input.get("reference_roles") or image_input.get("referenceRoles") or []
    if isinstance(raw_roles, str):
        values = [item.strip() for item in raw_roles.split(",")]
    elif isinstance(raw_roles, list):
        values = [str(item).strip() for item in raw_roles]
    else:
        values = []
    roles: List[str] = []
    seen: set[str] = set()
    for value in values:
        role = value.lower()
        if role == "none" or role not in PROMPT_RECIPE_FIELD_REFERENCE_ROLE_PORT_IDS or role in seen:
            continue
        seen.add(role)
        roles.append(role)
    return roles


def _output_contract_summary(output_format: str) -> str:
    if output_format in {"structured_shot_sequence", "json_prompt_batch", "image_analysis"}:
        return "Outputs: Text is a readable summary; Result is canonical JSON."
    if output_format == "prompt_list":
        return "Outputs: Text is a prompt list; Result is canonical JSON."
    return "Outputs: Text is the final prompt; Result is canonical JSON."


def _selection_summary(*, label: str, description: str, category: str, status: str, output_format: str, image_input: Dict[str, Any]) -> Dict[str, Any]:
    details: List[str] = []
    if status != "active":
        details.append(f"Status: {status}")
    details.append(_image_input_summary(image_input))
    details.append(_output_contract_summary(output_format))
    details.append("Open Prompt Recipes to inspect the full system prompt.")
    return {
        "title": label,
        "subtitle": f"{title_from_key(category)} • {_output_format_label(output_format)}",
        "description": description or "Saved Prompt Recipe",
        "details": details,
    }


def prompt_recipe_catalog(*, status: str = "all") -> List[Dict[str, Any]]:
    catalog: List[Dict[str, Any]] = []
    try:
        recipes = store.list_prompt_recipes(status=status)
    except sqlite3.OperationalError as exc:
        if "no such table: prompt_recipes" not in str(exc):
            raise
        recipes = []
    for recipe in recipes:
        image_input = recipe.get("image_input_json") or {}
        category = str(recipe.get("category") or "utility").strip() or "utility"
        status_value = str(recipe.get("status") or "inactive")
        label = str(recipe.get("label") or recipe.get("key") or recipe.get("recipe_id") or "Prompt Recipe")
        output_format = str(recipe.get("output_format") or "single_prompt")
        input_variables = []
        for item in recipe.get("input_variables_json") or []:
            key = str(item.get("key") or "").strip()
            if not key or not bool(item.get("enabled", True)):
                continue
            description = str(item.get("description") or "").strip()
            input_variables.append(
                {
                    "key": key,
                    "token": str(item.get("token") or f"{{{{{key}}}}}"),
                    "label": str(item.get("label") or title_from_key(key)),
                    "required": bool(item.get("required")),
                    "default_value": item.get("default_value"),
                    "description": description,
                    "input_kind": prompt_recipe_field_input_kind(item, key=key),
                    "reference_role": prompt_recipe_field_reference_role(item, key=key),
                    "display_placeholder": description,
                    "display_help_text": _display_help_text(required=bool(item.get("required")), detail=description),
                }
            )
        custom_fields = []
        for item in recipe.get("custom_fields_json") or []:
            key = str(item.get("key") or "").strip()
            if not key:
                continue
            field_help_text = str(item.get("help_text") or "").strip()
            field_placeholder = str(item.get("placeholder") or "").strip()
            custom_fields.append(
                {
                    "key": key,
                    "label": str(item.get("label") or title_from_key(key)),
                    "type": str(item.get("type") or "text"),
                    "required": bool(item.get("required")),
                    "default_value": item.get("default_value"),
                    "placeholder": field_placeholder,
                    "options": list(item.get("options") or []),
                    "help_text": field_help_text,
                    "advanced": bool(item.get("advanced")),
                    "input_kind": prompt_recipe_field_input_kind(item, key=key),
                    "reference_role": prompt_recipe_field_reference_role(item, key=key),
                    "display_placeholder": field_placeholder or field_help_text,
                    "display_help_text": _display_help_text(required=bool(item.get("required")), detail=field_help_text),
                }
            )
        description = str(recipe.get("description") or "").strip()
        catalog.append(
            {
                "recipe_id": str(recipe.get("recipe_id") or ""),
                "key": str(recipe.get("key") or recipe.get("recipe_id") or ""),
                "label": label,
                "label_with_category": f"{title_from_key(category)} • {label}",
                "description": description,
                "category": category,
                "category_label": title_from_key(category),
                "status": status_value,
                "output_format": output_format,
                "output_format_label": _output_format_label(output_format),
                "image_input": {
                    "enabled": bool(image_input.get("enabled")),
                    "required": bool(image_input.get("required")),
                    "mode": str(image_input.get("mode") or "none").strip() or "none",
                    "analysis_variable": str(image_input.get("analysis_variable") or "image_analysis").strip() or "image_analysis",
                    "max_files": max(0, int(image_input.get("max_files") or 0)),
                    "reference_roles": _normalized_image_reference_roles(image_input),
                },
                "default_options": dict(recipe.get("default_options_json") or {}),
                "input_variables": input_variables,
                "custom_fields": custom_fields,
                "selection_summary": _selection_summary(
                    label=label,
                    description=description,
                    category=category,
                    status=status_value,
                    output_format=output_format,
                    image_input=image_input,
                ),
            }
        )
    catalog.sort(
        key=lambda item: (
            _category_sort_key(str(item.get("category") or "")),
            str(item.get("label") or "").lower(),
            str(item.get("recipe_id") or "").lower(),
        )
    )
    return catalog


def prompt_recipe_category_options(catalog: Iterable[Dict[str, Any]]) -> List[Dict[str, str]]:
    categories = sorted({str(item.get("category") or "utility") for item in catalog}, key=_category_sort_key)
    return [{"label": "All Categories", "value": "all"}] + [
        {"label": title_from_key(category), "value": category}
        for category in categories
    ]


def prompt_recipe_picker_options(catalog: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    options: List[Dict[str, Any]] = []
    for recipe in catalog:
        options.append(
            {
                "value": str(recipe["recipe_id"]),
                "label": str(recipe["label"]),
                "label_with_category": str(recipe.get("label_with_category") or recipe["label"]),
                "category": str(recipe["category"]),
                "description": str(recipe["description"]),
                "output_format": str(recipe["output_format"]),
                "image_mode": str((recipe.get("image_input") or {}).get("mode") or "none"),
                "image_enabled": bool((recipe.get("image_input") or {}).get("enabled")),
                "max_files": int((recipe.get("image_input") or {}).get("max_files") or 0),
                "selection_summary": dict(recipe.get("selection_summary") or {}),
            }
        )
    return options


def prompt_recipe_search_aliases(catalog: Iterable[Dict[str, Any]]) -> List[str]:
    aliases: List[str] = ["prompt recipe", "recipe", "director", "prompt builder"]
    for recipe in catalog:
        aliases.extend(
            [
                str(recipe.get("label") or ""),
                str(recipe.get("key") or ""),
                str(recipe.get("category") or ""),
                str(recipe.get("output_format") or ""),
            ]
        )
        if bool((recipe.get("image_input") or {}).get("enabled")):
            aliases.extend(["image prompt", "vision"])
        if str(recipe.get("category") or "") == "video":
            aliases.extend(["video prompt", "multi shot"])
        if str(recipe.get("category") or "") == "analysis":
            aliases.extend(["analysis", "describe image"])
    deduped: List[str] = []
    seen: set[str] = set()
    for alias in aliases:
        normalized = alias.strip().lower()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        deduped.append(alias)
    return deduped


def prompt_recipe_input_ports(catalog: Iterable[Dict[str, Any]]) -> List[GraphNodePort]:
    catalog_items = list(catalog)
    field_ports: Dict[str, Dict[str, Any]] = {}
    fixed_image_port_ids = set(prompt_recipe_image_port_ids())
    image_recipe_ids: List[str] = []
    image_role_recipe_ids: Dict[str, set[str]] = {}
    generic_image_recipe_ids: List[str] = []
    max_image_files = 0
    for recipe in catalog_items:
        recipe_id = str(recipe["recipe_id"])
        for item in [*(recipe.get("input_variables") or []), *(recipe.get("custom_fields") or [])]:
            key = str(item.get("key") or "").strip()
            if not key or key in PROMPT_RECIPE_INTERNAL_VARIABLES or key in fixed_image_port_ids:
                continue
            input_kind = prompt_recipe_field_input_kind(item, key=key)
            if input_kind == "none":
                continue
            entry = field_ports.setdefault(
                key,
                {
                    "key": key,
                    "label": str(item.get("label") or title_from_key(key)),
                    "type": input_kind,
                    "recipe_ids": [],
                },
            )
            if entry["type"] != input_kind and input_kind == "image":
                entry["type"] = "image"
            entry["recipe_ids"].append(recipe_id)
        if bool((recipe.get("image_input") or {}).get("enabled")):
            configured_roles = _normalized_image_reference_roles(recipe.get("image_input") or {})
            image_recipe_ids.append(recipe_id)
            max_image_files = max(max_image_files, int((recipe.get("image_input") or {}).get("max_files") or 0))
            if configured_roles:
                for role in configured_roles:
                    port_id = PROMPT_RECIPE_FIELD_REFERENCE_ROLE_PORT_IDS.get(role)
                    if port_id == PROMPT_RECIPE_GENERIC_IMAGE_PORT:
                        generic_image_recipe_ids.append(recipe_id)
                    elif port_id:
                        image_role_recipe_ids.setdefault(port_id, set()).add(recipe_id)
            else:
                generic_image_recipe_ids.append(recipe_id)

    ports: List[GraphNodePort] = []
    if not catalog_items:
        for key in ("user_prompt", "source_prompt", "previous_output", "previous_storyboard_prompt", "continuation_brief"):
            field_ports[key] = {"key": key, "label": title_from_key(key), "type": "text", "recipe_ids": []}
    for key, entry in sorted(
        field_ports.items(),
        key=lambda item: (PROMPT_RECIPE_FIELD_ORDER.get(item[0], 200), str(item[1].get("label") or "").lower()),
    ):
        recipe_ids = sorted({str(item) for item in entry.get("recipe_ids") or []})
        port_type = str(entry.get("type") or "text")
        ports.append(
            GraphNodePort(
                id=key,
                label=str(entry.get("label") or title_from_key(key)),
                type=port_type,
                required=False,
                max=1,
                accepts=[port_type],
                description=f"Optional upstream value for {title_from_key(key).lower()}.",
                visible_if={"field": "recipe_id", "in": recipe_ids} if recipe_ids else None,
            )
        )
    if image_recipe_ids or not catalog_items:
        for role in PROMPT_RECIPE_TYPED_IMAGE_ROLES:
            role_recipe_ids = sorted(image_role_recipe_ids.get(role.port_id) or [])
            if catalog_items and not role_recipe_ids:
                continue
            ports.append(
                GraphNodePort(
                    id=role.port_id,
                    label=role.label,
                    type="image",
                    array=role.max_refs is None or role.max_refs > 1,
                    required=False,
                    max=role.max_refs,
                    accepts=["image"],
                    description=f"Optional typed reference: {role.prompt_role}.",
                    visible_if={"field": "recipe_id", "in": role_recipe_ids} if role_recipe_ids else None,
                )
            )
        generic_recipe_ids = sorted(set(generic_image_recipe_ids or image_recipe_ids))
        ports.append(
            GraphNodePort(
                id=PROMPT_RECIPE_GENERIC_IMAGE_PORT,
                label="Image Refs",
                type="image",
                array=True,
                required=False,
                max=max_image_files or None,
                accepts=["image"],
                description="Ordered image references passed to the selected Prompt Recipe.",
                visible_if={"field": "recipe_id", "in": generic_recipe_ids} if generic_recipe_ids else None,
            )
        )
    return ports


def _field_type_for_variable(key: str) -> str:
    if key in PROMPT_RECIPE_TEXTAREA_KEYS:
        return "textarea"
    return "text"


def _field_type_for_custom(raw_type: str) -> str:
    normalized = raw_type.strip().lower()
    if normalized in {"textarea", "text"}:
        return normalized
    if normalized in {"select", "boolean", "number", "integer", "float"}:
        return "boolean" if normalized == "boolean" else "select" if normalized == "select" else normalized
    return "text"


def prompt_recipe_dynamic_fields(catalog: Iterable[Dict[str, Any]]) -> List[GraphNodeField]:
    merged: Dict[str, Dict[str, Any]] = {}
    for recipe in catalog:
        recipe_id = str(recipe["recipe_id"])
        for variable in recipe.get("input_variables") or []:
            key = str(variable.get("key") or "").strip()
            if not key or key in PROMPT_RECIPE_INTERNAL_VARIABLES:
                continue
            entry = merged.setdefault(
                key,
                {
                    "key": key,
                    "label": str(variable.get("label") or title_from_key(key)),
                    "type": _field_type_for_variable(key),
                    "placeholder": str(variable.get("description") or ""),
                    "help_text": str(variable.get("description") or ""),
                    "options": [],
                    "advanced": key == "previous_output",
                    "connectable": prompt_recipe_field_input_kind(variable, key=key) != "none",
                    "port_type": prompt_recipe_field_input_kind(variable, key=key) if prompt_recipe_field_input_kind(variable, key=key) != "none" else None,
                    "reference_role": prompt_recipe_field_reference_role(variable, key=key),
                    "recipe_ids": [],
                },
            )
            input_kind = prompt_recipe_field_input_kind(variable, key=key)
            if input_kind != "none":
                entry["connectable"] = True
                if input_kind == "image" or not entry.get("port_type"):
                    entry["port_type"] = input_kind
                reference_role = prompt_recipe_field_reference_role(variable, key=key)
                if reference_role != "none":
                    entry["reference_role"] = reference_role
            entry["recipe_ids"].append(recipe_id)
            if not entry["placeholder"] and variable.get("description"):
                entry["placeholder"] = str(variable["description"])
            if not entry["help_text"] and variable.get("description"):
                entry["help_text"] = str(variable["description"])
        for field in recipe.get("custom_fields") or []:
            key = str(field.get("key") or "").strip()
            if not key:
                continue
            entry = merged.setdefault(
                key,
                {
                    "key": key,
                    "label": str(field.get("label") or title_from_key(key)),
                    "type": _field_type_for_custom(str(field.get("type") or "text")),
                    "placeholder": str(field.get("placeholder") or field.get("help_text") or ""),
                    "help_text": str(field.get("help_text") or ""),
                    "options": list(field.get("options") or []),
                    "advanced": bool(field.get("advanced")),
                    "connectable": prompt_recipe_field_input_kind(field, key=key) != "none",
                    "port_type": prompt_recipe_field_input_kind(field, key=key) if prompt_recipe_field_input_kind(field, key=key) != "none" else None,
                    "reference_role": prompt_recipe_field_reference_role(field, key=key),
                    "recipe_ids": [],
                },
            )
            input_kind = prompt_recipe_field_input_kind(field, key=key)
            if input_kind != "none":
                entry["connectable"] = True
                if input_kind == "image" or not entry.get("port_type"):
                    entry["port_type"] = input_kind
                reference_role = prompt_recipe_field_reference_role(field, key=key)
                if reference_role != "none":
                    entry["reference_role"] = reference_role
            entry["recipe_ids"].append(recipe_id)
            if not entry["help_text"] and field.get("help_text"):
                entry["help_text"] = str(field["help_text"])
            if not entry["placeholder"] and field.get("placeholder"):
                entry["placeholder"] = str(field["placeholder"])
            if not entry["options"] and field.get("options"):
                entry["options"] = list(field.get("options") or [])

    fields: List[GraphNodeField] = []
    for key, entry in sorted(
        merged.items(),
        key=lambda item: (PROMPT_RECIPE_FIELD_ORDER.get(item[0], 200), str(item[1].get("label") or "").lower()),
    ):
        recipe_ids = sorted({str(item) for item in entry.get("recipe_ids") or []})
        fields.append(
            GraphNodeField(
                id=key,
                label=str(entry["label"]),
                type=str(entry["type"]),
                required=False,
                default=None,
                placeholder=str(entry["placeholder"] or "") or None,
                options=list(entry.get("options") or []),
                help_text=str(entry["help_text"] or "") or None,
                advanced=bool(entry.get("advanced")),
                connectable=bool(entry.get("connectable")),
                port_type=entry.get("port_type"),
                reference_role=str(entry.get("reference_role") or "none"),
                visible_if={"field": "recipe_id", "in": recipe_ids},
            )
        )
    return fields
