"use client";

import { ArrowDownUp, Clock3, Coins, Network, Package, RotateCcw } from "lucide-react";

import { formatUsdAmount } from "@/lib/utils";
import type { GraphRun, GraphRunTransportMetrics } from "./types";

function formatMetricSeconds(value: unknown) {
  if (typeof value !== "number") return null;
  return `${value.toFixed(value >= 10 ? 1 : 2)}s`;
}

export function GraphRunDiagnostics({
  run,
  transportMetrics,
}: {
  run: GraphRun | null;
  transportMetrics: GraphRunTransportMetrics;
}) {
  if (!run) return null;
  const metrics = run.metrics_json ?? {};
  const duration = formatMetricSeconds(metrics.duration_seconds);
  const outputAssetIds = Array.isArray(metrics.output_asset_ids) ? metrics.output_asset_ids.map(String) : [];
  const nodeCount = Number(metrics.completed_node_count ?? run.nodes?.length ?? 0);
  const actualCostUsd = typeof metrics.actual_cost_usd === "number" ? metrics.actual_cost_usd : null;
  const totalTokens = typeof metrics.total_tokens === "number" ? metrics.total_tokens : null;
  const showActualSpend = (actualCostUsd ?? 0) > 0;
  const totalTransportRequests =
    transportMetrics.statusRequests + transportMetrics.fullRunRequests + transportMetrics.eventRequests;
  const recoveredNodeIds = Array.isArray(metrics.recovered_node_ids) ? metrics.recovered_node_ids.map(String) : [];
  const resumedNodeIds = Array.isArray(metrics.resumed_node_ids) ? metrics.resumed_node_ids.map(String) : [];
  const recoveredFromInterruption = metrics.recovered_from_interruption === true;
  return (
    <section className={`graph-run-diagnostics graph-run-diagnostics-${run.status}`} data-testid="graph-run-diagnostics">
      {recoveredFromInterruption ? (
        <div
          aria-label={`Recovered interrupted run with ${recoveredNodeIds.length} recovered nodes and ${resumedNodeIds.length} resumed nodes`}
          title={`Recovered interrupted run. Recovered nodes: ${recoveredNodeIds.length}. Resumed nodes: ${resumedNodeIds.length}.`}
        >
          <RotateCcw size={13} aria-hidden="true" />
          <strong>Recovered</strong>
        </div>
      ) : null}
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
      {totalTransportRequests > 0 ? (
        <div
          aria-label={`${totalTransportRequests} graph transport requests`}
          title={`Transport requests: status ${transportMetrics.statusRequests}, full ${transportMetrics.fullRunRequests}, events ${transportMetrics.eventRequests}, streams ${transportMetrics.streamConnections}, stream errors ${transportMetrics.streamErrors}`}
        >
          <ArrowDownUp size={13} aria-hidden="true" />
          <strong>{totalTransportRequests}</strong>
        </div>
      ) : null}
      {outputAssetIds.length ? (
        <div aria-label={`${outputAssetIds.length} output assets`} title={`Assets: ${outputAssetIds.length}`}>
          <Package size={13} aria-hidden="true" />
          <strong>{outputAssetIds.length}</strong>
        </div>
      ) : null}
      {showActualSpend && actualCostUsd != null ? (
        <div
          aria-label={`Actual LLM usage ${formatUsdAmount(actualCostUsd) ?? "$0.00"}`}
          title={`Actual LLM usage for this run: ${formatUsdAmount(actualCostUsd) ?? "$0.00"}${totalTokens != null ? `, ${totalTokens.toLocaleString()} tokens` : ""}`}
        >
          <Coins size={13} aria-hidden="true" />
          <strong>{formatUsdAmount(actualCostUsd) ?? "$0.00"}</strong>
          {totalTokens != null ? <small>{totalTokens.toLocaleString()} tok</small> : null}
        </div>
      ) : null}
    </section>
  );
}
