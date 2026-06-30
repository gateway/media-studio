from __future__ import annotations

import json
import time
from threading import Event
from typing import Any, Dict, List, Optional

from pydantic import ValidationError

from .. import enhancement_provider, external_llm_usage
from ..graph.registry import registry
from ..graph.schemas import GraphNodeDefinition, GraphWorkflow
from .cancellation import AssistantRequestCancelled, is_cancelled
from .context import build_attachment_summary
from .provider_chat import (
    AssistantProviderChatError,
    _attachment_image_paths,
    _resolve_provider_runtime,
    _string,
    _workflow_id_from_context,
    assistant_codex_timeout_seconds,
)
from .schemas import AssistantGraphPlan
from .skills import select_assistant_skill


ASSISTANT_PLAN_SOURCE_KIND = "media_assistant_graph_plan"
ASSISTANT_PLAN_RETRY_LIMIT = 1
ASSISTANT_PLAN_CONTEXT_LIMIT = 28000
ASSISTANT_CODEX_LOCAL_PLAN_TIMEOUT_SECONDS = assistant_codex_timeout_seconds(
    "MEDIA_ASSISTANT_CODEX_PLAN_TIMEOUT_SECONDS",
    120.0,
)
SUPPORTED_GRAPH_OPERATIONS = {
    "add_node",
    "set_node_field",
    "set_node_title",
    "add_note",
    "connect_nodes",
    "group_nodes",
    "layout_nodes",
    "save_workflow",
    "set_provider_model",
    "set_execution_mode",
}
GRAPH_OPERATION_ALIASES = {
    "set_field": "set_node_field",
    "set_fields": "set_node_field",
    "update_field": "set_node_field",
    "update_node_field": "set_node_field",
}


def _extract_json_object(raw_text: str) -> Dict[str, Any]:
    cleaned = str(raw_text or "").strip()
    if not cleaned:
        raise AssistantProviderChatError("Codex Local returned an empty graph plan.")
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start < 0 or end <= start:
            raise AssistantProviderChatError("Codex Local did not return JSON for the graph plan.")
        try:
            parsed = json.loads(cleaned[start : end + 1])
        except json.JSONDecodeError as exc:
            raise AssistantProviderChatError("Codex Local returned invalid graph plan JSON.") from exc
    if not isinstance(parsed, dict):
        raise AssistantProviderChatError("Codex Local graph plan must be a JSON object.")
    return parsed


def _schema_response_format() -> Dict[str, Any]:
    return {
        "type": "json_schema",
        "json_schema": {
            "name": "media_studio_graph_plan",
            "strict": True,
            "schema": AssistantGraphPlan.model_json_schema(),
        },
    }


def _compact_options(options: Any) -> List[Any]:
    if not isinstance(options, list):
        return []
    compacted: List[Any] = []
    for option in options[:10]:
        if isinstance(option, dict):
            compacted.append(option.get("value") or option.get("id") or option.get("label"))
        else:
            compacted.append(option)
    return compacted


def _compact_node_definition(definition: GraphNodeDefinition) -> Dict[str, Any]:
    return {
        "type": definition.type,
        "title": definition.title,
        "category": definition.category,
        "inputs": [
            {
                "id": port.id,
                "type": port.type,
                "array": port.array,
                "required": port.required,
                "accepts": port.accepts,
            }
            for port in definition.ports.get("inputs", [])
            if not port.advanced
        ],
        "outputs": [
            {
                "id": port.id,
                "type": port.type,
                "array": port.array,
                "required": port.required,
            }
            for port in definition.ports.get("outputs", [])
            if not port.advanced
        ],
        "fields": [
            {
                "id": field.id,
                "type": field.type,
                "required": field.required,
                "options": _compact_options(field.options),
            }
            for field in definition.fields
            if not field.hidden
        ],
    }


def _catalog_for_prompt() -> List[Dict[str, Any]]:
    allowed_categories = {"Inputs", "Models/Image", "Models/Video", "Models/Audio", "Prompt", "Media", "Preset", "Preview", "Utility"}
    return [
        _compact_node_definition(definition)
        for definition in registry.list_definitions()
        if not definition.source.get("hidden") and definition.category in allowed_categories
    ]


