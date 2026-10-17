"use client";

import { useAssistantGraphApply } from "./use-assistant-graph-apply";

import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";

import type { MediaReference } from "@/lib/types";
import { assistantReviewReturnTarget, openAssistantReviewDraft, openAssistantReviewUrl, writeAssistantReviewDraft } from "@/lib/assistant-review-drafts";
import { invalidateGraphNodeDefinitions, refreshGraphNodeDefinitionsOnServer } from "@/lib/graph-node-definitions-sync";
import { providerReadinessFromHealth } from "@/lib/llm-provider-health";
import type { ControlApiHealthData } from "@/lib/types";
import type {
  AssistantRecipeContinuationAction,
  AssistantAttachment,
  AssistantArtifactSaveResponse,
  AssistantMessage,
  AssistantMediaPresetDraftResponse,
  AssistantNextAction,
  AssistantPlan,
  AssistantPlanResponse,
  AssistantProgress,
  AssistantPromptRecipeDraftResponse,
  GraphEstimateResponse,
  GraphValidationResult,
  AssistantSession,
  GraphWorkflowPayload,
} from "../types";
import { JsonFetchError, jsonFetch, requestRejectionMessage } from "../utils/graph-api";
import { readGraphStartup } from "../utils/graph-startup-reads";
import { blankGraphWorkflowPayload, graphWorkflowSnapshotSignature } from "../utils/graph-tabs";
import { buildCreativeAssistantCanvasContext } from "../utils/creative-assistant-canvas-context";

export type AssistantMode = "preset" | "recipe" | "graph";

type AssistantStatus = "idle" | "monitoring" | "sending" | "running" | "planning" | "draftingRecipe" | "draftingPreset" | "savingRecipe" | "savingPreset" | "applying" | "uploading" | "cancelling" | "refreshing";

const ASSISTANT_TRACKED_TURN_STATUSES = new Set<AssistantStatus>([
  "monitoring",
  "sending",
  "planning",
  "draftingRecipe",
  "draftingPreset",
]);

type AssistantProviderReadiness = {
  checked: boolean;
  loading: boolean;
  error: string | null;
  ready: boolean;
  configured: boolean;
  commandAvailable: boolean;
  loginConfigured: boolean;
};

function savedArtifactFromMessage(message: AssistantMessage) {
  const artifact = message.content_json?.saved_artifact;
  if (!artifact || typeof artifact !== "object") return null;
  const payload = artifact as Record<string, unknown>;
  const kind = String(payload.kind || "");
  const id = String(payload.id || "");
  const key = String(payload.key || "");
  const label = String(payload.label || "");
  if ((kind !== "media_preset" && kind !== "prompt_recipe") || !id) return null;
  return { kind, id, key, label: label || key || id };
}

function savedArtifactGraphPrompt(message: AssistantMessage) {
  const artifact = savedArtifactFromMessage(message);
  if (!artifact) return "";
  const exactKey = artifact.key ? ` and key ${artifact.key}` : "";
  if (artifact.kind === "media_preset") {
    return `Create a clean replacement workflow that uses the saved Media Preset named ${artifact.label} with exact id ${artifact.id}${exactKey}. Fill every required text field with useful alternate sample values so the graph validates and the user can change them through visible form controls. Leave required image inputs empty so the user can attach the correct images before running.`;
  }
  return `Create a clean replacement workflow that uses the saved Prompt Recipe named ${artifact.label} with exact id ${artifact.id}${exactKey}, then sends the rendered prompt into a compatible model with preview and save image nodes. Read the saved recipe contract and preserve its image-input intent, intended model and attached reference roles. Use image-to-image when references condition generation, and text-to-image only when the contract calls for it. Populate every required text field from our brief; ask only for genuinely missing inputs.`;
}

function savedArtifactEditorUrl(message: AssistantMessage, returnTo?: string) {
  const artifact = savedArtifactFromMessage(message);
  if (!artifact) return "";
  const base =
    artifact.kind === "media_preset"
      ? `/presets/${encodeURIComponent(artifact.id)}`
      : `/presets/prompt-recipes/${encodeURIComponent(artifact.id)}`;
  return returnTo ? `${base}?returnTo=${encodeURIComponent(returnTo)}` : base;
}

function assistantErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

const NO_CONFIRMABLE_GRAPH_PROPOSAL = "The assistant did not produce a confirmable graph proposal.";

function isClarificationPlanError(error: unknown) {
  return error instanceof JsonFetchError &&
    error.status === 400 &&
    error.message === NO_CONFIRMABLE_GRAPH_PROPOSAL;
}

function hasNewPlanClarification(
  previousSession: AssistantSession,
  refreshedSession: AssistantSession,
  userMessage: string,
) {
  const previousMessageIds = new Set(
    previousSession.messages.map((message) => message.assistant_message_id),
  );
  const newMessages = refreshedSession.messages.filter(
    (message) => !previousMessageIds.has(message.assistant_message_id),
  );
  return newMessages.some((message, index) => {
    const nextAction = message.content_json?.next_action;
    const hasMatchingUserMessage = newMessages
      .slice(0, index)
      .some((candidate) => candidate.role === "user" && candidate.content_text.trim() === userMessage);
    return message.role === "assistant" &&
      message.content_text.trim().length > 0 &&
      nextAction !== null &&
      typeof nextAction === "object" &&
      (nextAction as Record<string, unknown>).kind === "none" &&
      hasMatchingUserMessage;
  });
}

function buildOptimisticUserMessage(sessionId: string, contentText: string) {
  return {
    assistant_message_id: `optimistic-user-${Date.now()}`,
    assistant_session_id: sessionId,
    role: "user" as const,
    content_text: contentText,
    content_json: { optimistic: true },
    created_at: new Date().toISOString(),
  };
}

function appendOptimisticUserMessage(
  current: AssistantSession | null,
  fallbackSession: AssistantSession,
  contentText: string,
  metadata?: Record<string, unknown>,
) {
  const optimisticMessage = {
    ...buildOptimisticUserMessage(fallbackSession.assistant_session_id, contentText),
    content_json: { optimistic: true, ...(metadata ?? {}) },
  };
  const baseSession = current ?? fallbackSession;
  const lastMessage = baseSession.messages[baseSession.messages.length - 1];
  if (lastMessage?.role === "user" && String(lastMessage.content_text || "").trim() === contentText.trim()) {
    return baseSession;
  }
  return {
    ...baseSession,
    messages: [...baseSession.messages, optimisticMessage],
  };
}

function persistedPlanForWorkflow(
  assistantSession: AssistantSession,
  workflowId: string | null,
) {
  const persistedPlan = assistantSession.latest_plan ?? null;
  if (!persistedPlan) return null;
  if (persistedPlan.plan.assistant_session_id !== assistantSession.assistant_session_id) return null;
  const planWorkflowId = persistedPlan.workflow.workflow_id ?? null;
  const independentSource = persistedPlan.graph_plan.metadata?.independent_stage === true &&
    persistedPlan.graph_plan.metadata?.source_workflow_id === workflowId && !planWorkflowId;
  if (workflowId) {
    const workflowOwnsSession =
      assistantSession.owner_kind === "graph_workflow" && assistantSession.owner_id === workflowId;
    const standalonePlanTargetsWorkflow =
      assistantSession.owner_kind === "standalone" && !assistantSession.owner_id && (planWorkflowId === workflowId || independentSource);
    if (!workflowOwnsSession && !standalonePlanTargetsWorkflow) return null;
    if (!independentSource && planWorkflowId !== workflowId && persistedPlan.plan.applied_workflow_id !== workflowId) return null;
  } else if (assistantSession.owner_kind !== "standalone" || persistedPlan.workflow.workflow_id) {
    return null;
  }
  return persistedPlan;
}

type FailedAssistantRequest = {
  content: string; checked: boolean; code: string; status: number | null; previousMessageIds: string[]; editable: boolean;
  detail?: string;
  planning?: { workflowOverride?: GraphWorkflowPayload; sourceWorkflowSignature: string | null; showPlan: boolean };
};

function failedRequestOutcome(session: AssistantSession, failure: FailedAssistantRequest) {
  const requestIndex = session.messages.findIndex(message => message.role === "user" && message.content_text.trim() === failure.content && !failure.previousMessageIds.includes(message.assistant_message_id));
  return {
    requestPersisted: requestIndex >= 0,
    replyFound: requestIndex >= 0 && session.messages.slice(requestIndex + 1).some(message => message.role === "assistant"),
    outcome: requestIndex >= 0 ? session.messages[requestIndex].content_json?.turn_outcome : null,
  };
}

function latestAssistantPayload(session: AssistantSession | null) {
  if (!session) return null;
  for (let index = session.messages.length - 1; index >= 0; index -= 1) {
    const message = session.messages[index];
    if (message.role === "user") return null;
    if (message.role !== "assistant") continue;
    return message.content_json ?? {};
  }
  return null;
}

