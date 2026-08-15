from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field

from .. import kie_adapter, store, store_assistant
from ..schemas import PresetUpsertRequest
from ..service_errors import ServiceError
from ..service_preset_validation import validate_preset_payload
from ..store_support import new_id
from .preset_fields import (
    latest_reference_analysis,
    latest_replaceable_elements,
    validate_assistant_preset_fields,
)
from .preset_confirmation import preset_quality_is_verified
from .preset_slots import validate_assistant_preset_slots
from .provenance import preset_quality_contract_hash


class PresetKernelError(Exception):
    def __init__(self, *, code: str, message: str, retryable: bool = True):
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable


class SearchPresetsArguments(BaseModel):
    query: str = Field(default="", max_length=120)
    category: Optional[str] = Field(default=None, max_length=80)
    limit: int = Field(default=20, ge=1, le=30)


class GetPresetArguments(BaseModel):
    preset_id_or_key: str = Field(min_length=1, max_length=160)


class ListMediaModelsArguments(BaseModel):
    mode: Literal["any", "text_to_image", "image_to_image", "video"] = "any"
    model_key: Optional[str] = Field(default=None, max_length=160)
    limit: int = Field(default=30, ge=1, le=60)


class ProposeMediaPresetDraftArguments(BaseModel):
    draft: PresetUpsertRequest
    test_plan_id: Optional[str] = Field(default=None, max_length=160)
    comparison_id: Optional[str] = Field(default=None, max_length=160)
    allow_unverified_save: bool = False


def search_presets(arguments: BaseModel, _context: Any) -> Dict[str, Any]:
    options = SearchPresetsArguments.model_validate(arguments)
    page = store.list_presets_page(
        limit=options.limit,
        offset=0,
        q=options.query or None,
        category=options.category,
        status="active",
    )
    return {
        "items": [
            {
                "preset_id": item.get("preset_id"),
                "key": item.get("key"),
                "label": item.get("label"),
                "description": item.get("description"),
                "category": item.get("category"),
                "model_key": item.get("model_key"),
                "applies_to_models": item.get("applies_to_models_json") or [],
                "applies_to_task_modes": item.get("applies_to_task_modes_json") or [],
                "requires_image": bool(item.get("requires_image")),
            }
            for item in page["items"]
        ],
        "total": page["total"],
    }


def get_preset(arguments: BaseModel, _context: Any) -> Dict[str, Any]:
    options = GetPresetArguments.model_validate(arguments)
    record = store.get_preset(options.preset_id_or_key) or store.get_preset_by_key(options.preset_id_or_key)
    if not record:
        raise PresetKernelError(code="preset_not_found", message="That Media Preset does not exist.", retryable=False)
    return PresetUpsertRequest.model_validate(
        {
            **record,
            "system_prompt_ids": record.get("system_prompt_ids_json") or [],
        }
    ).model_dump(mode="json")


_VIDEO_TASK_MODES = {
    "text_to_video",
    "image_to_video",
    "reference_to_video",
    "motion_control",
}


