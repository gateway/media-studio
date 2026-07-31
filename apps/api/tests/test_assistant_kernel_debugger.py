from __future__ import annotations

import importlib


def _large_workflow(workflow):
    return {
        **workflow,
        "nodes": [
            {
                **node,
                "fields": {
                    **node.get("fields", {}),
                    "diagnostic_blob": "context " * 40_000,
                },
            }
            for node in workflow["nodes"]
        ],
    }


def _failed_run(app_modules):
    store = app_modules["store"]
    workflow = {
        "schema_version": 1,
        "workflow_id": "workflow-kernel-debugger",
        "name": "Debugger workflow",
        "nodes": [
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 80, "y": 100},
                "fields": {"text": ""},
                "metadata": {"ui": {"customTitle": "Storyboard Prompt"}},
            }
        ],
        "edges": [],
        "metadata": {},
    }
    store.create_or_update_graph_workflow(
        {
            "workflow_id": workflow["workflow_id"],
            "name": workflow["name"],
            "workflow_json": workflow,
        }
    )
    run = store.create_graph_run(
        {
            "run_id": "run-kernel-debugger-failed",
            "workflow_id": workflow["workflow_id"],
            "status": "failed",
            "error": "Storyboard preflight failed: panel sequence is empty; expected [1, 2, 3, 4, 5, 6].",
            "workflow_json": workflow,
        },
        [
            {
                "node_id": "prompt",
                "node_type": "prompt.text",
                "status": "failed",
                "error": "Panel sequence is empty.",
                "metrics_json": {"attempt": 1},
            }
        ],
    )
    store.append_graph_run_event(
        run["run_id"],
        "node.failed",
        {"error": "Panel sequence is empty.", "status": "failed"},
        node_id="prompt",
    )
    return workflow, run


def _session(client, workflow):
    return client.post(
        "/media/assistant/sessions",
        json={
            "owner_kind": "graph_workflow",
            "owner_id": workflow["workflow_id"],
            "workflow": workflow,
            "provider_kind": "codex_local",
        },
    ).json()


def test_debugger_diagnosis_requires_typed_failed_run_evidence(
    client,
    app_modules,
    monkeypatch,
) -> None:
    kernel = importlib.import_module("app.assistant.kernel")
    workflow, run = _failed_run(app_modules)
    session = _session(client, workflow)
    steps = iter(
        [
            {"capability": "run_debugger", "reply": "I need the run evidence."},
            {
                "capability": "run_debugger",
                "tool_call": {"name": "read_run_evidence", "arguments": {"run_id": run["run_id"]}},
            },
            {
                "capability": "run_debugger",
                "reply": "The storyboard prompt failed before generation because its panel sequence was empty.",
            },
        ]
    )
    monkeypatch.setattr(kernel, "run_kernel_provider_step", lambda **_kwargs: next(steps))

    response = client.post(
        f"/media/assistant/sessions/{session['assistant_session_id']}/messages",
        json={"content_text": "It failed, what happened?", "workflow": workflow},
    )

    assert response.status_code == 200, response.text
    turn = response.json()["messages"][-1]["content_json"]["kernel_turn"]
    evidence = next(item["data"] for item in turn["artifacts"] if item["kind"] == "run_evidence")
    assert turn["capability"] == "run_debugger"
    assert turn["next_action"]["kind"] == "none"
    assert evidence["run"]["run_id"] == run["run_id"]
    assert evidence["run"]["status"] == "failed"
    assert evidence["failed_nodes"][0]["node_id"] == "prompt"
    assert evidence["events"][-1]["event_type"] == "node.failed"
    assert turn["trace"]["tool_calls"][0].get("error") is None