function latestKernelNextAction(session: AssistantSession | null): AssistantNextAction | null {
  const payload = latestAssistantPayload(session);
  if (payload?.mode !== "assistant_kernel") return null;
  const rawAction = payload.next_action;
  if (!rawAction || typeof rawAction !== "object") return null;
  const action = rawAction as Record<string, unknown>;
  const kind = String(action.kind || "");
  if (!["none", "confirm_graph", "save_media_preset", "save_prompt_recipe", "apply_repair", "run_workflow"].includes(kind)) {
    return null;
  }
  const label = typeof action.label === "string" && action.label.trim() ? action.label : null;
  const actionPayload = action.payload && typeof action.payload === "object"
    ? action.payload as Record<string, unknown>
    : null;
  if (kind !== "none" && kind !== "run_workflow" && (!label || !actionPayload)) return null;
  const presetProposal = session?.summary_json?.kernel_preset_proposal;
  const recipeProposal = session?.summary_json?.kernel_recipe_proposal;
  const runConfirmation = session?.summary_json?.kernel_run_confirmation;
  const consumed = (entry: unknown) => Boolean(
    entry && typeof entry === "object" && (entry as Record<string, unknown>).consumed === true,
  );
  if (
    (kind === "run_workflow" && consumed(runConfirmation)) ||
    (kind === "save_media_preset" && consumed(presetProposal)) ||
    (kind === "save_prompt_recipe" && consumed(recipeProposal))
  ) {
    return null;
  }
  return {
    kind: kind as AssistantNextAction["kind"],
    label,
    proposal_id: typeof action.proposal_id === "string" ? action.proposal_id : null,
    confirmation_token: typeof action.confirmation_token === "string" ? action.confirmation_token : null,
    requires_confirmation: action.requires_confirmation === true,
    payload: actionPayload ?? {},
    price_estimate: action.price_estimate && typeof action.price_estimate === "object" ? action.price_estimate as Record<string, unknown> : null,
  };
}

