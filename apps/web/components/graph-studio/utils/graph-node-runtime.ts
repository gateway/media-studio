import type { GraphNodeData } from "../types";
import { normalizeGraphExecutionMode, type GraphExecutionMode } from "./graph-node-execution";

export type GraphRunNodeRuntimeState = {
  run_id?: string;
  node_id?: string;
  status?: string;
  progress?: number | null;
  error?: string | null;
  output_snapshot_json?: Record<string, unknown>;
  artifacts?: Array<{
    artifact_id?: string;
    run_id?: string;
    node_id?: string;
    output_port?: string;
    output_index?: number;
  }>;
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

function hasOutputSnapshot(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && Object.keys(value as Record<string, unknown>).length);
}

function shouldRetainPreviousOutput(status: string): boolean {
  return ["queued", "running", "skipped", "failed", "cancelled", "cancelling"].includes(status);
}

function completedRunExecutionCache(
  runNode: GraphRunNodeRuntimeState,
): NonNullable<GraphNodeData["executionCache"]> | null {
  const runId = runNode.run_id?.trim();
  const outputSnapshot = runNode.output_snapshot_json;
  if (runNode.status !== "completed" || !runId || !hasOutputSnapshot(outputSnapshot)) return null;

  const artifactIdsByPort = new Map<string, Array<{ id: string; index: number }>>();
  for (const artifact of runNode.artifacts ?? []) {
    const artifactId = artifact.artifact_id?.trim();
    const outputPort = artifact.output_port?.trim();
    if (
      !artifactId ||
      !outputPort ||
      artifact.run_id !== runId ||
      (runNode.node_id && artifact.node_id !== runNode.node_id) ||
      !Object.prototype.hasOwnProperty.call(outputSnapshot, outputPort)
    ) {
      continue;
    }
    const portArtifacts = artifactIdsByPort.get(outputPort) ?? [];
    if (!portArtifacts.some((item) => item.id === artifactId)) {
      portArtifacts.push({ id: artifactId, index: artifact.output_index ?? portArtifacts.length });
      artifactIdsByPort.set(outputPort, portArtifacts);
    }
  }
  if (!artifactIdsByPort.size) return null;

  return {
    cachedRunId: runId,
    cachedArtifactIds: Object.fromEntries(
      [...artifactIdsByPort].map(([port, artifacts]) => [
        port,
        artifacts.sort((left, right) => left.index - right.index || left.id.localeCompare(right.id)).map(({ id }) => id),
      ]),
    ),
  };
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
  const runOutputSnapshot = runNode.output_snapshot_json;
  const nextOutputSnapshot =
    shouldRetainPreviousOutput(nextStatus) && !hasOutputSnapshot(runOutputSnapshot) && hasOutputSnapshot(data.outputSnapshot)
      ? data.outputSnapshot
      : runOutputSnapshot;
  const nextExecutionCache = completedRunExecutionCache(runNode) ?? data.executionCache;
  if (
    data.status === nextStatus &&
    data.progress === nextProgress &&
    data.errorMessage === nextErrorMessage &&
    runtimeValuesEqual(data.outputSnapshot, nextOutputSnapshot) &&
    runtimeValuesEqual(data.executionCache, nextExecutionCache)
  ) {
    return data;
  }
  return {
    ...data,
    status: nextStatus,
    progress: nextProgress,
    errorMessage: nextErrorMessage,
    outputSnapshot: nextOutputSnapshot,
    executionCache: nextExecutionCache,
  };
}
