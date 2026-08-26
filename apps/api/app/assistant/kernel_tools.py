from __future__ import annotations

import hashlib
import json
import re
import time
from dataclasses import dataclass, field, replace
from threading import Event
from typing import Any, Callable, Dict, FrozenSet, List, Literal, Optional

from pydantic import BaseModel, Field, ValidationError

from .. import store, store_assistant
from ..graph.normalization import materialize_workflow_defaults
from ..graph.pricing import estimate_graph_workflow
from ..graph.registry import registry
from ..graph.schemas import GraphWorkflow, GraphWorkflowNode
from ..graph.validator import validate_workflow
from ..service_errors import ServiceError
from ..service_prompt_recipe_validation import prompt_recipe_media_generation
from ..store_support import new_id
from .canvas_context import compact_canvas_context
from .graph_diff import graph_plan_diff_summary, graph_plan_layout_errors
from .graph_plan import apply_graph_plan
from .reference_analysis import (
    AnalyzeGeneratedOutputArguments,
    AnalyzeReferenceImagesArguments,
    RecordPresetQualityDecisionArguments,
    ReferenceAnalysisError,
    analyze_preset_output,
    analyze_recipe_output,
    analyze_reference_images,
    record_preset_quality_decision,
    record_recipe_quality_decision,
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
from .provenance import (
    preset_quality_contract_hash,
    preset_test_workflow_fingerprint,
    recipe_quality_contract_hash,
    workflow_fingerprint,
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
    "analyze_preset_output": ("output_comparison", "Compared the generated result"),
    "analyze_recipe_output": ("output_comparison", "Compared the generated result"),
    "record_preset_quality_decision": ("output_comparison", "Recorded your quality decision"),
    "record_recipe_quality_decision": ("output_comparison", "Recorded your quality decision"),
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
    request_run_confirmation: bool = False


class DerivedRecipeDefaultsOverride(BaseModel):
    recipe_id: str = Field(min_length=1, max_length=160)
    model_key: Optional[str] = Field(
        default=None,
        max_length=160,
        description=(
            "Exact Graph Studio model key. When a saved recipe returns "
            "rules_json.intended_media_model, copy that value exactly."
        ),
    )
    default_options_json: Dict[str, Any] = Field(default_factory=dict)


class ProposeGraphOperationsArguments(BaseModel):
    summary: str = Field(min_length=1, max_length=800)
    operations: List[AssistantGraphOperation] = Field(default_factory=list, max_length=64)
    template_id: Optional[
        Literal[
            "preset_style_t2i_sandbox_v1",
            "preset_style_i2i_sandbox_v1",
            "saved_recipe_image_v1",
        ]
    ] = None
    recipe_id: Optional[str] = Field(default=None, max_length=160)
    field_values: Optional[Dict[str, str]] = Field(default=None, min_length=1)
    questions: List[str] = Field(default_factory=list, max_length=8)
    warnings: List[str] = Field(default_factory=list, max_length=8)
    additional_paid_path_intent: Literal["not_requested", "explicitly_requested"] = "not_requested"
    test_lane_replacement_intent: Literal["not_requested", "explicitly_requested"] = "not_requested"
    derived_recipe_defaults_overrides: List[DerivedRecipeDefaultsOverride] = Field(
        default_factory=list,
        max_length=4,
    )


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
    capability: AssistantKernelCapability | None = None
    user_text: str = ""
    user_message_id: Optional[str] = None
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
        metadata = workflow.metadata if isinstance(workflow.metadata, dict) else {}
        groups = (compact_canvas_context({"groups": metadata.get("groups")}) or {}).get("groups") or []
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
        groups = list(canvas.get("groups") or [])
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
        "groups": groups,
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
    preset_test = None
    recipe_run = None
    if context.capability in {"preset_builder", "recipe_builder"}:
        from .run_confirmation import RunEvidenceError, bind_completed_assistant_run

        evidence_kind = (
            "preset_test" if context.capability == "preset_builder" else "recipe"
        )
        if not context.session_id:
            raise KernelToolFailure(
                code=f"{evidence_kind}_session_missing",
                message="The Media Assistant session is unavailable.",
                retryable=False,
            )
        try:
            evidence = bind_completed_assistant_run(
                context.session_id,
                run,
                expected_kind=evidence_kind,
            )
        except RunEvidenceError as exc:
            raise KernelToolFailure(code=exc.code, message=str(exc), retryable=False) from exc
        if evidence_kind == "preset_test":
            preset_test = evidence
        else:
            recipe_run = evidence
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
        "preset_test": preset_test,
        "recipe_run": recipe_run,
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
        summary = {
            "type": definition.type,
            "title": definition.title,
            "description": definition.description,
            "category": definition.category,
            "input_ports": [port.id for port in definition.ports.get("inputs", [])],
            "output_ports": [port.id for port in definition.ports.get("outputs", [])],
            "field_ids": [field.id for field in definition.fields],
        }
        compact_definition = _compact_graph_node_definition(definition)
        operation_schema = {
            "type": definition.type,
            "title": definition.title,
            "description": definition.description,
            "category": definition.category,
            "inputs": [
                {
                    key: value
                    for key, value in port.items()
                    if key in {"id", "type", "array", "required", "accepts"}
                }
                for port in compact_definition["ports"]["inputs"]
            ],
            "outputs": [
                {
                    key: value
                    for key, value in port.items()
                    if key in {"id", "type", "array", "required", "accepts"}
                }
                for port in compact_definition["ports"]["outputs"]
            ],
            "fields": [
                {
                    key: value
                    for key, value in field.items()
                    if key in {
                        "id",
                        "type",
                        "required",
                        "default",
                        "min",
                        "max",
                        "step",
                        "options",
                    }
                }
                for field in compact_definition["fields"]
            ],
        }
        ranked_matches.append((score, summary, operation_schema))
    ranked_matches.sort(key=lambda item: item[0], reverse=True)
    selected = ranked_matches[: options.limit]
    summaries = [summary for _, summary, _ in selected]
    matches = []
    omitted = []
    per_schema_budget = KERNEL_SCHEMA_RESULT_TARGET_BYTES // 8
    for (_, summary, operation_schema) in selected:
        schema_size = len(json.dumps(operation_schema, separators=(",", ":")).encode("utf-8"))
        if schema_size > per_schema_budget:
            matches.append(summary)
            omitted.append(str(summary["type"]))
        else:
            matches.append(operation_schema)
    result = {
        "query": options.query,
        "count": len(matches),
        "node_types": matches,
        "schema_omitted_node_types": omitted,
        "instruction": (
            "Use these exact fields and typed ports for graph operations. Inspect only omitted "
            "node types or unresolved option values and limits."
        ),
    }
    encoded_size = len(json.dumps(result, separators=(",", ":")).encode("utf-8"))
    for index in range(len(matches) - 1, -1, -1):
        if encoded_size <= KERNEL_SCHEMA_RESULT_TARGET_BYTES:
            break
        if "fields" not in matches[index]:
            continue
        matches[index] = summaries[index]
        omitted.insert(0, str(summaries[index]["type"]))
        encoded_size = len(json.dumps(result, separators=(",", ":")).encode("utf-8"))
    return result


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
        "run_confirmation_requested": options.request_run_confirmation,
    }


PRESET_TEST_GRAPH_TEMPLATES = {
    "preset_style_t2i_sandbox_v1": {
        "mode": "text_to_image",
        "model_key": "gpt-image-2-text-to-image",
        "node_type": "model.kie.gpt_image_2_text_to_image",
    },
    "preset_style_i2i_sandbox_v1": {
        "mode": "image_to_image",
        "model_key": "gpt-image-2-image-to-image",
        "node_type": "model.kie.gpt_image_2_image_to_image",
    },
}


def _matching_applied_template_plan(
    context: KernelToolContext,
    *,
    template_id: str,
    expected_metadata: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    if not context.session_id or context.workflow is None:
        return None
    current_fingerprint = _template_lane_workflow_fingerprint(context.workflow)
    return next(
        (
            plan
            for plan in store_assistant.list_assistant_plans(context.session_id)
            if str(plan.get("status") or "") == "applied"
            and str(((plan.get("plan_json") or {}).get("metadata") or {}).get("template_id") or "")
            == template_id
            and all(
                ((plan.get("plan_json") or {}).get("metadata") or {}).get(key) == value
                for key, value in (expected_metadata or {}).items()
            )
            and isinstance(plan.get("workflow_json"), dict)
            and _template_lane_workflow_fingerprint(
                GraphWorkflow.model_validate(plan["workflow_json"])
            )
            == current_fingerprint
        ),
        None,
    )


def _template_lane_workflow_fingerprint(workflow: GraphWorkflow) -> str:
    comparable = workflow.model_copy(deep=True)
    definitions = registry.definitions_by_type()
    for node in comparable.nodes:
        definition = definitions.get(node.type)
        if definition is not None:
            node.fields = {
                key: value
                for key, value in node.fields.items()
                if any(
                    _node_field_available(node, field)
                    for field in definition.fields
                    if field.id == key
                )
            }
        execution = (
            node.metadata.get("execution")
            if isinstance(node.metadata.get("execution"), dict)
            else {}
        )
        node.metadata["execution"] = {
            "mode": str(execution.get("mode") or "enabled")
        }
    return preset_test_workflow_fingerprint(comparable)


def _node_field_available(node: GraphWorkflowNode, field: Any) -> bool:
    return bool(
        not isinstance(field.visible_if, dict)
        or field.visible_if.get("field") != "recipe_id"
        or node.fields.get("recipe_id") in (field.visible_if.get("in") or [])
    )


def _applied_template_lane_nodes(
    context: KernelToolContext,
    *,
    template_id: str,
    expected_node_types: Dict[str, str],
    expected_metadata: Optional[Dict[str, Any]] = None,
    replacement_error_code: str,
) -> Optional[Dict[str, str]]:
    matching_plan = _matching_applied_template_plan(
        context,
        template_id=template_id,
        expected_metadata=expected_metadata,
    )
    if matching_plan is None:
        return None
    plan_workflow = GraphWorkflow.model_validate(matching_plan["workflow_json"])
    plan_metadata = (matching_plan.get("plan_json") or {}).get("metadata") or {}
    stored_node_ids = (
        plan_metadata.get("template_lane_node_ids")
        if isinstance(plan_metadata.get("template_lane_node_ids"), dict)
        else {}
    )
    nodes_by_ref: Dict[str, str] = {
        str(key): str(value)
        for key, value in stored_node_ids.items()
        if key in expected_node_types and value
    }
    for node in plan_workflow.nodes:
        assistant_metadata = (
            node.metadata.get("assistant")
            if isinstance(node.metadata.get("assistant"), dict)
            else {}
        )
        semantic_ref = str(assistant_metadata.get("semantic_ref") or "")
        if semantic_ref in expected_node_types and semantic_ref not in nodes_by_ref:
            if node.type != expected_node_types[semantic_ref]:
                raise KernelToolFailure(
                    code=replacement_error_code,
                    message="Review replacing the existing test lane before applying this refinement.",
                    retryable=False,
                )
            nodes_by_ref[semantic_ref] = node.id
    current_nodes = {node.id: node for node in context.workflow.nodes}
    if set(nodes_by_ref) != set(expected_node_types) or any(
        node_id not in current_nodes
        or current_nodes[node_id].type != expected_node_types[semantic_ref]
        for semantic_ref, node_id in nodes_by_ref.items()
    ):
        raise KernelToolFailure(
            code=replacement_error_code,
            message="Review replacing the existing test lane before applying this refinement.",
            retryable=False,
        )
    return nodes_by_ref


def _saved_recipe_refinement_metadata(
    context: KernelToolContext,
    operations: List[AssistantGraphOperation],
) -> Dict[str, Any]:
    plan = _matching_applied_template_plan(
        context,
        template_id="saved_recipe_image_v1",
    )
    if plan is None or context.workflow is None or not operations:
        return {}
    plan_workflow = GraphWorkflow.model_validate(plan["workflow_json"])
    previous = (plan.get("plan_json") or {}).get("metadata") or {}
    lane_node_ids = {
        str(key): str(value)
        for key, value in (previous.get("template_lane_node_ids") or {}).items()
        if key in {"recipe_prompt", "recipe_model", "recipe_preview"} and value
    }
    lane_node_ids.update({
        str(node.metadata["assistant"].get("semantic_ref") or ""): node.id
        for node in plan_workflow.nodes
        if isinstance(node.metadata.get("assistant"), dict)
        and str(node.metadata["assistant"].get("semantic_ref") or "")
        in {"recipe_prompt", "recipe_model", "recipe_preview"}
    })
    lane_ids = set(lane_node_ids.values())
    prompt_node_id = lane_node_ids.get("recipe_prompt")
    current_node_ids = {node.id for node in context.workflow.nodes}
    if not lane_ids.issubset(current_node_ids):
        return {}
    if not any(str(operation.node_id or "") in lane_ids for operation in operations):
        return {}
    if not all(
        operation.op == "set_node_field"
        and str(operation.node_id or "") == prompt_node_id
        for operation in operations
    ):
        raise KernelToolFailure(
            code="saved_recipe_refinement_operation_invalid",
            message="A saved-recipe creative refinement may update only the recipe node's Run Refinement field.",
            retryable=True,
        )
    invalid_field_keys = sorted(
        {
            key
            for operation in operations
            for key in operation.fields
            if key != "refinement"
        }
    )
    if invalid_field_keys:
        raise KernelToolFailure(
            code="saved_recipe_refinement_field_invalid",
            message="Use fields supported by the selected Prompt Recipe for this refinement.",
            details={"invalid_field_keys": invalid_field_keys},
            retryable=True,
        )
    inherited_keys = {
        "template_id",
        "template_recipe_id",
        "template_model_key",
        "template_field_keys",
        "template_generation_source",
    }
    return {
        **{key: previous[key] for key in inherited_keys if key in previous},
        "template_lane_node_ids": lane_node_ids,
        "template_refinement": True,
    }


def _test_lane_replacement_authorized(
    context: KernelToolContext,
    *,
    template_id: str,
    contract: Dict[str, Any],
) -> bool:
    if not context.session_id or not context.user_message_id or context.workflow is None:
        return False
    session = store_assistant.get_assistant_session(context.session_id) or context.session
    summary = session.get("summary_json") if isinstance(session.get("summary_json"), dict) else {}
    offer = summary.get("kernel_test_lane_replacement_offer")
    return bool(
        isinstance(offer, dict)
        and offer.get("template_id") == template_id
        and offer.get("contract") == contract
        and offer.get("workflow_fingerprint") == workflow_fingerprint(context.workflow)
        and str(offer.get("offered_user_message_id") or "") != context.user_message_id
    )


def _offer_test_lane_replacement(
    context: KernelToolContext,
    *,
    template_id: str,
    contract: Dict[str, Any],
) -> None:
    if not context.session_id or context.workflow is None:
        return
    session = store_assistant.get_assistant_session(context.session_id) or context.session
    summary = session.get("summary_json") if isinstance(session.get("summary_json"), dict) else {}
    store_assistant.create_or_update_assistant_session(
        {
            **session,
            "summary_json": {
                **summary,
                "kernel_test_lane_replacement_offer": {
                    "template_id": template_id,
                    "contract": contract,
                    "workflow_fingerprint": workflow_fingerprint(context.workflow),
                    "offered_user_message_id": context.user_message_id,
                },
            },
        }
    )


def _workflow_is_replaceable_test_lane(workflow: GraphWorkflow) -> bool:
    groups = workflow.metadata.get("groups") if isinstance(workflow.metadata, dict) else []
    if groups:
        return False
    paid_nodes = [node for node in workflow.nodes if node.type.startswith("model.kie.")]
    prompt_nodes = [node for node in workflow.nodes if node.type in {"prompt.text", "prompt.recipe"}]
    preview_nodes = [node for node in workflow.nodes if node.type == "preview.image"]
    image_nodes = [node for node in workflow.nodes if node.type == "media.load_image"]
    if (
        len(paid_nodes) != 1
        or len(prompt_nodes) != 1
        or len(preview_nodes) != 1
        or len(workflow.nodes) != len(image_nodes) + 3
    ):
        return False
    model_id = paid_nodes[0].id
    expected_edges = {
        (prompt_nodes[0].id, "text", model_id, "prompt"),
        (model_id, "image", preview_nodes[0].id, "image"),
        *{
            (node.id, "image", model_id, "image_refs")
            for node in image_nodes
        },
    }
    actual_edges = {
        (edge.source, edge.source_port, edge.target, edge.target_port)
        for edge in workflow.edges
    }
    return actual_edges == expected_edges


def _authorize_test_lane_replacement(
    context: KernelToolContext,
    *,
    template_id: str,
    contract: Dict[str, Any],
    replacement_intent: str,
    replacement_error_code: str,
) -> bool:
    if context.workflow is None or not _workflow_is_replaceable_test_lane(context.workflow):
        raise KernelToolFailure(
            code="test_lane_replacement_unsafe",
            message="This workflow contains composition outside one canonical test lane, so it cannot be replaced safely.",
            retryable=False,
        )
    if replacement_intent == "explicitly_requested" and _test_lane_replacement_authorized(
        context,
        template_id=template_id,
        contract=contract,
    ):
        return True
    _offer_test_lane_replacement(
        context,
        template_id=template_id,
        contract=contract,
    )
    raise KernelToolFailure(
        code=replacement_error_code,
        message="Ask whether to replace the existing test lane, then prepare that reviewed replacement only after approval.",
        retryable=False,
    )


def _saved_recipe_graph_operations(
    recipe_id: Optional[str],
    field_values: Optional[Dict[str, str]],
    requested_overrides: List[DerivedRecipeDefaultsOverride],
    context: KernelToolContext,
    replacement_intent: str,
) -> tuple[List[AssistantGraphOperation], Dict[str, Any]]:
    recipe = store.get_prompt_recipe(str(recipe_id or ""))
    if not recipe or str(recipe.get("status") or "") != "active":
        raise KernelToolFailure(
            code="saved_recipe_graph_recipe_required",
            message="Choose an active saved Prompt Recipe before preparing its graph.",
        )
    image_input = (
        recipe.get("image_input_json")
        if isinstance(recipe.get("image_input_json"), dict)
        else {}
    )
    configured_inputs = [
        item
        for item in [
            *(recipe.get("input_variables_json") or []),
            *(recipe.get("custom_fields_json") or []),
        ]
        if isinstance(item, dict)
        and str(item.get("key") or "")
        and bool(item.get("enabled", True))
    ]
    if str(image_input.get("mode") or "none") != "none" or any(
        str(item.get("input_kind") or "none") == "image"
        for item in configured_inputs
    ):
        raise KernelToolFailure(
            code="saved_recipe_graph_template_unsupported",
            message="This saved recipe needs an image-aware graph proposal.",
        )
    configured_by_key = {
        str(item.get("key") or ""): item
        for item in configured_inputs
    }
    supplied_values = {
        str(key): str(value).strip()
        for key, value in (field_values or {}).items()
    }
    invalid_keys = sorted(set(supplied_values) - set(configured_by_key))
    invalid_values = sorted(
        key
        for key, value in supplied_values.items()
        if not value or len(value) > 300
    )
    if invalid_keys or invalid_values:
        raise KernelToolFailure(
            code="saved_recipe_graph_field_value_invalid",
            message="Use non-empty values for fields in the selected saved recipe.",
            details={"invalid_keys": invalid_keys, "invalid_values": invalid_values},
        )
    template = str(recipe.get("system_prompt_template") or "")
    missing_keys = [
        key
        for key, item in configured_by_key.items()
        if key not in supplied_values
        and item.get("default_value") in (None, "", [], {})
        and (bool(item.get("required")) or "{{" + key + "}}" in template)
    ]
    if missing_keys:
        raise KernelToolFailure(
            code="saved_recipe_graph_field_values_required",
            message="Provide the missing saved-recipe field values before preparing its graph.",
            details={"missing_field_keys": missing_keys},
        )
    try:
        generation = prompt_recipe_media_generation(recipe)
    except ServiceError as exc:
        raise KernelToolFailure(
            code="invalid_prompt_recipe_media_generation",
            message=str(exc),
            retryable=False,
        ) from exc
    recipe_id = str(recipe.get("recipe_id") or "")
    requested_override = next(
        (item for item in requested_overrides if item.recipe_id == recipe_id),
        None,
    )
    generation_source = "saved_recipe"
    if generation is None:
        if (
            requested_override is None
            or not requested_override.model_key
            or not requested_override.default_options_json
        ):
            raise KernelToolFailure(
                code="saved_recipe_graph_generation_defaults_required",
                message=(
                    "This saved recipe predates typed generation defaults. "
                    "Provide the exact model and settings requested in this turn."
                ),
            )
        generation = {
            "model_key": requested_override.model_key,
            "default_options_json": dict(requested_override.default_options_json),
        }
        generation_source = "user_request"
    elif requested_override is not None:
        generation = {
            **generation,
            "model_key": requested_override.model_key or generation["model_key"],
            "default_options_json": {
                **generation["default_options_json"],
                **requested_override.default_options_json,
            },
        }
    definitions = registry.definitions_by_type()
    matching_models = [
        definition
        for definition in definitions.values()
        if str((definition.source or {}).get("model_key") or "")
        == generation["model_key"]
        and str((definition.source or {}).get("output_media_type") or "") == "image"
    ]
    if len(matching_models) != 1:
        raise KernelToolFailure(
            code="saved_recipe_graph_model_unavailable",
            message="The saved recipe's image model is not uniquely available in Graph Studio.",
            retryable=False,
        )
    model_definition = matching_models[0]
    model_fields_by_id = {field.id: field for field in model_definition.fields}
    invalid_model_fields = sorted(
        set(generation["default_options_json"]) - set(model_fields_by_id)
    )
    if invalid_model_fields:
        raise KernelToolFailure(
            code="saved_recipe_graph_option_invalid",
            message="The requested generation settings are not supported by this model.",
            retryable=False,
            details={"invalid_option_keys": invalid_model_fields},
        )
    invalid_model_values = []
    for key, value in generation["default_options_json"].items():
        field = model_fields_by_id[key]
        allowed_values = [
            option.get("value") if isinstance(option, dict) else option
            for option in field.options
        ]
        invalid = bool(allowed_values) and value not in allowed_values
        if not invalid and (field.min is not None or field.max is not None):
            try:
                numeric_value = float(value)
            except (TypeError, ValueError):
                invalid = True
            else:
                invalid = (
                    (field.min is not None and numeric_value < field.min)
                    or (field.max is not None and numeric_value > field.max)
                )
        if invalid:
            invalid_model_values.append(key)
    if invalid_model_values:
        raise KernelToolFailure(
            code="saved_recipe_graph_option_value_invalid",
            message="The requested generation setting values are not supported by this model.",
            retryable=False,
            details={"invalid_option_value_keys": invalid_model_values},
        )
    model_fields = {
        field.id: field.default
        for field in model_definition.fields
        if field.default is not None
    }
    model_fields.update(generation["default_options_json"])
    recipe_fields = {
        "recipe_category": str(recipe.get("category") or "utility"),
        "recipe_id": str(recipe.get("recipe_id") or ""),
        **supplied_values,
    }
    new_lane_operations = [
        AssistantGraphOperation(
            op="add_node",
            node_ref="recipe_prompt",
            node_type="prompt.recipe",
            title=str(recipe.get("label") or "Saved Prompt Recipe"),
            position={"x": 80, "y": 120},
            fields=recipe_fields,
        ),
        AssistantGraphOperation(
            op="add_node",
            node_ref="recipe_model",
            node_type=model_definition.type,
            title=f"{model_definition.title} Test",
            position={"x": 580, "y": 120},
            fields=model_fields,
        ),
        AssistantGraphOperation(
            op="add_node",
            node_ref="recipe_preview",
            node_type="preview.image",
            title="Recipe Test Preview",
            position={"x": 1040, "y": 120},
        ),
        AssistantGraphOperation(
            op="connect_nodes",
            source_ref="recipe_prompt",
            source_port="text",
            target_ref="recipe_model",
            target_port="prompt",
        ),
        AssistantGraphOperation(
            op="connect_nodes",
            source_ref="recipe_model",
            source_port="image",
            target_ref="recipe_preview",
            target_port="image",
        ),
    ]
    existing_lane = _applied_template_lane_nodes(
        context,
        template_id="saved_recipe_image_v1",
        expected_node_types={
            "recipe_prompt": "prompt.recipe",
            "recipe_model": model_definition.type,
            "recipe_preview": "preview.image",
        },
        expected_metadata={
            "template_recipe_id": recipe_id,
            "template_model_key": generation["model_key"],
        },
        replacement_error_code="saved_recipe_test_lane_replacement_required",
    )
    replacement_contract = {
        "recipe_id": recipe_id,
        "model_key": generation["model_key"],
    }
    replace_existing_lane = False
    if existing_lane is not None:
        operations = [
            AssistantGraphOperation(
                op="set_node_field",
                node_id=existing_lane["recipe_prompt"],
                fields=recipe_fields,
            ),
            AssistantGraphOperation(
                op="set_node_field",
                node_id=existing_lane["recipe_model"],
                fields=model_fields,
            ),
        ]
    elif context.workflow is not None and any(
        node.type.startswith("model.kie.") for node in context.workflow.nodes
    ):
        replace_existing_lane = _authorize_test_lane_replacement(
            context,
            template_id="saved_recipe_image_v1",
            contract=replacement_contract,
            replacement_intent=replacement_intent,
            replacement_error_code="saved_recipe_test_lane_replacement_required",
        )
        operations = new_lane_operations
    else:
        operations = new_lane_operations
    return operations, {
        "template_id": "saved_recipe_image_v1",
        "template_recipe_id": str(recipe.get("recipe_id") or ""),
        "template_model_key": generation["model_key"],
        "template_field_keys": sorted(supplied_values),
        "template_generation_source": generation_source,
        "recipe_quality_contract_hash": recipe_quality_contract_hash(recipe),
        "template_refinement": existing_lane is not None,
        "replace_existing_test_lane": replace_existing_lane,
    }


def _preset_test_graph_operations(
    template_id: str,
    context: KernelToolContext,
    field_values: Optional[Dict[str, str]] = None,
    replacement_intent: str = "not_requested",
) -> tuple[List[AssistantGraphOperation], Dict[str, Any]]:
    template = PRESET_TEST_GRAPH_TEMPLATES[template_id]
    session = store_assistant.get_assistant_session(context.session_id or "") or context.session
    summary = session.get("summary_json") if isinstance(session.get("summary_json"), dict) else {}
    draft = summary.get("kernel_preset_draft") if isinstance(summary.get("kernel_preset_draft"), dict) else None
    if not draft:
        raise KernelToolFailure(
            code="preset_test_draft_required",
            message="Prepare the Media Preset draft before proposing its test graph.",
        )
    rules = draft.get("rules_json") if isinstance(draft.get("rules_json"), dict) else {}
    mode = str(rules.get("preset_lane") or "")
    slots = draft.get("input_slots_json") if isinstance(draft.get("input_slots_json"), list) else []
    model_key = str(draft.get("model_key") or "")
    prompt_template = str(draft.get("prompt_template") or "")
    fields = draft.get("input_schema_json") if isinstance(draft.get("input_schema_json"), list) else []
    configured_fields = {
        str(item.get("key") or ""): item
        for item in fields
        if isinstance(item, dict) and str(item.get("key") or "")
    }
    supplied_field_values: Optional[Dict[str, str]] = None
    if configured_fields:
        supplied_field_values = {
            str(key): str(value).strip()
            for key, value in (field_values or {}).items()
        }
        invalid_keys = sorted(set(supplied_field_values) - set(configured_fields))
        invalid_values = sorted(
            key
            for key, value in supplied_field_values.items()
            if not value or len(value) > 300
        )
        if invalid_keys or invalid_values:
            raise KernelToolFailure(
                code="preset_test_field_value_invalid",
                message="Use non-empty sample values for fields in the active Media Preset draft.",
                details={"invalid_keys": invalid_keys, "invalid_values": invalid_values},
            )
        missing_field_values = [
            key
            for key in configured_fields
            if key not in supplied_field_values
        ]
        if missing_field_values:
            raise KernelToolFailure(
                code="preset_test_field_values_required",
                message="Provide normal sample values for each preset field before building the test graph.",
                details={"missing_field_keys": missing_field_values},
            )
        for key, value in supplied_field_values.items():
            token = "{{" + key + "}}"
            if token not in prompt_template:
                raise KernelToolFailure(
                    code="preset_test_field_value_invalid",
                    message="A supplied field is not used by the active preset prompt template.",
                    details={"unused_field_key": key},
                )
            prompt_template = prompt_template.replace(token, value)
    if mode != template["mode"] or model_key != template["model_key"]:
        raise KernelToolFailure(
            code="preset_test_template_mismatch",
            message="The selected test graph does not match the active preset lane and GPT Image 2 model.",
            details={"draft_mode": mode, "draft_model_key": model_key, "template_id": template_id},
        )
    if mode == "text_to_image" and slots:
        raise KernelToolFailure(
            code="preset_test_template_mismatch",
            message="A text-to-image preset test cannot include runtime image slots.",
        )
    if mode == "image_to_image" and not slots:
        raise KernelToolFailure(
            code="preset_test_template_mismatch",
            message="An image-to-image preset test requires at least one runtime image slot.",
        )

    definitions = registry.definitions_by_type()
    model_definition = definitions.get(template["node_type"])
    if not model_definition:
        raise KernelToolFailure(
            code="preset_test_model_unavailable",
            message="The selected GPT Image 2 model is not available in the current catalog.",
            retryable=False,
        )
    allowed_model_fields = {field.id for field in model_definition.fields}
    draft_options = draft.get("default_options_json") if isinstance(draft.get("default_options_json"), dict) else {}
    model_fields = {
        field.id: field.default
        for field in model_definition.fields
        if field.default is not None
    }
    model_fields.update(
        {key: value for key, value in draft_options.items() if key in allowed_model_fields}
    )
    expected_node_types = {
        "preset_prompt": "prompt.text",
        "preset_model": template["node_type"],
        "preset_preview": "preview.image",
        **{
            f"preset_image_{index + 1}": "media.load_image"
            for index in range(len(slots))
        },
    }
    existing_lane = _applied_template_lane_nodes(
        context,
        template_id=template_id,
        expected_node_types=expected_node_types,
        expected_metadata={
            "template_mode": mode,
            "template_model_key": model_key,
        },
        replacement_error_code="preset_test_lane_replacement_required",
    )
    if existing_lane is not None:
        return [
            AssistantGraphOperation(
                op="set_node_field",
                node_id=existing_lane["preset_prompt"],
                fields={"text": prompt_template},
            ),
            AssistantGraphOperation(
                op="set_node_field",
                node_id=existing_lane["preset_model"],
                fields=model_fields,
            ),
        ], {
            "template_id": template_id,
            "template_mode": mode,
            "template_slot_count": len(slots),
            "template_model_key": model_key,
            "template_field_keys": list(configured_fields),
            "template_field_values_supplied": supplied_field_values is not None,
            "preset_quality_contract_hash": preset_quality_contract_hash(draft),
            "template_refinement": True,
        }
    replace_existing_lane = False
    if context.workflow is not None and any(
        node.type.startswith("model.kie.") for node in context.workflow.nodes
    ):
        replacement_contract = {
            "preset_quality_contract_hash": preset_quality_contract_hash(draft),
            "template_mode": mode,
            "template_model_key": model_key,
        }
        replace_existing_lane = _authorize_test_lane_replacement(
            context,
            template_id=template_id,
            contract=replacement_contract,
            replacement_intent=replacement_intent,
            replacement_error_code="preset_test_lane_replacement_required",
        )
    operations: List[AssistantGraphOperation] = []
    for index, slot in enumerate(slots):
        label = str(slot.get("label") or f"Image input {index + 1}") if isinstance(slot, dict) else f"Image input {index + 1}"
        operations.append(
            AssistantGraphOperation(
                op="add_node",
                node_ref=f"preset_image_{index + 1}",
                node_type="media.load_image",
                title=label,
                position={"x": 0, "y": index * 360},
            )
        )
    operations.extend(
        [
            AssistantGraphOperation(
                op="add_node",
                node_ref="preset_prompt",
                node_type="prompt.text",
                title="Draft Preset Prompt",
                position={"x": 0, "y": max(0, len(slots) * 360)},
                fields={"text": prompt_template},
            ),
            AssistantGraphOperation(
                op="add_node",
                node_ref="preset_model",
                node_type=template["node_type"],
                title="GPT Image 2 Test",
                position={"x": 520, "y": 180},
                fields=model_fields,
            ),
            AssistantGraphOperation(
                op="add_node",
                node_ref="preset_preview",
                node_type="preview.image",
                title="Preset Test Preview",
                position={"x": 1040, "y": 180},
            ),
            AssistantGraphOperation(
                op="connect_nodes",
                source_ref="preset_prompt",
                source_port="text",
                target_ref="preset_model",
                target_port="prompt",
            ),
        ]
    )
    for index in range(len(slots)):
        operations.append(
            AssistantGraphOperation(
                op="connect_nodes",
                source_ref=f"preset_image_{index + 1}",
                source_port="image",
                target_ref="preset_model",
                target_port="image_refs",
            )
        )
    operations.append(
        AssistantGraphOperation(
            op="connect_nodes",
            source_ref="preset_model",
            source_port="image",
            target_ref="preset_preview",
            target_port="image",
        )
    )
    return operations, {
        "template_id": template_id,
        "template_mode": mode,
        "template_slot_count": len(slots),
        "template_model_key": model_key,
        "template_field_keys": list(configured_fields),
        "template_field_values_supplied": supplied_field_values is not None,
        "preset_quality_contract_hash": preset_quality_contract_hash(draft),
        "replace_existing_test_lane": replace_existing_lane,
    }


def _propose_graph_operations(arguments: BaseModel, context: KernelToolContext) -> Dict[str, Any]:
    options = ProposeGraphOperationsArguments.model_validate(arguments)
    operations = options.operations
    metadata: Dict[str, Any] = {"kernel_proposal": True}
    if any(operation.op == "arrange_workflow" for operation in operations):
        if len(operations) != 1:
            raise KernelToolFailure(
                code="invalid_graph_operations",
                message="Use arrange_workflow by itself for a geometry-only proposal.",
            )
        metadata["arrange_workflow"] = True
    session_summary = context.session.get("summary_json") if isinstance(context.session.get("summary_json"), dict) else {}
    active_preset_draft = session_summary.get("kernel_preset_draft")
    template_id = options.template_id
    if context.capability == "preset_builder" and isinstance(active_preset_draft, dict):
        rules = active_preset_draft.get("rules_json") if isinstance(active_preset_draft.get("rules_json"), dict) else {}
        template_id = template_id or (
            "preset_style_i2i_sandbox_v1"
            if rules.get("preset_lane") == "image_to_image"
            else "preset_style_t2i_sandbox_v1"
        )
        operations = []
    if template_id:
        if operations:
            raise KernelToolFailure(
                code=(
                    "saved_recipe_graph_template_operations_conflict"
                    if template_id == "saved_recipe_image_v1"
                    else "preset_test_template_operations_conflict"
                ),
                message="A standard graph template cannot be combined with hand-authored graph operations.",
            )
        if template_id == "saved_recipe_image_v1":
            operations, template_metadata = _saved_recipe_graph_operations(
                options.recipe_id,
                options.field_values,
                options.derived_recipe_defaults_overrides,
                context,
                options.test_lane_replacement_intent,
            )
            if template_metadata["template_generation_source"] == "user_request":
                if not context.user_message_id:
                    raise KernelToolFailure(
                        code="saved_recipe_graph_generation_request_required",
                        message="The requested generation settings must be tied to the current user message.",
                        retryable=False,
                    )
                template_metadata["template_generation_user_message_id"] = context.user_message_id
        else:
            operations, template_metadata = _preset_test_graph_operations(
                template_id,
                context,
                options.field_values,
                options.test_lane_replacement_intent,
            )
        metadata.update(template_metadata)
    elif not operations:
        raise KernelToolFailure(
            code="invalid_graph_operations",
            message="Provide at least one graph operation or a standard preset test template.",
        )
    if not template_id:
        metadata.update(_saved_recipe_refinement_metadata(context, operations))
    definitions = registry.definitions_by_type()
    for index, operation in enumerate(operations):
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
        operations=operations,
        questions=options.questions,
        warnings=options.warnings,
        requires_confirmation=True,
        metadata=metadata,
    )
    planning_base_workflow = base_workflow
    if graph_plan.metadata.get("replace_existing_test_lane"):
        planning_base_workflow = GraphWorkflow(
            schema_version=base_workflow.schema_version,
            workflow_id=base_workflow.workflow_id,
            name=base_workflow.name,
            metadata=base_workflow.metadata,
        )
    adds_paid_path = any(
        operation.op == "add_node"
        and str(operation.node_type or "").startswith("model.kie.")
        for operation in operations
    )
    has_paid_path = any(node.type.startswith("model.kie.") for node in base_workflow.nodes)
    if (
        context.capability in {"graph_builder", "recipe_builder"}
        and has_paid_path
        and adds_paid_path
        and not graph_plan.metadata.get("replace_existing_test_lane")
        and options.additional_paid_path_intent != "explicitly_requested"
    ):
        raise KernelToolFailure(
            code="duplicate_paid_path_requires_explicit_intent",
            message=(
                "Reuse the compatible paid recipe path, or ask whether to replace the graph or "
                "start fresh. Add another paid path only when the user explicitly requests one."
            ),
        )
    try:
        planned_workflow = apply_graph_plan(planning_base_workflow, graph_plan)
    except ValueError as exc:
        raise KernelToolFailure(
            code="invalid_graph_operations",
            message=str(exc),
            details={"operation_count": len(operations)},
        ) from exc
    materialized_workflow = materialize_workflow_defaults(
        planned_workflow,
        definitions_by_type=definitions,
    )
    nodes_by_id = {node.id: node for node in materialized_workflow.nodes}
    requested_overrides = {
        override.recipe_id: override
        for override in options.derived_recipe_defaults_overrides
    }
    used_overrides = (
        {str(graph_plan.metadata.get("template_recipe_id") or "")}
        if graph_plan.metadata.get("template_generation_source") == "user_request"
        else set()
    )
    derived_defaults_overrides = []
    for edge in materialized_workflow.edges:
        source = nodes_by_id.get(edge.source)
        target = nodes_by_id.get(edge.target)
        if (
            source is None
            or target is None
            or source.type != "prompt.recipe"
            or edge.source_port != "text"
            or edge.target_port != "prompt"
        ):
            continue
        recipe = store.get_prompt_recipe(str(source.fields.get("recipe_id") or ""))
        if not recipe:
            continue
        try:
            generation = prompt_recipe_media_generation(recipe)
        except ServiceError as exc:
            raise KernelToolFailure(
                code="invalid_prompt_recipe_media_generation",
                message=str(exc),
                retryable=False,
            ) from exc
        if generation is None:
            continue
        target_definition = definitions.get(target.type)
        actual_model_key = str((target_definition.source if target_definition else {}).get("model_key") or "")
        mismatched_options = {
            key: {"expected": value, "actual": target.fields.get(key)}
            for key, value in generation["default_options_json"].items()
            if target.fields.get(key) != value
        }
        if actual_model_key != generation["model_key"] or mismatched_options:
            recipe_id = str(recipe.get("recipe_id") or "")
            mismatch = {
                "source_recipe_id": recipe_id,
                "source_preset_id": generation["source_preset_id"],
                "expected_model_key": generation["model_key"],
                "actual_model_key": actual_model_key,
                "mismatched_options": mismatched_options,
            }
            requested = requested_overrides.get(recipe_id)
            model_override_matches = (
                (actual_model_key == generation["model_key"] and requested and requested.model_key is None)
                or (requested and requested.model_key == actual_model_key)
            )
            options_override_matches = bool(requested) and requested.default_options_json == {
                key: values["actual"]
                for key, values in mismatched_options.items()
            }
            if not context.user_message_id or not model_override_matches or not options_override_matches:
                raise KernelToolFailure(
                    code="derived_recipe_defaults_mismatch",
                    message=(
                        "Use the model and generation defaults stored with this preset-derived recipe, "
                        "or mark a user-requested change as an explicit override."
                    ),
                    details=mismatch,
                )
            used_overrides.add(recipe_id)
            derived_defaults_overrides.append(mismatch)
    unused_overrides = sorted(set(requested_overrides) - used_overrides)
    if unused_overrides:
        raise KernelToolFailure(
            code="derived_recipe_defaults_override_unused",
            message="Only request overrides for inherited recipe settings that actually change.",
            details={"recipe_ids": unused_overrides},
        )
    if derived_defaults_overrides:
        graph_plan.metadata["derived_recipe_defaults_override"] = {
            "user_message_id": context.user_message_id,
            "changes": derived_defaults_overrides,
        }
        graph_plan.warnings.append(
            "This graph changes generation defaults inherited from a preset-derived recipe."
        )
    elif graph_plan.metadata.get("template_generation_source") == "user_request":
        graph_plan.warnings.append(
            "This graph uses generation settings from the current request because the saved recipe predates typed preset provenance."
        )
    validation = validate_workflow(planned_workflow)
    layout_errors = graph_plan_layout_errors(
        planning_base_workflow,
        planned_workflow,
        graph_plan,
    )
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
    layout_requested = bool(graph_plan.metadata.get("arrange_workflow"))
    diff_summary = graph_plan_diff_summary(
        base_workflow,
        planned_workflow,
        graph_plan,
        validation=validation,
        layout_errors=layout_errors,
    )
    if (
        layout_requested
        and not diff_summary.get("nodes_moved")
        and not diff_summary.get("groups_repositioned")
    ):
        graph_plan.operations = []
        graph_plan.metadata["no_canvas_changes"] = True
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
        "action_metadata": {
            key: True
            for key in (
                "arrange_workflow",
                "no_canvas_changes",
                "replace_existing_test_lane",
                "template_refinement",
            )
            if graph_plan.metadata.get(key)
        },
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
        description="Read a selected run with node results, events, artifacts, and matching workflow nodes; preset and recipe work also bind completed image output to the exact confirmed assistant run.",
        arguments_model=ReadRunEvidenceArguments,
        allowed_capabilities=frozenset({"preset_builder", "recipe_builder", "run_debugger"}),
        handler=_read_run_evidence,
    ),
    "list_graph_node_types": KernelToolDefinition(
        name="list_graph_node_types",
        description=(
            "List real Graph Studio node types relevant to a search phrase with compact operation fields "
            "and typed ports. Inspect full schemas separately only for reported omissions or unresolved "
            "option values and limits."
        ),
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
        description=(
            "Build a standard preset test graph by template id, or apply typed graph operations; validate, "
            "layout-check, price, and persist the confirmable proposal. For a layout-only request, use exactly "
            "one arrange_workflow operation; the server deterministically moves existing nodes and recomputes "
            "existing group bounds while preserving graph content, connections, identities, and membership."
        ),
        arguments_model=ProposeGraphOperationsArguments,
        allowed_capabilities=frozenset({"graph_builder", "preset_builder", "recipe_builder", "story_builder", "run_debugger"}),
        handler=_propose_graph_operations,
    ),
    "search_presets": KernelToolDefinition(
        name="search_presets",
        description="Search active Media Presets and inspect their compact model and input scope.",
        arguments_model=SearchPresetsArguments,
        allowed_capabilities=frozenset({"general", "graph_builder", "preset_builder", "recipe_builder"}),
        handler=search_presets,
    ),
    "get_preset": KernelToolDefinition(
        name="get_preset",
        description="Read one Media Preset by id or key in its full editable contract shape.",
        arguments_model=GetPresetArguments,
        allowed_capabilities=frozenset({"general", "graph_builder", "preset_builder", "recipe_builder"}),
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
        description="Validate and store an editable typed Media Preset draft; verified save requires approved output evidence, while an explicit unverified save remains separately confirmation-gated.",
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
    "analyze_preset_output": KernelToolDefinition(
        name="analyze_preset_output",
        description="Compare a session-owned generated preset output against attached style references with explicit image roles and one focused prompt delta.",
        arguments_model=AnalyzeGeneratedOutputArguments,
        allowed_capabilities=frozenset({"preset_builder"}),
        handler=analyze_preset_output,
    ),
    "analyze_recipe_output": KernelToolDefinition(
        name="analyze_recipe_output",
        description="Compare a session-owned generated recipe output against attached source references with explicit image roles and one focused prompt delta.",
        arguments_model=AnalyzeGeneratedOutputArguments,
        allowed_capabilities=frozenset({"recipe_builder"}),
        handler=analyze_recipe_output,
    ),
    "record_preset_quality_decision": KernelToolDefinition(
        name="record_preset_quality_decision",
        description="Persist the user's approve, continue, or stop decision for the latest session-owned preset output comparison without starting or saving anything.",
        arguments_model=RecordPresetQualityDecisionArguments,
        allowed_capabilities=frozenset({"preset_builder"}),
        handler=record_preset_quality_decision,
    ),
    "record_recipe_quality_decision": KernelToolDefinition(
        name="record_recipe_quality_decision",
        description="Persist the user's approve, continue, or stop decision for the latest session-owned recipe output comparison without starting or saving anything.",
        arguments_model=RecordPresetQualityDecisionArguments,
        allowed_capabilities=frozenset({"recipe_builder"}),
        handler=record_recipe_quality_decision,
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
                "record_preset_quality_decision",
                "record_recipe_quality_decision",
                "analyze_preset_output",
                "analyze_recipe_output",
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
            result = definition.handler(
                parsed_arguments,
                replace(context, capability=capability),
            )
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
