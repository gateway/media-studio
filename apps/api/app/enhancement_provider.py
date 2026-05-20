from __future__ import annotations

import base64
import json
import mimetypes
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx

from . import codex_local_provider
from .settings import settings

ENHANCEMENT_HTTP_TIMEOUT_SECONDS = 80.0
ENHANCEMENT_MAX_COMPLETION_TOKENS = 900
OPENROUTER_MODELS_CACHE_TTL_SECONDS = 600.0

_OPENROUTER_MODELS_CACHE: Dict[str, Any] = {"fetched_at": 0.0, "base_url": None, "models": []}


class EnhancementProviderError(Exception):
    pass


def _render_enhancement_template(
    template: Optional[str],
    *,
    prompt: str,
    media_model_key: str,
    task_mode: Optional[str],
    has_image: bool,
) -> tuple[str, bool]:
    raw = (template or "").strip()
    if not raw:
        return "", False
    replacements = {
        "{user_prompt}": prompt or "",
        "{media_model}": media_model_key or "",
        "{task_mode}": task_mode or "default",
        "{has_image}": "true" if has_image else "false",
    }
    rendered = raw
    used_user_prompt_placeholder = "{user_prompt}" in rendered
    for placeholder, value in replacements.items():
        rendered = rendered.replace(placeholder, value)
    return rendered, used_user_prompt_placeholder


def render_prompt_node_template(template: Optional[str], *, user_prompt: str, has_image: bool, mode: str) -> tuple[str, bool]:
    raw = (template or "").strip()
    if not raw:
        return "", False
    replacements = {
        "{user_prompt}": user_prompt or "",
        "[user_prompt]": user_prompt or "",
        "{has_image}": "true" if has_image else "false",
        "[has_image]": "true" if has_image else "false",
        "{mode}": mode or "custom",
        "[mode]": mode or "custom",
    }
    rendered = raw
    used_user_prompt_placeholder = any(placeholder in rendered for placeholder in ("{user_prompt}", "[user_prompt]"))
    for placeholder, value in replacements.items():
        rendered = rendered.replace(placeholder, value)
    return rendered, used_user_prompt_placeholder


def _openrouter_headers(api_key: str) -> Dict[str, str]:
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }


def _http_client() -> httpx.Client:
    return httpx.Client(timeout=ENHANCEMENT_HTTP_TIMEOUT_SECONDS, follow_redirects=True)


def _normalize_enhancement_prompt(text: Optional[str]) -> str:
    return " ".join(str(text or "").split()).strip().casefold()


def _supports_images_from_modalities(modalities: List[str]) -> bool:
    normalized = {str(value).strip().lower() for value in modalities if str(value).strip()}
    return "image" in normalized or "images" in normalized


def _should_cache_openrouter_models(api_key: Optional[str], base_url: Optional[str]) -> bool:
    resolved_base_url = str(base_url or settings.openrouter_base_url).rstrip("/")
    return api_key is None and resolved_base_url == str(settings.openrouter_base_url).rstrip("/")


def _openai_compatible_headers(api_key: Optional[str]) -> Dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    return headers


def _image_path_to_data_url(image_path: str) -> str:
    path = Path(image_path)
    if not path.is_absolute():
        path = settings.data_root / path
    if not path.exists():
        raise EnhancementProviderError(f"Image for enhancement was not found: {image_path}")
    mime_type = mimetypes.guess_type(path.name)[0] or "image/png"
    payload = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime_type};base64,{payload}"


def _extract_message_text(payload: Dict[str, Any]) -> str:
    choices = payload.get("choices") or []
    if not choices:
        raise EnhancementProviderError("Enhancement provider returned no choices.")
    message = choices[0].get("message") or {}
    refusal = message.get("refusal")
    if isinstance(refusal, str) and refusal.strip():
        raise EnhancementProviderError(f"Enhancement provider refused the request: {refusal.strip()}")
    content = message.get("content")
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        chunks: List[str] = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                chunks.append(str(item.get("text") or "").strip())
        return "\n".join(chunk for chunk in chunks if chunk).strip()
    reasoning = message.get("reasoning")
    if isinstance(reasoning, str) and reasoning.strip():
        raise EnhancementProviderError(
            "Enhancement provider returned reasoning tokens without a final answer. Disable reasoning for this provider or switch the enhancement model in Settings."
        )
    return ""


