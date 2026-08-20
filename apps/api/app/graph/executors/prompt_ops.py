from __future__ import annotations

import json
import re
from typing import Any, Dict, List

from ... import enhancement_provider, external_llm_usage, store
from ...settings import settings
from ..media_refs import graph_ref_path
from ..prompt_provider_defaults import studio_default_prompt_provider_config
from ..prompt_shaping import compact_storyboard_display_value
from ..prompt_recipe_refs import (
    PROMPT_RECIPE_GENERIC_IMAGE_PORT,
    PROMPT_RECIPE_TYPED_IMAGE_ROLES,
    prompt_recipe_field_image_port_ids,
    prompt_recipe_field_input_kind,
    prompt_recipe_field_reference_role,
    prompt_recipe_image_port_ids,
    prompt_recipe_ordered_port_counts,
    prompt_recipe_reference_role_port_id,
    prompt_recipe_reference_priority_rule,
    prompt_recipe_reference_role_block,
)
from ..schemas import GraphOutputRef, GraphWorkflowNode
from ..storyboard_sheet_spec import STORYBOARD_METADATA_DISPLAY_LIMITS, storyboard_sheet_spec_from_recipe_result
from ..storyboard_metadata_preflight import (
    CHARACTER_REFERENCE_PROMPT_SEMANTICS,
    ENVIRONMENT_SHEET_PROMPT_SEMANTICS,
    ORDINARY_IMAGE_PROMPT_SEMANTICS,
    STORYBOARD_METADATA_PROMPT_SEMANTICS,
)
from .base import GraphExecutionContext, GraphExecutor


PROMPT_LLM_MODES = {"rewrite_prompt", "describe_image", "custom"}
PROMPT_LLM_PROVIDERS = {"studio_default", "openrouter", "local_openai", "codex_local"}
PROMPT_TEXT_MODES = {"replace", "append", "prepend"}
PROMPT_IMAGE_ANALYZER_MODES = {"full_analysis", "image_to_prompt"}
PROMPT_TEXT_MAX_CHARS = 32000
PROMPT_RECIPE_TEXT_VARIABLES = {
    "user_prompt",
    "source_prompt",
    "previous_output",
    "previous_storyboard_prompt",
    "continuation_brief",
    "image_analysis",
    "source_image_prompt",
    "shot_count",
    "panel_count",
    "segment_number",
    "total_segments",
    "target_duration_seconds",
    "dialogue_mode",
    "duration_seconds",
    "aspect_ratio",
    "output_format",
    "style_direction",
    "continuity_notes",
    "handoff_goal",
}
PROMPT_RECIPE_IMAGE_MODES = {"none", "direct_reference", "analyze_then_inject", "both"}
PROMPT_RECIPE_STRUCTURED_FORMATS = {"prompt_list", "json_prompt_batch", "structured_shot_sequence"}
PROMPT_RECIPE_JSON_OPTIONAL_FORMATS = {"image_analysis"}
PROMPT_RECIPE_TOKEN_RE = re.compile(r"\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}")
PROMPT_LINE_NUMBER_RE = re.compile(r"^\s*(?:[-*]|\d+[.)])\s*")
STORYBOARD_V2_RECIPE_KEYS = {
    "storyboard-v2-gpt-image-2",
    "storyboard_v2",
    "cinematic_3x2_storyboard_v2",
    "storyboard-continuation-v1",
}
PROMPT_RECIPE_SEMANTICS = {
    "environment-sheet-v1": ENVIRONMENT_SHEET_PROMPT_SEMANTICS,
    "environment-plate-v1": ENVIRONMENT_SHEET_PROMPT_SEMANTICS,
    "image-analysis-character-reference": CHARACTER_REFERENCE_PROMPT_SEMANTICS,
    "image-prompt-director": ORDINARY_IMAGE_PROMPT_SEMANTICS,
}
STORYBOARD_CONTRACT_REPAIR_ATTEMPTS = 2
STORYBOARD_PRIVATE_NAME_EXCLUDE = {
    "action",
    "awakening",
    "board",
    "boards",
    "camera",
    "character",
    "dialog",
    "dungeon",
    "framing",
    "motion",
    "notes",
    "panel",
    "setup",
    "sheet",
    "shot",
    "storyboard",
}
STORYBOARD_REFERENCE_TEXT_GUARD = (
    "Do not copy visible name, title, project, footer, profile-card, or UI label text from connected reference images; "
    "reference images are visual continuity sources only. Storyboard panel metadata rows such as CAMERA, FRAMING, ACTION, "
    "MOTION, DIALOG, and NOTES should use generic subject wording like the character, the woman, or the lead unless "
    "the user explicitly asks for a visible character name."
)
STORYBOARD_COMPACT_REFERENCE_TEXT_GUARD = (
    "Text guard: use neutral subject labels in titles, footers, panel captions, and director-note rows; "
    "do not copy visible names, project labels, filenames, or profile-card text from reference images unless the user explicitly asks for visible name text."
)
STORYBOARD_COUNT_WORDS = {
    "2": "two",
    "two": "two",
    "3": "three",
    "three": "three",
    "4": "four",
    "four": "four",
}


def _text_value(ref: GraphOutputRef) -> str:
    if ref.kind == "value":
        return str(ref.value or "").strip()
    return ""


def _dict_value(value: Any) -> Dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value.strip():
        parsed = json.loads(value)
        if isinstance(parsed, dict):
            return parsed
    return {}


