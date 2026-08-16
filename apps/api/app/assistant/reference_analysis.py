from __future__ import annotations

import hashlib
import json
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, ValidationError, model_validator

from .. import enhancement_provider, store, store_assistant
from ..graph.media_refs import graph_ref_path
from ..graph.schemas import GraphOutputRef
from .limits import ASSISTANT_IMAGE_ATTACHMENT_LIMIT, is_image_attachment
from .provider_support import reference_media_path, resolve_assistant_provider_runtime
from .schemas import AssistantVisualAnalysis, AssistantVisualAnalysisGoal


REFERENCE_ANALYSIS_CACHE_LIMIT = 24


class AnalyzeReferenceImagesArguments(BaseModel):
    reference_ids: List[str] = Field(min_length=1, max_length=ASSISTANT_IMAGE_ATTACHMENT_LIMIT)
    goal: AssistantVisualAnalysisGoal
    focus: Optional[str] = Field(default=None, max_length=500)


class AnalyzeGeneratedOutputArguments(BaseModel):
    output_asset_id: str = Field(min_length=1, max_length=160)
    reference_ids: List[str] = Field(min_length=1, max_length=ASSISTANT_IMAGE_ATTACHMENT_LIMIT)
    focus: Optional[str] = Field(default=None, max_length=500)


class GeneratedOutputComparison(BaseModel):
    matches: List[str] = Field(default_factory=list, max_length=5)
    missing_or_drifting: List[str] = Field(default_factory=list, max_length=5)
    prompt_delta: str = Field(default="", max_length=1200)
    preserve_traits: List[str] = Field(min_length=1, max_length=12)
    meaningful_gap: bool = False

    @model_validator(mode="after")
    def validate_grounded_delta(self) -> "GeneratedOutputComparison":
        if not self.matches and not self.missing_or_drifting:
            raise ValueError("Output comparison requires at least one visible observation.")
        if self.meaningful_gap and (not self.missing_or_drifting or not self.prompt_delta.strip()):
            raise ValueError("A meaningful gap requires visible drift and one focused prompt delta.")
        if not self.meaningful_gap and self.prompt_delta.strip():
            raise ValueError("Do not propose a prompt delta when the output has no meaningful gap.")
        return self


class RecordPresetQualityDecisionArguments(BaseModel):
    decision: Literal["approve", "continue", "stop"]


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


