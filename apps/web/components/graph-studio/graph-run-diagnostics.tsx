"use client";

import { Activity, Clock3, Network, Package, TriangleAlert } from "lucide-react";

import type { GraphRun } from "./types";

function formatMetricSeconds(value: unknown) {
  if (typeof value !== "number") return null;
  return `${value.toFixed(value >= 10 ? 1 : 2)}s`;
}

function compactRunStatus(status: string) {
  if (status === "completed") return "done";
  if (status === "cancelled") return "cancel";
  return status;
}

export function GraphRunDiagnostics({ run }: { run: GraphRun | null }) {
  if (!run) return null;
  const metrics = run.metrics_json ?? {};
  const duration = formatMetricSeconds(metrics.duration_seconds);
  const outputAssetIds = Array.isArray(metrics.output_asset_ids) ? metrics.output_asset_ids.map(String) : [];
  const failedNodeId = typeof metrics.failed_node_id === "string" ? metrics.failed_node_id : null;
  const nodeCount = Number(metrics.completed_node_count ?? run.nodes?.length ?? 0);
  return (
    <section className={`graph-run-diagnostics graph-run-diagnostics-${run.status}`} data-testid="graph-run-diagnostics">
      <div aria-label={`Status ${run.status}`} title={`Status: ${run.status}`}>
        <Activity size={13} aria-hidden="true" />
        <strong>{compactRunStatus(run.status)}</strong>
      </div>
      {duration ? (
        <div aria-label={`Duration ${duration}`} title={`Duration: ${duration}`}>
          <Clock3 size={13} aria-hidden="true" />
          <strong>{duration}</strong>
        </div>
      ) : null}
      <div aria-label={`${nodeCount} completed nodes`} title={`Nodes: ${nodeCount}`}>
        <Network size={13} aria-hidden="true" />
        <strong>{String(nodeCount)}</strong>
      </div>
      {outputAssetIds.length ? (
        <div aria-label={`${outputAssetIds.length} output assets`} title={`Assets: ${outputAssetIds.length}`}>
          <Package size={13} aria-hidden="true" />
          <strong>{outputAssetIds.length}</strong>
        </div>
      ) : null}
      {failedNodeId ? (
        <div aria-label={`Failed node ${failedNodeId}`} title={`Failed node: ${failedNodeId}`}>
          <TriangleAlert size={13} aria-hidden="true" />
          <strong>{failedNodeId}</strong>
        </div>
      ) : null}
      {run.error ? <p>{run.error}</p> : null}
    </section>
  );
}
