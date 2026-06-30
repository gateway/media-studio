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
  const updateActiveTab = vi.fn();
  const setWorkflowUpdatedAt = vi.fn();
  const closeWorkflowMenu = vi.fn();
  const workflowFromCanvas = vi.fn(
    (workflowId: string | null, workflowName: string) =>
      workflow(workflowId, workflowName),
  );
  const params: Parameters<typeof useGraphToolbarWorkflowActions>[0] = {
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
    updateActiveTab,
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
    updateActiveTab,
    setWorkflowUpdatedAt,
    closeWorkflowMenu,
    workflowFromCanvas,
  };
}

describe("useGraphToolbarWorkflowActions", () => {
  it("updates the active tab snapshot after save", async () => {
    const { result, updateActiveTab, setWorkflowUpdatedAt, closeWorkflowMenu } =
      setup();

    act(() => {
      result.current.onSave();
    });

    await waitFor(() => expect(updateActiveTab).toHaveBeenCalledTimes(1));
    const savedWorkflow = workflow("workflow-1", "Saved workflow");
    expect(setWorkflowUpdatedAt).toHaveBeenCalledWith(
      "2026-06-10T02:00:00.000Z",
    );
    expect(updateActiveTab).toHaveBeenCalledWith({
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
    const { result, updateActiveTab } = setup({
      saveWorkflowAs: vi.fn(async () => ({
        workflow_id: "workflow-copy",
        name: "",
        updated_at: "2026-06-10T03:00:00.000Z",
      })),
    });

    act(() => {
      result.current.onSaveAs();
    });

    await waitFor(() => expect(updateActiveTab).toHaveBeenCalledTimes(1));
    expect(updateActiveTab.mock.calls[0][0]).toMatchObject({
      workflowId: "workflow-copy",
      workflowName: "Saved workflow Copy",
      workflowUpdatedAt: "2026-06-10T03:00:00.000Z",
      dirty: false,
    });
  });

  it("updates local unsaved rename snapshots without requiring a saved record", async () => {
    const { result, updateActiveTab } = setup({
      commitRenameWorkflow: vi.fn(async () => null),
      renameDraft: " Local Rename ",
      workflowId: null,
      workflowUpdatedAt: null,
    });

    act(() => {
      result.current.onCommitRename();
    });

    await waitFor(() => expect(updateActiveTab).toHaveBeenCalledTimes(1));
    expect(updateActiveTab.mock.calls[0][0]).toMatchObject({
      workflowId: null,
      workflowName: "Local Rename",
      workflowUpdatedAt: null,
      dirty: false,
    });
  });

  it("does not update the active tab when committing a blank rename", async () => {
    const { result, params, updateActiveTab } = setup({
      renameDraft: "   ",
    });

    act(() => {
      result.current.onCommitRename();
    });

    await waitFor(() =>
      expect(params.commitRenameWorkflow).toHaveBeenCalledTimes(1),
    );
    expect(updateActiveTab).not.toHaveBeenCalled();
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
