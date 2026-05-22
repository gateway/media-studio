from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class GraphNodePort(BaseModel):
    id: str
    label: str
    type: str
    array: bool = False
    min: int = 0
    max: Optional[int] = None
    required: bool = False
    accepts: List[str] = Field(default_factory=list)
    description: Optional[str] = None
    advanced: bool = False
    visible_if: Optional[Dict[str, Any]] = None


class GraphNodeField(BaseModel):
    id: str
    label: str
    type: str
    required: bool = False
    default: Any = None
    placeholder: Optional[str] = None
    options: List[Any] = Field(default_factory=list)
    min: Optional[float] = None
    max: Optional[float] = None
    help_text: Optional[str] = None
    advanced: bool = False
    hidden: bool = False
    connectable: bool = False
    port_type: Optional[str] = None
    visible_if: Optional[Dict[str, Any]] = None


class GraphNodeDefinition(BaseModel):
    schema_version: int = 1
    type: str
    title: str
    description: Optional[str] = None
    help_text: Optional[str] = None
    category: str
    search_aliases: List[str] = Field(default_factory=list)
    tags: List[str] = Field(default_factory=list)
    source: Dict[str, Any] = Field(default_factory=dict)
    execution: Dict[str, Any] = Field(default_factory=dict)
    limits: Dict[str, Any] = Field(default_factory=dict)
    ui: Dict[str, Any] = Field(default_factory=dict)
    ports: Dict[str, List[GraphNodePort]] = Field(default_factory=lambda: {"inputs": [], "outputs": []})
    fields: List[GraphNodeField] = Field(default_factory=list)


class GraphWorkflowNode(BaseModel):
    id: str
    type: str
    position: Dict[str, float] = Field(default_factory=lambda: {"x": 0, "y": 0})
    fields: Dict[str, Any] = Field(default_factory=dict)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class GraphWorkflowEdge(BaseModel):
    id: str
    source: str
    source_port: str
    target: str
    target_port: str
    metadata: Dict[str, Any] = Field(default_factory=dict)


class GraphWorkflow(BaseModel):
    schema_version: int = 1
    workflow_id: Optional[str] = None
    name: str = "Untitled Graph"
    description: Optional[str] = None
    nodes: List[GraphWorkflowNode] = Field(default_factory=list)
    edges: List[GraphWorkflowEdge] = Field(default_factory=list)
    viewport: Dict[str, Any] = Field(default_factory=dict)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class GraphWorkflowRecord(BaseModel):
    workflow_id: str
    name: str
    description: Optional[str] = None
    status: str = "active"
    schema_version: int = 1
    workflow_json: Dict[str, Any] = Field(default_factory=dict)
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class GraphTemplate(BaseModel):
    template_id: Optional[str] = None
    name: str
    description: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    thumbnail_path: Optional[str] = None
    workflow_json: Dict[str, Any] = Field(default_factory=dict)


class GraphTemplateRecord(GraphTemplate):
    template_id: str
    status: str = "active"
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class GraphOutputRef(BaseModel):
    kind: Literal["asset", "reference_media", "job", "value"]
    media_type: Optional[str] = None
    asset_id: Optional[str] = None
    reference_id: Optional[str] = None
    job_id: Optional[str] = None
    value: Any = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class GraphArtifact(BaseModel):
    artifact_id: str
    workflow_id: str
    run_id: str
    node_id: str
    node_type: str
    output_port: str
    output_index: int = 0
    kind: str
    media_type: Optional[str] = None
    asset_id: Optional[str] = None
    reference_id: Optional[str] = None
    job_id: Optional[str] = None
    value_json: Dict[str, Any] = Field(default_factory=dict)
    parent_artifact_id: Optional[str] = None
    parent_asset_id: Optional[str] = None
    parent_reference_id: Optional[str] = None
    transform_type: Optional[str] = None
    transform_params_json: Dict[str, Any] = Field(default_factory=dict)
    metadata_json: Dict[str, Any] = Field(default_factory=dict)
    created_at: Optional[str] = None


class GraphError(BaseModel):
    code: str
    message: str
    node_id: Optional[str] = None
    edge_id: Optional[str] = None
    field_id: Optional[str] = None
    port_id: Optional[str] = None


class GraphValidationResult(BaseModel):
    valid: bool
    errors: List[GraphError] = Field(default_factory=list)
    warnings: List[GraphError] = Field(default_factory=list)


