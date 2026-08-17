from __future__ import annotations

import hashlib
import hmac

from fastapi import HTTPException

from .. import store, store_assistant
from ..graph.schemas import GraphWorkflow
from .provenance import preset_test_workflow_fingerprint, workflow_fingerprint
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
    metadata = dict(workflow.metadata) if isinstance(workflow.metadata, dict) else {}
    identity = str(workflow.workflow_id or metadata.get("workflow_id") or "")
    if not identity:
        return None
    # A new graph receives its durable ID when the run path saves it.
    metadata.pop("workflow_id", None)
    unsaved = workflow.model_copy(
        update={"workflow_id": None, "metadata": metadata},
        deep=True,
    )
    unsaved_fingerprint = _confirmed_workflow_fingerprint(confirmation, unsaved)
    return fingerprint if expected and hmac.compare_digest(expected, unsaved_fingerprint) else None


def _preset_output_model_node_ids(workflow: dict) -> set[str]:
    return {
        str(node.get("id") or "")
        for node in workflow.get("nodes", [])
        if isinstance(node, dict)
        and str(node.get("type") or "").startswith("model.kie.gpt_image_2_")
    }


def _recipe_output_model_node_ids(workflow: dict) -> set[str]:
    node_types = {
        str(node.get("id") or ""): str(node.get("type") or "")
        for node in workflow.get("nodes", [])
        if isinstance(node, dict) and str(node.get("id") or "")
    }
    return {
        str(edge.get("target") or "")
        for edge in workflow.get("edges", [])
        if isinstance(edge, dict)
        and node_types.get(str(edge.get("source") or "")) == "prompt.recipe"
        and str(edge.get("source_port") or "") == "text"
        and node_types.get(str(edge.get("target") or ""), "").startswith("model.kie.")
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


def bind_completed_preset_run(session_id: str, run: dict) -> dict:
    session = store_assistant.get_assistant_session(session_id)
    if not session:
        raise RunEvidenceError("preset_test_session_missing", "The Media Assistant session is unavailable.")
    summary = session.get("summary_json") if isinstance(session.get("summary_json"), dict) else {}
    confirmation = summary.get("kernel_run_confirmation")
    if not isinstance(confirmation, dict) or confirmation.get("consumed") is not True:
        raise RunEvidenceError(
            "preset_test_run_not_confirmed",
            "This run was not started from the current Media Assistant confirmation.",
        )
    if str(confirmation.get("assistant_run_id") or "") != str(run.get("run_id") or ""):
        raise RunEvidenceError(
            "preset_test_run_mismatch",
            "This run was not started from the current Media Assistant confirmation.",
        )
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
    if not fingerprint or not hmac.compare_digest(run_plan_fingerprint, fingerprint) or not hmac.compare_digest(
        plan_fingerprint,
        run_plan_fingerprint,
    ):
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


def bind_completed_recipe_run(session_id: str, run: dict) -> dict:
    session = store_assistant.get_assistant_session(session_id)
    if not session:
        raise RunEvidenceError("recipe_session_missing", "The Media Assistant session is unavailable.")
    summary = session.get("summary_json") if isinstance(session.get("summary_json"), dict) else {}
    confirmation = summary.get("kernel_run_confirmation")
    if (
        not isinstance(confirmation, dict)
        or confirmation.get("consumed") is not True
        or assistant_run_confirmation_kind(
            confirmation,
            capability=summary.get("kernel_capability"),
        )
        != "recipe"
    ):
        raise RunEvidenceError(
            "recipe_run_not_confirmed",
            "This run was not started from the current Media Assistant recipe workflow confirmation.",
        )
    if str(confirmation.get("assistant_run_id") or "") != str(run.get("run_id") or ""):
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
    workflow = run.get("workflow_json")
    if not isinstance(workflow, dict):
        raise RunEvidenceError(
            "recipe_workflow_missing",
            "The recipe run is missing its workflow snapshot.",
        )
    fingerprint = str(confirmation.get("workflow_fingerprint") or "")
    run_fingerprint = workflow_fingerprint(GraphWorkflow.model_validate(workflow))
    has_recipe = any(
        isinstance(node, dict) and str(node.get("type") or "") == "prompt.recipe"
        for node in workflow.get("nodes", [])
    )
    if not fingerprint or not hmac.compare_digest(run_fingerprint, fingerprint) or not has_recipe:
        raise RunEvidenceError(
            "recipe_workflow_mismatch",
            "The completed run does not match the confirmed recipe workflow.",
        )
    output_asset_ids = _generated_image_asset_ids(
        str(run.get("run_id") or ""),
        _recipe_output_model_node_ids(workflow),
    )
    if not output_asset_ids:
        raise RunEvidenceError(
            "recipe_output_missing",
            "The completed recipe run has no generated image output to review.",
        )
    evidence = {
        "assistant_session_id": session_id,
        "run_id": str(run.get("run_id") or ""),
        "workflow_fingerprint": fingerprint,
        "status": status,
        "output_asset_ids": output_asset_ids,
    }
    updated_summary = {**summary, "kernel_recipe_run_evidence": evidence}
    prior_comparison = summary.get("kernel_recipe_output_comparison")
    if (
        not isinstance(prior_comparison, dict)
        or str(prior_comparison.get("run_id") or "") != evidence["run_id"]
    ):
        updated_summary.pop("kernel_recipe_output_comparison", None)
    store_assistant.create_or_update_assistant_session(
        {**session, "summary_json": updated_summary}
    )
    return evidence


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
    store_assistant.create_or_update_assistant_session(
        {
            **session,
            "summary_json": {
                **summary,
                "kernel_run_confirmation": {
                    **confirmation,
                    "workflow_fingerprint": fingerprint,
                    "assistant_run_id": run_id,
                    "consumed": True,
                    "confirmed_at": confirmed_at,
                },
            },
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
