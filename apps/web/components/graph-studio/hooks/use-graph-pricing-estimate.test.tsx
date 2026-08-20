// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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

function makeEstimate(estimatedCredits = 0): GraphEstimateResponse {
  return {
    pricing_summary: {
      total: { estimated_credits: estimatedCredits, estimated_cost_usd: estimatedCredits * 0.005 },
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
  const [blank, setBlank] = useState(false);
  const appendConsole = vi.fn();
  const nodes = blank ? [] : [
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
  const { graphEstimate } = useGraphPricingEstimate({
    workflowId: blank ? null : "workflow-1",
    workflowName: blank ? "New workflow" : "Steve test",
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
      <button type="button" onClick={() => setBlank(true)}>
        New blank workflow
      </button>
      <button type="button" onClick={() => setBlank(false)}>
        Restore priced workflow
      </button>
      <output aria-label="Estimated credits">
        {graphEstimate?.pricing_summary.total?.estimated_credits ?? "pending"}
      </output>
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

  it("clears one workflow's estimate while another workflow is being priced", async () => {
    vi.mocked(jsonFetch)
      .mockResolvedValueOnce(makeEstimate(10) as never)
      .mockResolvedValueOnce(makeEstimate(6) as never)
      .mockResolvedValueOnce(makeEstimate(6) as never);

    render(<Harness />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(screen.getByRole("status", { name: "Estimated credits" }).textContent).toBe("10");

    fireEvent.click(screen.getByRole("button", { name: "Change provider" }));
    expect(screen.getByRole("status", { name: "Estimated credits" }).textContent).toBe("pending");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(screen.getByRole("status", { name: "Estimated credits" }).textContent).toBe("6");

    fireEvent.click(screen.getByRole("button", { name: "New blank workflow" }));
    expect(screen.getByRole("status", { name: "Estimated credits" }).textContent).toBe("0");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(jsonFetch).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "Restore priced workflow" }));
    expect(screen.getByRole("status", { name: "Estimated credits" }).textContent).toBe("pending");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(screen.getByRole("status", { name: "Estimated credits" }).textContent).toBe("6");
    expect(jsonFetch).toHaveBeenCalledTimes(3);
  });

  it("starts a current request after a rapid workflow round trip invalidates an in-flight request", async () => {
    let resolveStaleRequest: (estimate: GraphEstimateResponse) => void = () => undefined;
    let resolveCurrentRequest: (estimate: GraphEstimateResponse) => void = () => undefined;
    const staleRequest = new Promise<GraphEstimateResponse>((resolve) => {
      resolveStaleRequest = resolve;
    });
    const currentRequest = new Promise<GraphEstimateResponse>((resolve) => {
      resolveCurrentRequest = resolve;
    });
    vi.mocked(jsonFetch)
      .mockReturnValueOnce(staleRequest as never)
      .mockReturnValueOnce(currentRequest as never);

    render(<Harness />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(jsonFetch).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Change provider" }));
    fireEvent.click(screen.getByRole("button", { name: "Change provider" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(jsonFetch).toHaveBeenCalledTimes(2);

    await act(async () => resolveStaleRequest(makeEstimate(10)));
    expect(screen.getByRole("status", { name: "Estimated credits" }).textContent).toBe("pending");
    await act(async () => resolveCurrentRequest(makeEstimate(6)));
    expect(screen.getByRole("status", { name: "Estimated credits" }).textContent).toBe("6");
  });
});
