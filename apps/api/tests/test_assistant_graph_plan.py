from __future__ import annotations

import importlib

import pytest


NODE_ENVELOPES = {
    "utility.note": (360, 320),
    "prompt.text": (420, 420),
    "model.kie.gpt_image_2_text_to_image": (380, 560),
    "preview.image": (360, 420),
    "media.save_image": (360, 380),
}


def _rect(node):
    width, height = NODE_ENVELOPES[node.type]
    return {
        "x": node.position["x"],
        "y": node.position["y"],
        "width": width,
        "height": height,
    }


def _has_gap(first, second, gap: float) -> bool:
    return (
        first["x"] + first["width"] + gap <= second["x"]
        or second["x"] + second["width"] + gap <= first["x"]
        or first["y"] + first["height"] + gap <= second["y"]
        or second["y"] + second["height"] + gap <= first["y"]
    )


def test_assistant_graph_plan_spaces_nodes_notes_and_group_bounds(app_modules) -> None:
    del app_modules
    graph_plan = importlib.import_module("app.assistant.graph_plan")
    graph_schemas = importlib.import_module("app.graph.schemas")
    assistant_schemas = importlib.import_module("app.assistant.schemas")
    workflow = graph_schemas.GraphWorkflow(
        name="Reusable image graph",
        nodes=[],
        edges=[],
        metadata={},
    )
    plan = assistant_schemas.AssistantGraphPlan.model_validate(
        {
            "summary": "Build a reusable image graph with guidance.",
            "operations": [
                {
                    "op": "add_note",
                    "node_ref": "instructions",
                    "title": "How to use",
                    "position": {"x": 40, "y": 40},
                    "body": "Enter a prompt, review the graph, then run it when ready.",
                },
                {
                    "op": "add_node",
                    "node_ref": "prompt",
                    "node_type": "prompt.text",
                    "position": {"x": 80, "y": 220},
                },
                {
                    "op": "add_node",
                    "node_ref": "generator",
                    "node_type": "model.kie.gpt_image_2_text_to_image",
                    "position": {"x": 420, "y": 220},
                    "fields": {"aspect_ratio": "16:9", "resolution": "1K"},
                },
                {
                    "op": "add_node",
                    "node_ref": "preview",
                    "node_type": "preview.image",
                    "position": {"x": 780, "y": 140},
                },
                {
                    "op": "add_node",
                    "node_ref": "save",
                    "node_type": "media.save_image",
                    "position": {"x": 780, "y": 340},
                },
                {
                    "op": "connect_nodes",
                    "source_ref": "prompt",
                    "source_port": "text",
                    "target_ref": "generator",
                    "target_port": "prompt",
                },
                {
                    "op": "connect_nodes",
                    "source_ref": "generator",
                    "source_port": "image",
                    "target_ref": "preview",
                    "target_port": "image",
                },
                {
                    "op": "connect_nodes",
                    "source_ref": "generator",
                    "source_port": "image",
                    "target_ref": "save",
                    "target_port": "image",
                },
                {
                    "op": "group_nodes",
                    "group_ref": "image_generation",
                    "title": "GPT Image 2 — Text to Image",
                    "node_refs": ["prompt", "generator", "preview", "save"],
                },
            ],
        }
    )

    result = graph_plan.apply_graph_plan(workflow, plan)

    nodes = {node.id: node for node in result.nodes}
    rects = [_rect(node) for node in nodes.values()]
    for index, first in enumerate(rects):
        for second in rects[index + 1 :]:
            assert _has_gap(first, second, 96)

    group = result.metadata["groups"][0]
    group_bounds = group["bounds"]
    for node_id in group["node_ids"]:
        member = _rect(nodes[node_id])
        assert group_bounds["x"] <= member["x"] - 96
        assert group_bounds["y"] <= member["y"] - 96
        assert group_bounds["x"] + group_bounds["width"] >= member["x"] + member["width"] + 96
        assert group_bounds["y"] + group_bounds["height"] >= member["y"] + member["height"] + 96

    note = _rect(nodes["assistant-instructions"])
    assert note["y"] + note["height"] + 96 <= group_bounds["y"]


def test_assistant_graph_plan_preserves_existing_nodes_and_avoids_them(app_modules) -> None:
    del app_modules
    graph_plan = importlib.import_module("app.assistant.graph_plan")
    graph_schemas = importlib.import_module("app.graph.schemas")
    assistant_schemas = importlib.import_module("app.assistant.schemas")
    workflow = graph_schemas.GraphWorkflow.model_validate(
        {
            "name": "Existing graph",
            "nodes": [
                {
                    "id": "existing-prompt",
                    "type": "prompt.text",
                    "position": {"x": 80, "y": 220},
                    "fields": {},
                }
            ],
            "edges": [],
            "metadata": {},
        }
    )
    plan = assistant_schemas.AssistantGraphPlan.model_validate(
        {
            "summary": "Add an image generator.",
            "operations": [
                {
                    "op": "add_node",
                    "node_ref": "generator",
                    "node_type": "model.kie.gpt_image_2_text_to_image",
                    "position": {"x": 80, "y": 220},
                }
            ],
        }
    )

    result = graph_plan.apply_graph_plan(workflow, plan)

    nodes = {node.id: node for node in result.nodes}
    existing = nodes["existing-prompt"]
    added = nodes["assistant-generator"]
    assert existing.position == {"x": 80.0, "y": 220.0}
    assert _has_gap(_rect(existing), _rect(added), 96)


