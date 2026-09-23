"""Typed edits applied only to the proposal's deep copy before validation/persistence."""
from collections import Counter
from typing import Callable

from ..graph.registry import registry
from ..graph.schemas import GraphWorkflow
from ..graph.validator import connection_errors, validate_model_field_values
from .schemas import AssistantGraphOperation


def apply_in_place_edit(workflow: GraphWorkflow, operation: AssistantGraphOperation, resolve: Callable) -> None:
    if operation.op == "rename_workflow":
        if not operation.title or not operation.title.strip():
            raise ValueError("Workflow name cannot be empty.")
        workflow.name = operation.title.strip()
        return
    if operation.op in {"update_edge", "remove_edge"}:
        edge = next((item for item in workflow.edges if item.id == operation.edge_id), None)
        if edge is None:
            raise ValueError("Choose an existing edge by its exact ID.")
        if operation.op == "remove_edge":
            workflow.edges.remove(edge)
            return
        for ref, field in ((operation.source_ref, "source"), (operation.target_ref, "target")):
            if ref is not None:
                node_id = resolve(ref)
                if not node_id:
                    raise ValueError(f"Unknown edge endpoint: {ref}")
                setattr(edge, field, node_id)
        for field in ("source_port", "target_port"):
            value = getattr(operation, field)
            if value is not None:
                setattr(edge, field, value)
        return
    node_id = resolve(operation.node_ref, operation.node_id)
    node = next((item for item in workflow.nodes if item.id == node_id), None)
    if node is None or not node.type.startswith("model.kie.") or not (operation.node_type or "").startswith("model.kie."):
        raise ValueError("Model replacement requires an existing model node and a model node type.")
    try:
        definition = registry.get_definition(operation.node_type)
    except KeyError:
        raise ValueError("Choose an available model from the current model catalog.") from None
    fields = {field.id: field.default for field in definition.fields if field.default is not None}
    fields.update({key: value for key, value in node.fields.items() if key not in operation.remove_field_ids})
    fields.update(operation.fields)
    unknown = set(fields) - {field.id for field in definition.fields}
    if unknown:
        raise ValueError(f"Map or explicitly remove incompatible model fields: {', '.join(sorted(unknown))}.")
    validate_model_field_values(definition, fields)
    kept_edges = []
    for edge in workflow.edges:
        remove = False
        for endpoint, port_field, mapping in (
            ("target", "target_port", operation.input_port_map),
            ("source", "source_port", operation.output_port_map),
        ):
            if getattr(edge, endpoint) != node.id:
                continue
            old_port = getattr(edge, port_field)
            if old_port not in mapping:
                raise ValueError(f"Explicitly map connected port {old_port}; use null only to remove its edges.")
            if mapping[old_port] is None:
                remove = True
            else:
                setattr(edge, port_field, mapping[old_port])
        if not remove:
            kept_edges.append(edge)
    node.type = operation.node_type
    node.fields = fields
    workflow.edges = kept_edges


def validate_edit_connections(workflow: GraphWorkflow) -> None:
    """Reject bad mappings even for disabled nodes, whose runtime fields may be skipped."""
    nodes = {node.id: node for node in workflow.nodes}
    counts = Counter((edge.target, edge.target_port) for edge in workflow.edges)
    definitions = registry.definitions_by_type()
    for edge in workflow.edges:
        source, target = nodes.get(edge.source), nodes.get(edge.target)
        errors = connection_errors(edge, source, target,
                                   definitions.get(source.type) if source else None,
                                   definitions.get(target.type) if target else None,
                                   counts[(edge.target, edge.target_port)])
        if errors:
            raise ValueError(f"{errors[0].message} Map compatible ports or explicitly remove the connection.")


def graph_edit_fingerprint(workflow: GraphWorkflow) -> str:
    import hashlib
    import json
    from ..graph.normalization import materialize_workflow_defaults

    # Canvas navigation/bookkeeping does not change the reviewed graph.
    payload = materialize_workflow_defaults(workflow).model_dump(mode="json", exclude={"viewport"})
    payload["metadata"].pop("created_by", None)
    if not payload["metadata"].get("groups"):
        payload["metadata"].pop("groups", None)
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
