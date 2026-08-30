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


def _inter_group_edge_crossings(workflow) -> list[tuple[str, str]]:
    groups = workflow.metadata.get("groups", [])
    group_by_node = {
        node_id: group
        for group in groups
        for node_id in group.get("node_ids", [])
    }
    routed = []
    for edge in workflow.edges:
        source_group = group_by_node.get(edge.source)
        target_group = group_by_node.get(edge.target)
        if not source_group or not target_group or source_group["id"] == target_group["id"]:
            continue
        source_bounds = source_group["bounds"]
        target_bounds = target_group["bounds"]
        routed.append(
            (
                edge.id,
                source_group["id"],
                target_group["id"],
                source_bounds["x"] + source_bounds["width"] / 2,
                source_bounds["y"] + source_bounds["height"] / 2,
                target_bounds["x"] + target_bounds["width"] / 2,
                target_bounds["y"] + target_bounds["height"] / 2,
            )
        )
    crossings = []
    for index, first in enumerate(routed):
        for second in routed[index + 1 :]:
            if first[1] == second[1] or first[2] == second[2]:
                continue
            same_stage_pair = abs(first[3] - second[3]) < 0.01 and abs(first[5] - second[5]) < 0.01
            if same_stage_pair and (first[4] - second[4]) * (first[6] - second[6]) < 0:
                crossings.append((first[0], second[0]))
    return crossings


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


def test_remove_nodes_from_group_contracts_existing_group_without_changing_other_groups(app_modules) -> None:
    del app_modules
    graph_plan = importlib.import_module("app.assistant.graph_plan")
    graph_schemas = importlib.import_module("app.graph.schemas")
    assistant_schemas = importlib.import_module("app.assistant.schemas")
    workflow = graph_schemas.GraphWorkflow.model_validate(
        {
            "name": "Correct overlapping memberships",
            "nodes": [
                {"id": "character", "type": "preview.image", "position": {"x": 0, "y": 0}, "fields": {}},
                {"id": "poster", "type": "preview.image", "position": {"x": 480, "y": 0}, "fields": {}},
            ],
            "edges": [],
            "metadata": {
                "groups": [
                    {
                        "id": "character-group",
                        "title": "Character",
                        "node_ids": ["character"],
                        "bounds": {"x": -96, "y": -96, "width": 552, "height": 552},
                    },
                    {
                        "id": "poster-group",
                        "title": "Poster",
                        "node_ids": ["character", "poster"],
                        "bounds": {"x": -96, "y": -96, "width": 1032, "height": 552},
                    },
                ]
            },
        }
    )
    plan = assistant_schemas.AssistantGraphPlan.model_validate(
        {
            "summary": "Remove the character node from the poster group only.",
            "operations": [
                {
                    "op": "remove_nodes_from_group",
                    "group_ref": "poster-group",
                    "node_refs": ["character"],
                }
            ],
        }
    )

    result = graph_plan.apply_graph_plan(workflow, plan)
    groups = {group["id"]: group for group in result.metadata["groups"]}

    assert groups["character-group"]["node_ids"] == ["character"]
    assert groups["poster-group"]["node_ids"] == ["poster"]
    assert groups["poster-group"]["bounds"] == graph_plan._compute_group_bounds(
        [next(node for node in result.nodes if node.id == "poster")]
    )


def test_remove_nodes_from_group_can_be_combined_with_atomic_workflow_arrangement(app_modules) -> None:
    del app_modules
    graph_plan = importlib.import_module("app.assistant.graph_plan")
    graph_schemas = importlib.import_module("app.graph.schemas")
    assistant_schemas = importlib.import_module("app.assistant.schemas")
    workflow = graph_schemas.GraphWorkflow.model_validate(
        {
            "name": "Repair and tidy",
            "nodes": [
                {"id": "character", "type": "preview.image", "position": {"x": 0, "y": 0}, "fields": {}},
                {"id": "poster", "type": "preview.image", "position": {"x": 40, "y": 20}, "fields": {}},
            ],
            "edges": [],
            "metadata": {
                "groups": [
                    {"id": "character-group", "title": "Character", "node_ids": ["character"], "bounds": {"x": -96, "y": -96, "width": 552, "height": 552}},
                    {"id": "poster-group", "title": "Poster", "node_ids": ["character", "poster"], "bounds": {"x": -96, "y": -96, "width": 592, "height": 572}},
                ]
            },
        }
    )
    plan = assistant_schemas.AssistantGraphPlan.model_validate(
        {
            "summary": "Repair the membership and tidy the workflow atomically.",
            "operations": [
                {"op": "remove_nodes_from_group", "group_ref": "poster-group", "node_refs": ["character"]},
                {"op": "arrange_workflow"},
            ],
        }
    )

    result = graph_plan.apply_graph_plan(workflow, plan)
    groups = {group["id"]: group for group in result.metadata["groups"]}

    assert groups["character-group"]["node_ids"] == ["character"]
    assert groups["poster-group"]["node_ids"] == ["poster"]
    assert graph_plan._rects_have_gap(groups["character-group"]["bounds"], groups["poster-group"]["bounds"], 96)


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


