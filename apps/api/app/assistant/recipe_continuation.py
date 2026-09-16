"""Explicit, session-owned recipe drafting and return-to-graph handoff."""
from __future__ import annotations

import hmac
import secrets
import time
from typing import Any

from pydantic import BaseModel, Field

from fastapi import HTTPException

from .. import store, store_assistant
from .cancellation import is_cancelled
from .provenance import recipe_quality_contract_hash, workflow_fingerprint
from .recipe_kernel import RecipeKernelError


class OfferRecipeContinuationArguments(BaseModel):
    missing_requirements: str = Field(min_length=1, max_length=1200)


def offer_recipe_continuation(arguments: BaseModel, context: Any) -> dict[str, Any]:
    options = OfferRecipeContinuationArguments.model_validate(arguments)
    searches = [entry["recipe_search"] for entry in context.tool_evidence if "recipe_search" in entry]
    workspace = str(context.canvas_context.get("workspace_key") or "")
    if not context.workflow or not context.session_id or not context.user_message_id or not workspace or not searches:
        raise RecipeKernelError(code="recipe_origin_required", message="Inspect saved recipes and use the current graph request and destination before offering a recipe draft.")
    session = store_assistant.get_assistant_session(context.session_id) or context.session
    summary = dict(session.get("summary_json") or {})
    existing = summary.get("kernel_recipe_continuation") or {}
    if existing.get("origin_message_id") == context.user_message_id:
        return existing
    continuation = {
        "id": secrets.token_urlsafe(18), "token": secrets.token_urlsafe(24),
        "state": "offered", "expires_at": time.time() + 86400,
        "origin_message_id": context.user_message_id,
        "request": context.user_text, "missing_requirements": options.missing_requirements,
        "workspace_key": workspace, "workflow_name": context.workflow.name,
        "workflow_fingerprint": workflow_fingerprint(context.workflow),
        "catalog_searches": searches,
    }
    summary["kernel_recipe_continuation"] = continuation
    store_assistant.create_or_update_assistant_session({**session, "summary_json": summary})
    return continuation


def _persist(session: dict[str, Any], continuation: dict[str, Any]) -> dict[str, Any]:
    return store_assistant.create_or_update_assistant_session({
        **session, "summary_json": {**(session.get("summary_json") or {}), "kernel_recipe_continuation": continuation},
    })


