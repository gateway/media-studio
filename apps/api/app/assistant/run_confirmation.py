from __future__ import annotations

import hashlib
import hmac

from fastapi import HTTPException

from .. import store, store_assistant
from ..graph.schemas import GraphWorkflow
from .provenance import (
    preset_test_workflow_fingerprint,
    recipe_plan_workflow_fingerprint,
    recipe_quality_contract_hash,
    workflow_fingerprint,
)
from .schemas import AssistantRunConfirmationRequest


class RunEvidenceError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def assistant_run_confirmation_kind(
    confirmation: object,
    *,
    capability: object = None,
    workflow: GraphWorkflow | None = None,
) -> str:
    explicit_kind = (
        str(confirmation.get("confirmation_kind") or "")
        if isinstance(confirmation, dict)
        else ""
    )
    if explicit_kind in {"graph", "preset_test", "recipe"}:
        return explicit_kind
    if isinstance(confirmation, dict) and confirmation.get("test_plan_id"):
        return "preset_test"
    if workflow is not None and _recipe_output_model_node_ids(
        workflow.model_dump(mode="json")
    ):
        return "recipe"
    if str(capability or "") == "recipe_builder":
        return "recipe"
    return "graph"


def _confirmed_workflow_fingerprint(confirmation: dict, workflow: GraphWorkflow) -> str:
    return (
        preset_test_workflow_fingerprint(workflow)
        if assistant_run_confirmation_kind(confirmation) == "preset_test"
        else workflow_fingerprint(workflow)
    )


def _workflow_identity(workflow: GraphWorkflow) -> str:
    metadata = workflow.metadata if isinstance(workflow.metadata, dict) else {}
    return str(workflow.workflow_id or metadata.get("workflow_id") or "")


def _without_workflow_identity(workflow: GraphWorkflow) -> GraphWorkflow:
    metadata = dict(workflow.metadata) if isinstance(workflow.metadata, dict) else {}
    metadata.pop("workflow_id", None)
    return workflow.model_copy(
        update={"workflow_id": None, "metadata": metadata},
        deep=True,
    )


def _matching_confirmation_fingerprint(
    confirmation: dict,
    workflow: GraphWorkflow,
) -> str | None:
    fingerprint = _confirmed_workflow_fingerprint(confirmation, workflow)
    expected = str(confirmation.get("workflow_fingerprint") or "")
    if expected and hmac.compare_digest(expected, fingerprint):
        return fingerprint
    if assistant_run_confirmation_kind(confirmation) == "preset_test":
        return None
    if not _workflow_identity(workflow):
        return None
    # A new graph receives its durable ID when the run path saves it.
    unsaved = _without_workflow_identity(workflow)
    unsaved_fingerprint = _confirmed_workflow_fingerprint(confirmation, unsaved)
    return fingerprint if expected and hmac.compare_digest(expected, unsaved_fingerprint) else None


def _matching_applied_recipe_plan(
    session_id: str,
    workflow: GraphWorkflow,
    plan_id: str | None = None,
) -> dict | None:
    plans = (
        [store_assistant.get_assistant_plan(plan_id)]
        if plan_id
        else store_assistant.list_assistant_plans(session_id)
    )
    workflow_id = _workflow_identity(workflow)
    fingerprint = recipe_plan_workflow_fingerprint(workflow)
    matches = []
    for plan in plans:
        if not plan or str(plan.get("assistant_session_id") or "") != session_id:
            continue
        if str(plan.get("status") or "") != "applied":
            continue
        metadata = (plan.get("plan_json") or {}).get("metadata") or {}
        plan_workflow = plan.get("workflow_json")
        if (
            str(metadata.get("template_id") or "") != "saved_recipe_image_v1"
            or not isinstance(plan_workflow, dict)
        ):
            continue
        applied_workflow_id = str(plan.get("applied_workflow_id") or "")
        if applied_workflow_id and workflow_id != applied_workflow_id:
            continue
        if hmac.compare_digest(
            recipe_plan_workflow_fingerprint(
                GraphWorkflow.model_validate(plan_workflow)
            ),
            fingerprint,
        ):
            matches.append(plan)
    return matches[0] if len(matches) == 1 else None


