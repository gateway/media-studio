from __future__ import annotations

import json
import hashlib
import os
import time
from dataclasses import dataclass
from pathlib import Path
from threading import Event
from typing import Any, Dict, List, Optional

from .. import enhancement_provider, external_llm_usage, store
from ..service_errors import ServiceError
from ..service_provider_config import (
    GLOBAL_ENHANCEMENT_CONFIG_KEY,
    PROMPT_RECIPE_DRAFTING_CONFIG_KEY,
    PROMPT_RECIPE_DRAFTING_DEFAULT_MAX_TOKENS,
    PROMPT_RECIPE_DRAFTING_PROVIDERS,
    shared_provider_runtime,
)
from ..settings import settings
from .cancellation import AssistantRequestCancelled, is_cancelled
from .limits import ASSISTANT_IMAGE_ATTACHMENT_LIMIT, is_image_attachment
from .prompt_assets import assistant_system_prompt_assembly
from .skill_kernel import attachment_set_hash


ASSISTANT_CHAT_SOURCE_KIND = "media_assistant_chat"
ASSISTANT_CHAT_CONTEXT_LIMIT = 14000
ASSISTANT_CHAT_HISTORY_LIMIT = 12
ASSISTANT_CHAT_DEFAULT_MAX_TOKENS = 900
ASSISTANT_CHAT_DEFAULT_TEMPERATURE = 0.35


def assistant_codex_timeout_seconds(env_name: str, fallback: float) -> float:
    try:
        value = float(os.environ.get(env_name) or "")
    except (TypeError, ValueError):
        return fallback
    if value != value:
        return fallback
    return max(30.0, min(300.0, value))


ASSISTANT_CODEX_LOCAL_TIMEOUT_SECONDS = assistant_codex_timeout_seconds(
    "MEDIA_ASSISTANT_CODEX_CHAT_TIMEOUT_SECONDS",
    120.0,
)


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


def _string(value: Any) -> str:
    return str(value or "").strip()


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


def _compact_context(context: Dict[str, Any]) -> str:
    raw = json.dumps(context, ensure_ascii=False, sort_keys=True)
    if len(raw) <= ASSISTANT_CHAT_CONTEXT_LIMIT:
        return raw
    trimmed = dict(context)
    if isinstance(trimmed.get("node_catalog"), list):
        trimmed["node_catalog"] = trimmed["node_catalog"][:30]
    if isinstance(trimmed.get("media_presets"), list):
        trimmed["media_presets"] = trimmed["media_presets"][:20]
    if isinstance(trimmed.get("prompt_recipes"), list):
        trimmed["prompt_recipes"] = trimmed["prompt_recipes"][:20]
    trimmed["truncated_for_chat"] = True
    raw = json.dumps(trimmed, ensure_ascii=False, sort_keys=True)
    return raw[:ASSISTANT_CHAT_CONTEXT_LIMIT]


