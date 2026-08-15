from __future__ import annotations

import importlib
import json

import pytest


def _preset_draft(key: str, *, fields=None, image_slot: bool = False):
    fields = fields or [
        {
            "key": "location",
            "label": "Location",
            "placeholder": "e.g. desert research station",
            "help_text": "Changes the setting shown in the generated image.",
            "required": True,
        }
    ]
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
        "applies_to_input_patterns": ["image_edit" if image_slot else "prompt_only"],
        "prompt_template": prompt,
        "requires_image": image_slot,
        "input_schema_json": fields,
        "input_slots_json": slots,
        "default_options_json": {"aspect_ratio": "1:1"},
        "rules_json": {
            "output_kind": "image",
            "preset_lane": "image_to_image" if image_slot else "text_to_image",
        },
        "source_kind": "custom",
        "priority": 0,
    }


def _session(client):
    return client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "standalone", "provider_kind": "codex_local"},
    ).json()


def _applied_test_plan(store_assistant, session_id: str, *, draft=None):
    preset_kernel = importlib.import_module("app.assistant.preset_kernel")
    contract_draft = draft or _preset_draft("applied_test_plan_contract")
    return store_assistant.create_or_update_assistant_plan(
        {
            "assistant_session_id": session_id,
            "status": "applied",
            "capability": "plan_graph",
            "plan_json": {
                "summary": "Validated preset test graph",
                "operations": [],
                "metadata": {
                    "kernel_proposal": True,
                    "template_id": "preset_style_t2i_sandbox_v1",
                    "template_mode": "text_to_image",
                    "template_model_key": "gpt-image-2-text-to-image",
                    "preset_quality_contract_hash": preset_kernel.preset_quality_contract_hash(
                        contract_draft
                    ),
                },
            },
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


def _session_with_preset_quality(
    store_assistant,
    session,
    plan,
    draft,
    *,
    run_status: str = "completed",
    evidence_plan_id: str | None = None,
):
    schemas = importlib.import_module("app.schemas")
    graph_schemas = importlib.import_module("app.graph.schemas")
    run_confirmation = importlib.import_module("app.assistant.run_confirmation")
    normalized_draft = schemas.PresetUpsertRequest.model_validate(draft).model_dump(mode="json")
    workflow_fingerprint = run_confirmation.preset_test_workflow_fingerprint(
        graph_schemas.GraphWorkflow.model_validate(plan["workflow_json"])
    )
    run_id = "grun-preset-save-quality"
    output_asset_id = "asset-preset-save-quality"
    comparison_id = "presetcmp-preset-save-quality"
    summary = dict(session.get("summary_json") or {})
    summary.update(
        {
            "kernel_preset_draft": normalized_draft,
            "kernel_preset_run_evidence": {
                "assistant_session_id": session["assistant_session_id"],
                "test_plan_id": evidence_plan_id or plan["assistant_plan_id"],
                "run_id": run_id,
                "status": run_status,
                "output_asset_ids": [output_asset_id],
                "workflow_fingerprint": workflow_fingerprint,
            },
            "kernel_preset_output_comparison": {
                "comparison_id": comparison_id,
                "run_id": run_id,
                "output_asset_id": output_asset_id,
                "quality_state": "reviewed",
            },
            "kernel_preset_quality": {
                "quality_state": "quality_verified",
                "decision": "approve",
                "comparison_id": comparison_id,
                "run_id": run_id,
                "output_asset_id": output_asset_id,
                "user_approved": True,
            },
        }
    )
    return store_assistant.create_or_update_assistant_session(
        {**session, "summary_json": summary}
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


def test_model_catalog_accepts_a_human_model_name_within_the_requested_mode(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    context = tools.KernelToolContext(workflow=None, canvas_context={})

    execution = tools.execute_kernel_tool(
        tool_name="list_media_models",
        arguments=json.dumps({"mode": "text_to_image", "model_key": "GPT Image 2"}),
        capability="preset_builder",
        context=context,
    )

    assert execution.trace.error is None
    assert [model["model_key"] for model in execution.result["models"]] == [
        "gpt-image-2-text-to-image"
    ]


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
        {
            "key": "featured_object",
            "label": "Featured Object",
            "placeholder": "e.g. field camera",
            "help_text": "Changes the central object shown in the generated image.",
            "required": True,
        },
        {
            "key": "project_title",
            "label": "Project Title",
            "placeholder": "e.g. Coastal Survey",
            "help_text": "Changes the title printed in the generated image.",
            "required": True,
        },
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


def test_assistant_preset_draft_rejects_a_generic_fallback_field(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    store_assistant = importlib.import_module("app.store_assistant")
    session = _session(client)
    draft = _preset_draft(
        "kernel_generic_field_guard",
        fields=[
            {
                "key": "subject_brief",
                "label": "Subject Brief",
                "placeholder": "Describe anything",
                "help_text": "Controls everything in the generated image.",
                "required": True,
            }
        ],
    )
    draft["prompt_template"] = "Warm cinematic coverage board for {{subject_brief}}"

    result = tools.execute_kernel_tool(
        tool_name="propose_media_preset_draft",
        arguments=json.dumps({"draft": draft}),
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            session_id=session["assistant_session_id"],
            session=session,
            user_text="Help me make a reusable preset.",
        ),
    )

    assert result.trace.error is not None
    assert result.trace.error.code == "invalid_media_preset_fields"
    refreshed = store_assistant.get_assistant_session(session["assistant_session_id"])
    assert "kernel_preset_draft" not in refreshed["summary_json"]


def test_text_to_image_preset_rejects_an_image_to_image_lane(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    session = _session(client)
    draft = _preset_draft("kernel_t2i_lane_guard")
    draft["rules_json"]["preset_lane"] = "image_to_image"

    result = tools.execute_kernel_tool(
        tool_name="propose_media_preset_draft",
        arguments=json.dumps({"draft": draft}),
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            session_id=session["assistant_session_id"],
            session=session,
            user_text="Keep this text-to-image.",
        ),
    )

    assert result.trace.error is not None
    assert result.trace.error.code == "invalid_media_preset_slots"


def test_image_to_image_preset_requires_a_named_runtime_asset_role(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    session = _session(client)
    draft = _preset_draft("kernel_i2i_role_guard", image_slot=True)

    result = tools.execute_kernel_tool(
        tool_name="propose_media_preset_draft",
        arguments=json.dumps({"draft": draft}),
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            session_id=session["assistant_session_id"],
            session=session,
            user_text="Make a separate image-to-image portrait variant.",
        ),
    )

    assert result.trace.error is not None
    assert result.trace.error.code == "invalid_media_preset_slots"
    assert "rules_json.runtime_image_roles" in result.trace.error.message


def test_image_to_image_slot_requires_explicit_user_evidence(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    session = _session(client)
    draft = _preset_draft("kernel_i2i_evidence_guard", image_slot=True)
    draft["rules_json"]["runtime_image_roles"] = {
        "subject_image": {
            "role": "identity and likeness source",
            "user_evidence": "portrait",
        }
    }

    result = tools.execute_kernel_tool(
        tool_name="propose_media_preset_draft",
        arguments=json.dumps({"draft": draft}),
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            session_id=session["assistant_session_id"],
            session=session,
            user_text="Use the attached images only to define the visual style.",
        ),
    )

    assert result.trace.error is not None
    assert result.trace.error.code == "invalid_media_preset_slots"


def test_image_to_image_preset_accepts_one_separate_runtime_portrait(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    session = _session(client)
    draft = _preset_draft("kernel_i2i_portrait_role", image_slot=True)
    draft["input_slots_json"][0]["help_text"] = (
        "Provides the identity and likeness to preserve in the generated image."
    )
    draft["rules_json"]["runtime_image_roles"] = {
        "subject_image": {
            "role": "identity and likeness source",
            "user_evidence": "portrait",
        }
    }

    result = tools.execute_kernel_tool(
        tool_name="propose_media_preset_draft",
        arguments=json.dumps({"draft": draft}),
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            session_id=session["assistant_session_id"],
            session=session,
            user_text="Make a separate image-to-image variant with a portrait input.",
        ),
    )

    assert result.trace.error is None
    assert result.result["lane_quality"] == {
        "lane": "image_to_image",
        "runtime_slot_count": 1,
        "style_reference_role": "analysis_only",
        "input_patterns": ["image_edit"],
        "runtime_roles": {"subject_image": "identity and likeness source"},
    }
    assert "[[subject_image]]" in result.result["draft"]["prompt_template"]


def test_image_to_image_revision_preserves_an_approved_runtime_role(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    store_assistant = importlib.import_module("app.store_assistant")
    session = _session(client)
    original = _preset_draft("kernel_i2i_role_revision", image_slot=True)
    original["rules_json"]["runtime_image_roles"] = {
        "subject_image": {
            "role": "identity and likeness source",
            "user_evidence": "portrait",
        }
    }
    session["summary_json"] = {"kernel_preset_draft": original}
    store_assistant.create_or_update_assistant_session(session)
    revised = {**original, "label": "Revised portrait treatment"}

    result = tools.execute_kernel_tool(
        tool_name="propose_media_preset_draft",
        arguments=json.dumps({"draft": revised}),
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            session_id=session["assistant_session_id"],
            session=session,
            user_text="Rename the preset but keep its approved inputs.",
            artifact_intent="revise_preset",
        ),
    )

    assert result.trace.error is None
    assert result.result["lane_quality"]["runtime_roles"] == {
        "subject_image": "identity and likeness source"
    }


@pytest.mark.parametrize(
    ("image_slot", "wrong_pattern"),
    [(False, "single_image"), (True, "prompt_only")],
)
def test_preset_lane_rejects_the_opposite_input_pattern(
    client,
    image_slot,
    wrong_pattern,
) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    session = _session(client)
    draft = _preset_draft("kernel_lane_pattern_guard", image_slot=image_slot)
    draft["applies_to_input_patterns"] = [wrong_pattern]
    if image_slot:
        draft["rules_json"]["runtime_image_roles"] = {
            "subject_image": {
                "role": "identity and likeness source",
                "user_evidence": "portrait",
            }
        }

    result = tools.execute_kernel_tool(
        tool_name="propose_media_preset_draft",
        arguments=json.dumps({"draft": draft}),
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            session_id=session["assistant_session_id"],
            session=session,
            user_text="Use a portrait only for the separate image-to-image variant.",
        ),
    )

    assert result.trace.error is not None
    assert result.trace.error.code == "invalid_media_preset_slots"


def test_text_to_image_preset_rejects_a_mixed_image_input_pattern(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    session = _session(client)
    draft = _preset_draft("kernel_t2i_mixed_pattern_guard")
    draft["applies_to_input_patterns"] = ["prompt_only", "image_edit"]

    result = tools.execute_kernel_tool(
        tool_name="propose_media_preset_draft",
        arguments=json.dumps({"draft": draft}),
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            session_id=session["assistant_session_id"],
            session=session,
            user_text="Keep this text-to-image with no upload.",
        ),
    )

    assert result.trace.error is not None
    assert result.trace.error.code == "invalid_media_preset_slots"


@pytest.mark.parametrize("field_count", [0, 4])
def test_assistant_preset_draft_requires_one_to_three_fields(client, field_count) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    session = _session(client)
    fields = [
        {
            "key": f"concrete_control_{index}",
            "label": f"Concrete Control {index}",
            "placeholder": f"Enter control {index}",
            "help_text": f"Changes visible element {index} in the generated image.",
            "required": True,
        }
        for index in range(field_count)
    ]
    draft = _preset_draft("kernel_field_count_guard")
    draft["input_schema_json"] = fields
    draft["prompt_template"] = " ".join(
        f"Visible element {{{{concrete_control_{index}}}}}."
        for index in range(field_count)
    )

    result = tools.execute_kernel_tool(
        tool_name="propose_media_preset_draft",
        arguments=json.dumps({"draft": draft}),
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            session_id=session["assistant_session_id"],
            session=session,
        ),
    )

    assert result.trace.error is not None
    assert result.trace.error.code == "invalid_media_preset_fields"


def test_assistant_preset_fields_explain_input_and_visual_outcome(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    session = _session(client)
    draft = _preset_draft(
        "kernel_field_guidance_guard",
        fields=[
            {
                "key": "destination",
                "label": "Destination",
                "required": True,
            }
        ],
    )
    draft["prompt_template"] = "Travel poster for {{destination}}"

    result = tools.execute_kernel_tool(
        tool_name="propose_media_preset_draft",
        arguments=json.dumps({"draft": draft}),
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            session_id=session["assistant_session_id"],
            session=session,
        ),
    )

    assert result.trace.error is not None
    assert result.trace.error.code == "invalid_media_preset_fields"


def test_reference_based_preset_fields_require_structured_visual_evidence(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    store_assistant = importlib.import_module("app.store_assistant")
    session = _session(client)
    session["summary_json"] = {
        "reference_analysis_cache": {
            "current": {
                "analysis": {
                    "replaceable_elements": ["destination", "vehicle model"],
                }
            }
        }
    }
    store_assistant.create_or_update_assistant_session(session)
    draft = _preset_draft(
        "kernel_field_evidence_guard",
        fields=[
            {
                "key": "destination",
                "label": "Destination",
                "placeholder": "e.g. coastal observatory",
                "help_text": "Changes the featured place and surrounding landmarks.",
                "required": True,
            }
        ],
    )
    draft["prompt_template"] = "Travel poster for {{destination}}"
    draft["rules_json"] = {
        "output_kind": "image",
        "preset_lane": "text_to_image",
        "field_evidence": {"destination": "art"},
    }

    result = tools.execute_kernel_tool(
        tool_name="propose_media_preset_draft",
        arguments=json.dumps({"draft": draft}),
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            session_id=session["assistant_session_id"],
            session=session,
            user_text="Make it a cartoon scene.",
        ),
    )

    assert result.trace.error is not None
    assert result.trace.error.code == "invalid_media_preset_fields"


@pytest.mark.parametrize(
    ("case_id", "replaceable_elements", "fields", "user_text"),
    [
        (
            "field_guide",
            ["profession or practitioner", "featured equipment"],
            [
                ("profession_practitioner", "Profession / Practitioner", "profession or practitioner"),
                ("supporting_materials", "Supporting Materials", "supporting materials"),
            ],
            "Keep Profession / Practitioner and rename the second choice to Supporting Materials.",
        ),
        (
            "travel_print",
            ["destination", "route name"],
            [
                ("destination", "Destination", "destination"),
                ("route_name", "Route Name", "route name"),
            ],
            "Make the destination and route name editable.",
        ),
        (
            "vehicle_diagram",
            ["vehicle model", "model year"],
            [
                ("vehicle_model", "Vehicle Model", "vehicle model"),
                ("model_year", "Model Year", "model year"),
            ],
            "Let me change the vehicle model and model year.",
        ),
        (
            "fashion_portrait",
            ["outfit style"],
            [("outfit_style", "Outfit Style", "outfit style")],
            "Keep one editable clothing choice.",
        ),
    ],
)
def test_reference_based_field_contracts_score_at_least_nine(
    client,
    case_id,
    replaceable_elements,
    fields,
    user_text,
) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    store_assistant = importlib.import_module("app.store_assistant")
    session = _session(client)
    session["summary_json"] = {
        "reference_analysis_cache": {
            case_id: {"analysis": {"replaceable_elements": replaceable_elements}}
        }
    }
    store_assistant.create_or_update_assistant_session(session)
    field_contracts = [
        {
            "key": key,
            "label": label,
            "placeholder": f"Enter {label.lower()}",
            "help_text": f"Changes the visible {label.lower()} in the generated image.",
            "required": True,
        }
        for key, label, _evidence in fields
    ]
    draft = _preset_draft(f"kernel_quality_{case_id}", fields=field_contracts)
    draft["prompt_template"] = " ".join(
        f"Visible {label.lower()}: {{{{{key}}}}}." for key, label, _evidence in fields
    )
    draft["rules_json"] = {
        "output_kind": "image",
        "preset_lane": "text_to_image",
        "field_evidence": {key: evidence for key, _label, evidence in fields},
    }

    result = tools.execute_kernel_tool(
        tool_name="propose_media_preset_draft",
        arguments=json.dumps({"draft": draft}),
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            session_id=session["assistant_session_id"],
            session=session,
            user_text=user_text,
        ),
    )

    assert result.trace.error is None
    assert result.result["field_quality"]["score"] >= 9
    assert result.result["field_quality"]["field_count"] == len(fields)
    assert result.result["lane_quality"]["lane"] == "text_to_image"
    assert result.result["lane_quality"]["runtime_slot_count"] == 0
    assert result.result["lane_quality"]["style_reference_role"] == "analysis_only"


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

    assert calls == 2
    assert result.trace.termination == "completed"
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

    assert calls == 1
    assert result.trace.termination == "completed"
    assert result.reply
    assert [trace.tool_name for trace in result.trace.tool_calls] == ["propose_media_preset_draft"]


def test_valid_preset_artifact_without_same_step_reply_completes_before_wall_clock(
    client,
    monkeypatch,
) -> None:
    kernel = importlib.import_module("app.assistant.kernel")
    session = _session(client)
    now = 0.0
    provider_calls = 0

    monkeypatch.setattr(kernel.time, "perf_counter", lambda: now)

    def provider_step(**_kwargs):
        nonlocal now, provider_calls
        provider_calls += 1
        now = 1.0
        return {
            "capability": "preset_builder",
            "artifact_intent": "draft_preset",
            "tool_call": {
                "name": "propose_media_preset_draft",
                "arguments": json.dumps(
                    {"draft": _preset_draft("kernel_artifact_before_timeout")}
                ),
            },
        }

    monkeypatch.setattr(kernel, "run_kernel_provider_step", provider_step)

    result = kernel.run_assistant_kernel_turn(
        session=session,
        user_text="Help me turn this direction into a reusable preset.",
        workflow=None,
        canvas_context={},
        assistant_mode="preset",
        max_wall_seconds=0.5,
    )

    assert provider_calls == 1
    assert result.trace.step_count == 1
    assert any(artifact.kind == "preset_draft" for artifact in result.artifacts)
    assert result.reply.strip()
    assert result.trace.termination == "completed"


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
        fields=[
            {
                "key": "time_of_day",
                "label": "Time of Day",
                "placeholder": "e.g. blue hour",
                "help_text": "Changes the visible lighting and time in the generated image.",
                "required": True,
            }
        ],
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
    store = importlib.import_module("app.store")
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
                            "summary": "Prepare the standard text-to-image preset test.",
                            "template_id": "preset_style_t2i_sandbox_v1",
                            "field_values": {"location": "desert research station"},
                        }
                        ),
                    },
                },
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
    assert graph["validation"]["errors"] == []
    assert graph["pricing"]["pricing_summary"]["total"]["estimated_credits"] is not None
    assert [node["type"] for node in graph["workflow"]["nodes"]] == [
        "prompt.text",
        "model.kie.gpt_image_2_text_to_image",
        "preview.image",
    ]
    assert len(graph["workflow"]["edges"]) == 2
    prompt, model, _preview = graph["workflow"]["nodes"]
    assert prompt["fields"]["text"] == "Warm cinematic coverage board for desert research station"
    assert model["fields"]["aspect_ratio"] == "1:1"
    metadata = graph["workflow"]["metadata"]["assistant_plan"]
    assert metadata["template_id"] == "preset_style_t2i_sandbox_v1"
    assert metadata["template_mode"] == "text_to_image"
    assert metadata["template_slot_count"] == 0
    persisted = store_assistant.get_assistant_plan(graph["proposal_id"])
    assert persisted["plan_json"]["metadata"]["template_id"] == "preset_style_t2i_sandbox_v1"
    assert store.list_jobs(limit=200) == []
    assert result.reply.strip()
    assert result.trace.step_count == 1
    assert result.trace.termination == "completed"
    assert result.next_action.kind == "confirm_graph"
    assert result.next_action.requires_confirmation is True