def test_arrange_workflow_preserves_semantics_and_is_idempotent(app_modules) -> None:
    del app_modules
    graph_plan = importlib.import_module("app.assistant.graph_plan")
    graph_diff = importlib.import_module("app.assistant.graph_diff")
    graph_schemas = importlib.import_module("app.graph.schemas")
    assistant_schemas = importlib.import_module("app.assistant.schemas")

    node_specs = [
        ("crew-prompt", "prompt.text", "Crew Prompt"),
        ("crew-model", "model.kie.gpt_image_2_text_to_image", "Crew Model"),
        ("crew-preview", "preview.image", "Crew Preview"),
        ("shot-1-prompt", "prompt.text", "Shot 1 Prompt"),
        ("shot-1-model", "model.kie.gpt_image_2_image_to_image", "Shot 1 Model"),
        ("shot-1-preview", "preview.image", "Shot 1 Preview"),
        ("shot-2-prompt", "prompt.text", "Shot 2 Prompt"),
        ("shot-2-model", "model.kie.gpt_image_2_image_to_image", "Shot 2 Model"),
        ("shot-2-preview", "preview.image", "Shot 2 Preview"),
        ("video-1-prompt", "prompt.text", "Video 1 Prompt"),
        ("video-1-model", "model.kie.seedance_2_0", "Video 1 Model"),
        ("video-1-preview", "preview.video", "Video 1 Preview"),
        ("video-2-prompt", "prompt.text", "Video 2 Prompt"),
        ("video-2-model", "model.kie.seedance_2_0", "Video 2 Model"),
        ("video-2-preview", "preview.video", "Video 2 Preview"),
        ("combine", "video.combine", "Final Combine"),
        ("final-preview", "preview.video", "Final Preview"),
        ("final-save", "media.save_video", "Final Save"),
        ("guide", "utility.note", "Production Notes"),
    ]
    nodes = [
        {
            "id": node_id,
            "type": node_type,
            "position": {"x": float(index % 3) * 120, "y": float(index // 3) * 80},
            "fields": {"body": "Keep this production readable."} if node_type == "utility.note" else {},
            "metadata": {"ui": {"customTitle": title}},
        }
        for index, (node_id, node_type, title) in enumerate(node_specs)
    ]
    edge_specs = [
        ("crew-prompt", "crew-model"),
        ("crew-model", "crew-preview"),
        ("shot-1-prompt", "shot-1-model"),
        ("crew-model", "shot-1-model"),
        ("shot-1-model", "shot-1-preview"),
        ("shot-2-prompt", "shot-2-model"),
        ("crew-model", "shot-2-model"),
        ("shot-2-model", "shot-2-preview"),
        ("video-1-prompt", "video-1-model"),
        ("shot-1-model", "video-1-model"),
        ("video-1-model", "video-1-preview"),
        ("video-2-prompt", "video-2-model"),
        ("shot-2-model", "video-2-model"),
        ("video-2-model", "video-2-preview"),
        ("video-1-model", "combine"),
        ("video-2-model", "combine"),
        ("combine", "final-preview"),
        ("combine", "final-save"),
    ]
    edges = [
        {
            "id": f"edge-{source}-{target}",
            "source": source,
            "source_port": "output",
            "target": target,
            "target_port": "input",
        }
        for source, target in edge_specs
    ]
    group_specs = [
        ("crew", "Crew Character Sheet", ["crew-prompt", "crew-model", "crew-preview"]),
        ("shot-1", "Shot 1 — Keyframe", ["shot-1-prompt", "shot-1-model", "shot-1-preview"]),
        ("shot-2", "Shot 2 — Keyframe", ["shot-2-prompt", "shot-2-model", "shot-2-preview"]),
        ("video-1", "Shot 1 — Video", ["video-1-prompt", "video-1-model", "video-1-preview"]),
        ("video-2", "Shot 2 — Video", ["video-2-prompt", "video-2-model", "video-2-preview"]),
        ("final", "Final Assembly", ["combine", "final-preview", "final-save"]),
    ]
    workflow = graph_schemas.GraphWorkflow.model_validate(
        {
            "name": "Crowded production",
            "nodes": nodes,
            "edges": edges,
            "metadata": {
                "owner_note": "preserve me",
                "groups": [
                    {
                        "id": group_id,
                        "title": title,
                        "color": "blue",
                        "node_ids": member_ids,
                        "bounds": {"x": 0, "y": 0, "width": 400, "height": 300},
                        "execution": {"mode": "enabled"},
                    }
                    for group_id, title, member_ids in group_specs
                ],
            },
        }
    )
    plan = assistant_schemas.AssistantGraphPlan.model_validate(
        {
            "summary": "Tidy the complete production graph without changing its meaning.",
            "operations": [{"op": "arrange_workflow"}],
        }
    )

    def semantic_snapshot(candidate):
        payload = candidate.model_dump(mode="json")
        for node in payload["nodes"]:
            node.pop("position", None)
        payload["metadata"].pop("assistant_plan", None)
        for group in payload["metadata"]["groups"]:
            group.pop("bounds", None)
        return payload

    baseline = semantic_snapshot(graph_plan.materialize_workflow_defaults(workflow))
    result = graph_plan.apply_graph_plan(workflow, plan)

    assert semantic_snapshot(result) == baseline
    assert result.metadata["owner_note"] == "preserve me"

    groups = {group["id"]: group for group in result.metadata["groups"]}
    for index, first in enumerate(groups.values()):
        for second in list(groups.values())[index + 1 :]:
            assert _has_gap(first["bounds"], second["bounds"], 96)

    assert groups["crew"]["bounds"]["x"] < groups["shot-1"]["bounds"]["x"]
    assert groups["shot-1"]["bounds"]["x"] < groups["video-1"]["bounds"]["x"]
    assert groups["video-1"]["bounds"]["x"] < groups["final"]["bounds"]["x"]
    assert groups["shot-1"]["bounds"]["y"] < groups["shot-2"]["bounds"]["y"]
    assert groups["video-1"]["bounds"]["y"] < groups["video-2"]["bounds"]["y"]
    assert groups["shot-1"]["bounds"]["y"] == groups["video-1"]["bounds"]["y"]
    assert groups["shot-2"]["bounds"]["y"] == groups["video-2"]["bounds"]["y"]

    diff_summary = graph_diff.graph_plan_diff_summary(workflow, result, plan)
    assert len(diff_summary["nodes_moved"]) == len(workflow.nodes)
    assert {group["id"] for group in diff_summary["groups_repositioned"]} == set(groups)
    assert diff_summary["nodes_added"] == []
    assert diff_summary["nodes_changed"] == []
    assert diff_summary["edges_added"] == []
    assert diff_summary["groups_added"] == []
    assert graph_diff.graph_plan_layout_errors(workflow, result, plan) == []
    assert _inter_group_edge_crossings(result) == []

    broken_layout = result.model_copy(deep=True)
    broken_groups = {group["id"]: group for group in broken_layout.metadata["groups"]}
    broken_groups["shot-2"]["bounds"] = dict(broken_groups["shot-1"]["bounds"])
    layout_error_codes = {
        error.code
        for error in graph_diff.graph_plan_layout_errors(workflow, broken_layout, plan)
    }
    assert "assistant_group_overlap" in layout_error_codes
    assert "assistant_group_enclosure" in layout_error_codes

    nodes_by_id = {node.id: node for node in result.nodes}
    for group in groups.values():
        bounds = group["bounds"]
        for node_id in group["node_ids"]:
            member = graph_plan._bounds_for_node(nodes_by_id[node_id])
            assert bounds["x"] <= member["x"] - 96
            assert bounds["y"] <= member["y"] - 96
            assert bounds["x"] + bounds["width"] >= member["x"] + member["width"] + 96
            assert bounds["y"] + bounds["height"] >= member["y"] + member["height"] + 96

    second = graph_plan.apply_graph_plan(result, plan)
    assert [node.position for node in second.nodes] == [node.position for node in result.nodes]
    assert [group["bounds"] for group in second.metadata["groups"]] == [
        group["bounds"] for group in result.metadata["groups"]
    ]
