from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from . import store
from .service_errors import ServiceError
from .schemas import PromptRecipeDraftRequest, PromptRecipeUpsertRequest

PROMPT_RECIPE_TOKEN_RE = re.compile(r"\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}")
PROMPT_RECIPE_ANY_TOKEN_RE = re.compile(r"\{\{([^}]+)\}\}")
PROMPT_RECIPE_KEY_RE = re.compile(r"^[a-z][a-z0-9_]*$")
PROMPT_RECIPE_IMAGE_REFERENCE_RE = re.compile(
    r"\[\[\s*image[_\s-]*reference\s*(\d+)\s*\]\]|\[\s*image\s+reference\s+(\d+)\s*\]|@image\s*(\d+)",
    re.IGNORECASE,
)
PROMPT_RECIPE_CATEGORIES = {"image", "video", "analysis", "utility"}
PROMPT_RECIPE_STATUSES = {"active", "inactive", "archived"}
PROMPT_RECIPE_OUTPUT_FORMATS = {
    "single_prompt",
    "prompt_list",
    "json_prompt_batch",
    "image_analysis",
    "structured_shot_sequence",
}
PROMPT_RECIPE_FIELD_TYPES = {"text", "textarea", "number", "select", "boolean"}
PROMPT_RECIPE_IMAGE_MODES = {"none", "direct_reference", "analyze_then_inject", "both"}
PROMPT_RECIPE_SOURCE_KINDS = {"custom", "imported", "builtin", "built_in_override"}
PROMPT_RECIPE_RESERVED_VARIABLES = {
    "user_prompt": "User Prompt",
    "image_analysis": "Image Analysis",
    "source_prompt": "Source Prompt",
    "source_image_prompt": "Source Image Prompt",
    "previous_output": "Previous Output",
    "shot_count": "Shot Count",
    "duration_seconds": "Duration Seconds",
    "aspect_ratio": "Aspect Ratio",
    "output_format": "Output Format",
    "style_direction": "Style Direction",
}

def _clean_prompt_recipe_key(value: str, label: str) -> str:
    key = str(value or "").strip()
    if not key:
        raise ServiceError("%s is required." % label)
    if not PROMPT_RECIPE_KEY_RE.match(key):
        raise ServiceError("%s must start with a lowercase letter and use only lowercase letters, numbers, and underscores." % label)
    return key


def _slugify_prompt_recipe_key(value: str) -> str:
    return re.sub(r"_+", "_", re.sub(r"[^a-z0-9]+", "_", str(value or "").strip().lower())).strip("_")


def _highest_prompt_recipe_image_reference_index(*values: str) -> int:
    highest = 0
    for value in values:
        for match in PROMPT_RECIPE_IMAGE_REFERENCE_RE.finditer(str(value or "")):
            raw_index = next((group for group in match.groups() if group), "0")
            try:
                highest = max(highest, int(raw_index))
            except ValueError:
                continue
    return highest


def _prompt_recipe_variable(key: str, *, required: bool = False) -> Dict[str, Any]:
    return {
        "key": key,
        "token": "{{%s}}" % key,
        "label": PROMPT_RECIPE_RESERVED_VARIABLES.get(key, key.replace("_", " ").title()),
        "enabled": True,
        "required": required,
        "default_value": "",
        "description": "",
    }


