import { useCallback, useEffect } from "react";

import type { GraphRun, GraphWorkflowPayload, GraphWorkspaceTab, StudioEdge, StudioNode } from "../types";
import {
  blankGraphWorkflowPayload,
  graphWorkflowDirtyState,
  graphWorkflowSnapshotSignature,
  writeGraphTabSession,
  type GraphTabSnapshot,
} from "../utils/graph-tabs";

type UseGraphTabWorkspaceParams = {
  activeTab: GraphWorkspaceTab | null;
  activeTabId: string;
  tabs: GraphWorkspaceTab[];
  storageScope: string | null;
  workflowId: string | null;
  workflowName: string;
  workflowUpdatedAt: string | null;
  nodes: StudioNode[];
  edges: StudioEdge[];
  run: GraphRun | null;
  consoleLines: string[];
  canvasHydrated: boolean;
  workflowFromCanvas: (workflowId: string | null, workflowName: string, nodes: StudioNode[], edges: StudioEdge[]) => GraphWorkflowPayload;
  updateActiveTab: (snapshot: GraphTabSnapshot) => void;
  switchTab: (tabId: string) => GraphWorkspaceTab | null;
  closeTab: (tabId: string, activeSnapshot?: GraphTabSnapshot) => { closedActive: boolean; nextActiveTab: GraphWorkspaceTab };
  openBlankTab: () => GraphWorkspaceTab;
  hydrateWorkflowPayload: (
    workflow: GraphWorkflowPayload,
    options?: { workflowId?: string | null; workflowName?: string; workflowUpdatedAt?: string | null; run?: GraphRun | null },
  ) => void;
  hydrateLastRun: (runId: string) => Promise<void>;
  closeWorkflow: () => void;
  setConsoleLines: (lines: string[]) => void;
};

function buildActiveGraphTabSnapshot({
  activeTab,
  workflowId,
  workflowName,
  workflowUpdatedAt,
  workflow,
  run,
  consoleLines,
}: {
  activeTab: GraphWorkspaceTab | null;
  workflowId: string | null;
  workflowName: string;
  workflowUpdatedAt: string | null;
  workflow: GraphWorkflowPayload;
  run: GraphRun | null;
  consoleLines: string[];
}): GraphTabSnapshot {
  const dirty = graphWorkflowDirtyState({
    workflowId,
    workflowName,
    workflow,
    savedWorkflowSignature: activeTab?.saved_workflow_signature ?? null,
    dirtyFallback:
      Boolean(activeTab?.dirty) ||
      activeTab?.workflow_id !== workflowId ||
      activeTab?.workflow_name !== workflowName,
  });
  return {
    workflowId,
    workflowName,
    workflow,
    savedWorkflowSignature:
      workflowId && !dirty
        ? graphWorkflowSnapshotSignature(workflow)
        : workflowId
          ? activeTab?.saved_workflow_signature ?? null
          : null,
    workflowUpdatedAt,
    runId: run?.run_id ?? null,
    runStatus: run?.status ?? null,
    consoleLines,
    dirty,
  };
}

