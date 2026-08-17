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
                "fields": {"recipe_id": "prompt-recipe-image-prompt-director"},
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


def _session(client, app_modules, workflow: dict, run_id: str) -> dict:
    store_assistant = app_modules["store_assistant"]
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
    provenance = importlib.import_module("app.assistant.provenance")
    recipe_id = workflow["nodes"][0]["fields"]["recipe_id"]
    recipe = app_modules["store"].get_prompt_recipe(recipe_id)
    plan = store_assistant.create_or_update_assistant_plan(
        {
            "assistant_session_id": session["assistant_session_id"],
            "status": "applied",
            "capability": "recipe_builder",
            "plan_json": {
                "metadata": {
                    "kernel_proposal": True,
                    "template_id": "saved_recipe_image_v1",
                    "template_recipe_id": recipe_id,
                    "recipe_quality_contract_hash": provenance.recipe_quality_contract_hash(recipe),
                }
            },
            "validation_json": {"valid": True, "errors": [], "warnings": []},
            "pricing_json": {},
            "workflow_json": workflow,
            "applied_workflow_id": workflow["workflow_id"],
        }
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
                "kernel_recipe_run_association": {
                    "assistant_session_id": session["assistant_session_id"],
                    "recipe_plan_id": plan["assistant_plan_id"],
                    "recipe_id": recipe_id,
                    "recipe_quality_contract_hash": provenance.recipe_quality_contract_hash(recipe),
                    "workflow_fingerprint": fingerprint,
                    "confirmation_token_hash": "confirmation-hash",
                    "run_id": run_id,
                    "eligible_model_node_ids": ["recipe-model"],
                    "associated_at": store_assistant.utcnow_iso(),
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
        [
            {
                "node_id": "recipe-prompt",
                "node_type": "prompt.recipe",
                "status": "completed",
                "input_snapshot_json": {
                    "recipe_id": workflow["nodes"][0]["fields"]["recipe_id"]
                },
            },
            {
                "node_id": "recipe-model",
                "node_type": "model.kie.gpt_image_2_text_to_image",
                "status": "completed",
            },
            *(
                [
                    {
                        "node_id": node_id,
                        "node_type": "model.kie.gpt_image_2_text_to_image",
                        "status": "completed",
                    }
                ]
                if node_id != "recipe-model"
                else []
            ),
        ],
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
        app_modules,
        workflow,
        run["run_id"],
    )

    execution = _read_recipe_run(tools, workflow, session, run["run_id"])

    assert execution.trace.error is None
    assert execution.result["recipe_run"] == {
        "assistant_session_id": session["assistant_session_id"],
        "recipe_plan_id": session["summary_json"]["kernel_recipe_run_association"]["recipe_plan_id"],
        "recipe_id": "prompt-recipe-image-prompt-director",
        "recipe_quality_contract_hash": session["summary_json"]["kernel_recipe_run_association"]["recipe_quality_contract_hash"],
        "run_id": run["run_id"],
        "workflow_fingerprint": session["summary_json"]["kernel_run_confirmation"]["workflow_fingerprint"],
        "status": "completed",
        "eligible_model_node_ids": ["recipe-model"],
        "output_asset_ids": ["asset-run-recipe-evidence"],
    }
    stored = app_modules["store_assistant"].get_assistant_session(session["assistant_session_id"])
    assert stored["summary_json"]["kernel_recipe_run_evidence"] == execution.result["recipe_run"]
    context = importlib.import_module("app.assistant.kernel")._kernel_session_context(stored)
    assert context["active_recipe_run_evidence"] == execution.result["recipe_run"]


def test_recipe_confirmation_settles_first_persisted_identity_without_accepting_edits(
    client,
    app_modules,
    monkeypatch,
) -> None:
    graph_routes = importlib.import_module("app.graph.routes")
    provenance = importlib.import_module("app.assistant.provenance")
    graph_schemas = importlib.import_module("app.graph.schemas")
    workflow = _recipe_workflow()
    workflow.pop("workflow_id")
    workflow["nodes"][0]["fields"]["recipe_id"] = app_modules["store"].list_prompt_recipes(
        status="active"
    )[0]["recipe_id"]
    workflow["nodes"][0]["fields"]["user_prompt"] = "A quiet harbor"
    workflow["nodes"][1]["metadata"] = {
        "execution": {
            "mode": "enabled",
            "cached_run_id": "run-prior-result",
            "cached_artifact_ids": {"image": ["asset-prior-result"]},
        }
    }
    unsaved_fingerprint = provenance.workflow_fingerprint(
        graph_schemas.GraphWorkflow.model_validate(workflow)
    )

    def confirmed_session() -> dict:
        session = client.post(
            "/media/assistant/sessions",
            json={"owner_kind": "standalone", "provider_kind": "codex_local"},
        ).json()
        plan_workflow = json.loads(json.dumps(workflow))
        plan_workflow["metadata"]["assistant_plan"] = {
            "kernel_proposal": True,
            "template_id": "saved_recipe_image_v1",
        }
        plan_workflow["nodes"][0]["metadata"] = {
            "assistant": {"semantic_ref": "recipe_prompt"}
        }
        plan_workflow["nodes"][1]["metadata"] = {
            "execution": {"mode": "enabled"}
        }
        plan = app_modules["store_assistant"].create_or_update_assistant_plan(
            {
                "assistant_session_id": session["assistant_session_id"],
                "status": "applied",
                "capability": "graph_builder",
                "plan_json": {
                        "metadata": {
                            "kernel_proposal": True,
                            "template_id": "saved_recipe_image_v1",
                            "template_recipe_id": workflow["nodes"][0]["fields"]["recipe_id"],
                        }
                },
                "validation_json": {"valid": True, "errors": [], "warnings": []},
                "pricing_json": {},
                "workflow_json": plan_workflow,
            }
        )
        return app_modules["store_assistant"].create_or_update_assistant_session(
            {
                **session,
                "summary_json": {
                    "kernel_capability": "graph_builder",
                    "kernel_proposal_id": plan["assistant_plan_id"],
                    "kernel_run_confirmation": {
                        "confirmation_token_hash": hashlib.sha256(b"settle-token").hexdigest(),
                        "workflow_fingerprint": unsaved_fingerprint,
                        "confirmation_kind": "recipe",
                        "recipe_plan_id": plan["assistant_plan_id"],
                        "consumed": False,
                    },
                },
            }
        )

    saved = client.post("/media/graph/workflows", json=workflow)
    assert saved.status_code == 200, saved.text
    workflow_id = saved.json()["workflow_id"]
    persisted_workflow = {**workflow, "workflow_id": workflow_id}
    started_run_ids = []
    monkeypatch.setattr(graph_routes.runtime, "start_run", started_run_ids.append)

    session = confirmed_session()
    started = client.post(
        f"/media/graph/workflows/{workflow_id}/runs",
        json={
            "workflow": persisted_workflow,
            "assistant_session_id": session["assistant_session_id"],
            "assistant_confirmation_token": "settle-token",
        },
    )

    assert started.status_code == 200, started.text
    assert started_run_ids == [started.json()["run_id"]]
    stored = app_modules["store_assistant"].get_assistant_session(
        session["assistant_session_id"]
    )
    confirmation = stored["summary_json"]["kernel_run_confirmation"]
    assert confirmation["consumed"] is True
    assert confirmation["assistant_run_id"] == started.json()["run_id"]
    assert confirmation["workflow_fingerprint"] == provenance.workflow_fingerprint(
        graph_schemas.GraphWorkflow.model_validate(persisted_workflow)
    )
    association = stored["summary_json"]["kernel_recipe_run_association"]
    assert association["assistant_session_id"] == session["assistant_session_id"]
    assert association["recipe_plan_id"] == confirmation["recipe_plan_id"]
    assert association["recipe_id"] == workflow["nodes"][0]["fields"]["recipe_id"]
    assert association["run_id"] == started.json()["run_id"]
    assert association["eligible_model_node_ids"] == ["recipe-model"]
    assert association["recipe_quality_contract_hash"]
    plan = app_modules["store_assistant"].get_assistant_plan(
        confirmation["recipe_plan_id"]
    )
    assert plan["applied_workflow_id"] == workflow_id

    changed_workflow = json.loads(json.dumps(persisted_workflow))
    changed_workflow["nodes"][0]["fields"]["user_prompt"] = "A different harbor"
    changed_session = confirmed_session()
    rejected = client.post(
        f"/media/graph/workflows/{workflow_id}/runs",
        json={
            "workflow": changed_workflow,
            "assistant_session_id": changed_session["assistant_session_id"],
            "assistant_confirmation_token": "settle-token",
        },
    )

    assert rejected.status_code == 400
    assert rejected.json()["detail"]["code"] == "workflow_fingerprint_mismatch"

    copied = client.post("/media/graph/workflows", json=workflow)
    assert copied.status_code == 200, copied.text
    copied_workflow_id = copied.json()["workflow_id"]
    copied_workflow = {**workflow, "workflow_id": copied_workflow_id}
    app_modules["store_assistant"].create_or_update_assistant_session(
        {
            **stored,
            "summary_json": {
                **stored["summary_json"],
                "kernel_run_confirmation": {
                    **confirmation,
                    "confirmation_token_hash": hashlib.sha256(b"copy-token").hexdigest(),
                    "workflow_fingerprint": unsaved_fingerprint,
                    "assistant_run_id": None,
                    "consumed": False,
                },
            },
        }
    )
    rejected_copy = client.post(
        f"/media/graph/workflows/{copied_workflow_id}/runs",
        json={
            "workflow": copied_workflow,
            "assistant_session_id": session["assistant_session_id"],
            "assistant_confirmation_token": "copy-token",
        },
    )

    assert rejected_copy.status_code == 400
    assert rejected_copy.json()["detail"]["code"] == "workflow_fingerprint_mismatch"


def test_recipe_run_confirmation_requires_the_session_applied_recipe_plan(
    client,
    app_modules,
    monkeypatch,
) -> None:
    graph_routes = importlib.import_module("app.graph.routes")
    graph_schemas = importlib.import_module("app.graph.schemas")
    provenance = importlib.import_module("app.assistant.provenance")
    workflow = _recipe_workflow()
    workflow["nodes"][0]["fields"]["recipe_id"] = app_modules["store"].list_prompt_recipes(
        status="active"
    )[0]["recipe_id"]
    workflow["nodes"][0]["fields"]["user_prompt"] = "A quiet harbor"
    session = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "standalone", "provider_kind": "codex_local"},
    ).json()
    app_modules["store_assistant"].create_or_update_assistant_session(
        {
            **session,
            "summary_json": {
                "kernel_capability": "recipe_builder",
                "kernel_run_confirmation": {
                    "confirmation_token_hash": hashlib.sha256(b"no-plan-token").hexdigest(),
                    "workflow_fingerprint": provenance.workflow_fingerprint(
                        graph_schemas.GraphWorkflow.model_validate(workflow)
                    ),
                    "confirmation_kind": "recipe",
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

    rejected = client.post(
        f"/media/graph/workflows/{workflow['workflow_id']}/runs",
        json={
            "workflow": workflow,
            "assistant_session_id": session["assistant_session_id"],
            "assistant_confirmation_token": "no-plan-token",
        },
    )

    assert rejected.status_code == 400
    assert rejected.json()["detail"]["code"] == "workflow_fingerprint_mismatch"
    assert started_run_ids == []


def test_recipe_run_evidence_rejects_older_matching_run(client, app_modules) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    workflow = _recipe_workflow()
    associated = _completed_run(app_modules["store"], workflow, "run-current-recipe")
    older = _completed_run(app_modules["store"], workflow, "run-older-recipe")
    session = _session(
        client,
        app_modules,
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
    session = _session(client, app_modules, workflow, run["run_id"])

    execution = _read_recipe_run(tools, workflow, session, run["run_id"])

    assert execution.result is None
    assert execution.trace.error.code == "recipe_output_missing"
    stored = app_modules["store_assistant"].get_assistant_session(session["assistant_session_id"])
    assert "kernel_recipe_run_evidence" not in stored["summary_json"]


def test_completed_recipe_run_can_relink_only_from_exact_persisted_evidence(
    client,
    app_modules,
) -> None:
    run_confirmation = importlib.import_module("app.assistant.run_confirmation")
    workflow = _recipe_workflow()
    run = _completed_run(app_modules["store"], workflow, "run-recipe-safe-relink")
    session = _session(client, app_modules, workflow, run["run_id"])
    linked = run_confirmation.bind_completed_recipe_run(
        session["assistant_session_id"], run
    )
    stored = app_modules["store_assistant"].get_assistant_session(
        session["assistant_session_id"]
    )
    summary = dict(stored["summary_json"])
    summary.pop("kernel_recipe_run_association")
    summary["kernel_recipe_run_evidence"] = {
        key: linked[key]
        for key in (
            "assistant_session_id",
            "run_id",
            "workflow_fingerprint",
            "status",
            "output_asset_ids",
        )
    }
    app_modules["store_assistant"].create_or_update_assistant_session(
        {**stored, "summary_json": summary}
    )

    relinked = run_confirmation.bind_completed_recipe_run(
        session["assistant_session_id"], run
    )

    assert relinked["recipe_plan_id"]
    assert relinked["recipe_id"] == "prompt-recipe-image-prompt-director"
    repaired = app_modules["store_assistant"].get_assistant_session(
        session["assistant_session_id"]
    )["summary_json"]["kernel_recipe_run_association"]
    assert repaired["relinked_from_completed_evidence"] is True


def test_recipe_quality_contract_ignores_name_only_changes_and_rejects_creative_changes(
    client,
    app_modules,
) -> None:
    run_confirmation = importlib.import_module("app.assistant.run_confirmation")
    workflow = _recipe_workflow()
    run = _completed_run(app_modules["store"], workflow, "run-recipe-contract")
    session = _session(client, app_modules, workflow, run["run_id"])
    recipe_id = workflow["nodes"][0]["fields"]["recipe_id"]
    recipe = app_modules["store"].get_prompt_recipe(recipe_id)

    app_modules["store"].create_or_update_prompt_recipe(
        {**recipe, "label": "Renamed recipe"}
    )
    assert run_confirmation.bind_completed_recipe_run(
        session["assistant_session_id"], run
    )["recipe_id"] == recipe_id

    renamed = app_modules["store"].get_prompt_recipe(recipe_id)
    app_modules["store"].create_or_update_prompt_recipe(
        {**renamed, "system_prompt_template": "A changed creative contract {{user_prompt}}"}
    )
    try:
        run_confirmation.bind_completed_recipe_run(session["assistant_session_id"], run)
    except run_confirmation.RunEvidenceError as exc:
        assert exc.code == "recipe_workflow_mismatch"
    else:
        raise AssertionError("A changed recipe contract must invalidate run evidence")


def test_recipe_quality_approval_persists_the_exact_run_contract(
    client,
    app_modules,
) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    workflow = _recipe_workflow()
    run = _completed_run(app_modules["store"], workflow, "run-recipe-quality")
    session = _session(client, app_modules, workflow, run["run_id"])
    evidence = importlib.import_module(
        "app.assistant.run_confirmation"
    ).bind_completed_recipe_run(session["assistant_session_id"], run)
    stored = app_modules["store_assistant"].get_assistant_session(
        session["assistant_session_id"]
    )
    comparison = {
        "comparison_id": "recipecmp-quality",
        "run_id": run["run_id"],
        "output_asset_id": evidence["output_asset_ids"][0],
        "reference_ids": ["reference-travel-one", "reference-travel-two"],
        "comparison": {
            "matches": ["layered paper shapes"],
            "missing_or_drifting": [],
            "prompt_delta": "",
            "preserve_traits": ["layered paper shapes"],
            "meaningful_gap": False,
        },
        "quality_state": "reviewed",
    }
    session = app_modules["store_assistant"].create_or_update_assistant_session(
        {
            **stored,
            "summary_json": {
                **stored["summary_json"],
                "kernel_recipe_output_comparison": comparison,
            },
        }
    )

    execution = tools.execute_kernel_tool(
        tool_name="record_recipe_quality_decision",
        arguments={"decision": "approve"},
        capability="recipe_builder",
        context=tools.KernelToolContext(
            workflow=tools.GraphWorkflow.model_validate(workflow),
            canvas_context={},
            user_text="That result is good enough; approve it.",
            session_id=session["assistant_session_id"],
            session=session,
        ),
    )

    assert execution.trace.error is None
    assert execution.result["quality_state"] == "quality_verified"
    assert execution.result["recipe_plan_id"] == evidence["recipe_plan_id"]
    assert execution.result["recipe_id"] == evidence["recipe_id"]
    assert execution.result["workflow_fingerprint"] == evidence["workflow_fingerprint"]
    assert execution.result["run_id"] == run["run_id"]
    assert execution.result["output_asset_id"] == evidence["output_asset_ids"][0]
    assert execution.result["eligible_model_node_ids"] == ["recipe-model"]
    saved_quality = app_modules["store_assistant"].get_assistant_session(
        session["assistant_session_id"]
    )["summary_json"]["kernel_recipe_quality"]
    assert saved_quality == execution.result


def test_recipe_draft_revision_invalidates_quality_but_name_only_revision_preserves_it(
    client,
    app_modules,
) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    workflow = _recipe_workflow()
    run = _completed_run(app_modules["store"], workflow, "run-recipe-revision")
    session = _session(client, app_modules, workflow, run["run_id"])
    evidence = importlib.import_module(
        "app.assistant.run_confirmation"
    ).bind_completed_recipe_run(session["assistant_session_id"], run)
    recipe = app_modules["store"].get_prompt_recipe(evidence["recipe_id"])
    session = app_modules["store_assistant"].get_assistant_session(
        session["assistant_session_id"]
    )
    session = app_modules["store_assistant"].create_or_update_assistant_session(
        {
            **session,
            "summary_json": {
                **session["summary_json"],
                "kernel_recipe_draft": recipe,
                "kernel_recipe_output_comparison": {"comparison_id": "comparison-revision"},
                "kernel_recipe_quality": {"quality_state": "quality_verified"},
            },
        }
    )

    renamed = tools.execute_kernel_tool(
        tool_name="propose_prompt_recipe_draft",
        arguments={
            "draft": {**recipe, "label": "Renamed recipe draft"},
            "existing_recipe_id": evidence["recipe_id"],
        },
        capability="recipe_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            artifact_intent="revise_recipe",
            session_id=session["assistant_session_id"],
            session=session,
        ),
    )
    assert renamed.trace.error is None
    after_rename = app_modules["store_assistant"].get_assistant_session(
        session["assistant_session_id"]
    )
    assert after_rename["summary_json"]["kernel_recipe_run_evidence"] == evidence
    assert after_rename["summary_json"]["kernel_recipe_quality"]["quality_state"] == "quality_verified"

    revised = tools.execute_kernel_tool(
        tool_name="propose_prompt_recipe_draft",
        arguments={
            "draft": {
                **renamed.result["draft"],
                "system_prompt_template": "A revised visual contract {{user_prompt}}",
            },
            "existing_recipe_id": evidence["recipe_id"],
        },
        capability="recipe_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            artifact_intent="revise_recipe",
            session_id=session["assistant_session_id"],
            session=after_rename,
        ),
    )

    assert revised.trace.error is None
    after_revision = app_modules["store_assistant"].get_assistant_session(
        session["assistant_session_id"]
    )["summary_json"]
    assert "kernel_recipe_run_association" not in after_revision
    assert "kernel_recipe_run_evidence" not in after_revision
    assert "kernel_recipe_output_comparison" not in after_revision
    assert "kernel_recipe_quality" not in after_revision


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
