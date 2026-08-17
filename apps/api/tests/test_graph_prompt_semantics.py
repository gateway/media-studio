from __future__ import annotations

import importlib
import time

import pytest


def _complete_storyboard_prompt(panel_count: int = 4) -> str:
    panels = []
    for number in range(1, panel_count + 1):
        panels.append(
            f"PANEL {number:02d}:\n"
            f"SHOT: {number:02d} DISTINCT STORY BEAT\n"
            "CAMERA: eye-level angle, locked-off frame, natural 50mm lens\n"
            f"ACTION: The lead completes story beat {number}\n"
            "MOTION: The camera holds while the lead advances\n"
            "DIALOG:\n"
            "NOTES: Preserve the established geography and prop state"
        )
    return (
        "BOARD TITLE: STATION CROSSING\n"
        "PRODUCTION METADATA: PROJECT: TEST; SEQUENCE: OPENING; LOCATION: STATION; DATE: DAY; ARTIST: ASSISTANT\n"
        f"PANEL COUNT: {panel_count}\n\n"
        + "\n\n".join(panels)
    )


def _run_graph_workflow(client, workflow: dict) -> dict:
    created = client.post("/media/graph/workflows", json=workflow)
    assert created.status_code == 200, created.text
    started = client.post(f"/media/graph/workflows/{created.json()['workflow_id']}/runs", json={})
    assert started.status_code == 200, started.text
    run_id = started.json()["run_id"]
    for _ in range(80):
        current = client.get(f"/media/graph/runs/{run_id}")
        assert current.status_code == 200, current.text
        payload = current.json()
        if payload["status"] in {"completed", "failed"}:
            return payload
        time.sleep(0.1)
    raise AssertionError("Graph run did not finish.")


def test_builtin_prompt_recipes_publish_typed_prompt_semantics(client, monkeypatch) -> None:
    from app.graph.executors import prompt_ops
    from app.graph.executors.base import GraphExecutionContext
    from app.graph.schemas import GraphWorkflow, GraphWorkflowNode

    rendered_prompts: list[str] = []

    def provider_reply(**kwargs):
        system_prompt = str(kwargs["messages"][0]["content"])
        rendered_prompts.append(system_prompt)
        generated_text = (
            _complete_storyboard_prompt()
            if "Storyboard v2 prompt compiler" in system_prompt
            else "Create an environment sheet for a planned four-panel storyboard. PANEL COUNT: 4."
        )
        return {
            "provider_kind": "codex_local",
            "provider_model_id": "test-model",
            "generated_text": generated_text,
            "warnings": [],
        }

    monkeypatch.setattr(prompt_ops.enhancement_provider, "run_codex_local_chat", provider_reply)

    def execute(recipe_id: str, **fields):
        node = GraphWorkflowNode(
            id=recipe_id,
            type="prompt.recipe",
            fields={
                "recipe_id": recipe_id,
                "provider": "codex_local",
                "model_id": "test-model",
                **fields,
            },
        )
        context = GraphExecutionContext(
            run_id="offline-recipe-semantics",
            workflow=GraphWorkflow(name="Recipe semantics", nodes=[node]),
        )
        return prompt_ops.PromptRecipeExecutor().execute(node, context)["text"][0].metadata

    environment = execute(
        "prompt-recipe-environment-sheet-v1",
        user_prompt="A station concourse used by a later storyboard.",
    )
    storyboard = execute(
        "prompt-recipe-storyboard-v2-gpt-image-2",
        user_prompt="The lead crosses the station.",
        shot_count="4",
    )
    ordinary = execute(
        "prompt-recipe-image-prompt-director",
        user_prompt="A quiet portrait at a station.",
        refinement="Increase the tightly overlapping paper ephemera.",
    )

    assert environment["prompt_semantics"] == "environment_sheet"
    assert storyboard["prompt_semantics"] == "storyboard_sheet_with_metadata"
    assert ordinary["prompt_semantics"] == "ordinary_image_prompt"
    assert any(
        "Increase the tightly overlapping paper ephemera." in prompt
        for prompt in rendered_prompts
    )
    assert prompt_ops.PROMPT_RECIPE_SEMANTICS["image-analysis-character-reference"] == "character_reference"


def test_gpt_image_2_preflight_uses_typed_prompt_semantics(client, monkeypatch) -> None:
    from app.graph.executors import kie_model
    from app.graph.executors.base import GraphExecutionContext
    from app.graph.schemas import GraphOutputRef, GraphWorkflow, GraphWorkflowEdge, GraphWorkflowNode

    submitted_prompts: list[str] = []

    def submit_without_network(**kwargs):
        submitted_prompts.append(kwargs["request"].prompt)
        return {}

    monkeypatch.setattr(kie_model, "submit_and_wait_for_kie_request", submit_without_network)
    model = GraphWorkflowNode(id="model", type="model.kie.gpt_image_2_text_to_image")

    def execute(prompt: str, semantics: str = "", **metadata) -> None:
        workflow = GraphWorkflow(
            name="Typed prompt semantics",
            nodes=[GraphWorkflowNode(id="recipe", type="prompt.recipe"), model],
            edges=[
                GraphWorkflowEdge(
                    id="prompt-edge",
                    source="recipe",
                    source_port="text",
                    target="model",
                    target_port="prompt",
                )
            ],
        )
        context = GraphExecutionContext(
            run_id="offline-prompt-semantics",
            workflow=workflow,
            edge_outputs={
                "prompt-edge": [
                    GraphOutputRef(
                        kind="value",
                        value=prompt,
                        metadata={"prompt_semantics": semantics, **metadata},
                    )
                ]
            },
        )
        kie_model.KieModelExecutor().execute(model, context)

    environment_prompt = (
        "Create an environment continuity sheet for an eight-panel storyboard. "
        "PANEL COUNT: 8. Include CAMERA, ACTION, MOTION, DIALOG, and NOTES guidance for the location."
    )
    execute(environment_prompt, "environment_sheet")
    execute(
        "Create storyboard contact-sheet art. PANEL COUNT: 4. Keep the CAMERA and ACTION beats visible.",
        storyboard_art_source_contract="storyboard_art_grid_v1",
    )
    execute(environment_prompt, "character_reference")
    execute(environment_prompt, "ordinary_image_prompt")

    with pytest.raises(ValueError, match="panel sequence is empty"):
        execute("Create the approved six-beat production board.", "storyboard_sheet_with_metadata")
    with pytest.raises(ValueError, match="panel sequence is empty"):
        execute(environment_prompt, "unknown_future_semantics")

    assert submitted_prompts == [
        environment_prompt,
        "Create storyboard contact-sheet art. PANEL COUNT: 4. Keep the CAMERA and ACTION beats visible.",
        environment_prompt,
        environment_prompt,
    ]


