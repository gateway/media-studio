from __future__ import annotations

import hashlib
import json
from typing import Any, Dict, Literal, Optional

from pydantic import BaseModel, Field, ValidationError

from .. import store, store_assistant
from ..schemas import (
    PromptRecipeCustomField,
    PromptRecipeImageInputConfig,
    PromptRecipeUpsertRequest,
    PromptRecipeVariable,
)
from ..service_errors import ServiceError
from ..service_prompt_recipe_validation import validate_prompt_recipe_payload
from ..store_support import new_id
from .provenance import recipe_quality_contract_hash


class RecipeKernelError(Exception):
    def __init__(self, *, code: str, message: str, retryable: bool = True):
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable


class SearchPromptRecipesArguments(BaseModel):
    query: str = Field(default="", max_length=120)
    category: Optional[str] = Field(default=None, max_length=80)
    limit: int = Field(default=20, ge=1, le=30)


class GetPromptRecipeArguments(BaseModel):
    recipe_id_or_key: str = Field(min_length=1, max_length=180)


class ValidatePromptRecipeDraftArguments(BaseModel):
    draft: Dict[str, Any]
    existing_recipe_id: Optional[str] = Field(default=None, max_length=160)


class KernelPromptRecipeImageInputConfig(PromptRecipeImageInputConfig):
    mode: Literal["none", "direct_reference", "analyze_then_inject", "both"] = "none"


class KernelPromptRecipeDraft(BaseModel):
    key: str
    label: str
    description: str = ""
    category: Literal["image", "video", "analysis", "utility"]
    status: Literal["active", "inactive", "archived"] = "active"
    system_prompt_template: str
    image_analysis_prompt: str = ""
    user_prompt_placeholder: str = "{{user_prompt}}"
    output_format: Literal[
        "single_prompt",
        "prompt_list",
        "json_prompt_batch",
        "image_analysis",
        "structured_shot_sequence",
    ] = "single_prompt"
    output_contract_json: Dict[str, Any] = Field(default_factory=dict)
    input_variables_json: list[PromptRecipeVariable] = Field(default_factory=list)
    custom_fields_json: list[PromptRecipeCustomField] = Field(default_factory=list)
    image_input_json: KernelPromptRecipeImageInputConfig = Field(
        default_factory=KernelPromptRecipeImageInputConfig
    )
    default_options_json: Dict[str, Any] = Field(default_factory=dict)
    rules_json: Dict[str, Any] = Field(default_factory=dict)
    notes: str = ""
    source_kind: Literal["custom", "imported", "builtin", "built_in_override"] = "custom"
    version: str = "1"
    priority: int = 0


class ProposePromptRecipeDraftArguments(BaseModel):
    draft: KernelPromptRecipeDraft
    existing_recipe_id: Optional[str] = Field(default=None, max_length=160)
    request_save_confirmation: bool = False


def _full_recipe_contract(record: Dict[str, Any]) -> Dict[str, Any]:
    contract = PromptRecipeUpsertRequest.model_validate(record).model_dump(mode="json")
    for alias in (
        "output_contract",
        "input_variables",
        "custom_fields",
        "image_input",
        "validation_warnings",
        "default_options",
        "rules",
    ):
        contract.pop(alias, None)
    return contract


def search_prompt_recipes(arguments: BaseModel, _context: Any) -> Dict[str, Any]:
    options = SearchPromptRecipesArguments.model_validate(arguments)
    query_tokens = [item for item in options.query.lower().split() if item]
    items = []
    for record in store.list_prompt_recipes(status="active", category=options.category):
        haystack = " ".join(
            str(record.get(key) or "").lower()
            for key in ("key", "label", "description", "category", "output_format")
        )
        if query_tokens and not all(token in haystack for token in query_tokens):
            continue
        image_input = record.get("image_input_json") if isinstance(record.get("image_input_json"), dict) else {}
        items.append(
            {
                "recipe_id": record.get("recipe_id"),
                "key": record.get("key"),
                "label": record.get("label"),
                "description": record.get("description"),
                "category": record.get("category"),
                "output_format": record.get("output_format"),
                "input_variables": [
                    {
                        "key": item.get("key"),
                        "label": item.get("label"),
                        "required": bool(item.get("required")),
                    }
                    for item in record.get("input_variables_json") or []
                ],
                "custom_fields": [
                    {
                        "key": item.get("key"),
                        "label": item.get("label"),
                        "type": item.get("type"),
                        "required": bool(item.get("required")),
                    }
                    for item in record.get("custom_fields_json") or []
                ],
                "image_input": {
                    "enabled": bool(image_input.get("enabled")),
                    "required": bool(image_input.get("required")),
                    "mode": image_input.get("mode") or "none",
                    "max_files": int(image_input.get("max_files") or 0),
                },
            }
        )
        if len(items) >= options.limit:
            break
    return {"items": items, "count": len(items)}


def get_prompt_recipe(arguments: BaseModel, _context: Any) -> Dict[str, Any]:
    options = GetPromptRecipeArguments.model_validate(arguments)
    record = (
        store.get_prompt_recipe(options.recipe_id_or_key)
        or store.get_prompt_recipe_by_key(options.recipe_id_or_key)
    )
    if not record:
        raise RecipeKernelError(
            code="prompt_recipe_not_found",
            message="That Prompt Recipe does not exist.",
            retryable=False,
        )
    return _full_recipe_contract(record)


