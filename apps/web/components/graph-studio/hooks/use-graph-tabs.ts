import { useCallback, useEffect, useRef, useState } from "react";

import type { GraphWorkspaceTab } from "../types";
import {
  applyGraphTabSnapshot,
  blankGraphWorkflowPayload,
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
    workflow_json: blankGraphWorkflowPayload(name),
    saved_workflow_signature: null,
    run_id: null,
    run_status: null,
    assistant_session_id: null,
    dirty: false,
    updated_at: new Date().toISOString(),
  };
}

function newTabFromSnapshot(snapshot: GraphTabSnapshot): GraphWorkspaceTab {
  return applyGraphTabSnapshot(newTab(snapshot.workflowName), snapshot);
}

async function graphTabStorageScope(): Promise<string> {
  try {
    const response = await fetch("/api/control/health", { cache: "no-store" });
    if (!response.ok) return "default";
    const payload = (await response.json()) as { install_id?: unknown };
    const installId = typeof payload.install_id === "string" ? payload.install_id.trim() : "";
    return installId || "default";
  } catch {
    return "default";
  }
}

function requestedGraphRestoreParamsFromLocation(): { tabId: string | null; assistantSessionId: string | null } {
  if (typeof window === "undefined") return { tabId: null, assistantSessionId: null };
  try {
    const params = new URLSearchParams(window.location.search);
    return {
      tabId: params.get("tab"),
      assistantSessionId: params.get("assistantSession"),
    };
  } catch {
    return { tabId: null, assistantSessionId: null };
  }
}

function clearRequestedGraphRestoreParamsFromLocation() {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("tab") && !url.searchParams.has("assistantSession")) return;
    url.searchParams.delete("tab");
    url.searchParams.delete("assistantSession");
    const next = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState(window.history.state, "", next || "/graph-studio");
  } catch {
    // The return URL is only a restore hint; failing to clean it should not block restore.
  }
}