def _recipe_plan_for_confirmation(
    session_id: str,
    confirmation: dict,
    workflow: GraphWorkflow,
) -> dict | None:
    if assistant_run_confirmation_kind(confirmation) != "recipe":
        return None
    plan = _matching_applied_recipe_plan(
        session_id,
        workflow,
        str(confirmation.get("recipe_plan_id") or "") or None,
    )
    if not plan:
        return None
    workflow_id = _workflow_identity(workflow)
    applied_workflow_id = str(plan.get("applied_workflow_id") or "")
    if workflow_id and not applied_workflow_id:
        plan = store_assistant.create_or_update_assistant_plan(
            {**plan, "applied_workflow_id": workflow_id}
        )
    return plan


def _preset_output_model_node_ids(workflow: dict) -> set[str]:
    return {
        str(node.get("id") or "")
        for node in workflow.get("nodes", [])
        if isinstance(node, dict)
        and str(node.get("type") or "").startswith("model.kie.gpt_image_2_")
    }


def _recipe_output_model_node_ids(
    workflow: dict,
    recipe_id: str | None = None,
) -> set[str]:
    nodes = {
        str(node.get("id") or ""): node
        for node in workflow.get("nodes", [])
        if isinstance(node, dict) and str(node.get("id") or "")
    }
    recipe_node_ids = {
        node_id
        for node_id, node in nodes.items()
        if str(node.get("type") or "") == "prompt.recipe"
        and (
            recipe_id is None
            or str((node.get("fields") or {}).get("recipe_id") or "") == recipe_id
        )
    }
    model_node_ids = {
        node_id
        for node_id, node in nodes.items()
        if str(node.get("type") or "").startswith("model.kie.")
    }
    return {
        str(edge.get("target") or "")
        for edge in workflow.get("edges", [])
        if isinstance(edge, dict)
        and str(edge.get("source") or "") in recipe_node_ids
        and str(edge.get("source_port") or "") == "text"
        and str(edge.get("target") or "") in model_node_ids
        and str(edge.get("target_port") or "") == "prompt"
    }


def _generated_image_asset_ids(run_id: str, model_node_ids: set[str]) -> list[str]:
    return sorted(
        {
            str(item.get("asset_id") or "")
            for item in store.list_graph_artifacts_for_run(run_id)
            if item.get("kind") == "asset"
            and item.get("media_type") == "image"
            and str(item.get("node_id") or "") in model_node_ids
            and str(item.get("asset_id") or "")
        }
    )


def _recipe_id_from_plan(plan: dict) -> str:
    metadata = (plan.get("plan_json") or {}).get("metadata") or {}
    return str(metadata.get("template_recipe_id") or "")


def _workflow_has_recipe(workflow: dict, recipe_id: str) -> bool:
    return any(
        isinstance(node, dict)
        and str(node.get("type") or "") == "prompt.recipe"
        and str((node.get("fields") or {}).get("recipe_id") or "") == recipe_id
        for node in workflow.get("nodes", [])
    )


def _recipe_run_association(
    session_id: str,
    confirmation: dict,
    plan: dict,
    workflow: dict,
    run_id: str,
    fingerprint: str,
) -> dict:
    recipe_id = _recipe_id_from_plan(plan)
    recipe = store.get_prompt_recipe(recipe_id) if recipe_id else None
    model_node_ids = sorted(_recipe_output_model_node_ids(workflow, recipe_id))
    contract_hash = recipe_quality_contract_hash(recipe) if recipe else ""
    plan_metadata = (plan.get("plan_json") or {}).get("metadata") or {}
    planned_contract_hash = str(
        plan_metadata.get("recipe_quality_contract_hash") or ""
    )
    if (
        not recipe
        or not model_node_ids
        or not _workflow_has_recipe(workflow, recipe_id)
        or (
            planned_contract_hash
            and not hmac.compare_digest(planned_contract_hash, contract_hash)
        )
    ):
        raise RunEvidenceError(
            "recipe_workflow_mismatch",
            "The confirmed workflow is missing its saved recipe or eligible output model.",
        )
    return {
        "assistant_session_id": session_id,
        "recipe_plan_id": str(plan.get("assistant_plan_id") or ""),
        "recipe_id": recipe_id,
        "recipe_quality_contract_hash": contract_hash,
        "workflow_fingerprint": fingerprint,
        "confirmation_token_hash": str(confirmation.get("confirmation_token_hash") or ""),
        "run_id": run_id,
        "eligible_model_node_ids": model_node_ids,
        "associated_at": store_assistant.utcnow_iso(),
    }


