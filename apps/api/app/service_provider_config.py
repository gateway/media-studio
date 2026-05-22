from __future__ import annotations

from typing import Any, Dict, Optional

from . import enhancement_provider, store
from .schemas import PromptRecipeDraftingConfigRecord
from .service_errors import ServiceError
from .settings import settings

GLOBAL_ENHANCEMENT_CONFIG_KEY = "__studio_enhancement__"
PROMPT_RECIPE_DRAFTING_CONFIG_KEY = "prompt_recipe_drafting"
PROMPT_RECIPE_DRAFTING_PROVIDERS = {"openrouter", "local_openai", "codex_local"}
PROMPT_RECIPE_DRAFTING_DEFAULT_TEMPERATURE = 0.2
PROMPT_RECIPE_DRAFTING_DEFAULT_MAX_TOKENS = 1800


def provider_credential_source(provider_kind: str, api_key: str) -> Optional[str]:
    if api_key:
        return "stored"
    if provider_kind == "openrouter" and settings.openrouter_api_key:
        return "env"
    if provider_kind == "local_openai" and settings.local_openai_api_key:
        return "env"
    if provider_kind == "codex_local":
        return enhancement_provider.codex_local_provider.CODEX_LOCAL_PROVIDER_CREDENTIAL_SOURCE
    return None


def drafting_config_credential_source(provider_kind: str) -> Optional[str]:
    global_config = store.get_enhancement_config(GLOBAL_ENHANCEMENT_CONFIG_KEY) or {}
    matching_global = global_config if str(global_config.get("provider_kind") or "").strip() == provider_kind else {}
    return provider_credential_source(provider_kind, str(matching_global.get("provider_api_key") or "").strip())


def shared_provider_runtime(
    provider_kind: str,
    *,
    stored_base_url: Optional[str] = None,
    stored_api_key: Optional[str] = None,
) -> Dict[str, Any]:
    if provider_kind not in PROMPT_RECIPE_DRAFTING_PROVIDERS:
        raise ServiceError("Unsupported drafting provider.")
    if provider_kind == "codex_local":
        return {
            "api_key": "",
            "base_url": enhancement_provider.codex_local_provider.CODEX_LOCAL_PROVIDER_BASE_URL,
            "credential_source": provider_credential_source(provider_kind, ""),
        }
    global_config = store.get_enhancement_config(GLOBAL_ENHANCEMENT_CONFIG_KEY) or {}
    matching_global = global_config if str(global_config.get("provider_kind") or "").strip() == provider_kind else {}
    api_key = str(stored_api_key or matching_global.get("provider_api_key") or "").strip()
    if not api_key:
        if provider_kind == "openrouter":
            api_key = str(settings.openrouter_api_key or "").strip()
        else:
            api_key = str(settings.local_openai_api_key or "").strip()
    if provider_kind == "openrouter":
        base_url = str(stored_base_url or matching_global.get("provider_base_url") or settings.openrouter_base_url).strip()
    else:
        base_url = str(stored_base_url or matching_global.get("provider_base_url") or settings.local_openai_base_url).strip()
        if not base_url:
            raise ServiceError("Local OpenAI-compatible base URL is required.")
    credential_source = provider_credential_source(provider_kind, str(matching_global.get("provider_api_key") or "").strip())
    if stored_api_key:
        credential_source = "stored"
    return {
        "api_key": api_key,
        "base_url": base_url,
        "credential_source": credential_source,
    }


def default_prompt_recipe_drafting_config() -> Dict[str, Any]:
    runtime = shared_provider_runtime("openrouter")
    return PromptRecipeDraftingConfigRecord(
        config_key=PROMPT_RECIPE_DRAFTING_CONFIG_KEY,
        enabled=True,
        provider_kind="openrouter",
        provider_model_id=None,
        provider_base_url_configured=False,
        provider_credential_source=runtime.get("credential_source"),
        provider_supports_images=False,
        provider_capabilities_json={},
        temperature=PROMPT_RECIPE_DRAFTING_DEFAULT_TEMPERATURE,
        max_tokens=PROMPT_RECIPE_DRAFTING_DEFAULT_MAX_TOKENS,
    ).model_dump()


def public_prompt_recipe_drafting_config(record: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not record:
        return default_prompt_recipe_drafting_config()
    provider_kind = str(record.get("provider_kind") or "openrouter").strip()
    stored_base_url = str(record.get("provider_base_url") or "").strip()
    payload = record.copy()
    payload.pop("provider_base_url", None)
    payload["provider_base_url_configured"] = bool(stored_base_url)
    payload["provider_credential_source"] = drafting_config_credential_source(provider_kind)
    payload.setdefault("enabled", True)
    payload.setdefault("temperature", PROMPT_RECIPE_DRAFTING_DEFAULT_TEMPERATURE)
    payload.setdefault("max_tokens", PROMPT_RECIPE_DRAFTING_DEFAULT_MAX_TOKENS)
    return PromptRecipeDraftingConfigRecord(**payload).model_dump()
