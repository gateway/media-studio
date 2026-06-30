import { describe, expect, it } from "vitest";

import {
  clearGraphNodeRunState,
  graphNodeDataWithExecutionMode,
  graphNodeDataWithRunState,
  graphRunNodeStateMatchesExecutionMode,
} from "@/components/graph-studio/utils/graph-node-runtime";
import type { GraphNodeData } from "@/components/graph-studio/types";

function makeData(overrides: Partial<GraphNodeData> = {}): GraphNodeData {
  return {
    definition: {
      type: "model.kie.gpt_image_2_image_to_image",
      title: "GPT Image 2 Image to Image",
      description: "Generate an image.",
      category: "Models/Image",
      fields: [],
      ports: { inputs: [], outputs: [] },
    },
    fields: {},
    status: "skipped",
    progress: 1,
    errorMessage: "old run state",
    activityLabel: "Muted",
    activityDetail: "Skipped in the previous run",
    activityTone: "muted",
    executionMode: "frozen",
    onFieldChange: () => {},
    ...overrides,
  };
}

describe("graphNodeDataWithExecutionMode", () => {
  it("clears stale run styling when a node execution mode changes", () => {
    const next = graphNodeDataWithExecutionMode(makeData(), "enabled");

    expect(next.executionMode).toBe("enabled");
    expect(next.status).toBe("idle");
    expect(next.progress).toBeNull();
    expect(next.errorMessage).toBeNull();
    expect(next.activityLabel).toBeNull();
    expect(next.activityDetail).toBeNull();
    expect(next.activityTone).toBeNull();
  });

  it("preserves non-runtime node data", () => {
    const outputSnapshot = { image_url: "/asset.png" };
    const executionCache = { cachedRunId: "run-1", cachedArtifactIds: { image: ["asset-1"] } };
    const next = graphNodeDataWithExecutionMode(makeData({ outputSnapshot, executionCache }), "frozen");

    expect(next.outputSnapshot).toBe(outputSnapshot);
    expect(next.executionCache).toBe(executionCache);
  });

  it("reuses already-cleared data to avoid redundant canvas updates", () => {
    const data = makeData({
      status: "idle",
      progress: null,
      errorMessage: null,
      activityLabel: null,
      activityDetail: null,
      activityTone: null,
    });

    expect(clearGraphNodeRunState(data)).toBe(data);
  });

  it("ignores stale run state when the run execution mode no longer matches the node", () => {
    const data = makeData({ executionMode: "enabled" });
    const runNode = {
      status: "skipped",
      progress: 1,
      error: null,
      output_snapshot_json: { value: "old output" },
      metrics_json: { execution_mode: "frozen" },
    };

    expect(graphRunNodeStateMatchesExecutionMode(data, runNode)).toBe(false);
    const next = graphNodeDataWithRunState(data, runNode);

    expect(next.status).toBe("idle");
    expect(next.activityLabel).toBeNull();
    expect(next.outputSnapshot).toBeUndefined();
  });

  it("applies run state when it matches the node execution mode", () => {
    const outputSnapshot = { value: "cached output" };
    const next = graphNodeDataWithRunState(makeData({ executionMode: "frozen" }), {
      status: "cached",
      progress: 1,
      error: null,
      output_snapshot_json: outputSnapshot,
      metrics_json: { execution_mode: "frozen" },
    });

    expect(next.status).toBe("cached");
    expect(next.progress).toBe(1);
    expect(next.outputSnapshot).toBe(outputSnapshot);
  });

  it("reuses equivalent run state snapshots to avoid ReactFlow update loops", () => {
    const data = makeData({
      executionMode: "frozen",
      status: "cached",
      progress: 1,
      errorMessage: null,
      outputSnapshot: { value: "cached output" },
    });

    const next = graphNodeDataWithRunState(data, {
      status: "cached",
      progress: 1,
      error: null,
      output_snapshot_json: { value: "cached output" },
      metrics_json: { execution_mode: "frozen" },
    });

    expect(next).toBe(data);
  });
});