def test_preset_test_graph_compiles_human_field_values_without_mutating_reusable_draft(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    store_assistant = importlib.import_module("app.store_assistant")
    session = _session(client)
    draft = _preset_draft(
        "kernel_human_sample_values",
        fields=[
            {
                "key": "destination",
                "label": "Destination",
                "placeholder": "e.g. Kyoto",
                "help_text": "Changes the featured place.",
                "required": True,
            },
            {
                "key": "mood",
                "label": "Mood",
                "placeholder": "e.g. sunset optimism",
                "help_text": "Changes the atmosphere.",
                "required": True,
            },
        ],
    )
    draft["prompt_template"] = "Bold retro travel poster for {{destination}} with {{mood}}."
    summary = dict(session.get("summary_json") or {})
    summary["kernel_preset_draft"] = draft
    session = store_assistant.create_or_update_assistant_session({**session, "summary_json": summary})

    execution = tools.execute_kernel_tool(
        tool_name="propose_graph_operations",
        arguments={
            "summary": "Prepare the standard text-to-image preset test with human sample values.",
            "template_id": "preset_style_t2i_sandbox_v1",
            "field_values": {
                "destination": "Kyoto",
                "mood": "sunset optimism",
            },
        },
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            session_id=session["assistant_session_id"],
            session=session,
        ),
    )

    assert execution.trace.error is None
    prompt_node = next(
        node for node in execution.result["workflow"]["nodes"] if node["type"] == "prompt.text"
    )
    assert prompt_node["fields"]["text"] == "Bold retro travel poster for Kyoto with sunset optimism."
    assert "{{" not in prompt_node["fields"]["text"]
    metadata = execution.result["workflow"]["metadata"]["assistant_plan"]
    assert metadata["template_field_keys"] == ["destination", "mood"]
    assert metadata["template_field_values_supplied"] is True
    stored = store_assistant.get_assistant_session(session["assistant_session_id"])
    assert stored["summary_json"]["kernel_preset_draft"]["prompt_template"] == draft["prompt_template"]
    assert stored["summary_json"]["kernel_preset_draft"]["input_schema_json"] == draft["input_schema_json"]


