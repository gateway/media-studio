import type { GraphWorkflowPayload } from "../types";
import { graphWorkflowSnapshotSignature } from "./graph-tabs";

export const GRAPH_HISTORY_LIMIT = 60;

export type GraphHistorySnapshot = {
  workflowId: string | null;
  workflowName: string;
  workflowUpdatedAt?: string | null;
  workflow: GraphWorkflowPayload;
};

export type GraphHistoryEntry = {
  past: GraphHistorySnapshot[];
  present: GraphHistorySnapshot | null;
  future: GraphHistorySnapshot[];
  pending: GraphHistorySnapshot | null;
};

export function graphHistorySnapshotSignature(snapshot: GraphHistorySnapshot | null | undefined): string | null {
  return graphWorkflowSnapshotSignature(snapshot?.workflow ?? null);
}

export function graphHistoryEntryForSnapshot(snapshot: GraphHistorySnapshot): GraphHistoryEntry {
  return { past: [], present: snapshot, future: [], pending: null };
}

export function graphHistoryCanUndo(entry: GraphHistoryEntry | null | undefined): boolean {
  return Boolean(entry?.pending || entry?.past.length);
}

export function graphHistoryCanRedo(entry: GraphHistoryEntry | null | undefined): boolean {
  return Boolean(!entry?.pending && entry?.future.length);
}

export function graphHistoryStageSnapshot(
  entry: GraphHistoryEntry | null | undefined,
  snapshot: GraphHistorySnapshot,
): GraphHistoryEntry {
  if (!entry?.present) return graphHistoryEntryForSnapshot(snapshot);
  const presentSignature = graphHistorySnapshotSignature(entry.present);
  const pendingSignature = graphHistorySnapshotSignature(entry.pending);
  const nextSignature = graphHistorySnapshotSignature(snapshot);
  if (nextSignature === presentSignature) {
    return entry.pending ? { ...entry, pending: null } : entry;
  }
  if (nextSignature === pendingSignature) {
    return entry;
  }
  return { ...entry, pending: snapshot };
}

export function graphHistoryCommitPending(entry: GraphHistoryEntry | null | undefined): GraphHistoryEntry {
  if (!entry?.present || !entry.pending) return entry ?? { past: [], present: null, future: [], pending: null };
  const presentSignature = graphHistorySnapshotSignature(entry.present);
  const pendingSignature = graphHistorySnapshotSignature(entry.pending);
  if (!pendingSignature || pendingSignature === presentSignature) {
    return { ...entry, pending: null };
  }
  const nextPast = [...entry.past, entry.present].slice(-GRAPH_HISTORY_LIMIT);
  return {
    past: nextPast,
    present: entry.pending,
    future: [],
    pending: null,
  };
}

export function graphHistoryUndo(entry: GraphHistoryEntry | null | undefined): {
  entry: GraphHistoryEntry;
  snapshot: GraphHistorySnapshot | null;
} {
  const normalized = entry ?? { past: [], present: null, future: [], pending: null };
  if (!normalized.present) {
    return { entry: normalized, snapshot: null };
  }
  if (normalized.pending) {
    return {
      entry: {
        ...normalized,
        pending: null,
        future: [normalized.pending, ...normalized.future].slice(0, GRAPH_HISTORY_LIMIT),
      },
      snapshot: normalized.present,
    };
  }
  if (!normalized.past.length) {
    return { entry: normalized, snapshot: null };
  }
  const nextPresent = normalized.past[normalized.past.length - 1];
  return {
    entry: {
      past: normalized.past.slice(0, -1),
      present: nextPresent,
      future: [normalized.present, ...normalized.future].slice(0, GRAPH_HISTORY_LIMIT),
      pending: null,
    },
    snapshot: nextPresent,
  };
}

export function graphHistoryRedo(entry: GraphHistoryEntry | null | undefined): {
  entry: GraphHistoryEntry;
  snapshot: GraphHistorySnapshot | null;
} {
  const normalized = entry ?? { past: [], present: null, future: [], pending: null };
  if (!normalized.present || normalized.pending || !normalized.future.length) {
    return { entry: normalized, snapshot: null };
  }
  const [nextPresent, ...nextFuture] = normalized.future;
  return {
    entry: {
      past: [...normalized.past, normalized.present].slice(-GRAPH_HISTORY_LIMIT),
      present: nextPresent,
      future: nextFuture,
      pending: null,
    },
    snapshot: nextPresent,
  };
}
