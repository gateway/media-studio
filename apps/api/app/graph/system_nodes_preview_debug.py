from __future__ import annotations

from typing import List

from .schemas import GraphNodeDefinition, GraphNodeField, GraphNodePort


def preview_image_node_definitions() -> List[GraphNodeDefinition]:
    return [
        GraphNodeDefinition(
            type="preview.image",
            title="Preview Image",
            description="Show an image in the graph without saving another output.",
            category="Preview",
            search_aliases=["preview", "image", "view"],
            tags=["preview", "image"],
            source={"kind": "system"},
            execution={"executor": "preview.image", "mode": "sync", "cacheable": False, "output_node": False},
            limits={"max_inputs": 1},
            ui={"default_size": {"width": 300, "height": 320}, "accent": "green", "icon": "image", "preview": True},
            ports={
                "inputs": [GraphNodePort(id="image", label="Image", type="image", required=True, min=1, max=1, accepts=["image"])],
                "outputs": [GraphNodePort(id="image", label="Image", type="image")],
            },
            fields=[],
        ),
    ]


def preview_av_node_definitions() -> List[GraphNodeDefinition]:
    return [
        GraphNodeDefinition(
            type="preview.video",
            title="Preview Video",
            description="Show a video in the graph without saving another output.",
            category="Preview",
            search_aliases=["preview", "video", "view"],
            tags=["preview", "video"],
            source={"kind": "system"},
            execution={"executor": "preview.video", "mode": "sync", "cacheable": False, "output_node": False},
            limits={"max_inputs": 1},
            ui={"default_size": {"width": 320, "height": 320}, "accent": "cyan", "icon": "video", "preview": True},
            ports={
                "inputs": [GraphNodePort(id="video", label="Video", type="video", required=True, min=1, max=1, accepts=["video"])],
                "outputs": [GraphNodePort(id="video", label="Video", type="video")],
            },
            fields=[],
        ),
        GraphNodeDefinition(
            type="preview.audio",
            title="Preview Audio",
            description="Show audio metadata in the graph without saving another output.",
            category="Preview",
            search_aliases=["preview", "audio", "sound"],
            tags=["preview", "audio"],
            source={"kind": "system"},
            execution={"executor": "preview.audio", "mode": "sync", "cacheable": False, "output_node": False},
            limits={"max_inputs": 1},
            ui={"default_size": {"width": 300, "height": 220}, "accent": "cyan", "icon": "audio", "preview": True},
            ports={
                "inputs": [GraphNodePort(id="audio", label="Audio", type="audio", required=True, min=1, max=1, accepts=["audio"])],
                "outputs": [GraphNodePort(id="audio", label="Audio", type="audio")],
            },
            fields=[],
        ),
    ]


def debug_node_definitions() -> List[GraphNodeDefinition]:
    return [
        GraphNodeDefinition(
            type="display.any",
            title="Display Any",
            description="Display text, JSON, media refs, assets, jobs, or other graph values without saving output.",
            help_text="Connect one output and run to view the resolved value in this node.",
            category="Preview",
            search_aliases=["display", "preview", "inspect", "view", "any", "json", "text", "media"],
            tags=["display", "preview", "debug", "any"],
            source={"kind": "system"},
            execution={"executor": "display.any", "mode": "sync", "cacheable": False, "output_node": False},
            limits={"max_inputs": 1},
            ui={
                "default_size": {"width": 340, "height": 320},
                "min_size": {"width": 280, "height": 240},
                "max_size": {"width": 760, "height": 720},
                "accent": "blue",
                "icon": "info",
                "preview": False,
            },
            ports={
                "inputs": [
                    GraphNodePort(
                        id="value",
                        label="Value",
                        type="any",
                        max=1,
                        required=False,
                        accepts=["text", "image", "video", "audio", "asset", "reference_media", "job", "json", "any"],
                        description="One graph value or media reference to display.",
                    )
                ],
                "outputs": [
                    GraphNodePort(id="value", label="Value", type="any", description="Pass-through input value."),
                    GraphNodePort(id="json", label="JSON", type="json", description="Inspection payload for the displayed values."),
                ],
            },
            fields=[],
        ),
        GraphNodeDefinition(
            type="debug.inspect",
            title="Inspect",
            description="Inspect graph values and media refs for debugging.",
            category="Debug",
            search_aliases=["debug", "inspect", "json"],
            tags=["debug", "json"],
            source={"kind": "system"},
            execution={"executor": "debug.inspect", "mode": "sync", "cacheable": False, "output_node": False},
            limits={"max_inputs": 20},
            ui={"default_size": {"width": 320, "height": 280}, "accent": "orange", "icon": "bug"},
            ports={
                "inputs": [GraphNodePort(id="value", label="Value", type="any", array=True, required=False, max=20, accepts=["text", "image", "video", "audio", "asset", "job", "json"])],
                "outputs": [GraphNodePort(id="json", label="JSON", type="json")],
            },
            fields=[],
        ),
        GraphNodeDefinition(
            type="debug.metadata",
            title="Metadata",
            description="Extract metadata from image, video, or audio refs.",
            category="Debug",
            search_aliases=["debug", "metadata", "info"],
            tags=["debug", "metadata"],
            source={"kind": "system"},
            execution={"executor": "debug.metadata", "mode": "sync", "cacheable": True, "output_node": False},
            limits={"max_inputs": 3},
            ui={"default_size": {"width": 320, "height": 280}, "accent": "orange", "icon": "info"},
            ports={
                "inputs": [
                    GraphNodePort(id="image", label="Image", type="image", required=False, max=1, accepts=["image"]),
                    GraphNodePort(id="video", label="Video", type="video", required=False, max=1, accepts=["video"]),
                    GraphNodePort(id="audio", label="Audio", type="audio", required=False, max=1, accepts=["audio"]),
                ],
                "outputs": [GraphNodePort(id="json", label="JSON", type="json")],
            },
            fields=[],
        ),
    ]
