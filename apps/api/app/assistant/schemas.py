from __future__ import annotations

import json
from typing import Annotated, Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, field_validator

from ..graph.schemas import GraphEstimateResponse, GraphValidationResult, GraphWorkflow
from ..schemas import PresetUpsertRequest, PromptRecipeUpsertRequest
from .production_plan import ProductionPlan


AssistantOwnerKind = Literal["graph_workflow", "studio_project", "media_preset", "prompt_recipe", "standalone"]
AssistantRole = Literal["user", "assistant", "system_summary", "tool"]
AssistantSessionStatus = Literal["active", "thinking", "plan_ready", "applying", "failed", "archived"]
AssistantPlanStatus = Literal["draft", "validated", "applied", "rejected", "failed"]
AssistantKernelCapability = Literal[
    "general",
    "graph_builder",
    "preset_builder",
    "recipe_builder",
    "story_builder",
    "run_debugger",
]
AssistantArtifactIntent = Literal[
    "none",
    "draft_preset",
    "revise_preset",
    "save_preset",
    "draft_recipe",
    "revise_recipe",
    "save_recipe",
    "update_story",
    "propose_production_plan",
    "diagnose_run",
]
AssistantGuidanceEvidence = Literal[
    "user_request",
    "session_state",
    "workflow_context",
    "tool_result",
]
AssistantSatisfactionState = Literal["unknown", "needs_work", "satisfied"]
AssistantNextActionKind = Literal[
    "none",
    "confirm_graph",
    "save_media_preset",
    "save_prompt_recipe",
    "apply_repair",
    "run_workflow",
]
AssistantCapability = Literal[
    "answer_question",
    "plan_graph",
    "draft_prompt_recipe",
    "draft_media_preset",
    "save_prompt_recipe",
    "save_media_preset",
    "inspect_media",
    "repair_graph",
]
AssistantVisualAnalysisGoal = Literal[
    "style_reference",
    "preset_design",
    "recipe_context",
    "story_continuity",
    "output_critique",
]
AssistantVisualTrait = Annotated[str, Field(min_length=1, max_length=300)]
MediaPresetBuilderLane = Literal["text_to_image", "image_to_image", "both", "undecided"]
MediaPresetBuilderState = Literal[
    "intake",
    "reference_analysis",
    "contract_proposal",
    "user_clarification",
    "sandbox_plan",
    "prompt_quality_gate",
    "sandbox_run",
    "output_comparison",
    "prompt_refinement",
    "approved_save",
    "saved_preset_verification",
    "signoff",
]
MediaPresetBuilderOperationName = Literal[
    "ask_clarifying_question",
    "create_test_workflow",
    "update_test_prompt",
    "run_workflow",
    "compare_output",
    "save_media_preset",
    "test_saved_preset",
]


class MediaPresetBuilderSkillInput(BaseModel):
    """Typed runtime contract for one Media Preset Builder skill turn."""

    user_message: str
    assistant_mode: Optional[str] = None
    workflow_tab_id: Optional[str] = None
    current_state: MediaPresetBuilderState = "intake"
    requested_lane: MediaPresetBuilderLane = "undecided"
    attachment_set_hash: str = ""
    reference_ids: List[str] = Field(default_factory=list)
    latest_run_id: Optional[str] = None
    latest_output_asset_id: Optional[str] = None
    approved_fields: List[Dict[str, Any]] = Field(default_factory=list)
    approved_image_slots: List[Dict[str, Any]] = Field(default_factory=list)
    force_fresh_analysis: bool = False


class MediaPresetBuilderOperation(BaseModel):
    name: MediaPresetBuilderOperationName
    payload: Dict[str, Any] = Field(default_factory=dict)
    requires_confirmation: bool = True


class MediaPresetBuilderSkillOutput(BaseModel):
    """Validated output envelope from the Media Preset Builder skill."""

    next_state: MediaPresetBuilderState
    user_reply: str
    operations: List[MediaPresetBuilderOperation] = Field(default_factory=list)
    reference_style_brief: Optional[Dict[str, Any]] = None
    approved_fields: List[Dict[str, Any]] = Field(default_factory=list)
    approved_image_slots: List[Dict[str, Any]] = Field(default_factory=list)
    compiled_prompt: Optional[str] = None
    prompt_quality_score: Optional[int] = None
    prompt_quality_issues: List[str] = Field(default_factory=list)
    output_check: Optional[Dict[str, Any]] = None
    saved_preset_ids: List[str] = Field(default_factory=list)
    provider_called: bool = False
    cache_decision: str = "none"