def _input_limits(model: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    raw = model.get("raw") if isinstance(model.get("raw"), dict) else {}
    inputs = raw.get("inputs") if isinstance(raw.get("inputs"), dict) else {}
    constraints = raw.get("input_constraints") if isinstance(raw.get("input_constraints"), dict) else {}
    limits: Dict[str, Dict[str, Any]] = {}
    for media_type in ("image", "video", "audio"):
        counts = inputs.get(media_type) if isinstance(inputs.get(media_type), dict) else None
        prefix = f"{media_type}_"
        limits[media_type] = {
            "required_min": counts.get("required_min") if counts else None,
            "required_max": counts.get("required_max") if counts else None,
            **{
                key[len(prefix) :]: value
                for key, value in constraints.items()
                if key.startswith(prefix)
            },
        }
    return limits


def _option_constraint(raw: Dict[str, Any], key: str) -> Dict[str, Any]:
    options = raw.get("options") if isinstance(raw.get("options"), dict) else {}
    option = options.get(key) if isinstance(options.get(key), dict) else {}
    return {
        "allowed": option.get("allowed"),
        "min": option.get("min"),
        "max": option.get("max"),
        "default": option.get("default"),
    }


def _cost_basis(rule: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not rule:
        return {
            "pricing_status": "unknown",
            "billing_unit": None,
            "base_credits": None,
            "base_cost_usd": None,
            "option_dependent_fields": [],
        }
    dependent_fields = set()
    for key in ("multipliers", "adders_credits", "adders_cost_usd"):
        values = rule.get(key) if isinstance(rule.get(key), dict) else {}
        dependent_fields.update(str(item) for item in values)
    return {
        "pricing_status": rule.get("pricing_status") or "unknown",
        "billing_unit": rule.get("billing_unit"),
        "base_credits": rule.get("base_credits"),
        "base_cost_usd": rule.get("base_cost_usd"),
        "option_dependent_fields": sorted(dependent_fields),
    }


def _model_name_matches(requested: str, model: Dict[str, Any]) -> bool:
    requested_name = re.sub(r"[^a-z0-9]+", "-", requested.lower()).strip("-")
    for value in (model.get("key"), model.get("label")):
        candidate = re.sub(r"[^a-z0-9]+", "-", str(value or "").lower()).strip("-")
        if candidate == requested_name or candidate.startswith(f"{requested_name}-"):
            return True
    return False


def list_media_models(arguments: BaseModel, _context: Any) -> Dict[str, Any]:
    options = ListMediaModelsArguments.model_validate(arguments)
    pricing = kie_adapter.pricing_snapshot(force_refresh=False)
    pricing_rules = {
        str(rule.get("model_key") or ""): rule
        for rule in pricing.get("rules") or []
        if isinstance(rule, dict)
    }
    items: List[Dict[str, Any]] = []
    kie_spec_version: Optional[str] = None
    catalog_models = kie_adapter.list_models()
    exact_model_key_exists = bool(
        options.model_key
        and any(str(model.get("key") or "") == options.model_key for model in catalog_models)
    )
    for model in catalog_models:
        task_modes = [str(item) for item in model.get("task_modes") or []]
        model_key = str(model.get("key") or "")
        if model.get("studio_exposed") is False:
            continue
        if options.model_key:
            if exact_model_key_exists and model_key != options.model_key:
                continue
            if not exact_model_key_exists and not _model_name_matches(options.model_key, model):
                continue
        if options.mode == "text_to_image" and "text_to_image" not in task_modes:
            continue
        if options.mode == "image_to_image" and "image_edit" not in task_modes:
            continue
        if options.mode == "video" and not (_VIDEO_TASK_MODES & set(task_modes)):
            continue
        raw = model.get("raw") if isinstance(model.get("raw"), dict) else {}
        input_patterns = [str(item) for item in model.get("input_patterns") or []]
        input_limits = _input_limits(model)
        is_video = bool(_VIDEO_TASK_MODES & set(task_modes))
        kie_spec_version = kie_spec_version or model.get("kie_spec_version")
        items.append(
            {
                "model_key": model_key,
                "label": model.get("label") or model_key,
                "task_modes": task_modes,
                "input_patterns": input_patterns,
                "input_limits": input_limits,
                "image_limits": {
                    key: input_limits["image"].get(key)
                    for key in ("required_min", "required_max")
                },
                "frame_support": {
                    "first_frame": (
                        True
                        if is_video and {"single_image", "first_last_frames"} & set(input_patterns)
                        else None
                    ),
                    "last_frame": True if is_video and "first_last_frames" in input_patterns else None,
                },
                "generation_constraints": {
                    "duration_seconds": _option_constraint(raw, "duration"),
                    "resolutions": _option_constraint(raw, "resolution"),
                    "aspect_ratios": _option_constraint(raw, "aspect_ratio"),
                },
                "cost_basis": _cost_basis(pricing_rules.get(model_key)),
            }
        )
        if len(items) >= options.limit:
            break
    return {
        "models": items,
        "count": len(items),
        "catalog": {
            "kie_spec_version": kie_spec_version,
            "pricing_version": pricing.get("version"),
            "pricing_source": pricing.get("source"),
        },
    }


def _validated_test_plan(
    test_plan_id: str,
    session_id: str,
    draft: Dict[str, Any],
    *,
    allow_missing_contract_hash: bool = False,
) -> Dict[str, Any]:
    plan = store_assistant.get_assistant_plan(test_plan_id)
    if not plan or str(plan.get("assistant_session_id") or "") != session_id:
        raise PresetKernelError(code="preset_test_plan_not_found", message="The linked test graph is unavailable.")
    if str(plan.get("status") or "") != "applied":
        raise PresetKernelError(
            code="preset_test_graph_not_applied",
            message="Use the latest applied test graph before requesting preset save confirmation.",
        )
    validation = plan.get("validation_json") if isinstance(plan.get("validation_json"), dict) else {}
    pricing = plan.get("pricing_json") if isinstance(plan.get("pricing_json"), dict) else {}
    total = (
        pricing.get("pricing_summary", {}).get("total", {})
        if isinstance(pricing.get("pricing_summary"), dict)
        else {}
    )
    if not validation.get("valid"):
        raise PresetKernelError(code="preset_test_graph_invalid", message="The test graph must validate before saving.")
    if total.get("estimated_credits") is None and total.get("estimated_cost_usd") is None:
        raise PresetKernelError(code="preset_test_price_missing", message="The test graph needs a price estimate before saving.")
    rules = draft.get("rules_json") if isinstance(draft.get("rules_json"), dict) else {}
    task_modes = [str(item) for item in draft.get("applies_to_task_modes") or []]
    lane = str(rules.get("preset_lane") or (task_modes[0] if task_modes else ""))
    expected_template = {
        "text_to_image": "preset_style_t2i_sandbox_v1",
        "image_to_image": "preset_style_i2i_sandbox_v1",
    }.get(lane)
    plan_json = plan.get("plan_json") if isinstance(plan.get("plan_json"), dict) else {}
    metadata = plan_json.get("metadata") if isinstance(plan_json.get("metadata"), dict) else {}
    contract_hash = str(metadata.get("preset_quality_contract_hash") or "")
    if (
        not expected_template
        or metadata.get("template_id") != expected_template
        or metadata.get("template_mode") != lane
        or metadata.get("template_model_key") != draft.get("model_key")
        or (
            contract_hash != preset_quality_contract_hash(draft)
            and not (allow_missing_contract_hash and not contract_hash)
        )
    ):
        raise PresetKernelError(
            code="preset_test_plan_mismatch",
            message="Use the applied preset test graph that matches this draft's lane and model.",
        )
    return plan


def propose_media_preset_draft(arguments: BaseModel, context: Any) -> Dict[str, Any]:
    options = ProposeMediaPresetDraftArguments.model_validate(arguments)
    if not context.session_id:
        raise PresetKernelError(
            code="preset_draft_session_unavailable",
            message="A Media Preset draft requires an active assistant session.",
            retryable=False,
        )
    try:
        validate_preset_payload(options.draft)
    except ServiceError as exc:
        raise PresetKernelError(code="invalid_media_preset_draft", message=str(exc)) from exc
    session = store_assistant.get_assistant_session(context.session_id) or dict(context.session or {})
    if not session:
        raise PresetKernelError(
            code="preset_draft_session_unavailable",
            message="A Media Preset draft requires an active assistant session.",
            retryable=False,
        )
    summary = dict(session.get("summary_json") or {})
    current_draft = (
        summary.get("kernel_preset_draft")
        if isinstance(summary.get("kernel_preset_draft"), dict)
        else None
    )
    current_rules = (
        current_draft.get("rules_json")
        if isinstance(current_draft, dict)
        and isinstance(current_draft.get("rules_json"), dict)
        else {}
    )
    current_analysis_id = str(current_rules.get("analysis_id") or "")
    try:
        field_quality = validate_assistant_preset_fields(
            options.draft,
            replaceable_elements=latest_replaceable_elements(
                summary,
                analysis_id=current_analysis_id,
            ),
            user_text=str(getattr(context, "user_text", "") or ""),
        )
    except ValueError as exc:
        raise PresetKernelError(code="invalid_media_preset_fields", message=str(exc)) from exc
    try:
        lane_quality = validate_assistant_preset_slots(
            options.draft,
            user_text=str(getattr(context, "user_text", "") or ""),
            current_draft=current_draft,
        )
    except ValueError as exc:
        raise PresetKernelError(code="invalid_media_preset_slots", message=str(exc)) from exc
    current_normalized = (
        PresetUpsertRequest.model_validate(current_draft).model_dump(mode="json")
        if isinstance(current_draft, dict)
        else None
    )
    revised_normalized = options.draft.model_dump(mode="json")
    reference_analysis = latest_reference_analysis(summary)
    bound_analysis_id = current_analysis_id or (
        str(reference_analysis.get("analysis_id") or "")
        if reference_analysis
        else ""
    )
    if bound_analysis_id:
        rules = dict(revised_normalized.get("rules_json") or {})
        rules["analysis_id"] = bound_analysis_id
        revised_normalized["rules_json"] = rules
    if current_normalized is not None and context.artifact_intent == "revise_preset":
        if current_normalized == revised_normalized:
            raise PresetKernelError(
                code="preset_draft_unchanged",
                message="The user requested a revision, but the typed Media Preset draft did not change.",
            )
    active_comparison = summary.get("kernel_preset_output_comparison")
    active_quality = summary.get("kernel_preset_quality")
    continued_comparison_id = (
        str(active_quality.get("comparison_id") or "")
        if isinstance(active_quality, dict)
        and active_quality.get("decision") == "continue"
        and isinstance(active_comparison, dict)
        and str(active_comparison.get("comparison_id") or "")
        == str(active_quality.get("comparison_id") or "")
        else ""
    )
    if (
        current_normalized is not None
        and context.artifact_intent == "revise_preset"
        and continued_comparison_id
        and options.comparison_id != continued_comparison_id
    ):
        raise PresetKernelError(
            code="preset_refinement_comparison_required",
            message="Bind the accepted visual improvement to its exact output comparison before revising the preset.",
        )
    refined_from_comparison_id = None
    if options.comparison_id:
        comparison = active_comparison
        quality = active_quality
        if (
            not isinstance(comparison, dict)
            or str(comparison.get("comparison_id") or "") != options.comparison_id
            or not isinstance(quality, dict)
            or quality.get("decision") != "continue"
            or str(quality.get("comparison_id") or "") != options.comparison_id
        ):
            raise PresetKernelError(
                code="preset_refinement_decision_required",
                message="Accept the latest reviewed prompt improvement before applying it.",
            )
        if current_normalized is None or context.artifact_intent != "revise_preset":
            raise PresetKernelError(
                code="preset_refinement_draft_required",
                message="A focused output refinement requires the active Media Preset draft.",
            )
        current_contract = {key: value for key, value in current_normalized.items() if key != "prompt_template"}
        revised_contract = {key: value for key, value in revised_normalized.items() if key != "prompt_template"}
        if current_contract != revised_contract:
            raise PresetKernelError(
                code="preset_refinement_scope_changed",
                message="A focused output refinement may change only the prompt; keep the approved preset contract intact.",
            )
        comparison_result = comparison.get("comparison") if isinstance(comparison.get("comparison"), dict) else {}
        if not comparison_result.get("meaningful_gap") or not str(comparison_result.get("prompt_delta") or "").strip():
            raise PresetKernelError(
                code="preset_refinement_delta_missing",
                message="The latest visual review did not identify a meaningful prompt improvement to apply.",
            )
        expected_prompt = " ".join(
            [
                str(current_normalized.get("prompt_template") or "").strip(),
                str(comparison_result.get("prompt_delta") or "").strip(),
            ]
        ).strip()
        if str(revised_normalized.get("prompt_template") or "").strip() != expected_prompt:
            raise PresetKernelError(
                code="preset_refinement_prompt_mismatch",
                message="Keep the approved prompt intact and append only the accepted focused prompt delta.",
            )
        refined_from_comparison_id = options.comparison_id
    quality_contract_changed = bool(
        current_normalized is not None
        and preset_quality_contract_hash(current_normalized)
        != preset_quality_contract_hash(revised_normalized)
    )
    active_proposal = summary.get("kernel_preset_proposal")
    inherited_test_plan_id = (
        str(active_proposal.get("test_plan_id") or "")
        if not quality_contract_changed and isinstance(active_proposal, dict)
        else ""
    )
    effective_test_plan_id = options.test_plan_id or inherited_test_plan_id or None
    verified_evidence = bool(
        current_normalized is not None
        and not quality_contract_changed
        and effective_test_plan_id
        and preset_quality_is_verified(
            summary,
            session_id=context.session_id,
            test_plan_id=effective_test_plan_id,
        )
    )
    test_plan = (
        _validated_test_plan(
            effective_test_plan_id,
            context.session_id,
            revised_normalized,
            allow_missing_contract_hash=verified_evidence,
        )
        if effective_test_plan_id
        else None
    )
    quality_verified = verified_evidence
    quality_state = "quality_verified" if quality_verified else "test_ready" if test_plan else "draft_ready"
    save_requested = bool(test_plan and context.artifact_intent == "save_preset")
    offered_message_id = (
        str(active_proposal.get("unverified_save_offered_message_id") or "")
        if isinstance(active_proposal, dict)
        else ""
    )
    if save_requested and options.allow_unverified_save and not quality_verified:
        if (
            not offered_message_id
            or not context.user_message_id
            or offered_message_id == context.user_message_id
        ):
            raise PresetKernelError(
                code="unverified_save_acceptance_required",
                message="Offer the warned unverified-draft option first, then wait for the user to accept it in a later message.",
            )
    unverified_offer_message_id = offered_message_id or (
        str(context.user_message_id or "")
        if save_requested and not quality_verified and not options.allow_unverified_save
        else ""
    )
    save_mode = (
        "verified"
        if save_requested and quality_verified
        else "unverified"
        if save_requested and options.allow_unverified_save
        else None
    )
    save_ready = save_mode is not None
    draft = revised_normalized
    proposal_id = new_id("aspreset")
    confirmation_token = new_id("confirm") if save_ready else None
    proposal = {
        "proposal_id": proposal_id,
        "draft": draft,
        "draft_hash": hashlib.sha256(
            json.dumps(draft, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest(),
        "test_plan_id": effective_test_plan_id,
        "refined_from_comparison_id": refined_from_comparison_id,
        "quality_state": quality_state,
        "save_mode": save_mode,
        "save_ready": save_ready,
        "consumed": False,
        "unverified_save_offered_message_id": unverified_offer_message_id or None,
        "confirmation_token_hash": (
            hashlib.sha256(confirmation_token.encode("utf-8")).hexdigest()
            if confirmation_token
            else None
        ),
    }
    if quality_contract_changed and isinstance(summary.get("kernel_preset_output_comparison"), dict):
        comparison = summary["kernel_preset_output_comparison"]
        comparison_result = (
            comparison.get("comparison")
            if isinstance(comparison.get("comparison"), dict)
            else {}
        )
        history = list(summary.get("kernel_preset_refinement_history") or [])
        history.append(
            {
                "comparison_id": str(comparison.get("comparison_id") or ""),
                "run_id": str(comparison.get("run_id") or ""),
                "output_asset_id": str(comparison.get("output_asset_id") or ""),
                "prompt_delta": str(comparison_result.get("prompt_delta") or ""),
                "preserve_traits": list(comparison_result.get("preserve_traits") or []),
                "decision": (
                    summary.get("kernel_preset_quality", {}).get("decision")
                    if isinstance(summary.get("kernel_preset_quality"), dict)
                    else None
                ),
                "previous_draft_hash": hashlib.sha256(
                    json.dumps(current_normalized or {}, sort_keys=True, separators=(",", ":")).encode("utf-8")
                ).hexdigest(),
                "revised_draft_hash": proposal["draft_hash"],
                "recorded_at": store_assistant.utcnow_iso(),
            }
        )
        summary["kernel_preset_refinement_history"] = history[-8:]
    if quality_contract_changed:
        summary.pop("kernel_run_confirmation", None)
        summary.pop("kernel_preset_run_evidence", None)
        summary.pop("kernel_preset_output_comparison", None)
        summary.pop("kernel_preset_quality", None)
    summary["kernel_preset_draft"] = draft
    summary["kernel_preset_proposal"] = proposal
    if save_ready:
        store_assistant.reject_validated_assistant_plans(context.session_id)
    store_assistant.create_or_update_assistant_session({**session, "summary_json": summary})
    return {
        "proposal_id": proposal_id,
        "confirmation_token": confirmation_token,
        "draft": draft,
        "validation": {"valid": True, "errors": []},
        "field_quality": field_quality,
        "lane_quality": lane_quality,
        "test_graph": (
            {
                "plan_id": effective_test_plan_id,
                "status": test_plan.get("status"),
                "validation": test_plan.get("validation_json"),
                "pricing": test_plan.get("pricing_json"),
            }
            if test_plan
            else None
        ),
        "save_ready": save_ready,
        "quality_state": quality_state,
        "save_mode": save_mode,
        "requires_confirmation": save_ready,
        "refined_from_comparison_id": refined_from_comparison_id,
    }