def _legacy_recipe_run_association(
    session_id: str,
    summary: dict,
    run: dict,
    workflow: dict,
) -> dict | None:
    evidence = summary.get("kernel_recipe_run_evidence")
    run_id = str(run.get("run_id") or "")
    fingerprint = workflow_fingerprint(GraphWorkflow.model_validate(workflow))
    if (
        not isinstance(evidence, dict)
        or str(evidence.get("assistant_session_id") or "") != session_id
        or str(evidence.get("run_id") or "") != run_id
        or str(evidence.get("status") or "") != "completed"
        or not hmac.compare_digest(
            str(evidence.get("workflow_fingerprint") or ""), fingerprint
        )
    ):
        return None
    confirmation = summary.get("kernel_run_confirmation")
    confirmation_matches_run = (
        isinstance(confirmation, dict)
        and assistant_run_confirmation_kind(confirmation) == "recipe"
        and confirmation.get("consumed") is True
        and str(confirmation.get("assistant_run_id") or "") == run_id
        and hmac.compare_digest(
            str(confirmation.get("workflow_fingerprint") or ""), fingerprint
        )
    )
    confirmed_plan_id = (
        str(confirmation.get("recipe_plan_id") or "")
        if confirmation_matches_run
        else ""
    )
    if not confirmation_matches_run:
        return None
    plan = _matching_applied_recipe_plan(
        session_id,
        GraphWorkflow.model_validate(workflow),
        confirmed_plan_id or None,
    )
    if not plan:
        return None
    recipe_id = _recipe_id_from_plan(plan)
    recipe = store.get_prompt_recipe(recipe_id) if recipe_id else None
    if not recipe or str(recipe.get("updated_at") or "") > str(run.get("created_at") or ""):
        return None
    node_types = {
        str(node.get("id") or ""): str(node.get("type") or "")
        for node in workflow.get("nodes", [])
        if isinstance(node, dict)
    }
    recipe_node_ids = {
        node_id
        for node_id, node_type in node_types.items()
        if node_type == "prompt.recipe"
    }
    model_node_ids = _recipe_output_model_node_ids(workflow, recipe_id)
    run_nodes = {
        str(node.get("node_id") or ""): node
        for node in store.list_graph_run_nodes(run_id)
    }
    recipe_was_executed = any(
        str((run_nodes.get(node_id) or {}).get("input_snapshot_json", {}).get("recipe_id") or "")
        == recipe_id
        for node_id in recipe_node_ids
    )
    models_were_executed = bool(model_node_ids) and all(
        node_id in run_nodes for node_id in model_node_ids
    )
    output_asset_ids = _generated_image_asset_ids(run_id, model_node_ids)
    if (
        not recipe_was_executed
        or not models_were_executed
        or output_asset_ids != sorted(str(item) for item in evidence.get("output_asset_ids") or [])
    ):
        return None
    return {
        "assistant_session_id": session_id,
        "recipe_plan_id": str(plan.get("assistant_plan_id") or ""),
        "recipe_id": recipe_id,
        "recipe_quality_contract_hash": recipe_quality_contract_hash(recipe),
        "workflow_fingerprint": fingerprint,
        "confirmation_token_hash": str(confirmation.get("confirmation_token_hash") or ""),
        "run_id": run_id,
        "eligible_model_node_ids": sorted(model_node_ids),
        "associated_at": store_assistant.utcnow_iso(),
        "relinked_from_completed_evidence": True,
    }


