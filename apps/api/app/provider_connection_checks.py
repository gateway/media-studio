"""Non-generating checks for saved provider connections. Never return upstream bodies."""
from __future__ import annotations

from typing import Any

import httpx

from .store_support import utcnow_iso


def check_provider_endpoint(provider_kind: str, *, base_url: str, api_key: str) -> dict[str, Any]:
    result: dict[str, Any] = {"provider_kind": provider_kind, "ok": False, "checked_at": utcnow_iso()}
    if provider_kind == "openrouter" and not api_key:
        return {**result, "message": "Add and save an OpenRouter API key before checking."}
    if not base_url:
        return {**result, "message": "Add and save an API base URL before checking."}
    path = "key" if provider_kind == "openrouter" else "models"
    headers = {"Accept": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    try:
        # No redirects: credentials must stay at the configured endpoint.
        with httpx.Client(timeout=10.0, follow_redirects=False) as client:
            response = client.get(f"{base_url.rstrip('/')}/{path}", headers=headers)
        status = response.status_code
        if status in {401, 403}:
            return {**result, "message": "Authentication rejected. Check the saved API key and endpoint."}
        if status == 429:
            return {**result, "message": "Provider rate limit reached. Try again shortly."}
        if not 200 <= status < 300:
            return {**result, "message": f"Endpoint returned HTTP {status}. Check the saved API base URL and service."}
        payload = response.json()
        data = payload.get("data") if isinstance(payload, dict) else None
        if provider_kind == "openrouter":
            if not isinstance(data, dict) or not data:
                return {**result, "message": "Endpoint did not return valid OpenRouter key information."}
            return {**result, "ok": True, "message": "OpenRouter accepted the saved API key. No generation was run."}
        if not isinstance(data, list):
            return {**result, "message": "Endpoint did not return an OpenAI-compatible model list."}
        model_count = sum(1 for model in data if isinstance(model, dict) and isinstance(model.get("id"), str) and model["id"].strip())
        if not model_count:
            return {**result, "message": "Endpoint responded, but no models are available. Load a model and check again."}
        return {**result, "ok": True, "model_count": model_count, "message": f"Endpoint responded with {model_count} available model(s). No generation was run."}
    except httpx.InvalidURL:
        return {**result, "message": "The saved API base URL is invalid. Correct it and save before checking again."}
    except httpx.TimeoutException:
        return {**result, "message": "Connection timed out. Check that the endpoint is running and reachable."}
    except httpx.HTTPError:
        return {**result, "message": "Could not reach the endpoint. Check the saved URL and that the service is running."}
    except ValueError:
        return {**result, "message": "Endpoint returned an invalid JSON response. Check the API base URL."}