def test_preset_test_graph_rejects_unknown_human_field_value_before_plan_persistence(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    store_assistant = importlib.import_module("app.store_assistant")
    session = _session(client)
    summary = dict(session.get("summary_json") or {})
    summary["kernel_preset_draft"] = _preset_draft("kernel_unknown_sample_value")
    session = store_assistant.create_or_update_assistant_session({**session, "summary_json": summary})

    execution = tools.execute_kernel_tool(
        tool_name="propose_graph_operations",
        arguments={
            "summary": "Prepare the preset test.",
            "template_id": "preset_style_t2i_sandbox_v1",
            "field_values": {"not_a_preset_field": "Kyoto"},
        },
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            session_id=session["assistant_session_id"],
            session=session,
        ),
    )

    assert execution.result is None
    assert execution.trace.error.code == "preset_test_field_value_invalid"
    assert store_assistant.list_assistant_plans(session["assistant_session_id"]) == []


def test_preset_test_graph_requires_values_instead_of_persisting_raw_placeholders(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    store_assistant = importlib.import_module("app.store_assistant")
    session = _session(client)
    summary = dict(session.get("summary_json") or {})
    summary["kernel_preset_draft"] = _preset_draft("kernel_missing_sample_value")
    session = store_assistant.create_or_update_assistant_session({**session, "summary_json": summary})

    execution = tools.execute_kernel_tool(
        tool_name="propose_graph_operations",
        arguments={
            "summary": "Prepare the preset test.",
            "template_id": "preset_style_t2i_sandbox_v1",
        },
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            session_id=session["assistant_session_id"],
            session=session,
        ),
    )

    assert execution.result is None
    assert execution.trace.error.code == "preset_test_field_values_required"
    assert execution.trace.error.details["missing_field_keys"] == ["location"]
    assert store_assistant.list_assistant_plans(session["assistant_session_id"]) == []


