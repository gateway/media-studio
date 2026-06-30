import type { AssistantSession } from "../types";

export type AssistantMode = "preset" | "recipe" | "graph";
export type AssistantResponseKind = "answer" | "ask" | "create_local" | "confirm_paid_or_mutating";
export type CreativeAssistantAutoAction =
  | "chat"
  | "run_workflow"
  | "save_media_preset"
  | "save_prompt_recipe"
  | "create_prompt_recipe_draft"
  | "create_media_preset_draft"
  | "create_and_apply_graph_plan"
  | "create_graph_plan";

function normalizedAssistantContent(content: string) {
  return content.trim().toLowerCase().replace(/\s+/g, " ");
}

function hasAssistantRunNegation(content: string) {
  const normalized = normalizedAssistantContent(content);
  if (!normalized) return false;
  return (
    /\b(?:do not|don't|dont|no|without)\b.{0,80}\b(?:run|running|test|testing|execute|executing|submit|submitting|generate|generating)\b/.test(normalized) ||
    /\b(?:run|test|execute|submit|generate)\b.{0,40}\b(?:not|later|after|yet)\b/.test(normalized)
  );
}

function isAssistantRunRequest(content: string) {
  const normalized = normalizedAssistantContent(content);
  if (!normalized || hasAssistantRunNegation(content)) return false;
  return (
    normalized === "test it" ||
    normalized === "run it" ||
    normalized === "okay run it" ||
    normalized === "ok run it" ||
    normalized === "yes run it" ||
    normalized === "try it" ||
    normalized === "test this" ||
    normalized === "run this" ||
    normalized === "try this" ||
    normalized === "execute it" ||
    normalized === "execute this" ||
    normalized === "generate it" ||
    normalized === "generate this" ||
    normalized === "run the workflow" ||
    normalized === "run the graph" ||
    normalized === "run current workflow" ||
    normalized === "run current graph" ||
    normalized === "run the current workflow" ||
    normalized === "run the current graph" ||
    normalized === "execute the workflow" ||
    normalized === "execute the graph" ||
    normalized.startsWith("test it ") ||
    normalized.startsWith("run it ") ||
    normalized.startsWith("okay run it ") ||
    normalized.startsWith("ok run it ") ||
    normalized.startsWith("yes run it ") ||
    normalized.startsWith("run this ") ||
    normalized.startsWith("execute this ") ||
    /\b(?:run|execute)\b.{0,40}\b(?:current\s+)?(?:graph|workflow)\b/.test(normalized)
  );
}

function hasExplicitPaidRunApproval(content: string) {
  const normalized = normalizedAssistantContent(content);
  if (!normalized || !isAssistantRunRequest(content)) return false;
  const hasApproval = /\b(?:approve|approved|approval|permission|authorized|authorised)\b/.test(normalized);
  const hasPaidOrProvider = /\b(?:paid|provider|spend|credits?|cost|charge|billing|bill|live|real)\b/.test(normalized);
  return hasApproval && hasPaidOrProvider;
}

function hasGraphCreationNegation(content: string) {
  const normalized = content.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return false;
  const hasLocalCreateNegation =
    /\b(?:do not|don't|dont)\b.{0,100}\b(?:create|creating|build|building|make|making|add|adding|apply|applying|prepare|preparing|start|starting|generate|generating)\b.{0,100}\b(?:graph|workflow|canvas|node|nodes|anything|any thing)\b/.test(
      normalized,
    ) ||
    /\b(?:without)\b.{0,100}\b(?:creating|building|making|adding|applying|preparing|starting|generating)\b.{0,100}\b(?:graph|workflow|canvas|node|nodes|anything|any thing)\b/.test(
      normalized,
    );
  return (
    hasLocalCreateNegation ||
    /\b(?:do not|don't|dont)\s+(?:build|create|make|prepare|start|generate)\s+(?:a\s+)?(?:graph|workflow)\b/.test(normalized) ||
    /\b(?:without)\s+(?:building|creating|making|preparing|starting|generating)\s+(?:a\s+)?(?:graph|workflow)\b/.test(normalized) ||
    normalized.includes("chat text only")
  );
}

function isPromptOnlyGraphRequest(content: string) {
  const normalized = content.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return false;
  if (isSelectedNodeEditRequest(content)) return false;
  return (
    /\b(?:show|share|give|list|print|recall)\b.{0,80}\b(?:prompt|prompts)\b/.test(normalized) ||
    /\b(?:rewrite|revise|change|adjust)\b.{0,40}\b(?:prompt|shot|scene)\b/.test(normalized) ||
    normalized.includes("text only") ||
    normalized.includes("chat only") ||
    normalized.includes("prompt only")
  );
}

function isSelectedNodeEditRequest(content: string) {
  const normalized = content.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return false;
  const hasSelectedNodeTarget =
    /\b(?:selected|current|this)\s+node\b/.test(normalized) ||
    /\b(?:selected|current)\b.{0,80}\b(?:prompt|user prompt|text|title|field|node)\b/.test(normalized);
  if (!hasSelectedNodeTarget) return false;
  return /\b(?:update|change|replace|set|rename|title|call|adjust|make|turn)\b/.test(normalized);
}

function asksForReviewBeforeGraphChange(content: string) {
  const normalized = content.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return false;
  return (
    normalized.includes("reviewable") ||
    normalized.includes("review first") ||
    normalized.includes("let me review") ||
    normalized.includes("before applying") ||
    /\b(?:do not|don't|dont)\s+apply\b/.test(normalized)
  );
}

function isAssistantDirectGraphApplyRequest(content: string, suggestedAction: string | null) {
  const normalized = content.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return false;
  const selectedNodeEdit = isSelectedNodeEditRequest(content);
  if ((!selectedNodeEdit && hasGraphCreationNegation(content)) || isPromptOnlyGraphRequest(content) || asksForReviewBeforeGraphChange(content)) return false;
  const hasAction =
    /\b(?:create|build|make|add|put|apply|prepare|setup|set up|turn|wire|generate|update|change|replace|set|rename|adjust)\b/.test(normalized) ||
    /\b(?:do|create|build|make)\s+(?:it|this|that)\b/.test(normalized);
  if (!hasAction) return false;
  const hasExplicitGraphTarget = /\b(?:graph|workflow|canvas|node|nodes|seed dance|seedance)\b/.test(normalized);
  if (selectedNodeEdit && hasExplicitGraphTarget) return true;
  const asksForImmediateCanvasChange =
    /\b(?:add|put|apply|wire)\b.{0,80}\b(?:graph|workflow|canvas|node|nodes)\b/.test(normalized) ||
    /\b(?:graph|workflow|node|nodes)\b.{0,80}\b(?:on|onto|to)\s+(?:the\s+)?canvas\b/.test(normalized);
  const hasContextualGraphTarget =
    suggestedAction === "create_graph_plan" && /\b(?:it|this|that|story|storyboard|segment|shot|scene|workflow|graph)\b/.test(normalized);
  return asksForImmediateCanvasChange || hasExplicitGraphTarget || hasContextualGraphTarget;
}

export function sessionHasImageAttachment(session: AssistantSession | null) {
  return Boolean(
    session?.attachments?.some((attachment) => attachment.kind === "reference_image" || attachment.kind === "image"),
  );
}

export function sessionHasOutputComparisonForRun(session: AssistantSession | null, runId: string | null | undefined) {
  if (!session || !runId) return false;
  return session.messages.some((message) => message.content_json?.output_aware === true && message.content_json?.latest_run_id === runId);
}

function isAssistantTestWorkflowCreationRequest(content: string) {
  const normalized = content.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return false;
  if (
    /\b(?:ask|question|confirm|confirmation|suggest|guide)\b.{0,100}\bbefore\b.{0,100}\b(?:create|creating|build|building|make|making|prepare|preparing)\b.{0,100}\b(?:test graph|test workflow|sandbox|workflow)\b/.test(
      normalized,
    )
  ) {
    return false;
  }
  if (
    normalized.includes("preset") &&
    (["approved sandbox", "sandbox result", "approved result"].some((term) => normalized.includes(term)) ||
      /\bapproved\b.{0,50}\bsandbox\b/.test(normalized) ||
      /\bapproved\b.{0,50}\btest workflow\b/.test(normalized) ||
      /\bfrom\b.{0,40}\b(this|the)\b.{0,20}\bsandbox\b/.test(normalized) ||
      /\b(this|the)\b.{0,30}\btest workflow\b.{0,60}\bas\b.{0,20}\bpreset\b/.test(normalized)) &&
    ["create", "save", "make", "turn"].some((term) => normalized.includes(term)) &&
    ["actual", "approved", "official", "thumbnail", "thumb", "now", "looks good", "close enough", "last generated"].some((term) => normalized.includes(term))
  ) {
    return false;
  }
  if (
    /\b(not|don't|dont|do not)\s+(create|build|make|prepare|start|generate)\b.{0,60}\bsandbox\b/.test(normalized) ||
    /\bwithout\s+(creating|building|making|preparing|starting|generating)\b.{0,60}\bsandbox\b/.test(normalized)
  ) {
    return false;
  }
  if (normalized.includes("temporary") && ["sandbox", "test graph", "test workflow", "workflow", "image to image", "text to image"].some((term) => normalized.includes(term))) {
    return true;
  }
  if (["test graph", "test workflow", "example graph", "example workflow", "sandbox graph", "temporary sandbox"].some((term) => normalized.includes(term))) {
    return true;
  }
  return /\b(create|build|make)\b.+\b(sandbox|test workflow)\b/.test(normalized);
}

function isAssistantPresetDraftRequest(content: string) {
  const normalized = content.trim().toLowerCase();
  if (isAssistantTestWorkflowCreationRequest(content)) return false;
  const saveApprovedResultContext =
    normalized.includes("thumbnail") ||
    normalized.includes("thumb") ||
    normalized.includes("latest output") ||
    normalized.includes("last output") ||
    normalized.includes("newest output") ||
    normalized.includes("generated output") ||
    normalized.includes("latest generated") ||
    normalized.includes("last generated");
  const presetContext =
    normalized.includes("preset") ||
    normalized.includes("contract") ||
    normalized.includes("image to image") ||
    normalized.includes("image-to-image") ||
    normalized.includes("text to image") ||
    normalized.includes("text-to-image");
  return (
    presetContext &&
    (normalized.includes("create") || normalized.includes("save") || normalized.includes("make") || normalized.includes("turn")) &&
    (normalized.includes("now") ||
      normalized.includes("again") ||
      normalized.includes("corrected") ||
      normalized.includes("based on this") ||
      normalized.includes("based upon this") ||
      normalized.includes("approved") ||
      normalized.includes("looks good") ||
      normalized.includes("this is great") ||
      saveApprovedResultContext)
  );
}

function hasAssistantSaveNegation(content: string) {
  const normalized = content.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return false;
  return (
    /\b(?:do not|don't|dont|not|no|without|before)\b.{0,120}\b(?:save|saving|saved)\b/.test(normalized) ||
    /\b(?:save|saving)\b.{0,40}\b(?:yet|later|after)\b/.test(normalized) ||
    normalized.includes("not save-ready") ||
    normalized.includes("not save ready")
  );
}

function isAssistantRecipeSaveRequest(content: string) {
  const normalized = content.trim().toLowerCase();
  if (isAssistantTestWorkflowCreationRequest(content)) return false;
  if (isSelectedNodeEditRequest(content) || hasAssistantSaveNegation(content)) return false;
  return (
    (normalized.includes("recipe") || normalized.includes("prompt recipe")) &&
    (normalized.includes("create") || normalized.includes("save") || normalized.includes("make") || normalized.includes("turn")) &&
    (normalized.includes("now") ||
      normalized.includes("based on this") ||
      normalized.includes("based upon this") ||
      normalized.includes("approved") ||
      normalized.includes("looks good") ||
      normalized.includes("this is great"))
  );
}

function isAssistantRecipeDraftRequest(content: string) {
  const normalized = content.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return false;
  if (isAssistantTestWorkflowCreationRequest(content) || isSelectedNodeEditRequest(content)) return false;
  const recipeContext = normalized.includes("recipe") || normalized.includes("prompt recipe");
  const createIntent = /\b(?:create|draft|build|make|turn|prepare)\b/.test(normalized);
  const reviewIntent =
    normalized.includes("draft") ||
    normalized.includes("reviewable") ||
    normalized.includes("for review") ||
    normalized.includes("review first") ||
    hasAssistantSaveNegation(content);
  return recipeContext && createIntent && reviewIntent;
}

function isAssistantPromptUpdateRequest(content: string) {
  const normalized = content.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return false;
  if (["try that", "apply that", "yes apply that", "yes try that", "ok apply that", "okay apply that"].includes(normalized)) {
    return true;
  }
  const updateIntent = normalized.includes("prompt update") || normalized.includes("update the prompt") || normalized.includes("apply that prompt");
  const promptTarget = normalized.includes("draft preset prompt") || normalized.includes("sandbox prompt") || normalized.includes("test prompt") || normalized.includes("current prompt") || normalized.includes("that prompt");
  return updateIntent && promptTarget;
}

export function isAssistantSavedPresetWorkflowRequest(content: string) {
  const normalized = content.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized.includes("saved") || !normalized.includes("preset")) return false;
  return normalized.includes("workflow") || normalized.includes("graph") || normalized.includes("use") || normalized.includes("key ") || normalized.includes("preset_id");
}

export function latestAssistantSuggestedAction(session: AssistantSession | null) {
  if (!session) return null;
  for (let index = session.messages.length - 1; index >= 0; index -= 1) {
    const message = session.messages[index];
    if (message?.role !== "assistant") continue;
    const action = message.content_json?.suggested_action;
    return typeof action === "string" ? action : null;
  }
  return null;
}

export function normalizeAssistantResponseKind(value: unknown): AssistantResponseKind | null {
  return value === "answer" || value === "ask" || value === "create_local" || value === "confirm_paid_or_mutating" ? value : null;
}

export function latestAssistantResponseKind(session: AssistantSession | null) {
  if (!session) return null;
  for (let index = session.messages.length - 1; index >= 0; index -= 1) {
    const message = session.messages[index];
    if (message?.role !== "assistant") continue;
    const payload = message.content_json ?? {};
    const suggestedAction = payload.suggested_action;
    const selectedNodeEdit =
      suggestedAction === "create_graph_plan" &&
      (payload.mode === "deterministic_selected_node_field_edit" || payload.assistant_prompt_route === "selected_node_field_edit");
    if (selectedNodeEdit) return "create_local";
    return normalizeAssistantResponseKind(payload.assistant_response_kind);
  }
  return null;
}

export function latestAssistantRunApprovalSource(session: AssistantSession | null) {
  if (!session) return null;
  for (let index = session.messages.length - 1; index >= 0; index -= 1) {
    const message = session.messages[index];
    if (message?.role !== "assistant") continue;
    const source = message.content_json?.run_approval_source;
    return typeof source === "string" ? source : null;
  }
  return null;
}

function isTrustedRunApprovalSource(value: string | null | undefined) {
  return value === "explicit_paid_provider_permission" || value === "prior_assistant_confirmation";
}

export function shouldAutoPlanAssistantMessage(content: string, assistantMode: AssistantMode) {
  const normalized = content.trim().toLowerCase();
  if (!normalized) return false;
  if (hasGraphCreationNegation(content)) return false;
  if (assistantMode === "graph") {
    return (
      normalized.includes("workflow") ||
      normalized.includes("graph") ||
      normalized.includes("node") ||
      normalized.includes("text-to-image") ||
      normalized.includes("text to image") ||
      normalized.includes("image-to-image") ||
      normalized.includes("image to image")
    );
  }
  if (assistantMode === "preset") {
    return (
      isAssistantTestWorkflowCreationRequest(content) ||
      isAssistantSavedPresetWorkflowRequest(content) ||
      normalized.includes("try this preset") ||
      normalized.includes("create an example") ||
      normalized.includes("create a clean graph")
    );
  }
  return false;
}

export function resolveCreativeAssistantAutoAction({
  content,
  assistantMode,
  suggestedAction,
  responseKind,
  runApprovalSource,
  canRunWorkflow,
}: {
  content: string;
  assistantMode: AssistantMode;
  suggestedAction: string | null;
  responseKind?: AssistantResponseKind | null;
  runApprovalSource?: string | null;
  canRunWorkflow: boolean;
}): CreativeAssistantAutoAction {
  if (assistantMode === "recipe" && isAssistantRecipeDraftRequest(content)) {
    return "create_prompt_recipe_draft";
  }
  if (isAssistantRunRequest(content)) {
    const runAllowed =
      suggestedAction === "run_workflow" &&
      responseKind === "confirm_paid_or_mutating" &&
      (hasExplicitPaidRunApproval(content) || isTrustedRunApprovalSource(runApprovalSource));
    if (!canRunWorkflow || !runAllowed) return "chat";
    return "run_workflow";
  }
  if (responseKind === "answer" || responseKind === "ask") {
    return "chat";
  }
  const savedPresetWorkflowRequest = isAssistantSavedPresetWorkflowRequest(content);
  const promptUpdateRequest = isAssistantPromptUpdateRequest(content);
  if (isAssistantPresetDraftRequest(content) && suggestedAction === "save_media_preset") {
    if (responseKind && responseKind !== "confirm_paid_or_mutating") return "chat";
    return "save_media_preset";
  }
  if (isAssistantRecipeSaveRequest(content) && suggestedAction === "save_prompt_recipe") {
    if (responseKind && responseKind !== "confirm_paid_or_mutating") return "chat";
    return "save_prompt_recipe";
  }
  if (isAssistantPresetDraftRequest(content) && suggestedAction === "create_media_preset_draft") {
    if (responseKind && responseKind !== "create_local") return "chat";
    return "create_media_preset_draft";
  }
  if (responseKind === "confirm_paid_or_mutating") {
    return "chat";
  }
  if (
    responseKind === "create_local" &&
    suggestedAction === "create_graph_plan" &&
    !hasGraphCreationNegation(content) &&
    !isPromptOnlyGraphRequest(content) &&
    !asksForReviewBeforeGraphChange(content)
  ) {
    return "create_and_apply_graph_plan";
  }
  if (assistantMode === "graph" && !savedPresetWorkflowRequest && isAssistantDirectGraphApplyRequest(content, suggestedAction)) {
    return "create_and_apply_graph_plan";
  }
  if (
    shouldAutoPlanAssistantMessage(content, assistantMode) ||
    promptUpdateRequest ||
    (suggestedAction === "create_graph_plan" &&
      !hasGraphCreationNegation(content) &&
      !isPromptOnlyGraphRequest(content) &&
      (assistantMode === "graph" || savedPresetWorkflowRequest || promptUpdateRequest))
  ) {
    return "create_graph_plan";
  }
  return "chat";
}
