from __future__ import annotations

from io import BytesIO
import importlib
import time

import pytest
from PIL import Image

from test_storyboard_sheet_spec import _recipe_result
from app.graph.storyboard_sheet_spec import storyboard_sheet_spec_from_recipe_result


def _run_graph_workflow(client, workflow: dict) -> dict:
    create_response = client.post("/media/graph/workflows", json=workflow)
    assert create_response.status_code == 200, create_response.text
    run_response = client.post(f"/media/graph/workflows/{create_response.json()['workflow_id']}/runs", json={})
    assert run_response.status_code == 200, run_response.text
    run_id = run_response.json()["run_id"]
    final_payload = None
    for _ in range(80):
        current = client.get(f"/media/graph/runs/{run_id}")
        assert current.status_code == 200
        final_payload = current.json()
        if final_payload["status"] in {"completed", "failed"}:
            break
        time.sleep(0.1)
    assert final_payload is not None
    return final_payload


def test_graph_storyboard_codex_local_uses_bounded_repair_and_typed_display_compaction(client, app_modules, monkeypatch) -> None:
    image = Image.new("RGB", (2, 2), (80, 120, 180))
    buffer = BytesIO()
    image.save(buffer, "PNG")
    character_sheet_ref = app_modules["service"].import_reference_media_bytes(
        source_bytes=buffer.getvalue(),
        source_name="storyboard-contract-repair-character.png",
        source_mime_type="image/png",
    )["reference_id"]
    calls = []

    def storyboard_prompt(*, missing_panel_one_notes: bool, overlong_panel_six_camera: bool = False) -> str:
        panels = []
        for number in range(1, 7):
            notes = "" if missing_panel_one_notes and number == 1 else f"Maintain continuity state {number}."
            camera = (
                "Eye-level three-quarter angle, controlled forward dolly movement, natural 50mm lens; "
                "medium-wide frame with the subject on the left while background markers remain visible and stable."
                if overlong_panel_six_camera and number == 6
                else "Eye-level dolly push, natural 35mm feel; medium shot, subject centered"
            )
            if overlong_panel_six_camera:
                panels.append(
                    f"PANEL {number:02d}: SHOT: {number:02d} — CONTRACT BEAT {number}; "
                    f"CAMERA: {camera}; ACTION: The subject checks marker {number}.; "
                    f"MOTION: The camera advances while dust crosses marker {number}.; "
                    f"DIALOG:; NOTES: {notes}"
                )
            else:
                panels.append(
                    f"PANEL {number:02d} IMAGE AND METADATA:\n"
                    f"SHOT: {number:02d} — CONTRACT BEAT {number}\n"
                    f"CAMERA: {camera}\n"
                    f"ACTION: The subject checks marker {number}.\n"
                    f"MOTION: The camera advances while dust crosses marker {number}.\n"
                    "DIALOG: \n"
                    f"NOTES: {notes}"
                )
        return (
            "BOARD TITLE: BOARD 1 OF 1 — CONTRACT TEST\n"
            "PRODUCTION METADATA: PROJECT: TEST; SEQUENCE: BOARD 1 OF 1; LOCATION: STUDIO; DATE: —; ARTIST: —\n\n"
            + "\n\n".join(panels)
        )

    responses = [
        storyboard_prompt(missing_panel_one_notes=True),
        storyboard_prompt(missing_panel_one_notes=False, overlong_panel_six_camera=True),
        storyboard_prompt(missing_panel_one_notes=False, overlong_panel_six_camera=True),
    ]

    def fake_codex_chat(**kwargs):
        calls.append(kwargs)
        return {
            "provider_kind": "codex_local",
            "provider_model_id": kwargs["model_id"],
            "generated_text": responses.pop(0),
            "warnings": [],
        }

    monkeypatch.setattr(
        "app.graph.executors.prompt_ops.enhancement_provider.run_codex_local_chat",
        fake_codex_chat,
    )
    workflow = {
        "schema_version": 1,
        "name": "Storyboard contract repair",
        "nodes": [
            {
                "id": "character-sheet",
                "type": "media.load_image",
                "position": {"x": -420, "y": 0},
                "fields": {"reference_id": character_sheet_ref},
            },
            {
                "id": "storyboard",
                "type": "prompt.recipe",
                "position": {"x": 80, "y": 0},
                "fields": {
                    "recipe_id": "prompt-recipe-storyboard-v2-gpt-image-2",
                    "recipe_category": "image",
                    "user_prompt": "Create six sequential production beats from the supplied character reference.",
                    "previous_output": "No previous board handoff provided.",
                    "style_direction": "cinematic realism",
                    "shot_count": "6",
                    "aspect_ratio": "16:9",
                    "dialogue_mode": "none",
                    "board_title": "BOARD 1 OF 1 — CONTRACT TEST",
                    "production_metadata": "PROJECT: TEST; SEQUENCE: BOARD 1 OF 1; LOCATION: STUDIO; DATE: —; ARTIST: —",
                    "provider": "codex_local",
                    "model_id": "gpt-5.6-sol",
                    "provider_supports_images": True,
                    "provider_capabilities_json": {
                        "supports_images": True,
                        "input_modalities": ["text", "image"],
                    },
                },
            },
        ],
        "edges": [
            {
                "id": "edge-character-storyboard",
                "source": "character-sheet",
                "source_port": "image",
                "target": "storyboard",
                "target_port": "character_ref",
            }
        ],
    }

    payload = _run_graph_workflow(client, workflow)

    assert payload["status"] == "completed", payload.get("error")
    assert len(calls) == 2
    assert calls[0]["error_context"] == "prompt recipe execution"
    assert calls[1]["error_context"] == "prompt recipe storyboard contract repair"
    repair_instruction = calls[1]["messages"][-1]["content"]
    assert "Panel 01 NOTES is empty" in repair_instruction
    assert "SHOT is the one required heading above the image" in repair_instruction
    assert "exactly five rows in CAMERA, ACTION, MOTION, DIALOG, NOTES order" in repair_instruction
    assert "CAMERA <= 136 characters" in repair_instruction
    assert "Measure every value after revision" in repair_instruction
    assert "audit every field in every panel" in repair_instruction
    assert "do not merely repair the first reported field" in repair_instruction
    assert "Do not copy, paraphrase, or cross-fill" in repair_instruction
    storyboard_node = next(node for node in payload["nodes"] if node["node_id"] == "storyboard")
    assert "NOTES: Maintain continuity state 1." in storyboard_node["output_snapshot_json"]["text"][0]["value"]
    final_text = storyboard_node["output_snapshot_json"]["text"][0]["value"]
    compiled = storyboard_sheet_spec_from_recipe_result(
        {"recipe_key": "storyboard-v2-gpt-image-2", "raw_text": final_text, "final_text": final_text}
    )
    assert len(compiled.panels[5].camera) <= 136
    assert "50mm lens" in compiled.panels[5].camera
    assert len(storyboard_node["metrics_json"]["llm_calls"]) == 2
    assert [call["source_kind"] for call in storyboard_node["metrics_json"]["llm_calls"]] == [
        "graph_prompt_recipe_final",
        "graph_prompt_recipe_contract_retry",
    ]


