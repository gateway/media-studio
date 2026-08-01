from __future__ import annotations

import hashlib
import json
import re
import time
from dataclasses import dataclass, field
from threading import Event
from typing import Any, Callable, Dict, FrozenSet, List, Optional

from pydantic import BaseModel, Field, ValidationError

from .. import store, store_assistant
from ..graph.normalization import materialize_workflow_defaults
from ..graph.pricing import estimate_graph_workflow
from ..graph.registry import registry
from ..graph.schemas import GraphWorkflow
from ..graph.validator import validate_workflow
from ..store_support import new_id
from .canvas_context import compact_canvas_context
from .graph_diff import graph_plan_diff_summary, graph_plan_layout_errors
from .graph_plan import apply_graph_plan
from .reference_analysis import (
    AnalyzeReferenceImagesArguments,
    ReferenceAnalysisError,
    analyze_reference_images,
)
from .preset_kernel import (
    GetPresetArguments,
    ListMediaModelsArguments,
    PresetKernelError,
    ProposeMediaPresetDraftArguments,
    SearchPresetsArguments,
    get_preset,
    list_media_models,
    propose_media_preset_draft,
    search_presets,
)
from .production_plan import (
    ProductionPlanError,
    ProposeProductionPlanArguments,
    ReadProductionPlanArguments,
    UpdateProductionPlanStepArguments,
    propose_production_plan,
    read_production_plan,
    update_production_plan_step,
)
from .recipe_kernel import (
    GetPromptRecipeArguments,
    ProposePromptRecipeDraftArguments,
    RecipeKernelError,
    SearchPromptRecipesArguments,
    ValidatePromptRecipeDraftArguments,
    get_prompt_recipe,
    propose_prompt_recipe_draft,
    search_prompt_recipes,
    validate_prompt_recipe_draft,
)
from .schemas import (
    AssistantArtifactIntent,
    AssistantGraphOperation,
    AssistantGraphPlan,
    AssistantKernelCapability,
    AssistantKernelToolError,
    AssistantKernelToolTrace,
)
from .story_kernel import (
    ReadStoryStateArguments,
    StoryKernelError,
    UpdateStoryStateArguments,
    read_story_state,
    update_story_state,
)


KERNEL_TOOL_RESULT_MAX_BYTES = 32_768
KERNEL_SCHEMA_RESULT_TARGET_BYTES = 30_000
KERNEL_TOOL_ACTIVITIES = {
    "read_current_workflow": ("graph_check", "Checked your graph"),
    "list_graph_node_types": ("graph_catalog", "Checked available graph parts"),
    "inspect_graph_node_schemas": ("graph_catalog", "Checked graph connections and settings"),
    "validate_current_workflow": ("graph_validation", "Checked your graph"),
    "propose_graph_operations": ("graph_proposal", "Prepared a graph proposal"),
    "analyze_reference_images": ("reference_analysis", "Analyzed your reference"),
    "propose_media_preset_draft": ("preset_draft", "Prepared preset details"),
    "propose_prompt_recipe_draft": ("recipe_draft", "Prepared recipe details"),
    "propose_production_plan": ("production_plan", "Prepared a production plan"),
    "update_production_plan_step": ("production_plan", "Updated the production plan"),
    "update_story_state": ("story_update", "Updated the story"),
    "read_run_evidence": ("run_check", "Checked the latest run"),
}


class ReadCurrentWorkflowArguments(BaseModel):
    include_fields: bool = True
    include_selection: bool = True


class ListGraphNodeTypesArguments(BaseModel):
    query: str = ""
    limit: int = Field(default=30, ge=1, le=60)


class InspectGraphNodeSchemasArguments(BaseModel):
    node_types: List[str] = Field(min_length=1, max_length=8)


class ValidateCurrentWorkflowArguments(BaseModel):
    include_pricing: bool = True


class ProposeGraphOperationsArguments(BaseModel):
    summary: str = Field(min_length=1, max_length=800)
    operations: List[AssistantGraphOperation] = Field(min_length=1, max_length=64)
    questions: List[str] = Field(default_factory=list, max_length=8)
    warnings: List[str] = Field(default_factory=list, max_length=8)


class ReadRunEvidenceArguments(BaseModel):
    run_id: Optional[str] = Field(default=None, max_length=120)


