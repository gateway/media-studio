from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query

from .. import store
from .registry import registry
from .runtime import runtime
from .schemas import (
    GraphNodeDefinition,
    GraphNodeDefinitionsResponse,
    GraphRun,
    GraphRunCreateRequest,
    GraphRunEventsResponse,
    GraphRunListResponse,
    GraphTemplate,
    GraphTemplateListResponse,
    GraphTemplateRecord,
    GraphValidationResult,
    GraphWorkflow,
    GraphWorkflowListResponse,
    GraphWorkflowRecord,
)
from .validator import validate_workflow

router = APIRouter(prefix="/media/graph", tags=["media-graph"])


def _not_found(name: str) -> HTTPException:
    return HTTPException(status_code=404, detail=f"{name} not found")


def _bad_request(message: str) -> HTTPException:
    return HTTPException(status_code=400, detail=message)


def _workflow_from_record(record: dict) -> GraphWorkflow:
    workflow_json = dict(record.get("workflow_json") or {})
    workflow_json.setdefault("workflow_id", record["workflow_id"])
    workflow_json.setdefault("name", record.get("name") or "Untitled Graph")
    workflow_json.setdefault("description", record.get("description"))
    return GraphWorkflow(**workflow_json)


def _shape_run(record: dict) -> GraphRun:
    return GraphRun(
        **record,
        nodes=[item for item in (runtime._shape_run(record).nodes)],
    )


@router.get("/node-definitions", response_model=GraphNodeDefinitionsResponse)
def list_node_definitions() -> GraphNodeDefinitionsResponse:
    return GraphNodeDefinitionsResponse(items=registry.list_definitions())


@router.get("/node-definitions/{node_type:path}", response_model=GraphNodeDefinition)
def get_node_definition(node_type: str) -> GraphNodeDefinition:
    try:
        return registry.get_definition(node_type)
    except KeyError:
        raise _not_found("node definition")


@router.post("/node-definitions/refresh", response_model=GraphNodeDefinitionsResponse)
def refresh_node_definitions() -> GraphNodeDefinitionsResponse:
    return GraphNodeDefinitionsResponse(items=registry.list_definitions(refresh=True))


@router.get("/workflows", response_model=GraphWorkflowListResponse)
def list_workflows() -> GraphWorkflowListResponse:
    return GraphWorkflowListResponse(items=[GraphWorkflowRecord(**item) for item in store.list_graph_workflows()])


@router.post("/workflows", response_model=GraphWorkflowRecord)
def create_workflow(payload: GraphWorkflow) -> GraphWorkflowRecord:
    record = store.create_or_update_graph_workflow(
        {
            "workflow_id": payload.workflow_id,
            "name": payload.name,
            "description": payload.description,
            "schema_version": payload.schema_version,
            "workflow_json": payload.model_dump(mode="json"),
        }
    )
    return GraphWorkflowRecord(**record)


@router.get("/workflows/{workflow_id}", response_model=GraphWorkflowRecord)
def get_workflow(workflow_id: str) -> GraphWorkflowRecord:
    record = store.get_graph_workflow(workflow_id)
    if not record:
        raise _not_found("workflow")
    return GraphWorkflowRecord(**record)


@router.patch("/workflows/{workflow_id}", response_model=GraphWorkflowRecord)
def update_workflow(workflow_id: str, payload: GraphWorkflow) -> GraphWorkflowRecord:
    current = store.get_graph_workflow(workflow_id)
    if not current:
        raise _not_found("workflow")
    record = store.create_or_update_graph_workflow(
        {
            **current,
            "name": payload.name,
            "description": payload.description,
            "schema_version": payload.schema_version,
            "workflow_json": payload.model_dump(mode="json"),
        }
    )
    return GraphWorkflowRecord(**record)


@router.delete("/workflows/{workflow_id}", response_model=GraphWorkflowRecord)
def delete_workflow(workflow_id: str) -> GraphWorkflowRecord:
    try:
        return GraphWorkflowRecord(**store.archive_graph_workflow(workflow_id))
    except KeyError:
        raise _not_found("workflow")


@router.post("/workflows/{workflow_id}/validate", response_model=GraphValidationResult)
def validate_saved_workflow(workflow_id: str, payload: Optional[GraphWorkflow] = None) -> GraphValidationResult:
    record = store.get_graph_workflow(workflow_id)
    if not record:
        raise _not_found("workflow")
    return validate_workflow(payload or _workflow_from_record(record))


@router.post("/workflows/{workflow_id}/runs", response_model=GraphRun)
def create_run(workflow_id: str, payload: Optional[GraphRunCreateRequest] = None) -> GraphRun:
    record = store.get_graph_workflow(workflow_id)
    if not record:
        raise _not_found("workflow")
    workflow = payload.workflow if payload and payload.workflow else _workflow_from_record(record)
    try:
        return runtime.create_run(workflow_id, workflow, start=True)
    except ValueError as exc:
        raise _bad_request(str(exc))


@router.get("/runs", response_model=GraphRunListResponse)
def list_runs(limit: int = Query(default=100, ge=1, le=500)) -> GraphRunListResponse:
    return GraphRunListResponse(items=[_shape_run(item) for item in store.list_graph_runs(limit=limit)])


@router.get("/runs/{run_id}", response_model=GraphRun)
def get_run(run_id: str) -> GraphRun:
    record = store.get_graph_run(run_id)
    if not record:
        raise _not_found("graph run")
    return _shape_run(record)


@router.get("/runs/{run_id}/events", response_model=GraphRunEventsResponse)
def list_run_events(run_id: str, after_event_id: Optional[str] = Query(default=None)) -> GraphRunEventsResponse:
    if not store.get_graph_run(run_id):
        raise _not_found("graph run")
    return GraphRunEventsResponse(items=store.list_graph_run_events(run_id, after_event_id=after_event_id))


@router.post("/runs/{run_id}/cancel", response_model=GraphRun)
def cancel_run(run_id: str) -> GraphRun:
    if not store.get_graph_run(run_id):
        raise _not_found("graph run")
    return runtime.cancel_run(run_id)


@router.get("/templates", response_model=GraphTemplateListResponse)
def list_templates() -> GraphTemplateListResponse:
    return GraphTemplateListResponse(items=[GraphTemplateRecord(**item) for item in store.list_graph_templates()])


@router.post("/templates", response_model=GraphTemplateRecord)
def create_template(payload: GraphTemplate) -> GraphTemplateRecord:
    record = store.create_or_update_graph_template(
        {
            "template_id": payload.template_id,
            "name": payload.name,
            "description": payload.description,
            "tags_json": payload.tags,
            "thumbnail_path": payload.thumbnail_path,
            "workflow_json": payload.workflow_json,
        }
    )
    return GraphTemplateRecord(**record)


@router.post("/templates/{template_id}/instantiate", response_model=GraphWorkflowRecord)
def instantiate_template(template_id: str) -> GraphWorkflowRecord:
    template = store.get_graph_template(template_id)
    if not template:
        raise _not_found("template")
    workflow = dict(template.get("workflow_json") or {})
    workflow.pop("workflow_id", None)
    workflow.setdefault("name", template.get("name") or "Template Workflow")
    record = store.create_or_update_graph_workflow(
        {
            "name": workflow.get("name") or template.get("name") or "Template Workflow",
            "description": template.get("description"),
            "workflow_json": workflow,
        }
    )
    return GraphWorkflowRecord(**record)