export function useCreativeAssistant({
  workspaceKey,
  assistantMode = "graph",
  workflowId,
  workflowName,
  workflow,
  latestRunId,
  latestRunStatus,
  selectedNodeIds = [],
  selectedGroupIds = [],
  enabled = false,
  initialAssistantSessionId,
  reviewReturnTo,
  importImageFile,
  onBeforeReviewNavigate,
  onAssistantSessionChange,
  onApplyWorkflow,
  onRunWorkflow,
  onEvent,
}: {
  workspaceKey: string;
  assistantMode?: AssistantMode;
  workflowId: string | null;
  workflowName: string;
  workflow: GraphWorkflowPayload;
  latestRunId?: string | null;
  latestRunStatus?: string | null;
  selectedNodeIds?: string[];
  selectedGroupIds?: string[];
  enabled?: boolean;
  initialAssistantSessionId?: string | null;
  reviewReturnTo?: string;
  importImageFile: (file: File) => Promise<MediaReference>;
  onBeforeReviewNavigate?: () => void;
  onAssistantSessionChange?: (assistantSessionId: string | null) => void;
  onApplyWorkflow: (workflow: GraphWorkflowPayload, options?: { highlightNodeIds?: string[]; baseWorkflow?: GraphWorkflowPayload; openInNewTab?: boolean; assistantSessionId?: string; layoutOnly?: boolean }) => Promise<void> | void;
  onRunWorkflow?: (assistantConfirmation?: { sessionId: string; token: string }) => Promise<unknown> | void;
  onEvent?: (message: string, tone?: "success" | "warning" | "error" | "muted") => void;
}) {
  const [session, setSession] = useState<AssistantSession | null>(null);
  const [draft, setDraft] = useState("");
  const [plan, setPlan] = useState<AssistantPlanResponse | null>(null);
  const [failedApplyPlanId, setFailedApplyPlanId] = useState<string | null>(null);
  const [deliveredPlanId, setDeliveredPlanId] = useState<string | null>(null);
  const [status, setStatus] = useState<AssistantStatus>("idle");
  const [progress, setProgress] = useState<AssistantProgress | null>(null);
  const [progressUnavailable, setProgressUnavailable] = useState(false);
  const [progressUpdatedAt, setProgressUpdatedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionLoadFailed, setSessionLoadFailed] = useState(false);
  const [artifactRefreshFailure, setArtifactRefreshFailure] = useState<{ reason: string; label: string; message: string; detail: string } | null>(null);
  const [errorDetails, setErrorDetails] = useState<{ message: string; detail: string } | null>(null);
  const [failedRequest, setFailedRequest] = useState<FailedAssistantRequest | null>(null);
  const [runSubmissionUncertain, setRunSubmissionUncertain] = useState(false);
  const [runConfirmationNeedsRecheck, setRunConfirmationNeedsRecheck] = useState(false);
  const [providerReadiness, setProviderReadiness] = useState<AssistantProviderReadiness>({
    checked: false,
    loading: false,
    error: null,
    ready: false,
    configured: false,
    commandAvailable: false,
    loginConfigured: false,
  });
  const activeAbortControllerRef = useRef<AbortController | null>(null);
  const cancellationPendingRef = useRef(false);
  const workspaceKeyRef = useRef(workspaceKey);
  const scopeEpochRef = useRef(0);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const initialAssistantSessionIdRef = useRef(initialAssistantSessionId);
  const sessionWorkspaceKeyRef = useRef<string | null>(null);
  const activeRunOperationRef = useRef<symbol | null>(null);
  const activeApplyOperationRef = useRef<symbol | null>(null);
  const [referenceRecovery, setReferenceRecovery] = useState<{ sessionId: string; referenceId: string } | null>(null);
  const providerHealthControllerRef = useRef<AbortController | null>(null);
  const referenceOperationRef = useRef<symbol | null>(null);
  const refreshOperationRef = useRef<symbol | null>(null);
  const saveOperationRef = useRef<symbol | null>(null);
  const planWorkflowOverrideRef = useRef<{
    planId: string;
    baseWorkflow: GraphWorkflowPayload;
    sourceWorkflowSignature: string | null;
  } | null>(null);

  const requestedSessionChanged = Boolean(
    initialAssistantSessionId && session?.assistant_session_id !== initialAssistantSessionId,
  );
  const scopedStatus = workspaceKeyRef.current === workspaceKey
    ? requestedSessionChanged && !error ? "monitoring" : status : "idle";
  const busy = scopedStatus !== "idle" || Boolean(referenceRecovery);
  const cancellable = (
    ASSISTANT_TRACKED_TURN_STATUSES.has(scopedStatus) && !requestedSessionChanged && Boolean(session?.assistant_session_id)
  ) || scopedStatus === "cancelling";
  const reportOperationFailure = useCallback((requestError: unknown, fallback: string) => {
    const message = requestRejectionMessage(requestError) ?? fallback;
    setError(message);
    setErrorDetails({ message, detail: assistantErrorMessage(requestError, "No further details available.") });
    onEventRef.current?.(message, "error");
  }, []);

  const { applyPlanResponse, applyRecovery, recoverGraphApply } = useAssistantGraphApply({
    workflow, workspaceKey, initialAssistantSessionId, busy, activeApplyOperationRef,
    onApplyWorkflow, onEvent, setPlan, setStatus, setDeliveredPlanId, setFailedApplyPlanId,
    reportOperationFailure, clearError: () => setError(null),
  });

  const canPlan = draft.trim().length > 0 && !busy && !applyRecovery;
  const nextAction = useMemo(() => latestKernelNextAction(session), [session]);
  const runPricingSummary = nextAction?.price_estimate?.pricing_summary;
  const runConfirmationBlocker = runSubmissionUncertain
    ? "The run outcome is unknown. Check run history and reload to reconcile its state before preparing another run."
    : nextAction?.kind !== "run_workflow" ? null
    : !nextAction.label || !nextAction.requires_confirmation || !nextAction.confirmation_token ||
      nextAction.payload?.confirmation_token !== nextAction.confirmation_token
      ? "The run confirmation is incomplete. Recheck the graph and pricing before running."
      : !runPricingSummary || typeof runPricingSummary !== "object" ||
        (runPricingSummary as Record<string, unknown>).has_unknown_pricing === true
        ? "The current estimate is unavailable. Recheck the graph and pricing before running."
      : !onRunWorkflow
        ? "Run controls are unavailable here. Open this workflow in Graph Studio to run it."
        : null;
  const latestPayload = useMemo(() => latestAssistantPayload(session), [session]);
  const kernelActionRequired = latestPayload?.mode === "assistant_kernel" || plan?.graph_plan.metadata?.kernel_proposal === true;
  const unansweredRequest = session?.messages.filter(message => message.role === "user" || message.role === "assistant").at(-1)?.role === "user";
  const canApply = Boolean(
    plan?.plan.status === "validated" &&
    !busy && !unansweredRequest && !applyRecovery &&
    (
      !kernelActionRequired ||
      (
        nextAction?.kind === "confirm_graph" &&
        nextAction.requires_confirmation &&
        nextAction.proposal_id === plan.plan.assistant_plan_id &&
        Boolean(nextAction.confirmation_token)
      )
    ),
  );
  const canvasContext = useMemo(
    () => ({ ...buildCreativeAssistantCanvasContext(workflow, { selectedNodeIds, selectedGroupIds }), workspace_key: workspaceKey }),
    [selectedGroupIds, selectedNodeIds, workflow, workspaceKey],
  );

  const setScopedSession = useCallback((nextSession: SetStateAction<AssistantSession | null>) => {
    setSession((current) => {
      const resolvedSession = typeof nextSession === "function" ? nextSession(current) : nextSession;
      sessionWorkspaceKeyRef.current = resolvedSession ? workspaceKeyRef.current : null;
      return resolvedSession;
    });
  }, []);

  const reportAbortableStop = useCallback((message: string) => {
    if (!cancellationPendingRef.current) onEvent?.(message, "muted");
  }, [onEvent]);

  const finishAbortableOperation = useCallback(() => {
    if (!cancellationPendingRef.current) setStatus("idle");
  }, []);

  const resetAssistantState = useCallback(() => {
    scopeEpochRef.current += 1;
    activeAbortControllerRef.current?.abort();
    cancellationPendingRef.current = false;
    sessionWorkspaceKeyRef.current = null;
    activeRunOperationRef.current = null;
    activeApplyOperationRef.current = null;
    referenceOperationRef.current = null;
    setReferenceRecovery(null);
    refreshOperationRef.current = null;
    saveOperationRef.current = null;
    setSessionLoadFailed(false);
    setArtifactRefreshFailure(null);
    planWorkflowOverrideRef.current = null;
    setScopedSession(null);
    setPlan(null);
    setDeliveredPlanId(null);
    setFailedApplyPlanId(null);
    setDraft("");
    setError(null);
    setRunConfirmationNeedsRecheck(false);
    setFailedRequest(null);
    setRunSubmissionUncertain(false);
    setStatus("idle");
    setProgress(null);
    setProgressUnavailable(false);
    setProgressUpdatedAt(null);
  }, [setScopedSession]);

  useEffect(() => {
    if (workspaceKeyRef.current === workspaceKey) return;
    workspaceKeyRef.current = workspaceKey;
    initialAssistantSessionIdRef.current = initialAssistantSessionId;
    resetAssistantState();
  }, [initialAssistantSessionId, resetAssistantState, workspaceKey]);

  useEffect(() => {
    const previousAssistantSessionId = initialAssistantSessionIdRef.current;
    initialAssistantSessionIdRef.current = initialAssistantSessionId;
    if (!previousAssistantSessionId || previousAssistantSessionId === initialAssistantSessionId) return;
    resetAssistantState();
  }, [initialAssistantSessionId, resetAssistantState]);

  useEffect(() => {
    if (!requestedSessionChanged && session?.assistant_session_id && sessionWorkspaceKeyRef.current === workspaceKey) {
      onAssistantSessionChange?.(session.assistant_session_id);
    }
  }, [onAssistantSessionChange, requestedSessionChanged, session?.assistant_session_id, workspaceKey]);

  const runAbortableRequest = useCallback(async <T,>(request: (signal: AbortSignal) => Promise<T>) => {
    activeAbortControllerRef.current?.abort();
    const controller = new AbortController();
    activeAbortControllerRef.current = controller;
    // Productive planning and real compaction finish without a wall-clock cap.
    // Explicit Stop/workspace changes abort; transport failures still reject.
    try {
      const result = await request(controller.signal);
      if (controller.signal.aborted) throw new DOMException("Assistant request stopped.", "AbortError");
      return result;
    } finally {
      if (activeAbortControllerRef.current === controller) activeAbortControllerRef.current = null;
    }
  }, []);

  const hydrateExistingSession = useCallback((existing: AssistantSession, expectedWorkspaceKey: string) => {
    if (workspaceKeyRef.current !== expectedWorkspaceKey) return false;
    const persistedPlan = persistedPlanForWorkflow(existing, workflowId);
    setScopedSession(existing);
    setPlan(persistedPlan);
    return true;
  }, [setScopedSession, workflowId]);

  const restoreRecoveredPlan = useCallback((refreshed: AssistantSession, failure: FailedAssistantRequest | null) => {
    if (!failure?.planning || !failedRequestOutcome(refreshed, failure).replyFound) return;
    const recovered = persistedPlanForWorkflow(refreshed, workflowId);
    const action = latestKernelNextAction(refreshed);
    const current = recovered && action?.kind === "confirm_graph" && action.proposal_id === recovered.plan.assistant_plan_id;
    setPlan(current && failure.planning.showPlan ? recovered : null);
    planWorkflowOverrideRef.current = current && failure.planning.workflowOverride ? {
      planId: recovered.plan.assistant_plan_id,
      baseWorkflow: failure.planning.workflowOverride,
      sourceWorkflowSignature: failure.planning.sourceWorkflowSignature,
    } : null;
  }, [workflowId]);

  useEffect(() => {
    const sessionId = session?.assistant_session_id;
    const tracksKernelProgress = ASSISTANT_TRACKED_TURN_STATUSES.has(scopedStatus);
    setProgress(null);
    setProgressUnavailable(false);
    setProgressUpdatedAt(null);
    if (!tracksKernelProgress || !sessionId || requestedSessionChanged) return;
    const expectedWorkspaceKey = workspaceKeyRef.current;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      try {
        const next = await jsonFetch<AssistantProgress>(
          `/api/control/media/assistant/sessions/${sessionId}/progress`,
          { signal: AbortSignal.timeout(5_000) },
        );
        if (!disposed) {
          setProgress(next);
          setProgressUpdatedAt(Date.now());
          setProgressUnavailable(false);
          // Reattached turns have no pending message response to deliver the outcome.
          if (scopedStatus === "monitoring" && !next.active) {
            const refreshed = await jsonFetch<AssistantSession>(
              `/api/control/media/assistant/sessions/${sessionId}`,
              { signal: AbortSignal.timeout(5_000) },
            );
            if (!disposed && hydrateExistingSession(refreshed, expectedWorkspaceKey)) {
              setStatus("idle");
              restoreRecoveredPlan(refreshed, failedRequest);
              setFailedRequest(failure => !failure || failedRequestOutcome(refreshed, failure).replyFound ? null : { ...failure, checked: true });
              setError(null);
            }
          }
        }
      } catch {
        if (!disposed) setProgressUnavailable(true);
      } finally {
        if (!disposed) timer = setTimeout(poll, 2_000);
      }
    };
    void poll();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [failedRequest, hydrateExistingSession, requestedSessionChanged, restoreRecoveredPlan, scopedStatus, session?.assistant_session_id]);

  const loadExistingSession = useCallback(async (signal?: AbortSignal) => {
    const expectedEpoch = scopeEpochRef.current;
    const expectedWorkspaceKey = workspaceKeyRef.current;
    if (initialAssistantSessionId) {
      if (session?.assistant_session_id === initialAssistantSessionId) return session;
      const existing = await jsonFetch<AssistantSession>(`/api/control/media/assistant/sessions/${encodeURIComponent(initialAssistantSessionId)}`, { signal });
      return !signal?.aborted && scopeEpochRef.current === expectedEpoch && hydrateExistingSession(existing, expectedWorkspaceKey) ? existing : null;
    }
    if (session) return session;
    if (!workflowId) return null;
    const existing = await jsonFetch<{ items?: AssistantSession[] }>(
      `/api/control/media/assistant/sessions?owner_kind=graph_workflow&owner_id=${encodeURIComponent(workflowId)}&limit=1`,
      { signal },
    );
    if (signal?.aborted || scopeEpochRef.current !== expectedEpoch) return null;
    const latest = existing.items?.[0] ?? null;
    if (latest && !hydrateExistingSession(latest, expectedWorkspaceKey)) return null;
    return latest;
  }, [hydrateExistingSession, initialAssistantSessionId, session, workflowId]);

  const ensureSession = useCallback(async (signal?: AbortSignal) => {
    const expectedEpoch = scopeEpochRef.current;
    const expectedWorkspaceKey = workspaceKeyRef.current;
    if (session) return session;
    const latest = await loadExistingSession(signal);
    signal?.throwIfAborted();
    if (scopeEpochRef.current !== expectedEpoch) throw new DOMException("Assistant workspace changed.", "AbortError");
    if (latest) return latest;
    const created = await jsonFetch<AssistantSession>("/api/control/media/assistant/sessions", {
      method: "POST", signal,
      body: JSON.stringify({
        owner_kind: workflowId ? "graph_workflow" : "standalone",
        owner_id: workflowId,
        workflow,
        canvas_context: canvasContext,
        assistant_mode: assistantMode,
        title: `${workflowName || "Graph"} assistant`,
      }),
    });
    signal?.throwIfAborted();
    if (scopeEpochRef.current !== expectedEpoch || workspaceKeyRef.current !== expectedWorkspaceKey) return created;
    setScopedSession(created);
    return created;
  }, [assistantMode, canvasContext, loadExistingSession, session, setScopedSession, workflow, workflowId, workflowName]);

  useEffect(() => {
    if (!enabled) return;
    if (!requestedSessionChanged && (session || (!workflowId && !initialAssistantSessionId))) return;
    const controller = new AbortController();
    // Check saved ownership before enabling a replacement send or old action.
    setStatus("monitoring");
    loadExistingSession(controller.signal).then((existing) => {
      if (!controller.signal.aborted) {
        setSessionLoadFailed(false);
        if (!existing) setStatus("idle");
      }
    }).catch((requestError) => {
      if (controller.signal.aborted) return;
      setSessionLoadFailed(true);
      reportOperationFailure(requestError, "Couldn’t load your saved conversation. Check your connection, then reload the conversation.");
      setStatus("idle");
    });
    return () => controller.abort();
  }, [enabled, initialAssistantSessionId, loadExistingSession, reportOperationFailure, requestedSessionChanged, session, workflowId]);

  const refreshProviderReadiness = useCallback(async (options?: { startup?: boolean }) => {
    providerHealthControllerRef.current?.abort();
    const controller = new AbortController();
    providerHealthControllerRef.current = controller;
    setProviderReadiness((current) => ({ ...current, checked: false, loading: true, error: null }));
    try {
      // Cancellation belongs to this consumer; it must not abort another consumer's shared health read.
      const payload = await readGraphStartup<ControlApiHealthData>("/api/control/health", !options?.startup);
      if (controller.signal.aborted) return;
      const readiness = providerReadinessFromHealth(payload).codexLocal;
      setProviderReadiness({ checked: true, loading: false, error: null, ...readiness });
    } catch {
      if (controller.signal.aborted) return;
      setProviderReadiness((current) => ({ ...current, checked: false, loading: false,
        error: "Couldn’t check Codex Local readiness. Check your connection, then retry the readiness check." }));
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refreshProviderReadiness({ startup: true });
    return () => providerHealthControllerRef.current?.abort();
  }, [enabled, refreshProviderReadiness]);

  const createMediaPresetDraftFromMessage = useCallback(async (message: string, assistantSessionId?: string | null) => {
    const currentSession = assistantSessionId ? ({ assistant_session_id: assistantSessionId } as AssistantSession) : session ?? (await ensureSession());
    const result = await runAbortableRequest((signal) =>
      jsonFetch<AssistantMediaPresetDraftResponse>(`/api/control/media/assistant/sessions/${currentSession.assistant_session_id}/preset-drafts`, {
        method: "POST",
        signal,
        body: JSON.stringify({ message, workflow, run_id: latestRunId ?? null, assistant_mode: assistantMode }),
      }),
    );
    onEvent?.("Opening Media Preset draft for review.", "success");
    onBeforeReviewNavigate?.();
    if (result.review_url.includes("assistantMessage=")) {
      if (reviewReturnTo) openAssistantReviewUrl(result.review_url, assistantReviewReturnTarget(reviewReturnTo, currentSession.assistant_session_id));
      else openAssistantReviewUrl(result.review_url);
    } else {
      const draftId = writeAssistantReviewDraft({
        kind: "media_preset",
        draft: result.draft,
        validationWarnings: result.validation_warnings ?? [],
        mediaSummary: result.media_summary ?? [],
      });
      if (reviewReturnTo) openAssistantReviewDraft(result.review_url, draftId, reviewReturnTo);
      else openAssistantReviewDraft(result.review_url, draftId);
    }
    return result;
  }, [assistantMode, ensureSession, latestRunId, onBeforeReviewNavigate, onEvent, reviewReturnTo, runAbortableRequest, session, workflow]);

  const createPromptRecipeDraftFromMessage = useCallback(async (message: string, assistantSessionId?: string | null) => {
    const currentSession = assistantSessionId ? ({ assistant_session_id: assistantSessionId } as AssistantSession) : session ?? (await ensureSession());
    const result = await runAbortableRequest((signal) =>
      jsonFetch<AssistantPromptRecipeDraftResponse>(`/api/control/media/assistant/sessions/${currentSession.assistant_session_id}/recipe-drafts`, {
        method: "POST",
        signal,
        body: JSON.stringify({ message, assistant_mode: assistantMode }),
      }),
    );
    onEvent?.("Opening Prompt Recipe draft for review.", "success");
    onBeforeReviewNavigate?.();
    if (result.review_url.includes("assistantMessage=")) {
      if (reviewReturnTo) openAssistantReviewUrl(result.review_url, assistantReviewReturnTarget(reviewReturnTo, currentSession.assistant_session_id));
      else openAssistantReviewUrl(result.review_url);
    } else {
      const draftId = writeAssistantReviewDraft({
        kind: "prompt_recipe",
        draft: result.draft,
        validationWarnings: result.validation_warnings ?? [],
        mediaSummary: result.media_summary ?? [],
      });
      if (reviewReturnTo) openAssistantReviewDraft(result.review_url, draftId, reviewReturnTo);
      else openAssistantReviewDraft(result.review_url, draftId);
    }
    return result;
  }, [assistantMode, ensureSession, onBeforeReviewNavigate, onEvent, reviewReturnTo, runAbortableRequest, session]);

  const refreshDefinitionsAfterAssistantSave = useCallback(async (reason: string, label: string) => {
    const operation = Symbol("artifact-refresh");
    refreshOperationRef.current = operation;
    const ownsOperation = () => refreshOperationRef.current === operation;
    try {
      await refreshGraphNodeDefinitionsOnServer();
      if (!ownsOperation()) return false;
      await invalidateGraphNodeDefinitions(reason);
      if (ownsOperation()) setArtifactRefreshFailure(null);
      return ownsOperation();
    } catch (requestError) {
      if (!ownsOperation()) return false;
      const message = `Your ${label} is saved, but its graph availability couldn’t refresh. Retry the refresh before using it in a graph.`;
      setArtifactRefreshFailure({ reason, label, message, detail: assistantErrorMessage(requestError, "No further details available.") });
      onEvent?.(message, "warning");
      return true;
    } finally {
      if (ownsOperation()) refreshOperationRef.current = null;
    }
  }, [onEvent]);

  const retryArtifactRefresh = useCallback(async () => {
    if (busy || !artifactRefreshFailure) return;
    const expectedWorkspace = workspaceKeyRef.current;
    setStatus("refreshing");
    const current = await refreshDefinitionsAfterAssistantSave(artifactRefreshFailure.reason, artifactRefreshFailure.label);
    if (current && workspaceKeyRef.current === expectedWorkspace) finishAbortableOperation();
  }, [artifactRefreshFailure, busy, finishAbortableOperation, refreshDefinitionsAfterAssistantSave]);

  const reportReferenceImportFailure = useCallback((requestError: unknown) => {
    reportOperationFailure(requestError, "Couldn’t import this reference image. Check your connection and choose the file again.");
  }, [reportOperationFailure]);

  const reportArtifactSaveFailure = useCallback((requestError: unknown, artifactKind: "media_preset" | "prompt_recipe") => {
    const [label, list] = artifactKind === "media_preset" ? ["Media Preset", "preset"] : ["Prompt Recipe", "recipe"];
    const errorMessage = requestRejectionMessage(requestError)
      ?? `Couldn’t confirm whether your ${label} was saved. Check the ${list} list before trying again.`;
    setError(errorMessage);
    setErrorDetails({ message: errorMessage, detail: assistantErrorMessage(requestError, "No further details available.") });
    onEvent?.(errorMessage, "error");
    return null;
  }, [onEvent]);

  const saveMediaPresetFromMessage = useCallback(async (
    message: string,
    assistantSessionId?: string | null,
    confirmation?: AssistantNextAction | null,
  ) => {
    const operation = Symbol("save-artifact");
    saveOperationRef.current = operation;
    const ownsOperation = () => saveOperationRef.current === operation;
    const currentSession = assistantSessionId ? ({ assistant_session_id: assistantSessionId } as AssistantSession) : session ?? (await ensureSession());
    if (!ownsOperation()) return null;
    setStatus("savingPreset");
    setError(null);
    try {
      const result = await runAbortableRequest((signal) =>
        jsonFetch<AssistantArtifactSaveResponse>(`/api/control/media/assistant/sessions/${currentSession.assistant_session_id}/preset-saves`, {
          method: "POST",
          signal,
          body: JSON.stringify({
            message,
            workflow,
            run_id: latestRunId ?? null,
            assistant_mode: assistantMode,
            ...(confirmation?.kind === "save_media_preset"
              ? {
                  proposal_id: confirmation.proposal_id,
                  confirmation_token: confirmation.confirmation_token,
                }
              : {}),
          }),
        }),
      );
      if (!ownsOperation()) return null;
      setScopedSession(result.assistant_session);
      await refreshDefinitionsAfterAssistantSave("assistant-media-preset-saved", "Media Preset");
      if (!ownsOperation()) return null;
      setError(result.warning ?? null);
      onEvent?.(result.message || "Media Preset saved.", result.warning ? "warning" : "success");
      return result;
    } catch (requestError) {
      if (!ownsOperation()) return null;
      if (isAbortError(requestError)) {
        reportAbortableStop("Media Preset save stopped.");
        return null;
      }
      return reportArtifactSaveFailure(requestError, "media_preset");
    } finally {
      if (ownsOperation()) { saveOperationRef.current = null; finishAbortableOperation(); }
    }
  }, [assistantMode, ensureSession, finishAbortableOperation, latestRunId, onEvent, refreshDefinitionsAfterAssistantSave, reportAbortableStop, reportArtifactSaveFailure, runAbortableRequest, session, setScopedSession, workflow]);

  const confirmPresetSave = useCallback(async () => {
    if (
      busy ||
      nextAction?.kind !== "save_media_preset" ||
      !nextAction.proposal_id ||
      !nextAction.confirmation_token
    ) {
      return null;
    }
    const currentSession = session ?? (await ensureSession());
    return saveMediaPresetFromMessage(
      "Save the approved Media Preset draft.",
      currentSession.assistant_session_id,
      nextAction,
    );
  }, [busy, ensureSession, nextAction, saveMediaPresetFromMessage, session]);

  const savePromptRecipeFromMessage = useCallback(async (
    message: string,
    assistantSessionId?: string | null,
    confirmation?: AssistantNextAction | null,
  ) => {
    const operation = Symbol("save-artifact");
    saveOperationRef.current = operation;
    const ownsOperation = () => saveOperationRef.current === operation;
    const currentSession = assistantSessionId ? ({ assistant_session_id: assistantSessionId } as AssistantSession) : session ?? (await ensureSession());
    if (!ownsOperation()) return null;
    setStatus("savingRecipe");
    setError(null);
    try {
      const result = await runAbortableRequest((signal) =>
        jsonFetch<AssistantArtifactSaveResponse>(`/api/control/media/assistant/sessions/${currentSession.assistant_session_id}/recipe-saves`, {
          method: "POST",
          signal,
          body: JSON.stringify({
            message,
            workflow,
            run_id: latestRunId ?? null,
            assistant_mode: assistantMode,
            ...(confirmation?.kind === "save_prompt_recipe"
              ? {
                  proposal_id: confirmation.proposal_id,
                  confirmation_token: confirmation.confirmation_token,
                }
              : {}),
          }),
        }),
      );
      if (!ownsOperation()) return null;
      setScopedSession(result.assistant_session);
      await refreshDefinitionsAfterAssistantSave("assistant-prompt-recipe-saved", "Prompt Recipe");
      if (!ownsOperation()) return null;
      onEvent?.(result.message || "Prompt Recipe saved.", "success");
      return result;
    } catch (requestError) {
      if (!ownsOperation()) return null;
      if (isAbortError(requestError)) {
        reportAbortableStop("Prompt Recipe save stopped.");
        return null;
      }
      return reportArtifactSaveFailure(requestError, "prompt_recipe");
    } finally {
      if (ownsOperation()) { saveOperationRef.current = null; finishAbortableOperation(); }
    }
  }, [assistantMode, ensureSession, finishAbortableOperation, latestRunId, onEvent, refreshDefinitionsAfterAssistantSave, reportAbortableStop, reportArtifactSaveFailure, runAbortableRequest, session, setScopedSession, workflow]);

  const confirmRecipeSave = useCallback(async () => {
    if (
      busy ||
      nextAction?.kind !== "save_prompt_recipe" ||
      !nextAction.proposal_id ||
      !nextAction.confirmation_token
    ) {
      return null;
    }
    const currentSession = session ?? (await ensureSession());
    return savePromptRecipeFromMessage(
      "Save the approved Prompt Recipe draft.",
      currentSession.assistant_session_id,
      nextAction,
    );
  }, [busy, ensureSession, nextAction, savePromptRecipeFromMessage, session]);

  const confirmRunWorkflow = useCallback(async () => {
    if (
      busy || activeRunOperationRef.current !== null ||
      nextAction?.kind !== "run_workflow" ||
      runConfirmationBlocker || !nextAction.confirmation_token || !onRunWorkflow
    ) {
      return null;
    }
    const requestWorkspaceKey = workspaceKeyRef.current;
    const operation = Symbol("assistant-run");
    activeRunOperationRef.current = operation;
    setStatus("running");
    setError(null);
    setRunConfirmationNeedsRecheck(false);
    try {
      const currentSession = session ?? (await ensureSession());
      const created = await onRunWorkflow({
        sessionId: currentSession.assistant_session_id,
        token: nextAction.confirmation_token,
      });
      if (activeRunOperationRef.current !== operation || workspaceKeyRef.current !== requestWorkspaceKey) return null;
      if (created === null) {
        setError("Run cancelled before spending credits.");
        return null;
      }
      if (!created || typeof created !== "object" || !("run_id" in created) || !created.run_id) {
        throw new JsonFetchError("No run was confirmed. Check the graph console and run history before trying again.", "run_start_unconfirmed");
      }
      setScopedSession((current) => current ? {
        ...current,
        summary_json: {
          ...current.summary_json,
          kernel_run_confirmation: {
            ...(current.summary_json?.kernel_run_confirmation as Record<string, unknown> ?? {}),
            consumed: true,
          },
        },
      } : current);
      return created;
    } catch (requestError) {
      if (activeRunOperationRef.current !== operation || workspaceKeyRef.current !== requestWorkspaceKey) return null;
      const uncertain = requestError instanceof JsonFetchError && requestError.code === "run_start_unconfirmed";
      setRunSubmissionUncertain(uncertain);
      const knownBlocker = requestError instanceof JsonFetchError && ["workflow_fingerprint_mismatch", "graph_validation_failed"].includes(requestError.code ?? "");
      const message = uncertain ? assistantErrorMessage(requestError, "The run outcome is unknown. Check run history before trying again.")
        : knownBlocker ? assistantErrorMessage(requestError, "Review the graph before running.")
        : requestRejectionMessage(requestError) ?? "Couldn’t prepare this run. No run was submitted. Check your connection, then review the graph and pricing before trying again.";
      if (uncertain) setError(null);
      else { setError(message); setErrorDetails({ message, detail: assistantErrorMessage(requestError, "No further details available.") }); }
      setRunConfirmationNeedsRecheck(
        requestError instanceof JsonFetchError && ["workflow_fingerprint_mismatch", "graph_validation_failed"].includes(requestError.code ?? ""),
      );
      onEvent?.(message, "error");
      return null;
    } finally {
      if (activeRunOperationRef.current === operation) {
        activeRunOperationRef.current = null;
        if (workspaceKeyRef.current === requestWorkspaceKey) setStatus("idle");
      }
    }
  }, [busy, ensureSession, nextAction, onEvent, onRunWorkflow, runConfirmationBlocker, session, setScopedSession]);

  const reconcileFailedRequest = useCallback(async (sessionId: string, failure: NonNullable<typeof failedRequest>, signal: AbortSignal) => {
    const expectedWorkspaceKey = workspaceKeyRef.current;
    const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(5_000)]);
    const progress = await jsonFetch<AssistantProgress>(`/api/control/media/assistant/sessions/${sessionId}/progress`, { signal: boundedSignal });
    const refreshed = await jsonFetch<AssistantSession>(`/api/control/media/assistant/sessions/${sessionId}`, { signal: boundedSignal });
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    if (workspaceKeyRef.current !== expectedWorkspaceKey) return false;
    hydrateExistingSession(refreshed, expectedWorkspaceKey);
    restoreRecoveredPlan(refreshed, failure);
    const { requestPersisted, replyFound, outcome } = failedRequestOutcome(refreshed, failure);
    setFailedRequest(replyFound ? null : { ...failure, checked: !progress.active });
    const message = replyFound || outcome || progress.active ? null : failure.editable
      ? "No completed reply was found in the saved conversation. Your original request is available to edit, or you can check again."
      : "No completed reply was found in the saved conversation. Review saved work and the available recovery choices before continuing.";
    setError(message);
    if (message && failure.detail) setErrorDetails({ message, detail: failure.detail });
    if (!replyFound && failure.editable && (!requestPersisted || !progress.active)) setDraft(current => current || failure.content);
    if (progress.active) setStatus("monitoring");
    return progress.active;
  }, [hydrateExistingSession, restoreRecoveredPlan]);


  const createPlanFromMessage = useCallback(async (
    message: string,
    options?: {
      appendUserMessage?: boolean;
      assistantSession?: AssistantSession;
      workflowOverride?: GraphWorkflowPayload;
      showPlan?: boolean;
      clearDraft?: boolean;
    },
  ) => {
    const normalizedMessage = message.trim();
    if (!normalizedMessage || busy || applyRecovery || (failedRequest && !failedRequest.checked)) return null;
    const requestWorkspaceKey = workspaceKeyRef.current;
    const requestWorkflow = options?.workflowOverride ?? workflow;
    const sourceWorkflowSignature = graphWorkflowSnapshotSignature(workflow);
    const requestCanvasContext = options?.workflowOverride
      ? buildCreativeAssistantCanvasContext(requestWorkflow, { selectedNodeIds, selectedGroupIds })
      : canvasContext;
    setStatus("planning");
    setError(null);
    setFailedRequest(null);
    setPlan(null);
    let requestSessionId: string | undefined;
    let previousMessageIds: string[] = [];
    let monitoring = false;
    let requestSignal: AbortSignal | undefined;
    try {
      const currentSession = await runAbortableRequest(async (signal) => {
        requestSignal = signal;
        return options?.assistantSession ?? session ?? await ensureSession(signal);
      });
      if (workspaceKeyRef.current !== requestWorkspaceKey) return null;
      requestSessionId = currentSession.assistant_session_id;
      previousMessageIds = currentSession.messages.map(message => message.assistant_message_id);
      if (options?.appendUserMessage ?? true) {
        setScopedSession((current) => appendOptimisticUserMessage(current, currentSession, normalizedMessage, { source: "plan_graph", assistant_mode: assistantMode }));
      }
      if (options?.clearDraft) setDraft("");
      const planRequest = await runAbortableRequest(async (signal) => {
        requestSignal = signal;
        try {
          const result = await jsonFetch<AssistantPlanResponse>(`/api/control/media/assistant/sessions/${currentSession.assistant_session_id}/plans`, {
            method: "POST",
            signal,
            body: JSON.stringify({
              message: normalizedMessage,
              workflow: requestWorkflow,
              canvas_context: requestCanvasContext,
              capability: "plan_graph",
              run_id: latestRunId ?? null,
              assistant_mode: assistantMode,
            }),
          });
          const updatedSession = await jsonFetch<AssistantSession>(
            `/api/control/media/assistant/sessions/${currentSession.assistant_session_id}`,
            { signal },
          );
          return { kind: "plan" as const, result, updatedSession };
        } catch (requestError) {
          if (!isClarificationPlanError(requestError)) throw requestError;
          const refreshedSession = await jsonFetch<AssistantSession>(
            `/api/control/media/assistant/sessions/${currentSession.assistant_session_id}`,
            { signal },
          );
          if (signal.aborted) throw new DOMException("Aborted", "AbortError");
          if (!hasNewPlanClarification(currentSession, refreshedSession, normalizedMessage)) {
            throw requestError;
          }
          return { kind: "clarification" as const, updatedSession: refreshedSession };
        }
      });
      if (workspaceKeyRef.current !== requestWorkspaceKey) return null;
      if (planRequest.kind === "clarification") {
        setScopedSession(planRequest.updatedSession);
        setPlan(null);
        setError(null);
        onEvent?.("Assistant needs more information.", "muted");
        return null;
      }
      const { result, updatedSession } = planRequest;
      planWorkflowOverrideRef.current = options?.workflowOverride
        ? {
            planId: result.plan.assistant_plan_id,
            baseWorkflow: requestWorkflow,
            sourceWorkflowSignature,
          }
        : null;
      if (options?.showPlan === false) {
        setPlan(null);
      } else {
        setPlan(result);
      }
      setScopedSession({ ...updatedSession, status: result.validation.valid ? "plan_ready" : "failed" });
      if (options?.showPlan !== false) {
        onEvent?.(result.validation.valid ? "Assistant plan is ready." : "Assistant plan needs fixes.", result.validation.valid ? "success" : "warning");
      }
      return result;
    } catch (requestError) {
      if (requestSignal?.aborted || workspaceKeyRef.current !== requestWorkspaceKey) return null;
      if (isAbortError(requestError)) {
        reportAbortableStop("Assistant planning stopped.");
        return null;
      }
      const failure: FailedAssistantRequest = {
        content: normalizedMessage, checked: false, code: "assistant_response_lost",
        status: requestError instanceof JsonFetchError ? requestError.status : null,
        previousMessageIds, editable: options?.clearDraft === true,
        detail: assistantErrorMessage(requestError, "No further details available."),
        planning: { workflowOverride: options?.workflowOverride, sourceWorkflowSignature, showPlan: options?.showPlan !== false },
      };
      setFailedRequest(failure);
      try {
        if (requestSessionId) monitoring = await runAbortableRequest(signal => {
          requestSignal = signal;
          return reconcileFailedRequest(requestSessionId!, failure, signal);
        });
        else {
          setFailedRequest({ ...failure, checked: true });
          setError("Couldn’t start graph preparation. Check your connection and AI Models, then try again.");
          if (failure.editable) setDraft(current => current || normalizedMessage);
        }
      } catch (recoveryError) {
        if (isAbortError(recoveryError) || requestSignal?.aborted || workspaceKeyRef.current !== requestWorkspaceKey) return null;
        reportOperationFailure(recoveryError, "Couldn’t confirm whether the graph proposal was prepared. Reload the saved conversation before trying again.");
        if (failure.editable) setDraft(current => current || normalizedMessage);
      }
      return null;
    } finally {
      if (!monitoring && !requestSignal?.aborted && workspaceKeyRef.current === requestWorkspaceKey) finishAbortableOperation();
    }
  }, [applyRecovery, assistantMode, busy, canvasContext, ensureSession, failedRequest, finishAbortableOperation, latestRunId, onEvent, reconcileFailedRequest, reportAbortableStop, reportOperationFailure, runAbortableRequest, selectedGroupIds, selectedNodeIds, session, setScopedSession, workflow]);

  const useSavedArtifactInGraph = useCallback(async (message: AssistantMessage) => {
    const artifact = savedArtifactFromMessage(message);
    const prompt = savedArtifactGraphPrompt(message);
    if (!prompt || !artifact) {
      onEvent?.("Saved artifact details are missing.", "warning");
      return null;
    }
    return createPlanFromMessage(prompt, {
      workflowOverride: blankGraphWorkflowPayload(`${artifact.label} workflow`),
    });
  }, [createPlanFromMessage, onEvent]);

  const openSavedArtifactEditor = useCallback((message: AssistantMessage) => {
    const url = savedArtifactEditorUrl(message, reviewReturnTo);
    if (!url) {
      onEvent?.("Saved artifact details are missing.", "warning");
      return;
    }
    onBeforeReviewNavigate?.();
    openAssistantReviewUrl(url);
  }, [onBeforeReviewNavigate, onEvent, reviewReturnTo]);


  const reloadConversation = useCallback(async () => {
    if (busy) return;
    if (sessionLoadFailed) {
      const expectedWorkspace = workspaceKeyRef.current;
      let reloadSignal: AbortSignal | undefined;
      let recovered = false;
      setStatus("monitoring");
      try {
        const existing = await runAbortableRequest(signal => { reloadSignal = signal; return loadExistingSession(signal); });
        recovered = Boolean(existing);
        setSessionLoadFailed(false);
        setError(null);
      } catch (requestError) {
        if (isAbortError(requestError)) return;
        reportOperationFailure(requestError, "Couldn’t load your saved conversation. Check your connection, then reload the conversation.");
      } finally { if (!recovered && !reloadSignal?.aborted && workspaceKeyRef.current === expectedWorkspace) finishAbortableOperation(); }
      return;
    }
    if (!session || !failedRequest) return;
    const expectedWorkspaceKey = workspaceKeyRef.current;
    setStatus("sending");
    try {
      const active = await runAbortableRequest(signal => reconcileFailedRequest(session.assistant_session_id, failedRequest, signal));
      if (!active && workspaceKeyRef.current === expectedWorkspaceKey) setStatus("idle");
    } catch (requestError) {
      if (isAbortError(requestError) || workspaceKeyRef.current !== expectedWorkspaceKey) return;
      setError("Unable to check the saved conversation. Check your connection and reload before sending again.");
      setStatus("idle");
    }
  }, [busy, failedRequest, finishAbortableOperation, loadExistingSession, reconcileFailedRequest, reportOperationFailure, runAbortableRequest, session, sessionLoadFailed]);

  const sendContentMessage = useCallback(async (rawContent: string, options?: { clearDraft?: boolean; metadata?: Record<string, unknown>; skipAutoActions?: boolean; continuation?: AssistantRecipeContinuationAction }) => {
    const content = rawContent.trim();
    if (!content || busy || applyRecovery || (failedRequest && !failedRequest.checked)) return null;
    const requestWorkspaceKey = workspaceKeyRef.current;
    if (session && sessionWorkspaceKeyRef.current !== requestWorkspaceKey) return null;
    setStatus("sending");
    setFailedRequest(null);
    setError(null);
    setRunConfirmationNeedsRecheck(false);
    let requestSessionId: string | undefined;
    let requestSignal: AbortSignal | undefined;
    let monitoring = false;
    let previousMessageIds: string[] = [];
    try {
      const currentSession = await runAbortableRequest(signal => {
        requestSignal = signal;
        return ensureSession(signal);
      });
      requestSessionId = currentSession.assistant_session_id;
      previousMessageIds = currentSession.messages.map(message => message.assistant_message_id);
      if (workspaceKeyRef.current !== requestWorkspaceKey) return null;
      setScopedSession((current) =>
        appendOptimisticUserMessage(current, currentSession, content, {
          source: "chat",
          assistant_mode: assistantMode,
          metadata: options?.metadata ?? {},
        }),
      );
      if (options?.clearDraft !== false) setDraft("");
      const updated = await runAbortableRequest((signal) => {
        requestSignal = signal;
        return jsonFetch<AssistantSession>(`/api/control/media/assistant/sessions/${currentSession.assistant_session_id}/messages`, {
          method: "POST",
          signal,
          body: JSON.stringify({
            content_text: content,
            continuation: options?.continuation,
            workflow,
            canvas_context: canvasContext,
            run_id: latestRunId ?? null,
            assistant_mode: assistantMode,
            metadata: options?.metadata ?? {},
          }),
        });
      });
      if (workspaceKeyRef.current !== requestWorkspaceKey) return null;
      planWorkflowOverrideRef.current = null;
      setScopedSession(updated);
      onEvent?.("Assistant message saved.", "muted");
      const kernelPayload = latestAssistantPayload(updated);
      if (kernelPayload?.mode === "assistant_kernel") {
        const action = latestKernelNextAction(updated);
        const persistedPlan = persistedPlanForWorkflow(updated, workflowId);
        if (
          action?.kind === "confirm_graph" &&
          action.proposal_id &&
          persistedPlan?.plan.assistant_plan_id === action.proposal_id
        ) {
          setPlan(persistedPlan);
        } else {
          setPlan(null);
        }
        return updated;
      }
      return updated;
    } catch (requestError) {
      if (requestSignal?.aborted || workspaceKeyRef.current !== requestWorkspaceKey) return null;
      if (isAbortError(requestError)) {
        reportAbortableStop("Assistant request stopped.");
        return null;
      }
      const failure = {
        content, checked: false,
        code: requestError instanceof JsonFetchError && ["assistant_provider_failed", "assistant_unavailable", "assistant_session_busy", "assistant_turn_interrupted"].includes(requestError.code ?? "") ? requestError.code! : "assistant_response_lost",
        status: requestError instanceof JsonFetchError ? requestError.status : null,
        previousMessageIds,
        editable: !options?.continuation && !options?.metadata?.planning_recovery_id,
      };
      setFailedRequest(failure);
      try {
        if (requestSessionId) monitoring = await runAbortableRequest(signal => {
          requestSignal = signal;
          return reconcileFailedRequest(requestSessionId!, failure, signal);
        });
        else {
          setFailedRequest({ ...failure, checked: true });
          setError("Media Assistant couldn't start this request. Check your connection and AI Models, then try again.");
          setDraft(current => current || content);
        }
      } catch (recoveryError) {
        if (isAbortError(recoveryError) || requestSignal?.aborted || workspaceKeyRef.current !== requestWorkspaceKey) return null;
        setError("Unable to confirm the request's outcome. Check the saved conversation before sending again.");
        setDraft(current => current || content);
      }
      return null;
    } finally {
      if (!monitoring && !requestSignal?.aborted && workspaceKeyRef.current === requestWorkspaceKey) finishAbortableOperation();
    }
  }, [applyRecovery, assistantMode, busy, canvasContext, ensureSession, failedRequest, finishAbortableOperation, latestRunId, onEvent, reconcileFailedRequest, reportAbortableStop, runAbortableRequest, setScopedSession, workflow, workflowId]);

  const sendMessage = useCallback(async () => sendContentMessage(draft), [draft, sendContentMessage]);

  const createPlan = useCallback(async () => {
    const message = draft.trim();
    return createPlanFromMessage(message, { clearDraft: true });
  }, [createPlanFromMessage, draft]);

  const createPlanFromContent = useCallback(
    async (message: string) => createPlanFromMessage(message),
    [createPlanFromMessage],
  );

  const createPromptRecipeDraft = useCallback(async () => {
    const message = draft.trim();
    if (!message || busy) return null;
    setStatus("draftingRecipe");
    setError(null);
    try {
      const currentSession = session ?? (await ensureSession());
      setScopedSession((current) => appendOptimisticUserMessage(current, currentSession, message, { source: "draft_prompt_recipe", assistant_mode: assistantMode }));
      setDraft("");
      return await createPromptRecipeDraftFromMessage(message, currentSession.assistant_session_id);
    } catch (requestError) {
      if (isAbortError(requestError)) {
        reportAbortableStop("Prompt Recipe draft stopped.");
        return null;
      }
      const errorMessage = assistantErrorMessage(requestError, "Unable to create Prompt Recipe draft.");
      setError(errorMessage);
      onEvent?.(errorMessage, "error");
      return null;
    } finally {
      finishAbortableOperation();
    }
  }, [assistantMode, busy, createPromptRecipeDraftFromMessage, draft, ensureSession, finishAbortableOperation, onEvent, reportAbortableStop, session, setScopedSession]);

  const createMediaPresetDraft = useCallback(async () => {
    const message = draft.trim();
    if (!message || busy) return null;
    setStatus("draftingPreset");
    setError(null);
    try {
      const currentSession = session ?? (await ensureSession());
      setScopedSession((current) => appendOptimisticUserMessage(current, currentSession, message, { source: "draft_media_preset", assistant_mode: assistantMode }));
      setDraft("");
      return await createMediaPresetDraftFromMessage(message, currentSession.assistant_session_id);
    } catch (requestError) {
      if (isAbortError(requestError)) {
        reportAbortableStop("Media Preset draft stopped.");
        return null;
      }
      const errorMessage = assistantErrorMessage(requestError, "Unable to create Media Preset draft.");
      setError(errorMessage);
      onEvent?.(errorMessage, "error");
      return null;
    } finally {
      finishAbortableOperation();
    }
  }, [busy, createMediaPresetDraftFromMessage, draft, ensureSession, finishAbortableOperation, onEvent, reportAbortableStop, session, setScopedSession]);

  // A lost attachment reply can follow a committed write. Only a fresh session read permits replay.
  const reconcileReferenceAttachment = useCallback(async (
    pending: { sessionId: string; referenceId: string }, operation: symbol,
  ) => {
    try {
      const updated = await jsonFetch<AssistantSession>(`/api/control/media/assistant/sessions/${pending.sessionId}`);
      if (referenceOperationRef.current !== operation) return null;
      if (updated.assistant_session_id !== pending.sessionId || !Array.isArray(updated.attachments)) {
        throw new Error("The attached image list could not be confirmed.");
      }
      setScopedSession((current) => current?.assistant_session_id === pending.sessionId
        ? { ...current, attachments: updated.attachments } : current);
      setReferenceRecovery(null);
      const attached = updated.attachments.find((item) => item.reference_id === pending.referenceId) ?? null;
      setError(attached ? null : "The reference image wasn’t attached. Choose it again to attach it.");
      onEventRef.current?.(attached ? "Reference image attachment confirmed." : "The reference image wasn’t attached. Choose it again to attach it.", attached ? "success" : "error");
      return attached;
    } catch (requestError) {
      if (referenceOperationRef.current === operation) {
        reportOperationFailure(requestError, "Couldn’t check the attached images. Retry checking before attaching another image.");
      }
      return null;
    }
  }, [reportOperationFailure, setScopedSession]);

  const retryReferenceRecovery = useCallback(async () => {
    if (!referenceRecovery || scopedStatus !== "idle") return;
    const operation = Symbol("check-reference-attachment");
    referenceOperationRef.current = operation;
    setStatus("refreshing");
    try { await reconcileReferenceAttachment(referenceRecovery, operation); }
    finally {
      if (referenceOperationRef.current === operation) { referenceOperationRef.current = null; setStatus("idle"); }
    }
  }, [reconcileReferenceAttachment, referenceRecovery, scopedStatus]);

  const attachReference = useCallback(async (reference: MediaReference, label?: string | null) => {
    if (busy) return null;
    const existing = session?.attachments.find((item) => item.reference_id === reference.reference_id);
    if (existing) return existing;
    let attachmentSessionId: string | null = null;
    const operation = Symbol("attach-reference");
    referenceOperationRef.current = operation;
    const ownsOperation = () => referenceOperationRef.current === operation;
    setStatus("uploading");
    setError(null);
    try {
      const currentSession = await ensureSession();
      if (!ownsOperation()) return null;
      attachmentSessionId = currentSession.assistant_session_id;
      const attachment = await jsonFetch<AssistantAttachment>(`/api/control/media/assistant/sessions/${currentSession.assistant_session_id}/attachments`, {
        method: "POST",
        body: JSON.stringify({ reference_id: reference.reference_id, label: label || reference.original_filename || "Reference media" }),
      });
      if (!ownsOperation()) return null;
      setScopedSession((current) =>
        current
          ? {
              ...current,
              attachments: [...current.attachments.filter((item) => item.assistant_attachment_id !== attachment.assistant_attachment_id), attachment],
            }
          : {
              ...currentSession,
              attachments: [attachment],
            },
      );
      onEvent?.("Reference image attached to assistant context.", "success");
      return attachment;
    } catch (requestError) {
      if (!ownsOperation()) return null;
      reportOperationFailure(requestError, "Couldn’t confirm that the reference image was attached. Checking the saved attached images before trying again.");
      if (attachmentSessionId && !requestRejectionMessage(requestError)) {
        const pending = { sessionId: attachmentSessionId, referenceId: reference.reference_id };
        setReferenceRecovery(pending);
        return await reconcileReferenceAttachment(pending, operation);
      }
      return null;
    } finally {
      if (ownsOperation()) { referenceOperationRef.current = null; setStatus("idle"); }
    }
  }, [busy, ensureSession, onEvent, reconcileReferenceAttachment, reportOperationFailure, session, setScopedSession]);

  const attachFile = useCallback(async (file: File, onImported?: (reference: MediaReference) => void) => {
    if (busy) return null;
    const operation = Symbol("import-reference");
    referenceOperationRef.current = operation;
    const ownsOperation = () => referenceOperationRef.current === operation;
    setStatus("uploading");
    setError(null);
    try {
      const reference = await importImageFile(file);
      if (!ownsOperation()) return null;
      onImported?.(reference);
      return await attachReference(reference, file.name);
    } catch (requestError) {
      if (ownsOperation()) reportReferenceImportFailure(requestError);
      return null;
    } finally {
      if (ownsOperation()) { referenceOperationRef.current = null; setStatus("idle"); }
    }
  }, [attachReference, busy, importImageFile, reportReferenceImportFailure]);

  const removeAttachment = useCallback(async (attachmentId: string) => {
    if (!session || busy) return false;
    const operation = Symbol("remove-reference");
    referenceOperationRef.current = operation;
    const ownsOperation = () => referenceOperationRef.current === operation;
    setStatus("uploading");
    setError(null);
    try {
      await jsonFetch<{ ok: boolean }>(
        `/api/control/media/assistant/sessions/${session.assistant_session_id}/attachments/${attachmentId}`,
        { method: "DELETE" },
      );
      if (!ownsOperation()) return false;
      setScopedSession((current) =>
        current
          ? {
              ...current,
              attachments: current.attachments.filter((attachment) => attachment.assistant_attachment_id !== attachmentId),
            }
          : current,
      );
      onEvent?.("Reference image removed from assistant context.", "muted");
      return true;
    } catch (requestError) {
      if (!ownsOperation()) return false;
      reportOperationFailure(requestError, "Couldn’t confirm that the reference image was removed. Check the attached images before trying again.");
      return false;
    } finally {
      if (ownsOperation()) { referenceOperationRef.current = null; setStatus("idle"); }
    }
  }, [busy, onEvent, reportOperationFailure, session, setScopedSession]);

  const applyPlan = useCallback(async () => {
    if (!plan || !canApply) return null;
    const override = planWorkflowOverrideRef.current;
    const applyWorkflow = override?.planId === plan.plan.assistant_plan_id &&
      override.sourceWorkflowSignature === graphWorkflowSnapshotSignature(workflow)
      ? override.baseWorkflow
      : workflow;
    return applyPlanResponse(plan, applyWorkflow, nextAction);
  }, [applyPlanResponse, canApply, nextAction, plan, workflow]);

  const cancelAssistant = useCallback(async () => {
    const requestWorkspaceKey = workspaceKeyRef.current;
    cancellationPendingRef.current = true;
    setStatus("cancelling");
    try {
      const updated = await runAbortableRequest(async (signal) => {
        const currentSession = session ?? (await loadExistingSession(signal));
        return currentSession ? jsonFetch<AssistantSession>(`/api/control/media/assistant/sessions/${currentSession.assistant_session_id}/cancel`, {
          method: "POST", signal,
        }) : null;
      });
      if (workspaceKeyRef.current !== requestWorkspaceKey) return;
      if (updated) setScopedSession(updated);
      setError(null);
      onEvent?.("Assistant stopped.", "muted");
      cancellationPendingRef.current = false;
      setStatus("idle");
    } catch (requestError) {
      if (isAbortError(requestError) || workspaceKeyRef.current !== requestWorkspaceKey) return;
      reportOperationFailure(requestError, "Couldn’t confirm that the assistant stopped. Check your connection and choose Stop again.");
      setStatus("cancelling");
    }
  }, [loadExistingSession, onEvent, reportOperationFailure, runAbortableRequest, session, setScopedSession]);

  return useMemo(
    () => ({
      session,
      draft,
      setDraft,
      plan,
      deliveredPlanId,
      failedApplyPlanId,
      applyRecovery,
      recoverGraphApply,
      progress,
      progressUnavailable,
      progressUpdatedAt,
      status: scopedStatus,
      busy,
      cancellable,
      error,
      errorDetails: errorDetails?.message === error ? errorDetails.detail : null,
      reportReferenceImportFailure,
      failedRequest,
      reloadConversation,
      sessionLoadFailed,
      artifactRefreshFailure,
      retryArtifactRefresh,
      runConfirmationNeedsRecheck,
      runConfirmationBlocker,
      runSubmissionUncertain,
      providerReadiness,
      refreshProviderReadiness,
      referenceRecovery,
      retryReferenceRecovery,
      canPlan,
      canApply,
      nextAction,
      sendMessage,
      sendContentMessage,
      confirmPresetSave,
      confirmRecipeSave,
      confirmRunWorkflow,
      createPlan,
      createPlanFromContent,
      createPromptRecipeDraft,
      createMediaPresetDraft,
      saveMediaPresetFromMessage,
      savePromptRecipeFromMessage,
      useSavedArtifactInGraph,
      openSavedArtifactEditor,
      attachReference,
      attachFile,
      removeAttachment,
      applyPlan,
      cancelAssistant,
    }),
    [
      applyPlan,
      attachFile,
      attachReference,
      busy,
      cancellable,
      canApply,
      nextAction,
      canPlan,
      cancelAssistant,
      confirmPresetSave,
      confirmRecipeSave,
      confirmRunWorkflow,
      createMediaPresetDraft,
      createPlan,
      createPlanFromContent,
      createPromptRecipeDraft,
      draft,
      error,
      errorDetails,
      reportReferenceImportFailure,
      failedRequest,
      reloadConversation,
      sessionLoadFailed,
      artifactRefreshFailure,
      retryArtifactRefresh,
      runConfirmationNeedsRecheck,
      runConfirmationBlocker,
      runSubmissionUncertain,
      plan,
      deliveredPlanId,
      failedApplyPlanId,
      applyRecovery,
      recoverGraphApply,
      progress,
      progressUnavailable,
      progressUpdatedAt,
      providerReadiness,
      refreshProviderReadiness,
      referenceRecovery,
      retryReferenceRecovery,
      removeAttachment,
      openSavedArtifactEditor,
      saveMediaPresetFromMessage,
      savePromptRecipeFromMessage,
      sendContentMessage,
      sendMessage,
      session,
      scopedStatus,
      useSavedArtifactInGraph,
    ],
  );
}