def test_add_node_group_ref_expands_existing_selected_group(app_modules) -> None:
    del app_modules
    graph_plan = importlib.import_module("app.assistant.graph_plan")
    graph_schemas = importlib.import_module("app.graph.schemas")
    assistant_schemas = importlib.import_module("app.assistant.schemas")
    workflow = graph_schemas.GraphWorkflow.model_validate(
        {
            "name": "Product hero",
            "nodes": [
                {"id": "prompt", "type": "prompt.text", "position": {"x": 0, "y": 0}, "fields": {}},
                {
                    "id": "model",
                    "type": "model.kie.gpt_image_2_text_to_image",
                    "position": {"x": 520, "y": 0},
                    "fields": {},
                },
                {"id": "preview", "type": "preview.image", "position": {"x": 1000, "y": 0}, "fields": {}},
            ],
            "edges": [],
            "metadata": {
                "groups": [
                    {
                        "id": "product-hero-group",
                        "title": "Product Hero Generation",
                        "node_ids": ["prompt", "model", "preview"],
                        "bounds": {"x": -500, "y": -400, "width": 2200, "height": 1800},
                    }
                ]
            },
        }
    )
    plan = assistant_schemas.AssistantGraphPlan.model_validate(
        {
            "summary": "Add Save Image to the selected product group.",
            "operations": [
                {
                    "op": "add_node",
                    "node_ref": "save",
                    "node_type": "media.save_image",
                    "position": {"x": 1480, "y": 0},
                    "group_ref": "product-hero-group",
                },
                {
                    "op": "connect_nodes",
                    "source_ref": "model",
                    "source_port": "image",
                    "target_ref": "save",
                    "target_port": "image",
                },
            ],
        }
    )

    result = graph_plan.apply_graph_plan(workflow, plan)

    assert len(result.metadata["groups"]) == 1
    group = result.metadata["groups"][0]
    assert group["id"] == "product-hero-group"
    assert group["node_ids"] == ["prompt", "model", "preview", "assistant-save"]
    save = next(node for node in result.nodes if node.id == "assistant-save")
    save_bounds = _rect(save)
    assert group["bounds"]["x"] == -500
    assert group["bounds"]["y"] == -400
    assert group["bounds"]["height"] >= 1800
    assert group["bounds"]["x"] + group["bounds"]["width"] >= save_bounds["x"] + save_bounds["width"] + 96
    assert group["bounds"]["y"] + group["bounds"]["height"] >= save_bounds["y"] + save_bounds["height"] + 96


def test_add_node_rejects_unknown_group_ref(app_modules) -> None:
    del app_modules
    graph_plan = importlib.import_module("app.assistant.graph_plan")
    graph_schemas = importlib.import_module("app.graph.schemas")
    assistant_schemas = importlib.import_module("app.assistant.schemas")
    workflow = graph_schemas.GraphWorkflow.model_validate(
        {
            "name": "Product hero",
            "nodes": [],
            "edges": [],
            "metadata": {"groups": []},
        }
    )
    plan = assistant_schemas.AssistantGraphPlan.model_validate(
        {
            "summary": "Add Save Image to a missing group.",
            "operations": [
                {
                    "op": "add_node",
                    "node_ref": "save",
                    "node_type": "media.save_image",
                    "group_ref": "missing-group",
                }
            ],
        }
    )

    with pytest.raises(ValueError, match="unknown group"):
        graph_plan.apply_graph_plan(workflow, plan)


def test_single_assistant_group_includes_connected_prompt_inputs_but_not_notes(app_modules) -> None:
    del app_modules
    graph_plan = importlib.import_module("app.assistant.graph_plan")
    graph_schemas = importlib.import_module("app.graph.schemas")
    assistant_schemas = importlib.import_module("app.assistant.schemas")
    workflow = graph_schemas.GraphWorkflow(name="Still to motion", nodes=[], edges=[], metadata={})
    plan = assistant_schemas.AssistantGraphPlan.model_validate(
        {
            "summary": "Build a grouped still-to-motion workflow.",
            "operations": [
                {"op": "add_note", "node_ref": "guide", "position": {"x": 40, "y": 40}, "body": "How to use this graph."},
                {"op": "add_node", "node_ref": "still_prompt", "node_type": "prompt.text", "position": {"x": 40, "y": 220}},
                {"op": "add_node", "node_ref": "motion_prompt", "node_type": "prompt.text", "position": {"x": 40, "y": 720}},
                {
                    "op": "add_node",
                    "node_ref": "still_model",
                    "node_type": "model.kie.gpt_image_2_text_to_image",
                    "position": {"x": 520, "y": 220},
                },
                {
                    "op": "add_node",
                    "node_ref": "video_model",
                    "node_type": "model.kie.seedance_2_5",
                    "position": {"x": 980, "y": 220},
                },
                {
                    "op": "connect_nodes",
                    "source_ref": "still_prompt",
                    "source_port": "text",
                    "target_ref": "still_model",
                    "target_port": "prompt",
                },
                {
                    "op": "connect_nodes",
                    "source_ref": "motion_prompt",
                    "source_port": "text",
                    "target_ref": "video_model",
                    "target_port": "prompt",
                },
                {
                    "op": "connect_nodes",
                    "source_ref": "still_model",
                    "source_port": "image",
                    "target_ref": "video_model",
                    "target_port": "start_frame",
                },
                {
                    "op": "group_nodes",
                    "group_ref": "processing",
                    "title": "Still to Motion",
                    "node_refs": ["guide", "still_model", "video_model"],
                },
            ],
        }
    )

    result = graph_plan.apply_graph_plan(workflow, plan)

    group = result.metadata["groups"][0]
    assert set(group["node_ids"]) == {
        "assistant-still-prompt",
        "assistant-motion-prompt",
        "assistant-still-model",
        "assistant-video-model",
    }
    assert "assistant-guide" not in group["node_ids"]


