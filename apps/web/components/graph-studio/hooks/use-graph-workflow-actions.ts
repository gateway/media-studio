import { useCallback, useState } from "react";

import { WORKSPACE_STORAGE_KEY } from "../graph-studio-constants";
import type { GraphRun, GraphWorkflowPayload, GraphWorkflowRecord, StudioEdge, StudioNode } from "../types";
import { jsonFetch } from "../utils/graph-api";

export function useGraphWorkflowActions({
  workflowId,
  workflowName,
  renameDraft,
  nodes,
  edges,
  workflowFromCanvas,
  setWorkflowId,
  setWorkflowName,
  setRun,
  setNodes,
  setEdges,
  setConsoleLines,
  onCloseWorkspace,
  setWorkflowMenuOpen,
  setRenameDialogOpen,
  appendConsole,
}: {
  workflowId: string | null;
  workflowName: string;
  renameDraft: string;
  nodes: StudioNode[];
  edges: StudioEdge[];
  workflowFromCanvas: (workflowId: string | null, workflowName: string, nodes: StudioNode[], edges: StudioEdge[]) => GraphWorkflowPayload;
  setWorkflowId: (workflowId: string | null) => void;
  setWorkflowName: (name: string) => void;
  setRun: (run: GraphRun | null) => void;
  setNodes: (nodes: StudioNode[] | ((current: StudioNode[]) => StudioNode[])) => void;
  setEdges: (edges: StudioEdge[] | ((current: StudioEdge[]) => StudioEdge[])) => void;
  setConsoleLines: (lines: string[]) => void;
  onCloseWorkspace?: () => void;
  setWorkflowMenuOpen: (open: boolean) => void;
  setRenameDialogOpen: (open: boolean) => void;
  appendConsole: (line: string) => void;
}) {
  const [workflows, setWorkflows] = useState<GraphWorkflowRecord[]>([]);

  const refreshWorkflows = useCallback(async () => {
    const payload = await jsonFetch<{ items?: GraphWorkflowRecord[] }>("/api/control/media/graph/workflows");
    setWorkflows(payload.items ?? []);
  }, []);

  const saveWorkflow = useCallback(async (nextName = workflowName, nextWorkflowId = workflowId) => {
    const payload = workflowFromCanvas(nextWorkflowId, nextName, nodes, edges);
    const record = await jsonFetch<{ workflow_id: string }>(
      nextWorkflowId ? `/api/control/media/graph/workflows/${nextWorkflowId}` : "/api/control/media/graph/workflows",
      {
        method: nextWorkflowId ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      },
    );
    setWorkflowId(record.workflow_id);
    setWorkflowName(nextName);
    refreshWorkflows().catch(() => undefined);
    appendConsole(`Saved workflow ${record.workflow_id}.`);
    return record.workflow_id;
  }, [appendConsole, edges, nodes, refreshWorkflows, setWorkflowId, setWorkflowName, workflowFromCanvas, workflowId, workflowName]);

  const saveWorkflowAs = useCallback(async () => {
    const nextName = `${workflowName || "Workflow"} Copy`;
    const payload = workflowFromCanvas(null, nextName, nodes, edges);
    const record = await jsonFetch<{ workflow_id: string }>("/api/control/media/graph/workflows", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    setWorkflowName(nextName);
    setWorkflowId(record.workflow_id);
    refreshWorkflows().catch(() => undefined);
    appendConsole(`Saved workflow ${record.workflow_id}.`);
    setWorkflowMenuOpen(false);
    return record.workflow_id;
  }, [appendConsole, edges, nodes, refreshWorkflows, setWorkflowId, setWorkflowMenuOpen, setWorkflowName, workflowFromCanvas, workflowName]);

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
      const savedWorkflowId = await saveWorkflow(trimmedName, workflowId);
      appendConsole(`Renamed workflow to ${trimmedName}.`);
      setRenameDialogOpen(false);
      return savedWorkflowId;
    } else {
      setWorkflowName(trimmedName);
      appendConsole(`Renamed workflow to ${trimmedName}.`);
    }
    setRenameDialogOpen(false);
    return workflowId;
  }, [appendConsole, renameDraft, saveWorkflow, setRenameDialogOpen, setWorkflowName, workflowId]);

  const closeWorkflow = useCallback(() => {
    window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
    setWorkflowId(null);
    setWorkflowName("New workflow");
    setRun(null);
    setNodes([]);
    setEdges([]);
    onCloseWorkspace?.();
    setConsoleLines(["Graph Studio ready."]);
    setWorkflowMenuOpen(false);
    setRenameDialogOpen(false);
  }, [onCloseWorkspace, setConsoleLines, setEdges, setNodes, setRenameDialogOpen, setRun, setWorkflowId, setWorkflowMenuOpen, setWorkflowName]);

  const deleteWorkflowRecord = useCallback(
    async (record: GraphWorkflowRecord) => {
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
    workflows,
    refreshWorkflows,
    saveWorkflow,
    saveWorkflowAs,
    openRenameWorkflow,
    commitRenameWorkflow,
    closeWorkflow,
    deleteWorkflowRecord,
  };
}
