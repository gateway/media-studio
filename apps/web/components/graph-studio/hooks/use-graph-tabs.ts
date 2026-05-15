import { useCallback, useEffect, useState } from "react";

import type { GraphWorkspaceTab } from "../types";
import { applyGraphTabSnapshot, graphTabCloseTarget, graphTabOpenWorkflowTarget, type GraphTabSnapshot } from "../utils/graph-tabs";

const GRAPH_TABS_STORAGE_KEY = "media-studio:graph-studio:tabs";

function newTab(name = "New workflow"): GraphWorkspaceTab {
  return {
    tab_id: `tab-${crypto.randomUUID().slice(0, 8)}`,
    workflow_id: null,
    workflow_name: name,
    workflow_json: null,
    run_id: null,
    dirty: false,
    updated_at: new Date().toISOString(),
  };
}

function newTabFromSnapshot(snapshot: GraphTabSnapshot): GraphWorkspaceTab {
  return applyGraphTabSnapshot(newTab(snapshot.workflowName), snapshot);
}

function readTabs(): { active_tab_id: string; tabs: GraphWorkspaceTab[] } | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(GRAPH_TABS_STORAGE_KEY) || "null") as { active_tab_id?: string; tabs?: GraphWorkspaceTab[] } | null;
    if (!parsed?.active_tab_id || !Array.isArray(parsed.tabs) || !parsed.tabs.length) return null;
    return { active_tab_id: parsed.active_tab_id, tabs: parsed.tabs };
  } catch {
    return null;
  }
}

export function useGraphTabs() {
  const restored = typeof window !== "undefined" ? readTabs() : null;
  const initial = restored ?? (() => {
    const tab = newTab("Nano Image Pipeline");
    return { active_tab_id: tab.tab_id, tabs: [tab] };
  })();
  const [tabs, setTabs] = useState<GraphWorkspaceTab[]>(initial.tabs);
  const [activeTabId, setActiveTabId] = useState(initial.active_tab_id);

  useEffect(() => {
    window.localStorage.setItem(GRAPH_TABS_STORAGE_KEY, JSON.stringify({ schema_version: 1, active_tab_id: activeTabId, tabs }));
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

  return { tabs, activeTabId, updateActiveTab, openBlankTab, openWorkflowTab, closeTab, switchTab };
}
