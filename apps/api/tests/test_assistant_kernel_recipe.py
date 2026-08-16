from __future__ import annotations

import importlib
import json

import pytest


def _session(client):
    return client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "standalone", "provider_kind": "codex_local"},
    ).json()


def _recipe_draft(key: str, *, image_input: bool = False):
    variables = [
        {
            "key": "story_idea",
            "label": "Story Idea",
            "enabled": True,
            "required": True,
            "description": "The story moment to translate into shots.",
        },
        {
            "key": "shot_count",
            "label": "Shot Count",
            "enabled": True,
            "required": True,
            "default_value": "6",
        },
    ]
    template = (
        "Write {{shot_count}} production-ready storyboard image prompts for {{story_idea}}. "
        "For each shot return subject, action, camera, composition, lighting, and continuity."
    )
    image_config = {
        "enabled": False,
        "required": False,
        "mode": "none",
        "analysis_variable": "image_analysis",
        "max_files": 0,
        "reference_roles": [],
    }
    if image_input:
        variables.append(
            {
                "key": "image_analysis",
                "label": "Image Analysis",
                "enabled": True,
                "required": True,
            }
        )
        template += " Preserve these visible reference traits: {{image_analysis}}."
        image_config = {
            "enabled": True,
            "required": True,
            "mode": "analyze_then_inject",
            "analysis_variable": "image_analysis",
            "max_files": 1,
            "reference_roles": ["style"],
        }
    return {
        "key": key,
        "label": "Storyboard Prompt Writer",
        "description": "Writes a structured sequence of production-ready storyboard prompts.",
        "category": "image",
        "status": "active",
        "system_prompt_template": template,
        "image_analysis_prompt": (
            "Describe composition, subject continuity, palette, lighting, and camera language."
            if image_input
            else ""
        ),
        "user_prompt_placeholder": "{{story_idea}}",
        "output_format": "structured_shot_sequence",
        "output_contract_json": {
            "items": "shots",
            "required_sections": ["subject", "action", "camera", "composition", "lighting", "continuity"],
        },
        "input_variables_json": variables,
        "custom_fields_json": [
            {
                "key": "aspect_feel",
                "label": "Aspect Feel",
                "type": "select",
                "options": ["Cinematic wide", "Portrait", "Square"],
                "default_value": "Cinematic wide",
            }
        ],
        "image_input_json": image_config,
        "default_options_json": {},
        "rules_json": {"allow_external_variables": False},
        "source_kind": "custom",
        "priority": 0,
    }


def _create_image_preset(store, *, preset_id: str, key: str):
    return store.create_or_update_preset(
        {
            "preset_id": preset_id,
            "key": key,
            "label": "Approved Generation Defaults",
            "category": "image",
            "status": "active",
            "model_key": "gpt-image-2-text-to-image",
            "source_kind": "custom",
            "applies_to_models_json": ["gpt-image-2-text-to-image"],
            "applies_to_task_modes_json": ["text_to_image"],
            "applies_to_input_patterns_json": ["prompt_only"],
            "prompt_template": "Create a {{destination}} travel poster.",
            "input_schema_json": [{"key": "destination", "label": "Destination", "required": True}],
            "input_slots_json": [],
            "default_options_json": {"resolution": "2K", "aspect_ratio": "3:4"},
            "rules_json": {"preset_lane": "text_to_image"},
        }
    )