def _bounded_float(value: Any, *, fallback: float, minimum: float, maximum: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        parsed = fallback
    return max(minimum, min(maximum, parsed))


def _bounded_int(value: Any, *, fallback: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = fallback
    return max(minimum, min(maximum, parsed))


def _optional_bounded_float(value: Any, *, minimum: float, maximum: float) -> float | None:
    if value is None or value == "":
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return max(minimum, min(maximum, parsed))


def _optional_bounded_int(value: Any, *, minimum: int, maximum: int) -> int | None:
    if value is None or value == "":
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return max(minimum, min(maximum, parsed))


def _studio_default_config() -> Dict[str, Any]:
    return studio_default_prompt_provider_config()


def _provider_capabilities_from_fields(fields: Dict[str, Any]) -> Dict[str, Any]:
    capabilities = fields.get("provider_capabilities_json")
    if isinstance(capabilities, dict):
        return capabilities
    if isinstance(capabilities, str) and capabilities.strip():
        try:
            parsed = json.loads(capabilities)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _provider_supports_images_from_capabilities(capabilities: Dict[str, Any]) -> bool | None:
    for key in ("supports_image_input", "supports_images"):
        value = capabilities.get(key)
        if isinstance(value, bool):
            return value
    return None


def _node_provider_supports_images(fields: Dict[str, Any]) -> bool | None:
    capability_value = _provider_supports_images_from_capabilities(_provider_capabilities_from_fields(fields))
    if capability_value is not None:
        return capability_value
    explicit_value = fields.get("provider_supports_images")
    if isinstance(explicit_value, bool):
        return explicit_value
    return None


def _provider_config(node: GraphWorkflowNode, *, has_image: bool) -> Dict[str, Any]:
    requested_provider = str(node.fields.get("provider") or "studio_default").strip()
    if requested_provider not in PROMPT_LLM_PROVIDERS:
        raise ValueError("LLM Prompt provider is not supported.")

    if requested_provider == "studio_default":
        config = _studio_default_config()
        provider_kind = str(config.get("provider_kind") or "builtin").strip()
        if provider_kind == "builtin":
            raise ValueError("Configure a Studio enhancement provider before running LLM Prompt.")
        provider_model_id = str(config.get("provider_model_id") or "").strip()
        provider_supports_images: bool | None = (
            bool(config.get("provider_supports_images")) if config.get("provider_supports_images") is not None else None
        )
        provider_base_url = str(config.get("provider_base_url") or "").strip()
        provider_api_key = str(config.get("provider_api_key") or "").strip()
    else:
        provider_kind = requested_provider
        provider_model_id = str(node.fields.get("model_id") or "").strip()
        provider_supports_images = _node_provider_supports_images(node.fields)
        provider_base_url = ""
        provider_api_key = ""
        config = _studio_default_config()
        if str(config.get("provider_kind") or "").strip() == provider_kind:
            provider_base_url = str(config.get("provider_base_url") or "").strip()
            provider_api_key = str(config.get("provider_api_key") or "").strip()

    if provider_kind not in {"openrouter", "local_openai", "codex_local"}:
        raise ValueError("LLM Prompt supports OpenRouter, Codex Local, or local OpenAI-compatible providers.")
    if not provider_model_id:
        raise ValueError("LLM Prompt requires a provider model id.")
    if has_image:
        if provider_supports_images is None:
            raise ValueError("The selected LLM Prompt model has no confirmed image capability. Refresh and reselect the model.")
        if not provider_supports_images:
            raise ValueError("The selected LLM Prompt model is not marked as image-capable.")

    if provider_kind == "openrouter":
        provider_base_url = provider_base_url or settings.openrouter_base_url
        provider_api_key = provider_api_key or str(settings.openrouter_api_key or "")
    elif provider_kind == "local_openai":
        provider_base_url = provider_base_url or settings.local_openai_base_url
        provider_api_key = provider_api_key or str(settings.local_openai_api_key or "")
    else:
        provider_base_url = enhancement_provider.codex_local_provider.CODEX_LOCAL_PROVIDER_BASE_URL
        provider_api_key = ""
    return {
        "provider_kind": provider_kind,
        "provider_model_id": provider_model_id,
        "provider_base_url": provider_base_url,
        "provider_api_key": provider_api_key,
        "provider_supports_images": provider_supports_images,
    }


def _prompt_recipe_for_node(node: GraphWorkflowNode) -> Dict[str, Any]:
    recipe_id = str(node.fields.get("recipe_id") or "").strip()
    if not recipe_id:
        raise ValueError("Prompt Recipe requires a saved recipe.")
    recipe = store.get_prompt_recipe(recipe_id)
    if not recipe:
        raise ValueError("Prompt Recipe does not exist.")
    status = str(recipe.get("status") or "inactive")
    if status != "active":
        raise ValueError(f"Prompt Recipe is {status}.")
    return recipe


def _recipe_text_input(node: GraphWorkflowNode, context: GraphExecutionContext, key: str) -> str:
    connected_parts = [_text_value(item) for item in context.inputs_for(node, key)]
    connected_text = "\n\n".join(part for part in connected_parts if part)
    if connected_text:
        return connected_text
    return str(node.fields.get(key) or "").strip()


def _prompt_recipe_runtime_image_port_ids(recipe: Dict[str, Any]) -> tuple[str, ...]:
    port_ids: list[str] = []
    seen: set[str] = set()
    for port_id in (*prompt_recipe_image_port_ids(), *prompt_recipe_field_image_port_ids(recipe)):
        if port_id in seen:
            continue
        seen.add(port_id)
        port_ids.append(port_id)
    return tuple(port_ids)


def _title_from_recipe_key(value: str) -> str:
    return " ".join(part.capitalize() for part in value.replace("_", " ").replace("-", " ").split())


def _prompt_recipe_field_image_metadata(recipe: Dict[str, Any]) -> Dict[str, Dict[str, str]]:
    metadata: Dict[str, Dict[str, str]] = {}
    for item in [*(recipe.get("input_variables_json") or []), *(recipe.get("custom_fields_json") or [])]:
        key = str(item.get("key") or "").strip()
        if not key or key not in prompt_recipe_field_image_port_ids(recipe):
            continue
        reference_role = prompt_recipe_field_reference_role(item, key=key)
        metadata[key] = {
            "label": str(item.get("label") or _title_from_recipe_key(key)),
            "reference_role": reference_role,
            "role_port_id": prompt_recipe_reference_role_port_id(reference_role) or "",
        }
    return metadata


def _prompt_recipe_role_by_port_id() -> Dict[str, Dict[str, str]]:
    return {
        role.port_id: {
            "prompt_role": role.prompt_role,
            "model_role": role.model_role,
        }
        for role in PROMPT_RECIPE_TYPED_IMAGE_ROLES
    }


def _prompt_recipe_field_owned_top_port_ids(
    node: GraphWorkflowNode,
    context: GraphExecutionContext,
    recipe: Dict[str, Any],
) -> set[str]:
    owned: set[str] = set()
    for port_id, metadata in _prompt_recipe_field_image_metadata(recipe).items():
        if not context.inputs_for(node, port_id):
            continue
        role_port_id = metadata.get("role_port_id") or ""
        if role_port_id and role_port_id != PROMPT_RECIPE_GENERIC_IMAGE_PORT:
            owned.add(role_port_id)
    return owned


def _prompt_recipe_image_refs(node: GraphWorkflowNode, context: GraphExecutionContext, recipe: Dict[str, Any]) -> List[GraphOutputRef]:
    refs: List[GraphOutputRef] = []
    field_owned_top_port_ids = _prompt_recipe_field_owned_top_port_ids(node, context, recipe)
    for port_id in _prompt_recipe_runtime_image_port_ids(recipe):
        if port_id in field_owned_top_port_ids:
            continue
        refs.extend(context.inputs_for(node, port_id))
    return refs


def _prompt_recipe_image_paths(node: GraphWorkflowNode, context: GraphExecutionContext, recipe: Dict[str, Any]) -> List[str]:
    return [
        str(graph_ref_path(ref, expected_media_type="image", prefer_web_variant=True))
        for ref in _prompt_recipe_image_refs(node, context, recipe)
    ]


def _stringify_prompt_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, str):
        return value.strip()
    return json.dumps(value, ensure_ascii=False)


def _build_prompt_recipe_values(node: GraphWorkflowNode, recipe: Dict[str, Any], context: GraphExecutionContext) -> Dict[str, str]:
    values: Dict[str, str] = {}
    external_values = _dict_value(node.fields.get("external_variables_json"))
    raw_base_image_port_counts = prompt_recipe_ordered_port_counts(
        port_ids=prompt_recipe_image_port_ids(),
        count_for_port=lambda port_id: len(context.inputs_for(node, port_id)),
    )
    field_image_metadata = _prompt_recipe_field_image_metadata(recipe)
    field_owned_top_port_ids = _prompt_recipe_field_owned_top_port_ids(node, context, recipe)
    base_image_port_counts = prompt_recipe_ordered_port_counts(
        port_ids=prompt_recipe_image_port_ids(),
        count_for_port=lambda port_id: 0 if port_id in field_owned_top_port_ids else len(context.inputs_for(node, port_id)),
    )
    field_image_port_counts = prompt_recipe_ordered_port_counts(
        port_ids=prompt_recipe_field_image_port_ids(recipe),
        count_for_port=lambda port_id: len(context.inputs_for(node, port_id)),
    )
    effective_role_counts = dict(base_image_port_counts)
    reference_role_warnings: list[str] = []
    for port_id, count in field_image_port_counts.items():
        if count <= 0:
            continue
        metadata = field_image_metadata.get(port_id) or {}
        role_port_id = metadata.get("role_port_id") or ""
        if not role_port_id:
            continue
        effective_role_counts[role_port_id] = max(0, int(effective_role_counts.get(role_port_id) or 0)) + count
        if role_port_id != PROMPT_RECIPE_GENERIC_IMAGE_PORT and raw_base_image_port_counts.get(role_port_id):
            reference_role_warnings.append(
                f"{_title_from_recipe_key(role_port_id)} ignored because {metadata.get('label') or _title_from_recipe_key(port_id)} image input is connected."
            )
    reference_role_lines = [line for line in prompt_recipe_reference_role_block(base_image_port_counts).splitlines() if line.strip()]
    image_index = sum(base_image_port_counts.values()) + 1
    role_by_port_id = _prompt_recipe_role_by_port_id()
    for port_id, count in field_image_port_counts.items():
        field_lines: list[str] = []
        for offset in range(count):
            suffix = f" {offset + 1}" if count > 1 else ""
            metadata = field_image_metadata.get(port_id) or {}
            label = metadata.get("label") or _title_from_recipe_key(port_id)
            role_port_id = metadata.get("role_port_id") or ""
            role_info = role_by_port_id.get(role_port_id)
            if role_info:
                line = (
                    f"[image reference {image_index}] = {role_info['prompt_role']} from {label} field image input{suffix} "
                    f"(@image{image_index}). "
                    f"Use for {role_info['model_role']}."
                )
            elif role_port_id == PROMPT_RECIPE_GENERIC_IMAGE_PORT:
                line = (
                    f"[image reference {image_index}] = Generic image reference from {label} field image input{suffix} "
                    f"(@image{image_index}). Use only as supporting visual context."
                )
            else:
                line = (
                    f"[image reference {image_index}] = {label} image input{suffix} (@image{image_index}). "
                    "Use for the matching recipe field's visual details and continuity."
                )
            reference_role_lines.append(line)
            field_lines.append(line)
            image_index += 1
        if field_lines:
            values[port_id] = "\n".join(field_lines)
    reference_role_block = "\n".join(reference_role_lines)
    reference_priority_rule = prompt_recipe_reference_priority_rule(effective_role_counts)
    if any(count > 0 for count in field_image_port_counts.values()):
        field_rule = "Field-level image inputs control only their matching recipe fields and must not override typed character, environment, prop, or style references."
        reference_priority_rule = f"{reference_priority_rule} {field_rule}".strip()
    values["reference_role_block"] = reference_role_block
    values["reference_priority_rule"] = reference_priority_rule
    values["reference_role_warnings"] = "\n".join(reference_role_warnings)

    for variable in recipe.get("input_variables_json") or []:
        key = str(variable.get("key") or "").strip()
        if not key or not bool(variable.get("enabled", True)):
            continue
        if key in values and prompt_recipe_field_input_kind(variable, key=key) == "image":
            supplemental_value = (
                _recipe_text_input(node, context, key)
                or _stringify_prompt_value(external_values.get(key))
                or _stringify_prompt_value(variable.get("default_value"))
            )
            if supplemental_value:
                values[key] = f"{values[key]}\nField text/notes: {supplemental_value}"
            continue
        connected_or_typed = _recipe_text_input(node, context, key)
        if connected_or_typed:
            values[key] = connected_or_typed
            continue
        external_value = _stringify_prompt_value(external_values.get(key))
        if external_value:
            values[key] = external_value
            continue
        default_value = _stringify_prompt_value(variable.get("default_value"))
        if default_value:
            values[key] = default_value

    for field in recipe.get("custom_fields_json") or []:
        key = str(field.get("key") or "").strip()
        if not key:
            continue
        if key in values and prompt_recipe_field_input_kind(field, key=key) == "image":
            typed_value = node.fields.get(key)
            if typed_value is None or typed_value == "":
                external_value = external_values.get(key)
                if external_value is not None and external_value != "":
                    typed_value = external_value
            if typed_value is None or typed_value == "":
                typed_value = field.get("default_value")
            supplemental_value = _stringify_prompt_value(typed_value)
            if supplemental_value:
                values[key] = f"{values[key]}\nField text/notes: {supplemental_value}"
            continue
        connected_value = _recipe_text_input(node, context, key) if prompt_recipe_field_input_kind(field, key=key) == "text" else ""
        if connected_value:
            values[key] = connected_value
            continue
        typed_value = node.fields.get(key)
        if typed_value is None or typed_value == "":
            external_value = external_values.get(key)
            if external_value is not None and external_value != "":
                typed_value = external_value
        if typed_value is None or typed_value == "":
            typed_value = field.get("default_value")
        string_value = _stringify_prompt_value(typed_value)
        if string_value:
            values[key] = string_value

    for key, value in external_values.items():
        clean_key = str(key or "").strip()
        if clean_key and clean_key not in values:
            values[clean_key] = _stringify_prompt_value(value)
    return values


def _render_prompt_recipe_template(template: str, values: Dict[str, str]) -> str:
    def replace(match: re.Match[str]) -> str:
        key = match.group(1)
        return values.get(key, match.group(0))

    return PROMPT_RECIPE_TOKEN_RE.sub(replace, template)


def _unresolved_prompt_recipe_tokens(template: str) -> List[str]:
    return sorted(set(PROMPT_RECIPE_TOKEN_RE.findall(template)))


def _plain_text_recipe_output_instruction(output_format: str) -> str:
    if output_format == "image_analysis":
        return "Return a concise, useful image-analysis result. Prefer plain text unless the recipe explicitly demands JSON."
    return "Return only the final output text. Do not include markdown fences, labels, or commentary."


def _structured_recipe_output_instruction(output_format: str) -> str:
    if output_format == "structured_shot_sequence":
        return (
            "Return only valid JSON. Prefer an object with a `shots` array. Each shot should contain a usable `prompt`, "
            "and may also include shot_number, title, camera, action, motion, duration_seconds, or notes."
        )
    if output_format == "json_prompt_batch":
        return "Return only valid JSON. Prefer an object with a `prompts` array of strings or prompt objects."
    if output_format == "prompt_list":
        return "Return only valid JSON. Prefer an object with a `prompts` array of strings."
    return "Return only valid JSON."


def _workflow_id_for_usage(context: GraphExecutionContext) -> str | None:
    return str(context.workflow.workflow_id or "").strip() or None


def _record_llm_usage_metric(
    context: GraphExecutionContext,
    node: GraphWorkflowNode,
    *,
    provider_result: Dict[str, Any],
    source_kind: str,
    recipe_id: str | None = None,
    model_key: str | None = None,
    task_mode: str | None = None,
    metadata_json: Dict[str, Any] | None = None,
) -> None:
    usage_event = external_llm_usage.record_external_llm_usage(
        provider_kind=str(provider_result.get("provider_kind") or ""),
        provider_model_id=str(provider_result.get("provider_model_id") or ""),
        provider_response_id=provider_result.get("provider_response_id"),
        usage=provider_result.get("usage"),
        source_kind=source_kind,
        workflow_id=_workflow_id_for_usage(context),
        run_id=context.run_id,
        node_id=node.id,
        recipe_id=recipe_id,
        model_key=model_key,
        task_mode=task_mode,
        metadata_json=metadata_json or {},
    )
    summary = external_llm_usage.summarize_usage_payload(provider_result.get("usage"))
    metrics = context.node_metrics.setdefault(node.id, {})
    metrics["actual_cost_usd"] = round(float(metrics.get("actual_cost_usd") or 0.0) + float(summary.get("cost_usd") or 0.0), 8)
    for key in ("prompt_tokens", "completion_tokens", "total_tokens", "reasoning_tokens", "cached_tokens", "cache_write_tokens"):
        metrics[key] = int(metrics.get(key) or 0) + int(summary.get(key) or 0)
    if usage_event:
        usage_event_ids = [str(item) for item in metrics.get("usage_event_ids") or [] if str(item).strip()]
        usage_event_id = str(usage_event.get("usage_event_id") or "").strip()
        if usage_event_id and usage_event_id not in usage_event_ids:
            usage_event_ids.append(usage_event_id)
        metrics["usage_event_ids"] = usage_event_ids
    provider_response_id = str(provider_result.get("provider_response_id") or "").strip()
    if provider_response_id:
        provider_response_ids = [str(item) for item in metrics.get("provider_response_ids") or [] if str(item).strip()]
        if provider_response_id not in provider_response_ids:
            provider_response_ids.append(provider_response_id)
        metrics["provider_response_ids"] = provider_response_ids
    llm_calls = list(metrics.get("llm_calls") or [])
    llm_calls.append(
        {
            "source_kind": source_kind,
            "provider_kind": provider_result.get("provider_kind"),
            "provider_model_id": provider_result.get("provider_model_id"),
            "provider_response_id": provider_result.get("provider_response_id"),
            "prompt_tokens": summary.get("prompt_tokens"),
            "completion_tokens": summary.get("completion_tokens"),
            "total_tokens": summary.get("total_tokens"),
            "cost_usd": summary.get("cost_usd"),
        }
    )
    metrics["llm_calls"] = llm_calls


def _analysis_messages(image_paths: List[str], analysis_prompt: str) -> List[Dict[str, Any]]:
    content = enhancement_provider.build_openai_compatible_multimodal_content(
        text=f"{analysis_prompt.strip()}\n\nReturn only the analysis text.",
        image_paths=image_paths,
    )
    return [
        {
            "role": "system",
            "content": "You analyze image references for downstream prompt generation. Focus on identity, continuity, composition, and details useful for media generation.",
        },
        {"role": "user", "content": content},
    ]


def _image_analyzer_messages(
    *,
    image_paths: List[str],
    mode: str,
    system_prompt: str,
    analysis_goal: str,
) -> List[Dict[str, Any]]:
    mode_instruction = (
        "Return a model-ready image generation prompt that captures the visible subject, composition, style, lighting, palette, texture, and mood."
        if mode == "image_to_prompt"
        else (
            "Return a detailed visual analysis covering content inventory, composition, medium, palette, line and shape language, "
            "subject treatment, environment, texture, lighting, typography when present, and mood."
        )
    )
    user_text = f"Task: {mode_instruction}\n"
    if analysis_goal:
        user_text += f"Operator focus: {analysis_goal}\n"
    user_text += "Use only visible evidence from the image. Return plain text with no markdown fences."
    content = enhancement_provider.build_openai_compatible_multimodal_content(
        text=user_text,
        image_paths=image_paths,
    )
    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": content},
    ]


