from __future__ import annotations

import importlib

import pytest

from test_assistant_kernel_preset import _preset_draft, _session


SUNBURST_TEXT = "gpt-image-2-5-sunburst-text-to-image"
SUNBURST_EDIT = "gpt-image-2-5-sunburst-image-to-image"


def test_image_defaults_persist_clear_and_survive_provider_only_save(client) -> None:
    endpoint = "/media/assistant-config"
    empty = {"text_to_image": None, "image_to_image": None}
    assert client.get(endpoint).json()["image_model_defaults_json"] == empty
    defaults = {"text_to_image": SUNBURST_TEXT, "image_to_image": SUNBURST_EDIT}
    provider = {"provider_kind": "openrouter", "provider_model_id": "conversation/model"}
    response = client.patch(endpoint, json={**provider, "image_model_defaults_json": defaults})
    assert response.status_code == 200, response.text
    assert response.json()["image_model_defaults_json"] == defaults
    saved = client.get(endpoint).json()
    assert saved["image_model_defaults_json"] == defaults
    assert saved["provider_model_id"] == provider["provider_model_id"]
    response = client.patch(endpoint, json={**provider, "temperature": 0.4})
    assert response.status_code == 200, response.text
    assert client.get(endpoint).json()["image_model_defaults_json"] == defaults
    response = client.patch(endpoint, json={**provider, "image_model_defaults_json": empty})
    assert response.status_code == 200, response.text
    assert client.get(endpoint).json()["image_model_defaults_json"] == empty


@pytest.mark.parametrize("model_key,error", [
    ("missing-image-model", "unavailable"),
    (SUNBURST_EDIT, "does not support text-to-image"),
])
def test_image_defaults_reject_invalid_and_wrong_mode_choices(client, model_key, error) -> None:
    before = client.get("/media/assistant-config").json()["image_model_defaults_json"]
    response = client.patch("/media/assistant-config", json={
        "image_model_defaults_json": {"text_to_image": model_key},
    })
    assert response.status_code == 400, response.text
    assert error in response.text
    assert client.get("/media/assistant-config").json()["image_model_defaults_json"] == before


@pytest.mark.parametrize("unavailable_reason", ["hidden", "disabled"])
def test_image_defaults_reject_unavailable_catalog_choices(client, app_modules, monkeypatch, unavailable_reason) -> None:
    image_models = importlib.import_module("app.service_image_models")
    if unavailable_reason == "hidden":
        catalog = image_models.kie_adapter.list_models()
        monkeypatch.setattr(image_models.kie_adapter, "list_models", lambda: [
            {**item, "studio_exposed": False} if item["key"] == SUNBURST_TEXT else item
            for item in catalog
        ])
    else:
        app_modules["store"].upsert_model_queue_policy(SUNBURST_TEXT, {"enabled": False})
    response = client.patch("/media/assistant-config", json={
        "image_model_defaults_json": {"text_to_image": SUNBURST_TEXT},
    })
    assert response.status_code == 400, response.text
    assert "unavailable" in response.text
    choices = client.get("/media/assistant-config").json()["image_model_choices_json"]["text_to_image"]
    assert SUNBURST_TEXT not in {item["key"] for item in choices}


def test_image_model_resolution_honors_explicit_choice_default_and_unset_question(client) -> None:
    image_models = importlib.import_module("app.service_image_models")
    errors = importlib.import_module("app.service_errors")
    with pytest.raises(errors.ServiceError, match="Choose a text-to-image model"):
        image_models.resolve_image_model("text_to_image")
    response = client.patch("/media/assistant-config", json={
        "image_model_defaults_json": {"text_to_image": SUNBURST_TEXT},
    })
    assert response.status_code == 200, response.text
    assert image_models.resolve_image_model("text_to_image").source["model_key"] == SUNBURST_TEXT
    assert image_models.resolve_image_model("text_to_image", "nano-banana-pro").source["model_key"] == "nano-banana-pro"
    with pytest.raises(errors.ServiceError, match="unavailable"):
        image_models.resolve_image_model("text_to_image", "missing-model")


