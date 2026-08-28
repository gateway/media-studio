from __future__ import annotations

import importlib
import json

import pytest


def _session(client):
    return client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "standalone", "provider_kind": "codex_local"},
    ).json()


def _story_state(*, shot_count: int = 0):
    shots = [
        {
            "shot_number": number,
            "title": f"Beat {number}",
            "story_beat": f"The discovery advances in beat {number}.",
            "prompt": (
                f"Cinematic storyboard frame {number}: a weathered lighthouse keeper in a navy wool coat "
                "investigates a dark object in cold dawn water, consistent face and clothing."
            ),
            "camera": "Wide coastal composition" if number == 1 else "Measured medium shot",
            "action": f"The keeper advances through story beat {number}.",
            "motion": "Wind pulls at the coat and sea spray.",
            "environment": "Rocky lighthouse coast at blue dawn.",
            "character_ids": ["keeper"],
            "continuity_notes": ["Same navy coat, gray beard, brass lantern, and dawn lighting."],
        }
        for number in range(1, shot_count + 1)
    ]
    return {
        "version": 1,
        "status": "draft",
        "title": "The Object in the Water",
        "premise": (
            "A solitary lighthouse keeper discovers an impossible dark object drifting just beyond the rocks."
        ),
        "tone": "Quiet maritime mystery with escalating dread.",
        "visual_style": "Grounded cinematic realism, cold dawn blues, restrained amber lantern light.",
        "world_rules": [
            "The setting is an isolated working lighthouse.",
            "The object remains physically plausible but unexplained.",
        ],
        "continuity_facts": [
            "Events occur during one continuous dawn.",
            "The keeper carries the same brass lantern.",
        ],
        "characters": [
            {
                "character_id": "keeper",
                "name": "The Keeper",
                "description": "Older, weathered, gray beard, navy wool coat, practical sea boots.",
                "continuity_traits": [
                    "Gray beard and lined face",
                    "Navy wool coat",
                    "Brass storm lantern",
                ],
                "reference_ids": [],
            }
        ],
        "segment_title": "The discovery",
        "shots": shots,
        "source_reference_ids": [],
    }


def _context(tools, session, user_text: str):
    return tools.KernelToolContext(
        workflow=None,
        canvas_context={},
        session_id=session["assistant_session_id"],
        session=session,
        user_text=user_text,
    )


