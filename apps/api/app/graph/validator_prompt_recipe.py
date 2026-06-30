from __future__ import annotations

import json
import re
from typing import Any, Callable, Dict, List, Mapping, Set

from .. import store
from .schemas import GraphError, GraphNodeDefinition, GraphWorkflowNode


GLOBAL_ENHANCEMENT_CONFIG_KEY = "__studio_enhancement__"
PROMPT_RECIPE_IMAGE_MODES = {"none", "direct_reference", "analyze_then_inject", "both"}
PROMPT_RECIPE_TOKEN_RE = re.compile(r"\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}")
PROMPT_RECIPE_IMAGE_REFERENCE_RE = re.compile(
    r"(?:\[\[\s*image[_\s-]*reference\s*\d+\s*\]\]|\[\s*image[_\s-]*reference\s*\d+\s*\]|@image\s*\d+)",
    re.IGNORECASE,
)


def prompt_recipe_id_for_node(node: GraphWorkflowNode, definition: GraphNodeDefinition) -> str:
    recipe_id = str(node.fields.get("recipe_id") or "").strip()
    if recipe_id:
        return recipe_id
    return ""


def _prompt_recipe_provider_supports_images(node: GraphWorkflowNode) -> bool | None:
    requested_provider = str(node.fields.get("provider") or "studio_default").strip()
    if requested_provider == "studio_default":
        config = store.get_enhancement_config(GLOBAL_ENHANCEMENT_CONFIG_KEY) or {}
        provider_kind = str(config.get("provider_kind") or "builtin").strip()
        if provider_kind == "builtin":
            return None
        if config.get("provider_supports_images") is None:
            return None
        return bool(config.get("provider_supports_images"))
    capabilities = node.fields.get("provider_capabilities_json")
    if isinstance(capabilities, dict):
        for key in ("supports_image_input", "supports_images"):
            value = capabilities.get(key)
            if isinstance(value, bool):
                return value
    explicit = node.fields.get("provider_supports_images")
    if isinstance(explicit, bool):
        return explicit
    return None


def _external_variables(
    node: GraphWorkflowNode,
    *,
    errors: List[GraphError],
) -> Dict[str, Any]:
    external_variables_raw = node.fields.get("external_variables_json")
    if isinstance(external_variables_raw, str) and external_variables_raw.strip():
        try:
            external_variables = json.loads(external_variables_raw)
        except json.JSONDecodeError:
            errors.append(
                GraphError(
                    code="invalid_prompt_recipe_external_variables",
                    message="External Variables JSON must be valid JSON.",
                    node_id=node.id,
                    field_id="external_variables_json",
                )
            )
            return {}
    else:
        external_variables = external_variables_raw if isinstance(external_variables_raw, dict) else {}
    if not isinstance(external_variables, dict):
        errors.append(
            GraphError(
                code="invalid_prompt_recipe_external_variables",
                message="External Variables JSON must be a JSON object.",
                node_id=node.id,
                field_id="external_variables_json",
            )
        )
        return {}
    return external_variables


def validate_prompt_recipe_node_setup(
    node: GraphWorkflowNode,
    definition: GraphNodeDefinition,
    *,
    errors: List[GraphError],
) -> Dict[str, Any] | None:
    recipe_id = prompt_recipe_id_for_node(node, definition)
    if not recipe_id:
        errors.append(GraphError(code="missing_prompt_recipe", message="Prompt Recipe node requires a saved recipe.", node_id=node.id, field_id="recipe_id"))
        return None
    recipe = store.get_prompt_recipe(recipe_id)
    if not recipe:
        errors.append(GraphError(code="missing_prompt_recipe", message="Referenced Prompt Recipe does not exist.", node_id=node.id, field_id="recipe_id"))
        return None

    status = str(recipe.get("status") or "inactive")
    if status != "active":
        errors.append(
            GraphError(
                code="inactive_prompt_recipe",
                message=f"Prompt Recipe is {status} and cannot run.",
                node_id=node.id,
                field_id="recipe_id",
            )
        )

    external_variables = _external_variables(node, errors=errors)
    image_input = recipe.get("image_input_json") or {}
    image_mode = str(image_input.get("mode") or "none").strip() or "none"
    if image_mode not in PROMPT_RECIPE_IMAGE_MODES:
        errors.append(
            GraphError(
                code="invalid_prompt_recipe_image_mode",
                message=f"Prompt Recipe uses unsupported image mode: {image_mode}.",
                node_id=node.id,
                field_id="recipe_id",
            )
        )

    return {
        "recipe_id": recipe_id,
        "recipe": recipe,
        "external_variables": external_variables,
        "image_input": image_input,
        "image_mode": image_mode,
    }


