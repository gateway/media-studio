from __future__ import annotations

import hashlib
from typing import Any, Dict, Optional, Tuple

from .. import store_assistant
from ..schemas import PromptRecipeUpsertRequest


class RecipeConfirmationError(ValueError):
    pass


def resolve_confirmed_recipe_draft(
    *,
    session_id: str,
    proposal_id: Optional[str],
    confirmation_token: Optional[str],
) -> Optional[Tuple[PromptRecipeUpsertRequest, Dict[str, Any]]]:
    if not proposal_id and not confirmation_token:
        return None
    if not proposal_id or not confirmation_token:
        raise RecipeConfirmationError("Prompt Recipe confirmation requires both proposal identity and token.")
    session = store_assistant.get_assistant_session(session_id) or {}
    summary = session.get("summary_json") if isinstance(session.get("summary_json"), dict) else {}
    proposal = summary.get("kernel_recipe_proposal") if isinstance(summary.get("kernel_recipe_proposal"), dict) else {}
    if str(proposal.get("proposal_id") or "") != proposal_id:
        raise RecipeConfirmationError("Prompt Recipe confirmation is stale or belongs to another proposal.")
    if proposal.get("consumed"):
        raise RecipeConfirmationError("Prompt Recipe confirmation was already used.")
    supplied_hash = hashlib.sha256(confirmation_token.encode("utf-8")).hexdigest()
    if supplied_hash != str(proposal.get("confirmation_token_hash") or ""):
        raise RecipeConfirmationError("Prompt Recipe confirmation token is invalid.")
    if not proposal.get("save_ready"):
        raise RecipeConfirmationError("The Prompt Recipe draft is not ready to save.")
    return PromptRecipeUpsertRequest.model_validate(proposal.get("draft")), proposal


def consume_recipe_confirmation(session_id: str, proposal_id: str) -> Dict[str, Any]:
    session = store_assistant.get_assistant_session(session_id) or {}
    summary = dict(session.get("summary_json") or {})
    proposal = dict(summary.get("kernel_recipe_proposal") or {})
    if str(proposal.get("proposal_id") or "") == proposal_id:
        proposal["consumed"] = True
        proposal["confirmation_token_hash"] = None
        summary["kernel_recipe_proposal"] = proposal
    return store_assistant.create_or_update_assistant_session({**session, "summary_json": summary})


def finalize_recipe_confirmation(
    session: Dict[str, Any],
    proposal_id: Optional[str],
    confirmed: Optional[Tuple[PromptRecipeUpsertRequest, Dict[str, Any]]],
) -> Dict[str, Any]:
    if confirmed:
        return consume_recipe_confirmation(str(session["assistant_session_id"]), str(proposal_id or ""))
    return store_assistant.create_or_update_assistant_session({**session, "status": "active"})
