import { useCallback, useEffect, useState } from "react";

import type { GraphRun, GraphRunEvent, GraphWorkflowPayload, StudioEdge, StudioNode } from "../types";
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
  saveWorkflow: () => Promise<string>;
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

  const validateWorkflowForRun = useCallback(async () => {
    const id = await saveWorkflow();
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

  const refreshRunState = useCallback(
    async (runId: string) => {
      const current = await jsonFetch<GraphRun>(`/api/control/media/graph/runs/${runId}`);
      setRun(current);
      if (["completed", "failed", "cancelled"].includes(current.status)) {
        void refreshCredits();
      }
      if (current.nodes?.some((item) => item.output_snapshot_json && Object.keys(item.output_snapshot_json).length)) {
        refreshReferenceMedia().catch(() => undefined);
        refreshImageAssets()
          .then(() => refreshAssetsByIds(assetIdsFromGraphRun(current)))
          .catch(() => undefined);
      }
      applyRunNodesToCanvas(current);
      const events = await jsonFetch<{ items: GraphRunEvent[] }>(`/api/control/media/graph/runs/${runId}/events`);
      applyRunEventsToCanvas?.(events.items, current);
      setConsoleLines(formatGraphRunEventsForConsole(events.items, nodes));
    },
    [applyRunEventsToCanvas, applyRunNodesToCanvas, nodes, refreshAssetsByIds, refreshCredits, refreshImageAssets, refreshReferenceMedia, setConsoleLines, setRun],
  );

  useEffect(() => {
    if (!run || ["completed", "failed", "cancelled"].includes(run.status)) {
      setEventStreamActive(false);
      return;
    }
    if (typeof EventSource === "undefined") return;
    const source = new EventSource(`/api/control/media/graph/runs/${run.run_id}/events/stream`);
    let closed = false;
    const refreshFromEvent = () => {
      void refreshRunState(run.run_id).catch((error) => appendConsole(`Run event refresh failed: ${(error as Error).message}`));
    };
    const eventTypes = [
      "run.created",
      "run.validating",
      "run.compiled",
      "run.started",
      "node.queued",
      "node.started",
      "kie.validating",
      "kie.submitted",
      "kie.polling",
      "node.completed",
      "node.cached",
      "node.bypassed",
      "node.skipped",
      "asset.created",
      "run.completed",
      "node.failed",
      "run.failed",
    ];
    eventTypes.forEach((eventType) => source.addEventListener(eventType, refreshFromEvent));
    source.onopen = () => setEventStreamActive(true);
    source.onerror = () => {
      if (!closed) {
        setEventStreamActive(false);
        source.close();
      }
    };
    return () => {
      closed = true;
      setEventStreamActive(false);
      source.close();
    };
  }, [appendConsole, refreshRunState, run]);

  useEffect(() => {
    if (!run || eventStreamActive || ["completed", "failed", "cancelled"].includes(run.status)) return;
    const timer = window.setInterval(async () => {
      try {
        await refreshRunState(run.run_id);
      } catch (error) {
        appendConsole(`Run polling failed: ${(error as Error).message}`);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [appendConsole, eventStreamActive, refreshRunState, run]);

  return { runWorkflow, refreshRunState };
}
