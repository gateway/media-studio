from __future__ import annotations

import base64
import json
import mimetypes
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx

from .settings import settings

ENHANCEMENT_HTTP_TIMEOUT_SECONDS = 80.0
ENHANCEMENT_MAX_COMPLETION_TOKENS = 900


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
        "enhanced_prompt": enhanced_prompt,
        "final_prompt_used": enhanced_prompt,
        "image_analysis": parsed.get("image_analysis"),
        "warnings": warnings if isinstance(warnings, list) else [],
        "raw_response": payload,
    }


def list_openrouter_models(api_key: Optional[str] = None, base_url: Optional[str] = None) -> List[Dict[str, Any]]:
    resolved_key = api_key or settings.openrouter_api_key
    if not resolved_key:
        raise EnhancementProviderError("OpenRouter API key is missing.")
    endpoint = f"{(base_url or settings.openrouter_base_url).rstrip('/')}/models"
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
        models.append(
            {
                "id": model_id,
                "label": str(item.get("name") or model_id),
                "provider": "openrouter",
                "supports_images": _supports_images_from_modalities(modalities),
                "input_modalities": modalities,
                "raw": item,
            }
        )
    models.sort(key=lambda item: (not item["supports_images"], item["label"].lower()))
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
    with _http_client() as client:
        response = client.get(endpoint, headers=headers)
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
