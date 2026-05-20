import { useCallback, useEffect, useRef, useState } from "react";

import {
  graphHistoryCanRedo,
  graphHistoryCanUndo,
  graphHistoryCommitPending,
  graphHistoryEntryForSnapshot,
  graphHistoryRedo,
  type GraphHistoryEntry,
  graphHistorySnapshotSignature,
  graphHistoryStageSnapshot,
  type GraphHistorySnapshot,
  graphHistoryUndo,
} from "../utils/graph-history";

const GRAPH_HISTORY_COMMIT_DEBOUNCE_MS = 260;

export function useGraphUndoHistory({
  enabled = true,
  activeTabId,
  snapshot,
  applySnapshot,
}: {
  enabled?: boolean;
  activeTabId: string | null;
  snapshot: GraphHistorySnapshot | null;
  applySnapshot: (snapshot: GraphHistorySnapshot) => void;
}) {
  const historyByTabRef = useRef(new Map<string, GraphHistoryEntry>());
  const activeTabRef = useRef<string | null>(activeTabId);
  const commitTimerRef = useRef<number | null>(null);
  const [availability, setAvailability] = useState({ canUndo: false, canRedo: false });

  const updateAvailability = useCallback((tabId: string | null) => {
    const entry = tabId ? historyByTabRef.current.get(tabId) ?? null : null;
    setAvailability({
      canUndo: graphHistoryCanUndo(entry),
      canRedo: graphHistoryCanRedo(entry),
    });
  }, []);

  const flushPendingForTab = useCallback(
    (tabId: string | null) => {
      if (!tabId) return;
      const entry = historyByTabRef.current.get(tabId);
      if (!entry?.pending) return;
      historyByTabRef.current.set(tabId, graphHistoryCommitPending(entry));
      updateAvailability(tabId);
    },
    [updateAvailability],
  );

  useEffect(() => {
    if (!enabled) {
      setAvailability({ canUndo: false, canRedo: false });
      return;
    }
    const previousActiveTabId = activeTabRef.current;
    if (previousActiveTabId !== activeTabId) {
      if (commitTimerRef.current) {
        window.clearTimeout(commitTimerRef.current);
        commitTimerRef.current = null;
      }
      flushPendingForTab(previousActiveTabId);
      activeTabRef.current = activeTabId;
    }
  }, [activeTabId, enabled, flushPendingForTab]);

  useEffect(() => {
    if (!enabled) return;
    if (!activeTabId || !snapshot) {
      updateAvailability(activeTabId);
      return;
    }
    const currentEntry = historyByTabRef.current.get(activeTabId);
    if (!currentEntry?.present) {
      historyByTabRef.current.set(activeTabId, graphHistoryEntryForSnapshot(snapshot));
      updateAvailability(activeTabId);
      return;
    }
    const nextEntry = graphHistoryStageSnapshot(currentEntry, snapshot);
    historyByTabRef.current.set(activeTabId, nextEntry);
    if (commitTimerRef.current) {
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    if (graphHistorySnapshotSignature(nextEntry.pending) !== null) {
      commitTimerRef.current = window.setTimeout(() => {
        flushPendingForTab(activeTabRef.current);
        commitTimerRef.current = null;
      }, GRAPH_HISTORY_COMMIT_DEBOUNCE_MS);
    }
    updateAvailability(activeTabId);
  }, [activeTabId, enabled, flushPendingForTab, snapshot, updateAvailability]);

  useEffect(
    () => () => {
      if (commitTimerRef.current) {
        window.clearTimeout(commitTimerRef.current);
      }
    },
    [],
  );

  const restoreFromHistory = useCallback(
    (nextEntry: GraphHistoryEntry, restoredSnapshot: GraphHistorySnapshot | null) => {
      if (!activeTabId || !restoredSnapshot) return false;
      historyByTabRef.current.set(activeTabId, nextEntry);
      updateAvailability(activeTabId);
      applySnapshot(restoredSnapshot);
      return true;
    },
    [activeTabId, applySnapshot, updateAvailability],
  );

  const undo = useCallback(() => {
    if (!activeTabId) return false;
    if (commitTimerRef.current) {
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    const result = graphHistoryUndo(historyByTabRef.current.get(activeTabId));
    return restoreFromHistory(result.entry, result.snapshot);
  }, [activeTabId, restoreFromHistory]);

  const redo = useCallback(() => {
    if (!activeTabId) return false;
    if (commitTimerRef.current) {
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    const result = graphHistoryRedo(historyByTabRef.current.get(activeTabId));
    return restoreFromHistory(result.entry, result.snapshot);
  }, [activeTabId, restoreFromHistory]);

  const replaceActiveHistory = useCallback(
    (nextSnapshot: GraphHistorySnapshot | null) => {
      if (!activeTabId || !nextSnapshot) return;
      if (commitTimerRef.current) {
        window.clearTimeout(commitTimerRef.current);
        commitTimerRef.current = null;
      }
      historyByTabRef.current.set(activeTabId, graphHistoryEntryForSnapshot(nextSnapshot));
      updateAvailability(activeTabId);
    },
    [activeTabId, updateAvailability],
  );

  return {
    canUndo: availability.canUndo,
    canRedo: availability.canRedo,
    undo,
    redo,
    flushPendingForTab,
    replaceActiveHistory,
  };
}