def test_recipe_tools_read_catalog_validate_and_persist_typed_state(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    store = importlib.import_module("app.store")
    store_assistant = importlib.import_module("app.store_assistant")
    session = _session(client)
    existing = store.list_prompt_recipes(status="active")[0]
    context = tools.KernelToolContext(
        workflow=None,
        canvas_context={},
        session_id=session["assistant_session_id"],
        session=session,
        user_text="I want a recipe that writes storyboard prompts for me.",
    )
    searched = tools.execute_kernel_tool(
        tool_name="search_prompt_recipes",
        arguments=json.dumps({"query": existing["label"], "limit": 5}),
        capability="recipe_builder",
        context=context,
    )
    fetched = tools.execute_kernel_tool(
        tool_name="get_prompt_recipe",
        arguments=json.dumps({"recipe_id_or_key": existing["recipe_id"]}),
        capability="recipe_builder",
        context=context,
    )
    draft = _recipe_draft("kernel_storyboard_writer_contract")
    validated = tools.execute_kernel_tool(
        tool_name="validate_prompt_recipe_draft",
        arguments=json.dumps({"draft": draft}),
        capability="recipe_builder",
        context=context,
    )
    proposed = tools.execute_kernel_tool(
        tool_name="propose_prompt_recipe_draft",
        arguments=json.dumps({"draft": draft}),
        capability="recipe_builder",
        context=context,
    )
    refreshed = store_assistant.get_assistant_session(session["assistant_session_id"])

    assert searched.trace.error is None
    assert any(item["recipe_id"] == existing["recipe_id"] for item in searched.result["items"])
    assert fetched.result["system_prompt_template"]
    assert validated.result["valid"] is True
    assert proposed.result["save_ready"] is False
    assert proposed.result["confirmation_token"] is None
    assert refreshed["summary_json"]["kernel_recipe_draft"]["output_format"] == "structured_shot_sequence"
    assert store.get_prompt_recipe_by_key(draft["key"]) is None


def test_recipe_revision_and_image_input_stay_in_typed_draft(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    store_assistant = importlib.import_module("app.store_assistant")
    session = _session(client)
    context = tools.KernelToolContext(
        workflow=None,
        canvas_context={},
        session_id=session["assistant_session_id"],
        session=session,
        user_text="Can the recipe look at an image I give it?",
    )
    draft = _recipe_draft("kernel_recipe_image_contract")
    first = tools.execute_kernel_tool(
        tool_name="propose_prompt_recipe_draft",
        arguments=json.dumps({"draft": draft}),
        capability="recipe_builder",
        context=context,
    )
    revised = _recipe_draft("kernel_recipe_image_contract", image_input=True)
    recipe_tool = next(
        item
        for item in tools.kernel_tool_catalog("recipe_builder")
        if item["name"] == "propose_prompt_recipe_draft"
    )
    second = tools.execute_kernel_tool(
        tool_name="propose_prompt_recipe_draft",
        arguments=json.dumps({"draft": revised}),
        capability="recipe_builder",
        context=context,
    )
    refreshed = store_assistant.get_assistant_session(session["assistant_session_id"])

    assert first.trace.error is None
    assert second.trace.error is None
    assert refreshed["summary_json"]["kernel_recipe_draft"]["image_input_json"] == revised["image_input_json"]
    assert "{{image_analysis}}" in refreshed["summary_json"]["kernel_recipe_draft"]["system_prompt_template"]
    assert recipe_tool["arguments_schema"]["$defs"]["KernelPromptRecipeImageInputConfig"][
        "properties"
    ]["mode"]["enum"] == ["none", "direct_reference", "analyze_then_inject", "both"]
    assert recipe_tool["read_only"] is False


def test_recipe_turn_cannot_finish_with_prose_only_draft(client, monkeypatch) -> None:
    kernel = importlib.import_module("app.assistant.kernel")
    session = _session(client)
    draft = _recipe_draft("kernel_recipe_required_typed_draft")
    calls = []
    steps = iter(
        [
            {
                "capability": "recipe_builder",
                "artifact_intent": "draft_recipe",
                "reply": "I would ask for the story and shot count.",
            },
            {
                "capability": "recipe_builder",
                "artifact_intent": "draft_recipe",
                "tool_call": {
                    "name": "propose_prompt_recipe_draft",
                    "arguments": json.dumps({"draft": draft}),
                },
                "reply": "The structured draft is ready.",
            },
        ]
    )

    def provider_step(**_kwargs):
        calls.append(True)
        return next(steps)

    monkeypatch.setattr(kernel, "run_kernel_provider_step", provider_step)

    result = kernel.run_assistant_kernel_turn(
        session=session,
        user_text="Develop a reusable structured transformation template.",
        workflow=None,
        canvas_context={},
        assistant_mode="recipe",
    )

    assert any(item.kind == "recipe_draft" for item in result.artifacts)
    assert result.trace.tool_calls[0].tool_name == "propose_prompt_recipe_draft"
    assert len(calls) == 2


def test_recipe_save_requires_one_time_server_confirmation(client, monkeypatch) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    kernel = importlib.import_module("app.assistant.kernel")
    store = importlib.import_module("app.store")
    store_assistant = importlib.import_module("app.store_assistant")
    session = _session(client)
    key = "kernel_confirmed_character_sheet_recipe"
    draft = _recipe_draft(key)
    steps = iter(
        [
            {
                "capability": "recipe_builder",
                "artifact_intent": "save_recipe",
                "tool_call": {
                    "name": "propose_prompt_recipe_draft",
                    "arguments": json.dumps({"draft": draft, "request_save_confirmation": True}),
                },
            },
            {
                "capability": "recipe_builder",
                "artifact_intent": "save_recipe",
                "reply": "The validated recipe is ready for confirmation.",
            },
        ]
    )
    monkeypatch.setattr(kernel, "run_kernel_provider_step", lambda **_kwargs: next(steps))

    proposed = client.post(
        f"/media/assistant/sessions/{session['assistant_session_id']}/messages",
        json={"content_text": "I approve this final draft for confirmation.", "assistant_mode": "recipe"},
    )
    action = proposed.json()["messages"][-1]["content_json"]["next_action"]

    assert proposed.status_code == 200
    assert action["kind"] == "save_prompt_recipe"
    assert store.get_prompt_recipe_by_key(key) is None
    saved = client.post(
        f"/media/assistant/sessions/{session['assistant_session_id']}/recipe-saves",
        json={
            "message": "Save the approved Prompt Recipe draft.",
            "proposal_id": action["proposal_id"],
            "confirmation_token": action["confirmation_token"],
        },
    )
    replay = client.post(
        f"/media/assistant/sessions/{session['assistant_session_id']}/recipe-saves",
        json={
            "message": "Save the approved Prompt Recipe draft.",
            "proposal_id": action["proposal_id"],
            "confirmation_token": action["confirmation_token"],
        },
    )

    assert saved.status_code == 200, saved.text
    assert saved.json()["record"]["key"] == key
    assert saved.json()["assistant_session"]["summary_json"]["kernel_recipe_proposal"]["consumed"] is True
    assert replay.status_code == 400

    revised_draft = _recipe_draft(key, image_input=True)
    refreshed = store_assistant.get_assistant_session(session["assistant_session_id"])
    validation = tools.execute_kernel_tool(
        tool_name="validate_prompt_recipe_draft",
        arguments=json.dumps({"draft": revised_draft}),
        capability="recipe_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            session_id=session["assistant_session_id"],
            session=refreshed,
            user_text="Can the recipe look at an image I give it?",
        ),
    )
    revision = tools.execute_kernel_tool(
        tool_name="propose_prompt_recipe_draft",
        arguments=json.dumps({"draft": revised_draft}),
        capability="recipe_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            session_id=session["assistant_session_id"],
            session=refreshed,
            user_text="Can the recipe look at an image I give it?",
        ),
    )
    ready = tools.execute_kernel_tool(
        tool_name="propose_prompt_recipe_draft",
        arguments=json.dumps({"draft": revised_draft, "request_save_confirmation": True}),
        capability="recipe_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            session_id=session["assistant_session_id"],
            session=store_assistant.get_assistant_session(session["assistant_session_id"]),
            user_text="Save the updated recipe.",
            artifact_intent="save_recipe",
        ),
    )
    updated = client.post(
        f"/media/assistant/sessions/{session['assistant_session_id']}/recipe-saves",
        json={
            "message": "Save the updated Prompt Recipe draft.",
            "proposal_id": ready.result["proposal_id"],
            "confirmation_token": ready.result["confirmation_token"],
        },
    )

    assert validation.trace.error is None
    assert revision.trace.error is None
    assert revision.result["draft"]["image_input_json"]["enabled"] is True
    assert saved.json()["record"]["recipe_id"] == updated.json()["record"]["recipe_id"]
    assert updated.json()["record"]["image_input_json"]["enabled"] is True


