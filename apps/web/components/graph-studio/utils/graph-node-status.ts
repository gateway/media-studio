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

export function graphNodeStatusClass(status: string | null | undefined): string {
  return `graph-node-${normalizeGraphNodeStatus(status)}`;
}

export function graphNodeHasTracingBorder(status: string | null | undefined): boolean {
  return normalizeGraphNodeStatus(status) === "running";
}
