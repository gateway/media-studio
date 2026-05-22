from __future__ import annotations

from typing import Any, Dict, List, Optional

from .. import store
from .schemas import GraphOutputRef, GraphWorkflowNode


def _first_parent(inputs: List[GraphOutputRef]) -> Dict[str, Optional[str]]:
    if not inputs:
        return {"parent_artifact_id": None, "parent_asset_id": None, "parent_reference_id": None}
    first = inputs[0]
    return {
        "parent_artifact_id": str(first.metadata.get("artifact_id")) if first.metadata.get("artifact_id") else None,
        "parent_asset_id": first.asset_id,
        "parent_reference_id": first.reference_id,
    }


def _lineage_for(ref: GraphOutputRef, *, node: GraphWorkflowNode, parent: Dict[str, Optional[str]]) -> Dict[str, Any]:
    lineage = ref.metadata.get("lineage") if isinstance(ref.metadata.get("lineage"), dict) else {}
    return {
        "parent_artifact_id": lineage.get("parent_artifact_id") or parent["parent_artifact_id"],
        "parent_asset_id": lineage.get("parent_asset_id") or parent["parent_asset_id"],
        "parent_reference_id": lineage.get("parent_reference_id") or parent["parent_reference_id"],
        "transform_type": lineage.get("transform_type") or (node.type if node.type.startswith(("image.", "video.", "media.save")) else None),
        "transform_params_json": lineage.get("transform_params") or dict(node.fields),
    }


def register_output_artifacts(
    *,
    workflow_id: str,
    run_id: str,
    node: GraphWorkflowNode,
    outputs: Dict[str, List[GraphOutputRef]],
    input_refs: List[GraphOutputRef],
) -> Dict[str, List[GraphOutputRef]]:
    parent = _first_parent(input_refs)
    registered: Dict[str, List[GraphOutputRef]] = {}
    for output_port, refs in outputs.items():
        registered_refs: List[GraphOutputRef] = []
        for output_index, ref in enumerate(refs):
            lineage = _lineage_for(ref, node=node, parent=parent)
            artifact = store.create_graph_artifact(
                {
                    "workflow_id": workflow_id,
                    "run_id": run_id,
                    "node_id": node.id,
                    "node_type": node.type,
                    "output_port": output_port,
                    "output_index": output_index,
                    "kind": ref.kind,
                    "media_type": ref.media_type,
                    "asset_id": ref.asset_id,
                    "reference_id": ref.reference_id,
                    "job_id": ref.job_id,
                    "value_json": ref.value if isinstance(ref.value, dict) else {"value": ref.value} if ref.value is not None else {},
                    "parent_artifact_id": lineage["parent_artifact_id"],
                    "parent_asset_id": lineage["parent_asset_id"],
                    "parent_reference_id": lineage["parent_reference_id"],
                    "transform_type": lineage["transform_type"],
                    "transform_params_json": lineage["transform_params_json"],
                    "metadata_json": {key: value for key, value in ref.metadata.items() if key != "lineage"},
                }
            )
            registered_refs.append(
                ref.model_copy(update={"metadata": {**ref.metadata, "artifact_id": artifact["artifact_id"]}})
            )
        registered[output_port] = registered_refs
    return registered


def output_payload_to_refs(payload: Dict[str, Any]) -> Dict[str, List[GraphOutputRef]]:
    outputs: Dict[str, List[GraphOutputRef]] = {}
    for port, refs in payload.items():
        if not isinstance(refs, list):
            continue
        outputs[str(port)] = [GraphOutputRef.model_validate(ref) for ref in refs if isinstance(ref, dict)]
    return outputs
