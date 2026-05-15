import type { GraphRun, GraphRunEvent, StudioNode } from "../types";

export type GraphNodeActivity = {
  label: string;
  detail?: string | null;
  tone: "active" | "success" | "warning" | "error" | "muted";
};

function formatSeconds(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(value >= 10 ? 1 : 2)}s` : null;
}

function compactId(value: unknown) {
  return typeof value === "string" && value ? value.slice(0, 12) : null;
}

function nodeLabel(nodeId: string | null | undefined, nodes: StudioNode[]) {
  if (!nodeId) return null;
  const node = nodes.find((item) => item.id === nodeId);
  if (!node) return nodeId;
  return node.data.customTitle?.trim() || node.data.definition.title || nodeId;
}

function metricDetail(metrics: Record<string, unknown> | undefined) {
  if (!metrics) return null;
  return formatSeconds(metrics.duration_seconds);
}

function eventActivity(event: GraphRunEvent): GraphNodeActivity | null {
  const payload = event.payload_json ?? {};
  const metrics = typeof payload.metrics === "object" && payload.metrics ? (payload.metrics as Record<string, unknown>) : undefined;
  switch (event.event_type) {
    case "node.queued":
      return { label: "Queued", detail: "Waiting for upstream inputs", tone: "muted" };
    case "node.started":
      return { label: "Starting", detail: "Preparing node inputs", tone: "active" };
    case "kie.validating":
      return { label: "Checking request", detail: typeof payload.model_key === "string" ? payload.model_key : "Validating model settings", tone: "active" };
    case "kie.submitted":
      return { label: "Submitted", detail: "Provider job created", tone: "active" };
    case "kie.polling":
      return { label: "Rendering", detail: compactId(payload.job_id) ? `Provider job ${compactId(payload.job_id)}` : "Waiting for provider result", tone: "active" };
    case "node.completed":
      return { label: "Completed", detail: metricDetail(metrics), tone: "success" };
    case "node.cached":
      return { label: "Cached", detail: metricDetail(metrics), tone: "muted" };
    case "node.bypassed":
      return { label: "Bypassed", detail: "Passed inputs through", tone: "muted" };
    case "node.skipped":
      return { label: "Disabled", detail: "No output generated", tone: "muted" };
    case "asset.created":
      return { label: "Saved asset", detail: "Added to gallery", tone: "success" };
    case "asset.reused":
      return { label: "Reused asset", detail: "Already in gallery", tone: "muted" };
    case "node.failed":
      return { label: "Failed", detail: typeof payload.error === "string" ? payload.error : null, tone: "error" };
    default:
      return null;
  }
}

function statusActivity(status: string, metrics?: Record<string, unknown>, error?: string | null): GraphNodeActivity | null {
  if (status === "running") return { label: "Processing", detail: "Working on this node", tone: "active" };
  if (status === "queued") return { label: "Queued", detail: "Waiting for its turn", tone: "muted" };
  if (status === "completed") return { label: "Completed", detail: metricDetail(metrics), tone: "success" };
  if (status === "cached") return { label: "Cached", detail: metricDetail(metrics), tone: "muted" };
  if (status === "bypassed") return { label: "Bypassed", detail: "Passed inputs through", tone: "muted" };
  if (status === "skipped") return { label: "Disabled", detail: "No output generated", tone: "muted" };
  if (status === "failed") return { label: "Failed", detail: error ?? null, tone: "error" };
  return null;
}

export function graphNodeActivitiesFromRunEvents(events: GraphRunEvent[], run: GraphRun | null): Record<string, GraphNodeActivity> {
  const activities: Record<string, GraphNodeActivity> = {};
  run?.nodes?.forEach((node) => {
    const activity = statusActivity(node.status, node.metrics_json, node.error);
    if (activity) activities[node.node_id] = activity;
  });
  events.forEach((event) => {
    if (!event.node_id) return;
    const activity = eventActivity(event);
    if (activity) activities[event.node_id] = activity;
  });
  return activities;
}

export function formatGraphRunEventForConsole(event: GraphRunEvent, nodes: StudioNode[]) {
  const activity = eventActivity(event);
  const label = nodeLabel(event.node_id, nodes);
  if (activity && label) return `${activity.label}: ${label}${activity.detail ? ` - ${activity.detail}` : ""}`;
  if (activity) return `${activity.label}${activity.detail ? ` - ${activity.detail}` : ""}`;
  if (event.event_type === "run.created") return "Run queued";
  if (event.event_type === "run.validating") return "Checking workflow";
  if (event.event_type === "run.compiled") return "Workflow compiled";
  if (event.event_type === "run.started") return "Run started";
  if (event.event_type === "run.completed") return "Run completed";
  if (event.event_type === "run.failed") return "Run failed";
  return event.event_type;
}

export function formatGraphRunEventsForConsole(events: GraphRunEvent[], nodes: StudioNode[], limit = 20) {
  return events.slice(-limit).reverse().map((event) => formatGraphRunEventForConsole(event, nodes));
}