def _bind_completed_preset_run(
    session_id: str,
    run: dict,
    session: dict,
    summary: dict,
    confirmation: dict,
) -> dict:
    plan_id = str(confirmation.get("test_plan_id") or "")
    plan = store_assistant.get_assistant_plan(plan_id) if plan_id else None
    if (
        not plan
        or str(plan.get("assistant_session_id") or "") != session_id
        or str(plan.get("status") or "") != "applied"
    ):
        raise RunEvidenceError(
            "preset_test_plan_mismatch",
            "This run is not linked to the current session's applied preset test graph.",
        )
    status = str(run.get("status") or "")
    if status != "completed":
        raise RunEvidenceError(
            "preset_test_run_not_completed",
            f"The linked preset test run is {status or 'unavailable'}, not completed.",
        )
    run_workflow = run.get("workflow_json")
    plan_workflow = plan.get("workflow_json")
    if not isinstance(run_workflow, dict) or not isinstance(plan_workflow, dict):
        raise RunEvidenceError(
            "preset_test_workflow_missing",
            "The preset test run or applied plan is missing its workflow snapshot.",
        )
    fingerprint = str(confirmation.get("workflow_fingerprint") or "")
    run_plan_fingerprint = preset_test_workflow_fingerprint(
        GraphWorkflow.model_validate(run_workflow)
    )
    plan_fingerprint = preset_test_workflow_fingerprint(
        GraphWorkflow.model_validate(plan_workflow)
    )
    if not hmac.compare_digest(plan_fingerprint, run_plan_fingerprint):
        raise RunEvidenceError(
            "preset_test_workflow_mismatch",
            "The completed run does not match the confirmed applied preset test graph.",
        )
    output_asset_ids = _generated_image_asset_ids(
        str(run.get("run_id") or ""),
        _preset_output_model_node_ids(plan_workflow),
    )
    if not output_asset_ids:
        raise RunEvidenceError(
            "preset_test_output_missing",
            "The completed preset test run has no generated output to review.",
        )
    evidence = {
        "assistant_session_id": session_id,
        "test_plan_id": plan_id,
        "run_id": str(run.get("run_id") or ""),
        "workflow_fingerprint": fingerprint,
        "status": status,
        "output_asset_ids": output_asset_ids,
    }
    updated_summary = {**summary, "kernel_preset_run_evidence": evidence}
    prior_comparison = summary.get("kernel_preset_output_comparison")
    if (
        not isinstance(prior_comparison, dict)
        or str(prior_comparison.get("run_id") or "") != evidence["run_id"]
    ):
        updated_summary.pop("kernel_preset_output_comparison", None)
        updated_summary.pop("kernel_preset_quality", None)
    store_assistant.create_or_update_assistant_session(
        {
            **session,
            "summary_json": updated_summary,
        }
    )
    return evidence


