export type GraphExecutionMode = "enabled" | "frozen" | "bypassed" | "muted";

const EXECUTION_MODES = new Set(["enabled", "frozen", "bypassed", "muted"]);

export function normalizeGraphExecutionMode(value: unknown): GraphExecutionMode {
  return typeof value === "string" && EXECUTION_MODES.has(value) ? (value as GraphExecutionMode) : "enabled";
}

export function graphExecutionModeLabel(mode: GraphExecutionMode): string {
  if (mode === "frozen") return "Frozen";
  if (mode === "bypassed") return "Bypassed";
  if (mode === "muted") return "Muted";
  return "Enabled";
}

export function graphExecutionModeClass(mode: GraphExecutionMode): string {
  return mode === "enabled" ? "" : `graph-node-execution-${mode}`;
}
