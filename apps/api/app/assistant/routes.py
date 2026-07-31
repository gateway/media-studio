from __future__ import annotations

import hashlib
import hmac
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query

from .. import store, store_assistant
from ..graph.normalization import materialize_workflow_defaults
from ..graph.pricing import estimate_graph_workflow
from ..graph.registry import registry
from ..graph.schemas import GraphEstimateResponse, GraphValidationResult, GraphWorkflow
from ..graph.validator import validate_workflow
from ..service_errors import ServiceError
from ..service_preset_validation import upsert_preset
from ..service_prompt_recipe_validation import upsert_prompt_recipe
from .cancellation import AssistantSessionBusy
from .graph_diff import graph_plan_diff_summary, graph_plan_layout_errors
from .graph_plan import apply_graph_plan
from .kernel_route import create_kernel_message
from .kernel_tools import workflow_fingerprint
from .limits import ASSISTANT_IMAGE_ATTACHMENT_LIMIT, is_image_attachment
from .preset_confirmation import (
    PresetConfirmationError,
    consume_preset_confirmation,
    resolve_confirmed_preset_draft,
)
from .provider_support import (
    archive_assistant_session,
    assistant_provider_fields,
    cancel_assistant_session,
)
from .recipe_confirmation import (
    RecipeConfirmationError,
    consume_recipe_confirmation,
    resolve_confirmed_recipe_draft,
)
from .run_confirmation import confirm_kernel_run_action
from .schemas import (
    AssistantArtifactSaveResponse,
    AssistantAttachment,
    AssistantAttachmentCreateRequest,
    AssistantDraftCreateRequest,
    AssistantGraphPlan,
    AssistantMediaPresetDraftResponse,
    AssistantMediaPresetSaveRequest,
    AssistantMessageCreateRequest,
    AssistantPlan,
    AssistantPlanApplyRequest,
    AssistantPlanApplyResponse,
    AssistantPlanCreateRequest,
    AssistantPlanResponse,
    AssistantPromptRecipeDraftResponse,
    AssistantPromptRecipeSaveRequest,
    AssistantRunConfirmationRequest,
    AssistantSession,
    AssistantSessionCreateRequest,
    AssistantSessionListResponse,
)

router = APIRouter(prefix="/media/assistant", tags=["media-assistant"])


def _not_found(name: str) -> HTTPException:
    return HTTPException(status_code=404, detail=f"{name} not found")


def _bad_request(message: str) -> HTTPException:
    return HTTPException(status_code=400, detail=message)


def _latest_relevant_session_plan(record: dict[str, Any]) -> dict[str, Any] | None:
    session_id = str(record["assistant_session_id"])
    owner_kind = str(record.get("owner_kind") or "")
    owner_id = str(record.get("owner_id") or "").strip()
    for plan_record in store_assistant.list_assistant_plans(session_id):
        if str(plan_record.get("status") or "") not in {"validated", "applied", "failed"}:
            continue
        workflow_payload = (
            plan_record.get("workflow_json")
            if isinstance(plan_record.get("workflow_json"), dict)
            else {}
        )
        workflow_id = str(workflow_payload.get("workflow_id") or "").strip()
        applied_workflow_id = str(plan_record.get("applied_workflow_id") or "").strip()
        if (
            owner_kind == "graph_workflow"
            and owner_id
            and owner_id not in {workflow_id, applied_workflow_id}
        ):
            continue
        try:
            response = AssistantPlanResponse(
                plan=AssistantPlan(**plan_record),
                graph_plan=AssistantGraphPlan(**(plan_record.get("plan_json") or {})),
                workflow=GraphWorkflow(**workflow_payload),
                validation=GraphValidationResult(
                    **(plan_record.get("validation_json") or {})
                ),
                pricing=GraphEstimateResponse(**(plan_record.get("pricing_json") or {})),
            )
        except (TypeError, ValueError):
            continue
        return response.model_dump(mode="json")
    return None


