"use client";

import { useEffect, type MutableRefObject } from "react";

import type { GraphNodeDefinition } from "../types";

type UseGraphWorkspaceRestoreParams = {
  appendConsole: (line: string) => void;
  definitionsLoadStarted: MutableRefObject<boolean>;
  reloadNodeDefinitions: () => Promise<GraphNodeDefinition[]>;
  restoreBlankWorkflow: () => void;
  restoreLatestRunSnapshot: (
    items: GraphNodeDefinition[],
    restoreVersion: number,
  ) => Promise<boolean>;
  restoreVersionIsCurrent: (restoreVersion: number) => boolean;
  restoreWorkspaceSnapshot: (
    items: GraphNodeDefinition[],
    restoreVersion: number,
  ) => Promise<boolean>;
  storageScope: string | null;
  workspaceRestoreVersionRef: MutableRefObject<number>;
};

export function useGraphWorkspaceRestore({
  appendConsole,
  definitionsLoadStarted,
  reloadNodeDefinitions,
  restoreBlankWorkflow,
  restoreLatestRunSnapshot,
  restoreVersionIsCurrent,
  restoreWorkspaceSnapshot,
  storageScope,
  workspaceRestoreVersionRef,
}: UseGraphWorkspaceRestoreParams) {
  useEffect(() => {
    if (storageScope === null) return;
    if (definitionsLoadStarted.current) return;
    definitionsLoadStarted.current = true;
    const restoreVersion = workspaceRestoreVersionRef.current;
    reloadNodeDefinitions()
      .then(async (items) => {
        if (!restoreVersionIsCurrent(restoreVersion)) return;
        const restoredSession = await restoreWorkspaceSnapshot(
          items,
          restoreVersion,
        );
        if (restoredSession) return;
        if (!restoreVersionIsCurrent(restoreVersion)) return;
        const restoredLatestRun = await restoreLatestRunSnapshot(
          items,
          restoreVersion,
        ).catch(() => false);
        if (restoredLatestRun) return;
        if (!restoreVersionIsCurrent(restoreVersion)) return;
        restoreBlankWorkflow();
      })
      .catch((error) => {
        definitionsLoadStarted.current = false;
        appendConsole(`Failed to load node definitions: ${error.message}`);
      });
  }, [
    appendConsole,
    definitionsLoadStarted,
    reloadNodeDefinitions,
    restoreBlankWorkflow,
    restoreLatestRunSnapshot,
    restoreVersionIsCurrent,
    restoreWorkspaceSnapshot,
    storageScope,
    workspaceRestoreVersionRef,
  ]);
}
