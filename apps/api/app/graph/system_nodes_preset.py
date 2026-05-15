from __future__ import annotations

from typing import List

from .schemas import GraphNodeDefinition, GraphNodeField, GraphNodePort

from .. import store


def _preset_options() -> List[dict[str, str]]:
    return [
        {"value": str(item["preset_id"]), "label": str(item.get("label") or item.get("key") or item["preset_id"])}
        for item in store.list_presets()
        if str(item.get("status") or "active") == "active"
    ]


def preset_node_definitions() -> List[GraphNodeDefinition]:
    return [
        GraphNodeDefinition(
            type="preset.render",
            title="Render Preset",
            description="Render an existing Media Studio structured preset into prompt text and image refs.",
            category="Preset",
            search_aliases=["preset", "render", "template", "prompt"],
            tags=["preset", "prompt", "image"],
            source={"kind": "system"},
            execution={"executor": "preset.render", "mode": "sync", "cacheable": True, "output_node": False},
            limits={"max_input_images": 8},
            ui={"default_size": {"width": 360, "height": 420}, "accent": "purple", "icon": "preset"},
            ports={
                "inputs": [GraphNodePort(id="image_refs", label="Image Refs", type="image", array=True, required=False, max=8, accepts=["image"])],
                "outputs": [
                    GraphNodePort(id="prompt", label="Prompt", type="text"),
                    GraphNodePort(id="image_refs", label="Image Refs", type="image", array=True),
                    GraphNodePort(id="preset", label="Preset", type="json"),
                ],
            },
            fields=[
                GraphNodeField(id="preset_id", label="Preset", type="preset_picker", required=True, options=_preset_options()),
                GraphNodeField(id="text_values_json", label="Text Values JSON", type="textarea", required=False, default="{}", placeholder='{"subject":"..."}'),
                GraphNodeField(id="image_slots_json", label="Image Slots JSON", type="textarea", required=False, default="{}", placeholder='{"subject":[{"reference_id":"..."}]}'),
            ],
        ),
    ]
