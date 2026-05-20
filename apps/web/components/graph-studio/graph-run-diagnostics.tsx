"use client";

import { Activity, ArrowDownUp, Clock3, Coins, Image as ImageIcon, Network, Package, TriangleAlert } from "lucide-react";

import { formatUsdAmount } from "@/lib/utils";
import { humanizeGraphRunStatus } from "@/lib/status-language";
import type { GraphRun, GraphRunTransportMetrics } from "./types";

function formatMetricSeconds(value: unknown) {
  if (typeof value !== "number") return null;
  return `${value.toFixed(value >= 10 ? 1 : 2)}s`;
}

function titleFromType(value: string) {
  const normalized = value
    .replace(/^model\.kie\./, "")
    .replace(/^prompt\./, "")
    .replace(/^media\./, "")
    .replace(/^display\./, "")
    .replace(/^preview\./, "")
    .replace(/^video\./, "")
    .replace(/^audio\./, "")
    .replace(/^image\./, "")
    .replace(/^debug\./, "")
    .replace(/^control\./, "")
    .replace(/^utility\./, "")
    .replace(/[_\-.]+/g, " ")
    .trim();
  if (!normalized) return value;
  return normalized
    .replace("seedance 2 0", "seedance 2.0")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function compactFailedNodeLabel(run: GraphRun, failedNodeId: string) {
  const workflowNodes = Array.isArray(run.workflow_json?.nodes) ? run.workflow_json.nodes : [];
  const matchingNode = workflowNodes.find((node) => node?.id === failedNodeId);
  if (matchingNode?.type) return titleFromType(String(matchingNode.type));
  const compactId = failedNodeId.replace(/-[a-f0-9]{8,}$/i, "");
  return titleFromType(compactId);
}

function compactErrorMessage(value: string) {
  const normalized = value.trim();
  if (!normalized) return "";
  if (normalized === "Request is not ready for submit.") return "submit blocked";
  if (normalized.length <= 48) return normalized;
  return `${normalized.slice(0, 45)}...`;
}

function codexImageCount(run: GraphRun) {
  let sawCodex = false;
  let imageCount = 0;
  for (const node of run.nodes ?? []) {
    const metrics = node.metrics_json ?? {};
    const calls = Array.isArray(metrics.llm_calls) ? metrics.llm_calls : [];
    const nodeUsedCodex = calls.some((call) => call && typeof call === "object" && (call as Record<string, unknown>).provider_kind === "codex_local");
    if (!nodeUsedCodex) continue;
    sawCodex = true;
    const count = metrics.image_count;
    if (typeof count === "number" && Number.isFinite(count)) {
      imageCount += count;
    }
  }
  return sawCodex ? imageCount : null;
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
  const failedNodeId = typeof metrics.failed_node_id === "string" ? metrics.failed_node_id : null;
  const nodeCount = Number(metrics.completed_node_count ?? run.nodes?.length ?? 0);
  const actualCostUsd = typeof metrics.actual_cost_usd === "number" ? metrics.actual_cost_usd : null;
  const totalTokens = typeof metrics.total_tokens === "number" ? metrics.total_tokens : null;
  const showActualSpend = (actualCostUsd ?? 0) > 0 || (totalTokens ?? 0) > 0;
  const failedNodeLabel = failedNodeId ? compactFailedNodeLabel(run, failedNodeId) : null;
  const compactError = run.error ? compactErrorMessage(run.error) : "";
  const totalTransportRequests =
    transportMetrics.statusRequests + transportMetrics.fullRunRequests + transportMetrics.eventRequests;
  const codexImages = codexImageCount(run);
  return (
    <section className={`graph-run-diagnostics graph-run-diagnostics-${run.status}`} data-testid="graph-run-diagnostics">
      <div aria-label={`Status ${humanizeGraphRunStatus(run.status)}`} title={`Status: ${humanizeGraphRunStatus(run.status)}`}>
        <Activity size={13} aria-hidden="true" />
        <strong>{humanizeGraphRunStatus(run.status)}</strong>
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
        <div aria-label={`Actual LLM spend ${formatUsdAmount(actualCostUsd) ?? "$0.00"}`} title={`Actual LLM spend: ${formatUsdAmount(actualCostUsd) ?? "$0.00"}`}>
          <Coins size={13} aria-hidden="true" />
          <strong>{formatUsdAmount(actualCostUsd) ?? "$0.00"}</strong>
          {totalTokens != null ? <small>{totalTokens.toLocaleString()} tok</small> : null}
        </div>
      ) : null}
      {codexImages != null ? (
        <div aria-label={`Codex saw ${codexImages} images`} title={`Codex saw ${codexImages} image${codexImages === 1 ? "" : "s"} during this run`}>
          <ImageIcon size={13} aria-hidden="true" />
          <strong>{codexImages}</strong>
          <small>Codex img</small>
        </div>
      ) : null}
      {failedNodeId && failedNodeLabel ? (
        <div aria-label={`Failed node ${failedNodeLabel}`} title={`Failed node: ${failedNodeId}`}>
          <TriangleAlert size={13} aria-hidden="true" />
          <strong>{failedNodeLabel}</strong>
        </div>
      ) : null}
      {compactError ? (
        <div className="graph-run-diagnostics-error" aria-label={`Run error ${compactError}`} title={run.error ?? compactError}>
          <TriangleAlert size={13} aria-hidden="true" />
          <strong>{compactError}</strong>
        </div>
      ) : null}
    </section>
  );
}