def _resolve_provider_runtime(session: Dict[str, Any]) -> AssistantProviderRuntime:
    requested_provider = _string(session.get("provider_kind") or "codex_local")
    if requested_provider not in PROMPT_RECIPE_DRAFTING_PROVIDERS:
        requested_provider = "codex_local"

    drafting_config = store.get_prompt_recipe_drafting_config(PROMPT_RECIPE_DRAFTING_CONFIG_KEY) or {}
    enhancement_config = store.get_enhancement_config(GLOBAL_ENHANCEMENT_CONFIG_KEY) or {}
    matching_drafting = drafting_config if _string(drafting_config.get("provider_kind")) == requested_provider else {}
    matching_enhancement = enhancement_config if _string(enhancement_config.get("provider_kind")) == requested_provider else {}

    provider_model_id = (
        _string(session.get("provider_model_id"))
        or _string(matching_drafting.get("provider_model_id"))
        or _string(matching_enhancement.get("provider_model_id"))
    )
    if requested_provider == "codex_local" and not provider_model_id:
        provider_model_id = enhancement_provider.codex_local_provider.CODEX_LOCAL_DEFAULT_MODEL
    if not provider_model_id:
        raise AssistantProviderChatError(f"Choose a {requested_provider} model in AI Settings before using assistant chat.")

    try:
        runtime = shared_provider_runtime(
            requested_provider,
            stored_base_url=_string(matching_drafting.get("provider_base_url") or matching_enhancement.get("provider_base_url")) or None,
            stored_api_key=_string(matching_drafting.get("provider_api_key") or matching_enhancement.get("provider_api_key")) or None,
        )
    except ServiceError as exc:
        raise AssistantProviderChatError(str(exc)) from exc

    if requested_provider != "codex_local" and not _string(runtime.get("api_key")):
        raise AssistantProviderChatError(f"{requested_provider} is missing an API key in AI Settings.")

    temperature = _number(matching_drafting.get("temperature"), ASSISTANT_CHAT_DEFAULT_TEMPERATURE)
    max_tokens = _integer(matching_drafting.get("max_tokens"), min(PROMPT_RECIPE_DRAFTING_DEFAULT_MAX_TOKENS, ASSISTANT_CHAT_DEFAULT_MAX_TOKENS))
    return AssistantProviderRuntime(
        provider_kind=requested_provider,
        provider_model_id=provider_model_id,
        provider_base_url=_string(runtime.get("base_url")) or None,
        api_key=_string(runtime.get("api_key")) or None,
        temperature=temperature,
        max_tokens=max_tokens,
        credential_source=_string(runtime.get("credential_source")) or None,
    )


def _reference_media_path(reference: Dict[str, Any]) -> Optional[str]:
    stored_path = _string(reference.get("stored_path"))
    if not stored_path:
        return None
    path = Path(stored_path)
    if not path.is_absolute():
        path = settings.data_root / path
    return str(path) if path.exists() else None


def _asset_media_path(asset: Dict[str, Any]) -> Optional[str]:
    for key in ("hero_original_path", "hero_web_path", "hero_poster_path", "hero_thumb_path"):
        stored_path = _string(asset.get(key))
        if not stored_path:
            continue
        path = Path(stored_path)
        if not path.is_absolute():
            path = settings.data_root / path
        if path.exists():
            return str(path)
    return None


def _attachment_image_paths(attachments: List[Dict[str, Any]]) -> List[str]:
    paths: List[str] = []
    for attachment in attachments:
        if len(paths) >= ASSISTANT_IMAGE_ATTACHMENT_LIMIT:
            break
        if not is_image_attachment(attachment):
            continue
        reference = store.get_reference_media(_string(attachment.get("reference_id")))
        if not reference:
            continue
        path = _reference_media_path(reference)
        if path:
            paths.append(path)
    return paths


def _latest_output_image_paths(context: Dict[str, Any]) -> List[str]:
    latest_run = context.get("latest_graph_run")
    if not isinstance(latest_run, dict):
        return []
    asset_paths: List[str] = []
    fallback_reference_paths: List[str] = []
    artifacts = latest_run.get("artifacts")
    if not isinstance(artifacts, list):
        return []
    for artifact in artifacts:
        if len(asset_paths) >= ASSISTANT_IMAGE_ATTACHMENT_LIMIT:
            break
        if not isinstance(artifact, dict):
            continue
        media_type = _string(artifact.get("media_type") or artifact.get("kind")).lower()
        if media_type and media_type != "image":
            continue
        asset_id = _string(artifact.get("asset_id"))
        if asset_id:
            asset = store.get_asset(asset_id)
            path = _asset_media_path(asset or {})
            if path:
                asset_paths.append(path)
                continue
        reference_id = _string(artifact.get("reference_id"))
        if reference_id:
            reference = store.get_reference_media(reference_id)
            path = _reference_media_path(reference or {})
            if path:
                fallback_reference_paths.append(path)
    return asset_paths or fallback_reference_paths[:ASSISTANT_IMAGE_ATTACHMENT_LIMIT]


def _assistant_image_paths(context: Dict[str, Any], attachments: List[Dict[str, Any]]) -> List[str]:
    paths: List[str] = []
    for path in [*_latest_output_image_paths(context), *_attachment_image_paths(attachments)]:
        if path in paths:
            continue
        paths.append(path)
        if len(paths) >= ASSISTANT_IMAGE_ATTACHMENT_LIMIT:
            break
    return paths


