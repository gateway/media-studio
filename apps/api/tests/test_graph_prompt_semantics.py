from __future__ import annotations

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


def test_builtin_prompt_recipes_publish_typed_prompt_semantics(client, monkeypatch) -> None:
    from app.graph.executors import prompt_ops
    from app.graph.executors.base import GraphExecutionContext
    from app.graph.schemas import GraphWorkflow, GraphWorkflowNode

    def provider_reply(**kwargs):
        system_prompt = str(kwargs["messages"][0]["content"])
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

    assert environment["prompt_semantics"] == "environment_sheet"
    assert storyboard["prompt_semantics"] == "storyboard_sheet_with_metadata"


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

    with pytest.raises(ValueError, match="panel sequence is empty"):
        execute("Create the approved six-beat production board.", "storyboard_sheet_with_metadata")
    with pytest.raises(ValueError, match="panel sequence is empty"):
        execute(environment_prompt, "unknown_future_semantics")

    assert submitted_prompts == [
        environment_prompt,
        "Create storyboard contact-sheet art. PANEL COUNT: 4. Keep the CAMERA and ACTION beats visible.",
    ]
