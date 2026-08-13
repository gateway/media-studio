from __future__ import annotations

import hashlib
import importlib
import json

import pytest


def _workflow(workflow_id: str = "workflow-preset-run-evidence") -> dict:
    return {
        "schema_version": 1,
        "workflow_id": workflow_id,
        "name": "Preset run evidence",
        "nodes": [
            {
                "id": "preset-prompt",
                "type": "prompt.text",
                "position": {"x": 0, "y": 0},
                "fields": {"text": "A reusable editorial poster"},
            },
            {
                "id": "preset-model",
                "type": "model.kie.gpt_image_2_text_to_image",
                "position": {"x": 400, "y": 0},
                "fields": {},
            },
            {
                "id": "preset-preview",
                "type": "preview.image",
                "position": {"x": 800, "y": 0},
                "fields": {},
            },
        ],
        "edges": [
            {
                "id": "edge-prompt-model",
                "source": "preset-prompt",
                "source_port": "text",
                "target": "preset-model",
                "target_port": "prompt",
            },
            {
                "id": "edge-model-preview",
                "source": "preset-model",
                "source_port": "image",
                "target": "preset-preview",
                "target_port": "image",
            },
        ],
        "metadata": {},
    }


def _session(client, workflow: dict) -> dict:
    return client.post(
        "/media/assistant/sessions",
        json={
            "owner_kind": "graph_workflow",
            "owner_id": workflow["workflow_id"],
            "workflow": workflow,
            "provider_kind": "codex_local",
        },
    ).json()


def _applied_preset_plan(store_assistant, session_id: str, workflow: dict) -> dict:
    return store_assistant.create_or_update_assistant_plan(
        {
            "assistant_session_id": session_id,
            "status": "applied",
            "capability": "plan_graph",
            "plan_json": {
                "summary": "Applied preset test graph",
                "operations": [],
                "metadata": {
                    "template_id": "preset_style_t2i_sandbox_v1",
                    "template_mode": "text_to_image",
                },
            },
            "validation_json": {"valid": True, "errors": [], "warnings": []},
            "pricing_json": {
                "pricing_summary": {
                    "total": {"estimated_credits": 6.0, "estimated_cost_usd": 0.03}
                }
            },
            "workflow_json": workflow,
            "applied_workflow_id": workflow["workflow_id"],
        }
    )


def test_run_confirmation_records_the_applied_preset_test_plan(client, app_modules, monkeypatch) -> None:
    kernel = importlib.import_module("app.assistant.kernel")
    graph_routes = importlib.import_module("app.graph.routes")
    workflow = _workflow()
    session = _session(client, workflow)
    plan = _applied_preset_plan(
        app_modules["store_assistant"],
        session["assistant_session_id"],
        workflow,
    )
    monkeypatch.setattr(
        kernel,
        "run_kernel_provider_step",
        lambda **_kwargs: {
            "capability": "preset_builder",
            "artifact_intent": "none",
            "reply": "The current graph is ready for your run confirmation.",
            "requested_action": {
                "kind": "run_workflow",
                "label": "Review and run",
                "requires_confirmation": True,
            },
        },
    )

    response = client.post(
        f"/media/assistant/sessions/{session['assistant_session_id']}/messages",
        json={"content_text": "Please check this preset test before I run it.", "workflow": workflow},
    )

    assert response.status_code == 200, response.text
    confirmation = response.json()["summary_json"]["kernel_run_confirmation"]
    assert confirmation["test_plan_id"] == plan["assistant_plan_id"]
    assert confirmation["workflow_fingerprint"]
    assert confirmation["consumed"] is False
    next_action = response.json()["messages"][-1]["content_json"]["next_action"]
    app_modules["store"].create_or_update_graph_workflow(
        {
            "workflow_id": workflow["workflow_id"],
            "name": workflow["name"],
            "workflow_json": workflow,
        }
    )
    started_run_ids = []
    monkeypatch.setattr(graph_routes.runtime, "start_run", started_run_ids.append)
    created = client.post(
        f"/media/graph/workflows/{workflow['workflow_id']}/runs",
        json={
            "workflow": workflow,
            "assistant_session_id": session["assistant_session_id"],
            "assistant_confirmation_token": next_action["confirmation_token"],
        },
    )
    assert created.status_code == 200, created.text
    stored_confirmation = app_modules["store_assistant"].get_assistant_session(
        session["assistant_session_id"]
    )["summary_json"]["kernel_run_confirmation"]
    assert stored_confirmation["confirmed_at"]
    assert stored_confirmation["assistant_run_id"] == created.json()["run_id"]
    assert started_run_ids == [created.json()["run_id"]]