class GraphEstimateNode(BaseModel):
    node_id: str
    node_type: str
    model_key: Optional[str] = None
    task_mode: Optional[str] = None
    output_count: int = 1
    pricing_summary: Dict[str, Any] = Field(default_factory=dict)
    assumptions: List[str] = Field(default_factory=list)
    warnings: List[GraphError] = Field(default_factory=list)


class GraphEstimateResponse(BaseModel):
    pricing_summary: Dict[str, Any] = Field(default_factory=dict)
    nodes: Dict[str, GraphEstimateNode] = Field(default_factory=dict)
    warnings: List[GraphError] = Field(default_factory=list)


class GraphCompiledNode(BaseModel):
    node_id: str
    node_type: str
    depends_on: List[str] = Field(default_factory=list)
    input_edges: Dict[str, List[str]] = Field(default_factory=dict)
    fields: Dict[str, Any] = Field(default_factory=dict)


class GraphCompiledGraph(BaseModel):
    schema_version: int = 1
    execution_order: List[str] = Field(default_factory=list)
    nodes: Dict[str, GraphCompiledNode] = Field(default_factory=dict)
    output_node_ids: List[str] = Field(default_factory=list)
    node_definitions: Dict[str, GraphNodeDefinition] = Field(default_factory=dict)
    warnings: List[GraphError] = Field(default_factory=list)


class GraphRun(BaseModel):
    run_id: str
    workflow_id: str
    status: str = "queued"
    schema_version: int = 1
    workflow_json: Dict[str, Any] = Field(default_factory=dict)
    compiled_graph_json: Dict[str, Any] = Field(default_factory=dict)
    output_snapshot_json: Dict[str, Any] = Field(default_factory=dict)
    metrics_json: Dict[str, Any] = Field(default_factory=dict)
    error: Optional[str] = None
    nodes: List["GraphRunNode"] = Field(default_factory=list)
    created_at: Optional[str] = None
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    updated_at: Optional[str] = None


class GraphRunNode(BaseModel):
    run_node_id: str
    run_id: str
    node_id: str
    node_type: str
    status: str = "queued"
    progress: Optional[float] = None
    input_snapshot_json: Dict[str, Any] = Field(default_factory=dict)
    output_snapshot_json: Dict[str, Any] = Field(default_factory=dict)
    artifacts: List[GraphArtifact] = Field(default_factory=list)
    metrics_json: Dict[str, Any] = Field(default_factory=dict)
    error: Optional[str] = None
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    updated_at: Optional[str] = None


class GraphRunStatusNode(BaseModel):
    run_node_id: str
    run_id: str
    node_id: str
    node_type: str
    status: str = "queued"
    progress: Optional[float] = None
    has_output_snapshot: bool = False
    error: Optional[str] = None
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    updated_at: Optional[str] = None


class GraphRunEvent(BaseModel):
    event_id: str
    run_id: str
    node_id: Optional[str] = None
    event_type: str
    payload_json: Dict[str, Any] = Field(default_factory=dict)
    created_at: Optional[str] = None


class GraphRunCreateRequest(BaseModel):
    workflow: Optional[GraphWorkflow] = None


class GraphNodeDefinitionsResponse(BaseModel):
    items: List[GraphNodeDefinition] = Field(default_factory=list)


class GraphWorkflowListResponse(BaseModel):
    items: List[GraphWorkflowRecord] = Field(default_factory=list)


class GraphRunListResponse(BaseModel):
    items: List[GraphRun] = Field(default_factory=list)


class GraphRunEventsResponse(BaseModel):
    items: List[GraphRunEvent] = Field(default_factory=list)


class GraphRunStatusResponse(BaseModel):
    run_id: str
    workflow_id: str
    status: str = "queued"
    error: Optional[str] = None
    latest_event_id: Optional[str] = None
    created_at: Optional[str] = None
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    updated_at: Optional[str] = None
    nodes: List[GraphRunStatusNode] = Field(default_factory=list)


class GraphArtifactsResponse(BaseModel):
    items: List[GraphArtifact] = Field(default_factory=list)


class GraphTemplateListResponse(BaseModel):
    items: List[GraphTemplateRecord] = Field(default_factory=list)


GraphRun.model_rebuild()
