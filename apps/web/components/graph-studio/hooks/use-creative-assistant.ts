"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";

import type { MediaReference } from "@/lib/types";
import { assistantReviewReturnTarget, openAssistantReviewDraft, openAssistantReviewUrl, writeAssistantReviewDraft } from "@/lib/assistant-review-drafts";
import { invalidateGraphNodeDefinitions, refreshGraphNodeDefinitionsOnServer } from "@/lib/graph-node-definitions-sync";
import { providerReadinessFromHealth } from "@/lib/llm-provider-health";
import type { ControlApiHealthData } from "@/lib/types";
import type {
  AssistantAttachment,
  AssistantArtifactSaveResponse,
  AssistantMessage,
  AssistantMediaPresetDraftResponse,
  AssistantNextAction,
  AssistantPlan,
  AssistantPlanResponse,
  AssistantPromptRecipeDraftResponse,
  GraphEstimateResponse,
  GraphValidationResult,
  AssistantSession,
  GraphWorkflowPayload,
} from "../types";
import { JsonFetchError, jsonFetch } from "../utils/graph-api";
import { blankGraphWorkflowPayload } from "../utils/graph-tabs";
import { buildCreativeAssistantCanvasContext } from "../utils/creative-assistant-canvas-context";

export type AssistantMode = "preset" | "recipe" | "graph";

type AssistantStatus = "idle" | "sending" | "planning" | "draftingRecipe" | "draftingPreset" | "savingRecipe" | "savingPreset" | "applying" | "uploading" | "cancelling";
export type PresetLoopLane = "text_to_image" | "image_to_image" | "both";

const ASSISTANT_REQUEST_TIMEOUT_MS = 130_000;

const PRESET_LOOP_START_MESSAGES: Record<PresetLoopLane, string> = {
  text_to_image: "Can you create a text-to-image media preset from these reference images?",
  image_to_image: "Can you create an image-to-image media preset from these reference images?",
  both: "Can you create both image-to-image and text-to-image media presets from these reference images?",
};

type AssistantProviderReadiness = {
  checked: boolean;
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
  if (artifact.kind === "media_preset") {
    const exactPreset = artifact.key ? ` and key ${artifact.key}` : "";
    return `Create a clean replacement workflow that uses the saved Media Preset named ${artifact.label} with exact id ${artifact.id}${exactPreset}. Fill every required text field with useful alternate sample values so the graph validates and the user can change them through visible form controls. Leave required image inputs empty so the user can attach the correct images before running.`;
  }
  return `Create a clean replacement workflow that uses the saved Prompt Recipe named ${artifact.label}, then sends the rendered prompt into a compatible text-to-image model with preview and save image nodes.`;
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
  if (workflowId) {
    if (assistantSession.owner_kind !== "graph_workflow" || assistantSession.owner_id !== workflowId) return null;
    const planWorkflowId = persistedPlan.workflow.workflow_id ?? null;
    if (planWorkflowId !== workflowId && persistedPlan.plan.applied_workflow_id !== workflowId) return null;
  } else if (assistantSession.owner_kind !== "standalone" || persistedPlan.workflow.workflow_id) {
    return null;
  }
  return persistedPlan;
}