def _extract_usage_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    usage = payload.get("usage") if isinstance(payload.get("usage"), dict) else {}
    merged = dict(usage)
    for key in ("prompt_tokens", "completion_tokens", "total_tokens"):
        if merged.get(key) is None and payload.get(key) is not None:
            merged[key] = payload.get(key)
    if merged.get("cost") is None:
        for key in ("cost", "total_cost"):
            if payload.get(key) is not None:
                merged["cost"] = payload.get(key)
                break
    return merged


def _parse_enhancement_response(raw_text: str) -> Dict[str, Any]:
    cleaned = raw_text.strip()
    if not cleaned:
        raise EnhancementProviderError("Enhancement provider returned an empty response.")
    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass
    return {"enhanced_prompt": cleaned, "image_analysis": None, "warnings": []}


def _build_rewrite_messages(
    *,
    prompt: str,
    media_model_key: str,
    task_mode: Optional[str],
    system_prompt: Optional[str],
    image_analysis_prompt: Optional[str],
    image_paths: List[str],
) -> List[Dict[str, Any]]:
    rendered_system_prompt, used_user_prompt_placeholder = _render_enhancement_template(
        system_prompt,
        prompt=prompt,
        media_model_key=media_model_key,
        task_mode=task_mode,
        has_image=bool(image_paths),
    )
    rendered_image_analysis_prompt, _ = _render_enhancement_template(
        image_analysis_prompt,
        prompt=prompt,
        media_model_key=media_model_key,
        task_mode=task_mode,
        has_image=bool(image_paths),
    )
    effective_system_prompt = (
        rendered_system_prompt
        or "You improve media-generation prompts. Return strict JSON with keys enhanced_prompt, image_analysis, warnings. Preserve user intent while making the prompt richer, more specific, and more cinematic."
    )
    user_text = (
        "Rewrite the user's media-generation prompt into a materially stronger production-ready prompt.\n"
        f"Media model: {media_model_key}\n"
        f"Task mode: {task_mode or 'default'}\n"
    )
    if not used_user_prompt_placeholder:
        user_text += f"Original prompt: {prompt or '(empty)'}\n"
    if image_paths:
        user_text += (
            f"Image analysis request: {(rendered_image_analysis_prompt or 'Analyze the staged reference image and use it to improve the rewritten prompt.').strip()}\n"
            "If image context is useful, include a short image_analysis string in the JSON response.\n"
        )
    else:
        user_text += "No image is attached.\n"
    user_text += (
        "Requirements:\n"
        "- keep any [image reference X] tokens exactly as written\n"
        "- preserve the original subject and intent\n"
        "- add concrete visual detail, lighting, composition, texture, and cinematic cues\n"
        "- do not mention camera settings unless they help the generation prompt\n"
        "- enhanced_prompt must not simply repeat the original prompt\n"
        "Return only valid JSON.\n"
    )
    content: List[Dict[str, Any]] = [{"type": "text", "text": user_text}]
    for image_path in image_paths:
        content.append(
            {
                "type": "image_url",
                "image_url": {"url": _image_path_to_data_url(image_path)},
            }
        )
    return [
        {"role": "system", "content": effective_system_prompt},
        {"role": "user", "content": content},
    ]


def build_prompt_node_messages(
    *,
    mode: str,
    system_prompt: Optional[str],
    user_prompt: str,
    image_instruction: Optional[str],
    image_paths: List[str],
) -> List[Dict[str, Any]]:
    rendered_system_prompt, used_user_prompt_placeholder = render_prompt_node_template(
        system_prompt,
        user_prompt=user_prompt,
        has_image=bool(image_paths),
        mode=mode,
    )
    effective_system_prompt = rendered_system_prompt or (
        "You are a Media Studio prompt assistant. Return one production-ready prompt as plain text. "
        "Be specific, visual, and concise enough for image or video generation."
    )
    mode_instruction = {
        "rewrite_prompt": "Rewrite the user text into a stronger media-generation prompt.",
        "describe_image": "Describe the image as a detailed media-generation prompt.",
        "custom": "Follow the system prompt and produce the requested text output.",
    }.get(mode, "Follow the system prompt and produce the requested text output.")
    user_text = f"Task: {mode_instruction}\n"
    if user_prompt and not used_user_prompt_placeholder:
        user_text += f"User prompt: {user_prompt}\n"
    if image_paths:
        user_text += f"Image instruction: {(image_instruction or 'Use the image as visual context.').strip()}\n"
    else:
        user_text += "Image instruction: no image is attached.\n"
    user_text += "Return only the final prompt text. Do not include labels, markdown fences, or commentary."
    content: List[Dict[str, Any]] = [{"type": "text", "text": user_text}]
    for image_path in image_paths:
        content.append({"type": "image_url", "image_url": {"url": _image_path_to_data_url(image_path)}})
    return [{"role": "system", "content": effective_system_prompt}, {"role": "user", "content": content}]


