// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GraphToolbar } from "./graph-toolbar";
import type { GraphRun, GraphRunTransportMetrics, GraphWorkspaceTab } from "./types";

afterEach(() => {
  cleanup();
});

function makeRun(overrides: Partial<GraphRun> = {}): GraphRun {
  return {
    run_id: "run-1",
    workflow_id: "workflow-1",
    status: "running",
    workflow_json: { schema_version: 1, workflow_id: "workflow-1", name: "Steve test", nodes: [], edges: [], metadata: {} },
    nodes: [],
    ...overrides,
  };
}

const transportMetrics: GraphRunTransportMetrics = {
  statusRequests: 0,
  fullRunRequests: 0,
  eventRequests: 0,
  streamConnections: 0,
  streamErrors: 0,
};

function renderToolbar(run: GraphRun | null, overrides: Partial<ComponentProps<typeof GraphToolbar>> = {}) {
  const props: ComponentProps<typeof GraphToolbar> = {
    workflowName: "Steve test",
    workflowMenuOpen: false,
    renameDialogOpen: false,
    renameDraft: "Steve test",
    run,
    transportMetrics,
    creditText: "50 credits",
    creditsUnavailable: false,
    graphPricing: null,
    onToggleWorkflowMenu: vi.fn(),
    onSave: vi.fn(),
    onSaveAs: vi.fn(),
    onExportWorkflow: vi.fn(),
    onExportBundle: vi.fn(),
    onOpenRename: vi.fn(),
    onCloseWorkflow: vi.fn(),
    onRenameDraftChange: vi.fn(),
    onCommitRename: vi.fn(),
    onCancelRename: vi.fn(),
    onRun: vi.fn(),
    onCancelRun: vi.fn(),
    ...overrides,
  };
  return render(<GraphToolbar {...props} />);
}

describe("GraphToolbar", () => {
  it("shows a cancel button while a run is active", () => {
    const onCancelRun = vi.fn();
    renderToolbar(makeRun(), { onCancelRun });

    fireEvent.click(screen.getByTestId("graph-cancel-button"));
    expect(onCancelRun).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("graph-run-button")).toBeNull();
  });

  it("shows a disabled cancelling state while a run is stopping", () => {
    renderToolbar(makeRun({ status: "cancelling" }));

    expect(screen.getByTestId("graph-cancel-button").hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Cancelling")).toBeTruthy();
  });

  it("shows active run state on inactive workflow tabs", () => {
    const tabs: GraphWorkspaceTab[] = [
      { tab_id: "tab-1", workflow_name: "Current workflow", workflow_id: "workflow-1", run_id: null, run_status: null, dirty: false },
      { tab_id: "tab-2", workflow_name: "Background workflow", workflow_id: "workflow-2", run_id: "run-2", run_status: "running", dirty: false },
    ];

    renderToolbar(null, { tabs, activeTabId: "tab-1" });

    expect(screen.getByTitle("Run status: Running")).toBeTruthy();
  });
});