function latestAssistantPayload(session: AssistantSession | null) {
  if (!session) return null;
  for (let index = session.messages.length - 1; index >= 0; index -= 1) {
    const message = session.messages[index];
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
  if (kind !== "none" && (!label || !actionPayload)) return null;
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
  onApplyWorkflow: (workflow: GraphWorkflowPayload, options?: { highlightNodeIds?: string[]; baseWorkflow?: GraphWorkflowPayload }) => Promise<void> | void;
  onRunWorkflow?: (assistantConfirmation?: { sessionId: string; token: string }) => Promise<unknown> | void;
  onEvent?: (message: string, tone?: "success" | "warning" | "error" | "muted") => void;
}) {
  const [session, setSession] = useState<AssistantSession | null>(null);
  const [draft, setDraft] = useState("");
  const [plan, setPlan] = useState<AssistantPlanResponse | null>(null);
  const [status, setStatus] = useState<AssistantStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [runConfirmationNeedsRecheck, setRunConfirmationNeedsRecheck] = useState(false);
  const [providerReadiness, setProviderReadiness] = useState<AssistantProviderReadiness>({
    checked: false,
    ready: false,
    configured: false,
    commandAvailable: false,
    loginConfigured: false,
  });
  const activeAbortControllerRef = useRef<AbortController | null>(null);
  const activeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workspaceKeyRef = useRef(workspaceKey);
  const initialAssistantSessionIdRef = useRef(initialAssistantSessionId);
  const sessionWorkspaceKeyRef = useRef<string | null>(null);
  const planApplyWorkflowRef = useRef<GraphWorkflowPayload | null>(null);

  const busy = status !== "idle";
  const canPlan = draft.trim().length > 0 && !busy;
  const nextAction = useMemo(() => latestKernelNextAction(session), [session]);
  const latestPayload = useMemo(() => latestAssistantPayload(session), [session]);
  const kernelActionRequired = latestPayload?.mode === "assistant_kernel";
  const canApply = Boolean(
    plan?.plan.status === "validated" &&
    !busy &&
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
    () => buildCreativeAssistantCanvasContext(workflow, { selectedNodeIds, selectedGroupIds }),
    [selectedGroupIds, selectedNodeIds, workflow],
  );

  const setScopedSession = useCallback((nextSession: SetStateAction<AssistantSession | null>) => {
    setSession((current) => {
      const resolvedSession = typeof nextSession === "function" ? nextSession(current) : nextSession;
      sessionWorkspaceKeyRef.current = resolvedSession ? workspaceKeyRef.current : null;
      return resolvedSession;
    });
  }, []);

  const resetAssistantState = useCallback(() => {
    activeAbortControllerRef.current?.abort();
    if (activeTimeoutRef.current) {
      clearTimeout(activeTimeoutRef.current);
      activeTimeoutRef.current = null;
    }
    sessionWorkspaceKeyRef.current = null;
    setScopedSession(null);
    setPlan(null);
    planApplyWorkflowRef.current = null;
    setDraft("");
    setError(null);
    setRunConfirmationNeedsRecheck(false);
    setStatus("idle");
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
    if (!previousAssistantSessionId || initialAssistantSessionId) return;
    resetAssistantState();
  }, [initialAssistantSessionId, resetAssistantState]);

  useEffect(() => {
    if (session?.assistant_session_id && sessionWorkspaceKeyRef.current === workspaceKey) {
      onAssistantSessionChange?.(session.assistant_session_id);
    }
  }, [onAssistantSessionChange, session?.assistant_session_id, workspaceKey]);

  const runAbortableRequest = useCallback(async <T,>(request: (signal: AbortSignal) => Promise<T>) => {
    activeAbortControllerRef.current?.abort();
    const controller = new AbortController();
    activeAbortControllerRef.current = controller;
    if (activeTimeoutRef.current) {
      clearTimeout(activeTimeoutRef.current);
    }
    activeTimeoutRef.current = setTimeout(() => {
      controller.abort();
    }, ASSISTANT_REQUEST_TIMEOUT_MS);
    try {
      return await request(controller.signal);
    } finally {
      if (activeAbortControllerRef.current === controller) {
        activeAbortControllerRef.current = null;
      }
      if (activeTimeoutRef.current) {
        clearTimeout(activeTimeoutRef.current);
        activeTimeoutRef.current = null;
      }
    }
  }, []);

  const hydrateExistingSession = useCallback((existing: AssistantSession, expectedWorkspaceKey: string) => {
    if (workspaceKeyRef.current !== expectedWorkspaceKey) return false;
    const persistedPlan = persistedPlanForWorkflow(existing, workflowId);
    setScopedSession(existing);
    setPlan(persistedPlan);
    planApplyWorkflowRef.current = persistedPlan?.plan.status === "validated" ? workflow : null;
    return true;
  }, [setScopedSession, workflow, workflowId]);

  const loadExistingSession = useCallback(async () => {
    const expectedWorkspaceKey = workspaceKeyRef.current;
    if (initialAssistantSessionId) {
      if (session?.assistant_session_id === initialAssistantSessionId) return session;
      const existing = await jsonFetch<AssistantSession>(`/api/control/media/assistant/sessions/${encodeURIComponent(initialAssistantSessionId)}`);
      return hydrateExistingSession(existing, expectedWorkspaceKey) ? existing : null;
    }
    if (session) return session;
    if (!workflowId) return null;
    const existing = await jsonFetch<{ items?: AssistantSession[] }>(
      `/api/control/media/assistant/sessions?owner_kind=graph_workflow&owner_id=${encodeURIComponent(workflowId)}&limit=1`,
    );
    const latest = existing.items?.[0] ?? null;
    if (latest && !hydrateExistingSession(latest, expectedWorkspaceKey)) return null;
    return latest;
  }, [hydrateExistingSession, initialAssistantSessionId, session, workflowId]);

  const ensureSession = useCallback(async () => {
    const expectedWorkspaceKey = workspaceKeyRef.current;
    if (session) return session;
    const latest = await loadExistingSession();
    if (latest) return latest;
    const created = await jsonFetch<AssistantSession>("/api/control/media/assistant/sessions", {
      method: "POST",
      body: JSON.stringify({
        owner_kind: workflowId ? "graph_workflow" : "standalone",
        owner_id: workflowId,
        workflow,
        canvas_context: canvasContext,
        assistant_mode: assistantMode,
        title: `${workflowName || "Graph"} assistant`,
      }),
    });
    if (workspaceKeyRef.current !== expectedWorkspaceKey) return created;
    setScopedSession(created);
    return created;
  }, [assistantMode, canvasContext, loadExistingSession, session, setScopedSession, workflow, workflowId, workflowName]);

  useEffect(() => {
    if (!enabled) return;
    const requestedSessionChanged = Boolean(
      initialAssistantSessionId && session?.assistant_session_id !== initialAssistantSessionId,
    );
    if (!requestedSessionChanged && (session || (!workflowId && !initialAssistantSessionId))) return;
    let cancelled = false;
    loadExistingSession().catch((requestError) => {
      if (cancelled) return;
      const message = assistantErrorMessage(requestError, "Unable to load assistant session.");
      setError(message);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, initialAssistantSessionId, loadExistingSession, session, workflowId]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch("/api/control/health", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Health check returned ${response.status}.`);
        return (await response.json()) as ControlApiHealthData;
      })
      .then((payload) => {
        if (cancelled) return;
        const readiness = providerReadinessFromHealth(payload).codexLocal;
        setProviderReadiness({
          checked: true,
          ready: readiness.ready,
          configured: readiness.configured,
          commandAvailable: readiness.commandAvailable,
          loginConfigured: readiness.loginConfigured,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setProviderReadiness((current) => ({ ...current, checked: true }));
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

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

  const refreshDefinitionsAfterAssistantSave = useCallback(async (reason: string) => {
    try {
      await refreshGraphNodeDefinitionsOnServer();
      await invalidateGraphNodeDefinitions(reason);
    } catch (requestError) {
      onEvent?.(assistantErrorMessage(requestError, "Saved artifact, but graph node definitions could not refresh."), "warning");
    }
  }, [onEvent]);

  const saveMediaPresetFromMessage = useCallback(async (
    message: string,
    assistantSessionId?: string | null,
    confirmation?: AssistantNextAction | null,
  ) => {
    const currentSession = assistantSessionId ? ({ assistant_session_id: assistantSessionId } as AssistantSession) : session ?? (await ensureSession());
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
      setScopedSession(result.assistant_session);
      await refreshDefinitionsAfterAssistantSave("assistant-media-preset-saved");
      onEvent?.(result.message || "Media Preset saved.", "success");
      return result;
    } catch (requestError) {
      if (isAbortError(requestError)) {
        onEvent?.("Media Preset save stopped.", "muted");
        return null;
      }
      const errorMessage = assistantErrorMessage(requestError, "Unable to save Media Preset.");
      setError(errorMessage);
      onEvent?.(errorMessage, "error");
      return null;
    } finally {
      setStatus("idle");
    }
  }, [assistantMode, ensureSession, latestRunId, onEvent, refreshDefinitionsAfterAssistantSave, runAbortableRequest, session, setScopedSession, workflow]);

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
    const currentSession = assistantSessionId ? ({ assistant_session_id: assistantSessionId } as AssistantSession) : session ?? (await ensureSession());
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
      setScopedSession(result.assistant_session);
      await refreshDefinitionsAfterAssistantSave("assistant-prompt-recipe-saved");
      onEvent?.(result.message || "Prompt Recipe saved.", "success");
      return result;
    } catch (requestError) {
      if (isAbortError(requestError)) {
        onEvent?.("Prompt Recipe save stopped.", "muted");
        return null;
      }
      const errorMessage = assistantErrorMessage(requestError, "Unable to save Prompt Recipe.");
      setError(errorMessage);
      onEvent?.(errorMessage, "error");
      return null;
    } finally {
      setStatus("idle");
    }
  }, [assistantMode, ensureSession, latestRunId, onEvent, refreshDefinitionsAfterAssistantSave, runAbortableRequest, session, setScopedSession, workflow]);

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
    const payloadToken = String(nextAction?.payload?.confirmation_token || "");
    if (
      busy ||
      nextAction?.kind !== "run_workflow" ||
      !nextAction.requires_confirmation ||
      !nextAction.confirmation_token ||
      payloadToken !== nextAction.confirmation_token ||
      !onRunWorkflow
    ) {
      return null;
    }
    setStatus("sending");
    setError(null);
    setRunConfirmationNeedsRecheck(false);
    try {
      const currentSession = session ?? (await ensureSession());
      const created = await onRunWorkflow({
        sessionId: currentSession.assistant_session_id,
        token: nextAction.confirmation_token,
      });
      if (!created) return null;
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
      const message = assistantErrorMessage(requestError, "Unable to confirm this graph run.");
      setError(message);
      setRunConfirmationNeedsRecheck(
        requestError instanceof JsonFetchError && requestError.code === "workflow_fingerprint_mismatch",
      );
      onEvent?.(message, "error");
      return null;
    } finally {
      setStatus("idle");
    }
  }, [busy, ensureSession, nextAction, onEvent, onRunWorkflow, runAbortableRequest, session, setScopedSession, workflow]);

  const createPlanFromMessage = useCallback(async (
    message: string,
    options?: {
      appendUserMessage?: boolean;
      assistantSession?: AssistantSession;
      workflowOverride?: GraphWorkflowPayload;
      showPlan?: boolean;
    },
  ) => {
    const normalizedMessage = message.trim();
    if (!normalizedMessage || busy) return null;
    const requestWorkspaceKey = workspaceKeyRef.current;
    const requestWorkflow = options?.workflowOverride ?? workflow;
    const requestCanvasContext = options?.workflowOverride
      ? buildCreativeAssistantCanvasContext(requestWorkflow, { selectedNodeIds, selectedGroupIds })
      : canvasContext;
    setStatus("planning");
    setError(null);
    try {
      const currentSession = options?.assistantSession ?? session ?? (await ensureSession());
      if (workspaceKeyRef.current !== requestWorkspaceKey) return null;
      if (options?.appendUserMessage ?? true) {
        setScopedSession((current) => appendOptimisticUserMessage(current, currentSession, normalizedMessage, { source: "plan_graph", assistant_mode: assistantMode }));
      }
      setDraft("");
      planApplyWorkflowRef.current = requestWorkflow;
      const { result, updatedSession } = await runAbortableRequest(async (signal) => {
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
        return { result, updatedSession };
      });
      if (workspaceKeyRef.current !== requestWorkspaceKey) return null;
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
      if (isAbortError(requestError)) {
        onEvent?.("Assistant planning stopped.", "muted");
        return null;
      }
      const errorMessage = assistantErrorMessage(requestError, "Unable to create assistant plan.");
      setError(errorMessage);
      onEvent?.(errorMessage, "error");
      return null;
    } finally {
      setStatus("idle");
    }
  }, [assistantMode, busy, canvasContext, ensureSession, latestRunId, onEvent, runAbortableRequest, selectedGroupIds, selectedNodeIds, session, setScopedSession, workflow]);

  const applyPlanResponse = useCallback(async (
    planResponse: AssistantPlanResponse,
    applyWorkflow: GraphWorkflowPayload,
    confirmation?: AssistantNextAction | null,
  ) => {
    const applyWorkspaceKey = workspaceKeyRef.current;
    setStatus("applying");
    setError(null);
    try {
      const result = await jsonFetch<{
        plan: AssistantPlan;
        workflow: GraphWorkflowPayload;
        validation: GraphValidationResult;
        pricing: GraphEstimateResponse;
      }>(`/api/control/media/assistant/plans/${planResponse.plan.assistant_plan_id}/apply`, {
        method: "POST",
        body: JSON.stringify({
          workflow: applyWorkflow,
          ...(confirmation?.kind === "confirm_graph"
            ? {
                proposal_id: confirmation.proposal_id,
                confirmation_token: confirmation.confirmation_token,
              }
            : {}),
        }),
      });
      if (workspaceKeyRef.current !== applyWorkspaceKey) return null;
      setPlan({
        ...planResponse,
        plan: result.plan,
        workflow: result.workflow,
        validation: result.validation,
        pricing: result.pricing,
      });
      const previousNodeIds = new Set(applyWorkflow.nodes.map((node) => node.id));
      const updatedNodeIds = new Set(
        (planResponse.graph_plan.operations ?? [])
          .filter((operation) => operation["op"] === "set_node_field" || operation["op"] === "set_node_title")
          .map((operation) => String(operation["node_id"] || operation["node_ref"] || ""))
          .filter(Boolean),
      );
      const highlightNodeIds = Array.from(new Set([
        ...result.workflow.nodes.map((node) => node.id).filter((nodeId) => !previousNodeIds.has(nodeId)),
        ...result.workflow.nodes.map((node) => node.id).filter((nodeId) => updatedNodeIds.has(nodeId)),
      ]));
      await onApplyWorkflow(result.workflow, { highlightNodeIds, baseWorkflow: workflow });
      onEvent?.("Assistant plan applied to the canvas.", "success");
      return result;
    } catch (requestError) {
      const message = assistantErrorMessage(requestError, "Unable to apply assistant plan.");
      setError(message);
      onEvent?.(message, "error");
      return null;
    } finally {
      setStatus("idle");
    }
  }, [onApplyWorkflow, onEvent, workflow]);

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

  const sendContentMessage = useCallback(async (rawContent: string, options?: { clearDraft?: boolean; metadata?: Record<string, unknown>; skipAutoActions?: boolean }) => {
    const content = rawContent.trim();
    if (!content || busy) return null;
    const requestWorkspaceKey = workspaceKeyRef.current;
    if (session && sessionWorkspaceKeyRef.current !== requestWorkspaceKey) return null;
    setStatus("sending");
    setError(null);
    setRunConfirmationNeedsRecheck(false);
    try {
      const currentSession = await ensureSession();
      if (workspaceKeyRef.current !== requestWorkspaceKey) return null;
      setScopedSession((current) =>
        appendOptimisticUserMessage(current, currentSession, content, {
          source: "chat",
          assistant_mode: assistantMode,
          metadata: options?.metadata ?? {},
        }),
      );
      if (options?.clearDraft !== false) setDraft("");
      const updated = await runAbortableRequest((signal) =>
        jsonFetch<AssistantSession>(`/api/control/media/assistant/sessions/${currentSession.assistant_session_id}/messages`, {
          method: "POST",
          signal,
          body: JSON.stringify({
            content_text: content,
            workflow,
            canvas_context: canvasContext,
            run_id: latestRunId ?? null,
            assistant_mode: assistantMode,
            metadata: options?.metadata ?? {},
          }),
        }),
      );
      if (workspaceKeyRef.current !== requestWorkspaceKey) return null;
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
          planApplyWorkflowRef.current = workflow;
        } else {
          setPlan(null);
          planApplyWorkflowRef.current = null;
        }
        return updated;
      }
      return updated;
    } catch (requestError) {
      if (isAbortError(requestError)) {
        onEvent?.("Assistant request stopped.", "muted");
        return null;
      }
      const message = assistantErrorMessage(requestError, "Unable to send assistant message.");
      setError(message);
      onEvent?.(message, "error");
      return null;
    } finally {
      setStatus("idle");
    }
  }, [assistantMode, busy, canvasContext, ensureSession, latestRunId, onEvent, runAbortableRequest, setScopedSession, workflow, workflowId]);

  const sendMessage = useCallback(async () => sendContentMessage(draft), [draft, sendContentMessage]);

  const startPresetLoop = useCallback(
    async (lane: PresetLoopLane) =>
      sendContentMessage(PRESET_LOOP_START_MESSAGES[lane], {
        clearDraft: true,
        metadata: { preset_loop_lane: lane, source: "guided_loop_ui" },
        skipAutoActions: true,
      }),
    [sendContentMessage],
  );

  const createPlan = useCallback(async () => {
    const message = draft.trim();
    return createPlanFromMessage(message);
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
        onEvent?.("Prompt Recipe draft stopped.", "muted");
        return null;
      }
      const errorMessage = assistantErrorMessage(requestError, "Unable to create Prompt Recipe draft.");
      setError(errorMessage);
      onEvent?.(errorMessage, "error");
      return null;
    } finally {
      setStatus("idle");
    }
  }, [assistantMode, busy, createPromptRecipeDraftFromMessage, draft, ensureSession, onEvent, session, setScopedSession]);

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
        onEvent?.("Media Preset draft stopped.", "muted");
        return null;
      }
      const errorMessage = assistantErrorMessage(requestError, "Unable to create Media Preset draft.");
      setError(errorMessage);
      onEvent?.(errorMessage, "error");
      return null;
    } finally {
      setStatus("idle");
    }
  }, [busy, createMediaPresetDraftFromMessage, draft, ensureSession, onEvent, session, setScopedSession]);

  const attachReference = useCallback(async (reference: MediaReference, label?: string | null) => {
    if (busy) return null;
    setStatus("uploading");
    setError(null);
    try {
      const currentSession = await ensureSession();
      const attachment = await jsonFetch<AssistantAttachment>(`/api/control/media/assistant/sessions/${currentSession.assistant_session_id}/attachments`, {
        method: "POST",
        body: JSON.stringify({ reference_id: reference.reference_id, label: label || reference.original_filename || "Reference media" }),
      });
      setScopedSession((current) =>
        current
          ? {
              ...current,
              attachments: [attachment, ...current.attachments.filter((item) => item.assistant_attachment_id !== attachment.assistant_attachment_id)],
            }
          : {
              ...currentSession,
              attachments: [attachment],
            },
      );
      onEvent?.("Reference image attached to assistant context.", "success");
      return attachment;
    } catch (requestError) {
      const message = assistantErrorMessage(requestError, "Unable to attach reference media.");
      setError(message);
      onEvent?.(message, "error");
      return null;
    } finally {
      setStatus("idle");
    }
  }, [busy, ensureSession, onEvent, setScopedSession]);

  const attachFile = useCallback(async (file: File) => {
    if (busy) return null;
    setStatus("uploading");
    setError(null);
    try {
      const reference = await importImageFile(file);
      return await attachReference(reference, file.name);
    } catch (requestError) {
      const message = assistantErrorMessage(requestError, "Unable to attach reference media.");
      setError(message);
      onEvent?.(message, "error");
      return null;
    } finally {
      setStatus("idle");
    }
  }, [attachReference, busy, importImageFile, onEvent]);

  const removeAttachment = useCallback(async (attachmentId: string) => {
    if (!session || busy) return false;
    setStatus("uploading");
    setError(null);
    try {
      await jsonFetch<{ ok: boolean }>(
        `/api/control/media/assistant/sessions/${session.assistant_session_id}/attachments/${attachmentId}`,
        { method: "DELETE" },
      );
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
      const message = assistantErrorMessage(requestError, "Unable to remove reference media.");
      setError(message);
      onEvent?.(message, "error");
      return false;
    } finally {
      setStatus("idle");
    }
  }, [busy, onEvent, session, setScopedSession]);

  const applyPlan = useCallback(async () => {
    if (!plan || !canApply) return null;
    return applyPlanResponse(plan, planApplyWorkflowRef.current ?? workflow, nextAction);
  }, [applyPlanResponse, canApply, nextAction, plan, workflow]);

  const cancelAssistant = useCallback(async () => {
    activeAbortControllerRef.current?.abort();
    setStatus("cancelling");
    try {
      const currentSession = session ?? (await loadExistingSession());
      if (currentSession) {
        const updated = await jsonFetch<AssistantSession>(`/api/control/media/assistant/sessions/${currentSession.assistant_session_id}/cancel`, {
          method: "POST",
        });
        setScopedSession(updated);
      }
      setError(null);
      onEvent?.("Assistant stopped.", "muted");
    } catch (requestError) {
      const message = assistantErrorMessage(requestError, "Unable to stop assistant.");
      setError(message);
      onEvent?.(message, "error");
    } finally {
      setStatus("idle");
    }
  }, [loadExistingSession, onEvent, session, setScopedSession]);

  return useMemo(
    () => ({
      session,
      draft,
      setDraft,
      plan,
      status,
      busy,
      error,
      runConfirmationNeedsRecheck,
      providerReadiness,
      canPlan,
      canApply,
      nextAction,
      sendMessage,
      sendContentMessage,
      startPresetLoop,
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
      runConfirmationNeedsRecheck,
      plan,
      providerReadiness,
      removeAttachment,
      openSavedArtifactEditor,
      saveMediaPresetFromMessage,
      savePromptRecipeFromMessage,
      sendContentMessage,
      sendMessage,
      startPresetLoop,
      session,
      status,
      useSavedArtifactInGraph,
    ],
  );
}