def _final_recipe_messages(
    *,
    rendered_template: str,
    output_format: str,
    image_paths: List[str],
    use_direct_image_context: bool,
) -> List[Dict[str, Any]]:
    instruction = (
        _structured_recipe_output_instruction(output_format)
        if output_format in PROMPT_RECIPE_STRUCTURED_FORMATS or output_format in PROMPT_RECIPE_JSON_OPTIONAL_FORMATS
        else _plain_text_recipe_output_instruction(output_format)
    )
    user_text = (
        "Execute this Prompt Recipe.\n"
        f"Expected output format: {output_format}\n"
        f"Direct image context: {'enabled' if use_direct_image_context else 'disabled'}\n"
        f"{instruction}"
    )
    content = enhancement_provider.build_openai_compatible_multimodal_content(
        text=user_text,
        image_paths=image_paths if use_direct_image_context else [],
    )
    return [
        {"role": "system", "content": rendered_template},
        {"role": "user", "content": content},
    ]


def _trim_prompt_line(text: str) -> str:
    return PROMPT_LINE_NUMBER_RE.sub("", text).strip()


def _item_prompt_text(item: Any) -> str:
    if isinstance(item, str):
        return _trim_prompt_line(item)
    if isinstance(item, dict):
        for key in ("prompt", "text", "description", "caption", "summary"):
            value = _trim_prompt_line(str(item.get(key) or ""))
            if value:
                return value
        for nested_key in ("shot", "panel", "scene"):
            nested = item.get(nested_key)
            if isinstance(nested, dict):
                value = _item_prompt_text(nested)
                if value:
                    return value
    return ""


def _prompts_from_parsed_json(parsed_json: Any) -> List[str]:
    if isinstance(parsed_json, list):
        return [prompt for prompt in (_item_prompt_text(item) for item in parsed_json) if prompt]
    if isinstance(parsed_json, dict):
        for key in ("prompts", "shots", "panels", "scenes", "items"):
            value = parsed_json.get(key)
            if isinstance(value, list):
                prompts = [prompt for prompt in (_item_prompt_text(item) for item in value) if prompt]
                if prompts:
                    return prompts
        fallback = _item_prompt_text(parsed_json)
        return [fallback] if fallback else []
    return []


def _prompts_from_lines(text: str) -> List[str]:
    prompts: List[str] = []
    for line in text.splitlines():
        cleaned = _trim_prompt_line(line)
        if cleaned:
            prompts.append(cleaned)
    return prompts


def _parse_json_maybe(raw_text: str) -> Any:
    try:
        return json.loads(raw_text)
    except json.JSONDecodeError:
        return None


def _title_case_key(value: str) -> str:
    return " ".join(part.capitalize() for part in value.replace("_", " ").replace("-", " ").split()).strip()


def _stringify_summary_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return _trim_prompt_line(value)
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, list):
        items = [_stringify_summary_value(item) for item in value]
        return ", ".join(item for item in items if item)
    if isinstance(value, dict):
        parts = []
        for key in ("name", "title", "label", "text", "description", "summary", "value"):
            text = _trim_prompt_line(str(value.get(key) or ""))
            if text:
                parts.append(text)
        return " | ".join(part for part in parts if part)
    return _trim_prompt_line(str(value))


def _summary_lines_from_mapping(payload: Dict[str, Any], *, exclude_keys: set[str] | None = None, limit: int = 6) -> List[str]:
    excluded = exclude_keys or set()
    lines: List[str] = []
    for key, value in payload.items():
        if key in excluded:
            continue
        text = _stringify_summary_value(value)
        if not text:
            continue
        lines.append(f"{_title_case_key(key)}: {text}")
        if len(lines) >= limit:
            break
    return lines


def _structured_items(parsed_json: Any) -> List[Dict[str, Any]]:
    if isinstance(parsed_json, list):
        return [item for item in parsed_json if isinstance(item, dict)]
    if isinstance(parsed_json, dict):
        for key in ("shots", "panels", "scenes", "items", "prompts"):
            value = parsed_json.get(key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict)]
    return []


def _structured_item_summary(item: Dict[str, Any], index: int) -> str:
    prefix = str(item.get("shot_number") or item.get("panel_number") or item.get("scene_number") or index)
    title = _trim_prompt_line(str(item.get("title") or item.get("caption") or item.get("name") or ""))
    camera = _trim_prompt_line(str(item.get("camera") or item.get("framing") or ""))
    action = _trim_prompt_line(str(item.get("action") or item.get("motion") or ""))
    prompt = _item_prompt_text(item)
    segments = [f"{prefix}."]
    if title:
        segments.append(title)
    if camera:
        segments.append(f"Camera: {camera}")
    if action:
        segments.append(f"Action: {action}")
    if prompt:
        segments.append(f"Prompt: {prompt}")
    return " ".join(segment for segment in segments if segment)


def _structured_summary_text(parsed_json: Any, prompts: List[str]) -> str:
    items = _structured_items(parsed_json)
    if items:
        lines = [_structured_item_summary(item, index) for index, item in enumerate(items, start=1)]
        return "\n".join(line for line in lines if line)
    return "\n".join(f"{index}. {prompt}" for index, prompt in enumerate(prompts, start=1) if prompt)


def _image_analysis_summary_text(parsed_json: Any, prompts: List[str], raw_text: str) -> str:
    if isinstance(parsed_json, dict):
        description = _trim_prompt_line(str(parsed_json.get("description") or parsed_json.get("summary") or ""))
        if description:
            return description
        lines = _summary_lines_from_mapping(parsed_json, exclude_keys={"prompts", "shots", "panels", "scenes", "items"})
        if lines:
            return "\n".join(lines)
    if prompts:
        return "\n".join(prompts)
    return raw_text.strip()


