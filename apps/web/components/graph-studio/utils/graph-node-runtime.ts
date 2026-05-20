import type { GraphNodeData } from "../types";
import { normalizeGraphExecutionMode, type GraphExecutionMode } from "./graph-node-execution";

export type GraphRunNodeRuntimeState = {
  status?: string;
  progress?: number | null;
  error?: string | null;
  output_snapshot_json?: Record<string, unknown>;
  metrics_json?: Record<string, unknown>;
};

export function clearGraphNodeRunState(data: GraphNodeData): GraphNodeData {
  return {
    ...data,
    status: "idle",
    progress: null,
    errorMessage: null,
    activityLabel: null,
    activityDetail: null,
    activityTone: null,
  };
}

export function graphNodeDataWithExecutionMode(data: GraphNodeData, mode: GraphExecutionMode): GraphNodeData {
  return {
    ...clearGraphNodeRunState(data),
    executionMode: mode,
  };
}

export function graphRunNodeStateMatchesExecutionMode(data: GraphNodeData, runNode: GraphRunNodeRuntimeState): boolean {
  const runExecutionMode = typeof runNode.metrics_json?.execution_mode === "string" ? normalizeGraphExecutionMode(runNode.metrics_json.execution_mode) : null;
  if (!runExecutionMode) return true;
  return runExecutionMode === normalizeGraphExecutionMode(data.executionMode);
}

export function graphNodeDataWithRunState(data: GraphNodeData, runNode: GraphRunNodeRuntimeState): GraphNodeData {
  if (!graphRunNodeStateMatchesExecutionMode(data, runNode)) {
    return clearGraphNodeRunState(data);
  }
  return {
    ...data,
    status: runNode.status ?? "idle",
    progress: runNode.progress ?? null,
    errorMessage: runNode.error ?? null,
    outputSnapshot: runNode.output_snapshot_json,
  };
}