@pytest.mark.parametrize("model_key,image_slot", [
    (SUNBURST_TEXT, False), (SUNBURST_EDIT, True),
    ("nano-banana-pro", False), ("nano-banana-pro", True),
])
def test_preset_template_preserves_draft_model_over_assistant_default(client, app_modules, model_key, image_slot) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    response = client.patch("/media/assistant-config", json={
        "image_model_defaults_json": {
            "text_to_image": "gpt-image-2-text-to-image",
            "image_to_image": "gpt-image-2-image-to-image",
        },
    })
    assert response.status_code == 200, response.text
    session = _session(client)
    draft = _preset_draft("catalog_model_preset", image_slot=image_slot)
    draft.update(model_key=model_key, applies_to_models=[model_key])
    session = app_modules["store_assistant"].create_or_update_assistant_session({
        **session, "summary_json": {**session.get("summary_json", {}), "kernel_preset_draft": draft},
    })
    result = tools.execute_kernel_tool(
        tool_name="propose_graph_operations",
        arguments={
            "summary": "Prepare the preset test with its selected image model.",
            "template_id": "preset_style_i2i_sandbox_v1" if image_slot else "preset_style_t2i_sandbox_v1",
            "field_values": {"location": "desert research station"},
        },
        capability="preset_builder",
        context=tools.KernelToolContext(workflow=None, canvas_context={}, session_id=session["assistant_session_id"], session=session),
    )
    assert result.trace.error is None, result.trace.error
    graph = result.result
    assert graph["workflow"]["metadata"]["assistant_plan"]["template_model_key"] == model_key
    image_models = importlib.import_module("app.service_image_models")
    definition = image_models.resolve_image_model("image_to_image" if image_slot else "text_to_image", model_key)
    nodes = graph["workflow"]["nodes"]
    assert [node["type"] for node in nodes if node["type"].startswith("model.kie.")] == [definition.type]
    model_node = next(node for node in nodes if node["type"] == definition.type)
    assert model_node["fields"]["aspect_ratio"] == "1:1"
    assert len(graph["workflow"]["edges"]) == (3 if image_slot else 2)
    assert [item["code"] for item in graph["validation"]["errors"]] == (["missing_media_reference"] if image_slot else [])
    assert app_modules["store_assistant"].get_assistant_session(session["assistant_session_id"])["summary_json"]["kernel_preset_draft"] == draft
    assert app_modules["store"].list_jobs(limit=200) == []


def test_preset_output_evidence_uses_image_generator_capabilities(client) -> None:
    confirmation = importlib.import_module("app.assistant.run_confirmation")
    registry = importlib.import_module("app.graph.registry").registry
    definitions = list(registry.definitions_by_type().values())
    selected = [item for item in definitions if (item.source or {}).get("model_key") in {SUNBURST_TEXT, SUNBURST_EDIT, "nano-banana-pro"}]
    video = next(item for item in definitions if (item.source or {}).get("kind") == "kie_model" and any(port.type == "video" for port in item.ports.get("outputs", [])))
    workflow = {"nodes": [
        *[{"id": str(index), "type": item.type} for index, item in enumerate(selected)],
        {"id": "loader", "type": "media.load_image"},
        {"id": "preview", "type": "preview.image"},
        {"id": "video", "type": video.type},
    ]}
    assert len(selected) == 3
    assert confirmation._preset_output_model_node_ids(workflow) == {"0", "1", "2"}