def _normalize_prompt_recipe_result(recipe: Dict[str, Any], raw_text: str) -> Dict[str, Any]:
    output_format = str(recipe.get("output_format") or "single_prompt")
    parsed_json = _parse_json_maybe(raw_text)
    warnings: List[str] = []
    prompts: List[str] = []
    final_text = ""

    if output_format == "single_prompt":
        prompts = _prompts_from_parsed_json(parsed_json) if parsed_json is not None else []
        if not prompts:
            final_text = raw_text.strip()
            prompts = [final_text] if final_text else []
        else:
            final_text = prompts[0]
    elif output_format == "image_analysis":
        prompts = _prompts_from_parsed_json(parsed_json) if parsed_json is not None else []
        final_text = _image_analysis_summary_text(parsed_json, prompts, raw_text)
        prompts = [final_text] if final_text else prompts
    elif output_format == "prompt_list":
        prompts = _prompts_from_parsed_json(parsed_json) if parsed_json is not None else _prompts_from_lines(raw_text)
        final_text = "\n\n".join(prompts)
    elif output_format in {"json_prompt_batch", "structured_shot_sequence"}:
        prompts = _prompts_from_parsed_json(parsed_json)
        if parsed_json is None:
            warnings.append("Provider returned non-JSON text for a structured Prompt Recipe.")
            final_text = "\n\n".join(prompts)
        else:
            final_text = _structured_summary_text(parsed_json, prompts)

    if output_format in PROMPT_RECIPE_STRUCTURED_FORMATS and not prompts and final_text:
        prompts = _prompts_from_lines(final_text) or [final_text]
    if not prompts and final_text:
        prompts = [final_text]
    if not final_text and prompts:
        final_text = "\n\n".join(prompts)

    result = {
        "recipe_id": recipe.get("recipe_id"),
        "recipe_key": recipe.get("key"),
        "category": recipe.get("category"),
        "output_format": output_format,
        "raw_text": raw_text,
        "parsed_json": parsed_json,
        "final_text": final_text,
        "prompts": prompts,
        "warnings": warnings,
    }
    if output_format in PROMPT_RECIPE_STRUCTURED_FORMATS and not prompts:
        raise ValueError("Prompt Recipe returned no usable prompts for the structured output format.")
    if output_format == "image_analysis" and not final_text and parsed_json is None:
        raise ValueError("Prompt Recipe returned no usable image analysis output.")
    if output_format == "single_prompt" and not final_text:
        raise ValueError("Prompt Recipe returned empty text.")
    return result


def _is_storyboard_v2_recipe(recipe: Dict[str, Any]) -> bool:
    recipe_key = str(recipe.get("key") or "").strip().lower()
    recipe_id = str(recipe.get("recipe_id") or "").strip().lower()
    return recipe_key in STORYBOARD_V2_RECIPE_KEYS or recipe_id in {
        "prompt-recipe-storyboard-v2-gpt-image-2",
        "prompt-recipe-storyboard-continuation-v1",
    }


def _storyboard_prompt_contract_error(
    recipe: Dict[str, Any],
    raw_text: str,
    values: Dict[str, str],
) -> str:
    try:
        storyboard_sheet_spec_from_recipe_result(
            {
                "recipe_key": str(recipe.get("key") or ""),
                "raw_text": raw_text,
                "final_text": raw_text,
                "panel_notes_cues": str(values.get("panel_notes_cues") or ""),
                "dialogue_cues": str(values.get("dialogue_cues") or ""),
            }
        )
    except ValueError as exc:
        return str(exc)
    return ""


def _compact_storyboard_generated_display_rows(raw_text: str) -> str:
    """Bound generated SHOT/CAMERA/ACTION/MOTION rows inside panel blocks.

    Exact user-owned DIALOG and NOTES rows are never rewritten. The result is
    still compiled and validated before it can leave Prompt Recipe execution.
    """

    def compact_field(field_match: re.Match[str]) -> str:
        label = field_match.group("label").upper()
        value = field_match.group("value").strip()
        limit = STORYBOARD_METADATA_DISPLAY_LIMITS[label]
        if len(value) <= limit:
            return field_match.group(0)
        compacted = compact_storyboard_display_value(label, value, limit)
        return f"{field_match.group('prefix')}{compacted}"

    output = raw_text
    panel_pattern = re.compile(
        r"(?im)^\s*(?:\d+\.\s*)?(?:PANEL|CELL)\s+\d{1,2}\b"
    )
    matches = list(panel_pattern.finditer(output))
    field_pattern = re.compile(
        r"(?im)^(?P<prefix>\s*(?:[-*]\s*)?"
        r"(?P<label>SHOT|CAMERA|ACTION|MOTION)\s*:\s*)"
        r"(?P<value>[^\r\n]*)"
    )
    semicolon_field_pattern = re.compile(
        r"(?P<prefix>(?:^|;\s*)(?P<label>SHOT|CAMERA|ACTION|MOTION)\s*:\s*)"
        r"(?P<value>.*?)(?=;\s*(?:SHOT|CAMERA|ACTION|MOTION|DIALOG|NOTES)\s*:|$)",
        flags=re.IGNORECASE | re.DOTALL,
    )
    if matches:
        chunks: List[str] = [output[: matches[0].start()]]
        for index, match in enumerate(matches):
            end = matches[index + 1].start() if index + 1 < len(matches) else len(output)
            panel_text = output[match.start() : end]
            heading_length = match.end() - match.start()
            heading = panel_text[:heading_length]
            body = field_pattern.sub(compact_field, panel_text[heading_length:])
            body = semicolon_field_pattern.sub(compact_field, body)
            chunks.append(f"{heading}{body}")
        output = "".join(chunks)

    compact_marker = re.search(
        r"Panel plan with metadata rows\s*:\s*",
        output,
        flags=re.IGNORECASE,
    )
    if not compact_marker:
        return output
    capsule_start = compact_marker.end()
    continuity = re.search(r"\n\s*\nContinuity\s*:", output[capsule_start:], flags=re.IGNORECASE)
    capsule_end = capsule_start + continuity.start() if continuity else len(output)
    capsule = output[capsule_start:capsule_end]
    capsule_panel_pattern = re.compile(
        r"(?P<prefix>(?:^|\|\s*)(?P<number>\d{1,2})\s*:\s*)"
        r"(?P<body>.*?)(?=\s*\|\s*\d{1,2}\s*:|$)",
        flags=re.DOTALL,
    )
    def compact_capsule_panel(panel_match: re.Match[str]) -> str:
        body = semicolon_field_pattern.sub(compact_field, panel_match.group("body"))
        return f"{panel_match.group('prefix')}{body}"

    bounded_capsule = capsule_panel_pattern.sub(compact_capsule_panel, capsule)
    return f"{output[:capsule_start]}{bounded_capsule}{output[capsule_end:]}"


def _storyboard_contract_repair_messages(
    messages: List[Dict[str, Any]],
    *,
    raw_text: str,
    contract_error: str,
) -> List[Dict[str, Any]]:
    display_budgets = "; ".join(
        f"{label} <= {limit} characters"
        for label, limit in STORYBOARD_METADATA_DISPLAY_LIMITS.items()
    )
    return [
        *messages,
        {"role": "assistant", "content": raw_text},
        {
            "role": "user",
            "content": (
                "Revise and return the complete final image-generation prompt again. "
                f"The previous output failed the immutable storyboard contract: {contract_error} "
                "Preserve the user-owned story, titles, production metadata, references, and panel order. "
                "Correct the named defect, then audit every field in every panel before returning. "
                "SHOT is the one required heading above the image, not a row below it. Under the image, every panel "
                "must contain exactly five rows in CAMERA, ACTION, MOTION, DIALOG, NOTES order; "
                "only DIALOG may be empty. ACTION, MOTION, and NOTES must remain complete and semantically distinct. "
                f"Hard display budgets include every space and punctuation mark: {display_budgets}. "
                "Measure every value after revision. Shorten generated wording at a complete clause boundary until "
                "every value is at or below its own limit; do not merely repair the first reported field. Preserve "
                "exact user-owned DIALOG and NOTES wording. "
                "Do not copy, paraphrase, or cross-fill one narrative row into another. Return only the corrected prompt."
            ),
        },
    ]


def _storyboard_user_requested_visible_name(values: Dict[str, str]) -> bool:
    text = "\n".join(str(values.get(key) or "") for key in ("user_prompt", "previous_output", "previous_storyboard_prompt", "continuation_brief", "style_direction"))
    normalized = " ".join(text.lower().split())
    if re.search(
        r"\b(?:no|not|without|don't|dont|do not|never)\b.{0,50}\b(?:visible|show|display|include|print|write|label|title|name|proper name)\b",
        normalized,
    ):
        return False
    return bool(
        re.search(r"\b(?:show|display|include|print|write|label|title)\b.{0,80}\b(?:name|character name|proper name)\b", normalized)
        or re.search(r"\b(?:visible|on[- ]?board|on[- ]?screen)\b.{0,80}\b(?:name|character name|proper name)\b", normalized)
    )


def _storyboard_user_disabled_dialogue(values: Dict[str, str]) -> bool:
    text = "\n".join(str(values.get(key) or "") for key in ("user_prompt", "previous_output", "previous_storyboard_prompt", "continuation_brief", "style_direction"))
    normalized = " ".join(text.lower().split())
    return bool(
        re.search(
            r"\b(?:no|not|without|don't|dont|do not|never)\b.{0,50}\b(?:dialogue|dialog|spoken|speech|talking|talk|lines)\b",
            normalized,
        )
        or re.search(r"\b(?:wordless|silent|no-dialogue|no dialog|no dialogue)\b", normalized)
    )


def _storyboard_blank_non_spoken_dialog_rows(text: str, *, force_no_dialogue: bool = False) -> str:
    if force_no_dialogue:
        return re.sub(
            r"(?m)^(?P<prefix>\s*(?:[-*]\s*)?DIALOG\s*:\s*).*$",
            lambda match: match.group("prefix").rstrip() + " ",
            text,
        )

    non_spoken_values = (
        r"silence|silent|none|n/?a|no dialogue|no dialog|no spoken dialogue|no spoken lines|"
        r"wordless|breath|breathing|reaction cue|nonverbal cue|non-verbal cue|"
        r"silent reaction|quiet reaction"
    )

    def replace_row(match: re.Match[str]) -> str:
        prefix = match.group("prefix")
        value = match.group("value").strip()
        if re.fullmatch(non_spoken_values, value, flags=re.IGNORECASE):
            return prefix.rstrip() + " "
        return match.group(0)

    return re.sub(
        rf"(?m)^(?P<prefix>\s*(?:[-*]\s*)?DIALOG\s*:\s*)(?P<value>{non_spoken_values})\s*$",
        replace_row,
        text,
        flags=re.IGNORECASE,
    )


