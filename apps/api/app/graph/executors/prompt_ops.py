from __future__ import annotations

import json
import re
from typing import Any, Dict, List

from ... import enhancement_provider, external_llm_usage, store
from ...settings import settings
from ..media_refs import graph_ref_path
from ..schemas import GraphOutputRef, GraphWorkflowNode
from .base import GraphExecutionContext, GraphExecutor


GLOBAL_ENHANCEMENT_CONFIG_KEY = "__studio_enhancement__"
PROMPT_LLM_MODES = {"rewrite_prompt", "describe_image", "custom"}
PROMPT_LLM_PROVIDERS = {"studio_default", "openrouter", "local_openai", "codex_local"}
PROMPT_TEXT_MODES = {"replace", "append", "prepend"}
PROMPT_TEXT_MAX_CHARS = 32000
PROMPT_RECIPE_TEXT_VARIABLES = {
    "user_prompt",
    "source_prompt",
    "previous_output",
    "image_analysis",
    "source_image_prompt",
    "shot_count",
    "duration_seconds",
    "aspect_ratio",
    "output_format",
    "style_direction",
}
PROMPT_RECIPE_IMAGE_MODES = {"none", "direct_reference", "analyze_then_inject", "both"}
PROMPT_RECIPE_STRUCTURED_FORMATS = {"prompt_list", "json_prompt_batch", "structured_shot_sequence"}
PROMPT_RECIPE_JSON_OPTIONAL_FORMATS = {"image_analysis"}
PROMPT_RECIPE_TOKEN_RE = re.compile(r"\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}")
PROMPT_LINE_NUMBER_RE = re.compile(r"^\s*(?:[-*]|\d+[.)])\s*")


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
    return store.get_enhancement_config(GLOBAL_ENHANCEMENT_CONFIG_KEY) or {}


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
    legacy_value = fields.get("model_supports_images")
    if isinstance(legacy_value, bool):
        return legacy_value
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
    if not recipe_id and node.type.startswith("prompt.recipe."):
        from ..registry import registry

        recipe_id = str(registry.get_definition(node.type).source.get("recipe_id") or "").strip()
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


def _prompt_recipe_image_paths(node: GraphWorkflowNode, context: GraphExecutionContext) -> List[str]:
    return [str(graph_ref_path(ref, expected_media_type="image")) for ref in context.inputs_for(node, "image_refs")]


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

    for variable in recipe.get("input_variables_json") or []:
        key = str(variable.get("key") or "").strip()
        if not key or not bool(variable.get("enabled", True)):
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


class PromptRecipeExecutor(GraphExecutor):
    node_type = "prompt.recipe"

    def execute(self, node: GraphWorkflowNode, context: GraphExecutionContext) -> Dict[str, List[GraphOutputRef]]:
        recipe = _prompt_recipe_for_node(node)
        image_input = recipe.get("image_input_json") or {}
        image_mode = str(image_input.get("mode") or "none").strip() or "none"
        if image_mode not in PROMPT_RECIPE_IMAGE_MODES:
            raise ValueError("Prompt Recipe image mode is invalid.")
        image_paths = _prompt_recipe_image_paths(node, context)
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
        canonical = _normalize_prompt_recipe_result(recipe, raw_text)
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
            raise ValueError("Prompt Parse requires a Prompt Recipe result input.")
        payload = incoming[0].value
        if not isinstance(payload, dict):
            raise ValueError("Prompt Parse expects a canonical Prompt Recipe result payload.")
        prompts = payload.get("prompts")
        if not isinstance(prompts, list):
            raise ValueError("Prompt Parse result payload is missing prompts.")
        outputs: Dict[str, List[GraphOutputRef]] = {
            "result": [GraphOutputRef(kind="value", media_type="json", value=payload, metadata={"type": "json", "source": "prompt.parse"})]
        }
        for index, prompt in enumerate(prompts[:12], start=1):
            text = _item_prompt_text(prompt) if not isinstance(prompt, str) else _trim_prompt_line(prompt)
            if text:
                outputs[f"prompt_{index}"] = [
                    GraphOutputRef(kind="value", value=text, metadata={"type": "text", "source": "prompt.parse", "prompt_index": index})
                ]
        context.record_node_metric(node, "prompt_count", len(prompts))
        return outputs
