import type { GraphNodeData } from "../types";
import { normalizeGraphExecutionMode, type GraphExecutionMode } from "./graph-node-execution";

export type GraphRunNodeRuntimeState = {
  status?: string;
  progress?: number | null;
  error?: string | null;
  output_snapshot_json?: Record<string, unknown>;
  metrics_json?: Record<string, unknown>;
};

function runtimeValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

export function clearGraphNodeRunState(data: GraphNodeData): GraphNodeData {
  if (
    data.status === "idle" &&
    data.progress === null &&
    data.errorMessage === null &&
    data.activityLabel === null &&
    data.activityDetail === null &&
    data.activityTone === null
  ) {
    return data;
  }
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
  const nextStatus = runNode.status ?? "idle";
  const nextProgress = runNode.progress ?? null;
  const nextErrorMessage = runNode.error ?? null;
  const nextOutputSnapshot = runNode.output_snapshot_json;
  if (
    data.status === nextStatus &&
    data.progress === nextProgress &&
    data.errorMessage === nextErrorMessage &&
    runtimeValuesEqual(data.outputSnapshot, nextOutputSnapshot)
  ) {
    return data;
  }
  return {
    ...data,
    status: nextStatus,
    progress: nextProgress,
    errorMessage: nextErrorMessage,
    outputSnapshot: nextOutputSnapshot,
  };
}