def test_storyboard_node_definitions_are_backend_owned_and_typed(client) -> None:
    response = client.get("/media/graph/node-definitions")
    assert response.status_code == 200, response.text
    definitions = {item["type"]: item for item in response.json()["items"]}

    compiler = definitions["storyboard.compile"]
    assert [(port["id"], port["type"], port["array"]) for port in compiler["ports"]["inputs"]] == [
        ("result", "json", False)
    ]
    assert {port["id"] for port in compiler["ports"]["outputs"]} == {"prompt", "spec", "panel_prompts"}
    assert compiler["limits"]["panel_counts"] == [4, 6, 9]
    assert compiler["limits"]["max_art_prompt_chars"] == 4200

    compositor = definitions["image.storyboard_sheet"]
    inputs = {port["id"]: port for port in compositor["ports"]["inputs"]}
    assert inputs["images"]["type"] == "image"
    assert inputs["images"]["array"] is True
    assert inputs["images"]["min"] == 1
    assert inputs["images"]["max"] == 9
    assert inputs["spec"]["type"] == "json"
    assert compositor["limits"]["output_width"] == 2048
    assert compositor["limits"]["output_height_by_panel_count"] == {"4": 2048, "6": 1152, "9": 2048}


def test_prompt_parse_accepts_storyboard_compiler_panel_prompt_list(app_modules) -> None:
    base = importlib.import_module("app.graph.executors.base")
    prompt_ops = importlib.import_module("app.graph.executors.prompt_ops")
    schemas = importlib.import_module("app.graph.schemas")
    GraphExecutionContext = base.GraphExecutionContext
    PromptParseExecutor = prompt_ops.PromptParseExecutor
    GraphOutputRef = schemas.GraphOutputRef
    GraphWorkflow = schemas.GraphWorkflow
    GraphWorkflowEdge = schemas.GraphWorkflowEdge
    GraphWorkflowNode = schemas.GraphWorkflowNode
    compiler = GraphWorkflowNode(id="compiler", type="storyboard.compile")
    parser = GraphWorkflowNode(id="parser", type="prompt.parse")
    edge = GraphWorkflowEdge(
        id="compiler-panel-prompts",
        source="compiler",
        source_port="panel_prompts",
        target="parser",
        target_port="result",
    )
    workflow = GraphWorkflow(nodes=[compiler, parser], edges=[edge])
    context = GraphExecutionContext(
        run_id="storyboard-panel-prompt-parse-test",
        workflow=workflow,
        edge_outputs={
            edge.id: [
                GraphOutputRef(
                    kind="value",
                    media_type="json",
                    value=["Hero entrance view", "Reverse view", "Side view", "High wide view"],
                    metadata={"source": "storyboard.compile"},
                )
            ]
        },
    )

    parsed = PromptParseExecutor().execute(parser, context)

    assert [parsed[f"prompt_{index}"][0].value for index in range(1, 5)] == [
        "Hero entrance view",
        "Reverse view",
        "Side view",
        "High wide view",
    ]
    assert parsed["result"][0].value == {
        "prompts": ["Hero entrance view", "Reverse view", "Side view", "High wide view"],
        "source": "storyboard.compile",
    }


