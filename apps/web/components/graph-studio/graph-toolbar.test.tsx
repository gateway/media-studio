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
    onCloseWorkflowMenu: vi.fn(),
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

    expect(screen.getByLabelText("Run status: Running")).toBeTruthy();
    expect(screen.queryByText("Running")).toBeNull();
  });

  it("shows a clear unsaved marker on dirty workflow tabs", () => {
    const tabs: GraphWorkspaceTab[] = [
      { tab_id: "tab-1", workflow_name: "Current workflow", workflow_id: "workflow-1", run_id: null, run_status: null, dirty: true },
    ];

    renderToolbar(null, { tabs, activeTabId: "tab-1" });

    expect(screen.getByLabelText("Unsaved workflow changes")).toBeTruthy();
    expect(screen.queryByText("Unsaved")).toBeNull();
  });

  it("keeps graph pricing warnings on the pricing pill without a duplicate count badge", () => {
    const { container } = renderToolbar(null, {
      graphPricing: {
        pricing_summary: {
          total: { estimated_credits: null, estimated_cost_usd: null },
          has_numeric_estimate: false,
          has_unknown_pricing: true,
        },
        nodes: {},
        warnings: [
          { code: "missing_preset_text", message: "Missing text" },
          { code: "disconnected_node", message: "Disconnected" },
        ],
      },
    });

    const pricingPill = screen.getByTestId("graph-pricing-balance");
    expect(pricingPill.textContent).toContain("price ? + unknown");
    expect(pricingPill.getAttribute("title")).toContain("Unknown model pricing");
    expect(container.querySelector(".graph-pricing-warning-count")).toBeNull();
  });

  it("exposes a close other tabs action from the active workflow menu", () => {
    const onCloseOtherTabs = vi.fn();
    const onToggleWorkflowMenu = vi.fn();
    const onCloseWorkflowMenu = vi.fn();
    const tabs: GraphWorkspaceTab[] = [
      { tab_id: "tab-1", workflow_name: "Current workflow", workflow_id: "workflow-1", run_id: null, run_status: null, dirty: false },
      { tab_id: "tab-2", workflow_name: "Dream 1", workflow_id: "workflow-2", run_id: null, run_status: null, dirty: false },
    ];

    renderToolbar(null, {
      tabs,
      activeTabId: "tab-1",
      workflowMenuOpen: true,
      onCloseOtherTabs,
      onToggleWorkflowMenu,
      onCloseWorkflowMenu,
    });

    fireEvent.click(screen.getByRole("menuitem", { name: /close other tabs/i }));
    expect(onCloseOtherTabs).toHaveBeenCalledTimes(1);
    expect(onToggleWorkflowMenu).not.toHaveBeenCalled();
    expect(onCloseWorkflowMenu).toHaveBeenCalledTimes(1);
  });

  it("closes the active tab from the workflow menu when multiple tabs are open", () => {
    const onCloseTab = vi.fn();
    const onCloseWorkflow = vi.fn();
    const onToggleWorkflowMenu = vi.fn();
    const onCloseWorkflowMenu = vi.fn();
    const tabs: GraphWorkspaceTab[] = [
      { tab_id: "tab-1", workflow_name: "Current workflow", workflow_id: "workflow-1", run_id: null, run_status: null, dirty: false },
      { tab_id: "tab-2", workflow_name: "Scratch workflow", workflow_id: "workflow-2", run_id: null, run_status: null, dirty: false },
    ];

    renderToolbar(null, {
      tabs,
      activeTabId: "tab-1",
      workflowMenuOpen: true,
      onCloseTab,
      onCloseWorkflow,
      onToggleWorkflowMenu,
      onCloseWorkflowMenu,
    });

    fireEvent.click(screen.getByRole("menuitem", { name: /^close$/i }));
    expect(onCloseTab).toHaveBeenCalledWith("tab-1");
    expect(onCloseWorkflow).not.toHaveBeenCalled();
    expect(onToggleWorkflowMenu).not.toHaveBeenCalled();
    expect(onCloseWorkflowMenu).toHaveBeenCalledTimes(1);
  });

  it("resets the active workflow from the workflow menu when only one tab is open", () => {
    const onCloseTab = vi.fn();
    const onCloseWorkflow = vi.fn();
    const onToggleWorkflowMenu = vi.fn();
    const onCloseWorkflowMenu = vi.fn();
    const tabs: GraphWorkspaceTab[] = [
      { tab_id: "tab-1", workflow_name: "Current workflow", workflow_id: "workflow-1", run_id: null, run_status: null, dirty: false },
    ];

    renderToolbar(null, {
      tabs,
      activeTabId: "tab-1",
      workflowMenuOpen: true,
      onCloseTab,
      onCloseWorkflow,
      onToggleWorkflowMenu,
      onCloseWorkflowMenu,
    });

    fireEvent.click(screen.getByRole("menuitem", { name: /^close$/i }));
    expect(onCloseTab).not.toHaveBeenCalled();
    expect(onCloseWorkflow).toHaveBeenCalledTimes(1);
    expect(onToggleWorkflowMenu).not.toHaveBeenCalled();
    expect(onCloseWorkflowMenu).toHaveBeenCalledTimes(1);
  });
});