def _compact_plan_context(payload: Dict[str, Any]) -> str:
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    if len(raw) <= ASSISTANT_PLAN_CONTEXT_LIMIT:
        return raw
    trimmed = dict(payload)
    if isinstance(trimmed.get("node_catalog"), list):
        priority_types = {
            "prompt.text",
            "media.load_image",
            "media.save_image",
            "media.save_images",
            "preset.render",
            "preview.image",
            "display.any",
            "utility.note",
            "model.kie.gpt_image_2_text_to_image",
            "model.kie.gpt_image_2_image_to_image",
            "model.kie.nano_banana_2",
            "model.kie.nano_banana_pro",
            "model.kie.kling_3_0_t2v",
            "model.kie.kling_3_0_i2v",
            "model.kie.suno_generate_music",
        }
        trimmed["node_catalog"] = [
            item
            for item in trimmed["node_catalog"]
            if isinstance(item, dict) and str(item.get("type") or "") in priority_types
        ]
    trimmed["truncated_for_planning"] = True
    raw = json.dumps(trimmed, ensure_ascii=False, sort_keys=True)
    return raw[:ASSISTANT_PLAN_CONTEXT_LIMIT]


def _build_plan_messages(*, message: str, workflow: GraphWorkflow, context: Dict[str, Any], attachments: List[Dict[str, Any]], retry_reason: Optional[str] = None) -> List[Dict[str, Any]]:
    skill = select_assistant_skill(message)
    system_prompt = (
        "You are Media Studio's graph workflow planner. Return one strict JSON object matching the AssistantGraphPlan schema. "
        "Only use node types, fields, and ports from the provided node catalog. "
        "Use stable node_ref names for new nodes, then connect by those refs. "
        "Every graph change must be represented as operations. Never start a paid run. "
        "If the request is underspecified, include questions and keep operations empty. "
        "Do not include markdown, comments, or text outside the JSON object."
    )
    available_context = {
        "selected_skill": {
            "skill_id": skill.skill_id,
            "capability": skill.capability,
            "output_contract": skill.output_contract,
        },
        "workflow": context.get("workflow"),
        "canvas_context": context.get("canvas_context"),
        "node_catalog": _catalog_for_prompt(),
        "media_presets": context.get("media_presets"),
        "attachments": build_attachment_summary(attachments),
        "assistant_limits": context.get("assistant_limits"),
    }
    user_text = (
        f"User request: {message}\n\n"
        f"Current workflow name: {workflow.name}\n"
        "Return a graph plan for Media Studio. Prefer simple, usable workflows with clear groups and notes. "
        "When the request references an existing Media Preset, look it up in media_presets and use its preset_id in preset.render fields. "
        "For image-to-image requests with attached images, use media.load_image. "
        "For output, include preview and save nodes when the workflow creates media.\n\n"
        f"Context JSON:\n{_compact_plan_context(available_context)}"
    )
    if retry_reason:
        user_text += f"\n\nPrevious plan failed validation: {retry_reason}\nReturn corrected JSON only."
    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_text},
    ]


def _validate_plan_payload(payload: Dict[str, Any]) -> AssistantGraphPlan:
    payload = _normalize_plan_payload(payload)
    try:
        plan = AssistantGraphPlan(**payload)
    except ValidationError as exc:
        raise AssistantProviderChatError(f"Codex Local graph plan did not match the schema: {exc.errors()[0].get('msg', 'invalid plan')}.") from exc
    if plan.capability != "plan_graph":
        raise AssistantProviderChatError("Codex Local did not return a workflow graph plan.")
    return plan


def _normalize_plan_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    normalized = dict(payload)
    operations = normalized.get("operations")
    if not isinstance(operations, list):
        return normalized
    warnings = list(normalized.get("warnings") or [])
    next_operations: List[Dict[str, Any]] = []
    for index, operation in enumerate(operations):
        if not isinstance(operation, dict):
            raise AssistantProviderChatError(f"Codex Local graph plan operation {index + 1} is not an object.")
        next_operation = dict(operation)
        op = str(next_operation.get("op") or "").strip()
        if op in GRAPH_OPERATION_ALIASES:
            repaired_op = GRAPH_OPERATION_ALIASES[op]
            if repaired_op == "set_node_field" and not isinstance(next_operation.get("fields"), dict):
                field_id = str(next_operation.get("field_id") or "").strip()
                if field_id:
                    next_operation["fields"] = {field_id: next_operation.get("value")}
            next_operation["op"] = repaired_op
            warnings.append(f"Repaired unsupported operation `{op}` to `{repaired_op}`.")
            op = repaired_op
        if op not in SUPPORTED_GRAPH_OPERATIONS:
            raise AssistantProviderChatError(f"Codex Local returned unsupported graph operation `{op or 'missing'}`.")
        next_operations.append(next_operation)
    normalized["operations"] = next_operations
    normalized["warnings"] = warnings
    return normalized


