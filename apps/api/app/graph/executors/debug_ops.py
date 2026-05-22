from __future__ import annotations

from typing import Dict, List

from ..media_refs import graph_ref_metadata
from ..schemas import GraphOutputRef, GraphWorkflowNode
from .base import GraphExecutionContext, GraphExecutor


def _inspection_payload(values: List[GraphOutputRef]) -> List[dict]:
    payload = []
    for item in values:
        payload.append(
            {
                "kind": item.kind,
                "media_type": item.media_type,
                "asset_id": item.asset_id,
                "reference_id": item.reference_id,
                "job_id": item.job_id,
                "value": item.value,
                "metadata": {**item.metadata, **graph_ref_metadata(item)},
            }
        )
    return payload


class DisplayAnyExecutor(GraphExecutor):
    node_type = "display.any"

    def execute(self, node: GraphWorkflowNode, context: GraphExecutionContext) -> Dict[str, List[GraphOutputRef]]:
        values = context.inputs_for(node, "value")
        payload = _inspection_payload(values)
        context.record_node_metric(node, "displayed_ref_count", len(payload))
        output_values = values or [GraphOutputRef(kind="value", media_type="json", value=[], metadata={"type": "json"})]
        return {
            "value": output_values,
            "json": [GraphOutputRef(kind="value", media_type="json", value=payload, metadata={"type": "json"})],
        }


class DebugInspectExecutor(GraphExecutor):
    node_type = "debug.inspect"

    def execute(self, node: GraphWorkflowNode, context: GraphExecutionContext) -> Dict[str, List[GraphOutputRef]]:
        values = context.inputs_for(node, "value")
        payload = _inspection_payload(values)
        context.record_node_metric(node, "inspected_ref_count", len(payload))
        return {"json": [GraphOutputRef(kind="value", value=payload, metadata={"type": "json"})]}


class DebugMetadataExecutor(GraphExecutor):
    node_type = "debug.metadata"

    def execute(self, node: GraphWorkflowNode, context: GraphExecutionContext) -> Dict[str, List[GraphOutputRef]]:
        media_refs = [*context.inputs_for(node, "image"), *context.inputs_for(node, "video"), *context.inputs_for(node, "audio")]
        payload = [graph_ref_metadata(item) for item in media_refs]
        context.record_node_metric(node, "metadata_ref_count", len(payload))
        return {"json": [GraphOutputRef(kind="value", value=payload, metadata={"type": "json"})]}


class UtilityNoteExecutor(GraphExecutor):
    node_type = "utility.note"

    def execute(self, node: GraphWorkflowNode, context: GraphExecutionContext) -> Dict[str, List[GraphOutputRef]]:
        body = str(node.fields.get("body") or "")
        context.record_node_metric(node, "note_character_count", len(body))
        return {}
