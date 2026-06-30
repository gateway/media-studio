"use client";

import { useEffect, type MutableRefObject } from "react";

import type { GraphNodeDefinition } from "../types";

type UseGraphWorkspaceRestoreParams = {
  appendConsole: (line: string) => void;
  buildStarterWorkflow: (items: GraphNodeDefinition[]) => void;
  canvasHydrated: MutableRefObject<boolean>;
  definitionsLoadStarted: MutableRefObject<boolean>;
  reloadNodeDefinitions: () => Promise<GraphNodeDefinition[]>;
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
  buildStarterWorkflow,
  canvasHydrated,
  definitionsLoadStarted,
  reloadNodeDefinitions,
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
        buildStarterWorkflow(items);
        canvasHydrated.current = true;
      })
      .catch((error) => {
        definitionsLoadStarted.current = false;
        appendConsole(`Failed to load node definitions: ${error.message}`);
      });
  }, [
    appendConsole,
    buildStarterWorkflow,
    canvasHydrated,
    definitionsLoadStarted,
    reloadNodeDefinitions,
    restoreLatestRunSnapshot,
    restoreVersionIsCurrent,
    restoreWorkspaceSnapshot,
    storageScope,
    workspaceRestoreVersionRef,
  ]);
}
