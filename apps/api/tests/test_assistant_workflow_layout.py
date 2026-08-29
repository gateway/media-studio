from __future__ import annotations

import importlib


def _layout_plan(assistant_schemas):
    return assistant_schemas.AssistantGraphPlan.model_validate(
        {
            "summary": "Tidy this workflow without changing its meaning.",
            "operations": [{"op": "arrange_workflow"}],
        }
    )


def test_arrange_small_graph_handles_long_titles_and_nested_looking_groups(app_modules) -> None:
    del app_modules
    graph_plan = importlib.import_module("app.assistant.graph_plan")
    graph_schemas = importlib.import_module("app.graph.schemas")
    assistant_schemas = importlib.import_module("app.assistant.schemas")
    long_title = "Shot 1 — A deliberately long independent keyframe group title with safe title clearance"
    workflow = graph_schemas.GraphWorkflow.model_validate(
        {
            "name": "Small independent groups",
            "nodes": [
                {"id": "prompt", "type": "prompt.text", "position": {"x": 0, "y": 0}, "fields": {"text": "Keep"}},
                {"id": "image", "type": "preview.image", "position": {"x": 20, "y": 10}, "fields": {}},
                {"id": "video", "type": "preview.video", "position": {"x": 40, "y": 20}, "fields": {}},
                {"id": "note", "type": "utility.note", "position": {"x": 60, "y": 30}, "fields": {"body": "Keep this comment."}},
            ],
            "edges": [
                {"id": "prompt-image", "source": "prompt", "source_port": "text", "target": "image", "target_port": "image"},
                {"id": "image-video", "source": "image", "source_port": "image", "target": "video", "target_port": "video"},
            ],
            "metadata": {
                "groups": [
                    {
                        "id": "outer-looking",
                        "title": long_title,
                        "node_ids": ["prompt", "image"],
                        "bounds": {"x": 0, "y": 0, "width": 200, "height": 200},
                    },
                    {
                        "id": "inner-looking",
                        "title": "Shot 1 — Visually nested name, structurally independent",
                        "node_ids": ["video", "note"],
                        "bounds": {"x": 10, "y": 10, "width": 100, "height": 100},
                    },
                ]
            },
        }
    )
    plan = _layout_plan(assistant_schemas)

    arranged = graph_plan.apply_graph_plan(workflow, plan)
    groups = {group["id"]: group for group in arranged.metadata["groups"]}

    assert groups["outer-looking"]["node_ids"] == ["prompt", "image"]
    assert groups["inner-looking"]["node_ids"] == ["video", "note"]
    assert groups["outer-looking"]["bounds"]["width"] >= len(long_title) * 8.5 + 192
    assert graph_plan._rects_have_gap(
        groups["outer-looking"]["bounds"],
        groups["inner-looking"]["bounds"],
        96,
    )
    assert next(node for node in arranged.nodes if node.id == "note").fields["body"] == "Keep this comment."
    assert graph_plan.apply_graph_plan(arranged, plan).model_dump(mode="json") == arranged.model_dump(mode="json")


