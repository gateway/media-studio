// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";

import type { GraphEstimateResponse, GraphWorkflowPayload, StudioEdge, StudioNode } from "../types";
import { useGraphPricingEstimate } from "./use-graph-pricing-estimate";

vi.mock("../utils/graph-api", () => ({
  jsonFetch: vi.fn(),
}));

vi.mock("../utils/graph-pricing-preferences", () => ({
  readSkipGraphPricingConfirmationPreference: vi.fn(() => false),
  writeSkipGraphPricingConfirmationPreference: vi.fn(),
}));

import { jsonFetch } from "../utils/graph-api";

function makeEstimate(): GraphEstimateResponse {
  return {
    pricing_summary: {
      estimated_credits: 0,
      estimated_cost_usd: 0,
      has_numeric_estimate: true,
      has_unknown_pricing: false,
      is_authoritative: true,
      is_stale: false,
      output_count: 1,
      pricing_status: "included",
    } as never,
    nodes: {},
    warnings: [],
  };
}

function Harness() {
  const [runtimeStatus, setRuntimeStatus] = useState("idle");
  const [provider, setProvider] = useState("codex_local");
  const [cachedRunId, setCachedRunId] = useState<string | null>(null);
  const appendConsole = vi.fn();
  const nodes = [
    {
      id: "node-1",
      position: { x: 0, y: 0 },
      data: {
        definition: { type: "prompt.llm" },
        fields: { provider },
        status: runtimeStatus,
        executionCache: cachedRunId ? { cachedRunId, cachedArtifactIds: { text: ["artifact-1"] } } : null,
      },
    } as never as StudioNode,
  ];
  const workflowFromCanvas = (_workflowId: string | null, workflowName: string, currentNodes: StudioNode[], _edges: StudioEdge[]): GraphWorkflowPayload => ({
    schema_version: 1,
    workflow_id: "workflow-1",
    name: workflowName,
    nodes: currentNodes.map((node) => ({
      id: node.id,
      type: String(node.data.definition.type),
      position: { x: 0, y: 0 },
      fields: { ...node.data.fields },
      metadata: {
        execution: {
          mode: "enabled",
          cached_run_id: node.data.executionCache?.cachedRunId ?? null,
          cached_artifact_ids: node.data.executionCache?.cachedArtifactIds ?? {},
        },
      },
    })),
    edges: [],
    metadata: {},
  });
  useGraphPricingEstimate({
    workflowId: "workflow-1",
    workflowName: "Steve test",
    nodes,
    edges: [] as StudioEdge[],
    availableCredits: 100,
    workflowFromCanvas,
    appendConsole,
  });

  return (
    <div>
      <button type="button" onClick={() => setRuntimeStatus((current) => (current === "idle" ? "running" : "idle"))}>
        Toggle runtime
      </button>
      <button type="button" onClick={() => setProvider((current) => (current === "codex_local" ? "openrouter" : "codex_local"))}>
        Change provider
      </button>
      <button type="button" onClick={() => setCachedRunId((current) => (current ? null : "run-1"))}>
        Toggle execution cache
      </button>
    </div>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("useGraphPricingEstimate", () => {
  it("does not re-estimate when only runtime node state changes", async () => {
    vi.mocked(jsonFetch).mockResolvedValue(makeEstimate() as never);

    render(<Harness />);

    const flushEstimateTimer = async () => {
      await vi.advanceTimersByTimeAsync(500);
      await Promise.resolve();
    };

    await flushEstimateTimer();
    expect(jsonFetch).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Toggle runtime" }));
    await flushEstimateTimer();
    expect(jsonFetch).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Toggle execution cache" }));
    await flushEstimateTimer();
    expect(jsonFetch).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Change provider" }));
    await flushEstimateTimer();
    expect(jsonFetch).toHaveBeenCalledTimes(2);
  });
});