def _comparison_response_format(output_kind: str = "preset") -> Dict[str, Any]:
    return {
        "type": "json_schema",
        "json_schema": {
            "name": f"media_assistant_{output_kind}_output_comparison",
            "strict": True,
            "schema": GeneratedOutputComparison.model_json_schema(),
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


def _asset_image_path(asset_id: str, output_kind: str = "preset") -> str:
    try:
        return str(
            graph_ref_path(
                GraphOutputRef(kind="asset", asset_id=asset_id),
                expected_media_type="image",
            )
        )
    except ValueError as exc:
        raise ReferenceAnalysisError(
            code=f"{output_kind}_output_inaccessible",
            message=f"The generated {output_kind} output is missing or inaccessible.",
        ) from exc


def _active_session(context: Any) -> Dict[str, Any]:
    session = (
        store_assistant.get_assistant_session(str(context.session_id or ""))
        if context.session_id
        else None
    )
    session = session or dict(context.session or {})
    if not session:
        raise ReferenceAnalysisError(
            code="analysis_cache_unavailable",
            message="Visual review requires an active assistant session.",
        )
    return session


def _analyze_output(arguments: BaseModel, context: Any, *, output_kind: Literal["preset", "recipe"]) -> Dict[str, Any]:
    options = AnalyzeGeneratedOutputArguments.model_validate(arguments)
    session = _active_session(context)
    summary = dict(session.get("summary_json") or {})
    run_evidence_key = f"kernel_{output_kind}_run_evidence"
    comparison_key = f"kernel_{output_kind}_output_comparison"
    run_evidence = summary.get(run_evidence_key)
    if (
        not isinstance(run_evidence, dict)
        or run_evidence.get("status") != "completed"
        or options.output_asset_id not in list(run_evidence.get("output_asset_ids") or [])
    ):
        raise ReferenceAnalysisError(
            code=f"{output_kind}_output_not_session_owned",
            message=f"Review only a completed output bound to this Media Assistant {output_kind} run.",
        )
    selected_run_id = str(context.run_id or "")
    if selected_run_id and selected_run_id != str(run_evidence.get("run_id") or ""):
        raise ReferenceAnalysisError(
            code=f"{output_kind}_output_run_mismatch",
            message=f"Review only output from the currently selected {output_kind} run.",
        )
    selected = _selected_attachments(options.reference_ids, list(context.attachments or []))
    if output_kind == "preset":
        draft = summary.get("kernel_preset_draft") if isinstance(summary.get("kernel_preset_draft"), dict) else {}
        rules = draft.get("rules_json") if isinstance(draft.get("rules_json"), dict) else {}
        analysis_id = str(rules.get("analysis_id") or "")
        analysis_cache = summary.get("reference_analysis_cache")
        style_reference_ids = {
            str(reference_id)
            for cached in (analysis_cache.values() if isinstance(analysis_cache, dict) else [])
            if isinstance(cached, dict) and str(cached.get("analysis_id") or "") == analysis_id
            for reference_id in list(cached.get("reference_ids") or [])
            if str(reference_id)
        }
        requested_reference_ids = {str(item.get("reference_id") or "") for item in selected}
        if not analysis_id or requested_reference_ids != style_reference_ids:
            raise ReferenceAnalysisError(
                code="preset_style_reference_mismatch",
                message="Review only the style references that produced this preset's visual analysis.",
            )
    output_path = (
        _asset_image_path(options.output_asset_id)
        if output_kind == "preset"
        else _asset_image_path(options.output_asset_id, output_kind)
    )
    reference_paths = _reference_paths(selected)
    focus = str(options.focus or "").strip()
    instruction = (
        f"The first supplied image is the generated {output_kind} output. Every remaining image is a source "
        "reference and must never be described as generated output. Compare only visible evidence. Return "
        "what matches, what is missing or drifting, one focused prompt delta, the traits that must remain "
        "unchanged, and whether the gap is meaningful. Do not invent a defect to justify another generation. "
        f"Focus: {focus or 'the approved visual language'}."
    )
    messages = [
        {
            "role": "system",
            "content": (
                f"You are the Media Assistant {output_kind}-output comparison tool. Fill every field in the requested "
                "schema with concise observations grounded only in the supplied images."
            ),
        },
        {
            "role": "user",
            "content": enhancement_provider.build_openai_compatible_multimodal_content(
                text=instruction,
                image_paths=[output_path, *reference_paths],
            ),
        },
    ]
    runtime = resolve_assistant_provider_runtime(session)
    if runtime.provider_kind != "codex_local":
        raise ReferenceAnalysisError(
            code="analysis_provider_unsupported",
            message=f"The configured assistant provider cannot compare {output_kind} output through the kernel.",
        )
    try:
        provider_result = enhancement_provider.run_codex_local_chat(
            model_id=runtime.provider_model_id,
            messages=messages,
            response_format=_comparison_response_format(output_kind),
            error_context=f"media assistant {output_kind} output comparison",
            timeout_seconds=context.timeout_seconds,
            cancel_event=context.cancel_event,
        )
        comparison = GeneratedOutputComparison.model_validate_json(
            str(provider_result.get("generated_text") or "{}")
        )
    except (enhancement_provider.EnhancementProviderError, ValidationError) as exc:
        raise ReferenceAnalysisError(
            code=f"{output_kind}_output_comparison_failed",
            message=str(exc),
            retryable=True,
        ) from exc

    latest_session = _active_session(context)
    latest_summary = dict(latest_session.get("summary_json") or {})
    latest_run_evidence = latest_summary.get(run_evidence_key)
    if (
        not isinstance(latest_run_evidence, dict)
        or str(latest_run_evidence.get("run_id") or "") != str(run_evidence.get("run_id") or "")
        or options.output_asset_id not in list(latest_run_evidence.get("output_asset_ids") or [])
    ):
        raise ReferenceAnalysisError(
            code=f"{output_kind}_output_evidence_changed",
            message=f"A newer {output_kind} run completed while this output was being reviewed. Review the latest output instead.",
        )
    session = latest_session
    summary = latest_summary
    run_evidence = latest_run_evidence

    reference_ids = [str(item.get("reference_id") or "") for item in selected]
    comparison_hash = hashlib.sha256(
        json.dumps(
            {
                "run_id": run_evidence.get("run_id"),
                "output_asset_id": options.output_asset_id,
                "reference_ids": reference_ids,
                "comparison": comparison.model_dump(mode="json"),
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()[:24]
    result = {
        "comparison_id": f"{output_kind}cmp_{comparison_hash}",
        "run_id": str(run_evidence.get("run_id") or ""),
        "output_asset_id": options.output_asset_id,
        "reference_ids": reference_ids,
        "image_roles": [
            {"role": "generated_output", "asset_id": options.output_asset_id},
            *[
                {
                    "role": "style_reference" if output_kind == "preset" else "source_reference",
                    "reference_id": reference_id,
                }
                for reference_id in reference_ids
            ],
        ],
        "comparison": comparison.model_dump(mode="json"),
        "quality_state": "reviewed",
    }
    summary[comparison_key] = result
    if output_kind == "preset":
        summary.pop("kernel_preset_quality", None)
    store_assistant.create_or_update_assistant_session({**session, "summary_json": summary})
    return result


def analyze_preset_output(arguments: BaseModel, context: Any) -> Dict[str, Any]:
    return _analyze_output(arguments, context, output_kind="preset")


def analyze_recipe_output(arguments: BaseModel, context: Any) -> Dict[str, Any]:
    return _analyze_output(arguments, context, output_kind="recipe")


def record_preset_quality_decision(arguments: BaseModel, context: Any) -> Dict[str, Any]:
    options = RecordPresetQualityDecisionArguments.model_validate(arguments)
    session = _active_session(context)
    summary = dict(session.get("summary_json") or {})
    comparison = summary.get("kernel_preset_output_comparison")
    run_evidence = summary.get("kernel_preset_run_evidence")
    if not isinstance(comparison, dict):
        raise ReferenceAnalysisError(
            code="preset_output_comparison_required",
            message="Review the actual generated output before recording a quality decision.",
        )
    output_asset_id = str(comparison.get("output_asset_id") or "")
    comparison_result = (
        comparison.get("comparison")
        if isinstance(comparison.get("comparison"), dict)
        else {}
    )
    if (
        not isinstance(run_evidence, dict)
        or str(comparison.get("run_id") or "") != str(run_evidence.get("run_id") or "")
        or output_asset_id not in list(run_evidence.get("output_asset_ids") or [])
    ):
        raise ReferenceAnalysisError(
            code="preset_output_comparison_stale",
            message="Review the latest generated output before recording a quality decision.",
        )
    user_text = str(getattr(context, "user_text", "") or "").strip()
    if not user_text:
        raise ReferenceAnalysisError(
            code="preset_quality_user_decision_required",
            message="A quality decision must come from the user's current message.",
        )
    if options.decision == "continue" and (
        not comparison_result.get("meaningful_gap")
        or not str(comparison_result.get("prompt_delta") or "").strip()
    ):
        raise ReferenceAnalysisError(
            code="preset_refinement_delta_missing",
            message="The visual review did not identify a meaningful prompt improvement to apply.",
        )
    quality_state = {
        "approve": "quality_verified",
        "continue": "needs_work",
        "stop": "stopped",
    }[options.decision]
    result = {
        "quality_state": quality_state,
        "decision": options.decision,
        "comparison_id": str(comparison.get("comparison_id") or ""),
        "run_id": str(comparison.get("run_id") or ""),
        "output_asset_id": output_asset_id,
        "user_approved": options.decision == "approve",
        "user_statement_hash": hashlib.sha256(user_text.encode("utf-8")).hexdigest(),
        "recorded_at": store_assistant.utcnow_iso(),
    }
    summary["kernel_preset_quality"] = result
    store_assistant.create_or_update_assistant_session({**session, "summary_json": summary})
    return result


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
            if not cached.get("reference_ids"):
                cached = {
                    **cached,
                    "reference_ids": [str(item.get("reference_id") or "") for item in selected],
                }
                cache[cache_key] = cached
                summary["reference_analysis_cache"] = cache
                store_assistant.create_or_update_assistant_session({**session, "summary_json": summary})
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
        "reference_ids": [str(item.get("reference_id") or "") for item in selected],
        "analysis": analysis.model_dump(mode="json"),
    }
    if cache_key not in cache and len(cache) >= REFERENCE_ANALYSIS_CACHE_LIMIT:
        oldest_key = next(iter(cache))
        cache.pop(oldest_key, None)
    cache[cache_key] = result
    summary["reference_analysis_cache"] = cache
    store_assistant.create_or_update_assistant_session({**session, "summary_json": summary})
    return {**result, "cache_status": "miss"}