def _shape_session(record: dict[str, Any]) -> AssistantSession:
    session_id = str(record["assistant_session_id"])
    return AssistantSession(
        **record,
        messages=store_assistant.list_assistant_messages(session_id),
        attachments=store_assistant.list_assistant_attachments(session_id),
        latest_plan=_latest_relevant_session_plan(record),
    )


def _kernel_draft(
    *,
    session_id: str,
    payload: AssistantDraftCreateRequest,
    mode: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    session = store_assistant.get_assistant_session(session_id)
    if not session:
        raise _not_found("assistant session")
    message = str(payload.message or "").strip()
    if not message:
        raise _bad_request(f"Describe the {'Prompt Recipe' if mode == 'recipe' else 'Media Preset'} first.")
    updated = create_kernel_message(
        session=session,
        payload=AssistantMessageCreateRequest(
            content_text=message,
            workflow=payload.workflow,
            run_id=payload.run_id,
            assistant_mode=mode,
            metadata={"source": f"{mode}_draft_endpoint"},
        ),
        attachments=store_assistant.list_assistant_attachments(session_id),
    )
    summary = updated.get("summary_json") if isinstance(updated.get("summary_json"), dict) else {}
    key = "kernel_recipe_draft" if mode == "recipe" else "kernel_preset_draft"
    draft = summary.get(key)
    if not isinstance(draft, dict):
        label = "Prompt Recipe" if mode == "recipe" else "Media Preset"
        raise _bad_request(f"The assistant did not produce a validated {label} draft.")
    return draft, updated


def _record_saved_artifact(
    *,
    session_id: str,
    kind: str,
    capability: str,
    record: dict[str, Any],
    created: bool,
) -> None:
    is_preset = kind == "media_preset"
    artifact_id = str(
        record.get("preset_id" if is_preset else "recipe_id") or ""
    )
    store_assistant.create_assistant_message(
        {
            "assistant_session_id": session_id,
            "role": "system_summary",
            "content_text": "Saved the confirmed assistant artifact.",
            "content_json": {
                "activity_kind": f"{kind}_saved",
                "capability": capability,
                "created": created,
                "saved_artifact": {
                    "kind": kind,
                    "id": artifact_id,
                    "key": str(record.get("key") or ""),
                    "label": str(record.get("label") or ""),
                },
            },
        }
    )


def _allows_pending_media(validation: GraphValidationResult) -> bool:
    return bool(validation.errors) and all(
        str(error.code or "") == "missing_media_reference"
        for error in validation.errors
    )


@router.post("/sessions", response_model=AssistantSession)
def create_session(payload: AssistantSessionCreateRequest) -> AssistantSession:
    record = store_assistant.create_or_update_assistant_session(
        {
            "owner_kind": payload.owner_kind,
            "owner_id": payload.owner_id,
            **assistant_provider_fields(payload.model_dump()),
            "title": payload.title or "Media assistant",
            "state_snapshot_json": (
                {"workflow": payload.workflow.model_dump(mode="json")}
                if payload.workflow
                else {}
            ),
        }
    )
    return _shape_session(record)


@router.get("/sessions", response_model=AssistantSessionListResponse)
def list_sessions(
    owner_kind: Optional[str] = Query(default=None),
    owner_id: Optional[str] = Query(default=None),
    limit: int = Query(default=20, ge=1, le=50),
) -> AssistantSessionListResponse:
    records = store_assistant.list_assistant_sessions(
        owner_kind=owner_kind,
        owner_id=owner_id,
        limit=limit,
    )
    return AssistantSessionListResponse(items=[_shape_session(item) for item in records])


@router.get("/sessions/{session_id}", response_model=AssistantSession)
def get_session(session_id: str) -> AssistantSession:
    record = store_assistant.get_assistant_session(session_id)
    if not record:
        raise _not_found("assistant session")
    return _shape_session(record)


@router.post("/sessions/{session_id}/messages", response_model=AssistantSession)
def create_message(
    session_id: str,
    payload: AssistantMessageCreateRequest,
) -> AssistantSession:
    session = store_assistant.get_assistant_session(session_id)
    if not session:
        raise _not_found("assistant session")
    if not payload.content_text.strip():
        raise _bad_request("Message text is required.")
    updated = create_kernel_message(
        session=session,
        payload=payload,
        attachments=store_assistant.list_assistant_attachments(session_id),
    )
    return _shape_session(updated)


@router.post("/sessions/{session_id}/attachments", response_model=AssistantAttachment)
def create_attachment(
    session_id: str,
    payload: AssistantAttachmentCreateRequest,
) -> AssistantAttachment:
    if not store_assistant.get_assistant_session(session_id):
        raise _not_found("assistant session")
    reference = store.get_reference_media(payload.reference_id)
    if not reference:
        raise _not_found("reference media")
    existing = store_assistant.list_assistant_attachments(session_id)
    if (
        str(reference.get("kind") or "").lower() == "image"
        and sum(is_image_attachment(item) for item in existing)
        >= ASSISTANT_IMAGE_ATTACHMENT_LIMIT
    ):
        raise _bad_request(
            f"Media Assistant accepts at most {ASSISTANT_IMAGE_ATTACHMENT_LIMIT} image reference(s)."
        )
    attachment = store_assistant.create_assistant_attachment(
        {
            "assistant_session_id": session_id,
            "reference_id": payload.reference_id,
            "kind": str(reference.get("kind") or "image"),
            "label": payload.label or reference.get("original_filename"),
            "metadata_json": {
                "mime_type": reference.get("mime_type"),
                "width": reference.get("width"),
                "height": reference.get("height"),
                "duration_seconds": reference.get("duration_seconds"),
            },
        }
    )
    return AssistantAttachment(**attachment)


@router.delete("/sessions/{session_id}/attachments/{attachment_id}")
def delete_attachment(session_id: str, attachment_id: str) -> dict[str, bool]:
    if not store_assistant.get_assistant_session(session_id):
        raise _not_found("assistant session")
    store_assistant.delete_assistant_attachment(session_id, attachment_id)
    return {"ok": True}


@router.post("/sessions/{session_id}/plans", response_model=AssistantPlanResponse)
def create_plan(
    session_id: str,
    payload: AssistantPlanCreateRequest,
) -> AssistantPlanResponse:
    session = store_assistant.get_assistant_session(session_id)
    if not session:
        raise _not_found("assistant session")
    message = str(payload.message or "").strip()
    if not message:
        raise _bad_request("Describe the graph change first.")
    updated = create_kernel_message(
        session=session,
        payload=AssistantMessageCreateRequest(
            content_text=message,
            workflow=payload.workflow,
            canvas_context=payload.canvas_context,
            run_id=payload.run_id,
            assistant_mode=payload.assistant_mode,
            metadata={"source": "plan_endpoint"},
        ),
        attachments=store_assistant.list_assistant_attachments(session_id),
    )
    latest_plan = _latest_relevant_session_plan(updated)
    if not latest_plan:
        raise _bad_request("The assistant did not produce a confirmable graph proposal.")
    return AssistantPlanResponse.model_validate(latest_plan)


@router.post(
    "/sessions/{session_id}/recipe-drafts",
    response_model=AssistantPromptRecipeDraftResponse,
)
def create_recipe_draft(
    session_id: str,
    payload: AssistantDraftCreateRequest,
) -> AssistantPromptRecipeDraftResponse:
    draft, _ = _kernel_draft(session_id=session_id, payload=payload, mode="recipe")
    return AssistantPromptRecipeDraftResponse(
        draft=draft,
        validation_warnings=list(draft.get("validation_warnings_json") or []),
        review_url=f"/presets/prompt-recipes/new?assistantSession={session_id}",
    )


@router.post("/sessions/{session_id}/run-confirmations")
def confirm_kernel_run(
    session_id: str,
    payload: AssistantRunConfirmationRequest,
) -> dict[str, bool]:
    return confirm_kernel_run_action(session_id, payload)


@router.post(
    "/sessions/{session_id}/preset-drafts",
    response_model=AssistantMediaPresetDraftResponse,
)
def create_preset_draft(
    session_id: str,
    payload: AssistantDraftCreateRequest,
) -> AssistantMediaPresetDraftResponse:
    draft, _ = _kernel_draft(session_id=session_id, payload=payload, mode="preset")
    return AssistantMediaPresetDraftResponse(
        draft=draft,
        review_url=f"/presets/new?assistantSession={session_id}",
    )


@router.post(
    "/sessions/{session_id}/preset-saves",
    response_model=AssistantArtifactSaveResponse,
)
def save_preset(
    session_id: str,
    payload: AssistantMediaPresetSaveRequest,
) -> AssistantArtifactSaveResponse:
    if not store_assistant.get_assistant_session(session_id):
        raise _not_found("assistant session")
    try:
        confirmed = resolve_confirmed_preset_draft(
            session_id=session_id,
            proposal_id=payload.proposal_id,
            confirmation_token=payload.confirmation_token,
        )
    except PresetConfirmationError as exc:
        raise _bad_request(str(exc))
    if not confirmed:
        raise _bad_request("Saving a Media Preset requires current assistant confirmation.")
    draft, proposal = confirmed
    existing = store.get_preset_by_key(draft.key)
    try:
        record = upsert_preset(
            draft,
            preset_id=str(existing.get("preset_id") or "") if existing else None,
        )
    except ServiceError as exc:
        raise _bad_request(str(exc))
    _record_saved_artifact(
        session_id=session_id,
        kind="media_preset",
        capability="save_media_preset",
        record=record,
        created=existing is None,
    )
    updated = consume_preset_confirmation(session_id, str(proposal["proposal_id"]))
    registry.invalidate()
    return AssistantArtifactSaveResponse(
        capability="save_media_preset",
        artifact_kind="media_preset",
        created=existing is None,
        record=record,
        message="Media Preset saved.",
        assistant_session=_shape_session(updated),
    )


@router.post(
    "/sessions/{session_id}/recipe-saves",
    response_model=AssistantArtifactSaveResponse,
)
def save_recipe(
    session_id: str,
    payload: AssistantPromptRecipeSaveRequest,
) -> AssistantArtifactSaveResponse:
    if not store_assistant.get_assistant_session(session_id):
        raise _not_found("assistant session")
    try:
        confirmed = resolve_confirmed_recipe_draft(
            session_id=session_id,
            proposal_id=payload.proposal_id,
            confirmation_token=payload.confirmation_token,
        )
    except RecipeConfirmationError as exc:
        raise _bad_request(str(exc))
    if not confirmed:
        raise _bad_request("Saving a Prompt Recipe requires current assistant confirmation.")
    draft, proposal = confirmed
    existing_recipe_id = str(proposal.get("existing_recipe_id") or "")
    existing = (
        store.get_prompt_recipe(existing_recipe_id)
        if existing_recipe_id
        else store.get_prompt_recipe_by_key(draft.key)
    )
    try:
        record = upsert_prompt_recipe(
            draft,
            recipe_id=str(existing.get("recipe_id") or "") if existing else None,
        )
    except ServiceError as exc:
        raise _bad_request(str(exc))
    _record_saved_artifact(
        session_id=session_id,
        kind="prompt_recipe",
        capability="save_prompt_recipe",
        record=record,
        created=existing is None,
    )
    updated = consume_recipe_confirmation(session_id, str(proposal["proposal_id"]))
    registry.invalidate()
    return AssistantArtifactSaveResponse(
        capability="save_prompt_recipe",
        artifact_kind="prompt_recipe",
        created=existing is None,
        record=record,
        message="Prompt Recipe saved.",
        assistant_session=_shape_session(updated),
    )


@router.post("/plans/{plan_id}/apply", response_model=AssistantPlanApplyResponse)
def apply_plan(
    plan_id: str,
    payload: AssistantPlanApplyRequest,
) -> AssistantPlanApplyResponse:
    plan = store_assistant.get_assistant_plan(plan_id)
    if not plan:
        raise _not_found("assistant plan")
    graph_plan = AssistantGraphPlan(**(plan.get("plan_json") or {}))
    if (
        str(plan.get("status") or "") != "validated"
        or not graph_plan.metadata.get("kernel_proposal")
    ):
        raise _bad_request("Only the current validated assistant proposal can be applied.")
    base_workflow = materialize_workflow_defaults(payload.workflow)
    if payload.proposal_id != plan_id:
        raise _bad_request("This graph confirmation does not match the current proposal.")
    expected_token_hash = str(graph_plan.metadata.get("confirmation_token_hash") or "")
    supplied_token_hash = hashlib.sha256(
        str(payload.confirmation_token or "").encode("utf-8")
    ).hexdigest()
    if not expected_token_hash or not hmac.compare_digest(
        expected_token_hash,
        supplied_token_hash,
    ):
        raise _bad_request("This graph confirmation token is invalid or stale.")
    expected_fingerprint = str(
        graph_plan.metadata.get("base_workflow_fingerprint") or ""
    )
    if not expected_fingerprint or not hmac.compare_digest(
        expected_fingerprint,
        workflow_fingerprint(base_workflow),
    ):
        raise _bad_request(
            "The canvas changed after this graph proposal was created. Ask for a fresh proposal."
        )
    try:
        workflow = (
            apply_graph_plan(base_workflow, graph_plan)
            if graph_plan.operations
            else base_workflow
        )
    except ValueError as exc:
        raise _bad_request(str(exc))
    validation = validate_workflow(workflow)
    layout_errors = graph_plan_layout_errors(base_workflow, workflow, graph_plan)
    if layout_errors:
        raise _bad_request(layout_errors[0].message)
    graph_plan.metadata["diff_summary"] = graph_plan_diff_summary(
        base_workflow,
        workflow,
        graph_plan,
        validation=validation,
        layout_errors=layout_errors,
    )
    if not validation.valid and not _allows_pending_media(validation):
        raise _bad_request("Assistant plan no longer validates.")
    pricing = estimate_graph_workflow(workflow)
    updated = store_assistant.create_or_update_assistant_plan(
        {
            **plan,
            "status": "applied",
            "plan_json": graph_plan.model_dump(mode="json"),
            "validation_json": validation.model_dump(mode="json"),
            "pricing_json": pricing.model_dump(mode="json"),
            "workflow_json": workflow.model_dump(mode="json"),
            "applied_workflow_id": workflow.workflow_id,
        }
    )
    session = store_assistant.get_assistant_session(
        str(plan["assistant_session_id"])
    )
    if session:
        store_assistant.create_assistant_message(
            {
                "assistant_session_id": session["assistant_session_id"],
                "role": "system_summary",
                "content_text": "Applied the confirmed graph proposal without running it.",
                "content_json": {
                    "plan_id": plan_id,
                    "activity_kind": "graph_plan_applied",
                    "action_status": "applied",
                    "applied_workflow_id": workflow.workflow_id,
                },
            }
        )
        store_assistant.create_or_update_assistant_session(
            {**session, "status": "active"}
        )
    return AssistantPlanApplyResponse(
        plan=AssistantPlan(**updated),
        workflow=workflow,
        validation=validation,
        pricing=pricing,
    )


@router.post("/sessions/{session_id}/cancel", response_model=AssistantSession)
def cancel_session(session_id: str) -> AssistantSession:
    record = store_assistant.get_assistant_session(session_id)
    if not record:
        raise _not_found("assistant session")
    return _shape_session(cancel_assistant_session(record))


@router.post("/sessions/{session_id}/archive", response_model=AssistantSession)
def archive_session(session_id: str) -> AssistantSession:
    record = store_assistant.get_assistant_session(session_id)
    if not record:
        raise _not_found("assistant session")
    try:
        return _shape_session(archive_assistant_session(record))
    except AssistantSessionBusy as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
