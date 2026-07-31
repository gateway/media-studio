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

  it("retains existing output while a new run has only empty queued state", () => {
    const outputSnapshot = { image: [{ asset_id: "asset-1" }] };
    const next = graphNodeDataWithRunState(makeData({ executionMode: "enabled", outputSnapshot }), {
      status: "queued",
      progress: 0,
      error: null,
      output_snapshot_json: {},
      metrics_json: {},
    });

    expect(next.status).toBe("queued");
    expect(next.outputSnapshot).toBe(outputSnapshot);
  });

  it("retains existing output when a muted run node skips without replacement output", () => {
    const outputSnapshot = { image: [{ asset_id: "asset-1" }] };
    const next = graphNodeDataWithRunState(makeData({ executionMode: "muted", outputSnapshot }), {
      status: "skipped",
      progress: 1,
      error: null,
      output_snapshot_json: {},
      metrics_json: { execution_mode: "muted" },
    });

    expect(next.status).toBe("skipped");
    expect(next.outputSnapshot).toBe(outputSnapshot);
  });

  it("clears existing output when a completed run produces an empty snapshot", () => {
    const next = graphNodeDataWithRunState(makeData({ executionMode: "enabled", outputSnapshot: { image: [{ asset_id: "asset-1" }] } }), {
      status: "completed",
      progress: 1,
      error: null,
      output_snapshot_json: {},
      metrics_json: {},
    });

    expect(next.outputSnapshot).toEqual({});
  });

  it("refreshes the reusable cache from a completed node's matching artifacts", () => {
    const next = graphNodeDataWithRunState(
      makeData({
        executionMode: "enabled",
        executionCache: { cachedRunId: "run-old", cachedArtifactIds: { image: ["artifact-old"] } },
      }),
      {
        run_id: "run-new",
        node_id: "model",
        status: "completed",
        progress: 1,
        error: null,
        output_snapshot_json: { image: [{ asset_id: "asset-new" }] },
        artifacts: [
          {
            artifact_id: "artifact-new-2",
            run_id: "run-new",
            node_id: "model",
            output_port: "image",
            output_index: 1,
          },
          {
            artifact_id: "artifact-new-1",
            run_id: "run-new",
            node_id: "model",
            output_port: "image",
            output_index: 0,
          },
        ],
        metrics_json: { execution_mode: "enabled" },
      },
    );

    expect(next.executionCache).toEqual({
      cachedRunId: "run-new",
      cachedArtifactIds: { image: ["artifact-new-1", "artifact-new-2"] },
    });
  });

  it("does not replace a valid cache from a failed or artifact-free run", () => {
    const executionCache = { cachedRunId: "run-good", cachedArtifactIds: { image: ["artifact-good"] } };
    const next = graphNodeDataWithRunState(makeData({ executionMode: "enabled", executionCache }), {
      run_id: "run-failed",
      node_id: "model",
      status: "failed",
      progress: 1,
      error: "provider failed",
      output_snapshot_json: {},
      artifacts: [],
      metrics_json: { execution_mode: "enabled" },
    });

    expect(next.executionCache).toBe(executionCache);
  });

  it("ignores artifacts that do not belong to the completed node run", () => {
    const executionCache = { cachedRunId: "run-good", cachedArtifactIds: { image: ["artifact-good"] } };
    const next = graphNodeDataWithRunState(makeData({ executionMode: "enabled", executionCache }), {
      run_id: "run-new",
      node_id: "model",
      status: "completed",
      progress: 1,
      error: null,
      output_snapshot_json: { image: [{ asset_id: "asset-new" }] },
      artifacts: [
        {
          artifact_id: "artifact-other",
          run_id: "run-other",
          node_id: "model",
          output_port: "image",
          output_index: 0,
        },
      ],
      metrics_json: { execution_mode: "enabled" },
    });

    expect(next.executionCache).toBe(executionCache);
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
