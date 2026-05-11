from __future__ import annotations

from typing import Dict, List

from ..events import emit
from ..schemas import GraphOutputRef, GraphWorkflowNode
from .base import GraphExecutionContext, GraphExecutor


class SaveImageExecutor(GraphExecutor):
    node_type = "media.save_image"

    def execute(self, node: GraphWorkflowNode, context: GraphExecutionContext) -> Dict[str, List[GraphOutputRef]]:
        image_refs = context.inputs_for(node, "image")
        if not image_refs:
            raise ValueError("Save Image requires an image input.")
        first = image_refs[0]
        if first.asset_id:
            emit(context.run_id, "asset.created", {"asset_id": first.asset_id}, node_id=node.id)
        return {"asset": [first], "image": [first]}

