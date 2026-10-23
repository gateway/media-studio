import { useCallback } from "react";

import type { GraphRun, GraphWorkflowPayload, GraphWorkflowRecord, GraphWorkflowSummary, StudioEdge, StudioNode } from "../types";
import { jsonFetch } from "../utils/graph-api";
import { useGraphWorkflowBrowser } from "./use-graph-workflow-browser";

export function useGraphWorkflowActions({
  browserOpen = false,
  workflowId,
  workflowName,
  renameDraft,
  nodes,
  edges,
  workflowFromCanvas,
  setWorkflowId,
  setWorkflowName,
  setWorkflowUpdatedAt,
  setRun,
  setNodes,
  setEdges,
  setConsoleLines,
  onCloseWorkspace,
  setWorkflowMenuOpen,
  setRenameDialogOpen,
  appendConsole,
}: {
  browserOpen?: boolean;
  workflowId: string | null;
  workflowName: string;
  renameDraft: string;
  nodes: StudioNode[];
  edges: StudioEdge[];
  workflowFromCanvas: (workflowId: string | null, workflowName: string, nodes: StudioNode[], edges: StudioEdge[]) => GraphWorkflowPayload;
  setWorkflowId: (workflowId: string | null) => void;
  setWorkflowName: (name: string) => void;
  setWorkflowUpdatedAt: (value: string | null) => void;
  setRun: (run: GraphRun | null) => void;
  setNodes: (nodes: StudioNode[] | ((current: StudioNode[]) => StudioNode[])) => void;
  setEdges: (edges: StudioEdge[] | ((current: StudioEdge[]) => StudioEdge[])) => void;
  setConsoleLines: (lines: string[]) => void;
  onCloseWorkspace?: () => void;
  setWorkflowMenuOpen: (open: boolean) => void;
  setRenameDialogOpen: (open: boolean) => void;
  appendConsole: (line: string) => void;
}) {
  const workflowBrowser = useGraphWorkflowBrowser(browserOpen);
  const refreshWorkflows = workflowBrowser.refresh;

  const saveWorkflow = useCallback(async (nextName = workflowName, nextWorkflowId = workflowId) => {
    const payload = workflowFromCanvas(nextWorkflowId, nextName, nodes, edges);
    const record = await jsonFetch<GraphWorkflowRecord>(
      nextWorkflowId ? `/api/control/media/graph/workflows/${nextWorkflowId}` : "/api/control/media/graph/workflows",
      {
        method: nextWorkflowId ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      },
    );
    refreshWorkflows().catch(() => undefined);
    return record;
  }, [edges, nodes, refreshWorkflows, workflowFromCanvas, workflowId, workflowName]);

  const saveWorkflowAs = useCallback(async () => {
    const nextName = `${workflowName || "Workflow"} Copy`;
    const payload = workflowFromCanvas(null, nextName, nodes, edges);
    const record = await jsonFetch<GraphWorkflowRecord>("/api/control/media/graph/workflows", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    refreshWorkflows().catch(() => undefined);
    return record;
  }, [edges, nodes, refreshWorkflows, workflowFromCanvas, workflowName]);

  const openRenameWorkflow = useCallback(
    (setRenameDraft: (value: string) => void) => {
      setRenameDraft(workflowName || "Untitled workflow");
      setWorkflowMenuOpen(false);
      setRenameDialogOpen(true);
    },
    [setRenameDialogOpen, setWorkflowMenuOpen, workflowName],
  );

  const commitRenameWorkflow = useCallback(async () => {
    const trimmedName = renameDraft.trim();
    if (!trimmedName) return null;
    if (workflowId) {
      return saveWorkflow(trimmedName, workflowId);
    } else {
      setWorkflowName(trimmedName);
      appendConsole(`Renamed workflow to ${trimmedName}.`);
    }
    setRenameDialogOpen(false);
    return null;
  }, [appendConsole, renameDraft, saveWorkflow, setRenameDialogOpen, setWorkflowName, workflowId]);

  const closeWorkflow = useCallback(() => {
    setWorkflowId(null);
    setWorkflowName("New workflow");
    setWorkflowUpdatedAt(null);
    setRun(null);
    setNodes([]);
    setEdges([]);
    onCloseWorkspace?.();
    setConsoleLines(["Graph Studio ready."]);
    setWorkflowMenuOpen(false);
    setRenameDialogOpen(false);
  }, [onCloseWorkspace, setConsoleLines, setEdges, setNodes, setRenameDialogOpen, setRun, setWorkflowId, setWorkflowMenuOpen, setWorkflowName, setWorkflowUpdatedAt]);

  const deleteWorkflowRecord = useCallback(
    async (record: GraphWorkflowSummary) => {
      await jsonFetch(`/api/control/media/graph/workflows/${record.workflow_id}`, { method: "DELETE" });
      appendConsole(`Deleted workflow ${record.name || record.workflow_id}.`);
      if (record.workflow_id === workflowId) {
        closeWorkflow();
      }
      await refreshWorkflows();
    },
    [appendConsole, closeWorkflow, refreshWorkflows, workflowId],
  );

  return {
    workflowBrowser,
    saveWorkflow,
    saveWorkflowAs,
    openRenameWorkflow,
    commitRenameWorkflow,
    closeWorkflow,
    deleteWorkflowRecord,
  };
}
