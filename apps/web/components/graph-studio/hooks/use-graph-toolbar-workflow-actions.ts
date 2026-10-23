"use client";

import { useCallback, useRef } from "react";

import type { GraphRun, GraphWorkflowPayload, GraphWorkflowRecord, GraphWorkspaceTab, StudioEdge, StudioNode } from "../types";
import { graphWorkflowSnapshotSignature, type GraphTabSnapshot } from "../utils/graph-tabs";

type UseGraphToolbarWorkflowActionsParams = {
  appendConsole: (line: string) => void;
  setRenameDialogOpen: (open: boolean) => void;
  activeTabId: string;
  tabs: GraphWorkspaceTab[];
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
  setWorkflowId: (value: string | null) => void;
  setWorkflowName: (value: string) => void;
  setWorkflowUpdatedAt: (value: string | null) => void;
  updateTab: (tabId: string | null, snapshot: GraphTabSnapshot) => void;
  workflowFromCanvas: (workflowId: string | null, workflowName: string, nodes: StudioNode[], edges: StudioEdge[]) => GraphWorkflowPayload;
  workflowId: string | null;
  workflowName: string;
  workflowUpdatedAt: string | null;
  closeWorkflowMenu: () => void;
};

type SaveRequest = { tabId: string; token: symbol; sourceName: string; workflow: GraphWorkflowPayload };

function sourceSnapshot(current: UseGraphToolbarWorkflowActionsParams, source: GraphWorkspaceTab, fallback: GraphWorkflowPayload): GraphTabSnapshot {
  if (current.activeTabId === source.tab_id) return {
    workflowId: current.workflowId, workflowName: current.workflowName,
    workflow: current.workflowFromCanvas(current.workflowId, current.workflowName, current.nodes, current.edges),
    workflowUpdatedAt: current.workflowUpdatedAt, runId: current.run?.run_id,
    runStatus: current.run?.status, consoleLines: current.consoleLines,
  };
  return {
    workflowId: source.workflow_id ?? null, workflowName: source.workflow_name,
    workflow: source.workflow_json ?? fallback, workflowUpdatedAt: source.workflow_updated_at,
    runId: source.run_id, runStatus: source.run_status, consoleLines: source.console_lines,
  };
}

export function useGraphToolbarWorkflowActions(params: UseGraphToolbarWorkflowActionsParams) {
  const latest = useRef(params);
  latest.current = params;
  const pendingSaveByTab = useRef(new Map<string, symbol>());
  const { activeTabId, commitRenameWorkflow, openRenameWorkflow, renameDraft, saveWorkflow, saveWorkflowAs, setRenameDraft, workflowFromCanvas, workflowId, workflowName, nodes, edges } = params;

  const beginSave = useCallback((id: string | null, name: string): SaveRequest => {
    const token = Symbol();
    pendingSaveByTab.current.set(activeTabId, token);
    return { tabId: activeTabId, token, sourceName: workflowName, workflow: workflowFromCanvas(id, name, nodes, edges) };
  }, [activeTabId, edges, nodes, workflowFromCanvas, workflowName]);

  const completeSave = useCallback((request: SaveRequest, record: GraphWorkflowRecord) => {
    if (pendingSaveByTab.current.get(request.tabId) !== request.token) return;
    pendingSaveByTab.current.delete(request.tabId);
    const current = latest.current;
    const source = current.tabs.find((tab) => tab.tab_id === request.tabId);
    if (!source) return;
    const snapshot = sourceSnapshot(current, source, request.workflow);
    const savedName = record.name || request.workflow.name;
    const saved = { ...request.workflow, workflow_id: record.workflow_id, name: savedName };
    const name = snapshot.workflowName === request.sourceName ? savedName : snapshot.workflowName;
    const workflow = { ...snapshot.workflow, workflow_id: record.workflow_id, name };
    const savedSignature = graphWorkflowSnapshotSignature(saved);
    const updatedAt = record.updated_at ?? null;
    current.updateTab(request.tabId, {
      ...snapshot, workflowId: record.workflow_id, workflowName: name, workflow,
      savedWorkflowSignature: savedSignature, workflowUpdatedAt: updatedAt,
      dirty: graphWorkflowSnapshotSignature(workflow) !== savedSignature,
    });
    // The source may be inactive; its saved baseline must not replace the active canvas.
    if (current.activeTabId === request.tabId) {
      current.setWorkflowId(record.workflow_id);
      current.setWorkflowName(name);
      current.setWorkflowUpdatedAt(updatedAt);
      current.closeWorkflowMenu();
      current.appendConsole(`Saved workflow ${record.workflow_id}.`);
      return true;
    }
    return false;
  }, []);

  const onSave = useCallback(() => {
    const request = beginSave(workflowId, workflowName);
    void saveWorkflow().then((record) => completeSave(request, record));
  }, [beginSave, completeSave, saveWorkflow, workflowId, workflowName]);

  const onSaveAs = useCallback(() => {
    const request = beginSave(null, `${workflowName || "Workflow"} Copy`);
    void saveWorkflowAs().then((record) => completeSave(request, record));
  }, [beginSave, completeSave, saveWorkflowAs, workflowName]);

  const onOpenRename = useCallback(() => {
    openRenameWorkflow(setRenameDraft);
  }, [openRenameWorkflow, setRenameDraft]);

  const onCommitRename = useCallback(() => {
    const name = renameDraft.trim();
    if (!name) return;
    const request = workflowId ? beginSave(workflowId, name) : null;
    void commitRenameWorkflow().then((record) => {
      if (request && record && completeSave(request, record)) {
        latest.current.appendConsole(`Renamed workflow to ${name}.`);
        latest.current.setRenameDialogOpen(false);
      }
    });
  }, [beginSave, commitRenameWorkflow, completeSave, renameDraft, workflowId]);

  return { onSave, onSaveAs, onOpenRename, onCommitRename };
}