def _storyboard_user_owned_panel_notes(values: Dict[str, str]) -> Dict[int, str]:
    raw = str(values.get("panel_notes_cues") or "")
    notes: Dict[int, str] = {}
    for match in re.finditer(
        r"(?is)(?:^|\s)PANEL\s+0?(?P<number>\d{1,2})\s*(?:[:\-—])\s*"
        r"(?P<value>.*?)"
        r"(?=(?:\s+PANEL\s+0?\d{1,2}\s*(?:[:\-—]))|\s*$)",
        raw,
    ):
        value = re.sub(r"\s+", " ", match.group("value")).strip()
        if value:
            notes[int(match.group("number"))] = value
    return notes


def _storyboard_apply_user_owned_panel_notes(text: str, values: Dict[str, str]) -> str:
    notes = _storyboard_user_owned_panel_notes(values)
    if not notes:
        return text
    heading = re.compile(
        r"(?im)^[ \t]*(?:\d+\.\s*)?(?:PANEL|CELL)\s+0?(?P<number>\d{1,2})"
        r"(?:\s+IMAGE(?:\s+AND\s+METADATA)?)?\s*(?:[:\-—][ \t]*|$)",
    )
    matches = list(heading.finditer(text))
    if not matches:
        return text
    parts: List[str] = [text[: matches[0].start()]]
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        block = text[match.start() : end]
        value = notes.get(int(match.group("number")))
        if value:
            notes_row = re.compile(r"(?im)^(?P<prefix>[ \t]*(?:[-*][ \t]*)?NOTES[ \t]*:[ \t]*).*$")
            if notes_row.search(block):
                block = notes_row.sub(
                    lambda row: f"{row.group('prefix').rstrip()} {value}",
                    block,
                    count=1,
                )
            else:
                dialog_row = re.compile(r"(?im)^(?P<row>[ \t]*(?:[-*][ \t]*)?DIALOG[ \t]*:[^\r\n]*)$")
                if dialog_row.search(block):
                    block = dialog_row.sub(lambda row: f"{row.group('row')}\nNOTES: {value}", block, count=1)
        parts.append(block)
    return "".join(parts)


def _storyboard_generated_metadata_fallback(label: str, number: int) -> str:
    if label == "ACTION":
        return f"The panel advances beat {number} with a clear visible story action."
    if label == "MOTION":
        return f"Camera drift and subject movement keep beat {number} readable."
    if label == "NOTES":
        return f"Preserve reference continuity and readable production details for beat {number}."
    return ""


def _storyboard_fill_missing_generated_metadata_rows(text: str) -> str:
    """Fill provider-omitted storyboard metadata rows before strict validation.

    The storyboard compiler remains fail-closed. This sanitizer only handles the
    narrow provider-output case where a panel row exists but a generated
    non-user-owned metadata value is empty or absent after recipe execution and
    repair. DIALOG may be intentionally blank; required narrative rows receive
    neutral semantic values that do not invent new plot events.
    """

    heading = re.compile(
        r"(?im)^[ \t]*(?:\d+\.\s*)?(?:PANEL|CELL)\s+0?(?P<number>\d{1,2})"
        r"(?:\s+IMAGE(?:\s+AND\s+METADATA)?)?\s*(?:[:\-—][ \t]*|$)",
    )
    matches = list(heading.finditer(text))
    if not matches:
        return text

    row_pattern_template = r"(?im)^(?P<prefix>[ \t]*(?:[-*][ \t]*)?%s[ \t]*:[ \t]*)(?P<value>[^\r\n]*)$"
    required_order = ("SHOT", "CAMERA", "ACTION", "MOTION", "DIALOG", "NOTES")
    parts: List[str] = [text[: matches[0].start()]]
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        block = text[match.start() : end]
        number = int(match.group("number"))
        missing_rows: list[str] = []
        for label in required_order:
            row_pattern = re.compile(row_pattern_template % re.escape(label))
            existing = row_pattern.search(block)
            if existing:
                if label in {"ACTION", "MOTION", "NOTES"} and not existing.group("value").strip():
                    fallback = _storyboard_generated_metadata_fallback(label, number)
                    block = row_pattern.sub(lambda row, value=fallback: f"{row.group('prefix')}{value}", block, count=1)
                continue
            fallback = _storyboard_generated_metadata_fallback(label, number)
            missing_rows.append(f"{label}: {fallback}")
        if missing_rows:
            separator = "" if block.endswith(("\n", "\r")) else "\n"
            block = f"{block}{separator}" + "\n".join(missing_rows)
        parts.append(block)
    return "".join(parts)


def _storyboard_requested_dialogue_values(raw: object) -> List[str]:
    text = str(raw or "")
    values: List[str] = []
    seen: set[str] = set()
    for match in re.finditer(r'"([^"\r\n]+)"|“([^”\r\n]+)”', text):
        value = match.group(1) if match.group(1) is not None else match.group(2)
        value = str(value or "").strip()
        if value and value not in seen:
            seen.add(value)
            values.append(value)
    return values


def _storyboard_apply_missing_requested_dialogue(text: str, values: Dict[str, str]) -> str:
    requested = _storyboard_requested_dialogue_values(values.get("dialogue_cues"))
    if not requested:
        return text

    dialog_row = re.compile(r"(?im)^(?P<prefix>[ \t]*(?:[-*][ \t]*)?DIALOG[ \t]*:[ \t]*)(?P<value>[^\r\n]*)$")
    rows = list(dialog_row.finditer(text))
    if not rows:
        return text
    rendered_dialogue = "\n".join(row.group("value") for row in rows)
    missing = [line for line in requested if line not in rendered_dialogue]
    if not missing:
        return text

    output = text
    offset = 0
    blank_rows = [row for row in rows if not row.group("value").strip()]
    target_rows = blank_rows + [row for row in rows if row.group("value").strip()]
    for line, row in zip(missing, target_rows):
        row_start = row.start() + offset
        row_end = row.end() + offset
        current = output[row_start:row_end]
        current_match = dialog_row.match(current)
        if not current_match:
            continue
        prefix = current_match.group("prefix")
        existing = current_match.group("value").strip()
        replacement_value = f'"{line}"' if not existing else f'{existing} / "{line}"'
        if len(replacement_value) > STORYBOARD_METADATA_DISPLAY_LIMITS["DIALOG"]:
            replacement_value = f'"{line}"'
        replacement = f"{prefix}{replacement_value}"
        output = f"{output[:row_start]}{replacement}{output[row_end:]}"
        offset += len(replacement) - (row_end - row_start)
    return output


def _singular_storyboard_noun(value: str) -> str:
    normalized = value.strip()
    if normalized.endswith("ies"):
        return normalized[:-3] + "y"
    if normalized.endswith("s") and len(normalized) > 1:
        return normalized[:-1]
    return normalized


def _storyboard_requested_story_text(values: Dict[str, str]) -> str:
    user_text = str(values.get("user_prompt") or "")
    if not user_text.strip():
        return ""
    for pattern in (
        r"Mandatory story beats[^:]*:\s*(?P<text>.*?)(?:\.\s+If there are more beats|\nQuantity precision:|\nDialogue preference:|\nPanel count:|\Z)",
        r"Story\s*/\s*scene brief:\s*(?P<text>.*?)(?:\nMandatory story beats|\nQuantity precision:|\nDialogue preference:|\nPanel count:|\Z)",
    ):
        match = re.search(pattern, user_text, flags=re.IGNORECASE | re.DOTALL)
        if match:
            extracted = re.sub(r"\s+", " ", match.group("text")).strip(" .")
            if extracted:
                return extracted
    return re.sub(r"\s+", " ", user_text).strip()


def _storyboard_preserve_requested_quantities(text: str, values: Dict[str, str]) -> str:
    user_text = _storyboard_requested_story_text(values)
    if not user_text.strip():
        return text
    patterns = (
        r"\b(?:kills?|slays?|defeats?|takes?\s+down)\s+(?P<count>2|two|3|three|4|four)\s+(?P<noun>[a-z][a-z -]{1,40}?)\b(?=,|\.|;| and\b| then\b|$)",
        r"\b(?P<count>2|two|3|three|4|four)\s+(?P<noun>[a-z][a-z -]{1,40}?)\s+(?:are|were|watch|guard|attack|chase|fall|die|collapse)\b",
    )
    requested: list[tuple[str, str]] = []
    for pattern in patterns:
        for match in re.finditer(pattern, user_text, flags=re.IGNORECASE):
            count = STORYBOARD_COUNT_WORDS.get(match.group("count").lower(), match.group("count").lower())
            noun = re.sub(r"\s+", " ", match.group("noun").strip().lower())
            if noun:
                requested.append((count, noun))
    if not requested:
        return text
    updated = text
    reminders: list[str] = []
    seen: set[tuple[str, str]] = set()
    for count, noun in requested:
        key = (count, noun)
        if key in seen:
            continue
        seen.add(key)
        singular = _singular_storyboard_noun(noun)
        updated = re.sub(rf"\bone\s+{re.escape(singular)}\b", f"{count} {noun}", updated, flags=re.IGNORECASE)
        updated = re.sub(rf"\b1\s+{re.escape(singular)}\b", f"{count} {noun}", updated, flags=re.IGNORECASE)
        if not re.search(rf"\b{re.escape(count)}\s+{re.escape(noun)}\b", updated, flags=re.IGNORECASE):
            reminders.append(f"{count} {noun}")
    if reminders:
        updated = (
            updated.rstrip()
            + "\n\nQUANTITY CHECK: Preserve the requested count in the storyboard panel ACTION/NOTES text: "
            + "; ".join(reminders)
            + ". Do not reduce requested quantities to one."
        )
    return updated