def build_openai_compatible_multimodal_content(
    *,
    text: str,
    image_paths: List[str],
) -> List[Dict[str, Any]]:
    content: List[Dict[str, Any]] = [{"type": "text", "text": text}]
    for image_path in image_paths:
        content.append({"type": "image_url", "image_url": {"url": _image_path_to_data_url(image_path)}})
    return content


def build_prompt_recipe_draft_messages(
    *,
    idea: str,
    category: Optional[str],
    output_format: Optional[str],
    image_input_mode: Optional[str],
) -> List[Dict[str, Any]]:
    allowed_categories = "image, video, analysis, utility"
    allowed_output_formats = "single_prompt, prompt_list, json_prompt_batch, image_analysis, structured_shot_sequence"
    allowed_image_modes = "none, direct_reference, analyze_then_inject, both"
    system_prompt = (
        "You design Media Studio Prompt Recipes. Return only valid JSON for a prompt recipe draft. "
        "Do not include markdown, comments, or explanations. "
        "The JSON object must use these keys: "
        "label, key, description, category, system_prompt_template, image_analysis_prompt, "
        "user_prompt_placeholder, output_format, output_contract, input_variables, custom_fields, "
        "image_input, default_options, rules, notes. "
        "Recipe keys must use lowercase letters, numbers, and underscores. "
        "Template variables must use {{variable_name}} syntax. "
        "Allowed categories: %s. Allowed output formats: %s. Allowed image_input.mode values: %s. "
        "Use reserved variables when helpful: user_prompt, image_analysis, source_prompt, source_image_prompt, previous_output, shot_count, duration_seconds, aspect_ratio, output_format, style_direction. "
        "Return a recipe draft that is practical, concise, and save-compatible."
    ) % (allowed_categories, allowed_output_formats, allowed_image_modes)
    user_text = "Recipe idea:\n%s\n" % idea.strip()
    if category:
        user_text += "Requested category: %s\n" % category
    if output_format:
        user_text += "Requested output format: %s\n" % output_format
    if image_input_mode:
        user_text += "Requested image input mode: %s\n" % image_input_mode
    user_text += (
        "Requirements:\n"
        "- include a strong system_prompt_template\n"
        "- enable only variables that the template actually uses\n"
        "- keep user_prompt_placeholder as {{user_prompt}}\n"
        "- include empty arrays/objects where needed instead of omitting required structures\n"
        "- if image input is not needed, set image_input.enabled to false and mode to none\n"
        "- rules should include allow_external_variables and return_only_final_output\n"
        "- default_options should include temperature and max_output_tokens when appropriate\n"
        "- do not invent unsupported field names\n"
        "Return only the JSON object."
    )
    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": [{"type": "text", "text": user_text}]},
    ]


def run_openai_compatible_prompt_recipe_draft(
    *,
    provider_kind: str,
    base_url: str,
    api_key: Optional[str],
    model_id: str,
    idea: str,
    category: Optional[str],
    output_format: Optional[str],
    image_input_mode: Optional[str],
    temperature: float = 0.2,
    max_tokens: int = 1800,
) -> Dict[str, Any]:
    messages = build_prompt_recipe_draft_messages(
        idea=idea,
        category=category,
        output_format=output_format,
        image_input_mode=image_input_mode,
    )
    provider_result = run_openai_compatible_chat(
        provider_kind=provider_kind,
        base_url=base_url,
        api_key=api_key,
        model_id=model_id,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
        response_format={"type": "json_object"},
        error_context="prompt recipe drafting",
    )
    raw_text = str(provider_result.get("generated_text") or "").strip()
    if not raw_text:
        raise EnhancementProviderError("Prompt recipe drafting provider returned an empty response.")
    return {
        "provider_kind": provider_result["provider_kind"],
        "provider_model_id": provider_result["provider_model_id"],
        "provider_base_url": provider_result["provider_base_url"],
        "provider_response_id": provider_result.get("provider_response_id"),
        "usage": provider_result.get("usage") or {},
        "prompt_tokens": provider_result.get("prompt_tokens"),
        "completion_tokens": provider_result.get("completion_tokens"),
        "total_tokens": provider_result.get("total_tokens"),
        "cost": provider_result.get("cost"),
        "raw_text": raw_text,
    }


