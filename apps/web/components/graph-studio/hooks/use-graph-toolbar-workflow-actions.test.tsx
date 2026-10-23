// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { GraphWorkflowPayload, GraphWorkflowRecord } from "../types";
import { graphWorkflowSnapshotSignature } from "../utils/graph-tabs";
import { useGraphToolbarWorkflowActions } from "./use-graph-toolbar-workflow-actions";

function record(
  workflowId: string,
  name: string,
  updatedAt = "2026-06-10T02:00:00.000Z",
): GraphWorkflowRecord {
  return { workflow_id: workflowId, name, updated_at: updatedAt };
}

function workflow(
  workflowId: string | null,
  name: string,
): GraphWorkflowPayload {
  return {
    schema_version: 1,
    workflow_id: workflowId,
    name,
    nodes: [],
    edges: [],
    metadata: { created_by: "test" },
  };
}

function setup(
  overrides: Partial<Parameters<typeof useGraphToolbarWorkflowActions>[0]> = {},
) {
  const updateTab = vi.fn();
  const setWorkflowUpdatedAt = vi.fn();
  const closeWorkflowMenu = vi.fn();
  const workflowFromCanvas = vi.fn(
    (workflowId: string | null, workflowName: string) =>
      workflow(workflowId, workflowName),
  );
  const params: Parameters<typeof useGraphToolbarWorkflowActions>[0] = {
    appendConsole: vi.fn(), setRenameDialogOpen: vi.fn(),
    activeTabId: "tab-1",
    tabs: [{ tab_id: "tab-1", workflow_id: "workflow-1", workflow_name: "Saved workflow", workflow_json: workflow("workflow-1", "Saved workflow"), dirty: false }],
    setWorkflowId: vi.fn(), setWorkflowName: vi.fn(),
    commitRenameWorkflow: vi.fn(async () =>
      record("workflow-1", "Renamed workflow"),
    ),
    consoleLines: ["Graph Studio ready."],
    edges: [],
    nodes: [],
    openRenameWorkflow: vi.fn(),
    renameDraft: "Renamed workflow",
    run: { run_id: "run-1", workflow_id: "workflow-1", status: "completed" },
    saveWorkflow: vi.fn(async () => record("workflow-1", "Saved workflow")),
    saveWorkflowAs: vi.fn(async () =>
      record("workflow-copy", "Saved workflow Copy"),
    ),
    setRenameDraft: vi.fn(),
    setWorkflowUpdatedAt,
    updateTab,
    workflowFromCanvas,
    workflowId: "workflow-1",
    workflowName: "Saved workflow",
    workflowUpdatedAt: "2026-06-10T01:00:00.000Z",
    closeWorkflowMenu,
    ...overrides,
  };
  return {
    ...renderHook(() => useGraphToolbarWorkflowActions(params)),
    params,
    updateTab,
    setWorkflowUpdatedAt,
    closeWorkflowMenu,
    workflowFromCanvas,
  };
}

describe("useGraphToolbarWorkflowActions", () => {
  it("updates the active tab snapshot after save", async () => {
    const { result, updateTab, setWorkflowUpdatedAt, closeWorkflowMenu } =
      setup();

    act(() => {
      result.current.onSave();
    });

    await waitFor(() => expect(updateTab).toHaveBeenCalledTimes(1));
    const savedWorkflow = workflow("workflow-1", "Saved workflow");
    expect(setWorkflowUpdatedAt).toHaveBeenCalledWith(
      "2026-06-10T02:00:00.000Z",
    );
    expect(updateTab).toHaveBeenCalledWith("tab-1", {
      workflowId: "workflow-1",
      workflowName: "Saved workflow",
      workflow: savedWorkflow,
      savedWorkflowSignature: graphWorkflowSnapshotSignature(savedWorkflow),
      workflowUpdatedAt: "2026-06-10T02:00:00.000Z",
      runId: "run-1",
      runStatus: "completed",
      consoleLines: ["Graph Studio ready."],
      dirty: false,
    });
    expect(closeWorkflowMenu).toHaveBeenCalledTimes(1);
  });

  it("uses copy fallback naming after save-as when the record has no name", async () => {
    const { result, updateTab } = setup({
      saveWorkflowAs: vi.fn(async () => ({
        workflow_id: "workflow-copy",
        name: "",
        updated_at: "2026-06-10T03:00:00.000Z",
      })),
    });

    act(() => {
      result.current.onSaveAs();
    });

    await waitFor(() => expect(updateTab).toHaveBeenCalledTimes(1));
    expect(updateTab.mock.calls[0][1]).toMatchObject({
      workflowId: "workflow-copy",
      workflowName: "Saved workflow Copy",
      workflowUpdatedAt: "2026-06-10T03:00:00.000Z",
      dirty: false,
    });
  });

  it("leaves local unsaved rename to the synchronous workspace handler", async () => {
    const { result, params, updateTab } = setup({ workflowId: null, renameDraft: " Local Rename " });
    act(() => { result.current.onCommitRename(); });
    await waitFor(() => expect(params.commitRenameWorkflow).toHaveBeenCalledTimes(1));
    expect(updateTab).not.toHaveBeenCalled();
  });

  it("does not update the active tab when committing a blank rename", async () => {
    const { result, params, updateTab } = setup({
      renameDraft: "   ",
    });

    act(() => {
      result.current.onCommitRename();
    });

    expect(params.commitRenameWorkflow).not.toHaveBeenCalled();
    expect(updateTab).not.toHaveBeenCalled();
  });

  it("delegates rename opening with the current draft setter", () => {
    const openRenameWorkflow = vi.fn();
    const setRenameDraft = vi.fn();
    const { result } = setup({ openRenameWorkflow, setRenameDraft });

    act(() => {
      result.current.onOpenRename();
    });

    expect(openRenameWorkflow).toHaveBeenCalledWith(setRenameDraft);
  });
});
