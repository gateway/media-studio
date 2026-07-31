from __future__ import annotations

from typing import List

from .schemas import GraphNodeDefinition, GraphNodeField, GraphNodePort

def _image_split_output_ports(max_outputs: int = 25) -> List[GraphNodePort]:
    return [
        GraphNodePort(id=f"image_{index}", label=f"Image {index}", type="image", description=f"Ordered image output {index}.", advanced=True)
        for index in range(1, max_outputs + 1)
    ]


def image_node_definitions() -> List[GraphNodeDefinition]:
    return [
        GraphNodeDefinition(
            type="image.transform",
            title="Image Transform",
            description="Resize, crop, pad, convert, or inspect an image reference.",
            category="Image",
            search_aliases=["image", "resize", "scale", "crop", "pad", "convert", "metadata", "utility"],
            tags=["image", "utility"],
            source={"kind": "system"},
            execution={"executor": "image.transform", "mode": "sync", "cacheable": True, "output_node": False, "bypass_mode": {"input": "image", "output": "image"}},
            limits={"max_dimension": 4096, "timeout_seconds": 30},
            ui={"default_size": {"width": 340, "height": 460}, "accent": "green", "icon": "image"},
            ports={
                "inputs": [GraphNodePort(id="image", label="Image", type="image", required=True, min=1, max=1, accepts=["image"])],
                "outputs": [
                    GraphNodePort(id="image", label="Image", type="image"),
                    GraphNodePort(id="metadata", label="Metadata", type="json"),
                ],
            },
            fields=[
                GraphNodeField(
                    id="operation",
                    label="Operation",
                    type="select",
                    required=True,
                    default="resize",
                    options=[
                        {"value": "resize", "label": "Resize"},
                        {"value": "crop", "label": "Crop"},
                        {"value": "pad", "label": "Pad"},
                        {"value": "convert_format", "label": "Convert Format"},
                        {"value": "extract_metadata", "label": "Extract Metadata"},
                    ],
                ),
                GraphNodeField(id="width", label="Width", type="integer", required=False, default=1024, min=1, max=4096),
                GraphNodeField(id="height", label="Height", type="integer", required=False, default=1024, min=1, max=4096),
                GraphNodeField(id="fit", label="Fit", type="select", required=False, default="contain", options=["contain", "cover", "stretch"]),
                GraphNodeField(id="x", label="X", type="integer", required=False, default=0, min=0, max=4096),
                GraphNodeField(id="y", label="Y", type="integer", required=False, default=0, min=0, max=4096),
                GraphNodeField(id="color", label="Canvas Color", type="color", required=False, default="#000000"),
                GraphNodeField(id="format", label="Format", type="select", required=False, default="png", options=["png", "webp", "jpeg"]),
            ],
        ),
        GraphNodeDefinition(
            type="image.grid_slice",
            title="Grid Slice Image",
            description="Slice a grid image into individual reference images.",
            category="Image",
            search_aliases=["image", "grid", "slice", "split", "2x2", "3x3", "utility"],
            tags=["image", "utility", "slice"],
            source={"kind": "system"},
            execution={"executor": "image.grid_slice", "mode": "sync", "cacheable": True, "output_node": False},
            limits={"max_dimension": 4096, "max_cells": 25, "timeout_seconds": 30},
            ui={"default_size": {"width": 340, "height": 460}, "accent": "green", "icon": "image", "preview": True},
            ports={
                "inputs": [GraphNodePort(id="image", label="Image", type="image", required=True, min=1, max=1, accepts=["image"])],
                "outputs": [
                    GraphNodePort(id="images", label="Images", type="image", array=True),
                    GraphNodePort(id="metadata", label="Metadata", type="json"),
                ],
            },
            fields=[
                GraphNodeField(id="rows", label="Rows", type="integer", required=True, default=2, min=1, max=5),
                GraphNodeField(id="columns", label="Columns", type="integer", required=True, default=2, min=1, max=5),
                GraphNodeField(id="gutter_mode", label="Gutter Mode", type="select", required=True, default="auto", options=["none", "auto", "fixed"]),
                GraphNodeField(id="gutter_px", label="Gutter px", type="integer", required=False, default=0, min=0, max=256),
                GraphNodeField(id="trim_outer_gutter", label="Trim Outer Gutter", type="boolean", required=False, default=True),
                GraphNodeField(id="format", label="Format", type="select", required=True, default="png", options=["png", "webp", "jpeg"]),
            ],
        ),
        GraphNodeDefinition(
            type="image.storyboard_sheet",
            title="Storyboard Sheet",
            description="Compose one Storyboard v2 sheet from art-only imagery and a validated 4-, 6-, or 9-panel sheet spec.",
            help_text="Connect one current art-only source grid matching the compiled spec (2x2, 2x3, or 3x3) or exactly 4, 6, or 9 ordered images plus the Sheet Spec from Compile Storyboard. Media Studio reflows the frames into the final storyboard sheet, shows SHOT once above each image, and renders the five remaining metadata rows deterministically. Historical complete-sheet model outputs fail before composition.",
            category="Image",
            search_aliases=["storyboard", "sheet", "compose", "metadata", "2x2", "3x2", "3x3", "layout"],
            tags=["image", "storyboard", "compose", "utility"],
            source={"kind": "system"},
            execution={"executor": "image.storyboard_sheet", "mode": "sync", "cacheable": True, "output_node": False},
            limits={
                "max_dimension": 4096,
                "input_counts": [1, 4, 6, 9],
                "output_width": 2048,
                "output_height_by_panel_count": {"4": 2048, "6": 1152, "9": 2048},
            },
            ui={
                "default_size": {"width": 380, "height": 420},
                "min_size": {"width": 320, "height": 340},
                "max_size": {"width": 760, "height": 820},
                "color": "image",
                "accent": "green",
                "icon": "image",
                "preview": True,
                "field_layout": "stack",
            },
            ports={
                "inputs": [
                    GraphNodePort(
                        id="images",
                        label="Panel Art",
                        type="image",
                        array=True,
                        required=True,
                        min=1,
                        max=9,
                        accepts=["image"],
                        description="One provenance-compatible art-only source grid or exactly 4, 6, or 9 ordered panel images matching the Sheet Spec.",
                    ),
                    GraphNodePort(
                        id="spec",
                        label="Sheet Spec",
                        type="json",
                        required=True,
                        min=1,
                        max=1,
                        accepts=["json"],
                        description="Validated StoryboardSheetSpec v1 from Compile Storyboard.",
                    ),
                ],
                "outputs": [
                    GraphNodePort(id="image", label="Sheet", type="image", description="Deterministic storyboard sheet image."),
                    GraphNodePort(id="metadata", label="Metadata", type="json", description="Layout geometry and compositor lineage."),
                ],
            },
            fields=[],
        ),
        GraphNodeDefinition(
            type="image.split",
            title="Split Images",
            description="Expose ordered image array items as separate output handles for per-image branching.",
            category="Image",
            search_aliases=["image", "split", "fan out", "array", "slice", "utility"],
            tags=["image", "utility", "array"],
            source={"kind": "system"},
            execution={"executor": "image.split", "mode": "sync", "cacheable": True, "output_node": False},
            limits={"max_outputs": 25},
            ui={"default_size": {"width": 320, "height": 360}, "accent": "green", "icon": "image"},
            ports={
                "inputs": [GraphNodePort(id="images", label="Images", type="image", array=True, required=True, min=1, max=25, accepts=["image"])],
                "outputs": _image_split_output_ports(),
            },
            fields=[
                GraphNodeField(
                    id="outputs",
                    label="Outputs",
                    type="integer",
                    required=True,
                    default=4,
                    min=1,
                    max=25,
                    help_text="Numbered outputs to expose from the ordered image array.",
                ),
            ],
        ),
    ]
