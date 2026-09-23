// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRef, useState } from "react";

import { useGraphAssistantHistory } from "./use-graph-assistant-history";
import type { GraphHistorySnapshot } from "../utils/graph-history";
import type { GraphNodeDefinition, GraphWorkspaceTab, GraphWorkflowPayload, StudioEdge, StudioNode } from "../types";

function workflow(name: string, nodeCount: number): GraphWorkflowPayload {
  return {
    schema_version: 1,
    workflow_id: `${name.toLowerCase().replace(/\s+/g, "-")}-workflow`,
    name,
    nodes: Array.from({ length: nodeCount }, (_, index) => ({
      id: `${name.toLowerCase()}-${index}`,
      type: "prompt.text",
      position: { x: index * 120, y: index * 80 },
      fields: { text: `${name} ${index}` },
    })),
    edges: [],
    metadata: {},
  };
}

function snapshot(name: string, nodeCount: number): GraphHistorySnapshot {
  const payload = workflow(name, nodeCount);
  return {
    workflowId: payload.workflow_id ?? null,
    workflowName: payload.name,
    workflowUpdatedAt: null,
    workflow: payload,
  };
}

function nodesForWorkflow(payload: GraphWorkflowPayload): StudioNode[] {
  return payload.nodes.map((node) => ({ ...node, data: {} }) as StudioNode);
}

it("preserves run association and measured positions across layout apply, undo and redo", () => {
  const base = snapshot("Existing", 2);
  const arranged = { ...base, workflow: { ...base.workflow, nodes: base.workflow.nodes.map((node, index) => ({ ...node, position: { x: index * 800, y: 0 } })) } };
  const current = { current: base as GraphHistorySnapshot | null };
  const hydrate = vi.fn();
  const restore = vi.fn();
  const updateTab = vi.fn();
  const activeTab = { tab_id: "existing", workflow_id: base.workflowId, workflow_name: base.workflowName, workflow_json: base.workflow, run_id: "completed-run", run_status: "completed" } as GraphWorkspaceTab;
  const { result } = renderHook(() => useGraphAssistantHistory({
    activeTab, activeTabId: "existing", consoleLines: [], currentHistorySnapshot: base, currentWorkflowPayload: base.workflow,
    currentHistorySnapshotRef: current, nodesRef: { current: nodesForWorkflow(base.workflow) }, edgesRef: { current: [] },
    workflowId: base.workflowId, workflowName: base.workflowName, workflowUpdatedAt: null,
    applyUndoHistorySnapshot: restore, commitSnapshot: vi.fn(), hydrateWorkflowPayload: hydrate,
    markWorkspaceChanged: vi.fn(), redo: vi.fn(() => false), undo: vi.fn(() => false), updateTab,
  }));
  act(() => result.current.applyAssistantWorkflow(arranged.workflow, { baseWorkflow: base.workflow, layoutOnly: true }));
  expect(updateTab).toHaveBeenLastCalledWith("existing", expect.objectContaining({ runId: "completed-run", runStatus: "completed" }));
  expect(hydrate).toHaveBeenLastCalledWith(arranged.workflow, expect.objectContaining({ layoutOnly: true }));
  const measured = { ...arranged, workflow: { ...arranged.workflow, nodes: arranged.workflow.nodes.map((node, index) => ({ ...node, position: { x: index * 1200, y: 0 } })) } };
  current.current = measured;
  act(() => { result.current.undoGraphChange(); });
  expect(restore).toHaveBeenLastCalledWith(expect.objectContaining({ workflow: base.workflow, layoutOnly: true }));
  current.current = base;
  act(() => { result.current.redoGraphChange(); });
  expect(hydrate).toHaveBeenLastCalledWith(measured.workflow, expect.objectContaining({ layoutOnly: true }));
  current.current = measured;
  act(() => { result.current.undoGraphChange(); });
  expect(restore).toHaveBeenLastCalledWith(expect.objectContaining({ workflow: base.workflow, layoutOnly: true }));
});