def test_story_tools_persist_typed_bible_and_exact_shot_count(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    store_assistant = importlib.import_module("app.store_assistant")
    session = _session(client)
    developed = tools.execute_kernel_tool(
        tool_name="update_story_state",
        arguments=json.dumps(
            {
                "state": _story_state(),
                "update_kind": "story_development",
            }
        ),
        capability="story_builder",
        context=_context(
            tools,
            session,
            "I've got a story idea — a lighthouse keeper who finds something in the water. Help me build it out.",
        ),
    )
    refreshed = store_assistant.get_assistant_session(session["assistant_session_id"])
    shot_list = tools.execute_kernel_tool(
        tool_name="update_story_state",
        arguments=json.dumps(
            {
                "state": _story_state(shot_count=6),
                "update_kind": "shot_list",
            }
        ),
        capability="story_builder",
        context=_context(
            tools,
            refreshed,
            "Break that into six shots I can use as storyboard prompts.",
        ),
    )
    read_back = tools.execute_kernel_tool(
        tool_name="read_story_state",
        arguments="{}",
        capability="story_builder",
        context=_context(
            tools,
            store_assistant.get_assistant_session(session["assistant_session_id"]),
            "Show the current story.",
        ),
    )

    assert developed.trace.error is None
    assert shot_list.trace.error is None
    assert len(shot_list.result["state"]["shots"]) == 6
    assert [shot["shot_number"] for shot in shot_list.result["state"]["shots"]] == list(range(1, 7))
    assert all(shot["prompt"] and shot["character_ids"] == ["keeper"] for shot in shot_list.result["state"]["shots"])
    assert read_back.result["exists"] is True
    assert read_back.result["state"] == shot_list.result["state"]


def test_story_revision_changes_only_requested_shot(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    store_assistant = importlib.import_module("app.store_assistant")
    session = _session(client)
    initial = _story_state(shot_count=6)
    tools.execute_kernel_tool(
        tool_name="update_story_state",
        arguments=json.dumps({"state": initial, "update_kind": "shot_list"}),
        capability="story_builder",
        context=_context(tools, session, "Break that into six shots."),
    )
    revised = _story_state(shot_count=6)
    revised["shots"][3] = {
        **revised["shots"][3],
        "story_beat": "The object turns toward the keeper beneath the surface.",
        "prompt": (
            "Tense cinematic storyboard frame: the keeper freezes at the waterline as the dark object "
            "rotates toward him below the surface, same gray beard, navy coat, brass lantern, cold dawn."
        ),
        "camera": "Low over-the-shoulder angle with the object looming in foreground water",
        "action": "The keeper stops as the object reacts to his presence.",
    }
    revision = tools.execute_kernel_tool(
        tool_name="update_story_state",
        arguments=json.dumps(
            {
                "state": revised,
                "update_kind": "shot_revision",
                "revised_shot_numbers": [4],
            }
        ),
        capability="story_builder",
        context=_context(
            tools,
            store_assistant.get_assistant_session(session["assistant_session_id"]),
            "Shot 4 is weak, make it more tense.",
        ),
    )

    assert revision.trace.error is None
    assert revision.result["changed_shot_numbers"] == [4]
    assert revision.result["state"]["shots"][3] != initial["shots"][3]
    assert revision.result["state"]["shots"][:3] == initial["shots"][:3]
    assert revision.result["state"]["shots"][4:] == initial["shots"][4:]


def test_story_revision_rejects_collateral_shot_changes(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    store_assistant = importlib.import_module("app.store_assistant")
    session = _session(client)
    initial = _story_state(shot_count=6)
    tools.execute_kernel_tool(
        tool_name="update_story_state",
        arguments=json.dumps({"state": initial, "update_kind": "shot_list"}),
        capability="story_builder",
        context=_context(tools, session, "Break that into six shots."),
    )
    invalid = _story_state(shot_count=6)
    invalid["shots"][2]["camera"] = "Changed third shot"
    invalid["shots"][3]["camera"] = "Changed fourth shot"
    revision = tools.execute_kernel_tool(
        tool_name="update_story_state",
        arguments=json.dumps(
            {
                "state": invalid,
                "update_kind": "shot_revision",
                "revised_shot_numbers": [4],
            }
        ),
        capability="story_builder",
        context=_context(
            tools,
            store_assistant.get_assistant_session(session["assistant_session_id"]),
            "Shot 4 is weak, make it more tense.",
        ),
    )

    assert revision.result is None
    assert revision.trace.error.code == "story_revision_changed_wrong_shots"


def test_story_continuity_update_preserves_shot_content(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    store_assistant = importlib.import_module("app.store_assistant")
    session = _session(client)
    initial = _story_state(shot_count=3)
    tools.execute_kernel_tool(
        tool_name="update_story_state",
        arguments=json.dumps({"state": initial, "update_kind": "shot_list"}),
        capability="story_builder",
        context=_context(tools, session, "Create three shots."),
    )
    continuous = _story_state(shot_count=3)
    continuous["continuity_facts"].append("Keep facial structure, coat wear, and lantern dents identical.")
    continuous["characters"][0]["reference_ids"] = ["reference_keeper_sheet"]
    for shot in continuous["shots"]:
        shot["continuity_notes"].append(
            "Use reference_keeper_sheet for the same face, coat wear, and lantern dents."
        )
    update = tools.execute_kernel_tool(
        tool_name="update_story_state",
        arguments=json.dumps({"state": continuous, "update_kind": "continuity"}),
        capability="story_builder",
        context=_context(
            tools,
            store_assistant.get_assistant_session(session["assistant_session_id"]),
            "Keep the same character across all of them — how do I do that?",
        ),
    )

    assert update.trace.error is None
    assert update.result["changed_shot_numbers"] == [1, 2, 3]
    assert all(
        shot["character_ids"] == ["keeper"] and len(shot["continuity_notes"]) == 2
        for shot in update.result["state"]["shots"]
    )


def test_story_turn_cannot_finish_with_prose_only_state(client, monkeypatch) -> None:
    kernel = importlib.import_module("app.assistant.kernel")
    session = _session(client)
    steps = iter(
        [
            {
                "capability": "story_builder",
                "artifact_intent": "update_story",
                "reply": "I developed the premise.",
            },
            {
                "capability": "story_builder",
                "artifact_intent": "update_story",
                "tool_call": {
                    "name": "update_story_state",
                    "arguments": json.dumps(
                        {
                            "state": _story_state(),
                            "update_kind": "story_development",
                        }
                    ),
                },
            },
            {
                "capability": "story_builder",
                "artifact_intent": "update_story",
                "reply": "The story foundation is ready.",
            },
        ]
    )
    monkeypatch.setattr(kernel, "run_kernel_provider_step", lambda **_kwargs: next(steps))

    result = kernel.run_assistant_kernel_turn(
        session=session,
        user_text="Develop this narrative foundation.",
        workflow=None,
        canvas_context={},
        assistant_mode="graph",
    )

    assert result.capability == "story_builder"
    assert any(item.kind == "story_state" for item in result.artifacts)
    assert result.trace.tool_calls[0].tool_name == "update_story_state"


@pytest.mark.parametrize("capability", ["graph_builder", "story_builder"])
def test_story_shots_can_become_validated_priced_graph(client, capability: str) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    graph_schemas = importlib.import_module("app.graph.schemas")
    store_assistant = importlib.import_module("app.store_assistant")
    session = _session(client)
    tools.execute_kernel_tool(
        tool_name="update_story_state",
        arguments={"state": _story_state(shot_count=6), "update_kind": "shot_list"},
        capability="story_builder",
        context=_context(tools, session, "Break that into six shots I can use as storyboard prompts."),
    )
    refreshed = store_assistant.get_assistant_session(session["assistant_session_id"])
    workflow = graph_schemas.GraphWorkflow(
        name="Story graph",
        nodes=[],
        edges=[],
        metadata={},
    )
    context = tools.KernelToolContext(
        workflow=workflow,
        canvas_context={},
        session_id=session["assistant_session_id"],
        session=refreshed,
        user_text="Now put those shots on the canvas as a graph I can run.",
    )
    proposed = tools.execute_kernel_tool(
        tool_name="propose_graph_operations",
        arguments={
            "summary": "Create one runnable image chain per approved story shot.",
            "template_id": "story_shots_image_v1",
        },
        capability=capability,
        context=context,
    )

    assert proposed.trace.error is None, proposed.trace.error
    assert proposed.result["validation"]["valid"] is True
    assert proposed.result["confirmable"] is True
    assert proposed.result["pricing"]["pricing_summary"]["total"]["estimated_credits"] > 0
    assert "workflow" not in proposed.result
    assert proposed.result["workflow_summary"]["node_count"] == 18
    assert proposed.result["workflow_summary"]["edge_count"] == 12
    assert proposed.result["operations_count"] == 31
    stored = store_assistant.get_assistant_plan(proposed.result["proposal_id"])
    assert stored["plan_json"]["metadata"]["template_id"] == "story_shots_image_v1"
    assert stored["plan_json"]["metadata"]["template_shot_count"] == 6


def test_story_graph_template_requires_persisted_story_state(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    graph_schemas = importlib.import_module("app.graph.schemas")
    session = _session(client)
    context = tools.KernelToolContext(
        workflow=graph_schemas.GraphWorkflow(name="Story graph", nodes=[], edges=[], metadata={}),
        canvas_context={},
        session_id=session["assistant_session_id"],
        session=session,
        user_text="Put the story shots on the canvas.",
    )

    proposed = tools.execute_kernel_tool(
        tool_name="propose_graph_operations",
        arguments={"summary": "Create the story graph.", "template_id": "story_shots_image_v1"},
        capability="story_builder",
        context=context,
    )

    assert proposed.trace.error is not None
    assert proposed.trace.error.code == "story_graph_state_missing"


def test_story_graph_template_requires_structured_shots(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    graph_schemas = importlib.import_module("app.graph.schemas")
    store_assistant = importlib.import_module("app.store_assistant")
    session = _session(client)
    tools.execute_kernel_tool(
        tool_name="update_story_state",
        arguments={"state": _story_state(), "update_kind": "story_development"},
        capability="story_builder",
        context=_context(tools, session, "Develop the story."),
    )
    context = tools.KernelToolContext(
        workflow=graph_schemas.GraphWorkflow(name="Story graph", nodes=[], edges=[], metadata={}),
        canvas_context={},
        session_id=session["assistant_session_id"],
        session=store_assistant.get_assistant_session(session["assistant_session_id"]),
        user_text="Put the story shots on the canvas.",
    )

    proposed = tools.execute_kernel_tool(
        tool_name="propose_graph_operations",
        arguments={"summary": "Create the story graph.", "template_id": "story_shots_image_v1"},
        capability="story_builder",
        context=context,
    )

    assert proposed.trace.error is not None
    assert proposed.trace.error.code == "story_graph_shots_missing"


def test_story_graph_template_rejects_other_capabilities_and_manual_operations(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    graph_schemas = importlib.import_module("app.graph.schemas")
    session = _session(client)
    context = tools.KernelToolContext(
        workflow=graph_schemas.GraphWorkflow(name="Story graph", nodes=[], edges=[], metadata={}),
        canvas_context={},
        session_id=session["assistant_session_id"],
        session=session,
        user_text="Put the story shots on the canvas.",
    )
    unsupported = tools.execute_kernel_tool(
        tool_name="propose_graph_operations",
        arguments={"summary": "Create the story graph.", "template_id": "story_shots_image_v1"},
        capability="preset_builder",
        context=context,
    )
    conflicting = tools.execute_kernel_tool(
        tool_name="propose_graph_operations",
        arguments={
            "summary": "Create the story graph.",
            "template_id": "story_shots_image_v1",
            "operations": [
                {
                    "op": "add_node",
                    "node_ref": "manual_prompt",
                    "node_type": "prompt.text",
                    "position": {"x": 0, "y": 0},
                    "fields": {"text": "Do not combine manual operations with the template."},
                }
            ],
        },
        capability="story_builder",
        context=context,
    )

    assert unsupported.trace.error is not None
    assert unsupported.trace.error.code == "story_graph_template_capability_required"
    assert conflicting.trace.error is not None
    assert conflicting.trace.error.code == "story_graph_template_operations_conflict"


def test_story_graph_can_finish_with_validated_tool_step_reply(client, monkeypatch) -> None:
    kernel = importlib.import_module("app.assistant.kernel")
    tools = importlib.import_module("app.assistant.kernel_tools")
    graph_schemas = importlib.import_module("app.graph.schemas")
    store_assistant = importlib.import_module("app.store_assistant")
    session = _session(client)
    tools.execute_kernel_tool(
        tool_name="update_story_state",
        arguments=json.dumps(
            {
                "state": _story_state(shot_count=1),
                "update_kind": "shot_list",
            }
        ),
        capability="story_builder",
        context=_context(tools, session, "Create one shot."),
    )
    refreshed = store_assistant.get_assistant_session(session["assistant_session_id"])
    provider_calls = 0

    def provider_step(**_kwargs):
        nonlocal provider_calls
        provider_calls += 1
        return {
            "capability": "story_builder",
            "reply": "The validated story graph is ready to add.",
            "tool_call": {
                "name": "propose_graph_operations",
                "arguments": {
                    "summary": "Add the approved story shot as a prompt.",
                    "operations": [
                        {
                            "op": "add_node",
                            "node_ref": "shot_prompt",
                            "node_type": "prompt.text",
                            "title": "Shot 1 Prompt",
                            "position": {"x": 80, "y": 100},
                            "fields": {"text": _story_state(shot_count=1)["shots"][0]["prompt"]},
                        }
                    ],
                },
            },
        }

    monkeypatch.setattr(kernel, "run_kernel_provider_step", provider_step)
    result = kernel.run_assistant_kernel_turn(
        session=refreshed,
        user_text="Now put that shot on the canvas as a graph I can run.",
        workflow=graph_schemas.GraphWorkflow(name="Story graph", nodes=[], edges=[], metadata={}),
        canvas_context={},
        assistant_mode="graph",
    )

    assert provider_calls == 1
    assert result.next_action.kind == "confirm_graph"
    assert result.trace.tool_calls[0].error is None