class KernelToolFailure(Exception):
    def __init__(self, *, code: str, message: str, retryable: bool = True, details: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable
        self.details = details or {}


@dataclass(frozen=True)
class KernelToolContext:
    workflow: Optional[GraphWorkflow]
    canvas_context: Dict[str, Any]
    user_text: str = ""
    artifact_intent: AssistantArtifactIntent = "none"
    run_id: Optional[str] = None
    session_id: Optional[str] = None
    session: Dict[str, Any] = field(default_factory=dict)
    attachments: List[Dict[str, Any]] = field(default_factory=list)
    tool_evidence: List[Dict[str, Any]] = field(default_factory=list)
    cancel_event: Event | None = None
    timeout_seconds: Optional[float] = None


@dataclass(frozen=True)
class KernelToolDefinition:
    name: str
    description: str
    arguments_model: type[BaseModel]
    allowed_capabilities: FrozenSet[AssistantKernelCapability]
    handler: Callable[[BaseModel, KernelToolContext], Dict[str, Any]]


@dataclass(frozen=True)
class KernelToolExecution:
    result: Optional[Dict[str, Any]]
    trace: AssistantKernelToolTrace


def _arguments_hash(arguments: Dict[str, Any]) -> str:
    canonical = json.dumps(arguments, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]


def _workflow_title(node: Any) -> str:
    metadata = node.metadata if isinstance(node.metadata, dict) else {}
    ui = metadata.get("ui") if isinstance(metadata.get("ui"), dict) else {}
    return str(ui.get("customTitle") or node.type)


def workflow_fingerprint(workflow: GraphWorkflow) -> str:
    payload = materialize_workflow_defaults(workflow).model_dump(mode="json")
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _read_current_workflow(
    arguments: BaseModel,
    context: KernelToolContext,
) -> Dict[str, Any]:
    options = ReadCurrentWorkflowArguments.model_validate(arguments)
    workflow = context.workflow
    canvas = compact_canvas_context(context.canvas_context) or {}
    nodes = []
    if workflow is not None:
        nodes = [
            {
                "id": node.id,
                "type": node.type,
                "title": _workflow_title(node),
                "position": dict(node.position),
                "fields": dict(node.fields) if options.include_fields else {},
            }
            for node in workflow.nodes
        ]
        edges = [edge.model_dump(mode="json") for edge in workflow.edges]
        workflow_id = workflow.workflow_id
        workflow_name = workflow.name
    else:
        nodes = [
            {
                "id": item.get("id"),
                "type": item.get("type"),
                "title": item.get("title"),
                "position": item.get("position"),
                "fields": {},
            }
            for item in canvas.get("nodes", [])
            if isinstance(item, dict)
        ]
        edges = list(canvas.get("edges") or [])
        workflow_id = canvas.get("workflow_id")
        workflow_name = canvas.get("workflow_name")
    selection = {
        "available": bool(canvas.get("selection_available")),
        "selected_node_ids": list(canvas.get("selected_node_ids") or []),
        "selected_group_ids": list(canvas.get("selected_group_ids") or []),
    }
    return {
        "workflow_id": workflow_id,
        "name": workflow_name,
        "node_count": len(nodes),
        "edge_count": len(edges),
        "nodes": nodes,
        "edges": edges,
        "selection": selection if options.include_selection else {},
    }


def _read_run_evidence(arguments: BaseModel, context: KernelToolContext) -> Dict[str, Any]:
    options = ReadRunEvidenceArguments.model_validate(arguments)
    requested_run_id = str(options.run_id or context.run_id or "").strip()
    run = store.get_graph_run(requested_run_id) if requested_run_id else None
    if requested_run_id and run is None:
        raise KernelToolFailure(
            code="selected_run_not_found",
            message="The selected graph run is no longer available.",
            retryable=False,
        )
    if run is None:
        workflow_id = (
            context.workflow.workflow_id
            if context.workflow is not None
            else str((compact_canvas_context(context.canvas_context) or {}).get("workflow_id") or "")
        )
        candidates = (
            store.list_graph_runs_for_workflow(workflow_id, limit=40)
            if workflow_id
            else store.list_graph_runs(limit=40)
        )
        run = next(
            (
                item
                for item in candidates
                if str(item.get("status") or "") in {"failed", "cancelled"}
            ),
            None,
        )
    if run is None:
        raise KernelToolFailure(
            code="failed_run_not_found",
            message="No failed graph run is available to inspect.",
            retryable=False,
        )
    run_id = str(run.get("run_id") or "")
    run_nodes = store.list_graph_run_nodes(run_id)
    failed_nodes = [
        {
            "node_id": item.get("node_id"),
            "node_type": item.get("node_type"),
            "status": item.get("status"),
            "error": item.get("error"),
            "metrics": item.get("metrics_json"),
        }
        for item in run_nodes
        if str(item.get("status") or "") in {"failed", "skipped", "cancelled"}
        or str(item.get("error") or "").strip()
    ]
    persisted_workflow = run.get("workflow_json")
    if isinstance(persisted_workflow, dict) and isinstance(persisted_workflow.get("nodes"), list):
        workflow = persisted_workflow
    else:
        workflow_record = store.get_graph_workflow(str(run.get("workflow_id") or "")) or {}
        workflow = workflow_record.get("workflow_json") if isinstance(workflow_record.get("workflow_json"), dict) else {}
    failed_ids = {str(item.get("node_id") or "") for item in failed_nodes}
    relevant_nodes = [
        {
            "id": node.get("id"),
            "type": node.get("type"),
            "title": (
                (node.get("metadata") or {}).get("ui", {}).get("customTitle")
                if isinstance(node.get("metadata"), dict)
                else None
            ),
            "fields": {
                str(key): (
                    value[:1200]
                    if isinstance(value, str)
                    else value
                )
                for key, value in list((node.get("fields") or {}).items())[:20]
                if isinstance(value, (str, int, float, bool)) or value is None
            },
        }
        for node in workflow.get("nodes", [])
        if isinstance(node, dict) and str(node.get("id") or "") in failed_ids
    ]
    events = store.list_graph_run_events(run_id)
    artifacts = store.list_graph_artifacts_for_run(run_id)
    return {
        "run": {
            "run_id": run_id,
            "workflow_id": run.get("workflow_id"),
            "status": run.get("status"),
            "error": run.get("error"),
            "metrics": run.get("metrics_json"),
            "created_at": run.get("created_at"),
            "finished_at": run.get("finished_at"),
        },
        "failed_nodes": failed_nodes,
        "events": [
            {
                "event_type": item.get("event_type"),
                "node_id": item.get("node_id"),
                "payload": {
                    key: value[:1200] if isinstance(value, str) else value
                    for key, value in (item.get("payload_json") or {}).items()
                    if key in {"error", "message", "reason", "status", "job_id", "model_key"}
                },
                "created_at": item.get("created_at"),
            }
            for item in events[-24:]
        ],
        "artifacts": [
            {
                "artifact_id": item.get("artifact_id"),
                "node_id": item.get("node_id"),
                "kind": item.get("kind"),
                "media_type": item.get("media_type"),
                "asset_id": item.get("asset_id"),
                "reference_id": item.get("reference_id"),
            }
            for item in artifacts[:12]
        ],
        "workflow": {
            "workflow_id": workflow.get("workflow_id"),
            "name": workflow.get("name"),
            "node_count": len(workflow.get("nodes") or []),
            "edge_count": len(workflow.get("edges") or []),
            "failed_nodes": relevant_nodes,
        },
    }


def _list_graph_node_types(arguments: BaseModel, _context: KernelToolContext) -> Dict[str, Any]:
    options = ListGraphNodeTypesArguments.model_validate(arguments)
    query = " ".join(options.query.lower().split())
    query_tokens = {
        token
        for token in re.findall(r"[a-z0-9_]+", query)
        if token not in {"a", "an", "and", "for", "from", "into", "of", "on", "the", "then", "to", "with"}
    }
    ranked_matches = []
    for definition in registry.list_definitions():
        haystack = " ".join(
            [
                definition.type,
                definition.title,
                definition.description or "",
                definition.category,
                *definition.search_aliases,
                *definition.tags,
            ]
        ).lower()
        score = sum(1 for token in query_tokens if token in haystack)
        if query and not score:
            continue
        ranked_matches.append(
            (
                score,
                {
                    "type": definition.type,
                    "title": definition.title,
                    "description": definition.description,
                    "category": definition.category,
                    "input_ports": [port.id for port in definition.ports.get("inputs", [])],
                    "output_ports": [port.id for port in definition.ports.get("outputs", [])],
                    "field_ids": [field.id for field in definition.fields],
                },
            )
        )
    ranked_matches.sort(key=lambda item: item[0], reverse=True)
    matches = [item for _, item in ranked_matches[: options.limit]]
    return {"query": options.query, "count": len(matches), "node_types": matches}


def _compact_graph_node_definition(definition: Any) -> Dict[str, Any]:
    payload = definition.model_dump(mode="json")
    field_keys = {
        "id",
        "label",
        "type",
        "required",
        "default",
        "min",
        "max",
        "step",
        "placeholder",
        "options",
        "advanced",
        "hidden",
        "multiline",
    }
    port_keys = {"id", "label", "type", "array", "required", "min", "max", "accepts"}
    fields = []
    for field in payload.get("fields") or []:
        compact_field = {
            key: value
            for key, value in field.items()
            if key in field_keys and value not in (None, [], {}, "")
        }
        if "options" in compact_field:
            compact_field["options"] = [
                (
                    {key: option.get(key) for key in ("value", "label") if option.get(key) is not None}
                    if isinstance(option, dict)
                    else option
                )
                for option in compact_field["options"]
            ]
        fields.append(compact_field)
    return {
        "schema_version": payload.get("schema_version"),
        "type": payload.get("type"),
        "title": payload.get("title"),
        "description": payload.get("description"),
        "category": payload.get("category"),
        "tags": payload.get("tags") or [],
        "execution": payload.get("execution") or {},
        "limits": payload.get("limits") or {},
        "ui": payload.get("ui") or {},
        "ports": {
            side: [
                {
                    key: value
                    for key, value in port.items()
                    if key in port_keys and value not in (None, [], {}, "")
                }
                for port in (payload.get("ports") or {}).get(side, [])
            ]
            for side in ("inputs", "outputs")
        },
        "fields": fields,
    }


def _inspect_graph_node_schemas(arguments: BaseModel, _context: KernelToolContext) -> Dict[str, Any]:
    options = InspectGraphNodeSchemasArguments.model_validate(arguments)
    definitions = registry.definitions_by_type()
    missing = [node_type for node_type in options.node_types if node_type not in definitions]
    if missing:
        raise KernelToolFailure(
            code="unknown_graph_node_type",
            message="Inspect only node types returned by list_graph_node_types.",
            details={"node_types": missing},
        )
    selected = []
    omitted = []
    for index, node_type in enumerate(options.node_types):
        candidate = [*selected, _compact_graph_node_definition(definitions[node_type])]
        candidate_result = {"definitions": candidate, "omitted_node_types": []}
        encoded_size = len(json.dumps(candidate_result, separators=(",", ":")).encode("utf-8"))
        if selected and encoded_size > KERNEL_SCHEMA_RESULT_TARGET_BYTES:
            omitted = options.node_types[index:]
            break
        selected = candidate
    return {
        "definitions": selected,
        "omitted_node_types": omitted,
        "instruction": (
            "Inspect omitted node types in a separate call."
            if omitted
            else "Use these exact field ids, node types, and port ids in graph operations."
        ),
    }


def _validate_current_workflow(arguments: BaseModel, context: KernelToolContext) -> Dict[str, Any]:
    options = ValidateCurrentWorkflowArguments.model_validate(arguments)
    workflow = context.workflow or GraphWorkflow(
        name=str(context.canvas_context.get("workflow_name") or "New workflow"),
    )
    validation = validate_workflow(workflow)
    return {
        "workflow_id": workflow.workflow_id,
        "name": workflow.name,
        "validation": validation.model_dump(mode="json"),
        "pricing": estimate_graph_workflow(workflow).model_dump(mode="json") if options.include_pricing else {},
    }


def _propose_graph_operations(arguments: BaseModel, context: KernelToolContext) -> Dict[str, Any]:
    options = ProposeGraphOperationsArguments.model_validate(arguments)
    definitions = registry.definitions_by_type()
    for index, operation in enumerate(options.operations):
        if operation.op == "add_node" and operation.node_type not in definitions:
            raise KernelToolFailure(
                code="invalid_graph_operations",
                message=f"Operation {index + 1} uses an unknown node type.",
                details={"operation_index": index, "node_type": operation.node_type},
            )
    base_workflow = context.workflow or GraphWorkflow(
        name=str(context.canvas_context.get("workflow_name") or "New workflow"),
    )
    graph_plan = AssistantGraphPlan(
        summary=options.summary,
        operations=options.operations,
        questions=options.questions,
        warnings=options.warnings,
        requires_confirmation=True,
        metadata={"kernel_proposal": True},
    )
    try:
        planned_workflow = apply_graph_plan(base_workflow, graph_plan)
    except ValueError as exc:
        raise KernelToolFailure(
            code="invalid_graph_operations",
            message=str(exc),
            details={"operation_count": len(options.operations)},
        ) from exc
    validation = validate_workflow(planned_workflow)
    layout_errors = graph_plan_layout_errors(base_workflow, planned_workflow, graph_plan)
    pending_user_inputs = [
        error.model_dump(mode="json")
        for error in validation.errors
        if error.code == "missing_media_reference"
    ]
    confirmable = not layout_errors and (
        validation.valid
        or (bool(pending_user_inputs) and len(pending_user_inputs) == len(validation.errors))
    )
    if not confirmable:
        raise KernelToolFailure(
            code="graph_validation_failed",
            message="The proposed graph needs correction before it can be shown for confirmation.",
            details={
                "validation_errors": [error.model_dump(mode="json") for error in validation.errors[:12]],
                "layout_errors": [error.model_dump(mode="json") for error in layout_errors[:12]],
            },
        )
    diff_summary = graph_plan_diff_summary(
        base_workflow,
        planned_workflow,
        graph_plan,
        validation=validation,
        layout_errors=layout_errors,
    )
    pricing = estimate_graph_workflow(planned_workflow)
    confirmation_token = new_id("confirm")
    graph_plan.metadata.update(
        {
            "base_workflow_fingerprint": workflow_fingerprint(base_workflow),
            "confirmation_token_hash": hashlib.sha256(confirmation_token.encode("utf-8")).hexdigest(),
            "diff_summary": diff_summary,
        }
    )
    if not context.session_id:
        raise KernelToolFailure(
            code="proposal_persistence_unavailable",
            message="The graph proposal could not be bound to this assistant session.",
            retryable=False,
        )
    store_assistant.reject_validated_assistant_plans(context.session_id)
    plan_record = store_assistant.create_or_update_assistant_plan(
        {
            "assistant_session_id": context.session_id,
            "status": "validated",
            "capability": graph_plan.capability,
            "plan_json": graph_plan.model_dump(mode="json"),
            "validation_json": validation.model_dump(mode="json"),
            "pricing_json": pricing.model_dump(mode="json"),
            "workflow_json": planned_workflow.model_dump(mode="json"),
        }
    )
    return {
        "proposal_id": plan_record["assistant_plan_id"],
        "confirmation_token": confirmation_token,
        "summary": graph_plan.summary,
        "operations": [operation.model_dump(mode="json", exclude_none=True) for operation in graph_plan.operations],
        "workflow": planned_workflow.model_dump(mode="json"),
        "validation": validation.model_dump(mode="json"),
        "layout_errors": [],
        "pending_user_inputs": pending_user_inputs,
        "confirmable": True,
        "diff_summary": diff_summary,
        "pricing": pricing.model_dump(mode="json"),
    }


KERNEL_TOOLS: Dict[str, KernelToolDefinition] = {
    "read_current_workflow": KernelToolDefinition(
        name="read_current_workflow",
        description="Read the current workflow identity, nodes, fields, edges, and selection without changing it.",
        arguments_model=ReadCurrentWorkflowArguments,
        allowed_capabilities=frozenset(
            {
                "general",
                "graph_builder",
                "preset_builder",
                "recipe_builder",
                "story_builder",
                "run_debugger",
            }
        ),
        handler=_read_current_workflow,
    ),
    "read_run_evidence": KernelToolDefinition(
        name="read_run_evidence",
        description="Read a selected or latest failed run with failed node results, events, artifacts, and matching workflow nodes.",
        arguments_model=ReadRunEvidenceArguments,
        allowed_capabilities=frozenset({"run_debugger"}),
        handler=_read_run_evidence,
    ),
    "list_graph_node_types": KernelToolDefinition(
        name="list_graph_node_types",
        description="List real Graph Studio node types relevant to a search phrase before choosing node types.",
        arguments_model=ListGraphNodeTypesArguments,
        allowed_capabilities=frozenset({"graph_builder", "preset_builder", "recipe_builder", "story_builder", "run_debugger"}),
        handler=_list_graph_node_types,
    ),
    "inspect_graph_node_schemas": KernelToolDefinition(
        name="inspect_graph_node_schemas",
        description="Read full fields, ports, defaults, limits, and UI metadata for up to eight real graph node types.",
        arguments_model=InspectGraphNodeSchemasArguments,
        allowed_capabilities=frozenset({"graph_builder", "preset_builder", "recipe_builder", "story_builder", "run_debugger"}),
        handler=_inspect_graph_node_schemas,
    ),
    "validate_current_workflow": KernelToolDefinition(
        name="validate_current_workflow",
        description="Validate and optionally price the current graph without proposing or applying any change.",
        arguments_model=ValidateCurrentWorkflowArguments,
        allowed_capabilities=frozenset(
            {"graph_builder", "preset_builder", "recipe_builder", "story_builder", "run_debugger"}
        ),
        handler=_validate_current_workflow,
    ),
    "propose_graph_operations": KernelToolDefinition(
        name="propose_graph_operations",
        description="Apply typed graph operations in memory, validate and layout-check the result, price it, and persist a confirmable proposal.",
        arguments_model=ProposeGraphOperationsArguments,
        allowed_capabilities=frozenset({"graph_builder", "preset_builder", "recipe_builder", "story_builder", "run_debugger"}),
        handler=_propose_graph_operations,
    ),
    "search_presets": KernelToolDefinition(
        name="search_presets",
        description="Search active Media Presets and inspect their compact model and input scope.",
        arguments_model=SearchPresetsArguments,
        allowed_capabilities=frozenset({"general", "graph_builder", "preset_builder"}),
        handler=search_presets,
    ),
    "get_preset": KernelToolDefinition(
        name="get_preset",
        description="Read one Media Preset by id or key in its full editable contract shape.",
        arguments_model=GetPresetArguments,
        allowed_capabilities=frozenset({"general", "graph_builder", "preset_builder"}),
        handler=get_preset,
    ),
    "list_media_models": KernelToolDefinition(
        name="list_media_models",
        description="Read catalog-backed image or video model task modes, generation constraints, reference limits, frame support, and cost basis; filter by mode or exact model key.",
        arguments_model=ListMediaModelsArguments,
        allowed_capabilities=frozenset(
            {"general", "graph_builder", "preset_builder", "recipe_builder", "story_builder"}
        ),
        handler=list_media_models,
    ),
    "read_production_plan": KernelToolDefinition(
        name="read_production_plan",
        description="Read the active typed production plan for this assistant session.",
        arguments_model=ReadProductionPlanArguments,
        allowed_capabilities=frozenset({"story_builder"}),
        handler=read_production_plan,
    ),
    "propose_production_plan": KernelToolDefinition(
        name="propose_production_plan",
        description="Validate and persist an ordered production plan with stable ids, dependencies, and grounded constraints.",
        arguments_model=ProposeProductionPlanArguments,
        allowed_capabilities=frozenset({"story_builder"}),
        handler=propose_production_plan,
    ),
    "update_production_plan_step": KernelToolDefinition(
        name="update_production_plan_step",
        description="Update only one identified production-plan step and named constraints; enforce dependencies, explicit skips, and session-owned artifact references.",
        arguments_model=UpdateProductionPlanStepArguments,
        allowed_capabilities=frozenset({"story_builder", "graph_builder"}),
        handler=update_production_plan_step,
    ),
    "propose_media_preset_draft": KernelToolDefinition(
        name="propose_media_preset_draft",
        description="Validate and store an editable typed Media Preset draft; it becomes save-confirmable only with an applied priced test graph.",
        arguments_model=ProposeMediaPresetDraftArguments,
        allowed_capabilities=frozenset({"preset_builder"}),
        handler=propose_media_preset_draft,
    ),
    "search_prompt_recipes": KernelToolDefinition(
        name="search_prompt_recipes",
        description="Search active Prompt Recipes and inspect variables, fields, output format, and image-input behavior.",
        arguments_model=SearchPromptRecipesArguments,
        allowed_capabilities=frozenset({"general", "graph_builder", "recipe_builder"}),
        handler=search_prompt_recipes,
    ),
    "get_prompt_recipe": KernelToolDefinition(
        name="get_prompt_recipe",
        description="Read one Prompt Recipe by id or key in its full editable contract shape.",
        arguments_model=GetPromptRecipeArguments,
        allowed_capabilities=frozenset({"general", "graph_builder", "recipe_builder"}),
        handler=get_prompt_recipe,
    ),
    "validate_prompt_recipe_draft": KernelToolDefinition(
        name="validate_prompt_recipe_draft",
        description="Validate a typed Prompt Recipe draft and return its normalized contract and actionable warnings.",
        arguments_model=ValidatePromptRecipeDraftArguments,
        allowed_capabilities=frozenset({"recipe_builder"}),
        handler=validate_prompt_recipe_draft,
    ),
    "propose_prompt_recipe_draft": KernelToolDefinition(
        name="propose_prompt_recipe_draft",
        description="Validate and store an editable typed Prompt Recipe draft; save confirmation is issued only after the user asks to save.",
        arguments_model=ProposePromptRecipeDraftArguments,
        allowed_capabilities=frozenset({"recipe_builder"}),
        handler=propose_prompt_recipe_draft,
    ),
    "read_story_state": KernelToolDefinition(
        name="read_story_state",
        description="Read the current typed story bible, characters, continuity facts, and structured shots.",
        arguments_model=ReadStoryStateArguments,
        allowed_capabilities=frozenset({"story_builder"}),
        handler=read_story_state,
    ),
    "update_story_state": KernelToolDefinition(
        name="update_story_state",
        description="Validate and persist complete typed story state; single-shot revisions are scope-checked.",
        arguments_model=UpdateStoryStateArguments,
        allowed_capabilities=frozenset({"story_builder"}),
        handler=update_story_state,
    ),
    "analyze_reference_images": KernelToolDefinition(
        name="analyze_reference_images",
        description="Analyze attached reference images into cached, typed visual evidence for a specific goal.",
        arguments_model=AnalyzeReferenceImagesArguments,
        allowed_capabilities=frozenset(
            {
                "general",
                "graph_builder",
                "preset_builder",
                "recipe_builder",
                "story_builder",
                "run_debugger",
            }
        ),
        handler=analyze_reference_images,
    ),
}


def kernel_tool_catalog(capability: AssistantKernelCapability | None = None) -> list[Dict[str, Any]]:
    return [
        {
            "name": definition.name,
            "description": definition.description,
            "arguments_schema": definition.arguments_model.model_json_schema(),
            "allowed_capabilities": sorted(definition.allowed_capabilities),
            "read_only": definition.name
            not in {
                "propose_graph_operations",
                "propose_media_preset_draft",
                "propose_prompt_recipe_draft",
                "update_story_state",
            },
        }
        for definition in KERNEL_TOOLS.values()
        if capability is None or capability in definition.allowed_capabilities
    ]


def execute_kernel_tool(
    *,
    tool_name: str,
    arguments: Dict[str, Any] | str,
    capability: AssistantKernelCapability,
    context: KernelToolContext,
) -> KernelToolExecution:
    started = time.perf_counter()
    definition = KERNEL_TOOLS.get(str(tool_name or "").strip())
    error: AssistantKernelToolError | None = None
    result: Dict[str, Any] | None = None
    parsed_payload: Dict[str, Any] | None = None
    try:
        decoded = json.loads(arguments) if isinstance(arguments, str) else arguments
        if not isinstance(decoded, dict):
            raise ValueError("Tool arguments must decode to an object.")
        parsed_payload = decoded
    except (json.JSONDecodeError, TypeError, ValueError) as exc:
        error = AssistantKernelToolError(
            code="invalid_tool_arguments",
            message=str(exc),
            retryable=True,
        )
    if error is not None:
        pass
    elif definition is None:
        error = AssistantKernelToolError(
            code="tool_out_of_scope",
            message="That tool is not available to the Media Assistant.",
        )
    elif capability not in definition.allowed_capabilities:
        error = AssistantKernelToolError(
            code="tool_out_of_scope",
            message=f"{definition.name} is not available to the selected capability.",
        )
    else:
        try:
            parsed_arguments = definition.arguments_model.model_validate(parsed_payload)
            result = definition.handler(parsed_arguments, context)
        except ValidationError as exc:
            error = AssistantKernelToolError(
                code="invalid_tool_arguments",
                message=exc.errors()[0].get("msg", "Invalid tool arguments."),
                retryable=True,
            )
        except KernelToolFailure as exc:
            error = AssistantKernelToolError(
                code=exc.code,
                message=exc.message,
                retryable=exc.retryable,
                details=exc.details,
            )
        except ReferenceAnalysisError as exc:
            error = AssistantKernelToolError(
                code=exc.code,
                message=exc.message,
                retryable=exc.retryable,
            )
        except PresetKernelError as exc:
            error = AssistantKernelToolError(
                code=exc.code,
                message=exc.message,
                retryable=exc.retryable,
            )
        except RecipeKernelError as exc:
            error = AssistantKernelToolError(
                code=exc.code,
                message=exc.message,
                retryable=exc.retryable,
            )
        except ProductionPlanError as exc:
            error = AssistantKernelToolError(
                code=exc.code,
                message=exc.message,
                retryable=exc.retryable,
                details=exc.details,
            )
        except StoryKernelError as exc:
            error = AssistantKernelToolError(
                code=exc.code,
                message=exc.message,
                retryable=exc.retryable,
            )
    encoded = json.dumps(result or {}, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    if (
        error is None
        and definition is not None
        and definition.name == "read_current_workflow"
        and isinstance(result, dict)
        and len(encoded) > KERNEL_TOOL_RESULT_MAX_BYTES
    ):
        compact_nodes = []
        for node in result.get("nodes", []):
            if not isinstance(node, dict):
                continue
            fields = node.get("fields") if isinstance(node.get("fields"), dict) else {}
            compact_nodes.append(
                {
                    key: value
                    for key, value in node.items()
                    if key != "fields"
                }
            )
            compact_nodes[-1]["field_names"] = sorted(str(key) for key in fields)
        result = {
            **result,
            "nodes": compact_nodes,
            "field_values_omitted": True,
        }
        encoded = json.dumps(result, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    if (
        error is None
        and definition is not None
        and definition.name == "propose_graph_operations"
        and isinstance(result, dict)
        and len(encoded) > KERNEL_TOOL_RESULT_MAX_BYTES
    ):
        proposed_workflow = result.get("workflow") if isinstance(result.get("workflow"), dict) else {}
        proposed_nodes = proposed_workflow.get("nodes") if isinstance(proposed_workflow.get("nodes"), list) else []
        proposed_edges = proposed_workflow.get("edges") if isinstance(proposed_workflow.get("edges"), list) else []
        result = {
            key: value
            for key, value in result.items()
            if key not in {"workflow", "operations"}
        }
        result["operations_count"] = len(parsed_payload.get("operations") or [])
        result["workflow_summary"] = {
            "workflow_id": proposed_workflow.get("workflow_id"),
            "name": proposed_workflow.get("name"),
            "node_count": len(proposed_nodes),
            "edge_count": len(proposed_edges),
            "node_types": sorted(
                {
                    str(node.get("type") or "")
                    for node in proposed_nodes
                    if isinstance(node, dict) and str(node.get("type") or "")
                }
            ),
        }
        encoded = json.dumps(result, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    if error is None and len(encoded) > KERNEL_TOOL_RESULT_MAX_BYTES:
        result = None
        error = AssistantKernelToolError(
            code="tool_result_too_large",
            message="The tool result exceeded the assistant result-size budget.",
            retryable=True,
        )
        encoded = b"{}"
    activity = KERNEL_TOOL_ACTIVITIES.get(str(tool_name or ""))
    trace = AssistantKernelToolTrace(
        tool_name=str(tool_name or ""),
        arguments_hash=_arguments_hash(arguments),
        duration_ms=max(0, int((time.perf_counter() - started) * 1000)),
        result_size_bytes=len(encoded),
        evidence=(
            result
            if error is None and str(tool_name or "") == "list_media_models"
            else None
        ),
        cache_status=(
            result.get("cache_status")
            if isinstance(result, dict) and result.get("cache_status") in {"hit", "miss"}
            else None
        ),
        error=error,
        activity=(
            {
                "kind": activity[0],
                "label": activity[1],
                "tone": "error" if error else "success",
            }
            if activity
            else None
        ),
    )
    return KernelToolExecution(result=result, trace=trace)
