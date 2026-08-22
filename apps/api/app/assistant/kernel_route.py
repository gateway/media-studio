from __future__ import annotations

import hashlib
from typing import Any, Dict, List

from fastapi import HTTPException

from .. import store, store_assistant
from .cancellation import AssistantRequestCancelled, AssistantSessionBusy, track_session
from .kernel import run_assistant_kernel_turn
from .provider_support import AssistantProviderChatError, sync_assistant_session_provider
from .run_confirmation import (
    RunEvidenceError,
    applied_recipe_plan_id,
    applied_preset_test_plan_id,
    assistant_run_confirmation_kind,
    bind_completed_assistant_run,
)
from .schemas import AssistantMessageCreateRequest, AssistantNextAction
from .turn_trace import build_assistant_turn_trace
from .voice import lint_assistant_reply


def _bind_selected_completed_assistant_run(
    session: Dict[str, Any],
    payload: AssistantMessageCreateRequest,
) -> Dict[str, Any]:
    run_id = str(payload.run_id or "").strip()
    summary = session.get("summary_json") if isinstance(session.get("summary_json"), dict) else {}
    confirmation = summary.get("kernel_run_confirmation")
    if (
        not run_id
        or not isinstance(confirmation, dict)
        or confirmation.get("consumed") is not True
        or str(confirmation.get("assistant_run_id") or "") != run_id
    ):
        return session
    run = store.get_graph_run(run_id)
    if not run or str(run.get("status") or "") != "completed":
        return session
    try:
        bind_completed_assistant_run(str(session["assistant_session_id"]), run)
    except RunEvidenceError:
        return session
    return store_assistant.get_assistant_session(str(session["assistant_session_id"])) or session


def create_kernel_message(
    *,
    session: Dict[str, Any],
    payload: AssistantMessageCreateRequest,
    attachments: List[Dict[str, Any]],
) -> Dict[str, Any]:
    session_id = str(session["assistant_session_id"])
    text = payload.content_text.strip()
    try:
        with track_session(session_id) as cancel_event:
            session = sync_assistant_session_provider(session)
            session = _bind_selected_completed_assistant_run(session, payload)
            user_message = store_assistant.create_assistant_message(
                {
                    "assistant_session_id": session_id,
                    "role": "user",
                    "content_text": text,
                    "content_json": {
                        "attachment_ids": payload.attachment_ids,
                        "assistant_mode": payload.assistant_mode,
                        "metadata": payload.metadata,
                        "kernel_enabled": True,
                    },
                }
            )
            result = run_assistant_kernel_turn(
                session=session,
                user_text=text,
                workflow=payload.workflow,
                canvas_context=payload.canvas_context,
                assistant_mode=payload.assistant_mode,
                run_id=payload.run_id,
                attachments=attachments,
                cancel_event=cancel_event,
                client_user_message_id=str(user_message.get("assistant_message_id") or "") or None,
            )
    except AssistantSessionBusy as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except AssistantRequestCancelled as exc:
        store_assistant.create_assistant_message(
            {
                "assistant_session_id": session_id,
                "role": "system_summary",
                "content_text": "Assistant turn interrupted.",
                "content_json": {
                    "activity_kind": "assistant_turn_interrupted",
                    "assistant_turn_trace": {
                        "cancellation_status": exc.outcome,
                        "provider_lifecycle": [f"turn_{exc.outcome}"],
                    },
                },
            }
        )
        current = store_assistant.get_assistant_session(session_id) or session
        snapshot = (
            dict(current.get("state_snapshot_json"))
            if isinstance(current.get("state_snapshot_json"), dict)
            else {}
        )
        store_assistant.create_or_update_assistant_session(
            {
                **current,
                "status": "active",
                "state_snapshot_json": {
                    **snapshot,
                    "provider_cancellation_status": exc.outcome,
                },
            }
        )
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except AssistantProviderChatError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    result.trace.voice_violations = lint_assistant_reply(result.reply)
    refreshed_session = store_assistant.get_assistant_session(session_id) or session
    summary = (
        refreshed_session.get("summary_json")
        if isinstance(refreshed_session.get("summary_json"), dict)
        else {}
    )
    existing_confirmation = summary.get("kernel_run_confirmation")
    run_confirmation = (
        existing_confirmation
        if isinstance(existing_confirmation, dict) and existing_confirmation.get("consumed") is True
        else None
    )
    if result.next_action.kind == "run_workflow" and result.next_action.confirmation_token:
        fingerprint = str((result.next_action.payload or {}).get("workflow_fingerprint") or "")
        test_plan_id = (
            applied_preset_test_plan_id(session_id, payload.workflow)
            if payload.workflow is not None
            else None
        )
        confirmation_kind = assistant_run_confirmation_kind(
            {"test_plan_id": test_plan_id},
            capability=result.capability,
            workflow=payload.workflow,
        )
        recipe_plan_id = (
            applied_recipe_plan_id(
                session_id,
                payload.workflow,
                summary.get("kernel_proposal_id"),
            )
            if confirmation_kind == "recipe" and payload.workflow is not None
            else None
        )
        if confirmation_kind == "recipe" and not recipe_plan_id:
            result.next_action = AssistantNextAction()
        else:
            run_confirmation = {
                "confirmation_token_hash": hashlib.sha256(
                    result.next_action.confirmation_token.encode("utf-8")
                ).hexdigest(),
                "workflow_fingerprint": fingerprint,
                "test_plan_id": test_plan_id,
                "recipe_plan_id": recipe_plan_id,
                "confirmation_kind": confirmation_kind,
                "consumed": False,
            }
    turn_payload = result.model_dump(mode="json", exclude_none=True)
    content_json = {
        "mode": "assistant_kernel",
        "capability": result.capability,
        "assistant_response_kind": "answer",
        "next_action": result.next_action.model_dump(mode="json", exclude_none=True),
        "loaded_prompt_assets": result.trace.loaded_prompt_assets,
        "kernel_turn": turn_payload,
    }
    content_json["assistant_turn_trace"] = build_assistant_turn_trace(content_json, result.reply)
    store_assistant.create_assistant_message(
        {
            "assistant_session_id": session_id,
            "role": "assistant",
            "content_text": result.reply,
            "content_json": content_json,
        }
    )
    return store_assistant.create_or_update_assistant_session(
        {
            **refreshed_session,
            "status": "active",
            "summary_json": {
                **summary,
                "kernel_capability": result.capability,
                "kernel_proposal_id": result.next_action.proposal_id
                or summary.get("kernel_proposal_id"),
                "kernel_run_confirmation": run_confirmation,
            },
        }
    )
