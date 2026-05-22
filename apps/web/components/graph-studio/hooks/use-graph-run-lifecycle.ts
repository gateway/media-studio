"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  GraphRun,
  GraphRunEvent,
  GraphRunStatusSnapshot,
  GraphRunTransportMetrics,
  GraphWorkflowPayload,
  GraphWorkflowRecord,
  StudioEdge,
  StudioNode,
} from "../types";
import { jsonFetch } from "../utils/graph-api";
import { assetIdsFromGraphRun } from "../utils/graph-media-preview";
import { formatGraphRunEventsForConsole } from "../utils/graph-run-events";

export type GraphValidationError = {
  code?: string;
  message: string;
  node_id?: string | null;
  edge_id?: string | null;
  port_id?: string | null;
  field_id?: string | null;
};

type GraphValidationResponse = {
  valid: boolean;
  errors: GraphValidationError[];
  warnings: GraphValidationError[];
};

const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled"]);
const POLL_RUN_REFRESH_INTERVAL_MS = 2000;
const POLL_RUN_REFRESH_INTERVAL_SLOW_MS = 4000;
const POLL_RUN_REFRESH_INTERVAL_BACKOFF_MS = 4000;
const POLL_RUN_REFRESH_INTERVAL_BACKOFF_SLOW_MS = 8000;
const POLL_RUN_REFRESH_INTERVAL_MAX_SLOW_MS = 12000;

function emptyTransportMetrics(): GraphRunTransportMetrics {
  return {
    statusRequests: 0,
    fullRunRequests: 0,
    eventRequests: 0,
    streamConnections: 0,
    streamErrors: 0,
  };
}

function statusSnapshotKey(run: GraphRunStatusSnapshot) {
  return JSON.stringify({
    runId: run.run_id,
    status: run.status,
    error: run.error ?? null,
    updatedAt: run.updated_at ?? null,
    latestEventId: run.latest_event_id ?? null,
    nodes: run.nodes.map((node) => ({
      nodeId: node.node_id,
      status: node.status,
      progress: node.progress ?? null,
      error: node.error ?? null,
      hasOutput: Boolean(node.has_output_snapshot),
      updatedAt: node.updated_at ?? null,
    })),
  });
}

function outputPresenceKey(run: GraphRunStatusSnapshot) {
  const nodeIds = run.nodes
    .filter((node) => Boolean(node.has_output_snapshot))
    .map((node) => node.node_id)
    .sort();
  return `${run.run_id}:${run.status}:${nodeIds.join(",")}`;
}

function mergeRunEvents(existing: GraphRunEvent[], incoming: GraphRunEvent[]) {
  if (!incoming.length) return existing;
  const seen = new Set(existing.map((event) => event.event_id));
  const merged = [...existing];
  for (const event of incoming) {
    if (seen.has(event.event_id)) continue;
    seen.add(event.event_id);
    merged.push(event);
  }
  return merged;
}

function mergeRunStatus(current: GraphRun | null, status: GraphRunStatusSnapshot): GraphRun {
  const existingNodes = new Map((current?.nodes ?? []).map((node) => [node.node_id, node]));
  return {
    run_id: status.run_id,
    workflow_id: status.workflow_id,
    status: status.status,
    error: status.error ?? current?.error ?? null,
    workflow_json: current?.workflow_json,
    output_snapshot_json: current?.output_snapshot_json ?? {},
    metrics_json: current?.metrics_json ?? {},
    nodes: status.nodes.map((node) => {
      const existing = existingNodes.get(node.node_id);
      return {
        run_node_id: node.run_node_id,
        run_id: node.run_id,
        node_id: node.node_id,
        node_type: node.node_type,
        status: node.status,
        progress: node.progress ?? null,
        error: node.error ?? null,
        output_snapshot_json: existing?.output_snapshot_json ?? {},
        artifacts: existing?.artifacts ?? [],
        metrics_json: existing?.metrics_json ?? {},
        started_at: node.started_at ?? existing?.started_at ?? null,
        finished_at: node.finished_at ?? existing?.finished_at ?? null,
        updated_at: node.updated_at ?? existing?.updated_at ?? null,
      };
    }),
    created_at: status.created_at ?? current?.created_at ?? null,
    started_at: status.started_at ?? current?.started_at ?? null,
    finished_at: status.finished_at ?? current?.finished_at ?? null,
    updated_at: status.updated_at ?? current?.updated_at ?? null,
  };
}

