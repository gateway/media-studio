from __future__ import annotations

import hashlib
import json
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, ValidationError

from .. import enhancement_provider, store, store_assistant
from .limits import ASSISTANT_IMAGE_ATTACHMENT_LIMIT, is_image_attachment
from .provider_support import reference_media_path, resolve_assistant_provider_runtime
from .schemas import AssistantVisualAnalysis, AssistantVisualAnalysisGoal


REFERENCE_ANALYSIS_CACHE_LIMIT = 24


class AnalyzeReferenceImagesArguments(BaseModel):
    reference_ids: List[str] = Field(min_length=1, max_length=ASSISTANT_IMAGE_ATTACHMENT_LIMIT)
    goal: AssistantVisualAnalysisGoal
    focus: Optional[str] = Field(default=None, max_length=500)


class ReferenceAnalysisError(Exception):
    def __init__(self, *, code: str, message: str, retryable: bool = False):
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable


def _attachment_set_hash(attachments: List[Dict[str, Any]]) -> str:
    canonical = [
        {
            "assistant_attachment_id": str(item.get("assistant_attachment_id") or ""),
            "reference_id": str(item.get("reference_id") or ""),
            "kind": str(item.get("kind") or ""),
            "label": str(item.get("label") or ""),
        }
        for item in attachments
    ]
    canonical.sort(
        key=lambda item: (
            item["reference_id"],
            item["assistant_attachment_id"],
            item["label"],
        )
    )
    return hashlib.sha256(
        json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def _analysis_response_format() -> Dict[str, Any]:
    return {
        "type": "json_schema",
        "json_schema": {
            "name": "media_assistant_reference_analysis",
            "strict": True,
            "schema": AssistantVisualAnalysis.model_json_schema(),
        },
    }


def _cache_key(attachment_hash: str, goal: AssistantVisualAnalysisGoal) -> str:
    canonical = f"{attachment_hash}|{goal}"
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:24]


def _selected_attachments(reference_ids: List[str], attachments: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    requested = list(dict.fromkeys(str(item or "").strip() for item in reference_ids if str(item or "").strip()))
    if not requested or len(requested) > ASSISTANT_IMAGE_ATTACHMENT_LIMIT:
        raise ReferenceAnalysisError(
            code="invalid_reference_count",
            message=f"Choose between 1 and {ASSISTANT_IMAGE_ATTACHMENT_LIMIT} attached reference images.",
        )
    attached_by_reference = {
        str(item.get("reference_id") or ""): item
        for item in attachments
        if is_image_attachment(item) and str(item.get("reference_id") or "")
    }
    missing = [reference_id for reference_id in requested if reference_id not in attached_by_reference]
    if missing:
        raise ReferenceAnalysisError(
            code="reference_not_attached",
            message="Analyze only reference images attached to this assistant session.",
        )
    return [attached_by_reference[reference_id] for reference_id in requested]


def _reference_paths(attachments: List[Dict[str, Any]]) -> List[str]:
    paths = []
    for attachment in attachments:
        reference = store.get_reference_media(str(attachment.get("reference_id") or "")) or {}
        path = reference_media_path(reference)
        if not path:
            raise ReferenceAnalysisError(
                code="reference_inaccessible",
                message="One attached reference image is missing or inaccessible.",
            )
        paths.append(path)
    return paths


def analyze_reference_images(arguments: BaseModel, context: Any) -> Dict[str, Any]:
    options = AnalyzeReferenceImagesArguments.model_validate(arguments)
    selected = _selected_attachments(options.reference_ids, list(context.attachments or []))
    paths = _reference_paths(selected)
    selected_hash = _attachment_set_hash(selected)
    cache_key = _cache_key(selected_hash, options.goal)
    session = store_assistant.get_assistant_session(str(context.session_id or "")) if context.session_id else None
    session = session or dict(context.session or {})
    if not session:
        raise ReferenceAnalysisError(
            code="analysis_cache_unavailable",
            message="Reference analysis requires an active assistant session.",
        )
    summary = dict(session.get("summary_json") or {})
    cache = dict(summary.get("reference_analysis_cache") or {})
    cached = cache.get(cache_key)
    if isinstance(cached, dict):
        try:
            analysis = AssistantVisualAnalysis.model_validate(cached.get("analysis"))
        except ValidationError:
            cache.pop(cache_key, None)
        else:
            return {
                **cached,
                "analysis": analysis.model_dump(mode="json"),
                "cache_status": "hit",
            }

    runtime = resolve_assistant_provider_runtime(session)
    if runtime.provider_kind != "codex_local":
        raise ReferenceAnalysisError(
            code="analysis_provider_unsupported",
            message="The configured assistant provider cannot analyze reference images through the kernel.",
        )
    focus = str(options.focus or "").strip()
    instruction = (
        "Analyze the attached images as visual evidence. Return concise observable traits, separating reusable "
        "fixed traits from replaceable content and exclusions. Do not infer identity or hidden facts. "
        f"Analysis goal: {options.goal}. Focus: {focus or 'none'}."
    )
    messages = [
        {
            "role": "system",
            "content": (
                "You are the Media Assistant visual-analysis tool. Fill every field in the requested schema. "
                "Use short concrete phrases grounded only in the supplied images."
            ),
        },
        {
            "role": "user",
            "content": enhancement_provider.build_openai_compatible_multimodal_content(
                text=instruction,
                image_paths=paths,
            ),
        },
    ]
    try:
        provider_result = enhancement_provider.run_codex_local_chat(
            model_id=runtime.provider_model_id,
            messages=messages,
            response_format=_analysis_response_format(),
            error_context="media assistant reference analysis",
            timeout_seconds=context.timeout_seconds,
            cancel_event=context.cancel_event,
        )
        analysis = AssistantVisualAnalysis.model_validate_json(str(provider_result.get("generated_text") or "{}"))
    except (enhancement_provider.EnhancementProviderError, ValidationError) as exc:
        raise ReferenceAnalysisError(
            code="reference_analysis_failed",
            message=str(exc),
            retryable=True,
        ) from exc

    result = {
        "analysis_id": f"visual_{cache_key}",
        "goal": options.goal,
        "focus": focus or None,
        "attachment_set_hash": selected_hash,
        "reference_count": len(selected),
        "analysis": analysis.model_dump(mode="json"),
    }
    if cache_key not in cache and len(cache) >= REFERENCE_ANALYSIS_CACHE_LIMIT:
        oldest_key = next(iter(cache))
        cache.pop(oldest_key, None)
    cache[cache_key] = result
    summary["reference_analysis_cache"] = cache
    store_assistant.create_or_update_assistant_session({**session, "summary_json": summary})
    return {**result, "cache_status": "miss"}