function AssistantHistoryStalePayloadHarness() {
  const base = snapshot("Existing workflow", 2);
  const applied = snapshot("Existing workflow", 5);
  const staleBlankWorkflow = workflow("New workflow", 0);
  const [currentSnapshot, setCurrentSnapshot] = useState<GraphHistorySnapshot>(base);
  const currentHistorySnapshotRef = useRef<GraphHistorySnapshot | null>(currentSnapshot);
  currentHistorySnapshotRef.current = currentSnapshot;
  const nodesRef = useRef<StudioNode[]>(nodesForWorkflow(currentSnapshot.workflow));
  const edgesRef = useRef<StudioEdge[]>([]);
  const activeTab: GraphWorkspaceTab = {
    tab_id: "tab-existing",
    workflow_id: base.workflowId,
    workflow_name: base.workflowName,
    workflow_json: base.workflow,
    saved_workflow_signature: null,
    workflow_updated_at: null,
    run_id: null,
    run_status: null,
    console_lines: ["Graph Studio ready."],
    dirty: true,
    updated_at: new Date().toISOString(),
  };
  const applySnapshot = (nextSnapshot: GraphHistorySnapshot) => {
    nodesRef.current = nodesForWorkflow(nextSnapshot.workflow);
    edgesRef.current = [];
    setCurrentSnapshot(nextSnapshot);
  };
  const assistantHistory = useGraphAssistantHistory({
    activeTab,
    activeTabId: activeTab.tab_id,
    consoleLines: ["Graph Studio ready."],
    currentHistorySnapshot: currentSnapshot,
    currentWorkflowPayload: staleBlankWorkflow,
    currentHistorySnapshotRef,
    nodesRef,
    edgesRef,
    workflowId: currentSnapshot.workflowId,
    workflowName: currentSnapshot.workflowName,
    workflowUpdatedAt: null,
    applyUndoHistorySnapshot: applySnapshot,
    commitSnapshot: vi.fn(),
    hydrateWorkflowPayload: (nextWorkflow, options) => {
      applySnapshot({
        workflowId: options?.workflowId ?? nextWorkflow.workflow_id ?? null,
        workflowName: options?.workflowName ?? nextWorkflow.name,
        workflowUpdatedAt: options?.workflowUpdatedAt ?? null,
        workflow: nextWorkflow,
      });
    },
    markWorkspaceChanged: vi.fn(),
    redo: vi.fn(() => false),
    undo: vi.fn(() => false),
    updateTab: vi.fn(),
  });
  return (
    <div>
      <p data-testid="node-count">{String(currentSnapshot.workflow.nodes.length)}</p>
      <p data-testid="node-ids">{currentSnapshot.workflow.nodes.map((node) => node.id).join(",")}</p>
      <p data-testid="workflow-name">{currentSnapshot.workflowName}</p>
      <p data-testid="assistant-redo">{String(assistantHistory.assistantRedoAvailable)}</p>
      <button type="button" onClick={() => assistantHistory.applyAssistantWorkflow(applied.workflow)}>
        Apply assistant plan
      </button>
      <button type="button" onClick={() => assistantHistory.undoGraphChange()}>
        Undo
      </button>
      <button type="button" onClick={() => assistantHistory.redoGraphChange()}>
        Redo
      </button>
    </div>
  );
}

function AssistantHistoryBlankTabStaleRefsHarness() {
  const stale = snapshot("Previous workflow", 5);
  const applied = snapshot("New workflow", 5);
  const blankWorkflow = workflow("New workflow", 0);
  const blankSnapshot: GraphHistorySnapshot = {
    workflowId: null,
    workflowName: "New workflow",
    workflowUpdatedAt: null,
    workflow: blankWorkflow,
  };
  const [currentSnapshot, setCurrentSnapshot] = useState<GraphHistorySnapshot>(blankSnapshot);
  const currentHistorySnapshotRef = useRef<GraphHistorySnapshot | null>(stale);
  const nodesRef = useRef<StudioNode[]>(nodesForWorkflow(stale.workflow));
  const edgesRef = useRef<StudioEdge[]>([]);
  const activeTab: GraphWorkspaceTab = {
    tab_id: "tab-blank",
    workflow_id: null,
    workflow_name: "New workflow",
    workflow_json: blankWorkflow,
    saved_workflow_signature: null,
    workflow_updated_at: null,
    run_id: null,
    run_status: null,
    console_lines: ["Graph Studio ready."],
    dirty: false,
    updated_at: new Date().toISOString(),
  };
  const applySnapshot = (nextSnapshot: GraphHistorySnapshot) => {
    nodesRef.current = nodesForWorkflow(nextSnapshot.workflow);
    edgesRef.current = [];
    currentHistorySnapshotRef.current = nextSnapshot;
    setCurrentSnapshot(nextSnapshot);
  };
  const assistantHistory = useGraphAssistantHistory({
    activeTab,
    activeTabId: activeTab.tab_id,
    consoleLines: ["Graph Studio ready."],
    currentHistorySnapshot: currentSnapshot,
    currentWorkflowPayload: stale.workflow,
    currentHistorySnapshotRef,
    nodesRef,
    edgesRef,
    workflowId: null,
    workflowName: "New workflow",
    workflowUpdatedAt: null,
    applyUndoHistorySnapshot: applySnapshot,
    commitSnapshot: vi.fn(),
    hydrateWorkflowPayload: (nextWorkflow, options) => {
      applySnapshot({
        workflowId: options?.workflowId ?? nextWorkflow.workflow_id ?? null,
        workflowName: options?.workflowName ?? nextWorkflow.name,
        workflowUpdatedAt: options?.workflowUpdatedAt ?? null,
        workflow: nextWorkflow,
      });
    },
    markWorkspaceChanged: vi.fn(),
    redo: vi.fn(() => false),
    undo: vi.fn(() => false),
    updateTab: vi.fn(),
  });
  return (
    <div>
      <p data-testid="node-count">{String(currentSnapshot.workflow.nodes.length)}</p>
      <p data-testid="assistant-redo">{String(assistantHistory.assistantRedoAvailable)}</p>
      <button type="button" onClick={() => assistantHistory.applyAssistantWorkflow(applied.workflow)}>
        Apply assistant plan
      </button>
      <button type="button" onClick={() => assistantHistory.undoGraphChange()}>
        Undo
      </button>
      <button type="button" onClick={() => assistantHistory.redoGraphChange()}>
        Redo
      </button>
    </div>
  );
}