def test_arrange_keeps_ordered_production_groups_side_by_side_with_their_notes(app_modules) -> None:
    del app_modules
    graph_plan = importlib.import_module("app.assistant.graph_plan")
    graph_schemas = importlib.import_module("app.graph.schemas")
    assistant_schemas = importlib.import_module("app.assistant.schemas")
    workflow = graph_schemas.GraphWorkflow.model_validate(
        {
            "name": "Three-stage production",
            "nodes": [
                {"id": "character", "type": "preview.image", "position": {"x": 0, "y": 500}, "fields": {}},
                {
                    "id": "character-note",
                    "type": "utility.note",
                    "position": {"x": 0, "y": 0},
                    "fields": {"body": "Character continuity."},
                },
                {"id": "storyboard", "type": "preview.image", "position": {"x": 1000, "y": 500}, "fields": {}},
                {
                    "id": "storyboard-note",
                    "type": "utility.note",
                    "position": {"x": 1000, "y": 0},
                    "fields": {"body": "Storyboard continuity."},
                },
                {
                    "id": "video",
                    "type": "model.kie.seedance_2_5",
                    "position": {"x": 2000, "y": 500},
                    "fields": {
                        "prompt": "Hold, then snap the cable as whale song begins.",
                        "duration": 5,
                        "resolution": "1080p",
                        "aspect_ratio": "16:9",
                    },
                },
                {
                    "id": "video-note",
                    "type": "utility.note",
                    "position": {"x": 2000, "y": 0},
                    "fields": {"body": "Video continuity."},
                },
            ],
            "edges": [
                {
                    "id": "storyboard-video",
                    "source": "storyboard",
                    "source_port": "image",
                    "target": "video",
                    "target_port": "start_frame",
                }
            ],
            "metadata": {
                "groups": [
                    {
                        "id": "character-group",
                        "title": "Character Sheet",
                        "node_ids": ["character"],
                        "bounds": {"x": -100, "y": 400, "width": 600, "height": 600},
                    },
                    {
                        "id": "storyboard-group",
                        "title": "Six-Shot Storyboard",
                        "node_ids": ["storyboard"],
                        "bounds": {"x": 900, "y": 400, "width": 600, "height": 600},
                    },
                    {
                        "id": "video-group",
                        "title": "Shot 5 Video",
                        "node_ids": ["video"],
                        "bounds": {"x": 1900, "y": 400, "width": 600, "height": 600},
                    },
                ]
            },
        }
    )

    arranged = graph_plan.apply_graph_plan(workflow, _layout_plan(assistant_schemas))
    groups = {group["id"]: group for group in arranged.metadata["groups"]}
    nodes = {node.id: node for node in arranged.nodes}

    assert groups["character-group"]["bounds"]["x"] < groups["storyboard-group"]["bounds"]["x"]
    assert groups["storyboard-group"]["bounds"]["x"] < groups["video-group"]["bounds"]["x"]
    assert {node.id for node in arranged.nodes} == {node.id for node in workflow.nodes}
    assert [edge.model_dump(mode="json") for edge in arranged.edges] == [
        edge.model_dump(mode="json") for edge in workflow.edges
    ]
    assert [group["node_ids"] for group in arranged.metadata["groups"]] == [
        group["node_ids"] for group in workflow.metadata["groups"]
    ]
    for group_id, note_id in [
        ("character-group", "character-note"),
        ("storyboard-group", "storyboard-note"),
        ("video-group", "video-note"),
    ]:
        bounds = groups[group_id]["bounds"]
        assert bounds["x"] <= nodes[note_id].position["x"] <= bounds["x"] + bounds["width"]
        assert nodes[note_id].fields == next(node for node in workflow.nodes if node.id == note_id).fields

    stacked = workflow.model_copy(deep=True)
    stacked_nodes = {node.id: node for node in stacked.nodes}
    stacked_nodes["character"].position = {"x": 0, "y": 500}
    stacked_nodes["character-note"].position = {"x": 0, "y": 0}
    stacked_nodes["storyboard"].position = {"x": 40, "y": 2500}
    stacked_nodes["storyboard-note"].position = {"x": 40, "y": 2000}
    stacked_groups = {group["id"]: group for group in stacked.metadata["groups"]}
    stacked_groups["character-group"]["bounds"] = {"x": -100, "y": 400, "width": 600, "height": 600}
    stacked_groups["storyboard-group"]["bounds"] = {"x": -60, "y": 2400, "width": 600, "height": 600}

    arranged_stacked = graph_plan.apply_graph_plan(stacked, _layout_plan(assistant_schemas))
    stacked_groups = {group["id"]: group for group in arranged_stacked.metadata["groups"]}
    stacked_nodes = {node.id: node for node in arranged_stacked.nodes}

    assert stacked_groups["character-group"]["bounds"]["y"] < stacked_nodes["character-note"].position["y"]
    assert stacked_nodes["character-note"].position["y"] < stacked_groups["storyboard-group"]["bounds"]["y"]
    assert stacked_groups["storyboard-group"]["bounds"]["y"] < stacked_nodes["storyboard-note"].position["y"]


def test_arrange_is_idempotent_for_unequal_width_groups_in_one_column(app_modules) -> None:
    del app_modules
    graph_plan = importlib.import_module("app.assistant.graph_plan")
    graph_schemas = importlib.import_module("app.graph.schemas")
    assistant_schemas = importlib.import_module("app.assistant.schemas")
    workflow = graph_schemas.GraphWorkflow.model_validate(
        {
            "name": "Unequal groups in one column",
            "nodes": [
                {"id": "wide", "type": "preview.image", "position": {"x": 0, "y": 0}, "fields": {}},
                {"id": "narrow", "type": "preview.image", "position": {"x": 0, "y": 1000}, "fields": {}},
            ],
            "edges": [],
            "metadata": {
                "groups": [
                    {
                        "id": "wide-group",
                        "title": (
                            "A deliberately oversized production group title that makes its computed bounds much wider "
                            "than the neighboring section while both sections still share one visual column"
                        ),
                        "node_ids": ["wide"],
                        "bounds": {"x": -100, "y": -100, "width": 1100, "height": 600},
                    },
                    {
                        "id": "narrow-group",
                        "title": "Narrow",
                        "node_ids": ["narrow"],
                        "bounds": {"x": 150, "y": 900, "width": 600, "height": 600},
                    },
                ]
            },
        }
    )
    plan = _layout_plan(assistant_schemas)

    arranged = graph_plan.apply_graph_plan(workflow, plan)

    assert graph_plan.apply_graph_plan(arranged, plan).model_dump(mode="json") == arranged.model_dump(mode="json")