def test_fresh_session_can_propose_a_revision_for_an_explicit_saved_recipe(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    service = importlib.import_module("app.service_prompt_recipe_validation")
    schemas = importlib.import_module("app.schemas")
    session = _session(client)
    original = _recipe_draft("fresh_session_recipe_revision")
    saved = service.upsert_prompt_recipe(schemas.PromptRecipeUpsertRequest.model_validate(original))
    other = service.upsert_prompt_recipe(
        schemas.PromptRecipeUpsertRequest.model_validate(
            _recipe_draft("different_fresh_session_recipe")
        )
    )
    revised = {**original, "description": "Updated from an approved Media Preset."}
    context = tools.KernelToolContext(
        workflow=None,
        canvas_context={},
        session_id=session["assistant_session_id"],
        session=session,
        user_text="Update this saved recipe from its approved preset.",
        artifact_intent="revise_recipe",
    )

    validated = tools.execute_kernel_tool(
        tool_name="validate_prompt_recipe_draft",
        arguments={"draft": revised, "existing_recipe_id": saved["recipe_id"]},
        capability="recipe_builder",
        context=context,
    )
    proposed = tools.execute_kernel_tool(
        tool_name="propose_prompt_recipe_draft",
        arguments={"draft": revised, "existing_recipe_id": saved["recipe_id"]},
        capability="recipe_builder",
        context=context,
    )
    wrong_recipe = tools.execute_kernel_tool(
        tool_name="propose_prompt_recipe_draft",
        arguments={"draft": revised, "existing_recipe_id": other["recipe_id"]},
        capability="recipe_builder",
        context=context,
    )

    assert validated.trace.error is None
    assert proposed.trace.error is None
    assert proposed.result["draft"]["description"] == revised["description"]
    assert wrong_recipe.trace.error is not None
    assert wrong_recipe.trace.error.code == "prompt_recipe_revision_mismatch"


def test_recipe_save_rejects_an_unconfirmed_legacy_draft(client) -> None:
    session = _session(client)

    response = client.post(
        f"/media/assistant/sessions/{session['assistant_session_id']}/recipe-saves",
        json={
            "message": "Save this draft.",
            "draft": _recipe_draft("unconfirmed_legacy_recipe"),
        },
    )

    assert response.status_code == 400


def test_saved_recipe_can_be_wired_into_a_validated_image_graph(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    registry = importlib.import_module("app.graph.registry").registry
    service = importlib.import_module("app.service_prompt_recipe_validation")
    schemas = importlib.import_module("app.schemas")
    session = _session(client)
    saved = service.upsert_prompt_recipe(
        schemas.PromptRecipeUpsertRequest.model_validate(
            _recipe_draft("kernel_saved_storyboard_graph_contract")
        )
    )
    registry.invalidate()
    workflow = {
        "schema_version": 1,
        "name": "Recipe graph",
        "nodes": [],
        "edges": [],
        "metadata": {},
    }
    context = tools.KernelToolContext(
        workflow=tools.GraphWorkflow.model_validate(workflow),
        canvas_context={},
        session_id=session["assistant_session_id"],
        session=session,
        user_text="Use my saved storyboard recipe in a graph and wire it into an image model.",
    )
    proposed = tools.execute_kernel_tool(
        tool_name="propose_graph_operations",
        arguments=json.dumps(
            {
                "summary": "Wire the saved storyboard recipe into GPT Image 2 and a preview.",
                "operations": [
                    {
                        "op": "add_node",
                        "node_ref": "recipe",
                        "node_type": "prompt.recipe",
                        "title": "Storyboard Prompt Writer",
                        "position": {"x": 80, "y": 120},
                        "fields": {
                            "recipe_id": saved["recipe_id"],
                            "story_idea": "A lighthouse keeper finds a strange object in the water.",
                            "shot_count": "6",
                            "aspect_feel": "Cinematic wide",
                        },
                    },
                    {
                        "op": "add_node",
                        "node_ref": "image_model",
                        "node_type": "model.kie.gpt_image_2_text_to_image",
                        "title": "Generate Storyboard Frame",
                        "position": {"x": 560, "y": 120},
                        "fields": {"aspect_ratio": "16:9", "resolution": "1K"},
                    },
                    {
                        "op": "add_node",
                        "node_ref": "preview",
                        "node_type": "preview.image",
                        "title": "Preview",
                        "position": {"x": 1020, "y": 120},
                        "fields": {},
                    },
                    {
                        "op": "connect_nodes",
                        "source_ref": "recipe",
                        "source_port": "text",
                        "target_ref": "image_model",
                        "target_port": "prompt",
                    },
                    {
                        "op": "connect_nodes",
                        "source_ref": "image_model",
                        "source_port": "image",
                        "target_ref": "preview",
                        "target_port": "image",
                    },
                ],
            }
        ),
        capability="recipe_builder",
        context=context,
    )

    assert proposed.trace.error is None, proposed.trace.error
    assert proposed.result["validation"]["valid"] is True
    recipe_node = next(node for node in proposed.result["workflow"]["nodes"] if node["type"] == "prompt.recipe")
    assert recipe_node["fields"]["recipe_id"] == saved["recipe_id"]
    assert any(
        edge["source"] == recipe_node["id"] and edge["source_port"] == "text"
        for edge in proposed.result["workflow"]["edges"]
    )


def test_recipe_builder_can_read_source_preset_generation_defaults(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    store = importlib.import_module("app.store")
    session = _session(client)
    preset = _create_image_preset(
        store,
        preset_id="preset-derived-recipe-source",
        key="derived-recipe-source",
    )
    context = tools.KernelToolContext(
        workflow=None,
        canvas_context={},
        session_id=session["assistant_session_id"],
        session=session,
        user_text="Turn my approved preset into a reusable recipe.",
    )

    fetched = tools.execute_kernel_tool(
        tool_name="get_preset",
        arguments={"preset_id_or_key": preset["preset_id"]},
        capability="recipe_builder",
        context=context,
    )
    draft = _recipe_draft("recipe_with_source_preset_defaults")
    draft["rules_json"]["media_generation"] = {
        "source_preset_id": preset["preset_id"],
        "model_key": fetched.result["model_key"],
        "default_options_json": dict(fetched.result["default_options_json"]),
    }
    proposed = tools.execute_kernel_tool(
        tool_name="propose_prompt_recipe_draft",
        arguments={"draft": draft},
        capability="recipe_builder",
        context=context,
    )
    draft["rules_json"]["media_generation"]["default_options_json"]["resolution"] = "1K"
    invented = tools.execute_kernel_tool(
        tool_name="propose_prompt_recipe_draft",
        arguments={"draft": draft},
        capability="recipe_builder",
        context=context,
    )
    service = importlib.import_module("app.service_prompt_recipe_validation")
    schemas = importlib.import_module("app.schemas")

    assert fetched.trace.error is None
    assert fetched.result["model_key"] == "gpt-image-2-text-to-image"
    assert fetched.result["default_options_json"] == {"resolution": "2K", "aspect_ratio": "3:4"}
    assert proposed.trace.error is None
    assert proposed.result["draft"]["rules_json"]["media_generation"] == {
        "source_preset_id": preset["preset_id"],
        "model_key": "gpt-image-2-text-to-image",
        "default_options_json": {"resolution": "2K", "aspect_ratio": "3:4"},
    }
    assert invented.trace.error is not None
    assert invented.trace.error.code == "invalid_prompt_recipe_draft"
    saved = service.upsert_prompt_recipe(
        schemas.PromptRecipeUpsertRequest.model_validate(proposed.result["draft"])
    )
    with pytest.raises(service.ServiceError, match="must match a real saved Media Preset"):
        service.upsert_prompt_recipe(
            schemas.PromptRecipeUpsertRequest.model_validate(draft),
            recipe_id=saved["recipe_id"],
        )


def test_derived_recipe_graph_requires_approved_generation_defaults(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    service = importlib.import_module("app.service_prompt_recipe_validation")
    schemas = importlib.import_module("app.schemas")
    store = importlib.import_module("app.store")
    session = _session(client)
    preset = _create_image_preset(
        store,
        preset_id="preset-approved-generation-defaults",
        key="approved-generation-defaults",
    )
    draft = _recipe_draft("derived_recipe_generation_defaults")
    draft["rules_json"]["media_generation"] = {
        "source_preset_id": preset["preset_id"],
        "model_key": "gpt-image-2-text-to-image",
        "default_options_json": {"resolution": "2K", "aspect_ratio": "3:4"},
    }
    saved = service.upsert_prompt_recipe(schemas.PromptRecipeUpsertRequest.model_validate(draft))
    tools.registry.invalidate()
    context = tools.KernelToolContext(
        workflow=tools.GraphWorkflow(name="Derived recipe graph"),
        canvas_context={},
        session_id=session["assistant_session_id"],
        session=session,
        user_text="Create a graph from my approved recipe.",
    )
    operations = [
        {
            "op": "add_node",
            "node_ref": "recipe",
            "node_type": "prompt.recipe",
            "position": {"x": 0, "y": 0},
            "fields": {
                "recipe_id": saved["recipe_id"],
                "story_idea": "Rome travel poster",
                "shot_count": "6",
                "aspect_feel": "Portrait",
            },
        },
        {
            "op": "add_node",
            "node_ref": "model",
            "node_type": "model.kie.gpt_image_2_text_to_image",
            "position": {"x": 480, "y": 0},
            "fields": {"aspect_ratio": "3:4", "resolution": "1K"},
        },
        {"op": "add_node", "node_ref": "preview", "node_type": "preview.image", "position": {"x": 960, "y": 0}},
        {"op": "connect_nodes", "source_ref": "recipe", "source_port": "text", "target_ref": "model", "target_port": "prompt"},
        {"op": "connect_nodes", "source_ref": "model", "source_port": "image", "target_ref": "preview", "target_port": "image"},
    ]

    mismatched = tools.execute_kernel_tool(
        tool_name="propose_graph_operations",
        arguments={"summary": "Build the derived recipe graph.", "operations": operations},
        capability="recipe_builder",
        context=context,
    )
    override_context = tools.KernelToolContext(
        workflow=context.workflow,
        canvas_context={},
        session_id=session["assistant_session_id"],
        session=session,
        user_text="Use 1K instead of the recipe's inherited 2K setting for this graph.",
        user_message_id="msg-explicit-derived-recipe-override",
    )
    overridden = tools.execute_kernel_tool(
        tool_name="propose_graph_operations",
        arguments={
            "summary": "Build the recipe graph with the requested lower resolution.",
            "operations": operations,
            "derived_recipe_defaults_overrides": [
                {
                    "recipe_id": saved["recipe_id"],
                    "default_options_json": {"resolution": "1K"},
                }
            ],
        },
        capability="recipe_builder",
        context=override_context,
    )
    overreaching_operations = json.loads(json.dumps(operations))
    overreaching_operations[1]["fields"]["aspect_ratio"] = "1:1"
    overreaching = tools.execute_kernel_tool(
        tool_name="propose_graph_operations",
        arguments={
            "summary": "Change more settings than the user requested.",
            "operations": overreaching_operations,
            "derived_recipe_defaults_overrides": [
                {
                    "recipe_id": saved["recipe_id"],
                    "default_options_json": {"resolution": "1K"},
                }
            ],
        },
        capability="recipe_builder",
        context=override_context,
    )
    model_override_operations = json.loads(json.dumps(operations))
    model_override_operations[1]["node_type"] = "model.kie.nano_banana_2"
    model_override_operations[1]["fields"]["resolution"] = "2K"
    model_override_context = tools.KernelToolContext(
        workflow=context.workflow,
        canvas_context={},
        session_id=session["assistant_session_id"],
        session=session,
        user_text="Use Nano Banana 2 instead of GPT Image 2, but keep the approved 2K and 3:4 settings.",
        user_message_id="msg-explicit-derived-recipe-model-override",
    )
    omitted_model_override = tools.execute_kernel_tool(
        tool_name="propose_graph_operations",
        arguments={
            "summary": "Build the recipe graph with Nano Banana 2.",
            "operations": model_override_operations,
        },
        capability="recipe_builder",
        context=model_override_context,
    )
    wrong_model_override = tools.execute_kernel_tool(
        tool_name="propose_graph_operations",
        arguments={
            "summary": "Build the recipe graph with Nano Banana 2.",
            "operations": model_override_operations,
            "derived_recipe_defaults_overrides": [
                {
                    "recipe_id": saved["recipe_id"],
                    "model_key": "nano-banana-pro",
                    "default_options_json": {},
                }
            ],
        },
        capability="recipe_builder",
        context=model_override_context,
    )
    exact_model_override = tools.execute_kernel_tool(
        tool_name="propose_graph_operations",
        arguments={
            "summary": "Build the recipe graph with Nano Banana 2.",
            "operations": model_override_operations,
            "derived_recipe_defaults_overrides": [
                {
                    "recipe_id": saved["recipe_id"],
                    "model_key": "nano-banana-2",
                    "default_options_json": {},
                }
            ],
        },
        capability="recipe_builder",
        context=model_override_context,
    )
    operations[1]["fields"]["resolution"] = "2K"
    inherited = tools.execute_kernel_tool(
        tool_name="propose_graph_operations",
        arguments={"summary": "Build the recipe graph with its approved defaults.", "operations": operations},
        capability="recipe_builder",
        context=context,
    )
    extraneous_model_override = tools.execute_kernel_tool(
        tool_name="propose_graph_operations",
        arguments={
            "summary": "Build the recipe graph with its approved defaults.",
            "operations": operations,
            "derived_recipe_defaults_overrides": [
                {
                    "recipe_id": saved["recipe_id"],
                    "model_key": "gpt-image-2-text-to-image",
                    "default_options_json": {},
                }
            ],
        },
        capability="recipe_builder",
        context=model_override_context,
    )

    assert mismatched.trace.error is not None
    assert mismatched.trace.error.code == "derived_recipe_defaults_mismatch"
    assert overridden.trace.error is None, overridden.trace.error
    assert overreaching.trace.error is not None
    assert overreaching.trace.error.code == "derived_recipe_defaults_mismatch"
    assert omitted_model_override.trace.error is not None
    assert omitted_model_override.trace.error.code == "derived_recipe_defaults_mismatch"
    assert wrong_model_override.trace.error is not None
    assert wrong_model_override.trace.error.code == "derived_recipe_defaults_mismatch"
    assert exact_model_override.trace.error is None, exact_model_override.trace.error
    assert inherited.trace.error is None, inherited.trace.error
    assert extraneous_model_override.trace.error is not None
    assert extraneous_model_override.trace.error.code == "derived_recipe_defaults_override_unused"
    store_assistant = importlib.import_module("app.store_assistant")
    override_plan = store_assistant.get_assistant_plan(overridden.result["proposal_id"])
    overridden_model = next(
        node for node in overridden.result["workflow"]["nodes"] if node["type"].startswith("model.kie.")
    )
    model = next(node for node in inherited.result["workflow"]["nodes"] if node["type"].startswith("model.kie."))
    assert overridden_model["fields"]["resolution"] == "1K"
    assert override_plan["plan_json"]["warnings"]
    assert override_plan["plan_json"]["metadata"]["derived_recipe_defaults_override"]["user_message_id"] == (
        override_context.user_message_id
    )
    assert model["fields"]["resolution"] == "2K"
    assert model["fields"]["aspect_ratio"] == "3:4"
    assert (
        inherited.result["pricing"]["pricing_summary"]["total"]["estimated_credits"]
        > overridden.result["pricing"]["pricing_summary"]["total"]["estimated_credits"]
    )


def test_recipe_reuse_requires_explicit_intent_before_adding_another_paid_path(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    service = importlib.import_module("app.service_prompt_recipe_validation")
    schemas = importlib.import_module("app.schemas")
    session = _session(client)
    saved = service.upsert_prompt_recipe(
        schemas.PromptRecipeUpsertRequest.model_validate(
            _recipe_draft("kernel_recipe_reuse_paid_path_contract")
        )
    )
    workflow = tools.GraphWorkflow.model_validate(
        {
            "schema_version": 1,
            "name": "Occupied recipe graph",
            "nodes": [
                {
                    "id": "existing-recipe",
                    "type": "prompt.recipe",
                    "position": {"x": 0, "y": 0},
                    "fields": {
                        "recipe_id": saved["recipe_id"],
                        "story_idea": "A coastal journey.",
                        "shot_count": "6",
                        "aspect_feel": "Cinematic wide",
                    },
                },
                {
                    "id": "existing-model",
                    "type": "model.kie.gpt_image_2_text_to_image",
                    "position": {"x": 480, "y": 0},
                    "fields": {"aspect_ratio": "16:9", "resolution": "1K"},
                },
                {
                    "id": "existing-preview",
                    "type": "preview.image",
                    "position": {"x": 960, "y": 0},
                    "fields": {},
                },
            ],
            "edges": [
                {"id": "existing-recipe-model", "source": "existing-recipe", "source_port": "text", "target": "existing-model", "target_port": "prompt"},
                {"id": "existing-model-preview", "source": "existing-model", "source_port": "image", "target": "existing-preview", "target_port": "image"},
            ],
            "metadata": {},
        }
    )
    operations = [
        {
            "op": "add_node",
            "node_ref": "second-recipe",
            "node_type": "prompt.recipe",
            "position": {"x": 0, "y": 700},
            "fields": {"recipe_id": saved["recipe_id"], "story_idea": "A city journey.", "shot_count": "6", "aspect_feel": "Portrait"},
        },
        {
            "op": "add_node",
            "node_ref": "second-model",
            "node_type": "model.kie.gpt_image_2_text_to_image",
            "position": {"x": 480, "y": 700},
            "fields": {"aspect_ratio": "3:4", "resolution": "1K"},
        },
        {"op": "add_node", "node_ref": "second-preview", "node_type": "preview.image", "position": {"x": 960, "y": 700}, "fields": {}},
        {"op": "connect_nodes", "source_ref": "second-recipe", "source_port": "text", "target_ref": "second-model", "target_port": "prompt"},
        {"op": "connect_nodes", "source_ref": "second-model", "source_port": "image", "target_ref": "second-preview", "target_port": "image"},
    ]
    context = tools.KernelToolContext(
        workflow=workflow,
        canvas_context={},
        session_id=session["assistant_session_id"],
        session=session,
        user_text="Can you use my saved travel recipe here again?",
    )

    blocked = tools.execute_kernel_tool(
        tool_name="propose_graph_operations",
        arguments={"summary": "Add another recipe image path.", "operations": operations},
        capability="graph_builder",
        context=context,
    )
    explicit_context = tools.KernelToolContext(
        workflow=workflow,
        canvas_context={},
        session_id=session["assistant_session_id"],
        session=session,
        user_text="Keep the current image path and add a second paid output using this recipe.",
    )
    composed = tools.execute_kernel_tool(
        tool_name="propose_graph_operations",
        arguments={
            "summary": "Add the explicitly requested second recipe image path.",
            "operations": operations,
            "additional_paid_path_intent": "explicitly_requested",
        },
        capability="graph_builder",
        context=explicit_context,
    )

    assert blocked.trace.error is not None
    assert blocked.trace.error.code == "duplicate_paid_path_requires_explicit_intent"
    assert composed.trace.error is None, composed.trace.error
    assert len([node for node in composed.result["workflow"]["nodes"] if node["type"].startswith("model.kie.")]) == 2


def test_recipe_clarification_keeps_bounded_recent_graph_context(client) -> None:
    kernel = importlib.import_module("app.assistant.kernel")
    store_assistant = importlib.import_module("app.store_assistant")
    session = _session(client)
    store_assistant.create_assistant_message(
        {
            "assistant_session_id": session["assistant_session_id"],
            "role": "user",
            "content_text": "Use my saved storyboard recipe in a graph and wire it into an image model.",
            "content_json": {},
        }
    )
    store_assistant.create_assistant_message(
        {
            "assistant_session_id": session["assistant_session_id"],
            "role": "assistant",
            "content_text": "Several saved recipes match; choose one by name.",
            "content_json": {},
        }
    )

    context = kernel._kernel_session_context(session)
    instruction = kernel._kernel_instruction()

    assert len(context["recent_conversation"]) <= 6
    assert any("graph" in item["text"].lower() for item in context["recent_conversation"])
    assert "propose_graph_operations" in instruction


def test_recipe_without_image_input_builds_graph_without_analyzing_attached_references(
    client,
    monkeypatch,
) -> None:
    kernel = importlib.import_module("app.assistant.kernel")
    service = importlib.import_module("app.service_prompt_recipe_validation")
    schemas = importlib.import_module("app.schemas")
    store = importlib.import_module("app.store")
    session = _session(client)
    preset = _create_image_preset(
        store,
        preset_id="preset-no-recipe-image-input",
        key="no-recipe-image-input",
    )
    draft = _recipe_draft("recipe_without_image_input")
    draft["rules_json"]["media_generation"] = {
        "source_preset_id": preset["preset_id"],
        "model_key": "gpt-image-2-text-to-image",
        "default_options_json": {"resolution": "2K", "aspect_ratio": "3:4"},
    }
    saved = service.upsert_prompt_recipe(
        schemas.PromptRecipeUpsertRequest.model_validate(draft)
    )
    importlib.import_module("app.graph.registry").registry.invalidate()
    operations = [
        {
            "op": "add_node",
            "node_ref": "recipe",
            "node_type": "prompt.recipe",
            "position": {"x": 0, "y": 0},
            "fields": {
                "recipe_id": saved["recipe_id"],
                "story_idea": "Tokyo travel poster",
                "shot_count": "6",
                "aspect_feel": "Portrait",
            },
        },
        {
            "op": "add_node",
            "node_ref": "model",
            "node_type": "model.kie.gpt_image_2_text_to_image",
            "position": {"x": 480, "y": 0},
            "fields": {"resolution": "2K", "aspect_ratio": "3:4"},
        },
        {
            "op": "add_node",
            "node_ref": "preview",
            "node_type": "preview.image",
            "position": {"x": 960, "y": 0},
        },
        {
            "op": "connect_nodes",
            "source_ref": "recipe",
            "source_port": "text",
            "target_ref": "model",
            "target_port": "prompt",
        },
        {
            "op": "connect_nodes",
            "source_ref": "model",
            "source_port": "image",
            "target_ref": "preview",
            "target_port": "image",
        },
    ]
    steps = iter(
        [
            {
                "capability": "recipe_builder",
                "tool_call": {
                    "name": "get_prompt_recipe",
                    "arguments": {"recipe_id_or_key": saved["recipe_id"]},
                },
            },
            {
                "capability": "recipe_builder",
                "tool_call": {
                    "name": "propose_graph_operations",
                    "arguments": {
                        "summary": "Build the saved recipe graph.",
                        "operations": operations,
                    },
                },
                "reply": "The graph is ready for review.",
            },
        ]
    )
    monkeypatch.setattr(kernel, "run_kernel_provider_step", lambda **_kwargs: next(steps))

    result = kernel.run_assistant_kernel_turn(
        session=session,
        user_text="Use my saved recipe to build a Tokyo graph with these style references.",
        workflow=kernel.GraphWorkflow(name="Recipe graph"),
        canvas_context={},
        assistant_mode="graph",
        attachments=[
            {
                "assistant_attachment_id": "attachment-style-reference",
                "reference_id": "reference-style",
                "kind": "image",
                "label": "Style reference",
            }
        ],
    )

    assert result.trace.termination == "completed"
    assert [trace.tool_name for trace in result.trace.tool_calls] == [
        "get_prompt_recipe",
        "propose_graph_operations",
    ]
    assert any(artifact.kind == "graph_proposal" for artifact in result.artifacts)


def test_recipe_session_context_exposes_latest_saved_artifact(client) -> None:
    kernel = importlib.import_module("app.assistant.kernel")
    store_assistant = importlib.import_module("app.store_assistant")
    session = _session(client)
    store_assistant.create_assistant_message(
        {
            "assistant_session_id": session["assistant_session_id"],
            "role": "system_summary",
            "content_text": "Saved the confirmed assistant artifact.",
            "content_json": {
                "saved_artifact": {
                    "kind": "prompt_recipe",
                    "id": "recipe_storyboard",
                    "key": "storyboard_prompts",
                    "label": "Storyboard Prompts",
                }
            },
        }
    )

    context = kernel._kernel_session_context(session)

    assert context["latest_saved_artifact"] == {
        "kind": "prompt_recipe",
        "id": "recipe_storyboard",
        "key": "storyboard_prompts",
        "label": "Storyboard Prompts",
    }