def test_preset_test_graph_supports_three_validated_field_values(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    store_assistant = importlib.import_module("app.store_assistant")
    session = _session(client)
    fields = [
        {
            "key": key,
            "label": label,
            "placeholder": placeholder,
            "help_text": help_text,
            "required": True,
        }
        for key, label, placeholder, help_text in [
            ("destination", "Destination", "e.g. Kyoto", "Changes the featured destination."),
            ("mood", "Mood", "e.g. sunset optimism", "Changes the atmosphere."),
            ("headline", "Headline", "e.g. Visit Kyoto", "Changes the visible title."),
        ]
    ]
    draft = _preset_draft("kernel_three_sample_values", fields=fields)
    draft["prompt_template"] = "Poster for {{destination}} with {{mood}}, titled {{headline}}."
    summary = dict(session.get("summary_json") or {})
    summary["kernel_preset_draft"] = draft
    session = store_assistant.create_or_update_assistant_session({**session, "summary_json": summary})

    execution = tools.execute_kernel_tool(
        tool_name="propose_graph_operations",
        arguments={
            "summary": "Prepare the three-field preset test.",
            "template_id": "preset_style_t2i_sandbox_v1",
            "field_values": {
                "destination": "Kyoto",
                "mood": "sunset optimism",
                "headline": "Visit Kyoto",
            },
        },
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            session_id=session["assistant_session_id"],
            session=session,
        ),
    )

    assert execution.trace.error is None
    prompt = next(
        node for node in execution.result["workflow"]["nodes"] if node["type"] == "prompt.text"
    )["fields"]["text"]
    assert prompt == "Poster for Kyoto with sunset optimism, titled Visit Kyoto."
    assert "{{" not in prompt


def test_focused_output_refinement_changes_only_prompt_and_preserves_contract(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    store_assistant = importlib.import_module("app.store_assistant")
    session = _session(client)
    draft = _preset_draft("kernel_focused_output_refinement")
    comparison_id = "presetcmp-focused-refinement"
    summary = dict(session.get("summary_json") or {})
    summary.update(
        {
            "kernel_preset_draft": draft,
            "kernel_preset_output_comparison": {
                "comparison_id": comparison_id,
                "run_id": "grun-focused-refinement",
                "output_asset_id": "asset-focused-refinement",
                "comparison": {
                    "matches": ["warm amber palette"],
                    "missing_or_drifting": ["edge texture is too clean"],
                    "prompt_delta": "Add restrained dry-ink edge texture.",
                    "preserve_traits": ["warm amber palette", "cinematic framing"],
                    "meaningful_gap": True,
                },
                "quality_state": "reviewed",
            },
            "kernel_preset_quality": {
                "quality_state": "needs_work",
                "decision": "continue",
                "comparison_id": comparison_id,
                "run_id": "grun-focused-refinement",
                "output_asset_id": "asset-focused-refinement",
            },
            "kernel_run_confirmation": {
                "assistant_run_id": "grun-focused-refinement",
                "consumed": True,
            },
        }
    )
    session = store_assistant.create_or_update_assistant_session({**session, "summary_json": summary})
    revised = json.loads(json.dumps(draft))
    revised["prompt_template"] += " Add restrained dry-ink edge texture."

    execution = tools.execute_kernel_tool(
        tool_name="propose_media_preset_draft",
        arguments={"draft": revised, "comparison_id": comparison_id},
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            user_text="Use that focused improvement and keep everything else the same.",
            artifact_intent="revise_preset",
            session_id=session["assistant_session_id"],
            session=session,
        ),
    )

    assert execution.trace.error is None
    assert execution.result["refined_from_comparison_id"] == comparison_id
    stored = store_assistant.get_assistant_session(session["assistant_session_id"])["summary_json"]
    assert stored["kernel_preset_draft"]["prompt_template"] == revised["prompt_template"]
    for key in draft:
        if key != "prompt_template":
            assert stored["kernel_preset_draft"][key] == draft[key]
    history = stored["kernel_preset_refinement_history"]
    assert history[-1]["comparison_id"] == comparison_id
    assert history[-1]["preserve_traits"] == ["warm amber palette", "cinematic framing"]
    assert history[-1]["previous_draft_hash"] != history[-1]["revised_draft_hash"]
    assert "kernel_preset_run_evidence" not in stored
    assert "kernel_preset_output_comparison" not in stored
    assert "kernel_preset_quality" not in stored
    assert "kernel_run_confirmation" not in stored