def test_storyboard_compiler_and_compositor_executors_round_trip(app_modules) -> None:
    base = importlib.import_module("app.graph.executors.base")
    image_ops = importlib.import_module("app.graph.executors.image_ops")
    storyboard_ops = importlib.import_module("app.graph.executors.storyboard_ops")
    schemas = importlib.import_module("app.graph.schemas")
    GraphExecutionContext = base.GraphExecutionContext
    StoryboardSheetExecutor = image_ops.StoryboardSheetExecutor
    StoryboardCompileExecutor = storyboard_ops.StoryboardCompileExecutor
    GraphOutputRef = schemas.GraphOutputRef
    GraphWorkflow = schemas.GraphWorkflow
    GraphWorkflowEdge = schemas.GraphWorkflowEdge
    GraphWorkflowNode = schemas.GraphWorkflowNode
    recipe_result = _recipe_result(
        recipe_key="storyboard-v2-gpt-image-2",
        subject="A compact quadruped survey companion has articulated brass forelimbs and violet status lights.",
    )
    source = GraphWorkflowNode(id="recipe", type="prompt.recipe")
    compiler = GraphWorkflowNode(id="compiler", type="storyboard.compile")
    compile_edge = GraphWorkflowEdge(
        id="recipe-result",
        source="recipe",
        source_port="result",
        target="compiler",
        target_port="result",
    )
    compile_workflow = GraphWorkflow(nodes=[source, compiler], edges=[compile_edge])
    compile_context = GraphExecutionContext(
        run_id="storyboard-compile-test",
        workflow=compile_workflow,
        edge_outputs={
            compile_edge.id: [GraphOutputRef(kind="value", media_type="json", value=recipe_result)]
        },
    )

    compiled = StoryboardCompileExecutor().execute(compiler, compile_context)

    assert len(compiled["prompt"][0].value) <= 4200
    assert compiled["prompt"][0].metadata["storyboard_source_grid"] == "2x3"
    assert compiled["prompt"][0].metadata["storyboard_source_aspect_ratio"] == "4:3"
    assert compiled["prompt"][0].metadata["storyboard_panel_count"] == 6
    assert compiled["spec"][0].value["contract_version"] == "1"
    assert len(compiled["spec"][0].value["panels"]) == 6
    assert len(compiled["panel_prompts"][0].value) == 6

    art_grid = Image.new("RGB", (400, 600), "#314b5f")
    buffer = BytesIO()
    art_grid.save(buffer, "PNG")
    reference = app_modules["service"].import_reference_media_bytes(
        source_bytes=buffer.getvalue(),
        source_name="storyboard-art-grid.png",
        source_mime_type="image/png",
    )
    image_source = GraphWorkflowNode(id="art", type="media.load_image")
    spec_source = GraphWorkflowNode(id="spec", type="debug.metadata")
    compositor = GraphWorkflowNode(id="sheet", type="image.storyboard_sheet")
    image_edge = GraphWorkflowEdge(
        id="art-sheet",
        source="art",
        source_port="image",
        target="sheet",
        target_port="images",
    )
    spec_edge = GraphWorkflowEdge(
        id="spec-sheet",
        source="spec",
        source_port="json",
        target="sheet",
        target_port="spec",
    )
    compose_workflow = GraphWorkflow(nodes=[image_source, spec_source, compositor], edges=[image_edge, spec_edge])
    compose_context = GraphExecutionContext(
        run_id="storyboard-compose-test",
        workflow=compose_workflow,
        edge_outputs={
            image_edge.id: [
                GraphOutputRef(kind="reference_media", media_type="image", reference_id=reference["reference_id"])
            ],
            spec_edge.id: compiled["spec"],
        },
    )

    composed = StoryboardSheetExecutor().execute(compositor, compose_context)

    assert composed["image"][0].reference_id
    assert composed["image"][0].metadata["width"] == 2048
    assert composed["image"][0].metadata["height"] == 1152
    assert composed["image"][0].metadata["input_mode"] == "wide_2x3_source_grid"
    assert composed["metadata"][0].value["panel_geometry"][0]["panel"] == 1


