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


def _propose(tools, session):
    return tools.execute_kernel_tool(
        tool_name="propose_production_plan",
        arguments=json.dumps({"plan": _plan()}),
        capability="story_builder",
        context=_context(tools, session, _evidence()),
    )


def _add_story_state(store_assistant, session):
    current = store_assistant.get_assistant_session(session["assistant_session_id"])
    summary = dict(current.get("summary_json") or {})
    summary["kernel_story_state"] = {"version": 1, "premise": "A salvage crew enters a derelict ship."}
    return store_assistant.create_or_update_assistant_session({**current, "summary_json": summary})


def _complete_story_steps(tools, store_assistant, session):
    refreshed = _add_story_state(store_assistant, session)
    for step_id in ("characters", "environment", "storyboard"):
        update = tools.execute_kernel_tool(
            tool_name="update_production_plan_step",
            arguments=json.dumps(
                {
                    "step_id": step_id,
                    "updates": {"status": "done", "artifact_ref": "story_state"},
                }
            ),
            capability="story_builder",
            context=_context(tools, refreshed),
        )
        assert update.trace.error is None
        refreshed = store_assistant.get_assistant_session(session["assistant_session_id"])
    return refreshed


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


def test_production_plan_proposal_cannot_claim_unfinished_work(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    session = _session(client)
    plan = _plan()
    plan["steps"][0]["status"] = "done"
    false_done = tools.execute_kernel_tool(
        tool_name="propose_production_plan",
        arguments=json.dumps({"plan": plan}),
        capability="story_builder",
        context=_context(tools, session, _evidence()),
    )
    plan = _plan()
    plan["steps"][0]["status"] = "skipped"
    untraced_skip = tools.execute_kernel_tool(
        tool_name="propose_production_plan",
        arguments=json.dumps({"plan": plan}),
        capability="story_builder",
        context=_context(tools, session, _evidence()),
    )

    assert false_done.trace.error.code == "production_step_artifact_required"
    assert untraced_skip.trace.error.code == "production_step_skip_reason_required"


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


def test_production_plan_step_update_preserves_unrelated_steps(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    store_assistant = importlib.import_module("app.store_assistant")
    session = _session(client)
    before = _propose(tools, session).result["plan"]
    refreshed = _add_story_state(store_assistant, session)

    updated = tools.execute_kernel_tool(
        tool_name="update_production_plan_step",
        arguments=json.dumps(
            {
                "step_id": "characters",
                "updates": {"status": "done", "artifact_ref": "story_state"},
            }
        ),
        capability="story_builder",
        context=_context(tools, refreshed),
    )

    assert updated.trace.error is None
    assert updated.result["changed_step_id"] == "characters"
    assert updated.result["plan"]["steps"][0]["status"] == "done"
    assert updated.result["plan"]["steps"][0]["artifact_ref"] == "story_state"
    assert updated.result["plan"]["steps"][1:] == before["steps"][1:]


def test_production_plan_progress_requires_finished_dependencies(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    session = _session(client)
    _propose(tools, session)

    blocked = tools.execute_kernel_tool(
        tool_name="update_production_plan_step",
        arguments=json.dumps({"step_id": "storyboard", "updates": {"status": "in_progress"}}),
        capability="story_builder",
        context=_context(tools, session),
    )

    assert blocked.trace.error.code == "production_step_dependency_blocked"
    assert blocked.trace.error.details["blocking_step_ids"] == ["characters", "environment"]


def test_production_plan_skip_is_explicit_and_traceable(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    store_assistant = importlib.import_module("app.store_assistant")
    session = _session(client)
    _propose(tools, session)
    no_reason = tools.execute_kernel_tool(
        tool_name="update_production_plan_step",
        arguments=json.dumps({"step_id": "characters", "updates": {"status": "skipped"}}),
        capability="story_builder",
        context=_context(tools, session),
    )
    skipped = tools.execute_kernel_tool(
        tool_name="update_production_plan_step",
        arguments=json.dumps(
            {
                "step_id": "characters",
                "updates": {"status": "skipped"},
                "reason": "The user chose to proceed without a separate character sheet.",
            }
        ),
        capability="story_builder",
        context=_context(tools, session),
    )

    assert no_reason.trace.error.code == "production_step_skip_reason_required"
    assert skipped.trace.error is None
    step = skipped.result["plan"]["steps"][0]
    assert step["status"] == "skipped"
    assert "proceed without" in step["notes"]
    assert store_assistant.get_assistant_session(session["assistant_session_id"])["summary_json"]["production_plan"] == skipped.result["plan"]
    revised = tools.execute_kernel_tool(
        tool_name="update_production_plan_step",
        arguments=json.dumps(
            {"step_id": "characters", "updates": {"title": "Character direction intentionally omitted"}}
        ),
        capability="story_builder",
        context=_context(tools, session),
    )
    assert revised.trace.error is None
    assert revised.result["plan"]["steps"][0]["notes"] == step["notes"]


def test_production_plan_done_requires_owned_completed_artifact(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    store_assistant = importlib.import_module("app.store_assistant")
    session = _session(client)
    other = _session(client)
    _propose(tools, session)
    own = store_assistant.create_or_update_assistant_plan(
        {
            "assistant_session_id": session["assistant_session_id"],
            "status": "applied",
            "plan_json": {},
        }
    )
    foreign = store_assistant.create_or_update_assistant_plan(
        {
            "assistant_session_id": other["assistant_session_id"],
            "status": "applied",
            "plan_json": {},
        }
    )
    missing = tools.execute_kernel_tool(
        tool_name="update_production_plan_step",
        arguments=json.dumps({"step_id": "characters", "updates": {"status": "done"}}),
        capability="story_builder",
        context=_context(tools, session),
    )
    wrong_kind = tools.execute_kernel_tool(
        tool_name="update_production_plan_step",
        arguments=json.dumps(
            {
                "step_id": "characters",
                "updates": {
                    "status": "done",
                    "artifact_ref": f"assistant_plan:{own['assistant_plan_id']}",
                },
            }
        ),
        capability="story_builder",
        context=_context(tools, session),
    )
    _complete_story_steps(tools, store_assistant, session)
    foreign_graph = tools.execute_kernel_tool(
        tool_name="update_production_plan_step",
        arguments=json.dumps(
            {
                "step_id": "graph",
                "updates": {
                    "status": "in_progress",
                    "artifact_ref": f"assistant_plan:{foreign['assistant_plan_id']}",
                },
            }
        ),
        capability="story_builder",
        context=_context(tools, session),
    )

    assert missing.trace.error.code == "production_step_artifact_required"
    assert wrong_kind.trace.error.code == "production_step_artifact_kind_invalid"
    assert foreign_graph.trace.error.code == "production_step_artifact_invalid"


def test_production_plan_updates_identified_constraint_from_number_word(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    session = _session(client)
    before = _propose(tools, session).result["plan"]
    context = tools.KernelToolContext(
        workflow=None,
        canvas_context={},
        session_id=session["assistant_session_id"],
        session=session,
        user_text="Three storyboards then.",
    )

    updated = tools.execute_kernel_tool(
        tool_name="update_production_plan_step",
        arguments=json.dumps(
            {
                "step_id": "storyboard",
                "updates": {"title": "Create three storyboards"},
                "constraint_updates": [
                    {"name": "storyboard_count", "value": 3, "source": "user_request"}
                ],
            }
        ),
        capability="story_builder",
        context=context,
    )

    assert updated.trace.error is None
    assert updated.result["plan"]["constraints"][:3] == before["constraints"]
    assert updated.result["plan"]["constraints"][3]["name"] == "storyboard_count"
    assert updated.result["plan"]["steps"][2]["title"] == "Create three storyboards"


def test_story_turn_can_update_one_plan_step_after_story_state(client, monkeypatch) -> None:
    kernel = importlib.import_module("app.assistant.kernel")
    tools = importlib.import_module("app.assistant.kernel_tools")
    session = _session(client)
    _propose(tools, session)
    steps = iter(
        [
            {
                "capability": "story_builder",
                "artifact_intent": "update_story",
                "tool_call": {
                    "name": "update_story_state",
                    "arguments": {
                        "state": {
                            "premise": "A salvage crew enters a derelict ship.",
                            "characters": [
                                {
                                    "character_id": "captain",
                                    "name": "Captain Imani",
                                    "description": "A cautious salvage captain in a marked pressure suit.",
                                }
                            ],
                        },
                        "update_kind": "story_development",
                    },
                },
            },
            {
                "capability": "story_builder",
                "artifact_intent": "update_story",
                "tool_call": {
                    "name": "update_production_plan_step",
                    "arguments": {
                        "step_id": "characters",
                        "updates": {"status": "done", "artifact_ref": "story_state"},
                    },
                },
            },
            {
                "capability": "story_builder",
                "artifact_intent": "update_story",
                "reply": "The character direction is now part of the plan.",
            },
        ]
    )
    monkeypatch.setattr(kernel, "run_kernel_provider_step", lambda **_kwargs: next(steps))

    result = kernel.run_assistant_kernel_turn(
        session=session,
        user_text="No character sheet yet, let's make one.",
        workflow=None,
        canvas_context={},
        assistant_mode="graph",
    )

    assert [trace.tool_name for trace in result.trace.tool_calls] == [
        "update_story_state",
        "update_production_plan_step",
    ]
    assert [artifact.kind for artifact in result.artifacts] == [
        "story_state",
        "production_plan_update",
    ]


def test_graph_proposal_updates_plan_without_bypassing_confirmation(client, monkeypatch) -> None:
    kernel = importlib.import_module("app.assistant.kernel")
    tools = importlib.import_module("app.assistant.kernel_tools")
    graph_schemas = importlib.import_module("app.graph.schemas")
    store_assistant = importlib.import_module("app.store_assistant")
    session = _session(client)
    _propose(tools, session)
    refreshed = _complete_story_steps(tools, store_assistant, session)
    provider_calls = 0

    def provider_step(**_kwargs):
        nonlocal provider_calls
        provider_calls += 1
        if provider_calls == 1:
            return {
                "capability": "graph_builder",
                "artifact_intent": "none",
                "reply": "The shot proposal is ready for review.",
                "tool_call": {
                    "name": "propose_graph_operations",
                    "arguments": {
                        "summary": "Place the first approved storyboard prompt on the canvas.",
                        "operations": [
                            {
                                "op": "add_node",
                                "node_ref": "shot_1_prompt",
                                "node_type": "prompt.text",
                                "title": "Shot 1 Prompt",
                                "position": {"x": 80, "y": 120},
                                "fields": {"text": "A salvage crew approaches a silent derelict airlock."},
                            }
                        ],
                    },
                },
            }
        if provider_calls == 2:
            proposal = store_assistant.list_assistant_plans(session["assistant_session_id"])[0]
            return {
                "capability": "graph_builder",
                "artifact_intent": "none",
                "tool_call": {
                    "name": "update_production_plan_step",
                    "arguments": {
                        "step_id": "graph",
                        "updates": {
                            "status": "in_progress",
                            "artifact_ref": f"assistant_plan:{proposal['assistant_plan_id']}",
                        },
                    },
                },
            }
        return {
            "capability": "graph_builder",
            "artifact_intent": "none",
            "reply": "Review the canvas proposal before applying it.",
        }

    monkeypatch.setattr(kernel, "run_kernel_provider_step", provider_step)
    result = kernel.run_assistant_kernel_turn(
        session=refreshed,
        user_text="Put shot 1 on the canvas so I can run it.",
        workflow=graph_schemas.GraphWorkflow(name="Production graph", nodes=[], edges=[], metadata={}),
        canvas_context={},
        assistant_mode="graph",
    )

    assert [trace.tool_name for trace in result.trace.tool_calls] == [
        "propose_graph_operations",
        "update_production_plan_step",
    ]
    assert result.next_action.kind == "confirm_graph"
    assert result.next_action.requires_confirmation is True
    assert store_assistant.list_assistant_plans(session["assistant_session_id"])[0]["status"] == "validated"
    current = store_assistant.get_assistant_session(session["assistant_session_id"])
    graph_step = current["summary_json"]["production_plan"]["steps"][3]
    assert graph_step["status"] == "in_progress"
    assert graph_step["artifact_ref"].startswith("assistant_plan:")


def test_production_plan_rejects_regressing_dependency_behind_active_step(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    store_assistant = importlib.import_module("app.store_assistant")
    session = _session(client)
    _propose(tools, session)
    refreshed = _complete_story_steps(tools, store_assistant, session)
    proposal = store_assistant.create_or_update_assistant_plan(
        {
            "assistant_session_id": session["assistant_session_id"],
            "status": "validated",
            "plan_json": {},
        }
    )
    graph_started = tools.execute_kernel_tool(
        tool_name="update_production_plan_step",
        arguments=json.dumps(
            {
                "step_id": "graph",
                "updates": {
                    "status": "in_progress",
                    "artifact_ref": f"assistant_plan:{proposal['assistant_plan_id']}",
                },
            }
        ),
        capability="graph_builder",
        context=_context(tools, refreshed),
    )
    assert graph_started.trace.error is None
    regressed = tools.execute_kernel_tool(
        tool_name="update_production_plan_step",
        arguments=json.dumps({"step_id": "storyboard", "updates": {"status": "in_progress"}}),
        capability="story_builder",
        context=_context(tools, session),
    )

    assert regressed.trace.error.code == "production_step_dependency_blocked"
    assert regressed.trace.error.details == {
        "step_id": "graph",
        "blocking_step_ids": ["storyboard"],
    }