def test_kernel_planned_storyboard_graph_executes_both_typed_branches_without_network(client, monkeypatch) -> None:
    kernel = importlib.import_module("app.assistant.kernel")
    prompt_ops = importlib.import_module("app.graph.executors.prompt_ops")
    kie_model = importlib.import_module("app.graph.executors.kie_model")
    workflow = {
        "schema_version": 1,
        "workflow_id": "workflow-mao-typed-runtime",
        "name": "Typed storyboard runtime",
        "nodes": [],
        "edges": [],
        "metadata": {},
    }
    def branch_operations(name: str, y: int, recipe_id: str, **fields) -> list[dict]:
        return [
            {
                "op": "add_node",
                "node_ref": f"{name}_recipe",
                "node_type": "prompt.recipe",
                "position": {"x": 0, "y": y},
                "fields": {"recipe_id": recipe_id, "provider": "codex_local", "model_id": "test-model", **fields},
            },
            {
                "op": "add_node",
                "node_ref": f"{name}_model",
                "node_type": "model.kie.gpt_image_2_text_to_image",
                "position": {"x": 520, "y": y},
                "fields": {"aspect_ratio": "16:9", "resolution": "1K"},
            },
            {
                "op": "add_node",
                "node_ref": f"{name}_preview",
                "node_type": "preview.image",
                "position": {"x": 1040, "y": y},
            },
            {
                "op": "connect_nodes",
                "source_ref": f"{name}_recipe",
                "source_port": "text",
                "target_ref": f"{name}_model",
                "target_port": "prompt",
            },
            {
                "op": "connect_nodes",
                "source_ref": f"{name}_model",
                "source_port": "image",
                "target_ref": f"{name}_preview",
                "target_port": "image",
            },
        ]

    operations = [
        *branch_operations(
            "environment",
            0,
            "prompt-recipe-environment-sheet-v1",
            user_prompt="A station location for an eight-panel storyboard with CAMERA and ACTION continuity.",
        ),
        *branch_operations(
            "storyboard",
            360,
            "prompt-recipe-storyboard-v2-gpt-image-2",
            user_prompt="A traveler crosses the station.",
            shot_count="4",
        ),
    ]
    monkeypatch.setattr(
        kernel,
        "run_kernel_provider_step",
        lambda **_kwargs: {
            "capability": "graph_builder",
            "reply": "The graph is ready for review.",
            "tool_call": {
                "name": "propose_graph_operations",
                "arguments": {"summary": "Prepare environment and storyboard test branches.", "operations": operations},
            },
        },
    )

    def recipe_reply(**kwargs):
        system_prompt = str(kwargs["messages"][0]["content"])
        generated_text = (
            _complete_storyboard_prompt()
            if "Storyboard v2 prompt compiler" in system_prompt
            else "Environment continuity sheet for an eight-panel storyboard. PANEL COUNT: 8. CAMERA and ACTION lanes."
        )
        return {
            "provider_kind": "codex_local",
            "provider_model_id": "test-model",
            "generated_text": generated_text,
            "warnings": [],
        }

    submitted_nodes: list[str] = []
    monkeypatch.setattr(prompt_ops.enhancement_provider, "run_codex_local_chat", recipe_reply)
    monkeypatch.setattr(
        kie_model,
        "submit_and_wait_for_kie_request",
        lambda **kwargs: submitted_nodes.append(kwargs["node"].id) or {},
    )
    session = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": workflow["workflow_id"], "workflow": workflow},
    ).json()
    proposal = client.post(
        f"/media/assistant/sessions/{session['assistant_session_id']}/messages",
        json={"content_text": "Build the environment and storyboard test graph.", "workflow": workflow},
    )
    assert proposal.status_code == 200, proposal.text
    next_action = proposal.json()["messages"][-1]["content_json"]["kernel_turn"]["next_action"]
    assert next_action["kind"] == "confirm_graph", next_action
    applied = client.post(
        f"/media/assistant/plans/{next_action['proposal_id']}/apply",
        json={
            "workflow": workflow,
            "proposal_id": next_action["proposal_id"],
            "confirmation_token": next_action["confirmation_token"],
        },
    )
    assert applied.status_code == 200, applied.text

    result = _run_graph_workflow(client, applied.json()["workflow"])

    assert result["status"] == "completed", result.get("error")
    assert len(submitted_nodes) == 2
    model_nodes = [item for item in result["nodes"] if item["node_id"] in submitted_nodes]
    assert sum(item["metrics_json"].get("storyboard_metadata_preflight") == "passed" for item in model_nodes) == 1