def test_storyboard_compositor_rejects_historical_complete_sheet_asset_prompt(app_modules, monkeypatch) -> None:
    image_ops = importlib.import_module("app.graph.executors.image_ops")
    schemas = importlib.import_module("app.graph.schemas")
    GraphOutputRef = schemas.GraphOutputRef
    source = GraphOutputRef(kind="asset", media_type="image", asset_id="asset-historical", job_id="job-historical")

    monkeypatch.setattr(image_ops, "graph_ref_record", lambda ref: {"job_id": "job-historical"})
    monkeypatch.setattr(
        image_ops.store,
        "get_job",
        lambda job_id: {
            "final_prompt_used": (
                "Create one finished 16:9 storyboard on a fixed sequence template. "
                "Under each image: six separate full-width horizontal metadata rows."
            )
        },
    )

    with pytest.raises(ValueError, match=r"current art-only 2x3 source contract"):
        image_ops._validate_storyboard_art_sources([source])


def test_storyboard_compositor_accepts_current_art_only_asset_and_six_ordered_images(app_modules, monkeypatch) -> None:
    image_ops = importlib.import_module("app.graph.executors.image_ops")
    schemas = importlib.import_module("app.graph.schemas")
    spec_module = importlib.import_module("app.graph.storyboard_sheet_spec")
    GraphOutputRef = schemas.GraphOutputRef
    current = GraphOutputRef(kind="asset", media_type="image", asset_id="asset-current", job_id="job-current")

    monkeypatch.setattr(image_ops, "graph_ref_record", lambda ref: {"job_id": ref.job_id})
    monkeypatch.setattr(
        image_ops.store,
        "get_job",
        lambda job_id: {
            "final_prompt_used": (
                f"Storyboard art source contract: {spec_module.STORYBOARD_ART_SOURCE_CONTRACT}. "
                "Source grid: 2x3. Create one text-free 4:3 source plate with exactly six equal cinematic frames "
                "in a clean 2-column by 3-row source grid."
            )
        },
    )

    image_ops._validate_storyboard_art_sources([current])
    image_ops._validate_storyboard_art_sources(
        [
            GraphOutputRef(kind="asset", media_type="image", asset_id=f"asset-{index}", job_id=f"job-{index}")
            for index in range(6)
        ]
    )