def test_arrange_noop_returns_no_confirmable_canvas_change(app_modules) -> None:
    store_assistant = app_modules["store_assistant"]
    graph_plan = importlib.import_module("app.assistant.graph_plan")
    graph_schemas = importlib.import_module("app.graph.schemas")
    assistant_schemas = importlib.import_module("app.assistant.schemas")
    tools = importlib.import_module("app.assistant.kernel_tools")
    workflow = graph_schemas.GraphWorkflow.model_validate(
        {
            "name": "Already tidy",
            "nodes": [
                {"id": "prompt", "type": "prompt.text", "position": {"x": 0, "y": 0}, "fields": {}},
                {"id": "note", "type": "utility.note", "position": {"x": 10, "y": 10}, "fields": {"body": "Keep"}},
            ],
            "edges": [],
            "metadata": {},
        }
    )
    arranged = graph_plan.apply_graph_plan(workflow, _layout_plan(assistant_schemas))
    session = store_assistant.create_or_update_assistant_session(
        {
            "owner_kind": "graph_workflow",
            "owner_id": "workflow-layout-noop",
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.6-sol",
            "status": "active",
            "summary_json": {},
        }
    )

    execution = tools.execute_kernel_tool(
        tool_name="propose_graph_operations",
        arguments={
            "summary": "The workflow is already tidy.",
            "operations": [{"op": "arrange_workflow"}],
        },
        capability="graph_builder",
        context=tools.KernelToolContext(
            workflow=arranged,
            canvas_context={},
            session_id=session["assistant_session_id"],
            session=session,
        ),
    )

    assert execution.trace.error is None
    assert execution.result["operations"] == []
    assert execution.result["action_metadata"] == {
        "arrange_workflow": True,
        "no_canvas_changes": True,
    }
    assert execution.result["diff_summary"]["nodes_moved"] == []
    assert execution.result["diff_summary"]["groups_repositioned"] == []


def test_arrange_aligns_the_same_shot_keyframe_that_feeds_video(app_modules) -> None:
    del app_modules
    graph_plan = importlib.import_module("app.assistant.graph_plan")
    graph_schemas = importlib.import_module("app.graph.schemas")
    assistant_schemas = importlib.import_module("app.assistant.schemas")
    workflow = graph_schemas.GraphWorkflow.model_validate(
        {
            "name": "Two Shot 1 keyframes",
            "nodes": [
                {"id": "initial", "type": "preview.image", "position": {"x": 0, "y": 0}, "fields": {}},
                {"id": "anchored", "type": "preview.image", "position": {"x": 0, "y": 0}, "fields": {}},
                {"id": "video", "type": "preview.video", "position": {"x": 0, "y": 0}, "fields": {}},
            ],
            "edges": [
                {"id": "anchored-video", "source": "anchored", "source_port": "image", "target": "video", "target_port": "video"}
            ],
            "metadata": {
                "groups": [
                    {"id": "initial-group", "title": "Shot 1 — Initial Keyframe", "node_ids": ["initial"], "bounds": {}},
                    {"id": "anchored-group", "title": "Shot 1 — Anchored Keyframe", "node_ids": ["anchored"], "bounds": {}},
                    {"id": "video-group", "title": "Shot 1 — Video", "node_ids": ["video"], "bounds": {}},
                ]
            },
        }
    )

    arranged = graph_plan.apply_graph_plan(workflow, _layout_plan(assistant_schemas))
    groups = {group["id"]: group for group in arranged.metadata["groups"]}

    assert groups["anchored-group"]["bounds"]["y"] == groups["video-group"]["bounds"]["y"]
    assert groups["initial-group"]["bounds"]["y"] > groups["anchored-group"]["bounds"]["y"]
