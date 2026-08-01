from __future__ import annotations

import importlib
import json


def _session(client):
    return client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "standalone", "provider_kind": "codex_local"},
    ).json()


def _context(tools, session, evidence=None):
    return tools.KernelToolContext(
        workflow=None,
        canvas_context={},
        session_id=session["assistant_session_id"],
        session=session,
        tool_evidence=evidence or [],
        user_text="Plan an approximately 45-second sequence.",
    )


def _plan():
    return {
        "goal": "Produce a 45-second derelict-ship sequence.",
        "constraints": [
            {"name": "target_duration_seconds", "value": 45, "source": "user_request"},
            {
                "name": "clip_max_seconds",
                "value": 15,
                "source": "model_catalog",
                "model_key": "seedance-2.0",
                "catalog_path": "generation_constraints.duration_seconds.max",
            },
            {
                "name": "minimum_clip_count",
                "value": 3,
                "source": "derived",
                "derived_from": ["target_duration_seconds", "clip_max_seconds"],
                "operator": "ceil_divide",
            },
        ],
        "steps": [
            {"id": "characters", "kind": "character_sheet", "title": "Lock the crew", "status": "ready"},
            {"id": "environment", "kind": "environment_sheet", "title": "Lock the ship"},
            {
                "id": "storyboard",
                "kind": "storyboard",
                "title": "Plan the story beats",
                "depends_on": ["characters", "environment"],
            },
            {"id": "graph", "kind": "graph", "title": "Build the graph", "depends_on": ["storyboard"]},
            {"id": "run", "kind": "run", "title": "Generate clips", "depends_on": ["graph"]},
            {"id": "stitch", "kind": "stitch", "title": "Assemble the sequence", "depends_on": ["run"]},
        ],
    }


def _evidence():
    return [
        {
            "models": [
                {
                    "model_key": "seedance-2.0",
                    "generation_constraints": {"duration_seconds": {"min": 4, "max": 15}},
                }
            ]
        }
    ]


def test_production_plan_persists_and_reads_from_session(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    session = _session(client)

    proposed = tools.execute_kernel_tool(
        tool_name="propose_production_plan",
        arguments=json.dumps({"plan": _plan()}),
        capability="story_builder",
        context=_context(tools, session, _evidence()),
    )
    read_back = tools.execute_kernel_tool(
        tool_name="read_production_plan",
        arguments="{}",
        capability="story_builder",
        context=_context(tools, session),
    )
    refreshed = client.get(f"/media/assistant/sessions/{session['assistant_session_id']}")

    assert proposed.trace.error is None
    assert proposed.result["plan"]["constraints"][0]["value"] == 45
    assert read_back.result == {"exists": True, "plan": proposed.result["plan"]}
    assert refreshed.status_code == 200
    assert refreshed.json()["production_plan"] == proposed.result["plan"]


def test_production_plan_rejects_duplicate_and_missing_step_ids(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    session = _session(client)
    plan = _plan()
    plan["steps"][1]["id"] = "characters"
    duplicate = tools.execute_kernel_tool(
        tool_name="propose_production_plan",
        arguments=json.dumps({"plan": plan}),
        capability="story_builder",
        context=_context(tools, session, _evidence()),
    )
    plan = _plan()
    plan["steps"][2]["depends_on"] = ["missing"]
    missing = tools.execute_kernel_tool(
        tool_name="propose_production_plan",
        arguments=json.dumps({"plan": plan}),
        capability="story_builder",
        context=_context(tools, session, _evidence()),
    )

    assert duplicate.trace.error.code == "production_step_duplicate"
    assert missing.trace.error.code == "production_step_dependency_missing"


def test_production_plan_rejects_cycles_and_ungrounded_numbers(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    session = _session(client)
    plan = _plan()
    plan["steps"][0]["depends_on"] = ["storyboard"]
    cycle = tools.execute_kernel_tool(
        tool_name="propose_production_plan",
        arguments=json.dumps({"plan": plan}),
        capability="story_builder",
        context=_context(tools, session, _evidence()),
    )
    plan = _plan()
    plan["constraints"][1]["value"] = 12
    ungrounded = tools.execute_kernel_tool(
        tool_name="propose_production_plan",
        arguments=json.dumps({"plan": plan}),
        capability="story_builder",
        context=_context(tools, session, _evidence()),
    )

    assert cycle.trace.error.code == "production_step_dependency_cycle"
    assert ungrounded.trace.error.code == "production_constraint_ungrounded"


def test_production_plan_rejects_number_not_present_in_user_request(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    session = _session(client)
    plan = _plan()
    plan["constraints"][0]["value"] = 90

    ungrounded = tools.execute_kernel_tool(
        tool_name="propose_production_plan",
        arguments=json.dumps({"plan": plan}),
        capability="story_builder",
        context=_context(tools, session, _evidence()),
    )

    assert ungrounded.trace.error.code == "production_constraint_ungrounded"


def test_production_plan_rejects_unsupported_status(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    session = _session(client)
    plan = _plan()
    plan["steps"][0]["status"] = "blocked"

    invalid = tools.execute_kernel_tool(
        tool_name="propose_production_plan",
        arguments=json.dumps({"plan": plan}),
        capability="story_builder",
        context=_context(tools, session, _evidence()),
    )

    assert invalid.trace.error.code == "invalid_tool_arguments"


def test_production_plan_intent_requires_grounded_artifact(client, monkeypatch) -> None:
    kernel = importlib.import_module("app.assistant.kernel")
    session = _session(client)
    steps = iter(
        [
            {
                "capability": "story_builder",
                "artifact_intent": "propose_production_plan",
                "tool_call": {
                    "name": "list_media_models",
                    "arguments": {"mode": "video", "model_key": "seedance-2.0"},
                },
            },
            {
                "capability": "story_builder",
                "artifact_intent": "propose_production_plan",
                "tool_call": {
                    "name": "propose_production_plan",
                    "arguments": {"plan": _plan()},
                },
            },
            {
                "capability": "story_builder",
                "artifact_intent": "propose_production_plan",
                "reply": "The production checklist is ready.",
            },
        ]
    )
    monkeypatch.setattr(kernel, "run_kernel_provider_step", lambda **_kwargs: next(steps))

    result = kernel.run_assistant_kernel_turn(
        session=session,
        user_text="Plan a 45-second salvage-crew sequence from references through final assembly.",
        workflow=None,
        canvas_context={},
        assistant_mode="graph",
    )

    assert result.capability == "story_builder"
    assert [trace.tool_name for trace in result.trace.tool_calls] == [
        "list_media_models",
        "propose_production_plan",
    ]
    assert result.trace.tool_calls[0].evidence["models"][0]["model_key"] == "seedance-2.0"
    assert any(artifact.kind == "production_plan" for artifact in result.artifacts)