def _storyboard_phrase_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def _storyboard_requested_action_beats(values: Dict[str, str]) -> List[str]:
    story_text = _storyboard_requested_story_text(values)
    if not story_text:
        return []
    action_verbs = (
        r"breaks?|bursts?|runs?|sprints?|escapes?|flees?|kills?|slays?|defeats?|takes?\s+down|"
        r"melts?|uses?|casts?|steals?|grabs?|opens?|unlocks?|fights?|chases?|charges?|"
        r"enters?|leaves?|falls?|jumps?|climbs?|reaches?|discovers?|finds?|activates?"
    )
    ignored_terms = {
        "dialogue",
        "dialog",
        "seedance",
        "video node",
        "image reference",
        "gpt image",
        "storyboard",
        "character sheet",
    }
    clauses: list[str] = []
    for sentence in re.split(r"[.;]", story_text):
        if re.search(r"\b(?:do not|don't|never|avoid|without)\b", sentence, flags=re.IGNORECASE):
            continue
        clauses.extend(re.split(r"(?:,|\band then\b|\bthen\b|\band\b)", sentence, flags=re.IGNORECASE))
    beats: List[str] = []
    seen: set[str] = set()
    for clause in clauses:
        phrase = re.sub(r"\s+", " ", clause).strip(" .")
        phrase = re.sub(r"^(?:she|he|they|the character|the woman|the man|the lead)\s+", "", phrase, flags=re.IGNORECASE)
        phrase_lower = phrase.lower()
        if re.search(r"\b(?:do not|don't|never|avoid|without)\b", phrase_lower):
            continue
        if phrase_lower.startswith("use ") and any(
            term in phrase_lower for term in ("character image", "environment sheet", "reference image", "connected image")
        ):
            continue
        if not phrase or any(term in phrase.lower() for term in ignored_terms):
            continue
        if len(phrase.split()) < 3 or len(phrase) > 120:
            continue
        if not re.search(rf"\b(?:{action_verbs})\b", phrase, flags=re.IGNORECASE):
            continue
        key = _storyboard_phrase_key(phrase)
        if key and key not in seen:
            seen.add(key)
            beats.append(phrase)
    return beats[:8]


def _storyboard_append_to_last_metadata_row(text: str, *, labels: tuple[str, ...], addition: str) -> str:
    for label in labels:
        matches = list(re.finditer(rf"(?m)^(?P<prefix>\s*(?:[-*]\s*)?{re.escape(label)}\s*:\s*)(?P<value>.*)$", text))
        if not matches:
            continue
        match = matches[-1]
        value = match.group("value").strip()
        separator = "; " if value else ""
        replacement = f"{match.group('prefix')}{value.rstrip(' .;')}{separator}{addition.rstrip(' .;')}."
        return f"{text[:match.start()]}{replacement}{text[match.end():]}"
    return text


def _storyboard_preserve_requested_action_beats(text: str, values: Dict[str, str]) -> str:
    beats = _storyboard_requested_action_beats(values)
    if not beats:
        return text
    output_key = _storyboard_phrase_key(text)
    missing = [beat for beat in beats if _storyboard_phrase_key(beat) not in output_key]
    if not missing:
        return text
    addition = "; ".join(missing)
    updated = _storyboard_append_to_last_metadata_row(text, labels=("NOTES", "ACTION"), addition=addition)
    if updated != text:
        return updated
    return f"{text.rstrip()}\nNOTES: {addition}."


def _storyboard_text_from_structured_json(parsed_json: Any) -> str:
    if not isinstance(parsed_json, dict):
        return ""
    shots = parsed_json.get("shots") or parsed_json.get("panels")
    if not isinstance(shots, list) or not shots:
        return ""
    lines: List[str] = []
    title = str(parsed_json.get("title") or parsed_json.get("storyboard_title") or "").strip()
    if title:
        lines.append(f"Storyboard title: {title}.")
    style = str(parsed_json.get("style") or parsed_json.get("style_direction") or "").strip()
    if style:
        lines.append(f"Style: {style}.")
    lines.append("")
    for index, shot in enumerate(shots, start=1):
        if not isinstance(shot, dict):
            continue
        shot_label = str(shot.get("shot") or shot.get("title") or shot.get("label") or f"{index:02d}").strip()
        lines.append(f"{index}. Panel {index:02d} - {shot_label}")
        for key, label in (
            ("camera", "CAMERA"),
            ("framing", "FRAMING"),
            ("action", "ACTION"),
            ("motion", "MOTION"),
            ("dialog", "DIALOG"),
            ("dialogue", "DIALOG"),
            ("notes", "NOTES"),
        ):
            value = str(shot.get(key) or "").strip()
            if value:
                lines.append(f"   - {label}: {value}")
        lines.append("")
    return "\n".join(lines).strip()


def _storyboard_append_user_owned_directives(text: str, values: Dict[str, str]) -> str:
    directives = (
        ("BOARD TITLE", "board_title"),
        ("PRODUCTION METADATA", "production_metadata"),
        ("HANDOFF ADVANCE", "handoff_advance"),
        ("DIALOGUE CUES", "dialogue_cues"),
        ("WARDROBE CUES", "wardrobe_cues"),
        ("SUBJECT DESIGN CUES", "subject_design_cues"),
    )
    additions: list[str] = []
    for label, key in directives:
        value = re.sub(r"\s+", " ", str(values.get(key) or "")).strip()
        if not value or re.search(rf"(?im)^\s*{re.escape(label)}\s*:", text):
            continue
        additions.append(f"{label}: {value}")
    if not additions:
        return text
    return f"{text.rstrip()}\n\n" + "\n".join(additions)


def _storyboard_private_name_aliases(raw_text: str, values: Dict[str, str]) -> List[str]:
    source_text = "\n".join([raw_text, *(str(values.get(key) or "") for key in ("user_prompt", "previous_output", "previous_storyboard_prompt", "continuation_brief"))])
    aliases: set[str] = set()
    for pattern in (
        r"(?i:\bnamed\s+)([A-Z][A-Za-z0-9_-]{1,40})\b",
        r"(?i:\bcalled\s+)([A-Z][A-Za-z0-9_-]{1,40})\b",
        r"(?i:\b(?:local\s+)?(?:workflow|project|character|media|file|private)?\s*(?:label|nickname)\s+(?:is|as|:)\s*)([A-Z][A-Za-z0-9_-]{1,40})\b",
        r"(?i:\bfor\s+)([A-Z][A-Za-z0-9_-]{1,40})\b",
        r"\b([A-Z][A-Za-z0-9_-]{1,40})['’]s\b",
    ):
        for match in re.finditer(pattern, source_text):
            alias = match.group(1).strip()
            if alias and alias.lower() not in STORYBOARD_PRIVATE_NAME_EXCLUDE:
                aliases.add(alias)
    return sorted(aliases, key=len, reverse=True)


def _storyboard_remove_final_meta_sections(text: str) -> str:
    return re.sub(
        r"(?ims)\n{0,2}(?:STORY BEATS|INTERNAL STORY BEATS|MISSING STORY BEATS)\s*:\s*.*\Z",
        "",
        text,
    ).rstrip()


