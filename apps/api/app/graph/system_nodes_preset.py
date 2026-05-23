from __future__ import annotations

from typing import List

from .preset_catalog import (
    media_preset_catalog,
    media_preset_dynamic_fields,
    media_preset_input_ports,
    media_preset_model_options,
    media_preset_picker_options,
    media_preset_search_aliases,
)
from .schemas import GraphNodeDefinition, GraphNodeField, GraphNodePort


def preset_node_definitions() -> List[GraphNodeDefinition]:
    all_catalog = media_preset_catalog(status="all")
    active_catalog = [item for item in all_catalog if str(item.get("status") or "active") == "active"]
    input_ports = media_preset_input_ports(all_catalog)
    return [
        GraphNodeDefinition(
            type="preset.render",
            title="Media Preset",
            description="Run any saved Media Preset from one schema-driven graph node.",
            help_text="Choose a saved Media Preset, then fill only the fields and image inputs that appear for that preset.",
            category="Preset",
            search_aliases=media_preset_search_aliases(active_catalog),
            tags=["preset", "image", "media"],
            source={"kind": "media_preset", "preset_catalog": all_catalog},
            execution={"executor": "preset.render", "mode": "async", "cacheable": True, "output_node": False, "retryable": True},
            limits={
                "max_input_images": max((port.max or 0) for port in input_ports) if input_ports else 0,
                "output_count": {"default": 1, "max": 1},
            },
            ui={"default_size": {"width": 420, "height": 620}, "accent": "blue", "icon": "preset", "field_layout": "stack"},
            ports={
                "inputs": input_ports,
                "outputs": [
                    GraphNodePort(id="image", label="Image", type="image"),
                    GraphNodePort(id="job", label="Job", type="job", advanced=True),
                ],
            },
            fields=[
                GraphNodeField(
                    id="preset_id",
                    label="Media Preset",
                    type="preset_picker",
                    required=True,
                    options=media_preset_picker_options(active_catalog),
                    help_text="Choose the saved preset to run. The fields and image inputs below update to match it.",
                ),
                GraphNodeField(
                    id="preset_model_key",
                    label="Model",
                    type="select",
                    required=False,
                    options=media_preset_model_options(all_catalog),
                    help_text="Model used for this preset. Options are limited to models the selected preset supports.",
                ),
                *media_preset_dynamic_fields(all_catalog),
            ],
        ),
    ]