def test_assistant_layout_does_not_stack_new_nodes_into_existing_canvas_content(app_modules) -> None:
    del app_modules
    graph_plan = importlib.import_module("app.assistant.graph_plan")
    graph_schemas = importlib.import_module("app.graph.schemas")
    assistant_schemas = importlib.import_module("app.assistant.schemas")
    workflow = graph_schemas.GraphWorkflow.model_validate(
        {
            "name": "Existing lower canvas section",
            "nodes": [
                {
                    "id": "existing-prompt",
                    "type": "prompt.text",
                    "position": {"x": 0, "y": 1000},
                    "fields": {},
                }
            ],
            "edges": [],
            "metadata": {},
        }
    )
    plan = assistant_schemas.AssistantGraphPlan.model_validate(
        {
            "summary": "Add three vertically stacked prompts.",
            "operations": [
                {
                    "op": "add_node",
                    "node_ref": node_ref,
                    "node_type": "prompt.text",
                    "position": {"x": 0, "y": 0},
                }
                for node_ref in ["first", "second", "third"]
            ],
        }
    )

    result = graph_plan.apply_graph_plan(workflow, plan)

    nodes = {node.id: node for node in result.nodes}
    assert nodes["existing-prompt"].position == {"x": 0.0, "y": 1000.0}
    existing_rect = _rect(nodes["existing-prompt"])
    for node_id in ["assistant-first", "assistant-second", "assistant-third"]:
        assert _has_gap(existing_rect, _rect(nodes[node_id]), 96)


def test_assistant_graph_plan_drops_a_group_that_contains_only_a_note(app_modules) -> None:
    del app_modules
    graph_plan = importlib.import_module("app.assistant.graph_plan")
    graph_schemas = importlib.import_module("app.graph.schemas")
    assistant_schemas = importlib.import_module("app.assistant.schemas")
    workflow = graph_schemas.GraphWorkflow(name="Instructions", nodes=[], edges=[], metadata={})
    plan = assistant_schemas.AssistantGraphPlan.model_validate(
        {
            "summary": "Add instructions without an empty frame.",
            "operations": [
                {"op": "add_note", "node_ref": "guide", "position": {"x": 40, "y": 40}, "body": "How to use this graph."},
                {
                    "op": "group_nodes",
                    "group_ref": "guide_group",
                    "title": "Instructions",
                    "node_refs": ["guide"],
                },
            ],
        }
    )

    result = graph_plan.apply_graph_plan(workflow, plan)

    assert result.metadata["groups"] == []


def test_assistant_graph_plan_separates_explicit_group_frames(app_modules) -> None:
    del app_modules
    graph_plan = importlib.import_module("app.assistant.graph_plan")
    graph_schemas = importlib.import_module("app.graph.schemas")
    assistant_schemas = importlib.import_module("app.assistant.schemas")
    workflow = graph_schemas.GraphWorkflow(name="Two branches", nodes=[], edges=[], metadata={})
    plan = assistant_schemas.AssistantGraphPlan.model_validate(
        {
            "summary": "Build two separately grouped branches.",
            "operations": [
                {
                    "op": "add_node",
                    "node_ref": node_ref,
                    "node_type": "prompt.text",
                    "position": {"x": x, "y": y},
                }
                for node_ref, x, y in [
                    ("a_left", 0, 0),
                    ("a_right", 1000, 0),
                    ("b_left", 0, 500),
                    ("b_right", 1000, 500),
                ]
            ]
            + [
                {
                    "op": "group_nodes",
                    "group_ref": "branch_a",
                    "title": "Branch A",
                    "node_refs": ["a_left", "a_right"],
                },
                {
                    "op": "group_nodes",
                    "group_ref": "branch_b",
                    "title": "Branch B",
                    "node_refs": ["b_left", "b_right"],
                },
            ],
        }
    )

    result = graph_plan.apply_graph_plan(workflow, plan)

    first_group, second_group = result.metadata["groups"]
    assert _has_gap(first_group["bounds"], second_group["bounds"], 96)
