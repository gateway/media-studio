from __future__ import annotations

from copy import deepcopy
from typing import Dict, Iterable

from .prompt_recipe_catalog import prompt_recipe_for_node_type, prompt_recipe_catalog
from .registry import registry
from .schemas import GraphNodeDefinition, GraphWorkflow, GraphWorkflowEdge, GraphWorkflowNode


def _recipe_by_id(catalog: Iterable[dict]) -> Dict[str, dict]:
    return {str(item.get("recipe_id") or ""): item for item in catalog if str(item.get("recipe_id") or "").strip()}


SEEDANCE_LEGACY_TARGET_PORTS = {
    "image_refs": "reference_images",
    "video_refs": "reference_videos",
    "audio_refs": "reference_audios",
}


def normalize_prompt_recipe_node(
    node: GraphWorkflowNode,
    *,
    recipe_catalog_items: list[dict] | None = None,
    recipe_lookup: Dict[str, dict] | None = None,
) -> GraphWorkflowNode:
    fields = dict(node.fields)
    changed = False
    recipe = None
    catalog = recipe_catalog_items if recipe_catalog_items is not None else prompt_recipe_catalog(status="all")
    by_id = recipe_lookup if recipe_lookup is not None else _recipe_by_id(catalog)
    if node.type != "prompt.recipe" and node.type.startswith("prompt.recipe."):
        recipe = prompt_recipe_for_node_type(node.type, catalog=catalog)
        if recipe:
            fields.setdefault("recipe_id", str(recipe.get("recipe_id") or ""))
            changed = True
        node = node.model_copy(update={"type": "prompt.recipe"})
        changed = True
    elif node.type == "prompt.recipe":
        recipe_id = str(fields.get("recipe_id") or "").strip()
        if recipe_id:
            recipe = by_id.get(recipe_id)
    if recipe and not str(fields.get("recipe_category") or "").strip():
        fields["recipe_category"] = str(recipe.get("category") or "utility")
        changed = True
    if not changed:
        return node
    return node.model_copy(update={"fields": fields, "type": node.type})


def materialize_node_field_defaults(
    node: GraphWorkflowNode,
    definition: GraphNodeDefinition | None,
) -> GraphWorkflowNode:
    if definition is None:
        return node
    fields = dict(node.fields)
    changed = False
    for field in definition.fields:
        if field.id in fields or field.default is None:
            continue
        fields[field.id] = deepcopy(field.default)
        changed = True
    if not changed:
        return node
    return node.model_copy(update={"fields": fields})


def materialize_workflow_defaults(
    workflow: GraphWorkflow,
    *,
    definitions_by_type: Dict[str, GraphNodeDefinition] | None = None,
) -> GraphWorkflow:
    definitions = definitions_by_type or registry.definitions_by_type()
    all_recipe_catalog = prompt_recipe_catalog(status="all")
    recipe_lookup = _recipe_by_id(all_recipe_catalog)
    nodes = []
    for node in workflow.nodes:
        normalized = normalize_prompt_recipe_node(node, recipe_catalog_items=all_recipe_catalog, recipe_lookup=recipe_lookup)
        nodes.append(materialize_node_field_defaults(normalized, definitions.get(normalized.type)))
    seedance_node_ids = {node.id for node in nodes if node.type == "model.kie.seedance_2_0"}
    edges: list[GraphWorkflowEdge] = []
    edges_changed = False
    for edge in workflow.edges:
        if edge.target in seedance_node_ids and edge.target_port in SEEDANCE_LEGACY_TARGET_PORTS:
            edges.append(edge.model_copy(update={"target_port": SEEDANCE_LEGACY_TARGET_PORTS[edge.target_port]}))
            edges_changed = True
        else:
            edges.append(edge)
    if all(next_node is current for next_node, current in zip(nodes, workflow.nodes)) and not edges_changed:
        return workflow
    return workflow.model_copy(update={"nodes": nodes, "edges": edges})
