import { useCallback, useEffect, useState } from "react";

import type { GraphWorkspaceTab } from "../types";
import {
  applyGraphTabSnapshot,
  clearLegacyWorkspaceSnapshot,
  graphTabCloseTarget,
  graphTabOpenWorkflowTarget,
  readGraphTabSession,
  type GraphTabSnapshot,
  writeGraphTabSession,
} from "../utils/graph-tabs";

function newTab(name = "New workflow"): GraphWorkspaceTab {
  return {
    tab_id: `tab-${crypto.randomUUID().slice(0, 8)}`,
    workflow_id: null,
    workflow_name: name,
    workflow_json: null,
    saved_workflow_signature: null,
    run_id: null,
    run_status: null,
    dirty: false,
    updated_at: new Date().toISOString(),
  };
}

function newTabFromSnapshot(snapshot: GraphTabSnapshot): GraphWorkspaceTab {
  return applyGraphTabSnapshot(newTab(snapshot.workflowName), snapshot);
}

export function useGraphTabs() {
  const restored = typeof window !== "undefined" ? readGraphTabSession() : null;
  const initial = restored ?? (() => {
    const tab = newTab("Nano Image Pipeline");
    return { active_tab_id: tab.tab_id, tabs: [tab], restored: false };
  })();
  const [tabs, setTabs] = useState<GraphWorkspaceTab[]>(initial.tabs);
  const [activeTabId, setActiveTabId] = useState(initial.active_tab_id);
  const [sessionRestored] = useState(Boolean(initial.restored));

  useEffect(() => {
    writeGraphTabSession(activeTabId, tabs);
    clearLegacyWorkspaceSnapshot();
  }, [activeTabId, tabs]);

  const updateActiveTab = useCallback((snapshot: GraphTabSnapshot) => {
    setTabs((current) =>
      current.map((tab) =>
        tab.tab_id === activeTabId
          ? applyGraphTabSnapshot(tab, snapshot)
          : tab,
      ),
    );
  }, [activeTabId]);

  const openBlankTab = useCallback(() => {
    const tab = newTab();
    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.tab_id);
    return tab;
  }, []);

  const openWorkflowTab = useCallback((snapshot: GraphTabSnapshot, activeSnapshot?: GraphTabSnapshot) => {
    const tabsWithActiveSnapshot = activeSnapshot
      ? tabs.map((tab) => (tab.tab_id === activeTabId ? applyGraphTabSnapshot(tab, activeSnapshot) : tab))
      : tabs;
    const existing = snapshot.workflowId
      ? tabsWithActiveSnapshot.find((tab) => tab.workflow_id === snapshot.workflowId)
      : null;
    const nextActiveTab = existing ? applyGraphTabSnapshot(existing, snapshot) : newTabFromSnapshot(snapshot);
    const result = graphTabOpenWorkflowTarget(tabs, activeTabId, nextActiveTab, activeSnapshot);
    setTabs(result.tabs);
    setActiveTabId(result.activeTabId);
    return nextActiveTab;
  }, [activeTabId, tabs]);

  const closeTab = useCallback((tabId: string, activeSnapshot?: GraphTabSnapshot) => {
    const tabsWithSnapshot = activeSnapshot
      ? tabs.map((tab) => (tab.tab_id === activeTabId ? applyGraphTabSnapshot(tab, activeSnapshot) : tab))
      : tabs;
    const nextActiveTab = graphTabCloseTarget(tabsWithSnapshot, activeTabId, tabId) ?? newTab();
    const remaining = tabsWithSnapshot.filter((tab) => tab.tab_id !== tabId);
    const nextTabs = remaining.length ? remaining : [nextActiveTab];
    setTabs(nextTabs);
    if (tabId === activeTabId) setActiveTabId(nextActiveTab.tab_id);
    return { closedActive: tabId === activeTabId, nextActiveTab };
  }, [activeTabId, tabs]);

  const switchTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
    return tabs.find((tab) => tab.tab_id === tabId) ?? null;
  }, [tabs]);

  return { tabs, activeTabId, sessionRestored, updateActiveTab, openBlankTab, openWorkflowTab, closeTab, switchTab };
}
