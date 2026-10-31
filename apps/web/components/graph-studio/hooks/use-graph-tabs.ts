import { useCallback, useEffect, useRef, useState } from "react";

import type { GraphWorkspaceTab } from "../types";
import { rememberGraphStorageBinding, resolveGraphStorageIdentity, type GraphStorageBinding, type GraphStorageChoice } from "../utils/graph-storage-identity";
import {
  applyGraphTabSnapshot,
  blankGraphWorkflowPayload,
  graphTabCloseTarget,
  graphTabOpenWorkflowTarget,
  graphTabsStorageKey,
  readGraphTabSession,
  type GraphTabSnapshot,
  type GraphTabSessionState,
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

function restoreTabSelection(restored: GraphTabSessionState) {
  const requested = requestedGraphRestoreParamsFromLocation();
  const requestedTab = restored.tabs.find((tab) => tab.tab_id === requested.tabId);
  const activeTabId = requestedTab?.tab_id ?? restored.active_tab_id;
  const tabs = requested.assistantSessionId
    ? restored.tabs.map((tab) => tab.tab_id === activeTabId
      ? { ...tab, assistant_session_id: requested.assistantSessionId } : tab)
    : restored.tabs;
  clearRequestedGraphRestoreParamsFromLocation();
  return { tabs, activeTabId };
}

export function useGraphTabs() {
  const initial = (() => {
    const tab = newTab("New workflow");
    return { active_tab_id: tab.tab_id, tabs: [tab], restored: false };
  })();
  const tabMutationVersionRef = useRef(0);
  const [tabs, setTabs] = useState<GraphWorkspaceTab[]>(initial.tabs);
  const [activeTabId, setActiveTabId] = useState(initial.active_tab_id);
  const initialActiveTabId = useRef(activeTabId);
  const [sessionRestored, setSessionRestored] = useState(Boolean(initial.restored));
  const [storageScope, setStorageScope] = useState<string | null>(null);
  const storedSessionRef = useRef<{ scope: string; value: string | null } | null>(null);
  const [storageWriteError, setStorageWriteError] = useState<string | null>(null);
  const [storageRestoreError, setStorageRestoreError] = useState<string | null>(null);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [storageChoices, setStorageChoices] = useState<GraphStorageChoice[]>([]);
  const [selectedBinding, setSelectedBinding] = useState<GraphStorageBinding | null>(null);
  const chooseStorageScope = useCallback((scope: string) => {
    const choice = storageChoices.find((item) => item.scope === scope);
    if (choice && tabMutationVersionRef.current === 0) setSelectedBinding({ installId: choice.installId, scope: choice.scope });
  }, [storageChoices]);
  const retryStorageRestore = useCallback(() => {
    if (tabMutationVersionRef.current !== 0) return;
    setStorageRestoreError(null);
    setRestoreAttempt((attempt) => attempt + 1);
  }, []);
  const markTabsMutated = useCallback(() => {
    tabMutationVersionRef.current += 1;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const restoreVersion = tabMutationVersionRef.current;
    const resolution = selectedBinding
      ? Promise.resolve({ binding: selectedBinding, choices: [] })
      : resolveGraphStorageIdentity(restoreAttempt > 0);
    void resolution.then(({ binding, choices }) => {
      if (cancelled) return;
      setStorageChoices(choices);
      if (choices.length) return;
      if (!binding) {
        setStorageRestoreError("Connect to Media Studio to restore your workflows. Existing drafts have not been changed.");
        return;
      }
      const scope = binding.scope;
      const storedValue = window.localStorage.getItem(graphTabsStorageKey(scope));
      const restored = readGraphTabSession(scope);
      if (tabMutationVersionRef.current !== restoreVersion) {
        setSessionRestored(false);
        setStorageRestoreError("The workspace changed before restoration completed. Stored drafts have not been overwritten.");
        return;
      }
      // Persist the binding before allowing any draft writes.
      if (!rememberGraphStorageBinding(binding)) {
        setStorageRestoreError("Browser storage is unavailable. Enable storage and retry to restore your workflows.");
        return;
      }
      setStorageScope(scope);
      storedSessionRef.current = { scope, value: storedValue };
      setStorageRestoreError(null);
      if (restored) {
        const selection = restoreTabSelection(restored);
        setTabs(selection.tabs);
        setActiveTabId(selection.activeTabId);
        setSessionRestored(Boolean(restored.restored));
      } else {
        const requested = requestedGraphRestoreParamsFromLocation();
        if (requested.assistantSessionId) {
          setTabs((current) =>
            current.map((tab) =>
              tab.tab_id === initialActiveTabId.current ? { ...tab, assistant_session_id: requested.assistantSessionId } : tab,
            ),
          );
          clearRequestedGraphRestoreParamsFromLocation();
        }
        setSessionRestored(false);
      }
    }).catch(() => {
      if (!cancelled) setStorageRestoreError("Workflows could not be restored. Existing drafts have not been changed. Please retry.");
    });
    return () => {
      cancelled = true;
    };
  }, [restoreAttempt, selectedBinding]);

  const persistTabs = useCallback((tabId: string, nextTabs: GraphWorkspaceTab[]) => {
    const expected = storedSessionRef.current;
    if (!expected || expected.scope !== storageScope) return;
    try {
      const key = graphTabsStorageKey(expected.scope);
      if (window.localStorage.getItem(key) !== expected.value) {
        setStorageWriteError("Workflows changed in another browser tab. Saving is paused here; keep this page open to preserve its unsaved work.");
        return;
      }
      writeGraphTabSession(expected.scope, tabId, nextTabs);
      expected.value = window.localStorage.getItem(key);
    } catch {
      setStorageWriteError("Browser storage is unavailable. Keep this page open to preserve its unsaved work.");
    }
  }, [storageScope]);

  useEffect(() => {
    persistTabs(activeTabId, tabs);
  }, [activeTabId, persistTabs, tabs]);

  useEffect(() => {
    if (!storageScope) return;
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
  }, [activeTabId, storageScope, tabs]);

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
      ? tabsWithActiveSnapshot.find((tab) => tab.workflow_id === snapshot.workflowId && !tab.dirty)
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

  return { tabs, activeTabId, sessionRestored, storageScope, storageChoices, chooseStorageScope, storageRestoreError, storageWriteError, persistTabs, retryStorageRestore, canRetryStorageRestore: tabMutationVersionRef.current === 0, updateTab, updateActiveTab, updateTabAssistantSession, openBlankTab, openWorkflowTab, closeTab, closeOtherTabs, switchTab };
}