def run_openai_compatible_prompt_node(
    *,
    provider_kind: str,
    base_url: str,
    api_key: Optional[str],
    model_id: str,
    mode: str,
    system_prompt: Optional[str],
    user_prompt: str,
    image_instruction: Optional[str],
    image_paths: List[str],
    temperature: Optional[float] = None,
    max_tokens: Optional[int] = None,
) -> Dict[str, Any]:
    messages = build_prompt_node_messages(
        mode=mode,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        image_instruction=image_instruction,
        image_paths=image_paths,
    )
    result = run_openai_compatible_chat(
        provider_kind=provider_kind,
        base_url=base_url,
        api_key=api_key,
        model_id=model_id,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
        error_context="prompt node",
    )
    return {
        "provider_kind": result["provider_kind"],
        "provider_model_id": result["provider_model_id"],
        "provider_base_url": result["provider_base_url"],
        "provider_response_id": result.get("provider_response_id"),
        "usage": result.get("usage") or {},
        "prompt_tokens": result.get("prompt_tokens"),
        "completion_tokens": result.get("completion_tokens"),
        "total_tokens": result.get("total_tokens"),
        "cost": result.get("cost"),
        "generated_text": result["generated_text"],
        "warnings": [],
    }


def run_openai_compatible_chat(
    *,
    provider_kind: str,
    base_url: str,
    api_key: Optional[str],
    model_id: str,
    messages: List[Dict[str, Any]],
    temperature: Optional[float] = None,
    max_tokens: Optional[int] = None,
    response_format: Optional[Dict[str, Any]] = None,
    error_context: str = "request",
) -> Dict[str, Any]:
    endpoint = f"{base_url.rstrip('/')}/chat/completions"
    request_body = {
        "model": model_id,
        "messages": messages,
    }
    if temperature is not None:
        request_body["temperature"] = temperature
    if max_tokens is not None:
        request_body["max_tokens"] = max_tokens
    if response_format:
        request_body["response_format"] = response_format
    if provider_kind == "openrouter":
        request_body["reasoning"] = {"effort": "none", "exclude": True}
    with _http_client() as client:
        response = client.post(endpoint, headers=_openai_compatible_headers(api_key), json=request_body)
    if response.status_code >= 400:
        raise EnhancementProviderError(f"{provider_kind} {error_context} failed with {response.status_code}.")
    payload = response.json()
    usage = _extract_usage_payload(payload)
    generated_text = _extract_message_text(payload).strip()
    if not generated_text:
        raise EnhancementProviderError(f"{error_context.capitalize()} provider returned an empty response.")
    return {
        "provider_kind": provider_kind,
        "provider_model_id": model_id,
        "provider_base_url": base_url,
        "provider_response_id": str(payload.get("id") or "").strip() or None,
        "usage": usage,
        "prompt_tokens": usage.get("prompt_tokens"),
        "completion_tokens": usage.get("completion_tokens"),
        "total_tokens": usage.get("total_tokens"),
        "cost": usage.get("cost"),
        "generated_text": generated_text,
        "warnings": [],
    }