def test_focused_output_refinement_rejects_unrelated_contract_change(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    store_assistant = importlib.import_module("app.store_assistant")
    session = _session(client)
    draft = _preset_draft("kernel_refinement_scope_guard")
    comparison_id = "presetcmp-scope-guard"
    summary = dict(session.get("summary_json") or {})
    summary.update(
        {
            "kernel_preset_draft": draft,
            "kernel_preset_output_comparison": {
                "comparison_id": comparison_id,
                "run_id": "grun-scope-guard",
                "output_asset_id": "asset-scope-guard",
                "comparison": {
                    "matches": ["warm amber palette"],
                    "missing_or_drifting": ["edge texture is too clean"],
                    "prompt_delta": "Add restrained dry-ink edge texture.",
                    "preserve_traits": ["warm amber palette"],
                    "meaningful_gap": True,
                },
                "quality_state": "reviewed",
            },
            "kernel_preset_quality": {
                "quality_state": "needs_work",
                "decision": "continue",
                "comparison_id": comparison_id,
                "run_id": "grun-scope-guard",
                "output_asset_id": "asset-scope-guard",
            },
        }
    )
    session = store_assistant.create_or_update_assistant_session({**session, "summary_json": summary})
    revised = json.loads(json.dumps(draft))
    revised["prompt_template"] += " Add restrained dry-ink edge texture."
    revised["input_schema_json"][0]["label"] = "Unrelated Field Rename"

    execution = tools.execute_kernel_tool(
        tool_name="propose_media_preset_draft",
        arguments={"draft": revised, "comparison_id": comparison_id},
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            user_text="Use only that focused prompt improvement.",
            artifact_intent="revise_preset",
            session_id=session["assistant_session_id"],
            session=session,
        ),
    )

    assert execution.result is None
    assert execution.trace.error.code == "preset_refinement_scope_changed"
    stored = store_assistant.get_assistant_session(session["assistant_session_id"])["summary_json"]
    assert stored["kernel_preset_draft"] == draft
    assert stored["kernel_preset_output_comparison"]["comparison_id"] == comparison_id


def test_normal_revision_preserves_approved_reference_analysis_binding(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    store_assistant = importlib.import_module("app.store_assistant")
    session = _session(client)
    draft = _preset_draft("kernel_preserved_analysis_binding")
    draft["rules_json"]["analysis_id"] = "visual-approved-style"
    draft["rules_json"]["field_evidence"] = {"location": "location"}
    session = store_assistant.create_or_update_assistant_session(
        {
            **session,
            "summary_json": {
                "kernel_preset_draft": draft,
                "reference_analysis_cache": {
                    "approved": {
                        "analysis_id": "visual-approved-style",
                        "goal": "preset_design",
                        "reference_ids": ["approved-style-reference"],
                        "analysis": {"replaceable_elements": ["location"]},
                    },
                    "later-unrelated": {
                        "analysis_id": "visual-unrelated-story",
                        "goal": "story_continuity",
                        "reference_ids": ["unrelated-story-reference"],
                        "analysis": {"replaceable_elements": ["vehicle model"]},
                    },
                },
            },
        }
    )
    revised = json.loads(json.dumps(draft))
    revised["description"] = "A revised description that leaves the approved visual source intact."

    execution = tools.execute_kernel_tool(
        tool_name="propose_media_preset_draft",
        arguments={"draft": revised},
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            user_text="Tighten the description and keep the visual style the same.",
            artifact_intent="revise_preset",
            session_id=session["assistant_session_id"],
            session=session,
        ),
    )

    assert execution.trace.error is None
    assert execution.result["draft"]["rules_json"]["analysis_id"] == "visual-approved-style"


def test_continued_output_refinement_requires_exact_comparison_binding(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    store_assistant = importlib.import_module("app.store_assistant")
    session = _session(client)
    draft = _preset_draft("kernel_refinement_binding_guard")
    comparison_id = "presetcmp-binding-guard"
    summary = dict(session.get("summary_json") or {})
    summary.update(
        {
            "kernel_preset_draft": draft,
            "kernel_preset_output_comparison": {
                "comparison_id": comparison_id,
                "run_id": "grun-binding-guard",
                "output_asset_id": "asset-binding-guard",
                "comparison": {
                    "matches": ["warm amber palette"],
                    "missing_or_drifting": ["edge texture is too clean"],
                    "prompt_delta": "Add restrained dry-ink edge texture.",
                    "preserve_traits": ["warm amber palette"],
                    "meaningful_gap": True,
                },
                "quality_state": "reviewed",
            },
            "kernel_preset_quality": {
                "quality_state": "needs_work",
                "decision": "continue",
                "comparison_id": comparison_id,
                "run_id": "grun-binding-guard",
                "output_asset_id": "asset-binding-guard",
            },
        }
    )
    session = store_assistant.create_or_update_assistant_session({**session, "summary_json": summary})
    revised = json.loads(json.dumps(draft))
    revised["prompt_template"] += " Add restrained dry-ink edge texture."

    execution = tools.execute_kernel_tool(
        tool_name="propose_media_preset_draft",
        arguments={"draft": revised},
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            user_text="Use the accepted focused improvement.",
            artifact_intent="revise_preset",
            session_id=session["assistant_session_id"],
            session=session,
        ),
    )

    assert execution.result is None
    assert execution.trace.error.code == "preset_refinement_comparison_required"
    stored = store_assistant.get_assistant_session(session["assistant_session_id"])["summary_json"]
    assert stored["kernel_preset_draft"] == draft
    assert stored["kernel_preset_quality"]["decision"] == "continue"


def test_focused_output_refinement_rejects_wholesale_prompt_rewrite(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    store_assistant = importlib.import_module("app.store_assistant")
    session = _session(client)
    draft = _preset_draft("kernel_refinement_prompt_guard")
    comparison_id = "presetcmp-prompt-guard"
    summary = dict(session.get("summary_json") or {})
    summary.update(
        {
            "kernel_preset_draft": draft,
            "kernel_preset_output_comparison": {
                "comparison_id": comparison_id,
                "run_id": "grun-prompt-guard",
                "output_asset_id": "asset-prompt-guard",
                "comparison": {
                    "matches": ["warm amber palette"],
                    "missing_or_drifting": ["edge texture is too clean"],
                    "prompt_delta": "Add restrained dry-ink edge texture.",
                    "preserve_traits": ["warm amber palette", "cinematic framing"],
                    "meaningful_gap": True,
                },
                "quality_state": "reviewed",
            },
            "kernel_preset_quality": {
                "quality_state": "needs_work",
                "decision": "continue",
                "comparison_id": comparison_id,
                "run_id": "grun-prompt-guard",
                "output_asset_id": "asset-prompt-guard",
            },
        }
    )
    session = store_assistant.create_or_update_assistant_session({**session, "summary_json": summary})
    rewritten = json.loads(json.dumps(draft))
    rewritten["prompt_template"] = (
        "Unrelated glossy 3D scene for {{location}}. Add restrained dry-ink edge texture."
    )

    execution = tools.execute_kernel_tool(
        tool_name="propose_media_preset_draft",
        arguments={"draft": rewritten, "comparison_id": comparison_id},
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            user_text="Apply only the accepted focused improvement.",
            artifact_intent="revise_preset",
            session_id=session["assistant_session_id"],
            session=session,
        ),
    )

    assert execution.result is None
    assert execution.trace.error.code == "preset_refinement_prompt_mismatch"
    stored = store_assistant.get_assistant_session(session["assistant_session_id"])["summary_json"]
    assert stored["kernel_preset_draft"] == draft


