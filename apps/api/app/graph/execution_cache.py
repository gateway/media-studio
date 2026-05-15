from __future__ import annotations

from typing import Any, Dict, Optional

from .. import store
from .schemas import GraphWorkflowNode


def execution_metadata(node: GraphWorkflowNode) -> Dict[str, Any]:
    execution = node.metadata.get("execution") if isinstance(node.metadata.get("execution"), dict) else {}
    return execution if isinstance(execution, dict) else {}


def cached_output_for_node(workflow_id: str, node: GraphWorkflowNode) -> Optional[Dict[str, Any]]:
    execution = execution_metadata(node)
    cached_run_id = str(execution.get("cached_run_id") or "").strip()
    if cached_run_id:
        run = store.get_graph_run(cached_run_id)
        if not run or str(run.get("workflow_id") or "") != workflow_id:
            return None
        cached = store.get_graph_run_node(cached_run_id, node.id)
        if not cached or cached.get("status") not in {"completed", "cached"}:
            return None
        if not _has_output(cached.get("output_snapshot_json")):
            return None
        return cached
    return store.latest_completed_graph_run_node_output(workflow_id, node.id)


def cached_artifacts_available(node: GraphWorkflowNode, cached_run_id: Optional[str]) -> bool:
    execution = execution_metadata(node)
    requested = execution.get("cached_artifact_ids")
    if not isinstance(requested, dict) or not requested:
        return True
    if not cached_run_id:
        return False
    expected = {str(artifact_id) for values in requested.values() if isinstance(values, list) for artifact_id in values if artifact_id}
    if not expected:
        return True
    available = {str(item.get("artifact_id")) for item in store.list_graph_artifacts_for_node_run(cached_run_id, node.id)}
    return expected.issubset(available)


def cached_output_media_available(output_snapshot: Dict[str, Any]) -> bool:
    for refs in output_snapshot.values():
        if not isinstance(refs, list):
            continue
        for ref in refs:
            if not isinstance(ref, dict):
                continue
            asset_id = ref.get("asset_id")
            reference_id = ref.get("reference_id")
            if asset_id and not store.get_asset(str(asset_id)):
                return False
            if reference_id and not store.get_reference_media(str(reference_id)):
                return False
    return True


def _has_output(value: Any) -> bool:
    return isinstance(value, dict) and any(isinstance(refs, list) and refs for refs in value.values())
