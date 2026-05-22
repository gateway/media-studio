export type GraphNodeVisualStatus =
  | "idle"
  | "queued"
  | "running"
  | "completed"
  | "cached"
  | "bypassed"
  | "skipped"
  | "failed"
  | "cancelled"
  | "unknown";

const KNOWN_STATUSES = new Set(["idle", "queued", "running", "completed", "cached", "bypassed", "skipped", "failed", "cancelled"]);

export function normalizeGraphNodeStatus(status: string | null | undefined): GraphNodeVisualStatus {
  if (!status) return "idle";
  return KNOWN_STATUSES.has(status) ? (status as GraphNodeVisualStatus) : "unknown";
}

export function graphNodeStatusForExecutionMode(status: string | null | undefined, executionMode: string | null | undefined): GraphNodeVisualStatus {
  const normalizedStatus = normalizeGraphNodeStatus(status);
  if ((executionMode == null || executionMode === "enabled") && normalizedStatus === "skipped") return "idle";
  return normalizedStatus;
}

export function graphNodeStatusClass(status: string | null | undefined): string {
  return `graph-node-${normalizeGraphNodeStatus(status)}`;
}

export function graphNodeHasTracingBorder(status: string | null | undefined): boolean {
  return normalizeGraphNodeStatus(status) === "running";
}
