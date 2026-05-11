from __future__ import annotations

import logging
import threading
from typing import Dict, List

from .. import store
from .compiler import compile_workflow
from .events import emit
from .executors.base import GraphExecutionContext, GraphExecutor
from .executors.kie_model import KieModelExecutor
from .executors.media_load import LoadImageExecutor
from .executors.media_save import SaveImageExecutor
from .executors.prompt_ops import PromptTextExecutor
from .schemas import GraphRun, GraphRunNode, GraphWorkflow
from .validator import validate_workflow

logger = logging.getLogger(__name__)


class GraphRuntime:
    def __init__(self) -> None:
        executors: List[GraphExecutor] = [
            PromptTextExecutor(),
            LoadImageExecutor(),
            KieModelExecutor(),
            SaveImageExecutor(),
        ]
        self.executors: Dict[str, GraphExecutor] = {executor.node_type: executor for executor in executors}

    def create_run(self, workflow_id: str, workflow: GraphWorkflow, *, start: bool = True) -> GraphRun:
        emit_payload = workflow.model_dump(mode="json")
        compiled = compile_workflow(workflow)
        run = store.create_graph_run(
            {
                "workflow_id": workflow_id,
                "status": "queued",
                "schema_version": workflow.schema_version,
                "workflow_json": emit_payload,
                "compiled_graph_json": compiled.model_dump(mode="json"),
            },
            [
                {
                    "node_id": node.id,
                    "node_type": node.type,
                    "status": "queued",
                    "input_snapshot_json": node.fields,
                }
                for node in workflow.nodes
            ],
        )
        emit(run["run_id"], "run.created", {"workflow_id": workflow_id})
        if start:
            thread = threading.Thread(target=self.execute_run, args=(run["run_id"],), name=f"graph-run-{run['run_id']}", daemon=True)
            thread.start()
        return self._shape_run(run)

    def execute_run(self, run_id: str) -> None:
        run = store.get_graph_run(run_id)
        if not run:
            return
        try:
            workflow = GraphWorkflow(**run["workflow_json"])
            emit(run_id, "run.validating")
            validation = validate_workflow(workflow)
            if not validation.valid:
                raise ValueError("; ".join(error.message for error in validation.errors))
            compiled = compile_workflow(workflow)
            store.update_graph_run(run_id, {"status": "running", "started_at": store.utcnow_iso(), "compiled_graph_json": compiled.model_dump(mode="json")})
            emit(run_id, "run.compiled", {"node_count": len(workflow.nodes), "edge_count": len(workflow.edges)})
            emit(run_id, "run.started")
            context = GraphExecutionContext(run_id=run_id, workflow=workflow)
            nodes_by_id = {node.id: node for node in workflow.nodes}
            for node_id in compiled.execution_order:
                node = nodes_by_id[node_id]
                executor = self.executors.get(node.type)
                if not executor:
                    raise ValueError(f"No executor for node type: {node.type}")
                emit(run_id, "node.queued", node_id=node.id)
                store.update_graph_run_node(run_id, node.id, {"status": "running", "started_at": store.utcnow_iso(), "progress": 0.1})
                emit(run_id, "node.started", {"node_type": node.type}, node_id=node.id)
                outputs = executor.execute(node, context)
                context.publish_outputs(node, outputs)
                output_payload = {key: [item.model_dump(mode="json") for item in value] for key, value in outputs.items()}
                store.update_graph_run_node(
                    run_id,
                    node.id,
                    {
                        "status": "completed",
                        "progress": 1,
                        "output_snapshot_json": output_payload,
                        "finished_at": store.utcnow_iso(),
                    },
                )
                emit(run_id, "node.completed", output_payload, node_id=node.id)
            output_snapshot = {
                node_id: {port: [item.model_dump(mode="json") for item in refs] for port, refs in outputs.items()}
                for node_id, outputs in context.node_outputs.items()
            }
            store.update_graph_run(
                run_id,
                {
                    "status": "completed",
                    "output_snapshot_json": output_snapshot,
                    "finished_at": store.utcnow_iso(),
                },
            )
            emit(run_id, "run.completed", {"outputs": output_snapshot})
        except Exception as exc:
            logger.exception("graph run failed", extra={"run_id": run_id})
            store.update_graph_run(run_id, {"status": "failed", "error": str(exc), "finished_at": store.utcnow_iso()})
            emit(run_id, "run.failed", {"error": str(exc)})

    def cancel_run(self, run_id: str) -> GraphRun:
        run = store.update_graph_run(run_id, {"status": "cancelled", "finished_at": store.utcnow_iso()})
        emit(run_id, "run.cancelled")
        return self._shape_run(run)

    def _shape_run(self, record: Dict) -> GraphRun:
        return GraphRun(
            **record,
            nodes=[GraphRunNode(**item) for item in store.list_graph_run_nodes(record["run_id"])],
        )


runtime = GraphRuntime()