def run_openai_compatible_enhancement(
    *,
    provider_kind: str,
    base_url: str,
    api_key: Optional[str],
    model_id: str,
    prompt: str,
    media_model_key: str,
    task_mode: Optional[str],
    system_prompt: Optional[str],
    image_analysis_prompt: Optional[str],
    image_paths: List[str],
) -> Dict[str, Any]:
    endpoint = f"{base_url.rstrip('/')}/chat/completions"
    messages = _build_rewrite_messages(
        prompt=prompt,
        media_model_key=media_model_key,
        task_mode=task_mode,
        system_prompt=system_prompt,
        image_analysis_prompt=image_analysis_prompt,
        image_paths=image_paths,
    )
    request_body = {
        "model": model_id,
        "messages": messages,
        "temperature": 0.3,
        "max_tokens": ENHANCEMENT_MAX_COMPLETION_TOKENS,
        "response_format": {"type": "json_object"},
    }
    if provider_kind == "openrouter":
        # Enhancement previews need the final JSON answer, not a reasoning transcript that burns the token budget.
        request_body["reasoning"] = {"effort": "none", "exclude": True}
    with _http_client() as client:
        response = client.post(endpoint, headers=_openai_compatible_headers(api_key), json=request_body)
    if response.status_code >= 400:
        raise EnhancementProviderError(f"{provider_kind} enhancement failed with {response.status_code}.")
    payload = response.json()
    usage = _extract_usage_payload(payload)
    raw_text = _extract_message_text(payload)
    parsed = _parse_enhancement_response(raw_text)
    enhanced_prompt = str(parsed.get("enhanced_prompt") or "").strip()
    if not enhanced_prompt:
        raise EnhancementProviderError("Enhancement provider returned an empty enhanced prompt.")
    if _normalize_enhancement_prompt(enhanced_prompt) == _normalize_enhancement_prompt(prompt):
        raise EnhancementProviderError(
            "Enhancement provider returned the original prompt unchanged. Update the enhancement prompt in Models or switch the enhancement model in Settings."
        )
    warnings = parsed.get("warnings")
    return {
        "provider_kind": provider_kind,
        "provider_model_id": model_id,
        "provider_base_url": base_url,
        "provider_response_id": str(payload.get("id") or "").strip() or None,
        "usage": usage,
        "prompt_tokens": usage.get("prompt_tokens"),
        "completion_tokens": usage.get("completion_tokens"),
        "total_tokens": usage.get("total_tokens"),
        "cost": usage.get("cost"),
        "enhanced_prompt": enhanced_prompt,
        "final_prompt_used": enhanced_prompt,
        "image_analysis": parsed.get("image_analysis"),
        "warnings": warnings if isinstance(warnings, list) else [],
        "raw_response": payload,
    }


def list_openrouter_models(
    api_key: Optional[str] = None,
    base_url: Optional[str] = None,
    *,
    force_refresh: bool = False,
) -> List[Dict[str, Any]]:
    resolved_key = api_key or settings.openrouter_api_key
    if not resolved_key:
        raise EnhancementProviderError("OpenRouter API key is missing.")
    resolved_base_url = str(base_url or settings.openrouter_base_url).rstrip("/")
    if _should_cache_openrouter_models(api_key, base_url):
        cache_age = time.time() - float(_OPENROUTER_MODELS_CACHE.get("fetched_at") or 0.0)
        if (
            not force_refresh
            and _OPENROUTER_MODELS_CACHE.get("base_url") == resolved_base_url
            and isinstance(_OPENROUTER_MODELS_CACHE.get("models"), list)
            and cache_age < OPENROUTER_MODELS_CACHE_TTL_SECONDS
        ):
            return list(_OPENROUTER_MODELS_CACHE.get("models") or [])
    endpoint = f"{resolved_base_url}/models"
    with _http_client() as client:
        response = client.get(endpoint, headers=_openrouter_headers(resolved_key))
    if response.status_code >= 400:
        raise EnhancementProviderError(f"OpenRouter model lookup failed with {response.status_code}.")
    payload = response.json()
    items = payload.get("data") or []
    models: List[Dict[str, Any]] = []
    for item in items:
        architecture = item.get("architecture") or {}
        modalities = item.get("input_modalities") or architecture.get("input_modalities") or []
        model_id = str(item.get("id") or "").strip()
        if not model_id:
            continue
        pricing = item.get("pricing") if isinstance(item.get("pricing"), dict) else {}
        models.append(
            {
                "id": model_id,
                "label": str(item.get("name") or model_id),
                "provider": "openrouter",
                "supports_images": _supports_images_from_modalities(modalities),
                "input_modalities": modalities,
                "pricing": pricing,
                "raw": item,
            }
        )
    models.sort(key=lambda item: (not item["supports_images"], item["label"].lower()))
    if _should_cache_openrouter_models(api_key, base_url):
        _OPENROUTER_MODELS_CACHE["fetched_at"] = time.time()
        _OPENROUTER_MODELS_CACHE["base_url"] = resolved_base_url
        _OPENROUTER_MODELS_CACHE["models"] = list(models)
    return models


