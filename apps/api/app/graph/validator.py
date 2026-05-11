from __future__ import annotations

from collections import defaultdict, deque
from typing import Dict, List, Set

from .. import store
from .registry import registry
from .schemas import GraphError, GraphValidationResult, GraphWorkflow, GraphWorkflowEdge, GraphWorkflowNode


def _port_map(definition, direction: str) -> Dict[str, object]:
    return {port.id: port for port in definition.ports.get(direction, [])}


def validate_workflow(workflow: GraphWorkflow) -> GraphValidationResult:
    definitions = registry.definitions_by_type()
    errors: List[GraphError] = []
    warnings: List[GraphError] = []

    node_ids: Set[str] = set()
    nodes_by_id: Dict[str, GraphWorkflowNode] = {}
    for node in workflow.nodes:
        if node.id in node_ids:
            errors.append(GraphError(code="duplicate_node_id", message=f"Duplicate node id: {node.id}", node_id=node.id))
            continue
        node_ids.add(node.id)
        nodes_by_id[node.id] = node
        definition = definitions.get(node.type)
        if not definition:
            errors.append(GraphError(code="missing_node_type", message=f"Unknown node type: {node.type}", node_id=node.id))
            continue
        for field in definition.fields:
            if field.required and field.id not in node.fields:
                errors.append(
                    GraphError(code="missing_required_field", message=f"Missing required field: {field.label}", node_id=node.id, field_id=field.id)
                )
        if node.type == "media.load_image" and not node.fields.get("asset_id") and not node.fields.get("reference_id"):
            errors.append(GraphError(code="missing_media_reference", message="Load Image needs an asset or reference image.", node_id=node.id))
        if node.fields.get("asset_id") and not store.get_asset(str(node.fields["asset_id"])):
            errors.append(GraphError(code="missing_asset", message="Referenced asset does not exist.", node_id=node.id, field_id="asset_id"))
        if node.fields.get("reference_id") and not store.get_reference_media(str(node.fields["reference_id"])):
            errors.append(GraphError(code="missing_reference_media", message="Referenced reference media does not exist.", node_id=node.id, field_id="reference_id"))

    edge_ids: Set[str] = set()
    incoming_by_target_port: Dict[tuple[str, str], int] = defaultdict(int)
    outgoing: Dict[str, List[str]] = defaultdict(list)
    indegree: Dict[str, int] = {node.id: 0 for node in workflow.nodes}
    for edge in workflow.edges:
        if edge.id in edge_ids:
            errors.append(GraphError(code="duplicate_edge_id", message=f"Duplicate edge id: {edge.id}", edge_id=edge.id))
            continue
        edge_ids.add(edge.id)
        source = nodes_by_id.get(edge.source)
        target = nodes_by_id.get(edge.target)
        if not source or not target:
            errors.append(GraphError(code="missing_edge_node", message="Edge references a missing node.", edge_id=edge.id))
            continue
        source_def = definitions.get(source.type)
        target_def = definitions.get(target.type)
        if not source_def or not target_def:
            continue
        source_port = _port_map(source_def, "outputs").get(edge.source_port)
        target_port = _port_map(target_def, "inputs").get(edge.target_port)
        if not source_port:
            errors.append(GraphError(code="missing_source_port", message=f"Unknown source port: {edge.source_port}", edge_id=edge.id, port_id=edge.source_port))
            continue
        if not target_port:
            errors.append(GraphError(code="missing_target_port", message=f"Unknown target port: {edge.target_port}", edge_id=edge.id, port_id=edge.target_port))
            continue
        source_type = getattr(source_port, "type", "")
        accepted = getattr(target_port, "accepts", None) or [getattr(target_port, "type", "")]
        if source_type not in accepted:
            errors.append(GraphError(code="incompatible_edge", message=f"Cannot connect {source_type} to {getattr(target_port, 'type', '')}.", edge_id=edge.id))
        key = (edge.target, edge.target_port)
        incoming_by_target_port[key] += 1
        max_count = getattr(target_port, "max", None)
        if max_count is not None and incoming_by_target_port[key] > max_count:
            errors.append(GraphError(code="input_cardinality_exceeded", message="Too many edges connected to input.", edge_id=edge.id, port_id=edge.target_port))
        outgoing[edge.source].append(edge.target)
        indegree[edge.target] = indegree.get(edge.target, 0) + 1

    for node in workflow.nodes:
        definition = definitions.get(node.type)
        if not definition:
            continue
        for port in definition.ports.get("inputs", []):
            if port.required and incoming_by_target_port[(node.id, port.id)] < max(1, port.min):
                errors.append(GraphError(code="missing_required_input", message=f"Missing required input: {port.label}", node_id=node.id, port_id=port.id))

    visited_count = 0
    queue = deque([node_id for node_id, count in indegree.items() if count == 0])
    while queue:
        node_id = queue.popleft()
        visited_count += 1
        for target_id in outgoing[node_id]:
            indegree[target_id] -= 1
            if indegree[target_id] == 0:
                queue.append(target_id)
    if workflow.nodes and visited_count != len(workflow.nodes):
        errors.append(GraphError(code="cycle_detected", message="Workflow contains a cycle."))

    connected_node_ids = {edge.source for edge in workflow.edges} | {edge.target for edge in workflow.edges}
    for node in workflow.nodes:
        if len(workflow.nodes) > 1 and node.id not in connected_node_ids:
            warnings.append(GraphError(code="disconnected_node", message="Node is disconnected.", node_id=node.id))

    return GraphValidationResult(valid=not errors, errors=errors, warnings=warnings)
