"""Durable graph-planning checkpoints; resuming never authorizes a run."""
from __future__ import annotations

import secrets
import time
from typing import Any

from fastapi import HTTPException

from .. import store_assistant
from .cancellation import is_cancelled
from .provenance import workflow_fingerprint


def _persist(session: dict[str, Any], recovery: dict[str, Any]) -> dict[str, Any]:
    current = store_assistant.get_assistant_session(session["assistant_session_id"]) or session
    stored = store_assistant.create_or_update_assistant_session({
        **current, "summary_json": {**(current.get("summary_json") or {}), "kernel_planning_recovery": recovery},
    })
    session.update(stored)
    return stored


def record_planning_recovery(*, session, workflow, canvas_context, request, attachments, traces, messages, reason, prior=None):
    if workflow is None or not canvas_context.get("workspace_key"):
        return None
    prior = prior or {}
    recovery = {
        "id": secrets.token_urlsafe(24), "state": "offered", "expires_at": time.time() + 86400,
        "request": request, "workflow_name": workflow.name,
        "workflow_fingerprint": workflow_fingerprint(workflow),
        "workspace_key": canvas_context["workspace_key"],
        "attachment_ids": [item["assistant_attachment_id"] for item in attachments if item.get("assistant_attachment_id")],
        "reason": reason,
        "completed": list(dict.fromkeys([*(prior.get("completed") or []), *[trace.activity.label if trace.activity else trace.tool_name for trace in traces if trace.error is None]])),
        "errors": [trace.error.model_dump(mode="json") for trace in traces if trace.error],
        "messages": messages,
        "tool_evidence": [*(prior.get("tool_evidence") or []), *[trace.evidence for trace in traces if trace.evidence]][-12:],
        "remaining": "Finish the graph proposal and validate its inputs and estimate. Review before applying or running.",
    }
    _persist(session, recovery)
    return recovery


def continue_planning(session, payload, attachments, invoke, cancel_event):
    """Called under the existing session lock; reject replay and changed destinations."""
    current = store_assistant.get_assistant_session(session["assistant_session_id"]) or session
    recovery = dict((current.get("summary_json") or {}).get("kernel_planning_recovery") or {})
    if recovery.get("id") != payload.metadata.get("planning_recovery_id") or recovery.get("state") != "offered":
        raise HTTPException(409, "This planning action is stale or already consumed.")
    if time.time() >= recovery["expires_at"]:
        _persist(current, {**recovery, "state": "expired"})
        raise HTTPException(409, "This planning checkpoint expired. Start a fresh graph request.")
    if (not payload.workflow or workflow_fingerprint(payload.workflow) != recovery["workflow_fingerprint"]
            or payload.canvas_context.get("workspace_key") != recovery["workspace_key"]
            or [item["assistant_attachment_id"] for item in attachments if item.get("assistant_attachment_id")] != recovery["attachment_ids"]):
        _persist(current, {**recovery, "state": "stale"})
        raise HTTPException(409, "The graph or references changed. Start a fresh request using the current inputs.")
    prior_plan_id = (current.get("summary_json") or {}).get("kernel_proposal_id")
    current = _persist(current, {**recovery, "state": "resuming"})
    request = payload.model_copy(update={
        "content_text": f"Continue preparing this graph proposal: {recovery['request']}\nReuse completed checks in the checkpoint. Resolve remaining errors. Do not apply, save, run, or retry generation.",
        "assistant_mode": "graph", "run_id": None, "metadata": {},
    })
    try:
        updated = invoke(current, request, recovery)
    except Exception:
        _persist(current, {**recovery, "id": secrets.token_urlsafe(24), "state": "cancelled" if is_cancelled(cancel_event) else "offered"})
        raise
    latest = (updated.get("summary_json") or {}).get("kernel_planning_recovery") or {}
    if latest.get("id") == recovery["id"]:
        plan_id = (updated.get("summary_json") or {}).get("kernel_proposal_id")
        plan = store_assistant.get_assistant_plan(plan_id) if plan_id and plan_id != prior_plan_id else None
        complete = bool(plan and plan.get("assistant_session_id") == current["assistant_session_id"] and plan.get("status") == "validated")
        updated = _persist(updated, {**recovery, "id": secrets.token_urlsafe(24), "state": "completed" if complete else "offered"})
    return updated