def test_preset_refinement_updates_required_image_slots_and_invalidates_confirmation(client, app_modules) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    graph_schemas = importlib.import_module("app.graph.schemas")
    provenance = importlib.import_module("app.assistant.provenance")
    confirmation = importlib.import_module("app.assistant.run_confirmation")
    session = _session(client)
    draft = _preset_draft("refined_image_requirements", image_slot=True)
    draft.update(model_key="nano-banana-pro", applies_to_models=["nano-banana-pro"])
    draft["input_slots_json"].append({"key": "style_image", "label": "Style Image", "required": False})
    draft["prompt_template"] += " Use [[style_image]] as an optional style reference."
    workflow = graph_schemas.GraphWorkflow(name="Image slot refinement")
    initial_node_ids = None
    for required in (False, True, False):
        draft["input_slots_json"][1]["required"] = required
        session = app_modules["store_assistant"].create_or_update_assistant_session({
            **session, "summary_json": {**session.get("summary_json", {}), "kernel_preset_draft": draft},
        })
        result = tools.execute_kernel_tool(
            tool_name="propose_graph_operations",
            arguments={
                "summary": "Update the approved runtime image requirements.",
                "template_id": "preset_style_i2i_sandbox_v1",
                "field_values": {"location": "desert research station"},
            },
            capability="preset_builder",
            context=tools.KernelToolContext(
                workflow=workflow, canvas_context={}, session_id=session["assistant_session_id"], session=session,
            ),
        )
        assert result.trace.error is None, result.trace.error
        proposal = result.result
        loaders = [node for node in proposal["workflow"]["nodes"] if node["type"] == "media.load_image"]
        second_loader = next(node for node in loaders if node["metadata"]["assistant"]["semantic_ref"] == "preset_image_2")
        assert second_loader["fields"]["required_media"] is required
        missing_ids = {error["node_id"] for error in proposal["validation"]["errors"] if error["code"] == "missing_media_reference"}
        assert (second_loader["id"] in missing_ids) is required
        node_ids = {node["id"] for node in proposal["workflow"]["nodes"]}
        if initial_node_ids is None:
            initial_node_ids = node_ids
        else:
            assert node_ids == initial_node_ids
            assert proposal["diff_summary"]["nodes_added"] == []
        response = client.post(
            f"/media/assistant/plans/{proposal['proposal_id']}/apply",
            json={
                "workflow": workflow.model_dump(mode="json"),
                "proposal_id": proposal["proposal_id"],
                "confirmation_token": proposal["confirmation_token"],
            },
        )
        assert response.status_code == 200, response.text
        workflow = graph_schemas.GraphWorkflow.model_validate(response.json()["workflow"])
        assert confirmation.applied_preset_test_plan_id(session["assistant_session_id"], workflow) == proposal["proposal_id"]
        changed = workflow.model_copy(deep=True)
        next(node for node in changed.nodes if node.id == second_loader["id"]).fields["required_media"] = not required
        for kind, fingerprint in (
            ("graph", provenance.workflow_fingerprint),
            ("preset_test", provenance.preset_test_workflow_fingerprint),
        ):
            approved = {"confirmation_kind": kind, "workflow_fingerprint": fingerprint(workflow)}
            assert confirmation._matching_confirmation_fingerprint(approved, workflow) is not None
            assert confirmation._matching_confirmation_fingerprint(approved, changed) is None
        assert confirmation.applied_preset_test_plan_id(session["assistant_session_id"], changed) != proposal["proposal_id"]
    assert app_modules["store"].list_jobs(limit=200) == []


def test_required_image_field_does_not_change_legacy_workflow_defaults(client) -> None:
    graph_schemas = importlib.import_module("app.graph.schemas")
    normalization = importlib.import_module("app.graph.normalization")
    registry = importlib.import_module("app.graph.registry").registry
    definition = registry.definitions_by_type()["media.load_image"]
    requirement = next(field for field in definition.fields if field.id == "required_media")
    assert requirement.hidden and requirement.default is None
    workflow = graph_schemas.GraphWorkflow(nodes=[
        graph_schemas.GraphWorkflowNode(id="existing-image", type="media.load_image", fields={"asset_id": "saved-image"}),
    ])
    normalized = normalization.materialize_workflow_defaults(workflow)
    assert normalized.nodes[0].fields == {"asset_id": "saved-image"}
