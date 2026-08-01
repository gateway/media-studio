from __future__ import annotations

import importlib
import json


def _preset_draft(key: str, *, fields=None, image_slot: bool = False):
    fields = fields or [{"key": "location", "label": "Location", "required": True}]
    slots = [{"key": "subject_image", "label": "Subject Image", "required": True}] if image_slot else []
    prompt = "Warm cinematic coverage board for {{location}}"
    if image_slot:
        prompt = "Use [[subject_image]] as the subject source. " + prompt
    model_key = "gpt-image-2-image-to-image" if image_slot else "gpt-image-2-text-to-image"
    return {
        "key": key,
        "label": "Amber Coverage Board",
        "description": "Four coherent cinematic location views in a charcoal and amber technical layout.",
        "category": "editorial",
        "status": "active",
        "model_key": model_key,
        "applies_to_models": [model_key],
        "applies_to_task_modes": ["image_edit" if image_slot else "text_to_image"],
        "applies_to_input_patterns": ["single_image" if image_slot else "prompt_only"],
        "prompt_template": prompt,
        "requires_image": image_slot,
        "input_schema_json": fields,
        "input_slots_json": slots,
        "default_options_json": {"aspect_ratio": "1:1"},
        "rules_json": {"output_kind": "image"},
        "source_kind": "custom",
        "priority": 0,
    }


def _session(client):
    return client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "standalone", "provider_kind": "codex_local"},
    ).json()


def _applied_test_plan(store_assistant, session_id: str):
    return store_assistant.create_or_update_assistant_plan(
        {
            "assistant_session_id": session_id,
            "status": "applied",
            "capability": "plan_graph",
            "plan_json": {"summary": "Validated preset test graph", "operations": []},
            "validation_json": {"valid": True, "errors": [], "warnings": []},
            "pricing_json": {
                "pricing_summary": {
                    "total": {"estimated_credits": 6.0, "estimated_cost_usd": 0.03}
                }
            },
            "workflow_json": {
                "schema_version": 1,
                "name": "Preset test",
                "nodes": [],
                "edges": [],
                "metadata": {},
            },
        }
    )


