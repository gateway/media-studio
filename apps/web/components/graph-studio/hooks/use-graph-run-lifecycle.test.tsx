// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";

import type { GraphRun, GraphRunStatusSnapshot, GraphWorkflowPayload, GraphWorkflowRecord, StudioEdge, StudioNode } from "../types";
import { useGraphRunLifecycle } from "./use-graph-run-lifecycle";

vi.mock("../utils/graph-api", () => ({
  jsonFetch: vi.fn(),
}));

vi.mock("../utils/graph-media-preview", () => ({
  assetIdsFromGraphRun: vi.fn(() => ["asset-1"]),
}));

vi.mock("../utils/graph-run-events", () => ({
  formatGraphRunEventsForConsole: vi.fn(() => ["event"]),
}));

import { jsonFetch } from "../utils/graph-api";

class MockEventSource {
  static instances: MockEventSource[] = [];

  url: string;
  listeners = new Map<string, Set<() => void>>();
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, handler: () => void) {
    const current = this.listeners.get(type) ?? new Set();
    current.add(handler);
    this.listeners.set(type, current);
  }

  close() {
    this.closed = true;
  }
}

function makeWorkflow(): GraphWorkflowPayload {
  return {
    schema_version: 1,
    workflow_id: "workflow-1",
    name: "Steve test",
    nodes: [{ id: "node-1", type: "prompt.recipe", position: { x: 0, y: 0 }, fields: {} }],
    edges: [],
    metadata: {},
  };
}

function makeRun(overrides: Partial<GraphRun> = {}): GraphRun {
  return {
    run_id: "run-1",
    workflow_id: "workflow-1",
    status: "running",
    workflow_json: makeWorkflow(),
    nodes: [],
    ...overrides,
  };
}

function makeRunStatus(overrides: Partial<GraphRunStatusSnapshot> = {}): GraphRunStatusSnapshot {
  return {
    run_id: "run-1",
    workflow_id: "workflow-1",
    status: "running",
    latest_event_id: null,
    nodes: [],
    ...overrides,
  };
}

type HarnessProps = {
  refreshCredits: () => Promise<void>;
  refreshImageAssets: () => Promise<void>;
  refreshAssetsByIds: (assetIds: string[]) => Promise<void>;
  refreshReferenceMedia: () => Promise<void>;
};

function Harness(props: HarnessProps) {
  const [run, setRun] = useState<GraphRun | null>(makeRun());
  const [revision, setRevision] = useState(0);
  const appendConsole = vi.fn();

  const { refreshRunState, cancelRun } = useGraphRunLifecycle({
    run,
    setRun,
    workflowId: "workflow-1",
    workflowName: "Steve test",
    nodes: [
      {
        id: "node-1",
        data: {
          definition: { title: "Prompt Recipe" },
          fields: {},
          status: revision ? "running" : "queued",
        },
      } as never as StudioNode,
    ],
    edges: [] as StudioEdge[],
    saveWorkflow: async () => ({ workflow_id: "workflow-1" }) as GraphWorkflowRecord,
    workflowFromCanvas: () => makeWorkflow(),
    resetNodeRunState: vi.fn(),
    applyValidationErrorsToNodes: vi.fn(),
    applyRunNodesToCanvas: vi.fn(),
    applyRunEventsToCanvas: vi.fn(),
    refreshCredits: props.refreshCredits,
    refreshImageAssets: props.refreshImageAssets,
    refreshAssetsByIds: props.refreshAssetsByIds,
    refreshReferenceMedia: props.refreshReferenceMedia,
    setConsoleLines: vi.fn(),
    appendConsole,
  });

  return (
    <div>
      <button type="button" onClick={() => setRevision((current) => current + 1)}>
        Rewrite run object
      </button>
      <button type="button" onClick={() => void refreshRunState("run-1")}>
        Refresh run
      </button>
      <button type="button" onClick={() => void cancelRun()}>
        Cancel run
      </button>
    </div>
  );
}

beforeEach(() => {
  MockEventSource.instances = [];
  vi.stubGlobal("EventSource", MockEventSource);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("useGraphRunLifecycle", () => {
  it("keeps one live event stream for the same run id across run state updates", () => {
    render(
      <Harness
        refreshCredits={vi.fn().mockResolvedValue(undefined)}
        refreshImageAssets={vi.fn().mockResolvedValue(undefined)}
        refreshAssetsByIds={vi.fn().mockResolvedValue(undefined)}
        refreshReferenceMedia={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0]?.url).toContain("/api/control/media/graph/runs/run-1/events/stream");

    fireEvent.click(screen.getByRole("button", { name: "Rewrite run object" }));
    fireEvent.click(screen.getByRole("button", { name: "Rewrite run object" }));

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0]?.closed).toBe(false);
  });

  it("deduplicates output refresh work while repeated run refreshes return the same assets", async () => {
    const refreshCredits = vi.fn().mockResolvedValue(undefined);
    const refreshImageAssets = vi.fn().mockResolvedValue(undefined);
    const refreshAssetsByIds = vi.fn().mockResolvedValue(undefined);
    const refreshReferenceMedia = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.mocked(jsonFetch);
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/status")) {
        return makeRunStatus({
          nodes: [
            {
              run_node_id: "run-node-1",
              run_id: "run-1",
              node_id: "node-1",
              node_type: "prompt.recipe",
              status: "completed",
              has_output_snapshot: true,
            },
          ],
        }) as never;
      }
      if (url.includes("/events")) return { items: [] } as never;
      return makeRun({
        nodes: [{ node_id: "node-1", node_type: "prompt.recipe", status: "completed", output_snapshot_json: { text: "done" } }],
      }) as never;
    });

    render(
      <Harness
        refreshCredits={refreshCredits}
        refreshImageAssets={refreshImageAssets}
        refreshAssetsByIds={refreshAssetsByIds}
        refreshReferenceMedia={refreshReferenceMedia}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Refresh run" }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh run" }));

    await waitFor(() => expect(refreshReferenceMedia).toHaveBeenCalledTimes(1));
    expect(refreshImageAssets).toHaveBeenCalledTimes(1);
    expect(refreshAssetsByIds).toHaveBeenCalledTimes(1);
    expect(refreshAssetsByIds).toHaveBeenCalledWith(["asset-1"]);
    expect(refreshCredits).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith("/api/control/media/graph/runs/run-1/status");
  });

  it("posts cancel for the active run and refreshes terminal state", async () => {
    const fetchMock = vi.mocked(jsonFetch);
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/cancel")) {
        expect(init).toMatchObject({ method: "POST" });
        return makeRun({ status: "cancelling" }) as never;
      }
      if (url.endsWith("/status")) {
        return makeRunStatus({ status: "cancelled" }) as never;
      }
      if (url.includes("/events")) return { items: [] } as never;
      return makeRun({ status: "cancelled", nodes: [] }) as never;
    });

    render(
      <Harness
        refreshCredits={vi.fn().mockResolvedValue(undefined)}
        refreshImageAssets={vi.fn().mockResolvedValue(undefined)}
        refreshAssetsByIds={vi.fn().mockResolvedValue(undefined)}
        refreshReferenceMedia={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel run" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/control/media/graph/runs/run-1/cancel", { method: "POST" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/control/media/graph/runs/run-1/status"));
  });
});
