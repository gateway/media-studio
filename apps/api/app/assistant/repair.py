from __future__ import annotations

from typing import Any, Dict, List

from .. import store
from ..graph.normalization import materialize_workflow_defaults
from ..graph.pricing import estimate_graph_workflow
from ..graph.schemas import GraphWorkflow
from ..graph.validator import validate_workflow
from .schemas import AssistantGraphPlan


def build_failed_run_summary(run_id: str) -> Dict[str, Any] | None:
    run = store.get_graph_run(run_id)
    if not run:
        return None
    failed_nodes: List[Dict[str, Any]] = []
    for node in store.list_graph_run_nodes(run_id):
        status = str(node.get("status") or "")
        error = str(node.get("error") or "").strip()
        if status in {"failed", "skipped", "cancelled"} or error:
            failed_nodes.append(
                {
                    "node_id": node.get("node_id"),
                    "node_type": node.get("node_type"),
                    "status": status,
                    "error": error,
                }
            )
    return {
        "run_id": run_id,
        "workflow_id": run.get("workflow_id"),
        "status": str(run.get("status") or "unknown"),
        "error": run.get("error"),
        "failed_nodes": failed_nodes,
    }


def repair_plan_for_failed_run(run_id: str, workflow: GraphWorkflow) -> Dict[str, Any] | None:
    summary = build_failed_run_summary(run_id)
    if not summary:
        return None
    failed_nodes = summary["failed_nodes"]
    run_error = str(summary.get("error") or "").strip()
    if failed_nodes:
        node_label = str(failed_nodes[0].get("node_id") or "a graph node")
        error = str(failed_nodes[0].get("error") or run_error or "The node did not complete.")
        text = f"{node_label} did not complete: {error}"
    elif run_error:
        text = f"The graph run failed: {run_error}"
    else:
        text = "The graph run did not finish cleanly. Review the run status before retrying."
    graph_plan = AssistantGraphPlan(
        capability="repair_graph",
        summary=text,
        operations=[],
        warnings=["No automatic graph changes were applied. Review the failed node and rerun after correcting inputs."],
        requires_confirmation=False,
    )
    normalized = materialize_workflow_defaults(workflow)
    return {
        "summary": summary,
        "graph_plan": graph_plan,
        "workflow": normalized,
        "validation": validate_workflow(normalized),
        "pricing": estimate_graph_workflow(normalized),
    }