def _confirmed_session(store_assistant, session: dict, plan: dict, fingerprint: str) -> dict:
    return store_assistant.create_or_update_assistant_session(
        {
            **session,
            "summary_json": {
                **(session.get("summary_json") or {}),
                "kernel_run_confirmation": {
                    "test_plan_id": plan["assistant_plan_id"],
                    "workflow_fingerprint": fingerprint,
                    "consumed": True,
                    "confirmed_at": store_assistant.utcnow_iso(),
                },
            },
        }
    )


def _completed_run(
    store,
    workflow: dict,
    run_id: str = "run-preset-evidence",
    *,
    status: str = "completed",
) -> dict:
    run = store.create_graph_run(
        {
            "run_id": run_id,
            "workflow_id": workflow["workflow_id"],
            "workflow_json": workflow,
            "status": status,
            "metrics_json": {"output_asset_ids": ["asset-preset-output"]},
        },
        [],
    )
    store.create_graph_artifact(
        {
            "artifact_id": f"artifact-{run_id}",
            "workflow_id": workflow["workflow_id"],
            "run_id": run_id,
            "node_id": "preset-model",
            "node_type": "model.kie.gpt_image_2_text_to_image",
            "output_port": "image",
            "output_index": 0,
            "kind": "asset",
            "media_type": "image",
            "asset_id": "asset-preset-output",
        }
    )
    return run


def _associate_session(store_assistant, session: dict, run_id: str) -> dict:
    return store_assistant.create_or_update_assistant_session(
        {
            **session,
            "summary_json": {
                **session["summary_json"],
                "kernel_run_confirmation": {
                    **session["summary_json"]["kernel_run_confirmation"],
                    "assistant_run_id": run_id,
                },
            },
        }
    )


def _read_preset_run_evidence(tools, workflow: dict, session: dict, run_id: str):
    return tools.execute_kernel_tool(
        tool_name="read_run_evidence",
        arguments=json.dumps({"run_id": run_id}),
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=tools.GraphWorkflow.model_validate(workflow),
            canvas_context={},
            run_id=run_id,
            session_id=session["assistant_session_id"],
            session=session,
        ),
    )


def test_completed_preset_run_is_bound_to_its_session_plan_and_fingerprint(client, app_modules) -> None:
    kernel = importlib.import_module("app.assistant.kernel")
    tools = importlib.import_module("app.assistant.kernel_tools")
    workflow = _workflow()
    session = _session(client, workflow)
    plan = _applied_preset_plan(app_modules["store_assistant"], session["assistant_session_id"], workflow)
    fingerprint = tools.workflow_fingerprint(tools.GraphWorkflow.model_validate(workflow))
    session = _confirmed_session(app_modules["store_assistant"], session, plan, fingerprint)
    run = _completed_run(app_modules["store"], workflow)
    session = _associate_session(app_modules["store_assistant"], session, run["run_id"])

    evidence = _read_preset_run_evidence(tools, workflow, session, run["run_id"])

    assert evidence.trace.error is None
    assert evidence.result["preset_test"] == {
        "assistant_session_id": session["assistant_session_id"],
        "test_plan_id": plan["assistant_plan_id"],
        "run_id": run["run_id"],
        "workflow_fingerprint": fingerprint,
        "status": "completed",
        "output_asset_ids": ["asset-preset-output"],
    }
    stored = app_modules["store_assistant"].get_assistant_session(session["assistant_session_id"])
    assert stored["summary_json"]["kernel_preset_run_evidence"] == evidence.result["preset_test"]
    assert kernel._kernel_session_context(stored)["active_preset_run_evidence"] == evidence.result["preset_test"]


def test_preset_run_evidence_rejects_wrong_session_plan(client, app_modules) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    workflow = _workflow("workflow-wrong-session")
    owner = _session(client, workflow)
    other = _session(client, workflow)
    owner_plan = _applied_preset_plan(app_modules["store_assistant"], owner["assistant_session_id"], workflow)
    fingerprint = tools.workflow_fingerprint(tools.GraphWorkflow.model_validate(workflow))
    other = _confirmed_session(app_modules["store_assistant"], other, owner_plan, fingerprint)
    run = _completed_run(app_modules["store"], workflow, "run-wrong-session")
    other = _associate_session(app_modules["store_assistant"], other, run["run_id"])

    evidence = _read_preset_run_evidence(tools, workflow, other, run["run_id"])

    assert evidence.result is None
    assert evidence.trace.error.code == "preset_test_plan_mismatch"


@pytest.mark.parametrize("status", ["failed", "cancelled"])
def test_preset_run_evidence_rejects_unsuccessful_runs(client, app_modules, status: str) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    workflow = _workflow(f"workflow-{status}-run")
    session = _session(client, workflow)
    plan = _applied_preset_plan(app_modules["store_assistant"], session["assistant_session_id"], workflow)
    fingerprint = tools.workflow_fingerprint(tools.GraphWorkflow.model_validate(workflow))
    session = _confirmed_session(app_modules["store_assistant"], session, plan, fingerprint)
    run = _completed_run(app_modules["store"], workflow, f"run-{status}", status=status)
    session = _associate_session(app_modules["store_assistant"], session, run["run_id"])

    evidence = _read_preset_run_evidence(tools, workflow, session, run["run_id"])

    assert evidence.result is None
    assert evidence.trace.error.code == "preset_test_run_not_completed"