def test_preset_tools_read_real_catalog_models_and_full_contract(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    store = importlib.import_module("app.store")
    preset = store.list_presets()[0]
    context = tools.KernelToolContext(workflow=None, canvas_context={})

    searched = tools.execute_kernel_tool(
        tool_name="search_presets",
        arguments=json.dumps({"query": str(preset["label"])[:30], "limit": 5}),
        capability="preset_builder",
        context=context,
    )
    fetched = tools.execute_kernel_tool(
        tool_name="get_preset",
        arguments=json.dumps({"preset_id_or_key": preset["preset_id"]}),
        capability="preset_builder",
        context=context,
    )
    models = tools.execute_kernel_tool(
        tool_name="list_media_models",
        arguments=json.dumps({"mode": "text_to_image", "limit": 30}),
        capability="preset_builder",
        context=context,
    )

    assert searched.trace.error is None
    assert any(item["preset_id"] == preset["preset_id"] for item in searched.result["items"])
    assert fetched.trace.error is None
    assert fetched.result["key"] == preset["key"]
    assert "prompt_template" in fetched.result
    assert models.trace.error is None
    assert any("text_to_image" in item["task_modes"] for item in models.result["models"])


def test_model_catalog_tool_exposes_grounded_seedance_video_constraints(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    context = tools.KernelToolContext(workflow=None, canvas_context={})

    execution = tools.execute_kernel_tool(
        tool_name="list_media_models",
        arguments=json.dumps({"mode": "video", "model_key": "seedance-2.0"}),
        capability="general",
        context=context,
    )

    assert execution.trace.error is None
    assert execution.trace.evidence == execution.result
    assert execution.result["count"] == 1
    model = execution.result["models"][0]
    assert model["model_key"] == "seedance-2.0"
    assert model["generation_constraints"]["duration_seconds"]["allowed"] is None
    assert model["generation_constraints"]["duration_seconds"]["max"] == 15
    assert "1080p" in model["generation_constraints"]["resolutions"]["allowed"]
    assert "16:9" in model["generation_constraints"]["aspect_ratios"]["allowed"]
    assert model["input_limits"]["image"]["required_max"] == 9
    assert model["input_limits"]["video"]["required_max"] == 3
    assert model["input_limits"]["audio"]["required_max"] == 3
    assert model["frame_support"] == {"first_frame": True, "last_frame": True}
    assert model["cost_basis"]["billing_unit"] == "second"


def test_typed_preset_draft_revisions_persist_without_saving(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    store = importlib.import_module("app.store")
    store_assistant = importlib.import_module("app.store_assistant")
    session = _session(client)
    key = "kernel_preset_revision_contract"
    before = store.get_preset_by_key(key)
    context = tools.KernelToolContext(
        workflow=None,
        canvas_context={},
        session_id=session["assistant_session_id"],
        session=session,
    )
    first = tools.execute_kernel_tool(
        tool_name="propose_media_preset_draft",
        arguments=json.dumps({"draft": _preset_draft(key)}),
        capability="preset_builder",
        context=context,
    )
    revised_fields = [
        {"key": "featured_object", "label": "Featured Object", "required": True},
        {"key": "project_title", "label": "Project Title", "required": True},
    ]
    revised_draft = _preset_draft(key, fields=revised_fields)
    revised_draft["prompt_template"] = (
        "Warm cinematic coverage board for {{featured_object}} titled {{project_title}}"
    )
    second = tools.execute_kernel_tool(
        tool_name="propose_media_preset_draft",
        arguments=json.dumps({"draft": revised_draft}),
        capability="preset_builder",
        context=context,
    )
    refreshed = store_assistant.get_assistant_session(session["assistant_session_id"])

    assert first.result["save_ready"] is False
    assert first.result["confirmation_token"] is None
    assert second.trace.error is None
    assert [item["key"] for item in refreshed["summary_json"]["kernel_preset_draft"]["input_schema_json"]] == [
        "featured_object",
        "project_title",
    ]
    assert store.get_preset_by_key(key) == before


def test_preset_save_rejects_an_unconfirmed_legacy_draft(client) -> None:
    session = _session(client)

    response = client.post(
        f"/media/assistant/sessions/{session['assistant_session_id']}/preset-saves",
        json={
            "message": "Save this draft.",
            "draft": _preset_draft("unconfirmed_legacy_preset"),
        },
    )

    assert response.status_code == 400


def test_preset_turn_cannot_finish_with_prose_only_draft(client, monkeypatch) -> None:
    kernel = importlib.import_module("app.assistant.kernel")
    session = _session(client)
    draft = _preset_draft("kernel_required_typed_draft")
    calls = 0
    steps = iter(
        [
            {
                "capability": "preset_builder",
                "artifact_intent": "draft_preset",
                "reply": "I suggest a location field.",
            },
            {
                "capability": "preset_builder",
                "artifact_intent": "draft_preset",
                "tool_call": {
                    "name": "propose_media_preset_draft",
                    "arguments": json.dumps({"draft": draft}),
                },
            },
            {
                "capability": "preset_builder",
                "artifact_intent": "draft_preset",
                "reply": "The editable draft is ready.",
            },
        ]
    )

    def provider_step(**_kwargs):
        nonlocal calls
        calls += 1
        return next(steps)

    monkeypatch.setattr(kernel, "run_kernel_provider_step", provider_step)
    result = kernel.run_assistant_kernel_turn(
        session=session,
        user_text="Develop this reusable configuration.",
        workflow=None,
        canvas_context={},
        assistant_mode="preset",
    )

    assert calls == 3
    assert any(item.kind == "preset_draft" for item in result.artifacts)
    assert result.trace.tool_calls[0].tool_name == "propose_media_preset_draft"


def test_preset_draft_turn_stops_before_unrequested_graph_work(client, monkeypatch) -> None:
    kernel = importlib.import_module("app.assistant.kernel")
    session = _session(client)
    draft = _preset_draft("kernel_draft_stops_before_graph")
    calls = 0
    steps = iter(
        [
            {
                "capability": "preset_builder",
                "artifact_intent": "draft_preset",
                "tool_call": {
                    "name": "propose_media_preset_draft",
                    "arguments": json.dumps({"draft": draft}),
                },
            },
            {
                "capability": "preset_builder",
                "artifact_intent": "draft_preset",
                "tool_call": {"name": "read_current_workflow", "arguments": "{}"},
            },
            {
                "capability": "preset_builder",
                "artifact_intent": "draft_preset",
                "reply": "The editable draft is ready for review.",
            },
        ]
    )

    def provider_step(**_kwargs):
        nonlocal calls
        calls += 1
        return next(steps)

    monkeypatch.setattr(kernel, "run_kernel_provider_step", provider_step)
    result = kernel.run_assistant_kernel_turn(
        session=session,
        user_text="Develop a reusable image transformation configuration.",
        workflow=None,
        canvas_context={},
        assistant_mode="preset",
    )

    assert calls == 3
    assert result.reply
    assert [trace.tool_name for trace in result.trace.tool_calls] == ["propose_media_preset_draft"]


def test_preset_revision_cannot_finish_with_an_unchanged_typed_draft(client, monkeypatch) -> None:
    kernel = importlib.import_module("app.assistant.kernel")
    store_assistant = importlib.import_module("app.store_assistant")
    session = _session(client)
    original = _preset_draft("kernel_revision_noop_guard")
    summary = dict(session.get("summary_json") or {})
    summary["kernel_preset_draft"] = original
    session = store_assistant.create_or_update_assistant_session({**session, "summary_json": summary})
    changed = _preset_draft(
        "kernel_revision_noop_guard",
        fields=[{"key": "time_of_day", "label": "Time of Day", "required": True}],
    )
    changed["prompt_template"] = "Warm cinematic coverage board at {{time_of_day}}"
    steps = iter(
        [
            {
                "capability": "preset_builder",
                "artifact_intent": "revise_preset",
                "tool_call": {
                    "name": "propose_media_preset_draft",
                    "arguments": json.dumps({"draft": original}),
                },
            },
            {
                "capability": "preset_builder",
                "artifact_intent": "revise_preset",
                "tool_call": {
                    "name": "propose_media_preset_draft",
                    "arguments": json.dumps({"draft": changed}),
                },
            },
            {
                "capability": "preset_builder",
                "artifact_intent": "revise_preset",
                "reply": "The revised draft is ready.",
            },
        ]
    )
    monkeypatch.setattr(kernel, "run_kernel_provider_step", lambda **_kwargs: next(steps))

    result = kernel.run_assistant_kernel_turn(
        session=session,
        user_text="The current definition should be different.",
        workflow=None,
        canvas_context={},
        assistant_mode="preset",
    )
    refreshed = store_assistant.get_assistant_session(session["assistant_session_id"])

    assert len(result.trace.tool_calls) == 2
    assert result.trace.tool_calls[0].error.code == "preset_draft_unchanged"
    assert result.trace.tool_calls[1].error is None
    assert refreshed["summary_json"]["kernel_preset_draft"]["input_schema_json"][0]["key"] == "time_of_day"


def test_preset_capability_can_offer_a_validated_priced_graph_before_save(client, monkeypatch) -> None:
    kernel = importlib.import_module("app.assistant.kernel")
    store_assistant = importlib.import_module("app.store_assistant")
    session = _session(client)
    summary = dict(session.get("summary_json") or {})
    summary["kernel_preset_draft"] = _preset_draft("kernel_graph_gated_preset")
    session = store_assistant.create_or_update_assistant_session({**session, "summary_json": summary})
    workflow = {
        "schema_version": 1,
        "name": "Preset test",
        "nodes": [],
        "edges": [],
        "metadata": {},
    }
    steps = iter(
        [
                {
                    "capability": "preset_builder",
                    "tool_call": {
                        "name": "propose_graph_operations",
                    "arguments": json.dumps(
                        {
                            "summary": "Add a prompt source for the preset test.",
                                "operations": [
                                    {
                                        "op": "add_node",
                                        "node_ref": "generator",
                                        "node_type": "model.kie.gpt_image_2_text_to_image",
                                        "fields": {
                                            "prompt": "Warm cinematic location coverage board",
                                            "aspect_ratio": "auto",
                                        },
                                    },
                                    {
                                        "op": "add_node",
                                        "node_ref": "save",
                                        "node_type": "media.save_image",
                                    },
                                    {
                                        "op": "connect_nodes",
                                        "source_ref": "generator",
                                        "source_port": "image",
                                        "target_ref": "save",
                                        "target_port": "image",
                                    },
                                ],
                        }
                        ),
                    },
                },
                {"capability": "preset_builder", "reply": "The test graph is ready for review."},
        ]
    )
    monkeypatch.setattr(kernel, "run_kernel_provider_step", lambda **_kwargs: next(steps))

    result = kernel.run_assistant_kernel_turn(
        session=session,
        user_text="Create the test graph.",
        workflow=kernel.GraphWorkflow.model_validate(workflow),
        canvas_context={},
        assistant_mode="preset",
    )

    assert result.trace.tool_calls[0].error is None, result.trace.tool_calls[0].error
    graph = next(item.data for item in result.artifacts if item.kind == "graph_proposal")
    assert graph["validation"]["valid"] is True
    assert graph["pricing"]["pricing_summary"]["total"]["estimated_credits"] is not None
    assert result.next_action.kind == "confirm_graph"
    assert result.next_action.requires_confirmation is True


def test_preset_save_requires_applied_priced_graph_and_one_time_confirmation(client, monkeypatch) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    kernel = importlib.import_module("app.assistant.kernel")
    store = importlib.import_module("app.store")
    store_assistant = importlib.import_module("app.store_assistant")
    session = _session(client)
    plan = _applied_test_plan(store_assistant, session["assistant_session_id"])
    key = "kernel_confirmed_amber_coverage"
    draft = _preset_draft(key)
    steps = iter(
        [
            {
                "capability": "preset_builder",
                "artifact_intent": "save_preset",
                "tool_call": {
                    "name": "propose_media_preset_draft",
                    "arguments": json.dumps(
                        {
                            "draft": draft,
                            "test_plan_id": plan["assistant_plan_id"],
                        }
                    ),
                },
            },
            {
                "capability": "preset_builder",
                "artifact_intent": "save_preset",
                "reply": "The validated draft is ready for confirmation.",
            },
        ]
    )
    monkeypatch.setattr(kernel, "run_kernel_provider_step", lambda **_kwargs: next(steps))
    before = store.get_preset_by_key(key)

    proposed = client.post(
        f"/media/assistant/sessions/{session['assistant_session_id']}/messages",
        json={"content_text": "Save the approved preset.", "assistant_mode": "preset"},
    )

    assert proposed.status_code == 200, proposed.text
    action = proposed.json()["messages"][-1]["content_json"]["next_action"]
    artifact = proposed.json()["messages"][-1]["content_json"]["kernel_turn"]["artifacts"][0]
    assert action["kind"] == "save_media_preset"
    assert action["requires_confirmation"] is True
    assert artifact["data"]["test_graph"]["validation"]["valid"] is True
    assert artifact["data"]["test_graph"]["pricing"]["pricing_summary"]["total"]["estimated_credits"] == 6.0
    assert store.get_preset_by_key(key) == before

    saved = client.post(
        f"/media/assistant/sessions/{session['assistant_session_id']}/preset-saves",
        json={
            "message": "Save the approved Media Preset draft.",
            "proposal_id": action["proposal_id"],
            "confirmation_token": action["confirmation_token"],
        },
    )
    replay = client.post(
        f"/media/assistant/sessions/{session['assistant_session_id']}/preset-saves",
        json={
            "message": "Save the approved Media Preset draft.",
            "proposal_id": action["proposal_id"],
            "confirmation_token": action["confirmation_token"],
        },
    )

    assert saved.status_code == 200, saved.text
    assert saved.json()["record"]["key"] == key
    assert saved.json()["assistant_session"]["summary_json"]["kernel_preset_proposal"]["consumed"] is True
    assert store.get_preset_by_key(key)["preset_id"] == saved.json()["record"]["preset_id"]
    assert replay.status_code == 400


def test_preset_draft_intent_does_not_expose_save_confirmation(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    store_assistant = importlib.import_module("app.store_assistant")
    session = _session(client)
    plan = _applied_test_plan(store_assistant, session["assistant_session_id"])

    proposed = tools.execute_kernel_tool(
        tool_name="propose_media_preset_draft",
        arguments=json.dumps(
            {
                "draft": _preset_draft("kernel_draft_intent_save_guard"),
                "test_plan_id": plan["assistant_plan_id"],
            }
        ),
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            session_id=session["assistant_session_id"],
            session=session,
            artifact_intent="draft_preset",
        ),
    )

    assert proposed.trace.error is None
    assert proposed.result["test_graph"] is not None
    assert proposed.result["save_ready"] is False
    assert proposed.result["confirmation_token"] is None


def test_preset_save_rejects_a_new_unapplied_plan_and_exposes_the_applied_plan(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    kernel = importlib.import_module("app.assistant.kernel")
    store_assistant = importlib.import_module("app.store_assistant")
    session = _session(client)
    applied = _applied_test_plan(store_assistant, session["assistant_session_id"])
    newer = store_assistant.create_or_update_assistant_plan(
        {
            **applied,
            "assistant_plan_id": "asplan_unapplied_preset_regression",
            "status": "validated",
            "created_at": "2099-01-01T00:00:00+00:00",
        }
    )
    context = tools.KernelToolContext(
        workflow=None,
        canvas_context={},
        session_id=session["assistant_session_id"],
        session=session,
        user_text="Good enough, save it as a preset.",
        artifact_intent="save_preset",
    )

    rejected = tools.execute_kernel_tool(
        tool_name="propose_media_preset_draft",
        arguments=json.dumps(
            {
                "draft": _preset_draft("kernel_unapplied_plan_guard"),
                "test_plan_id": newer["assistant_plan_id"],
            }
        ),
        capability="preset_builder",
        context=context,
    )
    confirmed = tools.execute_kernel_tool(
        tool_name="propose_media_preset_draft",
        arguments=json.dumps(
            {
                "draft": _preset_draft("kernel_unapplied_plan_guard"),
                "test_plan_id": applied["assistant_plan_id"],
            }
        ),
        capability="preset_builder",
        context=context,
    )
    session_context = kernel._kernel_session_context(session)

    assert rejected.trace.error is not None
    assert rejected.trace.error.code == "preset_test_graph_not_applied"
    assert confirmed.trace.error is None
    assert confirmed.result["save_ready"] is True
    assert store_assistant.get_assistant_plan(newer["assistant_plan_id"])["status"] == "rejected"
    assert session_context["latest_applied_test_plan_id"] == applied["assistant_plan_id"]
