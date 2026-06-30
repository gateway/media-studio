import { useCallback, useEffect, useRef } from "react";

import type { GraphRun, GraphWorkflowPayload, GraphWorkspaceTab, StudioEdge, StudioNode } from "../types";
import {
  applyGraphTabSnapshot,
  blankGraphWorkflowPayload,
  graphWorkflowDirtyState,
  graphWorkflowSnapshotSignature,
  writeGraphTabSession,
  type GraphTabSnapshot,
} from "../utils/graph-tabs";
import type { GraphHistorySnapshot } from "../utils/graph-history";

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
  closeOtherTabs: (activeSnapshot?: GraphTabSnapshot) => GraphWorkspaceTab;
  openBlankTab: () => GraphWorkspaceTab;
  hydrateWorkflowPayload: (
    workflow: GraphWorkflowPayload,
    options?: { workflowId?: string | null; workflowName?: string; workflowUpdatedAt?: string | null; run?: GraphRun | null },
  ) => void;
  hydrateLastRun: (runId: string) => Promise<void>;
  closeWorkflow: () => void;
  replaceHistoryForTab: (tabId: string | null, snapshot: GraphHistorySnapshot | null) => void;
  setConsoleLines: (lines: string[]) => void;
};

export function buildActiveGraphTabSnapshot({
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
  const restoredSavedSignature =
    activeTab?.saved_workflow_signature ??
    (!activeTab?.dirty && activeTab?.workflow_id === workflowId
      ? graphWorkflowSnapshotSignature(activeTab.workflow_json ?? null)
      : null);
  const dirty = graphWorkflowDirtyState({
    workflowId,
    workflowName,
    workflow,
    savedWorkflowSignature: restoredSavedSignature,
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
          ? restoredSavedSignature
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
  closeOtherTabs,
  openBlankTab,
  hydrateWorkflowPayload,
  hydrateLastRun,
  closeWorkflow,
  replaceHistoryForTab,
  setConsoleLines,
}: UseGraphTabWorkspaceParams) {
  const blankTabHydrationRef = useRef<string | null>(null);
  const snapshotActiveTabRef = useRef<() => GraphTabSnapshot | null>(() => null);
  const canvasHydratedRef = useRef(canvasHydrated);
  const storageScopeRef = useRef(storageScope);
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
    if (storageScope) {
      const nextTabs = tabs.map((tab) => (tab.tab_id === activeTabId ? applyGraphTabSnapshot(tab, snapshot) : tab));
      writeGraphTabSession(storageScope, activeTabId, nextTabs);
    }
    return snapshot;
  }, [activeTab, activeTabId, consoleLines, edges, nodes, run, storageScope, tabs, updateActiveTab, workflowFromCanvas, workflowId, workflowName, workflowUpdatedAt]);
  snapshotActiveTabRef.current = snapshotActiveTab;
  canvasHydratedRef.current = canvasHydrated;
  storageScopeRef.current = storageScope;

  useEffect(() => {
    const flushActiveTabSnapshot = () => {
      if (!canvasHydratedRef.current || !storageScopeRef.current) return;
      snapshotActiveTabRef.current();
    };
    const handleVisibilityChange = () => {
      if (document.hidden) flushActiveTabSnapshot();
    };
    window.addEventListener("pagehide", flushActiveTabSnapshot);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      flushActiveTabSnapshot();
      window.removeEventListener("pagehide", flushActiveTabSnapshot);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (!canvasHydrated || !activeTab) return;
    const currentWorkflow = workflowFromCanvas(workflowId, workflowName, nodes, edges);
    if (blankTabHydrationRef.current === activeTabId) {
      if (currentWorkflow.nodes.length > 0) return;
      blankTabHydrationRef.current = null;
    }
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
        replaceHistoryForTab(tab.tab_id, {
          workflowId: tab.workflow_id ?? null,
          workflowName: tab.workflow_name,
          workflowUpdatedAt: tab.workflow_updated_at ?? null,
          workflow: tab.workflow_json,
        });
        setConsoleLines(tab.console_lines?.length ? tab.console_lines : ["Graph Studio ready."]);
        if (tab.run_id) void hydrateLastRun(tab.run_id);
      } else {
        closeWorkflow();
        const workflow = blankGraphWorkflowPayload();
        replaceHistoryForTab(tabId, {
          workflowId: null,
          workflowName: workflow.name,
          workflowUpdatedAt: null,
          workflow,
        });
      }
    },
    [closeWorkflow, hydrateLastRun, hydrateWorkflowPayload, replaceHistoryForTab, setConsoleLines, snapshotActiveTab, switchTab],
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
        replaceHistoryForTab(result.nextActiveTab.tab_id, {
          workflowId: result.nextActiveTab.workflow_id ?? null,
          workflowName: result.nextActiveTab.workflow_name,
          workflowUpdatedAt: result.nextActiveTab.workflow_updated_at ?? null,
          workflow: result.nextActiveTab.workflow_json,
        });
        setConsoleLines(result.nextActiveTab.console_lines?.length ? result.nextActiveTab.console_lines : ["Graph Studio ready."]);
      } else if (result.closedActive) {
        closeWorkflow();
        const workflow = blankGraphWorkflowPayload();
        replaceHistoryForTab(result.nextActiveTab.tab_id, {
          workflowId: null,
          workflowName: workflow.name,
          workflowUpdatedAt: null,
          workflow,
        });
      }
    },
    [closeTab, closeWorkflow, hydrateWorkflowPayload, replaceHistoryForTab, setConsoleLines, snapshotActiveTab],
  );

  const openNewWorkflowTab = useCallback(() => {
    snapshotActiveTab();
    const tab = openBlankTab();
    blankTabHydrationRef.current = tab.tab_id;
    const workflow = tab.workflow_json ?? blankGraphWorkflowPayload();
    hydrateWorkflowPayload(workflow, {
      workflowId: null,
      workflowName: workflow.name || "New workflow",
      workflowUpdatedAt: null,
      run: null,
    });
    setConsoleLines(["Graph Studio ready."]);
    replaceHistoryForTab(tab.tab_id, {
      workflowId: null,
      workflowName: workflow.name,
      workflowUpdatedAt: null,
      workflow,
    });
  }, [hydrateWorkflowPayload, openBlankTab, replaceHistoryForTab, setConsoleLines, snapshotActiveTab]);

  const closeOtherWorkflowTabs = useCallback(() => {
    const snapshot = snapshotActiveTab();
    const active = closeOtherTabs(snapshot);
    replaceHistoryForTab(active.tab_id, {
      workflowId: snapshot.workflowId,
      workflowName: snapshot.workflowName,
      workflowUpdatedAt: snapshot.workflowUpdatedAt ?? null,
      workflow: snapshot.workflow,
    });
  }, [closeOtherTabs, replaceHistoryForTab, snapshotActiveTab]);

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
      assistantSessionId: null,
      consoleLines: ["Graph Studio ready."],
      dirty: false,
    });
    closeWorkflow();
    replaceHistoryForTab(activeTabId, {
      workflowId: null,
      workflowName: workflow.name,
      workflowUpdatedAt: null,
      workflow,
    });
  }, [activeTabId, closeWorkflow, replaceHistoryForTab, updateActiveTab]);

  return {
    snapshotActiveTab,
    switchWorkflowTab,
    closeWorkflowTab,
    closeOtherWorkflowTabs,
    openNewWorkflowTab,
    closeActiveWorkflow,
  };
}