export function useGraphTabs() {
  const initial = (() => {
    const tab = newTab("Nano Image Pipeline");
    return { active_tab_id: tab.tab_id, tabs: [tab], restored: false };
  })();
  const tabMutationVersionRef = useRef(0);
  const [tabs, setTabs] = useState<GraphWorkspaceTab[]>(initial.tabs);
  const [activeTabId, setActiveTabId] = useState(initial.active_tab_id);
  const [sessionRestored, setSessionRestored] = useState(Boolean(initial.restored));
  const [storageScope, setStorageScope] = useState<string | null>(null);
  const markTabsMutated = useCallback(() => {
    tabMutationVersionRef.current += 1;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const restoreVersion = tabMutationVersionRef.current;
    void graphTabStorageScope().then((scope) => {
      if (cancelled) return;
      const restored = readGraphTabSession(scope);
      setStorageScope(scope);
      if (tabMutationVersionRef.current !== restoreVersion) {
        setSessionRestored(false);
        return;
      }
      if (restored) {
        const requested = requestedGraphRestoreParamsFromLocation();
        const requestedTab = requested.tabId ? restored.tabs.find((tab) => tab.tab_id === requested.tabId) : null;
        const nextActiveTabId = requestedTab?.tab_id ?? restored.active_tab_id;
        const tabsWithAssistantSession = requested.assistantSessionId
          ? restored.tabs.map((tab) =>
              tab.tab_id === nextActiveTabId
                ? { ...tab, assistant_session_id: requested.assistantSessionId }
                : tab,
            )
          : restored.tabs;
        setTabs(tabsWithAssistantSession);
        setActiveTabId(nextActiveTabId);
        if (requested.tabId || requested.assistantSessionId) clearRequestedGraphRestoreParamsFromLocation();
        setSessionRestored(Boolean(restored.restored));
      } else {
        const requested = requestedGraphRestoreParamsFromLocation();
        if (requested.assistantSessionId) {
          setTabs((current) =>
            current.map((tab) =>
              tab.tab_id === activeTabId ? { ...tab, assistant_session_id: requested.assistantSessionId } : tab,
            ),
          );
          clearRequestedGraphRestoreParamsFromLocation();
        }
        setSessionRestored(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!storageScope) return;
    writeGraphTabSession(storageScope, activeTabId, tabs);
  }, [activeTabId, storageScope, tabs]);

  useEffect(() => {
    const requested = requestedGraphRestoreParamsFromLocation();
    if (!requested.tabId && !requested.assistantSessionId) return;
    const requestedTab = requested.tabId ? tabs.find((tab) => tab.tab_id === requested.tabId) : null;
    if (!requested.tabId && requested.assistantSessionId) {
      setTabs((current) =>
        current.map((tab) =>
          tab.tab_id === activeTabId ? { ...tab, assistant_session_id: requested.assistantSessionId } : tab,
        ),
      );
      clearRequestedGraphRestoreParamsFromLocation();
      return;
    }
    if (!requestedTab) return;
    if (activeTabId !== requestedTab.tab_id) {
      setActiveTabId(requestedTab.tab_id);
      return;
    }
    if (requested.assistantSessionId) {
      setTabs((current) =>
        current.map((tab) =>
          tab.tab_id === requestedTab.tab_id
            ? { ...tab, assistant_session_id: requested.assistantSessionId }
            : tab,
        ),
      );
    }
    clearRequestedGraphRestoreParamsFromLocation();
  }, [activeTabId, tabs]);

  const updateTab = useCallback((tabId: string | null, snapshot: GraphTabSnapshot) => {
    if (!tabId) return;
    markTabsMutated();
    setTabs((current) =>
      current.map((tab) =>
        tab.tab_id === tabId
          ? applyGraphTabSnapshot(tab, snapshot)
          : tab,
      ),
    );
  }, [markTabsMutated]);

  const updateActiveTab = useCallback((snapshot: GraphTabSnapshot) => {
    updateTab(activeTabId, snapshot);
  }, [activeTabId, updateTab]);

  const updateTabAssistantSession = useCallback((tabId: string | null, assistantSessionId: string | null) => {
    if (!tabId) return;
    markTabsMutated();
    setTabs((current) =>
      current.map((tab) =>
        tab.tab_id === tabId
          ? tab.assistant_session_id === assistantSessionId
            ? tab
            : { ...tab, assistant_session_id: assistantSessionId, updated_at: new Date().toISOString() }
          : tab,
      ),
    );
  }, [markTabsMutated]);

  const openBlankTab = useCallback(() => {
    markTabsMutated();
    const tab = newTab();
    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.tab_id);
    return tab;
  }, [markTabsMutated]);

  const openWorkflowTab = useCallback((snapshot: GraphTabSnapshot, activeSnapshot?: GraphTabSnapshot) => {
    markTabsMutated();
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
  }, [activeTabId, markTabsMutated, tabs]);

  const closeTab = useCallback((tabId: string, activeSnapshot?: GraphTabSnapshot) => {
    markTabsMutated();
    const tabsWithSnapshot = activeSnapshot
      ? tabs.map((tab) => (tab.tab_id === activeTabId ? applyGraphTabSnapshot(tab, activeSnapshot) : tab))
      : tabs;
    const nextActiveTab = graphTabCloseTarget(tabsWithSnapshot, activeTabId, tabId) ?? newTab();
    const remaining = tabsWithSnapshot.filter((tab) => tab.tab_id !== tabId);
    const nextTabs = remaining.length ? remaining : [nextActiveTab];
    setTabs(nextTabs);
    if (tabId === activeTabId) setActiveTabId(nextActiveTab.tab_id);
    return { closedActive: tabId === activeTabId, nextActiveTab };
  }, [activeTabId, markTabsMutated, tabs]);

  const closeOtherTabs = useCallback((activeSnapshot?: GraphTabSnapshot) => {
    markTabsMutated();
    const currentActive = tabs.find((tab) => tab.tab_id === activeTabId) ?? tabs[0] ?? newTab();
    const nextActive = activeSnapshot ? applyGraphTabSnapshot(currentActive, activeSnapshot) : currentActive;
    setTabs([nextActive]);
    setActiveTabId(nextActive.tab_id);
    return nextActive;
  }, [activeTabId, markTabsMutated, tabs]);

  const switchTab = useCallback((tabId: string) => {
    markTabsMutated();
    setActiveTabId(tabId);
    return tabs.find((tab) => tab.tab_id === tabId) ?? null;
  }, [markTabsMutated, tabs]);

  return { tabs, activeTabId, sessionRestored, storageScope, updateTab, updateActiveTab, updateTabAssistantSession, openBlankTab, openWorkflowTab, closeTab, closeOtherTabs, switchTab };
}
