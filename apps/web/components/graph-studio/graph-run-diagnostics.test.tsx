// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { GraphRunDiagnostics } from "@/components/graph-studio/graph-run-diagnostics";
import type { GraphRun } from "@/components/graph-studio/types";

function makeRun(overrides: Partial<GraphRun> = {}): GraphRun {
  return {
    run_id: "run-1",
    workflow_id: "workflow-1",
    status: "failed",
    error: "Request is not ready for submit.",
    workflow_json: {
      schema_version: 1,
      name: "Steve test",
      nodes: [
        {
          id: "model.kie.seedance_2_0-72a82274",
          type: "model.kie.seedance_2_0",
          position: { x: 0, y: 0 },
          fields: {},
        },
      ],
      edges: [],
      metadata: {},
    },
    metrics_json: {
      completed_node_count: 1,
      actual_cost_usd: 0,
      total_tokens: 0,
      failed_node_id: "model.kie.seedance_2_0-72a82274",
    },
    nodes: [],
    ...overrides,
  };
}

describe("GraphRunDiagnostics", () => {
  it("hides zero-usage spend chips and compacts failed node diagnostics", () => {
    render(
      <GraphRunDiagnostics
        run={makeRun()}
        transportMetrics={{ statusRequests: 0, fullRunRequests: 0, eventRequests: 0, streamConnections: 0, streamErrors: 0 }}
      />,
    );

    expect(screen.queryByLabelText(/Actual LLM spend/i)).toBeNull();
    expect(screen.getByLabelText("Failed node Seedance 2.0")).toBeTruthy();
    expect(screen.getByLabelText("Run error submit blocked")).toBeTruthy();
  });

  it("shows actual spend when usage is present", () => {
    render(
      <GraphRunDiagnostics
        run={makeRun({
          status: "completed",
          error: null,
          metrics_json: {
            completed_node_count: 4,
            actual_cost_usd: 0.0184,
            total_tokens: 13920,
          },
        })}
        transportMetrics={{ statusRequests: 4, fullRunRequests: 1, eventRequests: 2, streamConnections: 1, streamErrors: 0 }}
      />,
    );

    expect(screen.getByLabelText(/Actual LLM spend/i).textContent).toContain("$0.02");
    expect(screen.getByText("13,920 tok")).toBeTruthy();
    expect(screen.getByLabelText("7 graph transport requests")).toBeTruthy();
  });

  it("shows how many images Codex saw during a run", () => {
    render(
      <GraphRunDiagnostics
        run={makeRun({
          status: "completed",
          error: null,
          nodes: [
            {
              node_id: "recipe",
              node_type: "prompt.recipe",
              status: "completed",
              metrics_json: {
                image_count: 2,
                llm_calls: [{ provider_kind: "codex_local", provider_model_id: "gpt-5.4" }],
              },
            },
          ],
        })}
        transportMetrics={{ statusRequests: 0, fullRunRequests: 0, eventRequests: 0, streamConnections: 0, streamErrors: 0 }}
      />,
    );

    expect(screen.getByLabelText("Codex saw 2 images")).toBeTruthy();
  });

  it("shows when an interrupted run recovered provider work", () => {
    render(
      <GraphRunDiagnostics
        run={makeRun({
          status: "completed",
          error: null,
          metrics_json: {
            completed_node_count: 4,
            recovered_from_interruption: true,
            recovered_node_ids: ["model"],
            resumed_node_ids: ["save"],
          },
        })}
        transportMetrics={{ statusRequests: 0, fullRunRequests: 0, eventRequests: 0, streamConnections: 0, streamErrors: 0 }}
      />,
    );

    expect(screen.getByLabelText("Recovered interrupted run with 1 recovered nodes and 1 resumed nodes")).toBeTruthy();
    expect(screen.getByText("Recovered")).toBeTruthy();
  });
});