function pollIntervalForRun(run: GraphRun | null, stablePollCount: number) {
  const hasRunningKieNode =
    run?.nodes?.some((node) => node.status === "running" && node.node_type.startsWith("model.kie.")) === true;
  if (hasRunningKieNode) {
    if (stablePollCount >= 5) return POLL_RUN_REFRESH_INTERVAL_MAX_SLOW_MS;
    if (stablePollCount >= 2) return POLL_RUN_REFRESH_INTERVAL_BACKOFF_SLOW_MS;
    return POLL_RUN_REFRESH_INTERVAL_SLOW_MS;
  }
  if (stablePollCount >= 3) return POLL_RUN_REFRESH_INTERVAL_BACKOFF_MS;
  return POLL_RUN_REFRESH_INTERVAL_MS;
}

export function useGraphRunLifecycle({
  run,
  setRun,
  workflowId,
  workflowName,
  nodes,
  edges,
  saveWorkflow,
  workflowFromCanvas,
  resetNodeRunState,
  applyValidationErrorsToNodes,
  applyRunNodesToCanvas,
  applyRunEventsToCanvas,
  refreshCredits,
  refreshImageAssets,
  refreshAssetsByIds,
  refreshReferenceMedia,
  setConsoleLines,
  appendConsole,
  confirmPricingForRun,
}: {
  run: GraphRun | null;
  setRun: (run: GraphRun | null) => void;
  workflowId: string | null;
  workflowName: string;
  nodes: StudioNode[];
  edges: StudioEdge[];
  saveWorkflow: () => Promise<GraphWorkflowRecord>;
  workflowFromCanvas: (workflowId: string | null, workflowName: string, nodes: StudioNode[], edges: StudioEdge[]) => GraphWorkflowPayload;
  resetNodeRunState: () => void;
  applyValidationErrorsToNodes: (errors: GraphValidationError[]) => void;
  applyRunNodesToCanvas: (run: GraphRun) => void;
  applyRunEventsToCanvas?: (events: GraphRunEvent[], run: GraphRun) => void;
  refreshCredits: () => Promise<void>;
  refreshImageAssets: () => Promise<void>;
  refreshAssetsByIds: (assetIds: string[]) => Promise<void>;
  refreshReferenceMedia: () => Promise<void>;
  setConsoleLines: (lines: string[]) => void;
  appendConsole: (line: string) => void;
  confirmPricingForRun?: () => Promise<boolean>;
}) {
  const [eventStreamActive, setEventStreamActive] = useState(false);
  const [transportMetrics, setTransportMetrics] = useState<GraphRunTransportMetrics>(() => emptyTransportMetrics());
  const [pollIntervalMs, setPollIntervalMs] = useState(POLL_RUN_REFRESH_INTERVAL_MS);

  const refreshPromiseRef = useRef<Promise<void> | null>(null);
  const pendingRefreshRunIdRef = useRef<string | null>(null);
  const refreshedOutputKeyRef = useRef<string | null>(null);
  const lastOutputPresenceKeyRef = useRef<string | null>(null);
  const refreshRunStateRef = useRef<(runId: string, options?: { reason?: "event" | "poll" | "manual" }) => Promise<void>>(async () => undefined);
  const appendConsoleRef = useRef(appendConsole);
  const lastRunSnapshotKeyRef = useRef<string | null>(null);
  const runRef = useRef<GraphRun | null>(run);
  const eventsRef = useRef<GraphRunEvent[]>([]);
  const eventCursorRef = useRef<string | null>(null);
  const stablePollCountRef = useRef(0);

  const incrementMetric = useCallback((key: keyof GraphRunTransportMetrics) => {
    setTransportMetrics((current) => ({
      ...current,
      [key]: current[key] + 1,
    }));
  }, []);

  const validateWorkflowForRun = useCallback(async () => {
    const record = await saveWorkflow();
    const id = record.workflow_id;
    const result = await jsonFetch<GraphValidationResponse>(`/api/control/media/graph/workflows/${id}/validate`, {
      method: "POST",
      body: JSON.stringify(workflowFromCanvas(id, workflowName, nodes, edges)),
    });
    return { id, result };
  }, [edges, nodes, saveWorkflow, workflowFromCanvas, workflowName]);

  const validationErrorLabel = useCallback(
    (error: GraphValidationError) => {
      const node = error.node_id ? nodes.find((item) => item.id === error.node_id) : null;
      const nodeLabel = node ? node.data.customTitle?.trim() || node.data.definition.title || error.node_id : error.node_id;
      return nodeLabel ? `${nodeLabel}: ${error.message}` : error.message;
    },
    [nodes],
  );

  const runWorkflow = useCallback(async () => {
    try {
      resetNodeRunState();
      setRun(null);
      runRef.current = null;
      eventsRef.current = [];
      eventCursorRef.current = null;
      lastRunSnapshotKeyRef.current = null;
      lastOutputPresenceKeyRef.current = null;
      refreshedOutputKeyRef.current = null;
      stablePollCountRef.current = 0;
      setPollIntervalMs(POLL_RUN_REFRESH_INTERVAL_MS);
      setTransportMetrics(emptyTransportMetrics());
      const { id, result } = await validateWorkflowForRun();
      if (!result.valid) {
        applyValidationErrorsToNodes(result.errors);
        appendConsole(`Validation failed: ${result.errors.map(validationErrorLabel).join("; ")}`);
        return;
      }
      if (result.warnings.length) {
        appendConsole(`Validation passed with ${result.warnings.length} warning(s).`);
      }
      if (confirmPricingForRun && !(await confirmPricingForRun())) {
        appendConsole("Run cancelled before spending credits.");
        return;
      }
      const created = await jsonFetch<GraphRun>(`/api/control/media/graph/workflows/${id}/runs`, {
        method: "POST",
        body: JSON.stringify({ workflow: workflowFromCanvas(id, workflowName, nodes, edges) }),
      });
      setRun(created);
      runRef.current = created;
      applyRunNodesToCanvas(created);
      appendConsole(`Started graph run ${created.run_id}.`);
    } catch (error) {
      const message = (error as Error).message || "Graph run failed to start.";
      appendConsole(`Run failed to start: ${message}`);
      applyValidationErrorsToNodes([{ message }]);
    }
  }, [
    appendConsole,
    applyRunNodesToCanvas,
    applyValidationErrorsToNodes,
    confirmPricingForRun,
    edges,
    nodes,
    resetNodeRunState,
    setRun,
    validateWorkflowForRun,
    validationErrorLabel,
    workflowFromCanvas,
    workflowName,
  ]);

  const fetchRunStatus = useCallback(
    async (runId: string) => {
      incrementMetric("statusRequests");
      return jsonFetch<GraphRunStatusSnapshot>(`/api/control/media/graph/runs/${runId}/status`);
    },
    [incrementMetric],
  );

  const fetchRunEvents = useCallback(
    async (runId: string, afterEventId: string | null) => {
      incrementMetric("eventRequests");
      const suffix = afterEventId ? `?after_event_id=${encodeURIComponent(afterEventId)}` : "";
      return jsonFetch<{ items: GraphRunEvent[] }>(`/api/control/media/graph/runs/${runId}/events${suffix}`);
    },
    [incrementMetric],
  );

  const hydrateFullRun = useCallback(
    async (runId: string) => {
      incrementMetric("fullRunRequests");
      const current = await jsonFetch<GraphRun>(`/api/control/media/graph/runs/${runId}`);
      runRef.current = current;
      setRun(current);
      applyRunNodesToCanvas(current);
      if (TERMINAL_RUN_STATUSES.has(current.status)) {
        void refreshCredits();
      }

      const outputNodeCount =
        current.nodes?.filter((item) => item.output_snapshot_json && Object.keys(item.output_snapshot_json).length).length ?? 0;
      const assetIds = outputNodeCount ? [...assetIdsFromGraphRun(current)].sort() : [];
      const refreshedOutputKey = outputNodeCount ? `${current.run_id}:${outputNodeCount}:${assetIds.join(",")}` : null;
      if (refreshedOutputKey && refreshedOutputKeyRef.current !== refreshedOutputKey) {
        refreshedOutputKeyRef.current = refreshedOutputKey;
        refreshReferenceMedia().catch(() => undefined);
        refreshImageAssets()
          .then(() => refreshAssetsByIds(assetIds))
          .catch(() => undefined);
      }
      return current;
    },
    [applyRunNodesToCanvas, incrementMetric, refreshAssetsByIds, refreshCredits, refreshImageAssets, refreshReferenceMedia, setRun],
  );

  const refreshRunState = useCallback(
    async (runId: string, options?: { reason?: "event" | "poll" | "manual" }) => {
      const reason = options?.reason ?? "manual";
      pendingRefreshRunIdRef.current = runId;
      if (refreshPromiseRef.current) return refreshPromiseRef.current;
      refreshPromiseRef.current = (async () => {
        while (pendingRefreshRunIdRef.current) {
          const nextRunId = pendingRefreshRunIdRef.current;
          pendingRefreshRunIdRef.current = null;

          const status = await fetchRunStatus(nextRunId);
          const previousRun = runRef.current;
          const previousStatus = previousRun?.status ?? null;
          const nextRun = mergeRunStatus(previousRun, status);
          const nextSnapshotKey = statusSnapshotKey(status);
          const runChanged = lastRunSnapshotKeyRef.current !== nextSnapshotKey;
          if (reason === "poll") {
            stablePollCountRef.current = runChanged ? 0 : stablePollCountRef.current + 1;
          } else if (runChanged) {
            stablePollCountRef.current = 0;
          }
          const nextPollInterval = pollIntervalForRun(nextRun, stablePollCountRef.current);
          setPollIntervalMs((current) => (current === nextPollInterval ? current : nextPollInterval));
          if (runChanged) {
            lastRunSnapshotKeyRef.current = nextSnapshotKey;
            runRef.current = nextRun;
            setRun(nextRun);
            applyRunNodesToCanvas(nextRun);
          }

          const latestEventId = status.latest_event_id ?? null;
          if (!eventCursorRef.current || latestEventId !== eventCursorRef.current || reason !== "poll") {
            const eventResult = await fetchRunEvents(nextRunId, eventCursorRef.current);
            if (!eventCursorRef.current) {
              eventsRef.current = eventResult.items;
            } else {
              eventsRef.current = mergeRunEvents(eventsRef.current, eventResult.items);
            }
            if (eventResult.items.length) {
              eventCursorRef.current = eventResult.items[eventResult.items.length - 1]?.event_id ?? eventCursorRef.current;
            } else if (!eventCursorRef.current && latestEventId == null) {
              eventsRef.current = [];
            }
            applyRunEventsToCanvas?.(eventsRef.current, nextRun);
            setConsoleLines(formatGraphRunEventsForConsole(eventsRef.current, nodes));
          }

          const nextOutputKey = outputPresenceKey(status);
          const outputsPresent = status.nodes.some((node) => Boolean(node.has_output_snapshot));
          const outputChanged =
            lastOutputPresenceKeyRef.current !== null && lastOutputPresenceKeyRef.current !== nextOutputKey;
          const terminalTransition = TERMINAL_RUN_STATUSES.has(status.status) && !TERMINAL_RUN_STATUSES.has(previousStatus ?? "");
          const shouldHydrateFullRun =
            reason === "manual" ||
            terminalTransition ||
            (outputsPresent && outputChanged);

          lastOutputPresenceKeyRef.current = nextOutputKey;
          if (shouldHydrateFullRun) {
            const hydratedRun = await hydrateFullRun(nextRunId);
            applyRunEventsToCanvas?.(eventsRef.current, hydratedRun);
          }
        }
      })().finally(() => {
        refreshPromiseRef.current = null;
      });
      return refreshPromiseRef.current;
    },
    [applyRunEventsToCanvas, applyRunNodesToCanvas, fetchRunEvents, fetchRunStatus, hydrateFullRun, nodes, setConsoleLines, setRun],
  );

  const cancelRun = useCallback(async () => {
    const currentRunId = runRef.current?.run_id;
    const currentStatus = runRef.current?.status ?? null;
    if (!currentRunId || (currentStatus && TERMINAL_RUN_STATUSES.has(currentStatus))) return;
    try {
      const cancellingRun = await jsonFetch<GraphRun>(`/api/control/media/graph/runs/${currentRunId}/cancel`, {
        method: "POST",
      });
      runRef.current = cancellingRun;
      setRun(cancellingRun);
      applyRunNodesToCanvas(cancellingRun);
      appendConsole(`Cancelling graph run ${currentRunId}.`);
      await refreshRunState(currentRunId, { reason: "manual" });
    } catch (error) {
      appendConsole(`Run cancel failed: ${(error as Error).message || "Unable to cancel graph run."}`);
    }
  }, [appendConsole, applyRunNodesToCanvas, refreshRunState, setRun]);

  const activeRunId = run?.run_id ?? null;
  const runIsTerminal = !run || TERMINAL_RUN_STATUSES.has(run.status);

  useEffect(() => {
    runRef.current = run;
  }, [run]);

  useEffect(() => {
    refreshRunStateRef.current = refreshRunState;
  }, [refreshRunState]);

  useEffect(() => {
    appendConsoleRef.current = appendConsole;
  }, [appendConsole]);

  useEffect(() => {
    if (!activeRunId) {
      eventsRef.current = [];
      eventCursorRef.current = null;
      lastRunSnapshotKeyRef.current = null;
      lastOutputPresenceKeyRef.current = null;
      refreshedOutputKeyRef.current = null;
      stablePollCountRef.current = 0;
      setPollIntervalMs(POLL_RUN_REFRESH_INTERVAL_MS);
      return;
    }
    eventsRef.current = [];
    eventCursorRef.current = null;
    lastRunSnapshotKeyRef.current = null;
    lastOutputPresenceKeyRef.current = null;
    refreshedOutputKeyRef.current = null;
    stablePollCountRef.current = 0;
    setPollIntervalMs(POLL_RUN_REFRESH_INTERVAL_MS);
  }, [activeRunId]);

  useEffect(() => {
    if (!activeRunId || runIsTerminal) {
      setEventStreamActive(false);
      return;
    }
    if (typeof EventSource === "undefined") return;
    const suffix = eventCursorRef.current ? `?after_event_id=${encodeURIComponent(eventCursorRef.current)}` : "";
    const source = new EventSource(`/api/control/media/graph/runs/${activeRunId}/events/stream${suffix}`);
    let closed = false;
    let refreshTimer: number | null = null;
    const refreshFromEvent = () => {
      if (refreshTimer !== null) return;
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        void refreshRunStateRef.current(activeRunId, { reason: "event" }).catch((error) =>
          appendConsoleRef.current(`Run event refresh failed: ${(error as Error).message}`),
        );
      }, 100);
    };
    const eventTypes = [
      "run.created",
      "run.validating",
      "run.compiled",
      "run.started",
      "run.cancelling",
      "node.queued",
      "node.started",
      "kie.validating",
      "kie.submitted",
      "kie.polling",
      "node.completed",
      "node.cancelled",
      "node.cached",
      "node.bypassed",
      "node.skipped",
      "asset.created",
      "run.completed",
      "run.cancelled",
      "node.failed",
      "run.failed",
    ];
    eventTypes.forEach((eventType) => source.addEventListener(eventType, refreshFromEvent));
    source.onopen = () => {
      incrementMetric("streamConnections");
      setEventStreamActive(true);
    };
    source.onerror = () => {
      incrementMetric("streamErrors");
      if (!closed) {
        setEventStreamActive(false);
        source.close();
      }
    };
    return () => {
      closed = true;
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      setEventStreamActive(false);
      source.close();
    };
  }, [activeRunId, incrementMetric, runIsTerminal]);

  useEffect(() => {
    if (!activeRunId || eventStreamActive || runIsTerminal) return;
    const timer = window.setInterval(async () => {
      try {
        await refreshRunStateRef.current(activeRunId, { reason: "poll" });
      } catch (error) {
        appendConsoleRef.current(`Run polling failed: ${(error as Error).message}`);
      }
    }, pollIntervalMs);
    return () => window.clearInterval(timer);
  }, [activeRunId, eventStreamActive, pollIntervalMs, runIsTerminal]);

  return { runWorkflow, cancelRun, refreshRunState, transportMetrics };
}
