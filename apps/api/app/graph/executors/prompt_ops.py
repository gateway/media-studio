from __future__ import annotations

from typing import Any, Dict, List

from ... import enhancement_provider, store
from ...settings import settings
from ..media_refs import graph_ref_path

from ..schemas import GraphOutputRef, GraphWorkflowNode
from .base import GraphExecutionContext, GraphExecutor


GLOBAL_ENHANCEMENT_CONFIG_KEY = "__studio_enhancement__"
PROMPT_LLM_MODES = {"rewrite_prompt", "describe_image", "custom"}
PROMPT_LLM_PROVIDERS = {"studio_default", "openrouter", "local_openai"}
PROMPT_TEXT_MODES = {"replace", "append", "prepend"}
PROMPT_TEXT_MAX_CHARS = 32000


def _text_value(ref: GraphOutputRef) -> str:
    if ref.kind == "value":
        return str(ref.value or "").strip()
    return ""


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


def _studio_default_config() -> Dict[str, Any]:
    return store.get_enhancement_config(GLOBAL_ENHANCEMENT_CONFIG_KEY) or {}


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
        provider_supports_images = bool(config.get("provider_supports_images"))
        provider_base_url = str(config.get("provider_base_url") or "").strip()
        provider_api_key = str(config.get("provider_api_key") or "").strip()
    else:
        provider_kind = requested_provider
        provider_model_id = str(node.fields.get("model_id") or "").strip()
        provider_supports_images = bool(node.fields.get("model_supports_images"))
        provider_base_url = ""
        provider_api_key = ""
        config = _studio_default_config()
        if str(config.get("provider_kind") or "").strip() == provider_kind:
            provider_base_url = str(config.get("provider_base_url") or "").strip()
            provider_api_key = str(config.get("provider_api_key") or "").strip()

    if provider_kind not in {"openrouter", "local_openai"}:
        raise ValueError("LLM Prompt supports OpenRouter or local OpenAI-compatible providers.")
    if not provider_model_id:
        raise ValueError("LLM Prompt requires a provider model id.")
    if has_image and not provider_supports_images:
        raise ValueError("The selected LLM Prompt model is not marked as image-capable.")

    if provider_kind == "openrouter":
        provider_base_url = provider_base_url or settings.openrouter_base_url
        provider_api_key = provider_api_key or str(settings.openrouter_api_key or "")
    else:
        provider_base_url = provider_base_url or settings.local_openai_base_url
        provider_api_key = provider_api_key or str(settings.local_openai_api_key or "")
    return {
        "provider_kind": provider_kind,
        "provider_model_id": provider_model_id,
        "provider_base_url": provider_base_url,
        "provider_api_key": provider_api_key,
        "provider_supports_images": provider_supports_images,
    }


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
        temperature = _bounded_float(node.fields.get("temperature"), fallback=0.3, minimum=0, maximum=2)
        max_tokens = _bounded_int(node.fields.get("max_tokens"), fallback=1200, minimum=64, maximum=4000)
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
            "warnings": result.get("warnings") if isinstance(result.get("warnings"), list) else [],
        }
        context.record_node_metric(node, "provider_kind", metadata["provider_kind"])
        context.record_node_metric(node, "provider_model_id", metadata["provider_model_id"])
        context.record_node_metric(node, "has_image", metadata["has_image"])
        return {
            "text": [GraphOutputRef(kind="value", value=generated_text, metadata={"type": "text", "source": "prompt.llm"})],
            "metadata": [GraphOutputRef(kind="value", media_type="json", value=metadata, metadata={"type": "json"})],
        }
