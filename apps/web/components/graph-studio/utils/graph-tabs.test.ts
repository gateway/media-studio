// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import type { GraphWorkspaceTab } from "@/components/graph-studio/types";
import { applyGraphTabSnapshot } from "@/components/graph-studio/utils/graph-tabs";

const workflow = {
  schema_version: 1 as const,
  workflow_id: "workflow-1",
  name: "Steve test",
  nodes: [],
  edges: [],
  metadata: {},
};

describe("graph tab state", () => {
  it("persists active run status for per-tab diagnostics", () => {
    const tab: GraphWorkspaceTab = {
      tab_id: "tab-1",
      workflow_id: "workflow-1",
      workflow_name: "Steve test",
      workflow_json: workflow,
      run_id: null,
      run_status: null,
      assistant_session_id: null,
      dirty: false,
    };

    const next = applyGraphTabSnapshot(tab, {
      workflowId: "workflow-1",
      workflowName: "Steve test",
      workflow,
      runId: "run-1",
      runStatus: "running",
      dirty: false,
    });

    expect(next.run_id).toBe("run-1");
    expect(next.run_status).toBe("running");
  });

  it("can explicitly clear a stale assistant session when resetting a tab", () => {
    const tab: GraphWorkspaceTab = {
      tab_id: "tab-1",
      workflow_id: "workflow-1",
      workflow_name: "Steve test",
      workflow_json: workflow,
      run_id: null,
      run_status: null,
      assistant_session_id: "session-old",
      dirty: false,
    };

    const next = applyGraphTabSnapshot(tab, {
      workflowId: null,
      workflowName: "New workflow",
      workflow: { ...workflow, workflow_id: null, name: "New workflow" },
      assistantSessionId: null,
      dirty: false,
    });

    expect(next.assistant_session_id).toBeNull();
  });
});
