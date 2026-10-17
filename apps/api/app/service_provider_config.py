from __future__ import annotations

import os
from urllib.parse import urlsplit, urlunsplit
from typing import Any, Dict, Optional

from . import enhancement_provider, store
from .schemas import (
    MediaAssistantConfigRecord,
    MediaAssistantConfigUpsertRequest,
    PromptRecipeDraftingConfigRecord,
    PromptRecipeDraftingConfigUpsertRequest,
)
from .service_errors import ServiceError
from .settings import settings
from .store_provider_connections import get_provider_connection, save_provider_connection


def preserve_task_provider_overrides(existing: Dict[str, Any], payload: Dict[str, Any]) -> Dict[str, Any]:
    """Retain legacy per-provider overrides when a task changes providers."""
    old_kind = str(existing.get("provider_kind") or "")
    new_kind = str(payload.get("provider_kind") or old_kind)
    if not old_kind or new_kind == old_kind:
        return payload
    overrides = dict(existing.get("provider_overrides_json") or {})
    overrides[old_kind] = {key: existing.get(key) for key in ("provider_api_key", "provider_base_url") if key in existing}
    restored = overrides.get(new_kind, {})
    result = dict(payload, provider_overrides_json=overrides)
    for key in ("provider_api_key", "provider_base_url"):
        if key in existing and key not in payload:
            result[key] = restored.get(key)
    return result


def _legacy_provider_config(provider_kind: str) -> Dict[str, Any]:
    record = store.get_enhancement_config(GLOBAL_ENHANCEMENT_CONFIG_KEY) or {}
    if record.get("provider_kind") == provider_kind:
        return record
    return (record.get("provider_overrides_json") or {}).get(provider_kind, {})


def public_connection_url(value: str) -> str:
    parsed = urlsplit(value)
    # Legacy/environment endpoints may contain secrets; new saves reject these parts.
    return urlunsplit((parsed.scheme, parsed.netloc.rsplit("@", 1)[-1], parsed.path, "", ""))


def list_provider_connections() -> list[Dict[str, Any]]:
    result = []
    for kind in ("codex_local", "openrouter", "local_openai"):
        record = get_provider_connection(kind)
        runtime = shared_provider_runtime(kind, require_base_url=False)
        if kind == "codex_local":
            configured = bool(enhancement_provider.codex_local_provider.codex_local_status()["ready"])
        elif kind == "openrouter":
            configured = bool(runtime["api_key"])
        else:
            configured = bool(record.get("base_url") or os.getenv("MEDIA_LOCAL_OPENAI_BASE_URL") or _legacy_provider_config(kind).get("provider_base_url"))
        result.append({
            "provider_kind": kind,
            "api_key_configured": bool(runtime["api_key"]),
            "credential_source": runtime["credential_source"],
            "base_url": public_connection_url(runtime["base_url"]) if kind != "codex_local" else None,
            "managed_by": "machine" if kind == "codex_local" else "connections",
            "configured": configured,
            "updated_at": record.get("updated_at"),
        })
    return result