export function useGraphTabWorkspace({
  activeTab,
  activeTabId,
  tabs,
  storageScope,
  workflowId,
  workflowName,
  workflowUpdatedAt,
  nodes,
  edges,
  run,
  consoleLines,
  canvasHydrated,
  workflowFromCanvas,
  updateActiveTab,
  switchTab,
  closeTab,
  openBlankTab,
  hydrateWorkflowPayload,
  hydrateLastRun,
  closeWorkflow,
  setConsoleLines,
}: UseGraphTabWorkspaceParams) {
  const snapshotActiveTab = useCallback(() => {
    const workflow = workflowFromCanvas(workflowId, workflowName, nodes, edges);
    const snapshot = buildActiveGraphTabSnapshot({
      activeTab,
      workflowId,
      workflowName,
      workflowUpdatedAt,
      workflow,
      run,
      consoleLines,
    });
    updateActiveTab(snapshot);
    return snapshot;
  }, [activeTab, consoleLines, edges, nodes, run, updateActiveTab, workflowFromCanvas, workflowId, workflowName, workflowUpdatedAt]);

  useEffect(() => {
    if (!canvasHydrated || !activeTab) return;
    const currentWorkflow = workflowFromCanvas(workflowId, workflowName, nodes, edges);
    const activeSnapshot = buildActiveGraphTabSnapshot({
      activeTab,
      workflowId,
      workflowName,
      workflowUpdatedAt,
      workflow: currentWorkflow,
      run,
      consoleLines,
    });
    const nextTabs = tabs.map((tab) =>
      tab.tab_id === activeTabId
        ? {
            ...tab,
            workflow_id: activeSnapshot.workflowId,
            workflow_name: activeSnapshot.workflowName,
            workflow_json: activeSnapshot.workflow,
            saved_workflow_signature: activeSnapshot.savedWorkflowSignature ?? null,
            workflow_updated_at: activeSnapshot.workflowUpdatedAt ?? null,
            run_id: activeSnapshot.runId ?? null,
            run_status: activeSnapshot.runStatus ?? null,
            console_lines: activeSnapshot.consoleLines,
            dirty: activeSnapshot.dirty,
            updated_at: new Date().toISOString(),
          }
        : tab,
    );
    if (!storageScope) return;
    writeGraphTabSession(storageScope, activeTabId, nextTabs);
  }, [activeTab, activeTabId, canvasHydrated, consoleLines, edges, nodes, run, storageScope, tabs, workflowFromCanvas, workflowId, workflowName, workflowUpdatedAt]);

  const switchWorkflowTab = useCallback(
    (tabId: string) => {
      snapshotActiveTab();
      const tab = switchTab(tabId);
      if (tab?.workflow_json) {
        hydrateWorkflowPayload(tab.workflow_json, {
          workflowId: tab.workflow_id ?? null,
          workflowName: tab.workflow_name,
          workflowUpdatedAt: tab.workflow_updated_at ?? null,
        });
        setConsoleLines(tab.console_lines?.length ? tab.console_lines : ["Graph Studio ready."]);
        if (tab.run_id) void hydrateLastRun(tab.run_id);
      } else {
        closeWorkflow();
      }
    },
    [closeWorkflow, hydrateLastRun, hydrateWorkflowPayload, setConsoleLines, snapshotActiveTab, switchTab],
  );

  const closeWorkflowTab = useCallback(
    (tabId: string) => {
      const snapshot = snapshotActiveTab();
      const result = closeTab(tabId, snapshot);
      if (result.closedActive && result.nextActiveTab.workflow_json) {
        hydrateWorkflowPayload(result.nextActiveTab.workflow_json, {
          workflowId: result.nextActiveTab.workflow_id ?? null,
          workflowName: result.nextActiveTab.workflow_name,
          workflowUpdatedAt: result.nextActiveTab.workflow_updated_at ?? null,
        });
        setConsoleLines(result.nextActiveTab.console_lines?.length ? result.nextActiveTab.console_lines : ["Graph Studio ready."]);
      } else if (result.closedActive) {
        closeWorkflow();
      }
    },
    [closeTab, closeWorkflow, hydrateWorkflowPayload, setConsoleLines, snapshotActiveTab],
  );

  const openNewWorkflowTab = useCallback(() => {
    snapshotActiveTab();
    openBlankTab();
    closeWorkflow();
  }, [closeWorkflow, openBlankTab, snapshotActiveTab]);

  const closeActiveWorkflow = useCallback(() => {
    const workflow = blankGraphWorkflowPayload();
    updateActiveTab({
      workflowId: null,
      workflowName: workflow.name,
      workflow,
      savedWorkflowSignature: null,
      workflowUpdatedAt: null,
      runId: null,
      runStatus: null,
      consoleLines: ["Graph Studio ready."],
      dirty: false,
    });
    closeWorkflow();
  }, [closeWorkflow, updateActiveTab]);

  return {
    snapshotActiveTab,
    switchWorkflowTab,
    closeWorkflowTab,
    openNewWorkflowTab,
    closeActiveWorkflow,
  };
}
