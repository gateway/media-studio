from __future__ import annotations

from typing import Dict, List

from ... import store
from ..schemas import GraphOutputRef, GraphWorkflowNode
from .base import GraphExecutionContext, GraphExecutor


class LoadImageExecutor(GraphExecutor):
    node_type = "media.load_image"

    def execute(self, node: GraphWorkflowNode, context: GraphExecutionContext) -> Dict[str, List[GraphOutputRef]]:
        asset_id = node.fields.get("asset_id")
        reference_id = node.fields.get("reference_id")
        if asset_id:
            asset = store.get_asset(str(asset_id))
            if not asset:
                raise ValueError("Load Image asset does not exist.")
            return {
                "image": [
                    GraphOutputRef(
                        kind="asset",
                        media_type="image",
                        asset_id=str(asset_id),
                        metadata={"model_key": asset.get("model_key")},
                    )
                ]
            }
        if reference_id:
            reference = store.get_reference_media(str(reference_id))
            if not reference:
                raise ValueError("Load Image reference media does not exist.")
            return {
                "image": [
                    GraphOutputRef(
                        kind="reference_media",
                        media_type="image",
                        reference_id=str(reference_id),
                        metadata={"stored_path": reference.get("stored_path")},
                    )
                ]
            }
        raise ValueError("Load Image requires asset_id or reference_id.")