def run_provider_graph_plan(
    *,
    session: Dict[str, Any],
    message: str,
    workflow: GraphWorkflow,
    context: Dict[str, Any],
    attachments: List[Dict[str, Any]],
    cancel_event: Event | None = None,
) -> Dict[str, Any]:
    runtime = _resolve_provider_runtime(session)
    if runtime.provider_kind != "codex_local":
        raise AssistantProviderChatError("Provider-backed graph planning is currently enabled for Codex Local only.")

    started = time.perf_counter()
    last_error = ""
    provider_result: Dict[str, Any] = {}
    for attempt in range(ASSISTANT_PLAN_RETRY_LIMIT + 1):
        messages = _build_plan_messages(
            message=message,
            workflow=workflow,
            context=context,
            attachments=attachments,
            retry_reason=last_error or None,
        )
        try:
            provider_result = enhancement_provider.run_codex_local_chat(
                model_id=runtime.provider_model_id,
                messages=messages,
                response_format=_schema_response_format(),
                error_context="media assistant graph planning",
                timeout_seconds=ASSISTANT_CODEX_LOCAL_PLAN_TIMEOUT_SECONDS,
                cancel_event=cancel_event,
            )
            plan = _validate_plan_payload(_extract_json_object(str(provider_result.get("generated_text") or "")))
            break
        except AssistantProviderChatError as exc:
            last_error = str(exc)
            if attempt >= ASSISTANT_PLAN_RETRY_LIMIT:
                raise
        except enhancement_provider.EnhancementProviderError as exc:
            if is_cancelled(cancel_event):
                raise AssistantRequestCancelled("Assistant planning was cancelled.") from exc
            last_error = str(exc)
            if attempt >= ASSISTANT_PLAN_RETRY_LIMIT:
                raise AssistantProviderChatError(last_error) from exc
        if is_cancelled(cancel_event):
            raise AssistantRequestCancelled("Assistant planning was cancelled.")
    else:  # pragma: no cover - defensive loop guard
        raise AssistantProviderChatError(last_error or "Codex Local graph planning failed.")

    image_count = len(_attachment_image_paths(attachments))
    latency_ms = int((time.perf_counter() - started) * 1000)
    usage = provider_result.get("usage") if isinstance(provider_result.get("usage"), dict) else {}
    external_llm_usage.record_external_llm_usage(
        provider_kind=_string(provider_result.get("provider_kind") or runtime.provider_kind),
        provider_model_id=_string(provider_result.get("provider_model_id") or runtime.provider_model_id),
        provider_response_id=provider_result.get("provider_response_id"),
        usage=usage,
        source_kind=ASSISTANT_PLAN_SOURCE_KIND,
        workflow_id=_workflow_id_from_context(context),
        metadata_json={
            "assistant_session_id": session.get("assistant_session_id"),
            "owner_kind": session.get("owner_kind"),
            "owner_id": session.get("owner_id"),
            "image_count": image_count,
            "attempts": attempt + 1,
            "credential_source": runtime.credential_source,
        },
    )
    return {
        "graph_plan": plan,
        "mode": "provider_graph_plan",
        "provider_kind": provider_result.get("provider_kind") or runtime.provider_kind,
        "provider_model_id": provider_result.get("provider_model_id") or runtime.provider_model_id,
        "provider_response_id": provider_result.get("provider_response_id"),
        "usage": usage,
        "prompt_tokens": provider_result.get("prompt_tokens"),
        "completion_tokens": provider_result.get("completion_tokens"),
        "total_tokens": provider_result.get("total_tokens"),
        "cost": provider_result.get("cost"),
        "latency_ms": latency_ms,
        "image_count": image_count,
        "attempts": attempt + 1,
    }