def _prompt_recipe_validation_warnings(
    *,
    template_tokens: List[str],
    variable_by_key: Dict[str, Dict[str, Any]],
    custom_keys: set[str],
    unknown_tokens: List[str],
    allow_external_variables: bool,
    image_input: Dict[str, Any],
    image_analysis_prompt: str,
) -> List[str]:
    warnings: List[str] = []
    token_set = set(template_tokens)
    enabled_variable_keys = {key for key, variable in variable_by_key.items() if bool(variable.get("enabled", True))}
    unused_enabled = sorted(enabled_variable_keys - token_set)
    if unused_enabled:
        warnings.append("Enabled variables are not used in the template: %s." % ", ".join(unused_enabled))
    disabled_used = sorted([key for key, variable in variable_by_key.items() if key in token_set and not bool(variable.get("enabled", True))])
    if disabled_used:
        warnings.append("Template uses variables that are disabled in the recipe: %s." % ", ".join(disabled_used))
    if unknown_tokens and allow_external_variables:
        warnings.append("Template uses external variables that future graph nodes must provide: %s." % ", ".join(unknown_tokens))
    if "image_analysis" in token_set and not bool(image_input.get("enabled")):
        warnings.append("Template uses image_analysis, but image input is disabled.")
    if bool(image_input.get("enabled")) and image_input.get("mode") in {"analyze_then_inject", "both"} and not image_analysis_prompt.strip():
        warnings.append("Image input is enabled for analysis, but no image analysis prompt is configured.")
    if custom_keys - token_set:
        warnings.append("Custom fields are configured but not used in the template: %s." % ", ".join(sorted(custom_keys - token_set)))
    return warnings


def _normalize_prompt_recipe_draft_payload(raw_payload: Dict[str, Any], request: PromptRecipeDraftRequest) -> Dict[str, Any]:
    payload = dict(raw_payload)
    if "system_prompt_template" not in payload:
        template_value = payload.get("template") or payload.get("system_prompt")
        if template_value is not None:
            payload["system_prompt_template"] = template_value
    if "image_input" not in payload and payload.get("image_input_mode"):
        payload["image_input"] = {
            "enabled": str(payload.get("image_input_mode") or "none").strip() != "none",
            "required": False,
            "mode": payload.get("image_input_mode"),
            "analysis_variable": "image_analysis",
            "max_files": 1,
        }
    label = str(payload.get("label") or "").strip()
    key = str(payload.get("key") or "").strip()
    if not key and label:
        payload["key"] = _slugify_prompt_recipe_key(label)
    payload.setdefault("description", "")
    payload.setdefault("status", "inactive")
    payload.setdefault("source_kind", "custom")
    payload.setdefault("version", "1")
    payload.setdefault("priority", 0)
    payload.setdefault("user_prompt_placeholder", "{{user_prompt}}")
    payload.setdefault("image_analysis_prompt", "")
    payload.setdefault("category", str(request.category or "utility").strip() or "utility")
    payload.setdefault("output_format", str(request.output_format or "single_prompt").strip() or "single_prompt")
    if request.category and not payload.get("category"):
        payload["category"] = request.category
    if request.output_format and not payload.get("output_format"):
        payload["output_format"] = request.output_format
    if request.image_input_mode and not payload.get("image_input"):
        payload["image_input"] = {
            "enabled": request.image_input_mode != "none",
            "required": False,
            "mode": request.image_input_mode,
            "analysis_variable": "image_analysis",
            "max_files": 1 if request.image_input_mode != "none" else 0,
        }
    payload.setdefault(
        "image_input",
        {
            "enabled": False,
            "required": False,
            "mode": "none",
            "analysis_variable": "image_analysis",
            "max_files": 0,
        },
    )
    raw_variables = payload.get("input_variables_json", payload.get("input_variables"))
    if isinstance(raw_variables, list):
        normalized_variables: List[Dict[str, Any]] = []
        for item in raw_variables:
            if isinstance(item, str):
                variable_key = _slugify_prompt_recipe_key(item)
                if variable_key:
                    normalized_variables.append(_prompt_recipe_variable(variable_key, required=variable_key == "user_prompt"))
            elif isinstance(item, dict):
                variable_key = _slugify_prompt_recipe_key(
                    str(item.get("key") or item.get("name") or item.get("id") or item.get("token") or "").replace("{", "").replace("}", "")
                )
                if not variable_key:
                    continue
                explicit_label = str(item.get("label") or item.get("title") or "").strip()
                normalized_variables.append(
                    {
                        "key": variable_key,
                        "token": str(item.get("token") or "{{%s}}" % variable_key),
                        "label": explicit_label or PROMPT_RECIPE_RESERVED_VARIABLES.get(variable_key, variable_key.replace("_", " ").title()),
                        "enabled": bool(item.get("enabled", True)),
                        "required": bool(item.get("required", variable_key == "user_prompt")),
                        "default_value": str(item.get("default_value") or item.get("defaultValue") or item.get("default") or ""),
                        "description": str(item.get("description") or item.get("prompt") or ""),
                    }
                )
        payload["input_variables"] = normalized_variables
        payload["input_variables_json"] = normalized_variables
    elif isinstance(raw_variables, str):
        variable_key = _slugify_prompt_recipe_key(raw_variables)
        normalized_variables = [_prompt_recipe_variable(variable_key, required=variable_key == "user_prompt")] if variable_key else []
        payload["input_variables"] = normalized_variables
        payload["input_variables_json"] = normalized_variables
    else:
        payload["input_variables"] = []
        payload["input_variables_json"] = []

    raw_custom_fields = payload.get("custom_fields_json", payload.get("custom_fields"))
    if not isinstance(raw_custom_fields, list):
        payload["custom_fields"] = []
        payload["custom_fields_json"] = []

    raw_output_contract = payload.get("output_contract_json", payload.get("output_contract"))
    if not isinstance(raw_output_contract, dict):
        payload["output_contract"] = {}
        payload["output_contract_json"] = {}

    raw_default_options = payload.get("default_options_json", payload.get("default_options"))
    if not isinstance(raw_default_options, dict):
        payload["default_options"] = {}
        payload["default_options_json"] = {}

    raw_rules = payload.get("rules_json", payload.get("rules"))
    if isinstance(raw_rules, list):
        normalized_rules: Dict[str, Any] = {}
        for item in raw_rules:
            rule_key = _slugify_prompt_recipe_key(item) if isinstance(item, str) else ""
            if rule_key:
                normalized_rules[rule_key] = True
        payload["rules"] = normalized_rules
        payload["rules_json"] = normalized_rules
    elif not isinstance(raw_rules, dict):
        payload["rules"] = {}
        payload["rules_json"] = {}
    raw_notes = payload.get("notes")
    if isinstance(raw_notes, list):
        payload["notes"] = "\n".join(str(item).strip() for item in raw_notes if str(item).strip())
    elif not isinstance(raw_notes, str):
        payload["notes"] = ""
    return payload