def _storyboard_cleanup_neutralized_title_footer(text: str) -> str:
    cleaned = re.sub(
        r"(Title at top:\s*[\"“])\s*the character\s*:\s*",
        r"\1",
        text,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(
        r"(PROJECT:\s*)the character\b",
        r"\1CHARACTER STORY",
        cleaned,
        flags=re.IGNORECASE,
    )
    return cleaned


def _storyboard_remove_internal_negative_terms(text: str) -> str:
    cleaned = re.sub(
        r"\s*,?\s*\b(?:model|provider|node|pricing|graph studio|prompt recipe)\s+notes?\b",
        "",
        text,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    cleaned = re.sub(r"\s+,", ",", cleaned)
    cleaned = re.sub(r",\s*,", ",", cleaned)
    return cleaned


def _sanitize_storyboard_v2_prompt_text(raw_text: str, values: Dict[str, str], *, fill_missing_generated_rows: bool = True) -> str:
    parsed_json = _parse_json_maybe(raw_text)
    prompts = _prompts_from_parsed_json(parsed_json) if parsed_json is not None else []
    if prompts:
        raw_text = prompts[0]
    elif parsed_json is not None:
        structured_text = _storyboard_text_from_structured_json(parsed_json)
        if structured_text:
            raw_text = structured_text
    if _storyboard_user_requested_visible_name(values):
        sanitized_visible_name = raw_text.strip()
        if fill_missing_generated_rows:
            sanitized_visible_name = _storyboard_fill_missing_generated_metadata_rows(sanitized_visible_name)
        return _storyboard_append_user_owned_directives(sanitized_visible_name, values)
    sanitized = raw_text.strip()
    for alias in _storyboard_private_name_aliases(sanitized, values):
        sanitized = re.sub(rf"\b{re.escape(alias)}['’]s\b", "the character's", sanitized, flags=re.IGNORECASE)
        sanitized = re.sub(rf"\b{re.escape(alias)}\b", "the character", sanitized, flags=re.IGNORECASE)
    sanitized = re.sub(r"\b(?:character|woman|man|person|subject)\s+the character\b", "character", sanitized, flags=re.IGNORECASE)
    sanitized = re.sub(r"\bthe character\s+character\b", "the character", sanitized, flags=re.IGNORECASE)
    sanitized = re.sub(r"\bcharacter\s+character\b", "character", sanitized, flags=re.IGNORECASE)
    sanitized = re.sub(r"\bthe\s+the character\b", "the character", sanitized, flags=re.IGNORECASE)
    sanitized = re.sub(r"\bthe character\s+the character\b", "the character", sanitized, flags=re.IGNORECASE)
    sanitized = re.sub(r"\bthe character['’]s\s+character\b", "the character", sanitized, flags=re.IGNORECASE)
    sanitized = _storyboard_cleanup_neutralized_title_footer(sanitized)
    sanitized = _storyboard_blank_non_spoken_dialog_rows(
        sanitized,
        force_no_dialogue=_storyboard_user_disabled_dialogue(values),
    )
    sanitized = _storyboard_apply_user_owned_panel_notes(sanitized, values)
    sanitized = _storyboard_preserve_requested_quantities(sanitized, values)
    sanitized = _storyboard_preserve_requested_action_beats(sanitized, values)
    sanitized = _storyboard_remove_final_meta_sections(sanitized)
    sanitized = _storyboard_remove_internal_negative_terms(sanitized)
    if fill_missing_generated_rows:
        sanitized = _storyboard_fill_missing_generated_metadata_rows(sanitized)
    if not re.search(r"\bdark\s+near[- ]?black\b", sanitized, flags=re.IGNORECASE):
        sanitized = (
            "Use a dark near-black production storyboard board background with thin yellow-orange UI lines, "
            "subtle panel borders, clean readable English typography, and readable director-note metadata strips under every cell. "
            + sanitized
        )
    sanitized = _storyboard_append_user_owned_directives(sanitized, values)
    if "do not copy visible name" not in sanitized.lower() and "text guard:" not in sanitized.lower():
        sanitized = f"{sanitized.rstrip()}\n\n{STORYBOARD_COMPACT_REFERENCE_TEXT_GUARD}"
    return sanitized


class PromptTextExecutor(GraphExecutor):
    node_type = "prompt.text"

    def execute(self, node: GraphWorkflowNode, context: GraphExecutionContext) -> Dict[str, List[GraphOutputRef]]:
        mode = str(node.fields.get("mode") or "replace").strip()
        if mode not in PROMPT_TEXT_MODES:
            raise ValueError("Prompt Text mode is not supported.")

        typed_text = str(node.fields.get("text") or "").strip()
        connected_parts = [_text_value(item) for item in context.inputs_for(node, "text")]
        connected_text = "\n\n".join(part for part in connected_parts if part)
        if connected_text and typed_text and mode == "append":
            text = f"{connected_text}\n\n{typed_text}"
        elif connected_text and typed_text and mode == "prepend":
            text = f"{typed_text}\n\n{connected_text}"
        elif connected_text:
            text = connected_text
        else:
            text = typed_text

        if not text:
            raise ValueError("Prompt Text requires typed text or connected text.")
        if len(text) > PROMPT_TEXT_MAX_CHARS:
            raise ValueError(f"Prompt Text output exceeds {PROMPT_TEXT_MAX_CHARS} characters.")
        return {
            "text": [
                GraphOutputRef(
                    kind="value",
                    value=text,
                    metadata={"type": "text", "mode": mode, "connected_input_count": len(connected_parts)},
                )
            ]
        }


class PromptConcatExecutor(GraphExecutor):
    node_type = "prompt.concat"

    def execute(self, node: GraphWorkflowNode, context: GraphExecutionContext) -> Dict[str, List[GraphOutputRef]]:
        inputs = [*context.inputs_for(node, "text_a"), *context.inputs_for(node, "text_b")]
        inline = str(node.fields.get("inline_text") or "").strip()
        separator = str(node.fields.get("separator") if node.fields.get("separator") is not None else "\n\n")
        parts = [str(item.value).strip() for item in inputs if str(item.value or "").strip()]
        if inline:
            parts.append(inline)
        if not parts:
            raise ValueError("Prompt Concat requires at least one text input or inline text.")
        return {"text": [GraphOutputRef(kind="value", value=separator.join(parts), metadata={"type": "text"})]}


class PromptLlmExecutor(GraphExecutor):
    node_type = "prompt.llm"

    def execute(self, node: GraphWorkflowNode, context: GraphExecutionContext) -> Dict[str, List[GraphOutputRef]]:
        mode = str(node.fields.get("mode") or "rewrite_prompt").strip()
        if mode not in PROMPT_LLM_MODES:
            raise ValueError("LLM Prompt mode is not supported.")

        connected_prompt_parts = [_text_value(item) for item in context.inputs_for(node, "user_prompt")]
        connected_prompt = "\n\n".join(part for part in connected_prompt_parts if part)
        user_prompt = connected_prompt or str(node.fields.get("user_prompt") or "").strip()
        system_prompt = str(node.fields.get("system_prompt") or "").strip()
        image_refs = context.inputs_for(node, "image")
        image_paths = [str(graph_ref_path(ref, expected_media_type="image")) for ref in image_refs[:1]]
        if not system_prompt:
            raise ValueError("LLM Prompt requires a system prompt.")
        if not user_prompt and not image_paths:
            raise ValueError("LLM Prompt requires a user prompt or image input.")

        provider = _provider_config(node, has_image=bool(image_paths))
        temperature = _optional_bounded_float(node.fields.get("temperature"), minimum=0, maximum=2)
        max_tokens = _optional_bounded_int(node.fields.get("max_tokens"), minimum=64, maximum=4000)
        if str(provider["provider_kind"]) == "codex_local":
            result = enhancement_provider.run_codex_local_prompt_node(
                model_id=str(provider["provider_model_id"]),
                mode=mode,
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                image_instruction=str(node.fields.get("image_instruction") or "").strip(),
                image_paths=image_paths,
            )
        else:
            result = enhancement_provider.run_openai_compatible_prompt_node(
                provider_kind=str(provider["provider_kind"]),
                base_url=str(provider["provider_base_url"]),
                api_key=str(provider["provider_api_key"] or ""),
                model_id=str(provider["provider_model_id"]),
                mode=mode,
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                image_instruction=str(node.fields.get("image_instruction") or "").strip(),
                image_paths=image_paths,
                temperature=temperature,
                max_tokens=max_tokens,
            )
        generated_text = str(result.get("generated_text") or "").strip()
        if not generated_text:
            raise ValueError("LLM Prompt returned empty text.")
        _record_llm_usage_metric(
            context,
            node,
            provider_result=result,
            source_kind="graph_prompt_llm",
            task_mode=mode,
        )
        metadata = {
            "type": "json",
            "provider_kind": result.get("provider_kind") or provider["provider_kind"],
            "provider_model_id": result.get("provider_model_id") or provider["provider_model_id"],
            "mode": mode,
            "has_image": bool(image_paths),
            "user_prompt_chars": len(user_prompt),
            "system_prompt_chars": len(system_prompt),
            "max_tokens": max_tokens,
            "temperature": temperature,
            "runtime_defaults": "provider" if temperature is None and max_tokens is None else "overridden",
            "warnings": result.get("warnings") if isinstance(result.get("warnings"), list) else [],
        }
        context.record_node_metric(node, "provider_kind", metadata["provider_kind"])
        context.record_node_metric(node, "provider_model_id", metadata["provider_model_id"])
        context.record_node_metric(node, "has_image", metadata["has_image"])
        return {
            "text": [GraphOutputRef(kind="value", value=generated_text, metadata={"type": "text", "source": "prompt.llm"})],
            "metadata": [GraphOutputRef(kind="value", media_type="json", value=metadata, metadata={"type": "json"})],
        }


class PromptImageAnalyzerExecutor(GraphExecutor):
    node_type = "prompt.image_analyzer"

    def execute(self, node: GraphWorkflowNode, context: GraphExecutionContext) -> Dict[str, List[GraphOutputRef]]:
        mode = str(node.fields.get("mode") or "full_analysis").strip()
        if mode not in PROMPT_IMAGE_ANALYZER_MODES:
            raise ValueError("Image Analyzer mode is not supported.")

        image_refs = context.inputs_for(node, "image")
        image_paths = [str(graph_ref_path(ref, expected_media_type="image")) for ref in image_refs[:1]]
        if not image_paths:
            raise ValueError("Image Analyzer requires one image input.")

        system_prompt = str(node.fields.get("system_prompt") or "").strip()
        if not system_prompt:
            raise ValueError("Image Analyzer requires a system prompt.")
        analysis_goal = str(node.fields.get("analysis_goal") or "").strip()
        if len(analysis_goal) > 4000:
            raise ValueError("Image Analyzer analysis goal exceeds 4000 characters.")

        provider = _provider_config(node, has_image=True)
        temperature = _optional_bounded_float(node.fields.get("temperature"), minimum=0, maximum=2)
        max_tokens = _optional_bounded_int(node.fields.get("max_tokens"), minimum=64, maximum=4000)
        messages = _image_analyzer_messages(
            image_paths=image_paths,
            mode=mode,
            system_prompt=system_prompt,
            analysis_goal=analysis_goal,
        )
        if str(provider["provider_kind"]) == "codex_local":
            result = enhancement_provider.run_codex_local_chat(
                model_id=str(provider["provider_model_id"]),
                messages=messages,
                error_context="image analyzer",
            )
        else:
            result = enhancement_provider.run_openai_compatible_chat(
                provider_kind=str(provider["provider_kind"]),
                base_url=str(provider["provider_base_url"]),
                api_key=str(provider["provider_api_key"] or ""),
                model_id=str(provider["provider_model_id"]),
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
                error_context="image analyzer",
            )
        generated_text = str(result.get("generated_text") or "").strip()
        if not generated_text:
            raise ValueError("Image Analyzer returned empty text.")

        _record_llm_usage_metric(
            context,
            node,
            provider_result=result,
            source_kind="graph_image_analyzer",
            task_mode=mode,
        )
        payload = {
            "type": "image_analysis",
            "mode": mode,
            "raw_text": generated_text,
            "final_text": generated_text,
            "provider_kind": result.get("provider_kind") or provider["provider_kind"],
            "provider_model_id": result.get("provider_model_id") or provider["provider_model_id"],
            "has_image": True,
            "analysis_goal": analysis_goal,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "runtime_defaults": "provider" if temperature is None and max_tokens is None else "overridden",
            "warnings": result.get("warnings") if isinstance(result.get("warnings"), list) else [],
        }
        context.record_node_metric(node, "provider_kind", payload["provider_kind"])
        context.record_node_metric(node, "provider_model_id", payload["provider_model_id"])
        context.record_node_metric(node, "has_image", True)
        return {
            "text": [GraphOutputRef(kind="value", value=generated_text, metadata={"type": "text", "source": "prompt.image_analyzer", "mode": mode})],
            "result": [GraphOutputRef(kind="value", media_type="json", value=payload, metadata={"type": "json"})],
        }


class PromptRecipeExecutor(GraphExecutor):
    node_type = "prompt.recipe"

    def execute(self, node: GraphWorkflowNode, context: GraphExecutionContext) -> Dict[str, List[GraphOutputRef]]:
        recipe = _prompt_recipe_for_node(node)
        image_input = recipe.get("image_input_json") or {}
        image_mode = str(image_input.get("mode") or "none").strip() or "none"
        if image_mode not in PROMPT_RECIPE_IMAGE_MODES:
            raise ValueError("Prompt Recipe image mode is invalid.")
        image_paths = _prompt_recipe_image_paths(node, context, recipe)
        if image_input.get("required") and not image_paths:
            raise ValueError("Prompt Recipe requires at least one image reference.")
        max_files = int(image_input.get("max_files") or (1 if image_input.get("enabled") else 0))
        if max_files and len(image_paths) > max_files:
            raise ValueError(f"Prompt Recipe accepts at most {max_files} image reference(s).")

        values = _build_prompt_recipe_values(node, recipe, context)
        if image_mode in {"analyze_then_inject", "both"} and image_paths:
            analysis_prompt = str(recipe.get("image_analysis_prompt") or "").strip()
            if not analysis_prompt:
                raise ValueError("Prompt Recipe image analysis mode requires an image analysis prompt.")
            provider = _provider_config(node, has_image=True)
            temperature = _bounded_float(node.fields.get("temperature"), fallback=float((recipe.get("default_options_json") or {}).get("temperature") or 0.35), minimum=0, maximum=2)
            max_tokens = _bounded_int(node.fields.get("max_tokens"), fallback=int((recipe.get("default_options_json") or {}).get("max_output_tokens") or 1600), minimum=64, maximum=4000)
            if str(provider["provider_kind"]) == "codex_local":
                analysis = enhancement_provider.run_codex_local_chat(
                    model_id=str(provider["provider_model_id"]),
                    messages=_analysis_messages(image_paths, analysis_prompt),
                    error_context="prompt recipe image analysis",
                )
            else:
                analysis = enhancement_provider.run_openai_compatible_chat(
                    provider_kind=str(provider["provider_kind"]),
                    base_url=str(provider["provider_base_url"]),
                    api_key=str(provider["provider_api_key"] or ""),
                    model_id=str(provider["provider_model_id"]),
                    messages=_analysis_messages(image_paths, analysis_prompt),
                    temperature=temperature,
                    max_tokens=max_tokens,
                    error_context="prompt recipe image analysis",
                )
            _record_llm_usage_metric(
                context,
                node,
                provider_result=analysis,
                source_kind="graph_prompt_recipe_analysis",
                recipe_id=str(recipe.get("recipe_id") or "").strip() or None,
                metadata_json={"image_mode": image_mode, "image_count": len(image_paths)},
            )
            values[str(image_input.get("analysis_variable") or "image_analysis")] = str(analysis.get("generated_text") or "").strip()

        rendered_template = _render_prompt_recipe_template(str(recipe.get("system_prompt_template") or ""), values)
        unresolved = _unresolved_prompt_recipe_tokens(rendered_template)
        if unresolved:
            raise ValueError("Prompt Recipe unresolved template variables: %s" % ", ".join(unresolved))
        refinement = str(node.fields.get("refinement") or "").strip()
        if refinement:
            rendered_template = (
                f"{rendered_template}\n\n"
                "ADDITIONAL CREATIVE REFINEMENT FOR THIS RUN:\n"
                f"{refinement}"
            )

        use_direct_image_context = image_mode in {"direct_reference", "both"} and bool(image_paths)
        provider = _provider_config(node, has_image=use_direct_image_context)
        default_options = recipe.get("default_options_json") or {}
        temperature = _bounded_float(node.fields.get("temperature"), fallback=float(default_options.get("temperature") or 0.35), minimum=0, maximum=2)
        max_tokens = _bounded_int(node.fields.get("max_tokens"), fallback=int(default_options.get("max_output_tokens") or 1600), minimum=64, maximum=4000)
        messages = _final_recipe_messages(
            rendered_template=rendered_template,
            output_format=str(recipe.get("output_format") or "single_prompt"),
            image_paths=image_paths,
            use_direct_image_context=use_direct_image_context,
        )
        response_format = (
            {"type": "json_object"}
            if str(recipe.get("output_format") or "") in PROMPT_RECIPE_STRUCTURED_FORMATS or str(recipe.get("output_format") or "") in PROMPT_RECIPE_JSON_OPTIONAL_FORMATS
            else None
        )
        if str(provider["provider_kind"]) == "codex_local":
            result = enhancement_provider.run_codex_local_chat(
                model_id=str(provider["provider_model_id"]),
                messages=messages,
                response_format=response_format,
                error_context="prompt recipe execution",
            )
        else:
            result = enhancement_provider.run_openai_compatible_chat(
                provider_kind=str(provider["provider_kind"]),
                base_url=str(provider["provider_base_url"]),
                api_key=str(provider["provider_api_key"] or ""),
                model_id=str(provider["provider_model_id"]),
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
                response_format=response_format,
                error_context="prompt recipe execution",
            )
        _record_llm_usage_metric(
            context,
            node,
            provider_result=result,
            source_kind="graph_prompt_recipe_final",
            recipe_id=str(recipe.get("recipe_id") or "").strip() or None,
            metadata_json={"image_mode": image_mode, "image_count": len(image_paths)},
        )
        raw_text = str(result.get("generated_text") or "").strip()
        if not raw_text:
            raise ValueError("Prompt Recipe returned empty text.")
        if _is_storyboard_v2_recipe(recipe):
            raw_text = _sanitize_storyboard_v2_prompt_text(raw_text, values, fill_missing_generated_rows=False)
            if str(provider["provider_kind"]) == "codex_local":
                contract_error = _storyboard_prompt_contract_error(recipe, raw_text, values)
                for retry_number in range(1, STORYBOARD_CONTRACT_REPAIR_ATTEMPTS + 1):
                    if not contract_error:
                        break
                    repair_result = enhancement_provider.run_codex_local_chat(
                        model_id=str(provider["provider_model_id"]),
                        messages=_storyboard_contract_repair_messages(
                            messages,
                            raw_text=raw_text,
                            contract_error=contract_error,
                        ),
                        response_format=response_format,
                        error_context="prompt recipe storyboard contract repair",
                    )
                    _record_llm_usage_metric(
                        context,
                        node,
                        provider_result=repair_result,
                        source_kind="graph_prompt_recipe_contract_retry",
                        recipe_id=str(recipe.get("recipe_id") or "").strip() or None,
                        metadata_json={
                            "image_mode": image_mode,
                            "image_count": len(image_paths),
                            "contract_error": contract_error,
                            "retry_number": retry_number,
                        },
                    )
                    raw_text = str(repair_result.get("generated_text") or "").strip()
                    if not raw_text:
                        raise ValueError("Prompt Recipe storyboard contract repair returned empty text.")
                    raw_text = _sanitize_storyboard_v2_prompt_text(raw_text, values, fill_missing_generated_rows=False)
                    contract_error = _storyboard_prompt_contract_error(recipe, raw_text, values)
                if contract_error:
                    raw_text = _compact_storyboard_generated_display_rows(raw_text)
                    contract_error = _storyboard_prompt_contract_error(recipe, raw_text, values)
                if contract_error:
                    raw_text = _storyboard_fill_missing_generated_metadata_rows(raw_text)
                    contract_error = _storyboard_prompt_contract_error(recipe, raw_text, values)
                if contract_error and "missing exact requested dialogue" in contract_error:
                    raw_text = _storyboard_apply_missing_requested_dialogue(raw_text, values)
                    contract_error = _storyboard_prompt_contract_error(recipe, raw_text, values)
                if contract_error:
                    raise ValueError(
                        "Prompt Recipe storyboard contract repair failed: "
                        f"{contract_error}"
                    )
        canonical = _normalize_prompt_recipe_result(recipe, raw_text)
        if _is_storyboard_v2_recipe(recipe):
            canonical["panel_notes_cues"] = str(values.get("panel_notes_cues") or "")
            canonical["dialogue_cues"] = str(values.get("dialogue_cues") or "")
        canonical.update(
            {
                "provider_kind": result.get("provider_kind") or provider["provider_kind"],
                "provider_model_id": result.get("provider_model_id") or provider["provider_model_id"],
                "image_mode": image_mode,
                "image_count": len(image_paths),
            }
        )
        metadata = {
            "type": "json",
            "source": "prompt.recipe",
            "recipe_id": canonical["recipe_id"],
            "recipe_key": canonical["recipe_key"],
            "output_format": canonical["output_format"],
            "provider_kind": canonical["provider_kind"],
            "provider_model_id": canonical["provider_model_id"],
            "image_count": canonical["image_count"],
        }
        prompt_semantics = (
            STORYBOARD_METADATA_PROMPT_SEMANTICS
            if _is_storyboard_v2_recipe(recipe)
            else PROMPT_RECIPE_SEMANTICS.get(str(recipe.get("key") or "").strip().lower())
        )
        if prompt_semantics:
            metadata["prompt_semantics"] = prompt_semantics
        context.record_node_metric(node, "recipe_key", canonical["recipe_key"])
        context.record_node_metric(node, "output_format", canonical["output_format"])
        context.record_node_metric(node, "prompt_count", len(canonical.get("prompts") or []))
        context.record_node_metric(node, "image_count", canonical["image_count"])
        return {
            "text": [GraphOutputRef(kind="value", value=canonical["final_text"], metadata={"type": "text", **metadata})],
            "result": [GraphOutputRef(kind="value", media_type="json", value=canonical, metadata={"type": "json", **metadata})],
        }


class PromptParseExecutor(GraphExecutor):
    node_type = "prompt.parse"

    def execute(self, node: GraphWorkflowNode, context: GraphExecutionContext) -> Dict[str, List[GraphOutputRef]]:
        incoming = context.inputs_for(node, "result")
        if not incoming:
            raise ValueError("Prompt Parse requires a Prompt Recipe result or prompt-list JSON input.")
        payload = incoming[0].value
        if isinstance(payload, list):
            prompts = payload
            result_payload: Dict[str, Any] = {"prompts": payload, "source": incoming[0].metadata.get("source")}
        elif isinstance(payload, dict):
            prompts = payload.get("prompts")
            result_payload = payload
        else:
            raise ValueError("Prompt Parse expects a canonical Prompt Recipe result or a JSON prompt list.")
        if not isinstance(prompts, list):
            raise ValueError("Prompt Parse result payload is missing prompts.")
        outputs: Dict[str, List[GraphOutputRef]] = {
            "result": [GraphOutputRef(kind="value", media_type="json", value=result_payload, metadata={"type": "json", "source": "prompt.parse"})]
        }
        for index, prompt in enumerate(prompts[:12], start=1):
            text = _item_prompt_text(prompt) if not isinstance(prompt, str) else _trim_prompt_line(prompt)
            if text:
                outputs[f"prompt_{index}"] = [
                    GraphOutputRef(kind="value", value=text, metadata={"type": "text", "source": "prompt.parse", "prompt_index": index})
                ]
        context.record_node_metric(node, "prompt_count", len(prompts))
        return outputs