def test_preset_run_evidence_rejects_a_different_workflow_snapshot(client, app_modules) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    workflow = _workflow("workflow-confirmed")
    session = _session(client, workflow)
    plan = _applied_preset_plan(app_modules["store_assistant"], session["assistant_session_id"], workflow)
    fingerprint = tools.workflow_fingerprint(tools.GraphWorkflow.model_validate(workflow))
    session = _confirmed_session(app_modules["store_assistant"], session, plan, fingerprint)
    changed = {
        **workflow,
        "nodes": [{"id": "changed", "type": "prompt.text", "position": {"x": 0, "y": 0}, "fields": {}}],
    }
    run = _completed_run(app_modules["store"], changed, "run-changed-workflow")
    session = _associate_session(app_modules["store_assistant"], session, run["run_id"])

    evidence = _read_preset_run_evidence(tools, workflow, session, run["run_id"])

    assert evidence.result is None
    assert evidence.trace.error.code == "preset_test_workflow_mismatch"


def test_preset_run_evidence_rejects_an_unassociated_older_matching_run(client, app_modules) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    workflow = _workflow("workflow-older-matching-run")
    session = _session(client, workflow)
    plan = _applied_preset_plan(app_modules["store_assistant"], session["assistant_session_id"], workflow)
    fingerprint = tools.workflow_fingerprint(tools.GraphWorkflow.model_validate(workflow))
    older_run = _completed_run(app_modules["store"], workflow, "run-older-matching")
    session = _confirmed_session(app_modules["store_assistant"], session, plan, fingerprint)

    evidence = _read_preset_run_evidence(tools, workflow, session, older_run["run_id"])

    assert evidence.result is None
    assert evidence.trace.error.code == "preset_test_run_mismatch"


def test_preset_run_evidence_does_not_count_an_image_loader_asset_as_output(client, app_modules) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    workflow = _workflow("workflow-loader-asset-only")
    session = _session(client, workflow)
    plan = _applied_preset_plan(app_modules["store_assistant"], session["assistant_session_id"], workflow)
    fingerprint = tools.workflow_fingerprint(tools.GraphWorkflow.model_validate(workflow))
    session = _confirmed_session(app_modules["store_assistant"], session, plan, fingerprint)
    run = _completed_run(app_modules["store"], workflow, "run-loader-asset-only")
    app_modules["store"].create_graph_artifact(
        {
            **app_modules["store"].list_graph_artifacts_for_run(run["run_id"])[0],
            "node_id": "image-loader",
            "node_type": "media.load_image",
            "asset_id": "asset-input-only",
        }
    )
    session = _associate_session(app_modules["store_assistant"], session, run["run_id"])

    evidence = _read_preset_run_evidence(tools, workflow, session, run["run_id"])

    assert evidence.result is None
    assert evidence.trace.error.code == "preset_test_output_missing"


def test_invalid_confirmation_never_starts_the_created_run(client, app_modules, monkeypatch) -> None:
    graph_routes = importlib.import_module("app.graph.routes")
    tools = importlib.import_module("app.assistant.kernel_tools")
    workflow = _workflow("workflow-invalid-confirmation")
    session = _session(client, workflow)
    plan = _applied_preset_plan(app_modules["store_assistant"], session["assistant_session_id"], workflow)
    fingerprint = tools.workflow_fingerprint(tools.GraphWorkflow.model_validate(workflow))
    app_modules["store_assistant"].create_or_update_assistant_session(
        {
            **session,
            "summary_json": {
                "kernel_run_confirmation": {
                    "confirmation_token_hash": hashlib.sha256(b"expected-token").hexdigest(),
                    "test_plan_id": plan["assistant_plan_id"],
                    "workflow_fingerprint": fingerprint,
                    "consumed": False,
                },
            },
        }
    )
    app_modules["store"].create_or_update_graph_workflow(
        {
            "workflow_id": workflow["workflow_id"],
            "name": workflow["name"],
            "workflow_json": workflow,
        }
    )
    started_run_ids = []
    monkeypatch.setattr(graph_routes.runtime, "start_run", started_run_ids.append)

    response = client.post(
        f"/media/graph/workflows/{workflow['workflow_id']}/runs",
        json={
            "workflow": workflow,
            "assistant_session_id": session["assistant_session_id"],
            "assistant_confirmation_token": "wrong-token",
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "preset_test_confirmation_invalid"
    assert started_run_ids == []
    assert app_modules["store"].list_graph_runs_for_workflow(workflow["workflow_id"])[0]["status"] == "cancelled"