def _bind_completed_recipe_run(
    session_id: str,
    run: dict,
    session: dict,
    summary: dict,
    confirmation: dict,
) -> dict:
    association = summary.get("kernel_recipe_run_association")
    workflow = run.get("workflow_json")
    if not isinstance(workflow, dict):
        raise RunEvidenceError(
            "recipe_workflow_missing",
            "The recipe run is missing its workflow snapshot.",
        )
    if not isinstance(association, dict):
        association = _legacy_recipe_run_association(session_id, summary, run, workflow)
    if not isinstance(association, dict):
        raise RunEvidenceError(
            "recipe_run_not_confirmed",
            "This run is not linked to a confirmed Media Assistant recipe workflow.",
        )
    if (
        str(association.get("assistant_session_id") or "") != session_id
        or str(association.get("run_id") or "") != str(run.get("run_id") or "")
    ):
        raise RunEvidenceError(
            "recipe_run_mismatch",
            "This run was not started from the current Media Assistant recipe workflow confirmation.",
        )
    status = str(run.get("status") or "")
    if status != "completed":
        raise RunEvidenceError(
            "recipe_run_not_completed",
            f"The linked recipe run is {status or 'unavailable'}, not completed.",
        )
    fingerprint = str(association.get("workflow_fingerprint") or "")
    run_fingerprint = workflow_fingerprint(GraphWorkflow.model_validate(workflow))
    plan_id = str(association.get("recipe_plan_id") or "")
    plan = _matching_applied_recipe_plan(
        session_id,
        GraphWorkflow.model_validate(workflow),
        plan_id or None,
    )
    recipe_id = str(association.get("recipe_id") or "")
    recipe = store.get_prompt_recipe(recipe_id) if recipe_id else None
    contract_hash = str(association.get("recipe_quality_contract_hash") or "")
    plan_metadata = (plan.get("plan_json") or {}).get("metadata") if plan else {}
    planned_contract_hash = str(
        (plan_metadata or {}).get("recipe_quality_contract_hash") or ""
    )
    model_node_ids = _recipe_output_model_node_ids(workflow, recipe_id)
    associated_model_node_ids = {
        str(item) for item in association.get("eligible_model_node_ids") or []
    }
    confirmation_token_hash = str(confirmation.get("confirmation_token_hash") or "")
    association_token_hash = str(association.get("confirmation_token_hash") or "")
    confirmed_plan_id = str(confirmation.get("recipe_plan_id") or "")
    if (
        not fingerprint
        or not hmac.compare_digest(run_fingerprint, fingerprint)
        or not plan
        or _recipe_id_from_plan(plan) != recipe_id
        or not _workflow_has_recipe(workflow, recipe_id)
        or not recipe
        or not contract_hash
        or not hmac.compare_digest(recipe_quality_contract_hash(recipe), contract_hash)
        or (
            planned_contract_hash
            and not hmac.compare_digest(planned_contract_hash, contract_hash)
        )
        or model_node_ids != associated_model_node_ids
        or (
            not confirmed_plan_id
            and not association.get("relinked_from_completed_evidence")
        )
        or (
            confirmed_plan_id
            and not hmac.compare_digest(confirmed_plan_id, plan_id)
        )
        or not association_token_hash
        or not hmac.compare_digest(
            confirmation_token_hash,
            association_token_hash,
        )
    ):
        raise RunEvidenceError(
            "recipe_workflow_mismatch",
            "The completed run no longer matches the confirmed recipe workflow and contract.",
        )
    output_asset_ids = _generated_image_asset_ids(
        str(run.get("run_id") or ""),
        model_node_ids,
    )
    if not output_asset_ids:
        raise RunEvidenceError(
            "recipe_output_missing",
            "The completed recipe run has no generated image output to review.",
        )
    evidence = {
        "assistant_session_id": session_id,
        "recipe_plan_id": plan_id,
        "recipe_id": recipe_id,
        "recipe_quality_contract_hash": contract_hash,
        "run_id": str(run.get("run_id") or ""),
        "workflow_fingerprint": fingerprint,
        "status": status,
        "eligible_model_node_ids": sorted(model_node_ids),
        "output_asset_ids": output_asset_ids,
    }
    updated_summary = {
        **summary,
        "kernel_recipe_run_association": association,
        "kernel_recipe_run_evidence": evidence,
    }
    prior_comparison = summary.get("kernel_recipe_output_comparison")
    if (
        not isinstance(prior_comparison, dict)
        or str(prior_comparison.get("run_id") or "") != evidence["run_id"]
    ):
        updated_summary.pop("kernel_recipe_output_comparison", None)
        updated_summary.pop("kernel_recipe_quality", None)
    store_assistant.create_or_update_assistant_session(
        {**session, "summary_json": updated_summary}
    )
    return evidence


