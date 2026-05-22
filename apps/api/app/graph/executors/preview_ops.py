from __future__ import annotations

from typing import Dict, List

from ..schemas import GraphOutputRef, GraphWorkflowNode
from .base import GraphExecutionContext, GraphExecutor


class _PreviewExecutor(GraphExecutor):
    node_type = ""
    input_port = "image"
    media_type = "image"

    def execute(self, node: GraphWorkflowNode, context: GraphExecutionContext) -> Dict[str, List[GraphOutputRef]]:
        refs = context.inputs_for(node, self.input_port)
        context.record_node_metric(node, "preview_ref_count", len(refs))
        return {self.input_port: refs}


class PreviewImageExecutor(_PreviewExecutor):
    node_type = "preview.image"
    input_port = "image"
    media_type = "image"


class PreviewVideoExecutor(_PreviewExecutor):
    node_type = "preview.video"
    input_port = "video"
    media_type = "video"


class PreviewAudioExecutor(_PreviewExecutor):
    node_type = "preview.audio"
    input_port = "audio"
    media_type = "audio"
