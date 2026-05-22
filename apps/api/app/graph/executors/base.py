from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List

from ... import store
from ..schemas import GraphOutputRef, GraphWorkflow, GraphWorkflowNode


class GraphRunCancelled(Exception):
    pass


@dataclass
class GraphExecutionContext:
    run_id: str
    workflow: GraphWorkflow
    edge_outputs: Dict[str, List[GraphOutputRef]] = field(default_factory=dict)
    node_outputs: Dict[str, Dict[str, List[GraphOutputRef]]] = field(default_factory=dict)
    node_metrics: Dict[str, Dict[str, Any]] = field(default_factory=dict)

    def inputs_for(self, node: GraphWorkflowNode, port_id: str) -> List[GraphOutputRef]:
        values: List[GraphOutputRef] = []
        for edge in self.workflow.edges:
            if edge.target == node.id and edge.target_port == port_id:
                values.extend(self.edge_outputs.get(edge.id, []))
        return values

    def all_inputs_for(self, node: GraphWorkflowNode) -> List[GraphOutputRef]:
        values: List[GraphOutputRef] = []
        for edge in self.workflow.edges:
            if edge.target == node.id:
                values.extend(self.edge_outputs.get(edge.id, []))
        return values

    def publish_outputs(self, node: GraphWorkflowNode, outputs: Dict[str, List[GraphOutputRef]]) -> None:
        self.node_outputs[node.id] = outputs
        for edge in self.workflow.edges:
            if edge.source == node.id:
                self.edge_outputs[edge.id] = outputs.get(edge.source_port, [])

    def record_node_metric(self, node: GraphWorkflowNode, key: str, value: Any) -> None:
        self.node_metrics.setdefault(node.id, {})[key] = value

    def is_cancel_requested(self) -> bool:
        run = store.get_graph_run(self.run_id) or {}
        return str(run.get("status") or "").strip() in {"cancelling", "cancelled"}

    def raise_if_cancel_requested(self) -> None:
        if self.is_cancel_requested():
            raise GraphRunCancelled()


class GraphExecutor:
    node_type: str

    def execute(self, node: GraphWorkflowNode, context: GraphExecutionContext) -> Dict[str, List[GraphOutputRef]]:
        raise NotImplementedError
