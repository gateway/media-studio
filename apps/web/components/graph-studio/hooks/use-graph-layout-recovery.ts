import { useCallback, useRef } from "react";
import type { GraphRun, GraphWorkflowPayload } from "../types";
import { restoreGraphLayout } from "../utils/graph-layout-recovery";
import { graphWorkflowSnapshotSignature } from "../utils/graph-tabs";

type RecoveryOwner = {
  activeTabId: string | null;
  workflow: GraphWorkflowPayload;
  runActive: boolean;
  onRestore: (workflow: GraphWorkflowPayload) => void;
  onMessage: (message: string) => void;
};

export function graphLayoutRecoveryRunActive(run: GraphRun | null) {
  return Boolean(run && !["completed", "failed", "cancelled"].includes(run.status));
}

function ownsDraft(source: RecoveryOwner, latest: RecoveryOwner) {
  return latest.activeTabId === source.activeTabId && !latest.runActive
    && graphWorkflowSnapshotSignature(latest.workflow) === graphWorkflowSnapshotSignature(source.workflow);
}

export function useGraphLayoutRecovery(owner: RecoveryOwner) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const current = useRef(owner);
  current.current = owner;
  const restoreFile = useCallback(async (file: File) => {
    const source = current.current;
    try {
      if (source.runActive) throw new Error("Wait for the current run to finish before restoring a layout.");
      const result = await restoreGraphLayout(await file.text(), source.workflow);
      const latest = current.current;
      if (!ownsDraft(source, latest)) {
        throw new Error("The selected draft changed while reading the backup. Nothing was restored.");
      }
      if (result.changed) latest.onRestore(result.workflow);
      latest.onMessage(result.changed ? "Restored layout from backup. Workflow content and identity are unchanged." : "The layout already matches this backup.");
    } catch (error) {
      if (current.current.activeTabId === source.activeTabId) current.current.onMessage(`Could not restore layout: ${(error as Error).message}`);
    }
  }, []);
  return { inputRef, restoreFile };
}