def _validated_draft(
    draft: PromptRecipeUpsertRequest | KernelPromptRecipeDraft | Dict[str, Any],
    *,
    recipe_id: Optional[str] = None,
) -> Dict[str, Any]:
    try:
        raw_draft = draft.model_dump(mode="json") if isinstance(draft, BaseModel) else draft
        normalized = validate_prompt_recipe_payload(
            PromptRecipeUpsertRequest.model_validate(raw_draft),
            recipe_id=recipe_id,
        )
    except (ServiceError, ValidationError) as exc:
        raise RecipeKernelError(code="invalid_prompt_recipe_draft", message=str(exc)) from exc
    return _full_recipe_contract(normalized)


def _editable_recipe_id(
    *,
    draft_key: str,
    current_draft: Any,
    prior_proposal: Any,
    requested_recipe_id: Optional[str] = None,
) -> Optional[str]:
    if requested_recipe_id:
        requested = store.get_prompt_recipe(requested_recipe_id)
        if not requested or str(requested.get("key") or "") != draft_key:
            raise RecipeKernelError(
                code="prompt_recipe_revision_mismatch",
                message="The requested existing Prompt Recipe does not match this draft key.",
                retryable=False,
            )
        return requested_recipe_id
    existing = store.get_prompt_recipe_by_key(draft_key)
    prior_existing_recipe_id = (
        str(prior_proposal.get("existing_recipe_id") or "")
        if isinstance(prior_proposal, dict)
        else ""
    )
    if (
        existing
        and isinstance(current_draft, dict)
        and str(current_draft.get("key") or "") == draft_key
        and isinstance(prior_proposal, dict)
        and (
            prior_proposal.get("consumed") is True
            or prior_existing_recipe_id == str(existing.get("recipe_id") or "")
        )
    ):
        return str(existing.get("recipe_id") or "") or None
    return None


def validate_prompt_recipe_draft(arguments: BaseModel, context: Any) -> Dict[str, Any]:
    options = ValidatePromptRecipeDraftArguments.model_validate(arguments)
    session = store_assistant.get_assistant_session(context.session_id) if context.session_id else None
    summary = dict((session or context.session or {}).get("summary_json") or {})
    draft = _validated_draft(
        options.draft,
        recipe_id=_editable_recipe_id(
            draft_key=str(options.draft.get("key") or ""),
            current_draft=summary.get("kernel_recipe_draft"),
            prior_proposal=summary.get("kernel_recipe_proposal"),
            requested_recipe_id=options.existing_recipe_id,
        ),
    )
    return {
        "valid": True,
        "draft": draft,
        "warnings": draft.get("validation_warnings_json") or [],
    }


def propose_prompt_recipe_draft(arguments: BaseModel, context: Any) -> Dict[str, Any]:
    options = ProposePromptRecipeDraftArguments.model_validate(arguments)
    if not context.session_id:
        raise RecipeKernelError(
            code="prompt_recipe_session_unavailable",
            message="A Prompt Recipe draft requires an active assistant session.",
            retryable=False,
        )
    session = store_assistant.get_assistant_session(context.session_id) or dict(context.session or {})
    if not session:
        raise RecipeKernelError(
            code="prompt_recipe_session_unavailable",
            message="A Prompt Recipe draft requires an active assistant session.",
            retryable=False,
        )
    summary = dict(session.get("summary_json") or {})
    current_draft = summary.get("kernel_recipe_draft")
    prior_proposal = summary.get("kernel_recipe_proposal")
    draft_key = str(options.draft.key or "")
    editable_recipe_id = _editable_recipe_id(
        draft_key=draft_key,
        current_draft=current_draft,
        prior_proposal=prior_proposal,
        requested_recipe_id=options.existing_recipe_id,
    )
    draft = _validated_draft(options.draft, recipe_id=editable_recipe_id)
    run_evidence = summary.get("kernel_recipe_run_evidence")
    if (
        isinstance(run_evidence, dict)
        and str(run_evidence.get("recipe_quality_contract_hash") or "")
        != recipe_quality_contract_hash(draft)
    ):
        summary.pop("kernel_recipe_run_association", None)
        summary.pop("kernel_recipe_run_evidence", None)
        summary.pop("kernel_recipe_output_comparison", None)
        summary.pop("kernel_recipe_quality", None)
    if isinstance(current_draft, dict) and context.artifact_intent == "revise_recipe":
        if _full_recipe_contract(current_draft) == draft:
            raise RecipeKernelError(
                code="prompt_recipe_draft_unchanged",
                message="The user requested a revision, but the typed Prompt Recipe draft did not change.",
            )
    save_ready = bool(
        options.request_save_confirmation and context.artifact_intent == "save_recipe"
    )
    proposal_id = new_id("asrecipe")
    confirmation_token = new_id("confirm") if save_ready else None
    proposal = {
        "proposal_id": proposal_id,
        "draft": draft,
        "draft_hash": hashlib.sha256(
            json.dumps(draft, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest(),
        "existing_recipe_id": editable_recipe_id,
        "save_ready": save_ready,
        "consumed": False,
        "confirmation_token_hash": (
            hashlib.sha256(confirmation_token.encode("utf-8")).hexdigest()
            if confirmation_token
            else None
        ),
    }
    summary["kernel_recipe_draft"] = draft
    summary["kernel_recipe_proposal"] = proposal
    store_assistant.create_or_update_assistant_session({**session, "summary_json": summary})
    return {
        "proposal_id": proposal_id,
        "confirmation_token": confirmation_token,
        "draft": draft,
        "validation": {
            "valid": True,
            "errors": [],
            "warnings": draft.get("validation_warnings_json") or [],
        },
        "save_ready": save_ready,
        "requires_confirmation": save_ready,
    }
