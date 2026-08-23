from __future__ import annotations

from typing import Any, Callable

from fastapi import APIRouter, HTTPException

from .. import store, store_assistant
from ..graph.registry import registry
from ..service_errors import ServiceError
from ..service_preset_validation import upsert_preset
from ..service_prompt_recipe_validation import upsert_prompt_recipe
from .kernel_route import create_kernel_message
from .preset_confirmation import (
    PresetConfirmationError,
    consume_preset_confirmation,
    resolve_confirmed_preset_draft,
)
from .recipe_confirmation import (
    RecipeConfirmationError,
    consume_recipe_confirmation,
    resolve_confirmed_recipe_draft,
)
from .run_confirmation import confirm_kernel_run_action
from .schemas import (
    AssistantArtifactSaveResponse,
    AssistantDraftCreateRequest,
    AssistantMediaPresetDraftResponse,
    AssistantMediaPresetSaveRequest,
    AssistantMessageCreateRequest,
    AssistantPromptRecipeDraftResponse,
    AssistantPromptRecipeSaveRequest,
    AssistantRunConfirmationRequest,
    AssistantSession,
)

SessionShaper = Callable[[dict[str, Any]], AssistantSession]


def _not_found(name: str) -> HTTPException:
    return HTTPException(status_code=404, detail=f"{name} not found")


def _bad_request(message: str) -> HTTPException:
    return HTTPException(status_code=400, detail=message)


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
    artifact_id = str(record.get("preset_id" if is_preset else "recipe_id") or "")
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


def create_confirmation_router(
    *,
    shape_session: SessionShaper,
) -> APIRouter:
    router = APIRouter()

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
            assistant_session=shape_session(updated),
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
            assistant_session=shape_session(updated),
        )

    return router