def validate_prompt_recipe_payload(payload: PromptRecipeUpsertRequest, recipe_id: Optional[str] = None) -> Dict[str, Any]:
    key = _clean_prompt_recipe_key(payload.key, "Recipe key")
    label = str(payload.label or "").strip()
    if not label:
        raise ServiceError("Recipe label is required.")
    category = str(payload.category or "").strip()
    if category not in PROMPT_RECIPE_CATEGORIES:
        raise ServiceError("Prompt recipe category is invalid.")
    status = str(payload.status or "active").strip()
    if status not in PROMPT_RECIPE_STATUSES:
        raise ServiceError("Prompt recipe status is invalid.")
    output_format = str(payload.output_format or "single_prompt").strip()
    if output_format not in PROMPT_RECIPE_OUTPUT_FORMATS:
        raise ServiceError("Prompt recipe output format is invalid.")
    source_kind = str(payload.source_kind or "custom").strip()
    if source_kind not in PROMPT_RECIPE_SOURCE_KINDS:
        raise ServiceError("Prompt recipe source kind is invalid.")
    template = str(payload.system_prompt_template or "").strip()
    if not template:
        raise ServiceError("System prompt template is required.")
    duplicate = store.get_prompt_recipe_by_key(key)
    if duplicate and duplicate.get("recipe_id") != recipe_id:
        raise ServiceError("A prompt recipe with this key already exists.")

    malformed_tokens = [
        match.group(1).strip()
        for match in PROMPT_RECIPE_ANY_TOKEN_RE.finditer(template)
        if not PROMPT_RECIPE_KEY_RE.match(match.group(1).strip())
    ]
    if malformed_tokens:
        raise ServiceError("Invalid prompt recipe variable token: %s" % ", ".join(sorted(set(malformed_tokens))))
    template_tokens = sorted(set(PROMPT_RECIPE_TOKEN_RE.findall(template)))
    variables = [item.model_dump() if hasattr(item, "model_dump") else dict(item) for item in payload.input_variables_json]
    variable_by_key: Dict[str, Dict[str, Any]] = {}
    for variable in variables:
        variable_key = _clean_prompt_recipe_key(str(variable.get("key") or ""), "Variable key")
        variable["key"] = variable_key
        variable["token"] = "{{%s}}" % variable_key
        variable["label"] = str(variable.get("label") or PROMPT_RECIPE_RESERVED_VARIABLES.get(variable_key) or variable_key.replace("_", " ").title()).strip()
        variable_by_key[variable_key] = variable
    if not variable_by_key:
        variable_by_key["user_prompt"] = _prompt_recipe_variable("user_prompt", required=True)
    for token in template_tokens:
        if token in PROMPT_RECIPE_RESERVED_VARIABLES and token not in variable_by_key:
            variable_by_key[token] = _prompt_recipe_variable(token, required=token == "user_prompt")

    custom_fields = [item.model_dump() if hasattr(item, "model_dump") else dict(item) for item in payload.custom_fields_json]
    custom_keys: set[str] = set()
    for field in custom_fields:
        field_key = _clean_prompt_recipe_key(str(field.get("key") or ""), "Custom field key")
        if field_key in PROMPT_RECIPE_RESERVED_VARIABLES:
            raise ServiceError("Custom field key conflicts with reserved variable: %s" % field_key)
        if field_key in variable_by_key:
            raise ServiceError("Custom field key conflicts with an input variable: %s" % field_key)
        if field_key in custom_keys:
            raise ServiceError("Custom field keys must be unique.")
        field_type = str(field.get("type") or "text")
        if field_type not in PROMPT_RECIPE_FIELD_TYPES:
            raise ServiceError("Custom field type is invalid for %s." % field_key)
        options = field.get("options") or []
        if field_type == "select" and not [str(value).strip() for value in options if str(value).strip()]:
            raise ServiceError("Select custom field %s must define options." % field_key)
        normalized_options = [str(value).strip() for value in options if str(value).strip()]
        if field_type == "select" and len(set(normalized_options)) != len(normalized_options):
            raise ServiceError("Select custom field %s has duplicate options." % field_key)
        field["key"] = field_key
        field["type"] = field_type
        field["label"] = str(field.get("label") or field_key.replace("_", " ").title()).strip()
        field["options"] = normalized_options
        custom_keys.add(field_key)

    allowed_tokens = set(variable_by_key.keys()) | custom_keys
    allow_external_variables = bool(payload.rules_json.get("allow_external_variables", True))
    unknown_tokens = sorted(set(template_tokens) - allowed_tokens)
    if unknown_tokens and not allow_external_variables:
        raise ServiceError("Unknown prompt recipe variables are not allowed: %s" % ", ".join(unknown_tokens))

    image_input = payload.image_input_json.model_dump() if hasattr(payload.image_input_json, "model_dump") else dict(payload.image_input_json)
    image_mode = str(image_input.get("mode") or "none")
    if image_mode not in PROMPT_RECIPE_IMAGE_MODES:
        raise ServiceError("Prompt recipe image input mode is invalid.")
    image_input["mode"] = image_mode
    image_input["enabled"] = bool(image_input.get("enabled", False))
    image_input["required"] = bool(image_input.get("required", False))
    image_input["analysis_variable"] = _clean_prompt_recipe_key(str(image_input.get("analysis_variable") or "image_analysis"), "Image analysis variable")
    try:
        image_input["max_files"] = max(0, int(image_input.get("max_files") or (1 if image_input["enabled"] else 0)))
    except (TypeError, ValueError):
        raise ServiceError("Prompt recipe image Max Files must be a number.")
    image_analysis_prompt = payload.image_analysis_prompt or ""
    analysis_variable = str(image_input["analysis_variable"])
    token_set = set(template_tokens)
    if not image_input["enabled"]:
        if image_input["required"]:
            raise ServiceError("Image input cannot be required while image input is turned off.")
        if image_mode != "none":
            raise ServiceError("Image input mode must be none when image input is turned off.")
    if image_input["enabled"]:
        if image_mode == "none":
            raise ServiceError("Choose an image input mode when image input is turned on.")
        if image_input["max_files"] < 1:
            raise ServiceError("Prompt recipe image Max Files must be at least 1 when image input is turned on.")
    if "image_analysis" in token_set and analysis_variable != "image_analysis":
        raise ServiceError("Template uses {{image_analysis}}, but the configured image analysis variable is {{%s}}." % analysis_variable)
    if analysis_variable in token_set:
        if not image_input["enabled"]:
            raise ServiceError("Template uses {{%s}}, but image input is turned off." % analysis_variable)
        if image_mode not in {"analyze_then_inject", "both"}:
            raise ServiceError("Template uses {{%s}}, so image input mode must analyze images." % analysis_variable)
    if image_input["enabled"] and image_mode in {"analyze_then_inject", "both"} and not image_analysis_prompt.strip():
        raise ServiceError("Image analysis mode needs an Image Analysis Prompt.")
    highest_image_reference = _highest_prompt_recipe_image_reference_index(template, image_analysis_prompt)
    if highest_image_reference:
        if not image_input["enabled"]:
            raise ServiceError("Recipe text mentions image reference %s, but image input is turned off." % highest_image_reference)
        if image_input["max_files"] < highest_image_reference:
            raise ServiceError(
                "Recipe text mentions image reference %s, but image Max Files is %s."
                % (highest_image_reference, image_input["max_files"])
            )
    validation_warnings = _prompt_recipe_validation_warnings(
        template_tokens=template_tokens,
        variable_by_key=variable_by_key,
        custom_keys=custom_keys,
        unknown_tokens=unknown_tokens,
        allow_external_variables=allow_external_variables,
        image_input=image_input,
        image_analysis_prompt=image_analysis_prompt,
    )

    return {
        "key": key,
        "label": label,
        "description": payload.description or "",
        "category": category,
        "status": status,
        "system_prompt_template": template,
        "image_analysis_prompt": image_analysis_prompt,
        "user_prompt_placeholder": payload.user_prompt_placeholder or "{{user_prompt}}",
        "output_format": output_format,
        "output_contract_json": payload.output_contract_json,
        "input_variables_json": list(variable_by_key.values()),
        "custom_fields_json": custom_fields,
        "image_input_json": image_input,
        "validation_warnings_json": validation_warnings,
        "default_options_json": payload.default_options_json,
        "rules_json": {**payload.rules_json, "allow_external_variables": allow_external_variables},
        "thumbnail_path": payload.thumbnail_path,
        "thumbnail_url": payload.thumbnail_url,
        "notes": payload.notes or "",
        "source_kind": source_kind,
        "version": payload.version or "1",
        "priority": payload.priority,
    }


def upsert_prompt_recipe(payload: PromptRecipeUpsertRequest, recipe_id: Optional[str] = None) -> Dict[str, Any]:
    record = validate_prompt_recipe_payload(payload, recipe_id)
    if recipe_id:
        record["recipe_id"] = recipe_id
    return store.create_or_update_prompt_recipe(record)