def test_preset_image_template_wires_one_unfilled_slot_without_starting_a_job(client, monkeypatch) -> None:
    kernel = importlib.import_module("app.assistant.kernel")
    store = importlib.import_module("app.store")
    store_assistant = importlib.import_module("app.store_assistant")
    session = _session(client)
    summary = dict(session.get("summary_json") or {})
    summary["kernel_preset_draft"] = _preset_draft("kernel_image_graph_preset", image_slot=True)
    session = store_assistant.create_or_update_assistant_session({**session, "summary_json": summary})
    monkeypatch.setattr(
        kernel,
        "run_kernel_provider_step",
        lambda **_kwargs: {
            "capability": "preset_builder",
            "tool_call": {
                "name": "propose_graph_operations",
                "arguments": json.dumps(
                    {
                        "summary": "Prepare the standard image-to-image preset test.",
                        "template_id": "preset_style_i2i_sandbox_v1",
                        "field_values": {"location": "desert research station"},
                    }
                ),
            },
        },
    )

    result = kernel.run_assistant_kernel_turn(
        session=session,
        user_text="Create the image test graph.",
        workflow=kernel.GraphWorkflow(name="Preset image test"),
        canvas_context={},
        assistant_mode="preset",
    )

    assert result.trace.tool_calls[0].error is None, result.trace.tool_calls[0].error
    graph = next(item.data for item in result.artifacts if item.kind == "graph_proposal")
    assert [node["type"] for node in graph["workflow"]["nodes"]] == [
        "media.load_image",
        "prompt.text",
        "model.kie.gpt_image_2_image_to_image",
        "preview.image",
    ]
    assert len(graph["workflow"]["edges"]) == 3
    assert graph["validation"]["valid"] is False
    assert [error["code"] for error in graph["validation"]["errors"]] == ["missing_media_reference"]
    assert graph["pending_user_inputs"][0]["code"] == "missing_media_reference"
    metadata = graph["workflow"]["metadata"]["assistant_plan"]
    assert metadata["template_id"] == "preset_style_i2i_sandbox_v1"
    assert metadata["template_mode"] == "image_to_image"
    assert metadata["template_slot_count"] == 1
    assert store.list_jobs(limit=200) == []
    assert result.next_action.kind == "confirm_graph"


def test_preset_builder_normalizes_hand_authored_test_graph_to_the_standard_template(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    store_assistant = importlib.import_module("app.store_assistant")
    session = _session(client)
    summary = dict(session.get("summary_json") or {})
    summary["kernel_preset_draft"] = _preset_draft("kernel_template_required_preset")
    session = store_assistant.create_or_update_assistant_session({**session, "summary_json": summary})

    execution = tools.execute_kernel_tool(
        tool_name="propose_graph_operations",
        arguments={
            "summary": "Hand-authored test graph",
            "operations": [
                {
                    "op": "add_node",
                    "node_ref": "model",
                    "node_type": "model.kie.gpt_image_2_text_to_image",
                }
            ],
            "field_values": {"location": "desert research station"},
        },
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            session_id=session["assistant_session_id"],
            session=session,
        ),
    )

    assert execution.trace.error is None
    assert execution.result is not None
    assert execution.result["workflow"]["metadata"]["assistant_plan"]["template_id"] == "preset_style_t2i_sandbox_v1"
    assert [node["type"] for node in execution.result["workflow"]["nodes"]] == [
        "prompt.text",
        "model.kie.gpt_image_2_text_to_image",
        "preview.image",
    ]


def test_preset_save_requires_applied_priced_graph_and_one_time_confirmation(client, monkeypatch) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    kernel = importlib.import_module("app.assistant.kernel")
    store = importlib.import_module("app.store")
    store_assistant = importlib.import_module("app.store_assistant")
    session = _session(client)
    plan = _applied_test_plan(store_assistant, session["assistant_session_id"])
    key = "kernel_confirmed_amber_coverage"
    draft = _preset_draft(key)
    session = _session_with_preset_quality(store_assistant, session, plan, draft)
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
    assert action["payload"]["quality_state"] == "quality_verified"
    assert artifact["data"]["test_graph"]["validation"]["valid"] is True
    assert artifact["data"]["test_graph"]["pricing"]["pricing_summary"]["total"]["estimated_credits"] == 6.0
    assert store.get_preset_by_key(key) == before

    invalid = client.post(
        f"/media/assistant/sessions/{session['assistant_session_id']}/preset-saves",
        json={
            "message": "Save the approved Media Preset draft.",
            "proposal_id": action["proposal_id"],
            "confirmation_token": "stale-confirmation-token",
        },
    )
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

    assert invalid.status_code == 400
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


def test_applied_priced_graph_is_test_ready_without_verified_save(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    store_assistant = importlib.import_module("app.store_assistant")
    session = _session(client)
    plan = _applied_test_plan(store_assistant, session["assistant_session_id"])

    proposed = tools.execute_kernel_tool(
        tool_name="propose_media_preset_draft",
        arguments=json.dumps(
            {
                "draft": _preset_draft("kernel_test_ready_save_guard"),
                "test_plan_id": plan["assistant_plan_id"],
            }
        ),
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            session_id=session["assistant_session_id"],
            session=session,
            artifact_intent="save_preset",
        ),
    )

    assert proposed.trace.error is None
    assert proposed.result["quality_state"] == "test_ready"
    assert proposed.result["save_ready"] is False
    assert proposed.result["confirmation_token"] is None


def test_failed_run_cannot_produce_verified_preset_save(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    store_assistant = importlib.import_module("app.store_assistant")
    session = _session(client)
    plan = _applied_test_plan(store_assistant, session["assistant_session_id"])
    draft = _preset_draft("kernel_failed_run_save_guard")
    session = _session_with_preset_quality(
        store_assistant,
        session,
        plan,
        draft,
        run_status="failed",
    )

    proposed = tools.execute_kernel_tool(
        tool_name="propose_media_preset_draft",
        arguments={"draft": draft, "test_plan_id": plan["assistant_plan_id"]},
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            session_id=session["assistant_session_id"],
            session=session,
            artifact_intent="save_preset",
        ),
    )

    assert proposed.trace.error is None
    assert proposed.result["quality_state"] == "test_ready"
    assert proposed.result["save_ready"] is False
    assert proposed.result["confirmation_token"] is None