class AssistantSessionCreateRequest(BaseModel):
    owner_kind: AssistantOwnerKind = "standalone"
    owner_id: Optional[str] = None
    workflow: Optional[GraphWorkflow] = None
    canvas_context: Dict[str, Any] = Field(default_factory=dict)
    assistant_mode: Optional[str] = None
    provider_kind: Optional[str] = None
    provider_model_id: Optional[str] = None
    title: Optional[str] = None


class AssistantMessageCreateRequest(BaseModel):
    content_text: str
    workflow: Optional[GraphWorkflow] = None
    canvas_context: Dict[str, Any] = Field(default_factory=dict)
    attachment_ids: List[str] = Field(default_factory=list)
    run_id: Optional[str] = None
    assistant_mode: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class AssistantNextAction(BaseModel):
    kind: AssistantNextActionKind = "none"
    label: Optional[str] = None
    proposal_id: Optional[str] = None
    confirmation_token: Optional[str] = None
    requires_confirmation: bool = False
    payload: Optional[Dict[str, Any]] = None
    price_estimate: Optional[Dict[str, Any]] = None


class AssistantKernelToolCallRequest(BaseModel):
    name: str
    arguments: str = "{}"

    @field_validator("arguments", mode="before")
    @classmethod
    def encode_tool_arguments(cls, value: Any) -> str:
        if value is None:
            return "{}"
        if isinstance(value, dict):
            return json.dumps(value, separators=(",", ":"))
        if isinstance(value, str):
            return value
        raise ValueError("Tool arguments must be a JSON object encoded as a string.")


class AssistantKernelGuidance(BaseModel):
    suggestion_count: int = Field(
        default=0,
        ge=0,
        le=2,
        description="Number of distinct recommendations in the user-facing reply.",
    )
    evidence_sources: List[AssistantGuidanceEvidence] = Field(
        default_factory=list,
        max_length=4,
        description="Available typed sources actually used to support recommendations.",
    )
    satisfaction_state: AssistantSatisfactionState = Field(
        default="unknown",
        description="Whether the user said the current result meets their goal.",
    )


class AssistantKernelProviderStep(BaseModel):
    capability: AssistantKernelCapability
    artifact_intent: AssistantArtifactIntent = "none"
    reply: Optional[str] = Field(
        default=None,
        description=(
            "Natural user-facing response. Include it with a terminal tool call so a validated "
            "artifact can finish the turn without another provider step."
        ),
    )
    tool_call: Optional[AssistantKernelToolCallRequest] = None
    requested_action: AssistantNextAction = Field(default_factory=AssistantNextAction)
    guidance: AssistantKernelGuidance = Field(default_factory=AssistantKernelGuidance)


class AssistantKernelToolError(BaseModel):
    code: str
    message: str
    retryable: bool = False
    details: Dict[str, Any] = Field(default_factory=dict)


class AssistantKernelActivity(BaseModel):
    kind: str
    label: str
    tone: Literal["success", "error"] = "success"


class AssistantKernelToolTrace(BaseModel):
    tool_name: str
    arguments_hash: str
    duration_ms: int
    result_size_bytes: int
    cache_status: Optional[Literal["hit", "miss"]] = None
    evidence: Optional[Dict[str, Any]] = None
    error: Optional[AssistantKernelToolError] = None
    activity: Optional[AssistantKernelActivity] = None


class AssistantVoiceViolation(BaseModel):
    code: Literal["banned_vocabulary", "reply_too_long"]
    terms: List[str] = Field(default_factory=list)
    word_count: Optional[int] = None


class AssistantKernelProviderTrace(BaseModel):
    provider_thread_id: Optional[str] = None
    provider_turn_id: Optional[str] = None
    process_lifecycle: Optional[Literal["process_spawned", "process_reused"]] = None
    reuse_mode: Optional[Literal["new_thread", "live_process", "disk_resume", "replacement_thread"]] = None
    usage: Dict[str, Any] = Field(default_factory=dict)
    latency_ms: int = 0
    prompt_bytes: int = 0
    reasoning_effort: Optional[str] = None
    client_user_message_id: Optional[str] = None
    compaction: Optional[Dict[str, Any]] = None


