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
  AssistantPlan,
  AssistantPlanResponse,
  AssistantPromptRecipeDraftResponse,
  GraphEstimateResponse,
  GraphValidationResult,
  AssistantSession,
  GraphWorkflowPayload,
} from "../types";
import { jsonFetch } from "../utils/graph-api";
import { blankGraphWorkflowPayload } from "../utils/graph-tabs";
import {
  isAssistantSavedPresetWorkflowRequest,
  latestAssistantResponseKind,
  latestAssistantRunApprovalSource,
  latestAssistantSuggestedAction,
  resolveCreativeAssistantAutoAction,
  sessionHasImageAttachment,
  sessionHasOutputComparisonForRun,
  type AssistantMode,
} from "../utils/creative-assistant-intent";
import { buildCreativeAssistantCanvasContext } from "../utils/creative-assistant-canvas-context";
export {
  resolveCreativeAssistantAutoAction,
  shouldAutoPlanAssistantMessage,
  type AssistantMode,
  type CreativeAssistantAutoAction,
} from "../utils/creative-assistant-intent";

type AssistantStatus = "idle" | "sending" | "planning" | "draftingRecipe" | "draftingPreset" | "savingRecipe" | "savingPreset" | "applying" | "uploading" | "cancelling";
export type PresetLoopLane = "text_to_image" | "image_to_image" | "both";

const ASSISTANT_REQUEST_TIMEOUT_MS = 130_000;

const PRESET_LOOP_START_MESSAGES: Record<PresetLoopLane, string> = {
  text_to_image: "Can you create a text-to-image media preset from these reference images?",
  image_to_image: "Can you create an image-to-image media preset from these reference images?",
  both: "Can you create both image-to-image and text-to-image media presets from these reference images?",
};

const APPROVED_TEST_WORKFLOW_SAVE_MESSAGE =
  "This result is close enough. Create the official Media Preset now from this approved workflow. Use the latest generated image as the thumbnail when available.";
const AUTO_OUTPUT_COMPARE_MESSAGE =
  "Compare the latest generated output against the attached reference style. Keep it short: what matches, what is missing, and whether to refine once or save the preset.";

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
    const exactPreset = artifact.key ? ` named ${artifact.label} with key ${artifact.key}` : ` named ${artifact.label}`;
    return `Create a clean replacement workflow that uses the saved Media Preset${exactPreset}. Leave required image inputs empty so the user can attach the correct images before running.`;
  }
  return `Create a clean replacement workflow that uses the saved Prompt Recipe named ${artifact.label}, then sends the rendered prompt into an image model with preview and save image nodes.`;
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

function latestAssistantPayload(session: AssistantSession | null) {
  if (!session) return null;
  for (let index = session.messages.length - 1; index >= 0; index -= 1) {
    const message = session.messages[index];
    if (message.role !== "assistant") continue;
    return message.content_json ?? {};
  }
  return null;
}