def bind_completed_assistant_run(
    session_id: str,
    run: dict,
    *,
    expected_kind: str | None = None,
) -> dict:
    """Bind one completed preset or recipe run through its persisted confirmation."""
    session = store_assistant.get_assistant_session(session_id)
    if not session:
        error_kind = (
            expected_kind
            if expected_kind in {"preset_test", "recipe"}
            else "assistant"
        )
        raise RunEvidenceError(
            f"{error_kind}_session_missing",
            "The Media Assistant session is unavailable.",
        )
    summary = (
        session.get("summary_json")
        if isinstance(session.get("summary_json"), dict)
        else {}
    )
    confirmation = summary.get("kernel_run_confirmation")
    confirmation_kind = assistant_run_confirmation_kind(
        confirmation,
        capability=summary.get("kernel_capability"),
    )
    evidence_kind = expected_kind or confirmation_kind
    if (
        not isinstance(confirmation, dict)
        or evidence_kind not in {"preset_test", "recipe"}
        or confirmation_kind != evidence_kind
        or confirmation.get("consumed") is not True
        or not str(confirmation.get("confirmation_token_hash") or "")
    ):
        raise RunEvidenceError(
            f"{evidence_kind}_run_not_confirmed",
            "This run is not linked to the current Assistant confirmation.",
        )
    run_id = str(run.get("run_id") or "")
    if not run_id or str(confirmation.get("assistant_run_id") or "") != run_id:
        raise RunEvidenceError(
            f"{evidence_kind}_run_mismatch",
            "This run was not started from the current Media Assistant confirmation.",
        )
    workflow = run.get("workflow_json")
    if not isinstance(workflow, dict):
        raise RunEvidenceError(
            f"{evidence_kind}_workflow_missing",
            "The confirmed run is missing its workflow snapshot.",
        )
    confirmation_fingerprint = str(confirmation.get("workflow_fingerprint") or "")
    run_fingerprint = _confirmed_workflow_fingerprint(
        confirmation,
        GraphWorkflow.model_validate(workflow),
    )
    if not confirmation_fingerprint or not hmac.compare_digest(
        confirmation_fingerprint,
        run_fingerprint,
    ):
        raise RunEvidenceError(
            f"{evidence_kind}_workflow_mismatch",
            "The completed run does not match the current Assistant confirmation.",
        )
    binder = (
        _bind_completed_preset_run
        if evidence_kind == "preset_test"
        else _bind_completed_recipe_run
    )
    return binder(session_id, run, session, summary, confirmation)


def _confirmation_error_code(
    confirmation: object,
    suffix: str,
    *,
    capability: object = None,
) -> str:
    prefix = (
        "recipe"
        if assistant_run_confirmation_kind(confirmation, capability=capability) == "recipe"
        else "preset_test"
    )
    return f"{prefix}_{suffix}"


def associate_confirmed_assistant_run(
    session_id: str,
    run_id: str,
    payload: AssistantRunConfirmationRequest,
) -> None:
    session = store_assistant.get_assistant_session(session_id)
    if not session:
        raise RunEvidenceError("preset_test_session_missing", "The Media Assistant session is unavailable.")
    summary = session.get("summary_json") if isinstance(session.get("summary_json"), dict) else {}
    confirmation = summary.get("kernel_run_confirmation")
    capability = summary.get("kernel_capability")
    if not isinstance(confirmation, dict) or confirmation.get("consumed") is True:
        raise RunEvidenceError(
            _confirmation_error_code(confirmation, "run_not_confirmed", capability=capability),
            "This run confirmation is no longer available.",
        )
    supplied_hash = hashlib.sha256(payload.confirmation_token.encode("utf-8")).hexdigest()
    if not hmac.compare_digest(str(confirmation.get("confirmation_token_hash") or ""), supplied_hash):
        raise RunEvidenceError(
            _confirmation_error_code(confirmation, "confirmation_invalid", capability=capability),
            "This run confirmation is invalid.",
        )
    fingerprint = _matching_confirmation_fingerprint(confirmation, payload.workflow)
    if not fingerprint:
        raise RunEvidenceError(
            "workflow_fingerprint_mismatch",
            "The graph changed after this run confirmation was prepared.",
        )
    confirmation_kind = assistant_run_confirmation_kind(
        confirmation,
        capability=capability,
    )
    recipe_plan = None
    if confirmation_kind == "recipe":
        recipe_plan = _recipe_plan_for_confirmation(
            session_id,
            confirmation,
            payload.workflow,
        )
        if not recipe_plan:
            raise RunEvidenceError(
                "workflow_fingerprint_mismatch",
                "The graph changed after this run confirmation was prepared.",
            )
    run = store.get_graph_run(run_id)
    if not run:
        raise RunEvidenceError(
            _confirmation_error_code(confirmation, "run_missing", capability=capability),
            "The confirmed graph run is unavailable.",
        )
    run_workflow = run.get("workflow_json")
    if not isinstance(run_workflow, dict) or not hmac.compare_digest(
        _confirmed_workflow_fingerprint(
            confirmation,
            GraphWorkflow.model_validate(run_workflow),
        ),
        fingerprint,
    ):
        raise RunEvidenceError(
            _confirmation_error_code(confirmation, "workflow_mismatch", capability=capability),
            "The started run does not match the confirmed graph.",
        )
    confirmed_at = store_assistant.utcnow_iso()
    updated_summary = {
        **summary,
        "kernel_run_confirmation": {
            **confirmation,
            "workflow_fingerprint": fingerprint,
            "assistant_run_id": run_id,
            "consumed": True,
            "confirmed_at": confirmed_at,
        },
    }
    if recipe_plan:
        updated_summary["kernel_recipe_run_association"] = _recipe_run_association(
            session_id,
            confirmation,
            recipe_plan,
            run_workflow,
            run_id,
            fingerprint,
        )
    store_assistant.create_or_update_assistant_session(
        {
            **session,
            "summary_json": updated_summary,
        }
    )