class AssistantKernelTrace(BaseModel):
    capability: AssistantKernelCapability
    loaded_prompt_assets: List[str] = Field(default_factory=list)
    provider_lifecycle: List[str] = Field(default_factory=list)
    provider_steps: List[AssistantKernelProviderTrace] = Field(default_factory=list)
    tool_calls: List[AssistantKernelToolTrace] = Field(default_factory=list)
    step_count: int = 0
    duration_ms: int = 0
    termination: str = "completed"
    voice_violations: List[AssistantVoiceViolation] = Field(default_factory=list)
    guidance: AssistantKernelGuidance = Field(default_factory=AssistantKernelGuidance)


class AssistantKernelArtifact(BaseModel):
    kind: str
    data: Dict[str, Any] = Field(default_factory=dict)


class AssistantKernelTurnResult(BaseModel):
    reply: str
    capability: AssistantKernelCapability
    trace: AssistantKernelTrace
    artifacts: List[AssistantKernelArtifact] = Field(default_factory=list)
    next_action: AssistantNextAction = Field(default_factory=AssistantNextAction)


class AssistantVisualAnalysis(BaseModel):
    medium: List[AssistantVisualTrait] = Field(default_factory=list, max_length=12)
    palette: List[AssistantVisualTrait] = Field(default_factory=list, max_length=12)
    composition: List[AssistantVisualTrait] = Field(default_factory=list, max_length=12)
    subject_treatment: List[AssistantVisualTrait] = Field(default_factory=list, max_length=12)
    environment: List[AssistantVisualTrait] = Field(default_factory=list, max_length=12)
    texture: List[AssistantVisualTrait] = Field(default_factory=list, max_length=12)
    lighting: List[AssistantVisualTrait] = Field(default_factory=list, max_length=12)
    typography: List[AssistantVisualTrait] = Field(default_factory=list, max_length=12)
    mood: List[AssistantVisualTrait] = Field(default_factory=list, max_length=12)
    fixed_traits: List[AssistantVisualTrait] = Field(default_factory=list, max_length=12)
    replaceable_elements: List[AssistantVisualTrait] = Field(default_factory=list, max_length=12)
    exclusions: List[AssistantVisualTrait] = Field(default_factory=list, max_length=12)


class AssistantAttachmentCreateRequest(BaseModel):
    reference_id: str
    label: Optional[str] = None


class AssistantPlanCreateRequest(BaseModel):
    message: Optional[str] = None
    workflow: GraphWorkflow
    canvas_context: Dict[str, Any] = Field(default_factory=dict)
    capability: AssistantCapability = "plan_graph"
    run_id: Optional[str] = None
    assistant_mode: Optional[str] = None


class AssistantPlanApplyRequest(BaseModel):
    workflow: GraphWorkflow
    proposal_id: Optional[str] = None
    confirmation_token: Optional[str] = None


class AssistantRunConfirmationRequest(BaseModel):
    workflow: GraphWorkflow
    confirmation_token: str = Field(min_length=1)


class AssistantDraftCreateRequest(BaseModel):
    message: str
    workflow: Optional[GraphWorkflow] = None
    run_id: Optional[str] = None
    assistant_mode: Optional[str] = None


class AssistantPromptRecipeSaveRequest(AssistantDraftCreateRequest):
    draft: Optional[PromptRecipeUpsertRequest] = None
    proposal_id: Optional[str] = None
    confirmation_token: Optional[str] = None


class AssistantMediaPresetSaveRequest(AssistantDraftCreateRequest):
    draft: Optional[PresetUpsertRequest] = None
    proposal_id: Optional[str] = None
    confirmation_token: Optional[str] = None


class AssistantRepairCreateRequest(BaseModel):
    run_id: str
    workflow: GraphWorkflow


class AssistantMessage(BaseModel):
    assistant_message_id: str
    assistant_session_id: str
    role: AssistantRole
    content_text: str = ""
    content_json: Dict[str, Any] = Field(default_factory=dict)
    created_at: Optional[str] = None


class AssistantAttachment(BaseModel):
    assistant_attachment_id: str
    assistant_session_id: str
    reference_id: str
    kind: str = "image"
    label: Optional[str] = None
    metadata_json: Dict[str, Any] = Field(default_factory=dict)
    created_at: Optional[str] = None


