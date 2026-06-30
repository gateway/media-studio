"use client";

import { History, Pin, RotateCcw, Search } from "lucide-react";

import { formatUsdAmount } from "@/lib/utils";
import { GraphSectionTitle, GraphSidebarEmpty } from "./graph-dialog-primitives";
import type { GraphArtifact, GraphRunHistoryItem } from "./types";
import { formatGraphTimestamp } from "./utils/graph-time";

function runDuration(run: GraphRunHistoryItem): string {
  const metricsDuration = run.metrics_json?.duration_ms;
  if (typeof metricsDuration === "number" && Number.isFinite(metricsDuration)) return `${Math.round(metricsDuration / 1000)}s`;
  if (!run.started_at || !run.finished_at) return "-";
  const duration = Date.parse(run.finished_at) - Date.parse(run.started_at);
  return Number.isFinite(duration) && duration >= 0 ? `${Math.round(duration / 1000)}s` : "-";
}

function outputCount(run: GraphRunHistoryItem): number {
  if (typeof run.artifact_count === "number") return run.artifact_count;
  return run.nodes?.reduce((total, node) => total + (node.artifacts?.length ?? 0), 0) ?? 0;
}

function actualCost(run: GraphRunHistoryItem): number | null {
  const value = run.metrics_json?.actual_cost_usd;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function GraphRunHistoryPanel({
  workflowId,
  runs,
  artifacts,
  selectedRunId,
  onRefresh,
  onInspectRun,
  onRestoreRun,
  onPinArtifact,
}: {
  workflowId: string | null;
  runs: GraphRunHistoryItem[];
  artifacts: GraphArtifact[];
  selectedRunId: string | null;
  onRefresh: () => void;
  onInspectRun: (runId: string) => void;
  onRestoreRun: (run: GraphRunHistoryItem) => void | Promise<void>;
  onPinArtifact: (artifact: GraphArtifact) => void;
}) {
  const selectedRun = selectedRunId ? runs.find((run) => run.run_id === selectedRunId) ?? null : null;
  const selectedRunSpendNodes = (selectedRun?.nodes ?? []).filter((node) => {
    const cost = node.metrics_json?.actual_cost_usd;
    return typeof cost === "number" && Number.isFinite(cost) && cost > 0;
  });
  return (
    <div className="graph-run-history-panel">
      <div className="graph-run-history-actions">
        <button type="button" onClick={onRefresh} disabled={!workflowId}>
          <History size={14} />
          Refresh runs
        </button>
      </div>
      {!workflowId ? <GraphSidebarEmpty>Save or load a workflow to inspect run history.</GraphSidebarEmpty> : null}
      {workflowId && !runs.length ? <GraphSidebarEmpty>No runs recorded for this workflow yet.</GraphSidebarEmpty> : null}
      {runs.map((run) => (
        <div className={`graph-run-history-row ${selectedRunId === run.run_id ? "graph-run-history-row-active" : ""}`} key={run.run_id}>
          <button type="button" onClick={() => onInspectRun(run.run_id)}>
            <span>
              <strong>{run.status}</strong>
              <small>{formatGraphTimestamp(run.created_at) || run.run_id}</small>
            </span>
            <span className="graph-run-history-meta">
              {runDuration(run)} · {run.node_count ?? run.nodes?.length ?? 0} nodes · {outputCount(run)} artifacts
              {actualCost(run) != null ? ` · ${formatUsdAmount(actualCost(run))}` : ""}
            </span>
          </button>
          <button type="button" aria-label={`Restore run ${run.run_id}`} title="Restore run snapshot" onClick={() => void onRestoreRun(run)}>
            <RotateCcw size={14} />
          </button>
        </div>
      ))}
      {selectedRunId ? (
        <section className="graph-artifact-browser">
          {selectedRunSpendNodes.length ? (
            <>
              <GraphSectionTitle>LLM spend</GraphSectionTitle>
              {selectedRunSpendNodes.map((node) => (
                <div className="graph-artifact-row" key={`spend-${node.node_id}`}>
                  <Search size={13} />
                  <span>
                    <strong>{node.node_id}</strong>
                    <small>
                      {node.node_type}
                      {typeof node.metrics_json?.total_tokens === "number"
                        ? ` · ${node.metrics_json.total_tokens.toLocaleString()} tokens`
                        : ""}
                    </small>
                  </span>
                  <strong>{formatUsdAmount(node.metrics_json?.actual_cost_usd ?? null) ?? "n/a"}</strong>
                </div>
              ))}
            </>
          ) : null}
          <GraphSectionTitle>Artifacts</GraphSectionTitle>
          {artifacts.length ? (
            artifacts.map((artifact) => (
              <div className="graph-artifact-row" key={artifact.artifact_id}>
                <Search size={13} />
                <span>
                  <strong>
                    {artifact.node_id}.{artifact.output_port}
                    {artifact.output_index ? ` #${artifact.output_index + 1}` : ""}
                  </strong>
                  <small>
                    {artifact.media_type ?? artifact.kind}
                    {artifact.transform_type ? ` · ${artifact.transform_type}` : ""}
                    {artifact.asset_id ? ` · asset ${artifact.asset_id}` : artifact.reference_id ? ` · ref ${artifact.reference_id}` : ""}
                  </small>
                </span>
                <button type="button" aria-label={`Mute ${artifact.node_id} to this artifact`} title="Mute node to this run output" onClick={() => onPinArtifact(artifact)}>
                  <Pin size={13} />
                </button>
              </div>
            ))
          ) : (
            <GraphSidebarEmpty>No artifacts recorded for this run.</GraphSidebarEmpty>
          )}
        </section>
      ) : null}
    </div>
  );
}
