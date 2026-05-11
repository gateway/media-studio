from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List

from ..schemas import GraphOutputRef, GraphWorkflow, GraphWorkflowNode


@dataclass
class GraphExecutionContext:
    run_id: str
    workflow: GraphWorkflow
    edge_outputs: Dict[str, List[GraphOutputRef]] = field(default_factory=dict)
    node_outputs: Dict[str, Dict[str, List[GraphOutputRef]]] = field(default_factory=dict)

    def inputs_for(self, node: GraphWorkflowNode, port_id: str) -> List[GraphOutputRef]:
        values: List[GraphOutputRef] = []
        for edge in self.workflow.edges:
            if edge.target == node.id and edge.target_port == port_id:
                values.extend(self.edge_outputs.get(edge.id, []))
        return values

    def publish_outputs(self, node: GraphWorkflowNode, outputs: Dict[str, List[GraphOutputRef]]) -> None:
        self.node_outputs[node.id] = outputs
        for edge in self.workflow.edges:
            if edge.source == node.id:
                self.edge_outputs[edge.id] = outputs.get(edge.source_port, [])


class GraphExecutor:
    node_type: str

    def execute(self, node: GraphWorkflowNode, context: GraphExecutionContext) -> Dict[str, List[GraphOutputRef]]:
        raise NotImplementedError

