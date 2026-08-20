from __future__ import annotations

from typing import Any, Dict, List, Mapping

from ..schemas import GraphOutputRef, GraphWorkflowNode
from ..storyboard_sheet_spec import (
    STORYBOARD_ART_SOURCE_CONTRACT,
    storyboard_art_prompt,
    storyboard_panel_prompts,
    storyboard_source_grid_id_for_panel_count,
    storyboard_source_plate_aspect_for_panel_count,
    storyboard_sheet_spec_from_recipe_result,
)
from .base import GraphExecutionContext, GraphExecutor


class StoryboardCompileExecutor(GraphExecutor):
    node_type = "storyboard.compile"

    def execute(self, node: GraphWorkflowNode, context: GraphExecutionContext) -> Dict[str, List[GraphOutputRef]]:
        refs = context.inputs_for(node, "result")
        if not refs:
            raise ValueError("Compile Storyboard requires a Prompt Recipe result input.")
        value = refs[0].value
        if not isinstance(value, Mapping):
            raise ValueError("Compile Storyboard requires the Prompt Recipe JSON result output.")
        spec = storyboard_sheet_spec_from_recipe_result(value)
        spec_payload: Dict[str, Any] = spec.to_dict()
        art_prompt = storyboard_art_prompt(spec)
        panel_prompts = storyboard_panel_prompts(spec)
        panel_count = len(spec.panels)
        source_grid = storyboard_source_grid_id_for_panel_count(panel_count)
        source_aspect_ratio = storyboard_source_plate_aspect_for_panel_count(panel_count)
        context.record_node_metric(node, "storyboard_contract_version", spec.contract_version)
        context.record_node_metric(node, "storyboard_panel_count", panel_count)
        context.record_node_metric(node, "storyboard_source_grid", source_grid)
        context.record_node_metric(node, "storyboard_source_aspect_ratio", source_aspect_ratio)
        context.record_node_metric(node, "storyboard_art_prompt_chars", len(art_prompt))
        return {
            "prompt": [
                GraphOutputRef(
                    kind="value",
                    media_type="text",
                    value=art_prompt,
                    metadata={
                        "type": "text",
                        "source": self.node_type,
                        "contract_version": spec.contract_version,
                        "storyboard_art_source_contract": STORYBOARD_ART_SOURCE_CONTRACT,
                        "storyboard_source_grid": source_grid,
                        "storyboard_source_aspect_ratio": source_aspect_ratio,
                        "storyboard_panel_count": panel_count,
                    },
                )
            ],
            "spec": [
                GraphOutputRef(
                    kind="value",
                    media_type="json",
                    value=spec_payload,
                    metadata={"type": "json", "source": self.node_type, "contract_version": spec.contract_version},
                )
            ],
            "panel_prompts": [
                GraphOutputRef(
                    kind="value",
                    media_type="json",
                    value=panel_prompts,
                    metadata={"type": "json", "source": self.node_type, "count": len(panel_prompts)},
                )
            ],
        }
