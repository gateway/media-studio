from __future__ import annotations

import hashlib
import hmac
from typing import Any, Dict, Optional, Tuple

from .. import store_assistant
from ..graph.schemas import GraphWorkflow
from ..schemas import PresetUpsertRequest
from .provenance import preset_quality_contract_hash, preset_test_workflow_fingerprint


class PresetConfirmationError(ValueError):
    pass


def preset_quality_is_verified(
    summary: Dict[str, Any],
    *,
    session_id: str,
    test_plan_id: str,
) -> bool:
    evidence = summary.get("kernel_preset_run_evidence")
    comparison = summary.get("kernel_preset_output_comparison")
    quality = summary.get("kernel_preset_quality")
    if not all(isinstance(item, dict) for item in (evidence, comparison, quality)):
        return False
    run_id = str(evidence.get("run_id") or "")
    output_asset_id = str(comparison.get("output_asset_id") or "")
    comparison_id = str(comparison.get("comparison_id") or "")
    plan = store_assistant.get_assistant_plan(test_plan_id) or {}
    plan_workflow = plan.get("workflow_json")
    evidence_fingerprint = str(evidence.get("workflow_fingerprint") or "")
    try:
        plan_fingerprint = (
            preset_test_workflow_fingerprint(GraphWorkflow.model_validate(plan_workflow))
            if isinstance(plan_workflow, dict)
            else ""
        )
    except (TypeError, ValueError):
        return False
    return bool(
        str(evidence.get("assistant_session_id") or "") == session_id
        and str(evidence.get("test_plan_id") or "") == test_plan_id
        and str(plan.get("assistant_session_id") or "") == session_id
        and str(plan.get("status") or "") == "applied"
        and evidence_fingerprint
        and plan_fingerprint
        and hmac.compare_digest(evidence_fingerprint, plan_fingerprint)
        and evidence.get("status") == "completed"
        and run_id
        and output_asset_id in list(evidence.get("output_asset_ids") or [])
        and str(comparison.get("run_id") or "") == run_id
        and comparison_id
        and quality.get("quality_state") == "quality_verified"
        and quality.get("decision") == "approve"
        and quality.get("user_approved") is True
        and str(quality.get("comparison_id") or "") == comparison_id
        and str(quality.get("run_id") or "") == run_id
        and str(quality.get("output_asset_id") or "") == output_asset_id
    )


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
    save_mode = str(proposal.get("save_mode") or "")
    if save_mode not in {"verified", "unverified"}:
        raise PresetConfirmationError("Preset confirmation is missing its save verification mode.")
    quality_verified = bool(
        save_mode == "verified"
        and proposal.get("quality_state") == "quality_verified"
        and preset_quality_is_verified(
            summary,
            session_id=session_id,
            test_plan_id=str(proposal.get("test_plan_id") or ""),
        )
    )
    if save_mode == "verified" and not quality_verified:
        raise PresetConfirmationError("The preset's visual quality proof is missing or stale.")
    draft = PresetUpsertRequest.model_validate(proposal.get("draft"))
    plan_json = plan.get("plan_json") if isinstance(plan.get("plan_json"), dict) else {}
    metadata = plan_json.get("metadata") if isinstance(plan_json.get("metadata"), dict) else {}
    contract_hash = str(metadata.get("preset_quality_contract_hash") or "")
    expected_contract_hash = preset_quality_contract_hash(draft.model_dump(mode="json"))
    if (
        (contract_hash and not hmac.compare_digest(contract_hash, expected_contract_hash))
        or (save_mode == "unverified" and not contract_hash)
    ):
        raise PresetConfirmationError("The linked test graph no longer matches this preset draft.")
    return draft, proposal


def consume_preset_confirmation(session_id: str, proposal_id: str) -> Dict[str, Any]:
    session = store_assistant.get_assistant_session(session_id) or {}
    summary = dict(session.get("summary_json") or {})
    proposal = dict(summary.get("kernel_preset_proposal") or {})
    if str(proposal.get("proposal_id") or "") == proposal_id:
        proposal["consumed"] = True
        proposal["confirmation_token_hash"] = None
        summary["kernel_preset_proposal"] = proposal
    return store_assistant.create_or_update_assistant_session({**session, "summary_json": summary})
