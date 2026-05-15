from __future__ import annotations

import json
import time
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query
from starlette.responses import StreamingResponse

from .. import store
from .pricing import estimate_graph_workflow
from .registry import registry
from .runtime import runtime
from .schemas import (
    GraphArtifact,
    GraphArtifactsResponse,
    GraphEstimateResponse,
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
    workflow_json["workflow_id"] = record["workflow_id"]
    workflow_json["name"] = record.get("name") or workflow_json.get("name") or "Untitled Graph"
    workflow_json["description"] = record.get("description") if record.get("description") is not None else workflow_json.get("description")
    return GraphWorkflow(**workflow_json)


def _shape_run(record: dict) -> GraphRun:
    shaped = runtime._shape_run(record)
    artifacts_by_node: dict[str, list[GraphArtifact]] = {}
    for artifact in store.list_graph_artifacts_for_run(record["run_id"]):
        artifacts_by_node.setdefault(str(artifact["node_id"]), []).append(GraphArtifact(**artifact))
    for node in shaped.nodes:
        node.artifacts = artifacts_by_node.get(node.node_id, [])
    return shaped


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


@router.post("/estimate", response_model=GraphEstimateResponse)
def estimate_workflow(payload: GraphWorkflow) -> GraphEstimateResponse:
    return estimate_graph_workflow(payload)


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
    workflow = payload.model_copy(update={"workflow_id": workflow_id}) if payload else _workflow_from_record(record)
    return validate_workflow(workflow)


@router.post("/workflows/{workflow_id}/runs", response_model=GraphRun)
def create_run(workflow_id: str, payload: Optional[GraphRunCreateRequest] = None) -> GraphRun:
    record = store.get_graph_workflow(workflow_id)
    if not record:
        raise _not_found("workflow")
    workflow = payload.workflow.model_copy(update={"workflow_id": workflow_id}) if payload and payload.workflow else _workflow_from_record(record)
    try:
        return runtime.create_run(workflow_id, workflow, start=True)
    except ValueError as exc:
        raise _bad_request(str(exc))


@router.get("/workflows/{workflow_id}/runs", response_model=GraphRunListResponse)
def list_workflow_runs(workflow_id: str, limit: int = Query(default=50, ge=1, le=250)) -> GraphRunListResponse:
    if not store.get_graph_workflow(workflow_id):
        raise _not_found("workflow")
    return GraphRunListResponse(items=[_shape_run(item) for item in store.list_graph_runs_for_workflow(workflow_id, limit=limit)])


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


@router.get("/runs/{run_id}/artifacts", response_model=GraphArtifactsResponse)
def list_run_artifacts(run_id: str) -> GraphArtifactsResponse:
    if not store.get_graph_run(run_id):
        raise _not_found("graph run")
    return GraphArtifactsResponse(items=[GraphArtifact(**item) for item in store.list_graph_artifacts_for_run(run_id)])


@router.get("/runs/{run_id}/events/stream")
def stream_run_events(run_id: str, after_event_id: Optional[str] = Query(default=None)) -> StreamingResponse:
    if not store.get_graph_run(run_id):
        raise _not_found("graph run")

    def event_stream():
        last_event_id = after_event_id
        idle_ticks = 0
        while True:
            events = store.list_graph_run_events(run_id, after_event_id=last_event_id)
            if events:
                idle_ticks = 0
                for event in events:
                    last_event_id = event["event_id"]
                    yield (
                        f"id: {event['event_id']}\n"
                        f"event: {event['event_type']}\n"
                        f"data: {json.dumps(event, default=str)}\n\n"
                    )
            run = store.get_graph_run(run_id)
            if run and run.get("status") in {"completed", "failed", "cancelled"} and not events:
                break
            idle_ticks += 1
            if idle_ticks % 20 == 0:
                yield ": keepalive\n\n"
            time.sleep(0.5)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


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


@router.delete("/templates/{template_id}", response_model=GraphTemplateRecord)
def delete_template(template_id: str) -> GraphTemplateRecord:
    try:
        return GraphTemplateRecord(**store.archive_graph_template(template_id))
    except KeyError:
        raise _not_found("template")


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
