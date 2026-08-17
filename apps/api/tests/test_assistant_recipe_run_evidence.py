from __future__ import annotations

import hashlib
import importlib
import json


def _recipe_workflow() -> dict:
    return {
        "schema_version": 1,
        "workflow_id": "workflow-recipe-run-evidence",
        "name": "Recipe output review",
        "nodes": [
            {
                "id": "recipe-prompt",
                "type": "prompt.recipe",
                "position": {"x": 0, "y": 0},
                "fields": {"recipe_id": "recipe-travel-poster"},
            },
            {
                "id": "recipe-model",
                "type": "model.kie.gpt_image_2_text_to_image",
                "position": {"x": 400, "y": 0},
                "fields": {},
            },
            {
                "id": "recipe-preview",
                "type": "preview.image",
                "position": {"x": 800, "y": 0},
                "fields": {},
            },
        ],
        "edges": [
            {
                "id": "edge-recipe-model",
                "source": "recipe-prompt",
                "source_port": "text",
                "target": "recipe-model",
                "target_port": "prompt",
            },
            {
                "id": "edge-model-preview",
                "source": "recipe-model",
                "source_port": "image",
                "target": "recipe-preview",
                "target_port": "image",
            },
        ],
        "metadata": {},
    }


def _session(client, store_assistant, workflow: dict, run_id: str) -> dict:
    session = client.post(
        "/media/assistant/sessions",
        json={
            "owner_kind": "graph_workflow",
            "owner_id": workflow["workflow_id"],
            "workflow": workflow,
            "provider_kind": "codex_local",
        },
    ).json()
    fingerprint = importlib.import_module("app.assistant.provenance").workflow_fingerprint(
        importlib.import_module("app.graph.schemas").GraphWorkflow.model_validate(workflow)
    )
    return store_assistant.create_or_update_assistant_session(
        {
            **session,
            "summary_json": {
                "kernel_recipe_draft": {"key": "travel-poster"},
                "kernel_capability": "recipe_builder",
                "kernel_run_confirmation": {
                    "workflow_fingerprint": fingerprint,
                    "assistant_run_id": run_id,
                    "confirmation_kind": "recipe",
                    "consumed": True,
                    "confirmed_at": store_assistant.utcnow_iso(),
                },
            },
        }
    )


def _completed_run(store, workflow: dict, run_id: str, *, node_id: str = "recipe-model") -> dict:
    run = store.create_graph_run(
        {
            "run_id": run_id,
            "workflow_id": workflow["workflow_id"],
            "workflow_json": workflow,
            "status": "completed",
        },
        [],
    )
    store.create_graph_artifact(
        {
            "artifact_id": f"artifact-{run_id}",
            "workflow_id": workflow["workflow_id"],
            "run_id": run_id,
            "node_id": node_id,
            "node_type": "model.kie.gpt_image_2_text_to_image",
            "output_port": "image",
            "output_index": 0,
            "kind": "asset",
            "media_type": "image",
            "asset_id": f"asset-{run_id}",
        }
    )
    return run


def _read_recipe_run(tools, workflow: dict, session: dict, run_id: str):
    return tools.execute_kernel_tool(
        tool_name="read_run_evidence",
        arguments=json.dumps({"run_id": run_id}),
        capability="recipe_builder",
        context=tools.KernelToolContext(
            workflow=tools.GraphWorkflow.model_validate(workflow),
            canvas_context={},
            run_id=run_id,
            session_id=session["assistant_session_id"],
            session=session,
        ),
    )


def test_recipe_run_confirmation_is_derived_from_the_workflow_not_ui_capability() -> None:
    run_confirmation = importlib.import_module("app.assistant.run_confirmation")
    graph_schemas = importlib.import_module("app.graph.schemas")

    kind = run_confirmation.assistant_run_confirmation_kind(
        {},
        capability="graph_builder",
        workflow=graph_schemas.GraphWorkflow.model_validate(_recipe_workflow()),
    )

    assert kind == "recipe"


def test_completed_recipe_run_is_bound_to_exact_session_confirmation(client, app_modules) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    workflow = _recipe_workflow()
    run = _completed_run(app_modules["store"], workflow, "run-recipe-evidence")
    session = _session(
        client,
        app_modules["store_assistant"],
        workflow,
        run["run_id"],
    )

    execution = _read_recipe_run(tools, workflow, session, run["run_id"])

    assert execution.trace.error is None
    assert execution.result["recipe_run"] == {
        "assistant_session_id": session["assistant_session_id"],
        "run_id": run["run_id"],
        "workflow_fingerprint": session["summary_json"]["kernel_run_confirmation"]["workflow_fingerprint"],
        "status": "completed",
        "output_asset_ids": ["asset-run-recipe-evidence"],
    }
    stored = app_modules["store_assistant"].get_assistant_session(session["assistant_session_id"])
    assert stored["summary_json"]["kernel_recipe_run_evidence"] == execution.result["recipe_run"]
    context = importlib.import_module("app.assistant.kernel")._kernel_session_context(stored)
    assert context["active_recipe_run_evidence"] == execution.result["recipe_run"]