def test_debugger_fix_is_validated_priced_and_confirmation_gated(
    client,
    app_modules,
    monkeypatch,
) -> None:
    kernel = importlib.import_module("app.assistant.kernel")
    workflow, run = _failed_run(app_modules)
    session = _session(client, workflow)
    steps = iter(
        [
            {
                "capability": "run_debugger",
                "tool_call": {"name": "read_run_evidence", "arguments": {"run_id": run["run_id"]}},
            },
            {
                "capability": "run_debugger",
                "reply": "I prepared the smallest validated correction for confirmation.",
                "tool_call": {
                    "name": "propose_graph_operations",
                    "arguments": {
                        "summary": "Supply the missing six-panel sequence.",
                        "operations": [
                            {
                                "op": "set_node_field",
                                "node_id": "prompt",
                                "fields": {
                                    "text": (
                                        "Create six sequential storyboard panels numbered 1 through 6, "
                                        "each with a complete visual description."
                                    )
                                },
                            }
                        ],
                    },
                },
            },
        ]
    )
    monkeypatch.setattr(kernel, "run_kernel_provider_step", lambda **_kwargs: next(steps))

    response = client.post(
        f"/media/assistant/sessions/{session['assistant_session_id']}/messages",
        json={"content_text": "Can you fix it?", "workflow": workflow},
    )

    assert response.status_code == 200, response.text
    turn = response.json()["messages"][-1]["content_json"]["kernel_turn"]
    proposal = next(item["data"] for item in turn["artifacts"] if item["kind"] == "graph_proposal")
    assert proposal["validation"]["valid"] is True
    assert proposal["pricing"]["pricing_summary"]["pricing_status"]
    assert "warnings" in proposal["pricing"]
    assert turn["next_action"]["kind"] == "confirm_graph"
    assert turn["next_action"]["requires_confirmation"] is True
    assert turn["next_action"]["confirmation_token"]
    assert app_modules["store"].get_graph_run(run["run_id"])["status"] == "failed"


def test_debugger_uses_selected_run_when_tool_arguments_omit_run_id(
    client,
    app_modules,
    monkeypatch,
) -> None:
    kernel = importlib.import_module("app.assistant.kernel")
    workflow, selected_run = _failed_run(app_modules)
    app_modules["store"].create_graph_run(
        {
            "run_id": "run-kernel-debugger-newer",
            "workflow_id": workflow["workflow_id"],
            "status": "failed",
            "error": "A different failure.",
        },
        [],
    )
    session = _session(client, workflow)
    steps = iter(
        [
            {
                "capability": "run_debugger",
                "tool_call": {"name": "read_run_evidence", "arguments": {}},
            },
            {
                "capability": "run_debugger",
                "reply": "The selected run failed before generation.",
            },
        ]
    )
    monkeypatch.setattr(kernel, "run_kernel_provider_step", lambda **_kwargs: next(steps))

    response = client.post(
        f"/media/assistant/sessions/{session['assistant_session_id']}/messages",
        json={
            "content_text": "It failed, what happened?",
            "workflow": workflow,
            "run_id": selected_run["run_id"],
        },
    )

    assert response.status_code == 200, response.text
    turn = response.json()["messages"][-1]["content_json"]["kernel_turn"]
    evidence = next(item["data"] for item in turn["artifacts"] if item["kind"] == "run_evidence")
    assert evidence["run"]["run_id"] == selected_run["run_id"]


def test_large_workflow_read_falls_back_to_bounded_topology(
    app_modules,
) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    workflow, _run = _failed_run(app_modules)
    graph_schemas = importlib.import_module("app.graph.schemas")
    execution = tools.execute_kernel_tool(
        tool_name="read_current_workflow",
        arguments={"include_fields": True},
        capability="run_debugger",
        context=tools.KernelToolContext(
            workflow=graph_schemas.GraphWorkflow.model_validate(_large_workflow(workflow)),
            canvas_context={},
        ),
    )

    assert execution.trace.error is None
    assert execution.result is not None
    assert execution.result["field_values_omitted"] is True
    assert execution.result["nodes"][0]["field_names"] == ["diagnostic_blob", "text"]


def test_run_evidence_uses_the_workflow_snapshot_persisted_with_the_run(
    app_modules,
) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    workflow, run = _failed_run(app_modules)
    changed_workflow = {
        **workflow,
        "nodes": [
            {
                **workflow["nodes"][0],
                "fields": {"text": "Changed after the failed run."},
            }
        ],
    }
    app_modules["store"].create_or_update_graph_workflow(
        {
            "workflow_id": workflow["workflow_id"],
            "name": workflow["name"],
            "workflow_json": changed_workflow,
        }
    )

    execution = tools.execute_kernel_tool(
        tool_name="read_run_evidence",
        arguments={"run_id": run["run_id"]},
        capability="run_debugger",
        context=tools.KernelToolContext(workflow=None, canvas_context={}),
    )

    assert execution.trace.error is None
    assert execution.result is not None
    assert execution.result["workflow"]["failed_nodes"][0]["fields"]["text"] == ""


def test_unknown_selected_run_does_not_fall_back_to_another_failure(
    app_modules,
) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    workflow, _run = _failed_run(app_modules)

    execution = tools.execute_kernel_tool(
        tool_name="read_run_evidence",
        arguments={"run_id": "missing-selected-run"},
        capability="run_debugger",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={"workflow_id": workflow["workflow_id"]},
        ),
    )

    assert execution.result is None
    assert execution.trace.error is not None
    assert execution.trace.error.code == "selected_run_not_found"