def applied_preset_test_plan_id(session_id: str, workflow: GraphWorkflow) -> str | None:
    fingerprint = preset_test_workflow_fingerprint(workflow)
    for plan in store_assistant.list_assistant_plans(session_id):
        if str(plan.get("status") or "") != "applied":
            continue
        metadata = (plan.get("plan_json") or {}).get("metadata") or {}
        if str(metadata.get("template_id") or "") not in {
            "preset_style_t2i_sandbox_v1",
            "preset_style_i2i_sandbox_v1",
        }:
            continue
        workflow = plan.get("workflow_json")
        if not isinstance(workflow, dict):
            continue
        if hmac.compare_digest(
            preset_test_workflow_fingerprint(GraphWorkflow.model_validate(workflow)),
            fingerprint,
        ):
            return str(plan.get("assistant_plan_id") or "") or None
    return None


def applied_recipe_plan_id(
    session_id: str,
    workflow: GraphWorkflow,
    proposal_id: str | None = None,
) -> str | None:
    plan = _matching_applied_recipe_plan(session_id, workflow, proposal_id)
    return str((plan or {}).get("assistant_plan_id") or "") or None


def confirm_kernel_run_action(
    session_id: str,
    payload: AssistantRunConfirmationRequest,
) -> dict[str, bool]:
    session = store_assistant.get_assistant_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="assistant session not found")
    summary = session.get("summary_json") if isinstance(session.get("summary_json"), dict) else {}
    confirmation = summary.get("kernel_run_confirmation")
    if not isinstance(confirmation, dict) or confirmation.get("consumed") is True:
        raise HTTPException(status_code=400, detail="This run confirmation is no longer available.")
    supplied_hash = hashlib.sha256(payload.confirmation_token.encode("utf-8")).hexdigest()
    if not hmac.compare_digest(str(confirmation.get("confirmation_token_hash") or ""), supplied_hash):
        raise HTTPException(status_code=400, detail="This run confirmation is invalid.")
    supplied_fingerprint = _matching_confirmation_fingerprint(
        confirmation,
        payload.workflow,
    )
    if not supplied_fingerprint:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "workflow_fingerprint_mismatch",
                "message": "The graph changed after this run confirmation was prepared.",
            },
        )
    if assistant_run_confirmation_kind(confirmation) == "recipe" and not _recipe_plan_for_confirmation(
        session_id,
        confirmation,
        payload.workflow,
    ):
        raise HTTPException(
            status_code=400,
            detail={
                "code": "workflow_fingerprint_mismatch",
                "message": "The graph changed after this run confirmation was prepared.",
            },
        )
    store_assistant.create_or_update_assistant_session(
        {
            **session,
            "summary_json": {
                **summary,
                "kernel_run_confirmation": {
                    **confirmation,
                    "workflow_fingerprint": supplied_fingerprint,
                    "consumed": True,
                    "confirmed_at": store_assistant.utcnow_iso(),
                },
            },
        }
    )
    return {"confirmed": True}
