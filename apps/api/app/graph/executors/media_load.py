from __future__ import annotations

from typing import Dict, List

from ... import store
from ..schemas import GraphOutputRef, GraphWorkflowNode
from .base import GraphExecutionContext, GraphExecutor


class _LoadMediaExecutor(GraphExecutor):
    node_type = ""
    media_type = "image"
    output_port = "image"
    title = "Load Media"

    def execute(self, node: GraphWorkflowNode, context: GraphExecutionContext) -> Dict[str, List[GraphOutputRef]]:
        asset_id = node.fields.get("asset_id")
        reference_id = node.fields.get("reference_id")
        if asset_id:
            asset = store.get_asset(str(asset_id))
            if not asset:
                raise ValueError(f"{self.title} asset does not exist.")
            if str(asset.get("generation_kind") or self.media_type) != self.media_type:
                raise ValueError(f"{self.title} expected a {self.media_type} asset.")
            return {
                self.output_port: [
                    GraphOutputRef(
                        kind="asset",
                        media_type=self.media_type,
                        asset_id=str(asset_id),
                        metadata={"model_key": asset.get("model_key")},
                    )
                ]
            }
        if reference_id:
            reference = store.get_reference_media(str(reference_id))
            if not reference:
                raise ValueError(f"{self.title} reference media does not exist.")
            if str(reference.get("kind") or self.media_type) != self.media_type:
                raise ValueError(f"{self.title} expected a {self.media_type} reference.")
            return {
                self.output_port: [
                    GraphOutputRef(
                        kind="reference_media",
                        media_type=self.media_type,
                        reference_id=str(reference_id),
                        metadata={"stored_path": reference.get("stored_path")},
                    )
                ]
            }
        return {self.output_port: []}


class LoadImageExecutor(_LoadMediaExecutor):
    node_type = "media.load_image"
    media_type = "image"
    output_port = "image"
    title = "Load Image"


class LoadVideoExecutor(_LoadMediaExecutor):
    node_type = "media.load_video"
    media_type = "video"
    output_port = "video"
    title = "Load Video"


class LoadAudioExecutor(_LoadMediaExecutor):
    node_type = "media.load_audio"
    media_type = "audio"
    output_port = "audio"
    title = "Load Audio"