def test_other_plan_run_cannot_produce_verified_preset_save(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    store_assistant = importlib.import_module("app.store_assistant")
    session = _session(client)
    plan = _applied_test_plan(store_assistant, session["assistant_session_id"])
    draft = _preset_draft("kernel_wrong_plan_save_guard")
    session = _session_with_preset_quality(
        store_assistant,
        session,
        plan,
        draft,
        evidence_plan_id="asplan-other-preset-test",
    )

    proposed = tools.execute_kernel_tool(
        tool_name="propose_media_preset_draft",
        arguments={"draft": draft, "test_plan_id": plan["assistant_plan_id"]},
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            session_id=session["assistant_session_id"],
            session=session,
            artifact_intent="save_preset",
        ),
    )

    assert proposed.trace.error is None
    assert proposed.result["quality_state"] == "test_ready"
    assert proposed.result["save_ready"] is False
    assert proposed.result["confirmation_token"] is None


def test_changed_applied_plan_snapshot_cannot_produce_verified_preset_save(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    store_assistant = importlib.import_module("app.store_assistant")
    session = _session(client)
    plan = _applied_test_plan(store_assistant, session["assistant_session_id"])
    draft = _preset_draft("kernel_changed_plan_snapshot_guard")
    session = _session_with_preset_quality(store_assistant, session, plan, draft)
    store_assistant.create_or_update_assistant_plan(
        {
            **plan,
            "workflow_json": {
                **plan["workflow_json"],
                "nodes": [{
                    "id": "changed-prompt",
                    "type": "prompt.text",
                    "position": {"x": 0, "y": 0},
                    "fields": {"text": "Changed after the reviewed run"},
                }],
            },
        }
    )

    proposed = tools.execute_kernel_tool(
        tool_name="propose_media_preset_draft",
        arguments={"draft": draft, "test_plan_id": plan["assistant_plan_id"]},
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            session_id=session["assistant_session_id"],
            session=session,
            artifact_intent="save_preset",
        ),
    )

    assert proposed.trace.error is None
    assert proposed.result["quality_state"] == "test_ready"
    assert proposed.result["save_ready"] is False


def test_verified_preset_save_rechecks_quality_at_write_time(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    store = importlib.import_module("app.store")
    store_assistant = importlib.import_module("app.store_assistant")
    session = _session(client)
    plan = _applied_test_plan(store_assistant, session["assistant_session_id"])
    key = "kernel_stale_quality_save_guard"
    draft = _preset_draft(key)
    session = _session_with_preset_quality(store_assistant, session, plan, draft)
    proposed = tools.execute_kernel_tool(
        tool_name="propose_media_preset_draft",
        arguments={"draft": draft, "test_plan_id": plan["assistant_plan_id"]},
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            session_id=session["assistant_session_id"],
            session=session,
            artifact_intent="save_preset",
        ),
    )
    assert proposed.result["quality_state"] == "quality_verified"
    assert proposed.result["save_ready"] is True

    current = store_assistant.get_assistant_session(session["assistant_session_id"])
    summary = dict(current["summary_json"])
    summary["kernel_preset_quality"] = {
        **summary["kernel_preset_quality"],
        "quality_state": "stopped",
        "decision": "stop",
        "user_approved": False,
    }
    store_assistant.create_or_update_assistant_session({**current, "summary_json": summary})

    saved = client.post(
        f"/media/assistant/sessions/{session['assistant_session_id']}/preset-saves",
        json={
            "message": "Save the approved Media Preset draft.",
            "proposal_id": proposed.result["proposal_id"],
            "confirmation_token": proposed.result["confirmation_token"],
        },
    )

    assert saved.status_code == 400
    assert store.get_preset_by_key(key) is None


def test_verified_quality_survives_name_only_save_change(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    store_assistant = importlib.import_module("app.store_assistant")
    session = _session(client)
    plan = _applied_test_plan(store_assistant, session["assistant_session_id"])
    approved_draft = _preset_draft("kernel_approved_name")
    session = _session_with_preset_quality(
        store_assistant,
        session,
        plan,
        approved_draft,
    )
    named_draft = {
        **approved_draft,
        "key": "kernel_final_named_preset",
        "label": "Final Named Preset",
    }

    proposed = tools.execute_kernel_tool(
        tool_name="propose_media_preset_draft",
        arguments={"draft": named_draft, "test_plan_id": plan["assistant_plan_id"]},
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            session_id=session["assistant_session_id"],
            session=session,
            artifact_intent="save_preset",
        ),
    )

    assert proposed.trace.error is None
    assert proposed.result["quality_state"] == "quality_verified"
    assert proposed.result["save_mode"] == "verified"
    assert proposed.result["save_ready"] is True
    stored = store_assistant.get_assistant_session(session["assistant_session_id"])
    assert stored["summary_json"]["kernel_preset_quality"]["user_approved"] is True


def test_verified_quality_accepts_a_legacy_plan_without_contract_hash(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    store_assistant = importlib.import_module("app.store_assistant")
    session = _session(client)
    draft = _preset_draft("kernel_legacy_verified_plan")
    plan = _applied_test_plan(
        store_assistant,
        session["assistant_session_id"],
        draft=draft,
    )
    metadata = dict(plan["plan_json"]["metadata"])
    metadata.pop("preset_quality_contract_hash")
    plan = store_assistant.create_or_update_assistant_plan(
        {
            **plan,
            "plan_json": {**plan["plan_json"], "metadata": metadata},
        }
    )
    session = _session_with_preset_quality(store_assistant, session, plan, draft)

    proposed = tools.execute_kernel_tool(
        tool_name="propose_media_preset_draft",
        arguments={"draft": draft, "test_plan_id": plan["assistant_plan_id"]},
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            session_id=session["assistant_session_id"],
            session=session,
            artifact_intent="save_preset",
        ),
    )

    assert proposed.trace.error is None
    assert proposed.result["quality_state"] == "quality_verified"
    assert proposed.result["save_mode"] == "verified"


