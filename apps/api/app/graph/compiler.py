from __future__ import annotations

from collections import defaultdict, deque
from typing import Dict, List

from .registry import registry
from .schemas import GraphCompiledGraph, GraphCompiledNode, GraphWorkflow
from .validator import validate_workflow


class GraphCompileError(ValueError):
    pass


def compile_workflow(workflow: GraphWorkflow) -> GraphCompiledGraph:
    validation = validate_workflow(workflow)
    if not validation.valid:
        raise GraphCompileError("; ".join(error.message for error in validation.errors))

    definitions = registry.definitions_by_type()
    outgoing: Dict[str, List[str]] = defaultdict(list)
    indegree: Dict[str, int] = {node.id: 0 for node in workflow.nodes}
    input_edges: Dict[str, Dict[str, List[str]]] = {node.id: defaultdict(list) for node in workflow.nodes}
    depends_on: Dict[str, set[str]] = {node.id: set() for node in workflow.nodes}
    for edge in workflow.edges:
        outgoing[edge.source].append(edge.target)
        indegree[edge.target] += 1
        input_edges[edge.target][edge.target_port].append(edge.id)
        depends_on[edge.target].add(edge.source)

    queue = deque([node_id for node_id, count in indegree.items() if count == 0])
    execution_order: List[str] = []
    while queue:
        node_id = queue.popleft()
        execution_order.append(node_id)
        for target_id in outgoing[node_id]:
            indegree[target_id] -= 1
            if indegree[target_id] == 0:
                queue.append(target_id)

    node_by_id = {node.id: node for node in workflow.nodes}
    compiled_nodes: Dict[str, GraphCompiledNode] = {}
    output_node_ids: List[str] = []
    used_types = set()
    for node_id in execution_order:
        node = node_by_id[node_id]
        used_types.add(node.type)
        definition = definitions[node.type]
        if definition.execution.get("output_node"):
            output_node_ids.append(node_id)
        compiled_nodes[node_id] = GraphCompiledNode(
            node_id=node.id,
            node_type=node.type,
            depends_on=sorted(depends_on[node.id]),
            input_edges={key: list(value) for key, value in input_edges[node.id].items()},
            fields=dict(node.fields),
        )

    return GraphCompiledGraph(
        execution_order=execution_order,
        nodes=compiled_nodes,
        output_node_ids=output_node_ids,
        node_definitions={node_type: definitions[node_type] for node_type in sorted(used_types)},
        warnings=validation.warnings,
    )