def _image_path_trace(paths: List[str]) -> Dict[str, Any]:
    return {
        "provider_image_path_count": len(paths),
        "provider_image_path_basenames": [Path(path).name[:120] for path in paths],
        "provider_image_path_hashes": [
            hashlib.sha256(str(path).encode("utf-8")).hexdigest()[:16]
            for path in paths
        ],
    }


def _workflow_id_from_context(context: Dict[str, Any]) -> Optional[str]:
    workflow = context.get("workflow")
    if not isinstance(workflow, dict):
        return None
    return _string(workflow.get("workflow_id")) or None


def _media_preset_builder_state(session: Dict[str, Any]) -> Dict[str, Any]:
    summary = session.get("summary_json") if isinstance(session.get("summary_json"), dict) else {}
    builder_state = summary.get("media_preset_builder") if isinstance(summary.get("media_preset_builder"), dict) else {}
    return dict(builder_state or {})


def _codex_skill_session_key(
    *,
    session: Dict[str, Any],
    context: Dict[str, Any],
    attachments: List[Dict[str, Any]],
) -> Optional[str]:
    assistant_session_id = _string(session.get("assistant_session_id"))
    if not assistant_session_id:
        return None
    workflow_tab_id = _string(session.get("owner_id")) or _workflow_id_from_context(context) or "standalone"
    builder_state = _media_preset_builder_state(session)
    lane = _string(builder_state.get("lane") or builder_state.get("preset_loop_lane") or "auto")
    return "|".join(
        [
            "assistant",
            assistant_session_id,
            "skill",
            "media_preset_builder",
            "workflow",
            workflow_tab_id,
            "lane",
            lane,
            "attachments",
            attachment_set_hash(attachments),
        ]
    )


def _explicit_fresh_codex_session_request(text: str) -> bool:
    normalized = _string(text).lower()
    fresh_cues = (
        "start fresh",
        "fresh start",
        "new session",
        "reset this assistant",
        "restart the assistant",
        "clear this assistant",
    )
    return any(cue in normalized for cue in fresh_cues)


def _reusable_provider_thread_id(session: Dict[str, Any], context: Dict[str, Any], attachments: List[Dict[str, Any]]) -> Optional[str]:
    builder_state = _media_preset_builder_state(session)
    current_hash = attachment_set_hash(attachments)
    stored_hash = _string(builder_state.get("attachment_set_hash"))
    if stored_hash and stored_hash != current_hash:
        return None
    current_workflow_tab_id = _string(session.get("owner_id")) or _workflow_id_from_context(context)
    stored_workflow_tab_id = _string(builder_state.get("workflow_tab_id"))
    if stored_workflow_tab_id and current_workflow_tab_id and stored_workflow_tab_id != current_workflow_tab_id:
        return None
    return (
        _string(builder_state.get("provider_thread_id"))
        or _string(builder_state.get("provider_session_id"))
        or _string(session.get("provider_thread_id"))
        or None
    )