def test_openrouter_connection(
    api_key: Optional[str],
    model_id: Optional[str],
    require_images: bool,
    base_url: Optional[str] = None,
) -> Dict[str, Any]:
    credential_source = "request" if api_key else "env"
    models = list_openrouter_models(api_key=api_key, base_url=base_url)
    selected = None
    if model_id:
        selected = next((item for item in models if item["id"] == model_id), None)
        if not selected:
            raise EnhancementProviderError("Selected OpenRouter model was not found.")
    elif models:
        selected = models[0]
    if require_images and selected and not selected["supports_images"]:
        raise EnhancementProviderError("Selected OpenRouter model does not support image input.")
    return {
        "ok": True,
        "provider": "openrouter",
        "credential_source": credential_source,
        "selected_model": selected,
        "available_models": models,
    }


def _extract_local_models(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    items = payload.get("data") or []
    models: List[Dict[str, Any]] = []
    for item in items:
        model_id = str(item.get("id") or "").strip()
        if not model_id:
            continue
        modalities = item.get("input_modalities") or item.get("modalities") or []
        supports_images = _supports_images_from_modalities(modalities) or any(
            token in model_id.lower() for token in ("vl", "vision", "llava", "qwen2.5-vl", "gpt-4o")
        )
        models.append(
            {
                "id": model_id,
                "label": str(item.get("label") or item.get("name") or model_id),
                "provider": "local_openai",
                "supports_images": supports_images,
                "input_modalities": modalities,
                "raw": item,
            }
        )
    models.sort(key=lambda item: (not item["supports_images"], item["label"].lower()))
    return models


def list_local_openai_models(base_url: str, api_key: Optional[str] = None) -> List[Dict[str, Any]]:
    endpoint = f"{base_url.rstrip('/')}/models"
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    try:
        with _http_client() as client:
            response = client.get(endpoint, headers=headers)
    except httpx.HTTPError as exc:
        raise EnhancementProviderError(f"Local model lookup failed: {exc}.") from exc
    if response.status_code >= 400:
        raise EnhancementProviderError(f"Local model lookup failed with {response.status_code}.")
    return _extract_local_models(response.json())


def test_local_openai_connection(
    base_url: str,
    api_key: Optional[str],
    model_id: Optional[str],
    require_images: bool,
) -> Dict[str, Any]:
    models = list_local_openai_models(base_url=base_url, api_key=api_key)
    selected = None
    if model_id:
        selected = next((item for item in models if item["id"] == model_id), None)
        if not selected:
            raise EnhancementProviderError("Selected local model was not found.")
    elif models:
        selected = models[0]
    if require_images and selected and not selected["supports_images"]:
        raise EnhancementProviderError("Selected local model does not support image input.")
    return {
        "ok": True,
        "provider": "local_openai",
        "credential_source": "request" if api_key else None,
        "selected_model": selected,
        "available_models": models,
    }


def test_codex_local_connection(
    model_id: Optional[str],
    require_images: bool,
) -> Dict[str, Any]:
    try:
        return codex_local_provider.test_codex_local_connection(model_id=model_id, require_images=require_images)
    except codex_local_provider.CodexLocalProviderError as exc:
        raise EnhancementProviderError(str(exc)) from exc


def load_codex_local_catalog(
    model_id: Optional[str],
    require_images: bool,
    force_refresh: bool = False,
) -> Dict[str, Any]:
    try:
        return codex_local_provider.load_codex_local_catalog(
            model_id=model_id,
            require_images=require_images,
            force_refresh=force_refresh,
        )
    except codex_local_provider.CodexLocalProviderError as exc:
        raise EnhancementProviderError(str(exc)) from exc


def run_codex_local_chat(
    *,
    model_id: str,
    messages: List[Dict[str, Any]],
    response_format: Optional[Dict[str, Any]] = None,
    error_context: str = "request",
) -> Dict[str, Any]:
    try:
        return codex_local_provider.run_codex_local_chat(
            model_id=model_id,
            messages=messages,
            response_format=response_format,
            error_context=error_context,
        )
    except codex_local_provider.CodexLocalProviderError as exc:
        raise EnhancementProviderError(str(exc)) from exc


def run_codex_local_prompt_recipe_draft(
    *,
    model_id: str,
    idea: str,
    category: Optional[str],
    output_format: Optional[str],
    image_input_mode: Optional[str],
) -> Dict[str, Any]:
    messages = build_prompt_recipe_draft_messages(
        idea=idea,
        category=category,
        output_format=output_format,
        image_input_mode=image_input_mode,
    )
    result = run_codex_local_chat(
        model_id=model_id,
        messages=messages,
        response_format={"type": "json_object"},
        error_context="prompt recipe drafting",
    )
    raw_text = str(result.get("generated_text") or "").strip()
    if not raw_text:
        raise EnhancementProviderError("Prompt recipe drafting provider returned an empty response.")
    return {
        "provider_kind": result["provider_kind"],
        "provider_model_id": result["provider_model_id"],
        "provider_base_url": result["provider_base_url"],
        "provider_response_id": result.get("provider_response_id"),
        "usage": result.get("usage") or {},
        "prompt_tokens": result.get("prompt_tokens"),
        "completion_tokens": result.get("completion_tokens"),
        "total_tokens": result.get("total_tokens"),
        "cost": None,
        "raw_text": raw_text,
    }


def run_codex_local_prompt_node(
    *,
    model_id: str,
    mode: str,
    system_prompt: Optional[str],
    user_prompt: str,
    image_instruction: Optional[str],
    image_paths: List[str],
) -> Dict[str, Any]:
    messages = build_prompt_node_messages(
        mode=mode,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        image_instruction=image_instruction,
        image_paths=image_paths,
    )
    result = run_codex_local_chat(
        model_id=model_id,
        messages=messages,
        error_context="prompt node",
    )
    return {
        "provider_kind": result["provider_kind"],
        "provider_model_id": result["provider_model_id"],
        "provider_base_url": result["provider_base_url"],
        "provider_response_id": result.get("provider_response_id"),
        "usage": result.get("usage") or {},
        "prompt_tokens": result.get("prompt_tokens"),
        "completion_tokens": result.get("completion_tokens"),
        "total_tokens": result.get("total_tokens"),
        "cost": None,
        "generated_text": result["generated_text"],
        "warnings": result.get("warnings") or [],
    }


def run_codex_local_enhancement(
    *,
    model_id: str,
    prompt: str,
    media_model_key: str,
    task_mode: Optional[str],
    system_prompt: Optional[str],
    image_analysis_prompt: Optional[str],
    image_paths: List[str],
) -> Dict[str, Any]:
    messages = _build_rewrite_messages(
        prompt=prompt,
        media_model_key=media_model_key,
        task_mode=task_mode,
        system_prompt=system_prompt,
        image_analysis_prompt=image_analysis_prompt,
        image_paths=image_paths,
    )
    result = run_codex_local_chat(
        model_id=model_id,
        messages=messages,
        response_format={"type": "json_object"},
        error_context="enhancement",
    )
    raw_text = str(result.get("generated_text") or "").strip()
    parsed = _parse_enhancement_response(raw_text)
    enhanced_prompt = str(parsed.get("enhanced_prompt") or "").strip()
    if not enhanced_prompt:
        raise EnhancementProviderError("Enhancement provider returned an empty enhanced prompt.")
    if _normalize_enhancement_prompt(enhanced_prompt) == _normalize_enhancement_prompt(prompt):
        raise EnhancementProviderError(
            "Enhancement provider returned the original prompt unchanged. Update the enhancement prompt in Models or switch the enhancement model in Settings."
        )
    warnings = parsed.get("warnings")
    return {
        "provider_kind": result["provider_kind"],
        "provider_model_id": result["provider_model_id"],
        "provider_base_url": result["provider_base_url"],
        "provider_response_id": result.get("provider_response_id"),
        "usage": result.get("usage") or {},
        "prompt_tokens": result.get("prompt_tokens"),
        "completion_tokens": result.get("completion_tokens"),
        "total_tokens": result.get("total_tokens"),
        "cost": None,
        "enhanced_prompt": enhanced_prompt,
        "final_prompt_used": enhanced_prompt,
        "image_analysis": parsed.get("image_analysis"),
        "warnings": warnings if isinstance(warnings, list) else [],
        "raw_response": {"generated_text": raw_text},
    }