function AssistantHistoryDefinitionOverrideHarness() {
  const base = snapshot("Existing workflow", 1);
  const applied: GraphWorkflowPayload = {
    ...workflow("Saved preset workflow", 1),
    nodes: [{ id: "preset", type: "preset.render", position: { x: 0, y: 0 }, fields: { preset_id: "preset-new" } }],
  };
  const definition: GraphNodeDefinition = {
    type: "preset.render",
    title: "Media Preset",
    category: "Preset",
    fields: [{ id: "preset_id", label: "Preset", type: "select", default: "preset-new" }],
    ports: { inputs: [], outputs: [{ id: "image", label: "Image", type: "image" }] },
  };
  const [definitionOverrideSeen, setDefinitionOverrideSeen] = useState(false);
  const currentHistorySnapshotRef = useRef<GraphHistorySnapshot | null>(base);
  const nodesRef = useRef<StudioNode[]>(nodesForWorkflow(base.workflow));
  const edgesRef = useRef<StudioEdge[]>([]);
  const activeTab: GraphWorkspaceTab = {
    tab_id: "tab-existing",
    workflow_id: base.workflowId,
    workflow_name: base.workflowName,
    workflow_json: base.workflow,
    saved_workflow_signature: null,
    workflow_updated_at: null,
    run_id: null,
    run_status: null,
    console_lines: ["Graph Studio ready."],
    dirty: true,
    updated_at: new Date().toISOString(),
  };
  const assistantHistory = useGraphAssistantHistory({
    activeTab,
    activeTabId: activeTab.tab_id,
    consoleLines: ["Graph Studio ready."],
    currentHistorySnapshot: base,
    currentWorkflowPayload: base.workflow,
    currentHistorySnapshotRef,
    nodesRef,
    edgesRef,
    workflowId: base.workflowId,
    workflowName: base.workflowName,
    workflowUpdatedAt: null,
    applyUndoHistorySnapshot: vi.fn(),
    commitSnapshot: vi.fn(),
    hydrateWorkflowPayload: (_nextWorkflow, options) => {
      setDefinitionOverrideSeen(Boolean(options?.definitionsByType?.has("preset.render")));
    },
    markWorkspaceChanged: vi.fn(),
    redo: vi.fn(() => false),
    undo: vi.fn(() => false),
    updateTab: vi.fn(),
  });
  return (
    <div>
      <p data-testid="definition-override-seen">{String(definitionOverrideSeen)}</p>
      <button type="button" onClick={() => assistantHistory.applyAssistantWorkflow(applied, { definitionsByType: new Map([[definition.type, definition]]) })}>
        Apply saved preset plan
      </button>
    </div>
  );
}

afterEach(() => cleanup());

describe("useGraphAssistantHistory", () => {
  it("uses the live history snapshot as assistant undo base when the memoized workflow payload is stale", async () => {
    render(<AssistantHistoryStalePayloadHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Apply assistant plan" }));

    await waitFor(() => expect(screen.getByTestId("node-count").textContent).toBe("5"));
    expect(screen.getByTestId("node-ids").textContent).toContain("existing workflow-0");
    expect(screen.getByTestId("node-ids").textContent).toContain("existing workflow-4");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    await waitFor(() => expect(screen.getByTestId("node-count").textContent).toBe("2"));
    expect(screen.getByTestId("node-ids").textContent).toBe("existing workflow-0,existing workflow-1");
    await waitFor(() => expect(screen.getByTestId("assistant-redo").textContent).toBe("true"));

    fireEvent.click(screen.getByRole("button", { name: "Redo" }));

    await waitFor(() => expect(screen.getByTestId("node-count").textContent).toBe("5"));
    await waitFor(() => expect(screen.getByTestId("assistant-redo").textContent).toBe("false"));
  });

  it("keeps a newly opened blank tab as the assistant undo base even when refs are stale", async () => {
    render(<AssistantHistoryBlankTabStaleRefsHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Apply assistant plan" }));

    await waitFor(() => expect(screen.getByTestId("node-count").textContent).toBe("5"));

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    await waitFor(() => expect(screen.getByTestId("node-count").textContent).toBe("0"));
    await waitFor(() => expect(screen.getByTestId("assistant-redo").textContent).toBe("true"));

    fireEvent.click(screen.getByRole("button", { name: "Redo" }));

    await waitFor(() => expect(screen.getByTestId("node-count").textContent).toBe("5"));
  });

  it("passes refreshed node definitions into assistant workflow hydration", async () => {
    render(<AssistantHistoryDefinitionOverrideHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Apply saved preset plan" }));

    await waitFor(() => expect(screen.getByTestId("definition-override-seen").textContent).toBe("true"));
  });
});