class AssistantSession(BaseModel):
    assistant_session_id: str
    owner_kind: AssistantOwnerKind = "standalone"
    owner_id: Optional[str] = None
    provider_kind: str = "codex_local"
    provider_model_id: Optional[str] = None
    provider_thread_id: Optional[str] = None
    status: AssistantSessionStatus = "active"
    title: Optional[str] = None
    summary_json: Dict[str, Any] = Field(default_factory=dict)
    state_snapshot_json: Dict[str, Any] = Field(default_factory=dict)
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    messages: List[AssistantMessage] = Field(default_factory=list)
    attachments: List[AssistantAttachment] = Field(default_factory=list)
    latest_plan: Optional[Dict[str, Any]] = None
    production_plan: Optional[ProductionPlan] = None


class AssistantSessionListResponse(BaseModel):
    items: List[AssistantSession] = Field(default_factory=list)


class AssistantGraphOperation(BaseModel):
    op: Literal[
        "add_node",
        "set_node_field",
        "set_node_title",
        "add_note",
        "connect_nodes",
        "group_nodes",
    ]
    node_ref: Optional[str] = None
    node_type: Optional[str] = None
    node_id: Optional[str] = None
    title: Optional[str] = None
    position: Dict[str, float] = Field(default_factory=dict)
    fields: Dict[str, Any] = Field(default_factory=dict)
    source_ref: Optional[str] = None
    source_port: Optional[str] = None
    target_ref: Optional[str] = None
    target_port: Optional[str] = None
    group_ref: Optional[str] = None
    node_refs: List[str] = Field(default_factory=list)
    color: Optional[str] = None
    body: Optional[str] = None


class AssistantGraphPlan(BaseModel):
    capability: AssistantCapability = "plan_graph"
    summary: str
    questions: List[str] = Field(default_factory=list)
    operations: List[AssistantGraphOperation] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
    requires_confirmation: bool = True
    metadata: Dict[str, Any] = Field(default_factory=dict)


class AssistantPlan(BaseModel):
    assistant_plan_id: str
    assistant_session_id: str
    status: AssistantPlanStatus = "draft"
    capability: AssistantCapability = "plan_graph"
    plan_json: Dict[str, Any] = Field(default_factory=dict)
    validation_json: Dict[str, Any] = Field(default_factory=dict)
    pricing_json: Dict[str, Any] = Field(default_factory=dict)
    applied_workflow_id: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    workflow_json: Optional[Dict[str, Any]] = None


class AssistantPlanResponse(BaseModel):
    plan: AssistantPlan
    graph_plan: AssistantGraphPlan
    workflow: GraphWorkflow
    validation: GraphValidationResult
    pricing: GraphEstimateResponse


class AssistantPlanApplyResponse(BaseModel):
    plan: AssistantPlan
    workflow: GraphWorkflow
    validation: GraphValidationResult
    pricing: GraphEstimateResponse


class AssistantPromptRecipeDraftResponse(BaseModel):
    capability: AssistantCapability = "draft_prompt_recipe"
    draft: PromptRecipeUpsertRequest
    validation_warnings: List[str] = Field(default_factory=list)
    review_url: str
    media_summary: List[Dict[str, Any]] = Field(default_factory=list)


class AssistantMediaPresetDraftResponse(BaseModel):
    capability: AssistantCapability = "draft_media_preset"
    draft: PresetUpsertRequest
    validation_warnings: List[str] = Field(default_factory=list)
    review_url: str
    media_summary: List[Dict[str, Any]] = Field(default_factory=list)


class AssistantArtifactSaveResponse(BaseModel):
    capability: AssistantCapability
    artifact_kind: Literal["media_preset", "prompt_recipe"]
    created: bool = True
    record: Dict[str, Any]
    message: str
    assistant_session: AssistantSession


class AssistantMediaInspectionResponse(BaseModel):
    capability: AssistantCapability = "inspect_media"
    attachment_counts: Dict[str, int] = Field(default_factory=dict)
    media_summary: List[Dict[str, Any]] = Field(default_factory=list)


class AssistantRepairResponse(BaseModel):
    capability: AssistantCapability = "repair_graph"
    run_id: str
    status: str
    summary: str
    failed_nodes: List[Dict[str, Any]] = Field(default_factory=list)
    graph_plan: AssistantGraphPlan
    workflow: GraphWorkflow
    validation: GraphValidationResult
    pricing: GraphEstimateResponse
