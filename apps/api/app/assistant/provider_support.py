from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

from .. import enhancement_provider, store, store_assistant
from ..service_errors import ServiceError
from ..service_provider_config import (
    MEDIA_ASSISTANT_CONFIG_KEY,
    MEDIA_ASSISTANT_DEFAULT_MAX_TOKENS,
    MEDIA_ASSISTANT_DEFAULT_TEMPERATURE,
    PROMPT_RECIPE_DRAFTING_PROVIDERS,
    shared_provider_runtime,
)
from ..settings import settings
from .limits import ASSISTANT_IMAGE_ATTACHMENT_LIMIT, is_image_attachment


ASSISTANT_CHAT_DEFAULT_MAX_TOKENS = 900


class AssistantProviderChatError(Exception):
    pass


@dataclass(frozen=True)
class AssistantProviderRuntime:
    provider_kind: str
    provider_model_id: str
    provider_base_url: Optional[str]
    api_key: Optional[str]
    temperature: float
    max_tokens: int
    credential_source: Optional[str]


def string_value(value: Any) -> str:
    return str(value or "").strip()


def resolve_assistant_provider_runtime(session: Dict[str, Any]) -> AssistantProviderRuntime:
    assistant_config = store.get_prompt_recipe_drafting_config(MEDIA_ASSISTANT_CONFIG_KEY) or {}
    requested_provider = string_value(
        assistant_config.get("provider_kind")
        or session.get("provider_kind")
        or "codex_local"
    )
    if requested_provider not in PROMPT_RECIPE_DRAFTING_PROVIDERS:
        requested_provider = "codex_local"

    provider_model_id = (
        string_value(assistant_config.get("provider_model_id"))
        or string_value(session.get("provider_model_id"))
    )
    if requested_provider == "codex_local" and not provider_model_id:
        provider_model_id = enhancement_provider.codex_local_provider.CODEX_LOCAL_DEFAULT_MODEL
    if not provider_model_id:
        raise AssistantProviderChatError(f"Choose a {requested_provider} model in AI Settings before using assistant chat.")

    try:
        runtime = shared_provider_runtime(
            requested_provider,
            stored_base_url=string_value(assistant_config.get("provider_base_url")) or None,
            allow_feature_config=False,
        )
    except ServiceError as exc:
        raise AssistantProviderChatError(str(exc)) from exc
    if requested_provider != "codex_local" and not string_value(runtime.get("api_key")):
        raise AssistantProviderChatError(
            f"{requested_provider} is missing a credential. Configure it in AI Settings or the server environment."
        )

    return AssistantProviderRuntime(
        provider_kind=requested_provider,
        provider_model_id=provider_model_id,
        provider_base_url=string_value(runtime.get("base_url")) or None,
        api_key=string_value(runtime.get("api_key")) or None,
        temperature=_number(
            assistant_config.get("temperature"),
            MEDIA_ASSISTANT_DEFAULT_TEMPERATURE,
        ),
        max_tokens=_integer(
            assistant_config.get("max_tokens"),
            min(MEDIA_ASSISTANT_DEFAULT_MAX_TOKENS, ASSISTANT_CHAT_DEFAULT_MAX_TOKENS),
        ),
        credential_source=string_value(runtime.get("credential_source")) or None,
    )


def configured_assistant_provider(session: Dict[str, Any]) -> tuple[str, Optional[str]]:
    config = store.get_prompt_recipe_drafting_config(MEDIA_ASSISTANT_CONFIG_KEY) or {}
    provider_kind = string_value(
        config.get("provider_kind")
        or session.get("provider_kind")
        or "codex_local"
    )
    if provider_kind not in PROMPT_RECIPE_DRAFTING_PROVIDERS:
        provider_kind = "codex_local"
    provider_model_id = (
        string_value(config.get("provider_model_id"))
        or string_value(session.get("provider_model_id"))
        or None
    )
    if provider_kind == "codex_local" and not provider_model_id:
        provider_model_id = enhancement_provider.codex_local_provider.CODEX_LOCAL_DEFAULT_MODEL
    return provider_kind, provider_model_id


def assistant_provider_fields(session: Dict[str, Any]) -> Dict[str, Any]:
    provider_kind, provider_model_id = configured_assistant_provider(session)
    return {
        "provider_kind": provider_kind,
        "provider_model_id": provider_model_id,
    }


def sync_assistant_session_provider(session: Dict[str, Any]) -> Dict[str, Any]:
    provider_fields = assistant_provider_fields(session)
    if all(session.get(key) == value for key, value in provider_fields.items()):
        return session
    return store_assistant.create_or_update_assistant_session(
        {
            **session,
            **provider_fields,
            "provider_thread_id": None,
        }
    )


def attachment_image_paths(attachments: List[Dict[str, Any]]) -> List[str]:
    paths: List[str] = []
    for attachment in attachments:
        if len(paths) >= ASSISTANT_IMAGE_ATTACHMENT_LIMIT:
            break
        if not is_image_attachment(attachment):
            continue
        path = reference_media_path(store.get_reference_media(string_value(attachment.get("reference_id"))) or {})
        if path:
            paths.append(path)
    return paths


def reference_media_path(reference: Dict[str, Any]) -> Optional[str]:
    stored_path = string_value(reference.get("stored_path"))
    if not stored_path:
        return None
    path = Path(stored_path)
    if not path.is_absolute():
        path = settings.data_root / path
    return str(path) if path.exists() else None


def workflow_id_from_context(context: Dict[str, Any]) -> Optional[str]:
    workflow = context.get("workflow")
    if not isinstance(workflow, dict):
        return None
    return string_value(workflow.get("workflow_id")) or None


def _number(value: Any, fallback: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if number == number else fallback


def _integer(value: Any, fallback: int) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return fallback
    return max(128, min(4000, number))
