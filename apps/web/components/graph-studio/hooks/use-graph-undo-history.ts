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
const GRAPH_HISTORY_RESTORE_SETTLE_MS = 1500;

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
  const restoringSignatureRef = useRef<string | null>(null);
  const restoringSkipCountRef = useRef(0);
  const restoreSettlingUntilRef = useRef(0);
  const latestSnapshotRef = useRef<GraphHistorySnapshot | null>(snapshot);
  const expectedSnapshotSignatureByTabRef = useRef(new Map<string, string>());
  const [availability, setAvailability] = useState({ canUndo: false, canRedo: false });
  latestSnapshotRef.current = snapshot;

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
      updateAvailability(activeTabId);
    }
  }, [activeTabId, enabled, flushPendingForTab, updateAvailability]);

  useEffect(() => {
    if (!enabled) return;
    latestSnapshotRef.current = snapshot;
    if (!activeTabId || !snapshot) {
      updateAvailability(activeTabId);
      return;
    }
    const nextSignature = graphHistorySnapshotSignature(snapshot);
    const expectedSignature = expectedSnapshotSignatureByTabRef.current.get(activeTabId) ?? null;
    if (expectedSignature && nextSignature !== expectedSignature) {
      updateAvailability(activeTabId);
      return;
    }
    if (expectedSignature && nextSignature === expectedSignature) {
      expectedSnapshotSignatureByTabRef.current.delete(activeTabId);
      updateAvailability(activeTabId);
      return;
    }
    if (restoreSettlingUntilRef.current > 0) {
      if (Date.now() <= restoreSettlingUntilRef.current) {
        const currentEntry = historyByTabRef.current.get(activeTabId);
        if (currentEntry?.future.length) {
          updateAvailability(activeTabId);
          return;
        }
      }
      restoreSettlingUntilRef.current = 0;
    }
    if (restoringSkipCountRef.current > 0 || restoringSignatureRef.current) {
      restoringSkipCountRef.current = Math.max(0, restoringSkipCountRef.current - 1);
      if (restoringSignatureRef.current === nextSignature) {
        restoringSignatureRef.current = null;
        restoreSettlingUntilRef.current = Date.now() + GRAPH_HISTORY_RESTORE_SETTLE_MS;
      }
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
      restoringSignatureRef.current = graphHistorySnapshotSignature(restoredSnapshot);
      restoringSkipCountRef.current = 3;
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

  const replaceHistoryForTab = useCallback(
    (tabId: string | null, nextSnapshot: GraphHistorySnapshot | null) => {
      if (!tabId || !nextSnapshot) return;
      if (commitTimerRef.current) {
        window.clearTimeout(commitTimerRef.current);
        commitTimerRef.current = null;
      }
      historyByTabRef.current.set(tabId, graphHistoryEntryForSnapshot(nextSnapshot));
      const expectedSignature = graphHistorySnapshotSignature(nextSnapshot);
      if (expectedSignature) {
        expectedSnapshotSignatureByTabRef.current.set(tabId, expectedSignature);
      } else {
        expectedSnapshotSignatureByTabRef.current.delete(tabId);
      }
      updateAvailability(tabId);
    },
    [updateAvailability],
  );

  const replaceActiveHistory = useCallback(
    (nextSnapshot: GraphHistorySnapshot | null) => {
      replaceHistoryForTab(activeTabId, nextSnapshot);
    },
    [activeTabId, replaceHistoryForTab],
  );

  const commitSnapshot = useCallback(
    (nextSnapshot: GraphHistorySnapshot | null, options?: { baseSnapshot?: GraphHistorySnapshot | null; tabId?: string | null }) => {
      const targetTabId = options?.tabId ?? activeTabId;
      if (!targetTabId || !nextSnapshot) return;
      if (commitTimerRef.current) {
        window.clearTimeout(commitTimerRef.current);
        commitTimerRef.current = null;
      }
      const explicitBaseSnapshot = options?.baseSnapshot ?? null;
      const seededEntry = explicitBaseSnapshot
        ? graphHistoryEntryForSnapshot(explicitBaseSnapshot)
        : historyByTabRef.current.get(targetTabId) ??
          (latestSnapshotRef.current ? graphHistoryEntryForSnapshot(latestSnapshotRef.current) : undefined);
      const stagedEntry = graphHistoryStageSnapshot(seededEntry, nextSnapshot);
      historyByTabRef.current.set(targetTabId, graphHistoryCommitPending(stagedEntry));
      const expectedSignature = graphHistorySnapshotSignature(nextSnapshot);
      if (expectedSignature) {
        expectedSnapshotSignatureByTabRef.current.set(targetTabId, expectedSignature);
      } else {
        expectedSnapshotSignatureByTabRef.current.delete(targetTabId);
      }
      updateAvailability(targetTabId);
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
    replaceHistoryForTab,
    commitSnapshot,
  };
}
