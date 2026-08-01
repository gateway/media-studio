from __future__ import annotations

import hashlib
import json
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field

from .. import kie_adapter, store, store_assistant
from ..schemas import PresetUpsertRequest
from ..service_errors import ServiceError
from ..service_preset_validation import validate_preset_payload
from ..store_support import new_id


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
    for model in kie_adapter.list_models():
        task_modes = [str(item) for item in model.get("task_modes") or []]
        model_key = str(model.get("key") or "")
        if model.get("studio_exposed") is False:
            continue
        if options.model_key and model_key != options.model_key:
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


def _validated_test_plan(test_plan_id: str, session_id: str) -> Dict[str, Any]:
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
    current_draft = (
        session.get("summary_json", {}).get("kernel_preset_draft")
        if isinstance(session.get("summary_json"), dict)
        else None
    )
    if isinstance(current_draft, dict) and context.artifact_intent == "revise_preset":
        current_normalized = PresetUpsertRequest.model_validate(current_draft).model_dump(mode="json")
        if current_normalized == options.draft.model_dump(mode="json"):
            raise PresetKernelError(
                code="preset_draft_unchanged",
                message="The user requested a revision, but the typed Media Preset draft did not change.",
            )
    test_plan = _validated_test_plan(options.test_plan_id, context.session_id) if options.test_plan_id else None
    save_ready = bool(test_plan and context.artifact_intent == "save_preset")
    draft = options.draft.model_dump(mode="json")
    proposal_id = new_id("aspreset")
    confirmation_token = new_id("confirm") if save_ready else None
    proposal = {
        "proposal_id": proposal_id,
        "draft": draft,
        "draft_hash": hashlib.sha256(
            json.dumps(draft, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest(),
        "test_plan_id": options.test_plan_id,
        "save_ready": save_ready,
        "consumed": False,
        "confirmation_token_hash": (
            hashlib.sha256(confirmation_token.encode("utf-8")).hexdigest()
            if confirmation_token
            else None
        ),
    }
    summary = dict(session.get("summary_json") or {})
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
        "test_graph": (
            {
                "plan_id": options.test_plan_id,
                "status": test_plan.get("status"),
                "validation": test_plan.get("validation_json"),
                "pricing": test_plan.get("pricing_json"),
            }
            if test_plan
            else None
        ),
        "save_ready": save_ready,
        "requires_confirmation": save_ready,
    }
