from __future__ import annotations

import re
from typing import Any

from ..graph.pricing import estimate_graph_workflow
from ..graph.schemas import GraphWorkflow


def test_run_request(text: str) -> bool:
    normalized = " ".join(text.lower().strip().split())
    if run_request_is_negated(normalized):
        return False
    explicit = {
        "test it",
        "test again",
        "run it",
        "ok run it",
        "okay run it",
        "yes run it",
        "run again",
        "try it",
        "try again",
        "rerun it",
        "rerun this",
        "test this",
        "run this",
        "try this",
        "execute it",
        "execute this",
        "generate it",
        "generate again",
        "generate this",
        "start it",
        "start this",
        "run the workflow",
        "run the graph",
        "run current workflow",
        "run current graph",
        "run the current workflow",
        "run the current graph",
        "rerun the workflow",
        "execute the workflow",
        "execute the graph",
    }
    return (
        normalized in explicit
        or normalized.startswith("test it ")
        or normalized.startswith("run this ")
        or normalized.startswith("run it ")
        or normalized.startswith("ok run it ")
        or normalized.startswith("okay run it ")
        or normalized.startswith("yes run it ")
        or normalized.startswith("run again ")
        or normalized.startswith("execute this ")
        or normalized.startswith("rerun ")
        or bool(re.search(r"\b(?:run|execute)\b.{0,40}\b(?:current\s+)?(?:graph|workflow)\b", normalized))
    )


def run_request_is_negated(text: str) -> bool:
    normalized = " ".join(text.lower().strip().split())
    if not normalized:
        return False
    return bool(
        re.search(r"\b(?:do not|don't|dont|no|without)\b.{0,80}\b(?:run|running|test|testing|execute|executing|submit|submitting|generate|generating)\b", normalized)
        or re.search(r"\b(?:run|test|execute|submit|generate)\b.{0,40}\b(?:not|later|after|yet)\b", normalized)
    )


def explicit_paid_provider_run_permission(text: str) -> bool:
    normalized = " ".join(text.lower().strip().split())
    if not normalized or not test_run_request(normalized):
        return False
    has_approval = bool(re.search(r"\b(?:approve|approved|approval|permission|authorized|authorised)\b", normalized))
    has_paid_or_provider = bool(re.search(r"\b(?:paid|provider|spend|credits?|cost|charge|billing|bill|live|real)\b", normalized))
    return has_approval and has_paid_or_provider


def latest_assistant_requested_run_confirmation(messages: list[dict[str, Any]]) -> bool:
    for message in reversed(messages):
        role = str(message.get("role") or "")
        if role == "assistant":
            content_json = message.get("content_json") if isinstance(message.get("content_json"), dict) else {}
            return str(content_json.get("confirmation_action") or "") == "run_workflow"
        if role == "user":
            return False
    return False


def graph_run_estimate_label(workflow: GraphWorkflow) -> str:
    try:
        estimate = estimate_graph_workflow(workflow)
    except Exception:
        return "estimate unavailable"
    total = estimate.pricing_summary.get("total") if isinstance(estimate.pricing_summary, dict) else {}
    credits = total.get("estimated_credits") if isinstance(total, dict) else None
    usd = total.get("estimated_cost_usd") if isinstance(total, dict) else None
    parts: list[str] = []
    if isinstance(credits, (int, float)):
        parts.append(f"~{credits:g} credits")
    if isinstance(usd, (int, float)):
        parts.append(f"${usd:.2f}")
    if parts:
        return " / ".join(parts)
    if estimate.pricing_summary.get("has_unknown_pricing"):
        return "unknown pricing"
    return "no numeric estimate"


def deterministic_run_request_reply(
    text: str,
    workflow: GraphWorkflow | None,
    message_history: list[dict[str, Any]],
) -> tuple[str, dict[str, Any]] | None:
    if not workflow or not test_run_request(text):
        return None
    approval_source = ""
    if explicit_paid_provider_run_permission(text):
        approval_source = "explicit_paid_provider_permission"
    elif latest_assistant_requested_run_confirmation(message_history):
        approval_source = "prior_assistant_confirmation"
    if approval_source:
        return (
            "I will run the current graph now.",
            {
                "mode": "deterministic_test_run_request",
                "suggested_action": "run_workflow",
                "requires_confirmation": True,
                "run_approval_source": approval_source,
                "estimated_cost_label": graph_run_estimate_label(workflow),
            },
        )
    estimate_label = graph_run_estimate_label(workflow)
    return (
        "I can run the current graph, but I need explicit paid/provider approval first.\n\n"
        f"Current estimate: {estimate_label}.\n\n"
        "Reply `run it, approved paid provider run` when you want me to start.",
        {
            "mode": "deterministic_test_run_confirmation_required",
            "suggested_action": "clarify",
            "confirmation_action": "run_workflow",
            "requires_confirmation": True,
            "estimated_cost_label": estimate_label,
        },
    )