def validate_prompt_recipe_runtime(
    node: GraphWorkflowNode,
    *,
    prompt_recipe_context: Dict[str, Any],
    incoming_by_target_port: Mapping[tuple[str, str], int],
    available_incoming_by_target_port: Mapping[tuple[str, str], int],
    empty_field: Callable[[Any], bool],
    errors: List[GraphError],
    warnings: List[GraphError],
) -> None:
    recipe = prompt_recipe_context["recipe"]
    external_variables = prompt_recipe_context["external_variables"]
    image_input = prompt_recipe_context["image_input"]
    image_mode = prompt_recipe_context["image_mode"]

    max_files = int(image_input.get("max_files") or (1 if image_input.get("enabled") else 0))
    image_edge_count = incoming_by_target_port[(node.id, "image_refs")]
    available_image_count = available_incoming_by_target_port[(node.id, "image_refs")]
    if max_files and image_edge_count > max_files:
        errors.append(
            GraphError(
                code="prompt_recipe_image_limit_exceeded",
                message=f"Prompt Recipe accepts at most {max_files} image reference(s).",
                node_id=node.id,
                port_id="image_refs",
            )
        )
    if bool(image_input.get("required")) and available_image_count < 1:
        errors.append(
            GraphError(
                code="missing_prompt_recipe_image_input",
                message="Prompt Recipe requires at least one image reference.",
                node_id=node.id,
                port_id="image_refs",
            )
        )
    if bool(image_input.get("enabled")) and image_mode != "none" and available_image_count < 1:
        warnings.append(
            GraphError(
                code="prompt_recipe_images_not_connected",
                message="This Prompt Recipe can look at images, but no images are connected to Image References.",
                node_id=node.id,
                port_id="image_refs",
            )
        )
    image_reference_text = "\n".join(
        str(value)
        for value in [
            node.fields.get("user_prompt"),
            node.fields.get("source_prompt"),
            node.fields.get("source_image_prompt"),
            node.fields.get("previous_output"),
            node.fields.get("previous_storyboard_prompt"),
            node.fields.get("continuation_brief"),
            node.fields.get("continuity_notes"),
            node.fields.get("handoff_goal"),
            node.fields.get("external_variables_json"),
        ]
        if value is not None
    )
    if available_image_count < 1 and PROMPT_RECIPE_IMAGE_REFERENCE_RE.search(image_reference_text):
        warnings.append(
            GraphError(
                code="prompt_recipe_image_reference_unwired",
                message="This prompt mentions an image reference, but the Prompt Recipe node has no image connected.",
                node_id=node.id,
                port_id="image_refs",
            )
        )
    if image_mode in {"direct_reference", "both"} and available_image_count > 0:
        supports_images = _prompt_recipe_provider_supports_images(node)
        if supports_images is None:
            errors.append(
                GraphError(
                    code="prompt_recipe_image_capability_unknown",
                    message="Refresh and reselect the Prompt Recipe model before using direct image input.",
                    node_id=node.id,
                    field_id="model_id" if str(node.fields.get("provider") or "studio_default").strip() != "studio_default" else "provider",
                )
            )
        elif not supports_images:
            errors.append(
                GraphError(
                    code="prompt_recipe_model_not_image_capable",
                    message="The selected Prompt Recipe model is not marked as image-capable.",
                    node_id=node.id,
                    field_id="model_id" if str(node.fields.get("provider") or "studio_default").strip() != "studio_default" else "provider",
                )
            )

    resolved_variables: Set[str] = set()
    for variable in recipe.get("input_variables_json") or []:
        key = str(variable.get("key") or "").strip()
        if not key or not bool(variable.get("enabled", True)):
            continue
        if available_incoming_by_target_port[(node.id, key)] > 0:
            resolved_variables.add(key)
            continue
        if not empty_field(node.fields.get(key)):
            resolved_variables.add(key)
            continue
        if not empty_field(external_variables.get(key)):
            resolved_variables.add(key)
            continue
        if not empty_field(variable.get("default_value")):
            resolved_variables.add(key)
            continue
        if bool(variable.get("required")):
            errors.append(
                GraphError(
                    code="missing_prompt_recipe_variable",
                    message=f"Missing required Prompt Recipe input: {str(variable.get('label') or key)}.",
                    node_id=node.id,
                    field_id=key,
                )
            )
    for field in recipe.get("custom_fields_json") or []:
        key = str(field.get("key") or "").strip()
        if not key:
            continue
        if not empty_field(node.fields.get(key)):
            resolved_variables.add(key)
            continue
        if not empty_field(external_variables.get(key)):
            resolved_variables.add(key)
            continue
        if not empty_field(field.get("default_value")):
            resolved_variables.add(key)
            continue
        if bool(field.get("required")):
            errors.append(
                GraphError(
                    code="missing_prompt_recipe_custom_field",
                    message=f"Missing required Prompt Recipe custom field: {str(field.get('label') or key)}.",
                    node_id=node.id,
                    field_id=key,
                )
            )
    if image_mode in {"analyze_then_inject", "both"} and available_image_count > 0 and str(recipe.get("image_analysis_prompt") or "").strip():
        resolved_variables.add(str(image_input.get("analysis_variable") or "image_analysis"))
    unresolved_tokens = sorted(
        {
            token
            for token in PROMPT_RECIPE_TOKEN_RE.findall(str(recipe.get("system_prompt_template") or ""))
            if token not in resolved_variables
        }
    )
    if unresolved_tokens:
        errors.append(
            GraphError(
                code="unresolved_prompt_recipe_variables",
                message="Prompt Recipe has unresolved template variables: %s." % ", ".join(unresolved_tokens),
                node_id=node.id,
                field_id="recipe_id",
            )
        )