def test_kie_model_executor_uses_compiled_storyboard_aspect_metadata(app_modules) -> None:
    kie_model = importlib.import_module("app.graph.executors.kie_model")
    schemas = importlib.import_module("app.graph.schemas")
    spec_module = importlib.import_module("app.graph.storyboard_sheet_spec")
    GraphOutputRef = schemas.GraphOutputRef
    prompt_ref = GraphOutputRef(
        kind="value",
        media_type="text",
        value="compiled storyboard prompt",
        metadata={
            "storyboard_art_source_contract": spec_module.STORYBOARD_ART_SOURCE_CONTRACT,
            "storyboard_source_grid": "2x3",
            "storyboard_source_aspect_ratio": "4:3",
        },
    )

    assert kie_model._storyboard_prompt_aspect_ratio([prompt_ref], {"aspect_ratio", "resolution"}) == "4:3"
    assert kie_model._storyboard_prompt_aspect_ratio([prompt_ref], {"resolution"}) == ""


def test_storyboard_compositor_accepts_explicitly_audited_source_contract(app_modules, monkeypatch) -> None:
    image_ops = importlib.import_module("app.graph.executors.image_ops")
    schemas = importlib.import_module("app.graph.schemas")
    spec_module = importlib.import_module("app.graph.storyboard_sheet_spec")
    GraphOutputRef = schemas.GraphOutputRef
    audited = GraphOutputRef(kind="asset", media_type="image", asset_id="asset-audited", job_id="job-audited")

    monkeypatch.setattr(
        image_ops,
        "graph_ref_record",
        lambda ref: {
            "job_id": ref.job_id,
            "payload_json": {
                "storyboard_art_source_contract": spec_module.STORYBOARD_ART_SOURCE_CONTRACT,
                "storyboard_source_grid": spec_module.STORYBOARD_ART_SOURCE_GRID,
            },
        },
    )
    monkeypatch.setattr(image_ops.store, "get_job", lambda job_id: None)

    image_ops._validate_storyboard_art_sources([audited])


def test_storyboard_compositor_rejects_incomplete_audited_source_declaration(app_modules, monkeypatch) -> None:
    image_ops = importlib.import_module("app.graph.executors.image_ops")
    schemas = importlib.import_module("app.graph.schemas")
    spec_module = importlib.import_module("app.graph.storyboard_sheet_spec")
    GraphOutputRef = schemas.GraphOutputRef
    source = GraphOutputRef(kind="asset", media_type="image", asset_id="asset-ambiguous", job_id="job-ambiguous")

    monkeypatch.setattr(
        image_ops,
        "graph_ref_record",
        lambda ref: {
            "job_id": ref.job_id,
            "payload_json": {
                "storyboard_art_source_contract": spec_module.STORYBOARD_ART_SOURCE_CONTRACT,
            },
        },
    )
    monkeypatch.setattr(image_ops.store, "get_job", lambda job_id: None)

    with pytest.raises(ValueError, match=r"current art-only 2x3 source contract"):
        image_ops._validate_storyboard_art_sources([source])
