from __future__ import annotations

import hashlib
from typing import Any, Dict, Optional, Tuple

from .. import store_assistant
from ..schemas import PresetUpsertRequest


class PresetConfirmationError(ValueError):
    pass


def resolve_confirmed_preset_draft(
    *,
    session_id: str,
    proposal_id: Optional[str],
    confirmation_token: Optional[str],
) -> Optional[Tuple[PresetUpsertRequest, Dict[str, Any]]]:
    if not proposal_id and not confirmation_token:
        return None
    if not proposal_id or not confirmation_token:
        raise PresetConfirmationError("Preset confirmation requires both proposal identity and token.")
    session = store_assistant.get_assistant_session(session_id) or {}
    summary = session.get("summary_json") if isinstance(session.get("summary_json"), dict) else {}
    proposal = summary.get("kernel_preset_proposal") if isinstance(summary.get("kernel_preset_proposal"), dict) else {}
    if str(proposal.get("proposal_id") or "") != proposal_id:
        raise PresetConfirmationError("Preset confirmation is stale or belongs to another proposal.")
    if proposal.get("consumed"):
        raise PresetConfirmationError("Preset confirmation was already used.")
    supplied_hash = hashlib.sha256(confirmation_token.encode("utf-8")).hexdigest()
    if supplied_hash != str(proposal.get("confirmation_token_hash") or ""):
        raise PresetConfirmationError("Preset confirmation token is invalid.")
    plan = store_assistant.get_assistant_plan(str(proposal.get("test_plan_id") or "")) or {}
    if str(plan.get("assistant_session_id") or "") != session_id or plan.get("status") != "applied":
        raise PresetConfirmationError("The linked test graph is no longer approved.")
    return PresetUpsertRequest.model_validate(proposal.get("draft")), proposal


def consume_preset_confirmation(session_id: str, proposal_id: str) -> Dict[str, Any]:
    session = store_assistant.get_assistant_session(session_id) or {}
    summary = dict(session.get("summary_json") or {})
    proposal = dict(summary.get("kernel_preset_proposal") or {})
    if str(proposal.get("proposal_id") or "") == proposal_id:
        proposal["consumed"] = True
        proposal["confirmation_token_hash"] = None
        summary["kernel_preset_proposal"] = proposal
    return store_assistant.create_or_update_assistant_session({**session, "summary_json": summary})