def upsert_provider_connection(provider_kind: str, payload) -> Dict[str, Any]:
    if provider_kind not in {"openrouter", "local_openai"}:
        raise ServiceError("This connection is managed on the machine.")
    values = payload.model_dump(exclude_unset=True)
    for key, value in values.items():
        values[key] = str(value or "").strip() or None
    base_url = values.get("base_url")
    if base_url:
        parsed = urlsplit(base_url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ServiceError("Use an HTTP or HTTPS endpoint without credentials, query or fragment.")
    if "api_key" not in values and not get_provider_connection(provider_kind):
        # An explicit first save adopts a legacy key, making it available to Assistant too.
        runtime = shared_provider_runtime(provider_kind, require_base_url=False)
        if runtime["credential_source"] == "stored":
            values["api_key"] = runtime["api_key"] or None
    save_provider_connection(provider_kind, values)
    return next(item for item in list_provider_connections() if item["provider_kind"] == provider_kind)


GLOBAL_ENHANCEMENT_CONFIG_KEY = "__studio_enhancement__"
PROMPT_RECIPE_DRAFTING_CONFIG_KEY = "prompt_recipe_drafting"
MEDIA_ASSISTANT_CONFIG_KEY = "media_assistant"
PROMPT_RECIPE_DRAFTING_PROVIDERS = {"openrouter", "local_openai", "codex_local"}
PROMPT_RECIPE_DRAFTING_DEFAULT_TEMPERATURE = 0.2
PROMPT_RECIPE_DRAFTING_DEFAULT_MAX_TOKENS = 1800
MEDIA_ASSISTANT_DEFAULT_TEMPERATURE = 0.35
MEDIA_ASSISTANT_DEFAULT_MAX_TOKENS = 900


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
    return shared_provider_runtime(provider_kind, require_base_url=False).get("credential_source")


def shared_provider_runtime(
    provider_kind: str,
    *,
    stored_base_url: Optional[str] = None,
    stored_api_key: Optional[str] = None,
    allow_feature_config: bool = True,
    require_base_url: bool = True,
) -> Dict[str, Any]:
    if provider_kind not in PROMPT_RECIPE_DRAFTING_PROVIDERS:
        raise ServiceError("Unsupported drafting provider.")
    if provider_kind == "codex_local":
        return {
            "api_key": "",
            "base_url": enhancement_provider.codex_local_provider.CODEX_LOCAL_PROVIDER_BASE_URL,
            "credential_source": provider_credential_source(provider_kind, ""),
        }
    connection = get_provider_connection(provider_kind)
    global_config = (
        store.get_enhancement_config(GLOBAL_ENHANCEMENT_CONFIG_KEY) or {}
        if allow_feature_config
        else {}
    )
    matching_global = (
        global_config if str(global_config.get("provider_kind") or "").strip() == provider_kind
        else (global_config.get("provider_overrides_json") or {}).get(provider_kind, {})
    )
    api_key = str(stored_api_key or connection.get("api_key") or matching_global.get("provider_api_key") or "").strip()
    if not api_key:
        if provider_kind == "openrouter":
            api_key = str(settings.openrouter_api_key or "").strip()
        else:
            api_key = str(settings.local_openai_api_key or "").strip()
    if provider_kind == "openrouter":
        base_url = str(stored_base_url or connection.get("base_url") or matching_global.get("provider_base_url") or settings.openrouter_base_url).strip()
    else:
        base_url = str(stored_base_url or connection.get("base_url") or matching_global.get("provider_base_url") or settings.local_openai_base_url).strip()
        if not base_url and require_base_url:
            raise ServiceError("Local OpenAI-compatible base URL is required.")
    credential_source = provider_credential_source(provider_kind, str(matching_global.get("provider_api_key") or "").strip())
    if connection.get("api_key") or stored_api_key:
        credential_source = "stored"
    return {
        "api_key": api_key,
        "base_url": base_url,
        "credential_source": credential_source,
    }


def default_prompt_recipe_drafting_config() -> Dict[str, Any]:
    default_model = enhancement_provider.codex_local_provider.CODEX_LOCAL_DEFAULT_MODEL
    runtime = shared_provider_runtime("codex_local")
    return PromptRecipeDraftingConfigRecord(
        config_key=PROMPT_RECIPE_DRAFTING_CONFIG_KEY,
        enabled=True,
        provider_kind="codex_local",
        provider_label="Codex Local",
        provider_model_id=default_model,
        provider_base_url_configured=False,
        provider_credential_source=runtime.get("credential_source"),
        provider_supports_images=True,
        provider_status="active",
        provider_capabilities_json={
            "provider": "codex_local",
            "credential_source": runtime.get("credential_source"),
            "default_model": default_model,
        },
        temperature=PROMPT_RECIPE_DRAFTING_DEFAULT_TEMPERATURE,
        max_tokens=PROMPT_RECIPE_DRAFTING_DEFAULT_MAX_TOKENS,
    ).model_dump()


def public_prompt_recipe_drafting_config(record: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not record:
        return default_prompt_recipe_drafting_config()
    provider_kind = str(record.get("provider_kind") or "codex_local").strip()
    stored_base_url = str(record.get("provider_base_url") or "").strip()
    payload = record.copy()
    payload.pop("provider_base_url", None)
    payload.pop("provider_overrides_json", None)
    payload["provider_base_url_configured"] = bool(stored_base_url or get_provider_connection(provider_kind).get("base_url"))
    payload["provider_credential_source"] = drafting_config_credential_source(provider_kind)
    payload.setdefault("enabled", True)
    payload.setdefault("temperature", PROMPT_RECIPE_DRAFTING_DEFAULT_TEMPERATURE)
    payload.setdefault("max_tokens", PROMPT_RECIPE_DRAFTING_DEFAULT_MAX_TOKENS)
    return PromptRecipeDraftingConfigRecord(**payload).model_dump()


def default_media_assistant_config() -> Dict[str, Any]:
    default_model = enhancement_provider.codex_local_provider.CODEX_LOCAL_DEFAULT_MODEL
    return MediaAssistantConfigRecord(
        config_key=MEDIA_ASSISTANT_CONFIG_KEY,
        enabled=True,
        provider_kind="codex_local",
        provider_label="Codex Local",
        provider_model_id=default_model,
        provider_base_url_configured=False,
        provider_credential_source=provider_credential_source("codex_local", ""),
        provider_supports_images=True,
        provider_status="active",
        provider_capabilities_json={"provider": "codex_local", "default_model": default_model},
        temperature=MEDIA_ASSISTANT_DEFAULT_TEMPERATURE,
        max_tokens=MEDIA_ASSISTANT_DEFAULT_MAX_TOKENS,
        supports_media_studio_tools=True,
    ).model_dump()


def public_media_assistant_config(record: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    from .service_image_models import assistant_image_model_choices
    choices = assistant_image_model_choices()
    if not record:
        return {**default_media_assistant_config(), "image_model_choices_json": choices}
    provider_kind = str(record.get("provider_kind") or "codex_local").strip()
    stored_base_url = str(record.get("provider_base_url") or "").strip()
    payload = record.copy()
    payload.pop("provider_base_url", None)
    payload.pop("provider_overrides_json", None)
    payload["provider_base_url_configured"] = bool(stored_base_url or get_provider_connection(provider_kind).get("base_url"))
    payload["provider_credential_source"] = shared_provider_runtime(provider_kind, allow_feature_config=False, require_base_url=False).get("credential_source")
    payload["supports_media_studio_tools"] = provider_kind == "codex_local"
    payload["image_model_choices_json"] = choices
    payload.setdefault("enabled", True)
    payload.setdefault("temperature", MEDIA_ASSISTANT_DEFAULT_TEMPERATURE)
    payload.setdefault("max_tokens", MEDIA_ASSISTANT_DEFAULT_MAX_TOKENS)
    return MediaAssistantConfigRecord(**payload).model_dump()


def upsert_prompt_recipe_drafting_config(
    payload: PromptRecipeDraftingConfigUpsertRequest,
) -> Dict[str, Any]:
    return _upsert_feature_provider_config(
        payload,
        config_key=PROMPT_RECIPE_DRAFTING_CONFIG_KEY,
        public_config=public_prompt_recipe_drafting_config,
    )


def upsert_media_assistant_config(
    payload: MediaAssistantConfigUpsertRequest,
) -> Dict[str, Any]:
    return _upsert_feature_provider_config(
        payload,
        config_key=MEDIA_ASSISTANT_CONFIG_KEY,
        public_config=public_media_assistant_config,
    )


def _upsert_feature_provider_config(
    payload: PromptRecipeDraftingConfigUpsertRequest,
    *,
    config_key: str,
    public_config,
) -> Dict[str, Any]:
    provider_kind = str(payload.provider_kind or "codex_local").strip()
    if provider_kind not in PROMPT_RECIPE_DRAFTING_PROVIDERS:
        raise ServiceError("Unsupported provider.")
    existing = store.get_prompt_recipe_drafting_config(config_key) or {}
    image_defaults = {}
    if isinstance(payload, MediaAssistantConfigUpsertRequest) and payload.image_model_defaults_json is not None:
        from .service_image_models import resolve_image_model
        image_defaults = payload.image_model_defaults_json.model_dump()
        for mode, model_key in image_defaults.items():
            if model_key:
                resolve_image_model(mode, model_key)
    provider_values = preserve_task_provider_overrides(existing, payload.model_dump(exclude_unset=True))
    provider_base_url = (
        str(payload.provider_base_url or "").strip() or None
        if "provider_base_url" in payload.model_fields_set
        else provider_values.get("provider_base_url", existing.get("provider_base_url"))
    )
    stored = store.create_or_update_prompt_recipe_drafting_config(
        {
            "config_key": config_key,
            "provider_overrides_json": provider_values.get("provider_overrides_json", existing.get("provider_overrides_json") or {}),
            **({"image_model_defaults_json": image_defaults} if image_defaults else {}),
            "enabled": bool(payload.enabled),
            "provider_kind": provider_kind,
            "provider_label": str(payload.provider_label or "").strip() or None,
            "provider_model_id": str(payload.provider_model_id or "").strip() or None,
            "provider_base_url": provider_base_url,
            "provider_supports_images": bool(payload.provider_supports_images),
            "provider_status": str(payload.provider_status or "").strip() or None,
            "provider_last_tested_at": str(payload.provider_last_tested_at or "").strip() or None,
            "provider_capabilities_json": payload.provider_capabilities_json or {},
            "temperature": max(0.0, min(2.0, float(payload.temperature))),
            "max_tokens": max(128, min(4000, int(payload.max_tokens))),
        }
    )
    return public_config(stored)


def probe_prompt_recipe_drafting_provider(payload: Dict[str, Any]) -> Dict[str, Any]:
    return _probe_feature_provider(
        payload,
        config_key=PROMPT_RECIPE_DRAFTING_CONFIG_KEY,
        allow_feature_config=True,
    )


def probe_media_assistant_provider(payload: Dict[str, Any]) -> Dict[str, Any]:
    return _probe_feature_provider(
        payload,
        config_key=MEDIA_ASSISTANT_CONFIG_KEY,
        allow_feature_config=False,
    )


def _probe_feature_provider(
    payload: Dict[str, Any],
    *,
    config_key: str,
    allow_feature_config: bool,
) -> Dict[str, Any]:
    provider_kind = str(payload.get("provider_kind") or "").strip()
    if provider_kind not in PROMPT_RECIPE_DRAFTING_PROVIDERS:
        raise ServiceError("Unsupported provider.")
    current_config = store.get_prompt_recipe_drafting_config(config_key) or {}
    matching_config = current_config if str(current_config.get("provider_kind") or "").strip() == provider_kind else {}
    runtime = shared_provider_runtime(
        provider_kind,
        stored_base_url=str(payload.get("provider_base_url") or matching_config.get("provider_base_url") or "").strip() or None,
        allow_feature_config=allow_feature_config,
    )
    selected_model_id = str(payload.get("provider_model_id") or matching_config.get("provider_model_id") or "").strip() or None
    require_images = bool(payload.get("require_images"))
    probe_mode = str(payload.get("probe_mode") or "catalog").strip().lower()
    try:
        if provider_kind == "openrouter":
            bundle = enhancement_provider.test_openrouter_connection(
                api_key=runtime.get("api_key"),
                model_id=selected_model_id,
                require_images=require_images,
                base_url=runtime.get("base_url"),
            )
        elif provider_kind == "codex_local":
            bundle = (
                enhancement_provider.test_codex_local_connection(
                    model_id=selected_model_id,
                    require_images=require_images,
                )
                if probe_mode == "full"
                else enhancement_provider.load_codex_local_catalog(
                    model_id=selected_model_id,
                    require_images=require_images,
                    force_refresh=bool(payload.get("force_refresh")),
                )
            )
        else:
            bundle = enhancement_provider.test_local_openai_connection(
                base_url=str(runtime.get("base_url") or ""),
                api_key=runtime.get("api_key"),
                model_id=selected_model_id,
                require_images=require_images,
            )
        bundle["credential_source"] = runtime.get("credential_source")
        return bundle
    except enhancement_provider.EnhancementProviderError as exc:
        raise ServiceError(str(exc)) from exc
