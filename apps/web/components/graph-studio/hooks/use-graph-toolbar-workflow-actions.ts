"use client";

import { useCallback } from "react";

import type {
  GraphRun,
  GraphWorkflowPayload,
  GraphWorkflowRecord,
  StudioEdge,
  StudioNode,
} from "../types";
import {
  graphWorkflowSnapshotSignature,
  type GraphTabSnapshot,
} from "../utils/graph-tabs";

type UseGraphToolbarWorkflowActionsParams = {
  commitRenameWorkflow: () => Promise<GraphWorkflowRecord | null>;
  consoleLines: string[];
  edges: StudioEdge[];
  nodes: StudioNode[];
  openRenameWorkflow: (setRenameDraft: (value: string) => void) => void;
  renameDraft: string;
  run: GraphRun | null;
  saveWorkflow: () => Promise<GraphWorkflowRecord>;
  saveWorkflowAs: () => Promise<GraphWorkflowRecord>;
  setRenameDraft: (value: string) => void;
  setWorkflowUpdatedAt: (value: string | null) => void;
  updateActiveTab: (snapshot: GraphTabSnapshot) => void;
  workflowFromCanvas: (
    workflowId: string | null,
    workflowName: string,
    nodes: StudioNode[],
    edges: StudioEdge[],
  ) => GraphWorkflowPayload;
  workflowId: string | null;
  workflowName: string;
  workflowUpdatedAt: string | null;
  closeWorkflowMenu: () => void;
};

function workflowRecordName(record: GraphWorkflowRecord, fallbackName: string) {
  return record.name || fallbackName;
}

export function useGraphToolbarWorkflowActions({
  commitRenameWorkflow,
  consoleLines,
  edges,
  nodes,
  openRenameWorkflow,
  renameDraft,
  run,
  saveWorkflow,
  saveWorkflowAs,
  setRenameDraft,
  setWorkflowUpdatedAt,
  updateActiveTab,
  workflowFromCanvas,
  workflowId,
  workflowName,
  workflowUpdatedAt,
  closeWorkflowMenu,
}: UseGraphToolbarWorkflowActionsParams) {
  const updateSavedActiveTab = useCallback(
    (
      nextWorkflowId: string | null,
      nextWorkflowName: string,
      nextWorkflowUpdatedAt: string | null,
    ) => {
      const workflow = workflowFromCanvas(
        nextWorkflowId,
        nextWorkflowName,
        nodes,
        edges,
      );
      setWorkflowUpdatedAt(nextWorkflowUpdatedAt);
      updateActiveTab({
        workflowId: nextWorkflowId,
        workflowName: nextWorkflowName,
        workflow,
        savedWorkflowSignature: graphWorkflowSnapshotSignature(workflow),
        workflowUpdatedAt: nextWorkflowUpdatedAt,
        runId: run?.run_id ?? null,
        runStatus: run?.status ?? null,
        consoleLines,
        dirty: false,
      });
    },
    [
      consoleLines,
      edges,
      nodes,
      run?.run_id,
      run?.status,
      setWorkflowUpdatedAt,
      updateActiveTab,
      workflowFromCanvas,
    ],
  );

  const onSave = useCallback(() => {
    void saveWorkflow().then((record) => {
      updateSavedActiveTab(
        record.workflow_id,
        workflowRecordName(record, workflowName),
        record.updated_at ?? null,
      );
      closeWorkflowMenu();
    });
  }, [closeWorkflowMenu, saveWorkflow, updateSavedActiveTab, workflowName]);

  const onSaveAs = useCallback(() => {
    void saveWorkflowAs().then((record) => {
      updateSavedActiveTab(
        record.workflow_id,
        workflowRecordName(record, `${workflowName || "Workflow"} Copy`),
        record.updated_at ?? null,
      );
    });
  }, [saveWorkflowAs, updateSavedActiveTab, workflowName]);

  const onOpenRename = useCallback(() => {
    openRenameWorkflow(setRenameDraft);
  }, [openRenameWorkflow, setRenameDraft]);

  const onCommitRename = useCallback(() => {
    const nextName = renameDraft.trim();
    void commitRenameWorkflow().then((record) => {
      if (!nextName) return;
      updateSavedActiveTab(
        record?.workflow_id ?? workflowId,
        nextName,
        record?.updated_at ?? workflowUpdatedAt,
      );
    });
  }, [
    commitRenameWorkflow,
    renameDraft,
    updateSavedActiveTab,
    workflowId,
    workflowUpdatedAt,
  ]);

  return {
    onSave,
    onSaveAs,
    onOpenRename,
    onCommitRename,
  };
}
