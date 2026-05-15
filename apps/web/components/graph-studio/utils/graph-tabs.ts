import type { GraphWorkspaceTab, GraphWorkflowPayload } from "../types";

export type GraphTabSnapshot = {
  workflowId: string | null;
  workflowName: string;
  workflow: GraphWorkflowPayload;
  runId?: string | null;
  consoleLines?: string[];
  dirty?: boolean;
};

export function blankGraphWorkflowPayload(name = "New workflow"): GraphWorkflowPayload {
  return {
    schema_version: 1,
    workflow_id: null,
    name,
    nodes: [],
    edges: [],
    metadata: {},
  };
}

export function applyGraphTabSnapshot(tab: GraphWorkspaceTab, snapshot: GraphTabSnapshot): GraphWorkspaceTab {
  return {
    ...tab,
    workflow_id: snapshot.workflowId,
    workflow_name: snapshot.workflowName,
    workflow_json: snapshot.workflow,
    run_id: snapshot.runId ?? null,
    console_lines: snapshot.consoleLines ?? tab.console_lines ?? [],
    dirty: snapshot.dirty ?? tab.dirty ?? false,
    updated_at: new Date().toISOString(),
  };
}

export function graphTabCloseTarget(tabs: GraphWorkspaceTab[], activeTabId: string, tabId: string): GraphWorkspaceTab | null {
  const closingIndex = tabs.findIndex((tab) => tab.tab_id === tabId);
  if (closingIndex === -1 || tabId !== activeTabId) {
    return tabs.find((tab) => tab.tab_id === activeTabId) ?? tabs[0] ?? null;
  }
  return tabs[closingIndex - 1] ?? tabs[closingIndex + 1] ?? null;
}

export function graphTabOpenWorkflowTarget(
  tabs: GraphWorkspaceTab[],
  activeTabId: string,
  targetTab: GraphWorkspaceTab,
  activeSnapshot?: GraphTabSnapshot,
): { tabs: GraphWorkspaceTab[]; activeTabId: string } {
  const tabsWithActiveSnapshot = activeSnapshot
    ? tabs.map((tab) => (tab.tab_id === activeTabId ? applyGraphTabSnapshot(tab, activeSnapshot) : tab))
    : tabs;
  const existing = targetTab.workflow_id
    ? tabsWithActiveSnapshot.find((tab) => tab.workflow_id === targetTab.workflow_id)
    : null;
  if (existing) {
    return {
      tabs: tabsWithActiveSnapshot.map((tab) => (tab.tab_id === existing.tab_id ? targetTab : tab)),
      activeTabId: existing.tab_id,
    };
  }
  return { tabs: [...tabsWithActiveSnapshot, targetTab], activeTabId: targetTab.tab_id };
}