def _build_history_messages(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    selected = [
        item
        for item in messages
        if item.get("role") in {"user", "assistant"} and _string(item.get("content_text"))
    ][-ASSISTANT_CHAT_HISTORY_LIMIT:]
    return [{"role": item["role"], "content": _string(item.get("content_text"))} for item in selected]


def _build_provider_messages(
    *,
    user_text: str,
    context: Dict[str, Any],
    messages: List[Dict[str, Any]],
    image_paths: List[str],
) -> tuple[List[Dict[str, Any]], Dict[str, Any]]:
    prompt_route = _string(context.get("assistant_prompt_route")) or None
    prompt_assembly = assistant_system_prompt_assembly(prompt_route)
    system_prompt = prompt_assembly.prompt
    context_text = (
        "Current Media Studio context follows as compact JSON. It is already redacted. "
        "Use it for available node types, presets, recipes, current workflow state, and attached media metadata.\n"
        f"{_compact_context(context)}"
    )
    history = _build_history_messages(messages)
    user_content: str | List[Dict[str, Any]]
    if image_paths:
        user_content = enhancement_provider.build_openai_compatible_multimodal_content(
            text=user_text,
            image_paths=image_paths,
        )
    else:
        user_content = user_text
    return (
        [
            {"role": "system", "content": system_prompt},
            {"role": "system", "content": context_text},
            *history,
            {"role": "user", "content": user_content},
        ],
        {
            "assistant_prompt_route": prompt_assembly.prompt_route,
            "loaded_prompt_assets": list(prompt_assembly.loaded_assets),
            "system_prompt_char_count": prompt_assembly.char_count,
        },
    )


def run_assistant_provider_chat(
    *,
    session: Dict[str, Any],
    user_text: str,
    context: Dict[str, Any],
    messages: List[Dict[str, Any]],
    attachments: List[Dict[str, Any]],
    cancel_event: Event | None = None,
) -> Dict[str, Any]:
    runtime = _resolve_provider_runtime(session)
    image_paths = _assistant_image_paths(context, attachments)
    image_path_trace = _image_path_trace(image_paths)
    provider_messages, prompt_assembly_trace = _build_provider_messages(
        user_text=user_text,
        context=context,
        messages=messages,
        image_paths=image_paths,
    )
    started = time.perf_counter()
    try:
        if runtime.provider_kind == "codex_local":
            force_new_codex_session = _explicit_fresh_codex_session_request(user_text)
            provider_result = enhancement_provider.run_codex_local_chat(
                model_id=runtime.provider_model_id,
                messages=provider_messages,
                error_context="media assistant chat",
                timeout_seconds=ASSISTANT_CODEX_LOCAL_TIMEOUT_SECONDS,
                cancel_event=cancel_event,
                codex_session_key=_codex_skill_session_key(session=session, context=context, attachments=attachments),
                provider_thread_id=None if force_new_codex_session else _reusable_provider_thread_id(session, context, attachments),
                force_new_codex_session=force_new_codex_session,
            )
        else:
            provider_result = enhancement_provider.run_openai_compatible_chat(
                provider_kind=runtime.provider_kind,
                base_url=runtime.provider_base_url or "",
                api_key=runtime.api_key,
                model_id=runtime.provider_model_id,
                messages=provider_messages,
                temperature=runtime.temperature,
                max_tokens=runtime.max_tokens,
                error_context="media assistant chat",
            )
    except enhancement_provider.EnhancementProviderError as exc:
        if is_cancelled(cancel_event):
            raise AssistantRequestCancelled("Assistant request was cancelled.") from exc
        raise AssistantProviderChatError(str(exc)) from exc
    if is_cancelled(cancel_event):
        raise AssistantRequestCancelled("Assistant request was cancelled.")

    latency_ms = int((time.perf_counter() - started) * 1000)
    usage = provider_result.get("usage") if isinstance(provider_result.get("usage"), dict) else {}
    external_llm_usage.record_external_llm_usage(
        provider_kind=_string(provider_result.get("provider_kind") or runtime.provider_kind),
        provider_model_id=_string(provider_result.get("provider_model_id") or runtime.provider_model_id),
        provider_response_id=provider_result.get("provider_response_id"),
        usage=usage,
        source_kind=ASSISTANT_CHAT_SOURCE_KIND,
        workflow_id=_workflow_id_from_context(context),
        metadata_json={
            "assistant_session_id": session.get("assistant_session_id"),
            "owner_kind": session.get("owner_kind"),
            "owner_id": session.get("owner_id"),
            "image_count": len(image_paths),
            **image_path_trace,
            "credential_source": runtime.credential_source,
            "provider_thread_id": provider_result.get("provider_thread_id"),
            "provider_turn_id": provider_result.get("provider_turn_id"),
            "provider_thread_reused": provider_result.get("provider_thread_reused"),
            "fallback_mode": provider_result.get("fallback_mode"),
            **prompt_assembly_trace,
        },
    )
    return {
        **provider_result,
        "latency_ms": latency_ms,
        "image_count": len(image_paths),
        **image_path_trace,
        "mode": "provider_chat",
        "credential_source": runtime.credential_source,
        **prompt_assembly_trace,
    }
