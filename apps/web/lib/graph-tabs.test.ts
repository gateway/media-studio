import { describe, expect, it } from "vitest";

import { applyGraphTabSnapshot, blankGraphWorkflowPayload, graphTabCloseTarget, graphTabOpenWorkflowTarget } from "@/components/graph-studio/utils/graph-tabs";
import type { GraphWorkspaceTab, GraphWorkflowPayload } from "@/components/graph-studio/types";

function tab(tab_id: string, name: string): GraphWorkspaceTab {
  return { tab_id, workflow_name: name, workflow_id: `${tab_id}-workflow`, workflow_json: workflow(name), dirty: false };
}

function workflow(name: string): GraphWorkflowPayload {
  return { schema_version: 1, workflow_id: null, name, nodes: [], edges: [] };
}

describe("graph workspace tabs", () => {
  it("returns the previous tab when closing the active throwaway tab", () => {
    const tabs = [tab("main", "Nano Slice Four Kling"), tab("scratch", "New workflow")];
    expect(graphTabCloseTarget(tabs, "scratch", "scratch")?.tab_id).toBe("main");
  });

  it("keeps the active tab when closing an inactive tab", () => {
    const tabs = [tab("main", "Nano Slice Four Kling"), tab("scratch", "New workflow")];
    expect(graphTabCloseTarget(tabs, "main", "scratch")?.tab_id).toBe("main");
  });

  it("applies the current canvas snapshot before tab persistence", () => {
    const updated = applyGraphTabSnapshot(tab("main", "Old"), {
      workflowId: "workflow-live",
      workflowName: "Live canvas",
      workflow: workflow("Live canvas"),
      runId: "run-1",
      consoleLines: ["node.started", "node.completed"],
      dirty: true,
    });
    expect(updated.workflow_id).toBe("workflow-live");
    expect(updated.workflow_name).toBe("Live canvas");
    expect(updated.run_id).toBe("run-1");
    expect(updated.console_lines).toEqual(["node.started", "node.completed"]);
    expect(updated.dirty).toBe(true);
    expect(updated.workflow_json?.name).toBe("Live canvas");
  });

  it("opens a selected saved workflow in a separate tab while snapshotting the active tab", () => {
    const active = tab("main", "Current workflow");
    const selected = applyGraphTabSnapshot({ ...tab("selected", "Selected workflow"), workflow_id: null }, {
      workflowId: "workflow-selected",
      workflowName: "Selected workflow",
      workflow: { ...workflow("Selected workflow"), workflow_id: "workflow-selected" },
      runId: null,
      dirty: false,
    });
    const result = graphTabOpenWorkflowTarget([active], active.tab_id, selected, {
      workflowId: active.workflow_id,
      workflowName: "Current edited workflow",
      workflow: workflow("Current edited workflow"),
      runId: "run-current",
      consoleLines: ["current console"],
      dirty: true,
    });
    expect(result.activeTabId).toBe(selected.tab_id);
    expect(result.tabs).toHaveLength(2);
    expect(result.tabs[0].workflow_name).toBe("Current edited workflow");
    expect(result.tabs[0].dirty).toBe(true);
    expect(result.tabs[1].workflow_id).toBe("workflow-selected");
    expect(result.tabs[1].workflow_name).toBe("Selected workflow");
  });

  it("focuses an already-open workflow tab instead of duplicating it", () => {
    const active = tab("main", "Current workflow");
    const existing = tab("selected", "Old selected name");
    const selected = applyGraphTabSnapshot(existing, {
      workflowId: existing.workflow_id,
      workflowName: "Fresh selected name",
      workflow: workflow("Fresh selected name"),
      runId: null,
      dirty: false,
    });
    const result = graphTabOpenWorkflowTarget([active, existing], active.tab_id, selected);
    expect(result.activeTabId).toBe(existing.tab_id);
    expect(result.tabs).toHaveLength(2);
    expect(result.tabs[1].workflow_name).toBe("Fresh selected name");
  });

  it("creates a blank workflow payload for workflow close", () => {
    expect(blankGraphWorkflowPayload()).toEqual({
      schema_version: 1,
      workflow_id: null,
      name: "New workflow",
      nodes: [],
      edges: [],
      metadata: {},
    });
  });
});