def run_recipe_continuation(session: dict[str, Any], payload: Any, invoke: Any, cancel_event: Any) -> dict[str, Any]:
    """Run under the existing session lock; a consumed action never dispatches again."""
    action = payload.continuation
    current = store_assistant.get_assistant_session(session["assistant_session_id"]) or session
    continuation = dict((current.get("summary_json") or {}).get("kernel_recipe_continuation") or {})
    consumed = [entry if ":" in entry else f"{entry}:{continuation.get('token', '')}"
                for entry in continuation.get("consumed_actions", [])]
    marker = f"{action.action}:{action.token}"
    if continuation.get("id") != action.id:
        raise HTTPException(409, "This recipe continuation belongs to another session.")
    if marker in consumed:
        return current
    if not hmac.compare_digest(str(continuation.get("token") or "").encode("utf-8"), action.token.encode("utf-8")):
        raise HTTPException(409, "This recipe continuation action is stale.")
    if action.action == "cancel":
        return _persist(current, {**continuation, "state": "cancelled", "consumed_actions": [*consumed, marker]})
    phase = ("return" if continuation.get("recipe_id") else "draft") if action.action == "retry" else action.action
    if time.time() >= continuation["expires_at"]:
        _persist(current, {**continuation, "state": "expired"})
        raise HTTPException(409, "This recipe continuation expired. Start a fresh graph request.")
    if payload.canvas_context.get("workspace_key") != continuation["workspace_key"] or not payload.workflow or workflow_fingerprint(payload.workflow) != continuation["workflow_fingerprint"]:
        _persist(current, {**continuation, "state": "stale"})
        raise HTTPException(409, "The original graph destination changed. Start a fresh request on the graph you want to use.")
    expected = "interrupted" if action.action == "retry" else "offered" if phase == "draft" else "ready"
    if continuation["state"] != expected:
        raise HTTPException(409, "Review and explicitly save the recipe before returning, or start a fresh graph request.")
    original = continuation["request"]
    requirements = continuation["missing_requirements"]
    if phase == "return":
        recipe = store.get_prompt_recipe(continuation["recipe_id"])
        if not recipe or recipe.get("status") != "active" or recipe_quality_contract_hash(recipe) != continuation["recipe_hash"]:
            _persist(current, {**continuation, "state": "stale"})
            raise HTTPException(409, "The saved recipe changed or is unavailable. Review it in a fresh graph request.")
        text = f"Return to the original graph proposal using saved recipe {recipe['recipe_id']} ({recipe['label']}). Inspect that exact recipe and verify it meets these requirements before proposing: {requirements}. Original request: {original}. The current action authorizes preparing the graph proposal now. Reuse recipe and catalog evidence already inspected in this conversation; look up only unresolved parts. Do not apply or run."
    else:
        text = f"Draft the needed Prompt Recipe for this original graph request: {original}. Missing requirements: {requirements}. Draft for review only. Do not save, apply, or run."
    prior_graph_id = (current.get("summary_json") or {}).get("kernel_proposal_id")
    prior_proposal = (current.get("summary_json") or {}).get("kernel_recipe_proposal") or {}
    continuation.update(state="drafting" if phase == "draft" else "returning", consumed_actions=[*consumed, marker], token=secrets.token_urlsafe(24))
    current = _persist(current, continuation)
    request = payload.model_copy(update={"content_text": text, "assistant_mode": "recipe" if phase == "draft" else "graph", "continuation": None, "run_id": None})
    try:
        updated = invoke(current, request)
    except Exception:
        latest = store_assistant.get_assistant_session(current["assistant_session_id"]) or current
        _persist(latest, {**continuation, "state": "cancelled" if is_cancelled(cancel_event) else "interrupted"})
        raise
    if is_cancelled(cancel_event):
        return _persist(updated, {**continuation, "state": "cancelled"})
    summary = updated.get("summary_json") or {}
    if phase == "draft":
        draft = summary.get("kernel_recipe_draft") or {}
        proposal = summary.get("kernel_recipe_proposal") or {}
        fresh = bool(draft and proposal.get("proposal_id") and proposal.get("proposal_id") != prior_proposal.get("proposal_id"))
        continuation.update(state="awaiting_save" if fresh else "interrupted")
        if fresh:
            continuation.update(draft_key=draft["key"], draft_hash=recipe_quality_contract_hash(draft))
    else:
        plan_id = summary.get("kernel_proposal_id")
        plan = store_assistant.get_assistant_plan(plan_id) if plan_id and plan_id != prior_graph_id else None
        fresh = bool(plan and plan.get("assistant_session_id") == current["assistant_session_id"] and plan.get("status") == "validated")
        continuation["state"] = "returned" if fresh else "interrupted"
    return _persist(updated, continuation)


def bind_saved_recipe(session_id: str, recipe: dict[str, Any]) -> None:
    """Only an explicit recipe-save route may make return available."""
    session = store_assistant.get_assistant_session(session_id) or {}
    summary = session.get("summary_json") or {}
    continuation = dict(summary.get("kernel_recipe_continuation") or {})
    if continuation.get("state") != "awaiting_save" or not continuation.get("draft_key") or continuation["draft_key"] != recipe.get("key"):
        return
    if recipe_quality_contract_hash(recipe) != continuation.get("draft_hash"):
        _persist(session, {**continuation, "state": "stale"})
        return
    _persist(session, {**continuation, "state": "ready", "recipe_id": recipe["recipe_id"], "recipe_label": recipe["label"], "recipe_hash": recipe_quality_contract_hash(recipe)})


def validate_recipe_return_graph(workflow: Any, session: dict[str, Any]) -> None:
    continuation = (session.get("summary_json") or {}).get("kernel_recipe_continuation") or {}
    if continuation.get("state") != "returning":
        return
    recipe_id = continuation["recipe_id"]
    recipe = store.get_prompt_recipe(recipe_id)
    if not recipe or recipe.get("status") != "active" or recipe_quality_contract_hash(recipe) != continuation["recipe_hash"]:
        raise RecipeKernelError(code="continuation_recipe_mismatch", message="The saved recipe changed during this return. Review it in a fresh graph request.")
    if not any(node.type == "prompt.recipe" and node.fields.get("recipe_id") == recipe_id for node in workflow.nodes):
        raise RecipeKernelError(code="continuation_recipe_mismatch", message="The return proposal must use the exact recipe saved for the original request. Inspect it before proposing; do not substitute another recipe.")