def test_recipe_run_evidence_rejects_older_matching_run(client, app_modules) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    workflow = _recipe_workflow()
    associated = _completed_run(app_modules["store"], workflow, "run-current-recipe")
    older = _completed_run(app_modules["store"], workflow, "run-older-recipe")
    session = _session(
        client,
        app_modules["store_assistant"],
        workflow,
        associated["run_id"],
    )

    execution = _read_recipe_run(tools, workflow, session, older["run_id"])

    assert execution.result is None
    assert execution.trace.error.code == "recipe_run_mismatch"
    stored = app_modules["store_assistant"].get_assistant_session(session["assistant_session_id"])
    assert "kernel_recipe_run_evidence" not in stored["summary_json"]


def test_recipe_run_evidence_rejects_output_from_disconnected_model(client, app_modules) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    workflow = _recipe_workflow()
    workflow["nodes"].append(
        {
            "id": "unrelated-model",
            "type": "model.kie.gpt_image_2_text_to_image",
            "position": {"x": 400, "y": 400},
            "fields": {},
        }
    )
    run = _completed_run(
        app_modules["store"],
        workflow,
        "run-disconnected-recipe-output",
        node_id="unrelated-model",
    )
    session = _session(client, app_modules["store_assistant"], workflow, run["run_id"])

    execution = _read_recipe_run(tools, workflow, session, run["run_id"])

    assert execution.result is None
    assert execution.trace.error.code == "recipe_output_missing"
    stored = app_modules["store_assistant"].get_assistant_session(session["assistant_session_id"])
    assert "kernel_recipe_run_evidence" not in stored["summary_json"]


def _invalid_confirmation_response(
    client,
    app_modules,
    monkeypatch,
    *,
    workflow: dict,
    confirmation_kind: str,
):
    graph_routes = importlib.import_module("app.graph.routes")
    session = client.post(
        "/media/assistant/sessions",
        json={
            "owner_kind": "graph_workflow",
            "owner_id": workflow["workflow_id"],
            "workflow": workflow,
            "provider_kind": "codex_local",
        },
    ).json()
    fingerprint = importlib.import_module("app.assistant.provenance").workflow_fingerprint(
        importlib.import_module("app.graph.schemas").GraphWorkflow.model_validate(workflow)
    )
    app_modules["store_assistant"].create_or_update_assistant_session(
        {
            **session,
            "summary_json": {
                "kernel_capability": (
                    "recipe_builder" if confirmation_kind == "recipe" else "graph_builder"
                ),
                "kernel_run_confirmation": {
                    "confirmation_token_hash": hashlib.sha256(b"expected-token").hexdigest(),
                    "workflow_fingerprint": fingerprint,
                    "confirmation_kind": confirmation_kind,
                    "consumed": False,
                }
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

    return client.post(
        f"/media/graph/workflows/{workflow['workflow_id']}/runs",
        json={
            "workflow": workflow,
            "assistant_session_id": session["assistant_session_id"],
            "assistant_confirmation_token": "wrong-token",
        },
    ), started_run_ids


def test_invalid_recipe_run_confirmation_uses_recipe_error_contract(
    client,
    app_modules,
    monkeypatch,
) -> None:
    workflow = _recipe_workflow()
    workflow["workflow_id"] = "workflow-recipe-confirmation-error"
    workflow["nodes"][0]["fields"] = {
        "recipe_id": "prompt-recipe-image-prompt-director",
        "user_prompt": "Create a cinematic portrait prompt.",
        "style_direction": "cinematic realism",
        "aspect_ratio": "16:9",
        "provider": "openrouter",
        "model_id": "openai/gpt-4o-mini",
        "provider_supports_images": True,
    }
    response, started_run_ids = _invalid_confirmation_response(
        client,
        app_modules,
        monkeypatch,
        workflow=workflow,
        confirmation_kind="recipe",
    )

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "recipe_confirmation_invalid"
    assert started_run_ids == []


def test_invalid_graph_run_confirmation_keeps_existing_error_contract(
    client,
    app_modules,
    monkeypatch,
) -> None:
    workflow = {
        "schema_version": 1,
        "workflow_id": "workflow-graph-confirmation-error",
        "name": "Graph confirmation error",
        "nodes": [],
        "edges": [],
        "metadata": {},
    }
    response, started_run_ids = _invalid_confirmation_response(
        client,
        app_modules,
        monkeypatch,
        workflow=workflow,
        confirmation_kind="graph",
    )

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "preset_test_confirmation_invalid"
    assert started_run_ids == []