function isSelectedNodeFieldEditReply(payload: Record<string, unknown> | null) {
  if (!payload) return false;
  return (
    payload.suggested_action === "create_graph_plan" &&
    (payload.mode === "deterministic_selected_node_field_edit" || payload.assistant_prompt_route === "selected_node_field_edit")
  );
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
  onRunWorkflow?: () => Promise<unknown> | void;
  onEvent?: (message: string, tone?: "success" | "warning" | "error" | "muted") => void;
}) {
  const [session, setSession] = useState<AssistantSession | null>(null);
  const [draft, setDraft] = useState("");
  const [plan, setPlan] = useState<AssistantPlanResponse | null>(null);
  const [status, setStatus] = useState<AssistantStatus>("idle");
  const [error, setError] = useState<string | null>(null);
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
  const autoComparedRunKeysRef = useRef<Set<string>>(new Set());

  const busy = status !== "idle";
  const canPlan = draft.trim().length > 0 && !busy;
  const canApply = Boolean(plan?.plan.status === "validated" && !busy);
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
    setScopedSession(null);
    setPlan(null);
    planApplyWorkflowRef.current = null;
    setDraft("");
    setError(null);
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

  const loadExistingSession = useCallback(async () => {
    if (initialAssistantSessionId) {
      if (session?.assistant_session_id === initialAssistantSessionId) return session;
      const existing = await jsonFetch<AssistantSession>(`/api/control/media/assistant/sessions/${encodeURIComponent(initialAssistantSessionId)}`);
      setScopedSession(existing);
      return existing;
    }
    if (session) return session;
    if (!workflowId) return null;
    const existing = await jsonFetch<{ items?: AssistantSession[] }>(
      `/api/control/media/assistant/sessions?owner_kind=graph_workflow&owner_id=${encodeURIComponent(workflowId)}&limit=1`,
    );
    const latest = existing.items?.[0] ?? null;
    if (latest) setScopedSession(latest);
    return latest;
  }, [initialAssistantSessionId, session, setScopedSession, workflowId]);

  const ensureSession = useCallback(async () => {
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
        provider_kind: "codex_local",
        title: `${workflowName || "Graph"} assistant`,
      }),
    });
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

  const saveMediaPresetFromMessage = useCallback(async (message: string, assistantSessionId?: string | null) => {
    const currentSession = assistantSessionId ? ({ assistant_session_id: assistantSessionId } as AssistantSession) : session ?? (await ensureSession());
    setStatus("savingPreset");
    setError(null);
    try {
      const result = await runAbortableRequest((signal) =>
        jsonFetch<AssistantArtifactSaveResponse>(`/api/control/media/assistant/sessions/${currentSession.assistant_session_id}/preset-saves`, {
          method: "POST",
          signal,
          body: JSON.stringify({ message, workflow, run_id: latestRunId ?? null, assistant_mode: assistantMode }),
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

  const savePromptRecipeFromMessage = useCallback(async (message: string, assistantSessionId?: string | null) => {
    const currentSession = assistantSessionId ? ({ assistant_session_id: assistantSessionId } as AssistantSession) : session ?? (await ensureSession());
    setStatus("savingRecipe");
    setError(null);
    try {
      const result = await runAbortableRequest((signal) =>
        jsonFetch<AssistantArtifactSaveResponse>(`/api/control/media/assistant/sessions/${currentSession.assistant_session_id}/recipe-saves`, {
          method: "POST",
          signal,
          body: JSON.stringify({ message, workflow, run_id: latestRunId ?? null, assistant_mode: assistantMode }),
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

  const createPlanFromMessage = useCallback(async (message: string, options?: { appendUserMessage?: boolean; workflowOverride?: GraphWorkflowPayload; showPlan?: boolean }) => {
    const normalizedMessage = message.trim();
    if (!normalizedMessage || busy) return null;
    const requestWorkflow = options?.workflowOverride ?? workflow;
    const requestCanvasContext = options?.workflowOverride
      ? buildCreativeAssistantCanvasContext(requestWorkflow, { selectedNodeIds, selectedGroupIds })
      : canvasContext;
    setStatus("planning");
    setError(null);
    try {
      const currentSession = session ?? (await ensureSession());
      if (options?.appendUserMessage ?? true) {
        setScopedSession((current) => appendOptimisticUserMessage(current, currentSession, normalizedMessage, { source: "plan_graph", assistant_mode: assistantMode }));
      }
      setDraft("");
      planApplyWorkflowRef.current = requestWorkflow;
      const result = await runAbortableRequest((signal) =>
        jsonFetch<AssistantPlanResponse>(`/api/control/media/assistant/sessions/${currentSession.assistant_session_id}/plans`, {
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
        }),
      );
      if (options?.showPlan === false) {
        setPlan(null);
      } else {
        setPlan(result);
      }
      setScopedSession((current) => (current ? { ...current, status: result.validation.valid ? "plan_ready" : "failed" } : current));
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

  const applyPlanResponse = useCallback(async (planResponse: AssistantPlanResponse, applyWorkflow: GraphWorkflowPayload) => {
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
        body: JSON.stringify({ workflow: applyWorkflow }),
      });
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

  const createAndApplyPlanFromContent = useCallback(async (message: string) => {
    if (busy) return null;
    const baseWorkflow = workflow;
    const createdPlan = await createPlanFromMessage(message, {
      appendUserMessage: false,
      workflowOverride: baseWorkflow,
      showPlan: false,
    });
    if (!createdPlan) return null;
    if ((createdPlan.graph_plan.operations ?? []).length === 0) {
      setPlan(createdPlan);
      onEvent?.("Assistant needs one prerequisite before changing the canvas.", "warning");
      return null;
    }
    if (createdPlan.plan.status !== "validated") {
      setPlan(createdPlan);
      onEvent?.("Assistant workflow needs review before it can be applied.", "warning");
      return null;
    }
    return applyPlanResponse(createdPlan, baseWorkflow);
  }, [applyPlanResponse, busy, createPlanFromMessage, onEvent, workflow]);

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
    setStatus("sending");
    setError(null);
    try {
      const currentSession = await ensureSession();
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
      setScopedSession(updated);
      onEvent?.("Assistant message saved.", "muted");
      if (!options?.skipAutoActions) {
        const suggestedAction = latestAssistantSuggestedAction(updated);
        const responseKind = latestAssistantResponseKind(updated);
        const runApprovalSource = latestAssistantRunApprovalSource(updated);
        const savedPresetWorkflowRequest = isAssistantSavedPresetWorkflowRequest(content);
        const selectedNodeFieldEditReply = isSelectedNodeFieldEditReply(latestAssistantPayload(updated));
        const autoAction = selectedNodeFieldEditReply
          ? "create_and_apply_graph_plan"
          : resolveCreativeAssistantAutoAction({
              content,
              assistantMode,
              suggestedAction,
              responseKind,
              runApprovalSource,
              canRunWorkflow: Boolean(onRunWorkflow),
            });
        if (autoAction === "run_workflow" && onRunWorkflow) {
          onEvent?.("Starting assistant-requested graph test.", "success");
          await onRunWorkflow();
        } else if (autoAction === "save_media_preset") {
          setPlan(null);
          planApplyWorkflowRef.current = null;
          await saveMediaPresetFromMessage(content, currentSession.assistant_session_id);
        } else if (autoAction === "save_prompt_recipe") {
          setPlan(null);
          planApplyWorkflowRef.current = null;
          await savePromptRecipeFromMessage(content, currentSession.assistant_session_id);
        } else if (autoAction === "create_prompt_recipe_draft") {
          setPlan(null);
          planApplyWorkflowRef.current = null;
          setStatus("draftingRecipe");
          await createPromptRecipeDraftFromMessage(content, currentSession.assistant_session_id);
        } else if (autoAction === "create_media_preset_draft") {
          await createMediaPresetDraftFromMessage(content, currentSession.assistant_session_id);
        } else if (autoAction === "create_and_apply_graph_plan") {
          await createAndApplyPlanFromContent(content);
        } else if (autoAction === "create_graph_plan") {
          await createPlanFromMessage(content, {
            appendUserMessage: false,
            workflowOverride: savedPresetWorkflowRequest ? blankGraphWorkflowPayload("Saved Media Preset workflow") : undefined,
          });
        }
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
  }, [assistantMode, busy, canvasContext, createAndApplyPlanFromContent, createMediaPresetDraftFromMessage, createPlanFromMessage, createPromptRecipeDraftFromMessage, ensureSession, latestRunId, onEvent, onRunWorkflow, runAbortableRequest, saveMediaPresetFromMessage, savePromptRecipeFromMessage, setScopedSession, workflow]);

  const sendMessage = useCallback(async () => sendContentMessage(draft), [draft, sendContentMessage]);

  useEffect(() => {
    if (!enabled || assistantMode !== "preset") return;
    if (latestRunStatus !== "completed" || !latestRunId) return;
    if (busy) return;
    if (!sessionHasImageAttachment(session)) return;
    if (sessionHasOutputComparisonForRun(session, latestRunId)) return;
    const sessionId = session?.assistant_session_id;
    if (!sessionId) return;
    const dedupeKey = `${sessionId}:${latestRunId}`;
    if (autoComparedRunKeysRef.current.has(dedupeKey)) return;
    autoComparedRunKeysRef.current.add(dedupeKey);
    void sendContentMessage(AUTO_OUTPUT_COMPARE_MESSAGE, {
      clearDraft: false,
      metadata: { source: "auto_output_compare", auto_compare: true },
      skipAutoActions: true,
    }).then((updatedSession) => {
      if (!updatedSession?.messages?.some((message) => message.content_json?.output_aware === true && message.content_json?.latest_run_id === latestRunId)) {
        autoComparedRunKeysRef.current.delete(dedupeKey);
      }
    });
  }, [assistantMode, busy, enabled, latestRunId, latestRunStatus, sendContentMessage, session]);

  const startPresetLoop = useCallback(
    async (lane: PresetLoopLane) =>
      sendContentMessage(PRESET_LOOP_START_MESSAGES[lane], {
        clearDraft: true,
        metadata: { preset_loop_lane: lane, source: "guided_loop_ui" },
        skipAutoActions: true,
      }),
    [sendContentMessage],
  );

  const saveApprovedSandboxAsPreset = useCallback(
    async () => {
      if (busy) return null;
      const currentSession = await ensureSession();
      return saveMediaPresetFromMessage(APPROVED_TEST_WORKFLOW_SAVE_MESSAGE, currentSession.assistant_session_id);
    },
    [busy, ensureSession, saveMediaPresetFromMessage],
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
    return applyPlanResponse(plan, planApplyWorkflowRef.current ?? workflow);
  }, [applyPlanResponse, canApply, plan, workflow]);

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
      providerReadiness,
      canPlan,
      canApply,
      sendMessage,
      sendContentMessage,
      startPresetLoop,
      saveApprovedSandboxAsPreset,
      createPlan,
      createPlanFromContent,
      createAndApplyPlanFromContent,
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
      canPlan,
      cancelAssistant,
      createMediaPresetDraft,
      createPlan,
      createAndApplyPlanFromContent,
      createPlanFromContent,
      createPromptRecipeDraft,
      draft,
      error,
      plan,
      providerReadiness,
      removeAttachment,
      openSavedArtifactEditor,
      saveMediaPresetFromMessage,
      savePromptRecipeFromMessage,
      sendContentMessage,
      sendMessage,
      saveApprovedSandboxAsPreset,
      startPresetLoop,
      session,
      status,
      useSavedArtifactInGraph,
    ],
  );
}