def test_unverified_preset_save_is_separate_and_single_use(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    store = importlib.import_module("app.store")
    store_assistant = importlib.import_module("app.store_assistant")
    session = _session(client)
    plan = _applied_test_plan(store_assistant, session["assistant_session_id"])
    key = "kernel_explicit_unverified_save"
    draft = _preset_draft(key)

    offered = tools.execute_kernel_tool(
        tool_name="propose_media_preset_draft",
        arguments={"draft": draft, "test_plan_id": plan["assistant_plan_id"]},
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            session_id=session["assistant_session_id"],
            session=session,
            user_message_id="asmsg-unverified-offer",
            artifact_intent="save_preset",
        ),
    )
    assert offered.trace.error is None
    assert offered.result["save_ready"] is False

    session = store_assistant.get_assistant_session(session["assistant_session_id"])
    proposed = tools.execute_kernel_tool(
        tool_name="propose_media_preset_draft",
        arguments={
            "draft": draft,
            "allow_unverified_save": True,
        },
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            session_id=session["assistant_session_id"],
            session=session,
            user_message_id="asmsg-unverified-accept",
            artifact_intent="save_preset",
        ),
    )

    assert proposed.trace.error is None
    assert proposed.result["quality_state"] == "test_ready"
    assert proposed.result["save_mode"] == "unverified"
    assert proposed.result["save_ready"] is True
    assert proposed.result["requires_confirmation"] is True

    payload = {
        "message": "Save the unverified Media Preset draft.",
        "proposal_id": proposed.result["proposal_id"],
        "confirmation_token": proposed.result["confirmation_token"],
    }
    saved = client.post(
        f"/media/assistant/sessions/{session['assistant_session_id']}/preset-saves",
        json=payload,
    )
    replay = client.post(
        f"/media/assistant/sessions/{session['assistant_session_id']}/preset-saves",
        json=payload,
    )

    assert saved.status_code == 200, saved.text
    assert saved.json()["record"]["key"] == key
    assert saved.json()["assistant_session"]["summary_json"]["kernel_preset_proposal"]["consumed"] is True
    assert replay.status_code == 400
    assert store.get_preset_by_key(key) is not None


def test_unverified_preset_save_rechecks_plan_contract_at_write_time(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    store_assistant = importlib.import_module("app.store_assistant")
    session = _session(client)
    draft = _preset_draft("kernel_stale_unverified_plan")
    plan = _applied_test_plan(
        store_assistant,
        session["assistant_session_id"],
        draft=draft,
    )
    offered = tools.execute_kernel_tool(
        tool_name="propose_media_preset_draft",
        arguments={"draft": draft, "test_plan_id": plan["assistant_plan_id"]},
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            session_id=session["assistant_session_id"],
            session=session,
            user_message_id="asmsg-stale-unverified-offer",
            artifact_intent="save_preset",
        ),
    )
    assert offered.trace.error is None
    session = store_assistant.get_assistant_session(session["assistant_session_id"])
    proposed = tools.execute_kernel_tool(
        tool_name="propose_media_preset_draft",
        arguments={"draft": draft, "allow_unverified_save": True},
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            session_id=session["assistant_session_id"],
            session=session,
            user_message_id="asmsg-stale-unverified-accept",
            artifact_intent="save_preset",
        ),
    )
    assert proposed.trace.error is None
    metadata = dict(plan["plan_json"]["metadata"])
    metadata.pop("preset_quality_contract_hash")
    store_assistant.create_or_update_assistant_plan(
        {**plan, "plan_json": {**plan["plan_json"], "metadata": metadata}}
    )

    saved = client.post(
        f"/media/assistant/sessions/{session['assistant_session_id']}/preset-saves",
        json={
            "message": "Save the unverified Media Preset draft.",
            "proposal_id": proposed.result["proposal_id"],
            "confirmation_token": proposed.result["confirmation_token"],
        },
    )

    assert saved.status_code == 400


def test_unverified_save_requires_an_offer_from_an_earlier_user_turn(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    kernel = importlib.import_module("app.assistant.kernel")
    store_assistant = importlib.import_module("app.store_assistant")
    session = _session(client)
    plan = _applied_test_plan(store_assistant, session["assistant_session_id"])
    draft = _preset_draft("kernel_preserved_unverified_plan")

    never_offered = tools.execute_kernel_tool(
        tool_name="propose_media_preset_draft",
        arguments={
            "draft": draft,
            "test_plan_id": plan["assistant_plan_id"],
            "allow_unverified_save": True,
        },
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            session_id=session["assistant_session_id"],
            session=session,
            user_message_id="asmsg-unverified-same-turn",
            artifact_intent="save_preset",
        ),
    )
    assert never_offered.trace.error is not None
    assert never_offered.trace.error.code == "unverified_save_acceptance_required"

    offered = tools.execute_kernel_tool(
        tool_name="propose_media_preset_draft",
        arguments={"draft": draft, "test_plan_id": plan["assistant_plan_id"]},
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            session_id=session["assistant_session_id"],
            session=session,
            user_message_id="asmsg-unverified-same-turn",
            artifact_intent="save_preset",
        ),
    )
    assert offered.trace.error is None

    session = store_assistant.get_assistant_session(session["assistant_session_id"])
    assert kernel._kernel_session_context(session)["unverified_save_offered"] is True
    same_turn = tools.execute_kernel_tool(
        tool_name="propose_media_preset_draft",
        arguments={"draft": draft, "allow_unverified_save": True},
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            session_id=session["assistant_session_id"],
            session=session,
            user_message_id="asmsg-unverified-same-turn",
            artifact_intent="save_preset",
        ),
    )

    assert same_turn.trace.error is not None
    assert same_turn.trace.error.code == "unverified_save_acceptance_required"


def test_unrelated_applied_graph_cannot_authorize_unverified_save(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    store_assistant = importlib.import_module("app.store_assistant")
    session = _session(client)
    unrelated = _applied_test_plan(store_assistant, session["assistant_session_id"])
    unrelated = store_assistant.create_or_update_assistant_plan(
        {
            **unrelated,
            "plan_json": {"summary": "Unrelated applied graph", "operations": []},
        }
    )

    proposed = tools.execute_kernel_tool(
        tool_name="propose_media_preset_draft",
        arguments={
            "draft": _preset_draft("kernel_unrelated_graph_guard"),
            "test_plan_id": unrelated["assistant_plan_id"],
        },
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            session_id=session["assistant_session_id"],
            session=session,
            user_message_id="asmsg-unrelated-offer",
            artifact_intent="save_preset",
        ),
    )

    assert proposed.trace.error is not None
    assert proposed.trace.error.code == "preset_test_plan_mismatch"


def test_stale_applied_preset_plan_cannot_authorize_a_revised_draft(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    store_assistant = importlib.import_module("app.store_assistant")
    session = _session(client)
    original = _preset_draft("kernel_original_plan_contract")
    plan = _applied_test_plan(
        store_assistant,
        session["assistant_session_id"],
        draft=original,
    )
    revised = {
        **original,
        "prompt_template": "Cool editorial field guide for {{location}}",
    }

    proposed = tools.execute_kernel_tool(
        tool_name="propose_media_preset_draft",
        arguments={
            "draft": revised,
            "test_plan_id": plan["assistant_plan_id"],
        },
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            session_id=session["assistant_session_id"],
            session=session,
            user_message_id="asmsg-stale-plan-offer",
            artifact_intent="save_preset",
        ),
    )

    assert proposed.trace.error is not None
    assert proposed.trace.error.code == "preset_test_plan_mismatch"


def test_preset_save_rejects_a_new_unapplied_plan_and_exposes_the_applied_plan(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    kernel = importlib.import_module("app.assistant.kernel")
    store_assistant = importlib.import_module("app.store_assistant")
    session = _session(client)
    applied = _applied_test_plan(store_assistant, session["assistant_session_id"])
    draft = _preset_draft("kernel_unapplied_plan_guard")
    session = _session_with_preset_quality(store_assistant, session, applied, draft)
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
                    "draft": draft,
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
                    "draft": draft,
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
