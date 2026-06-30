// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import type { MutableRefObject } from "react";
import { describe, expect, it, vi } from "vitest";

import type { GraphNodeDefinition } from "../types";
import { useGraphWorkspaceRestore } from "./use-graph-workspace-restore";

const definitions: GraphNodeDefinition[] = [
  {
    type: "utility.note",
    title: "Note",
    category: "Utility",
    fields: [],
    ports: { inputs: [], outputs: [] },
  },
];

function ref<T>(current: T): MutableRefObject<T> {
  return { current };
}

describe("useGraphWorkspaceRestore", () => {
  it("restores the saved workspace before trying latest-run or starter fallbacks", async () => {
    const buildStarterWorkflow = vi.fn();
    const restoreLatestRunSnapshot = vi.fn(async () => true);
    const restoreWorkspaceSnapshot = vi.fn(async () => true);

    renderHook(() =>
      useGraphWorkspaceRestore({
        appendConsole: vi.fn(),
        buildStarterWorkflow,
        canvasHydrated: ref(false),
        definitionsLoadStarted: ref(false),
        reloadNodeDefinitions: vi.fn(async () => definitions),
        restoreLatestRunSnapshot,
        restoreVersionIsCurrent: vi.fn(() => true),
        restoreWorkspaceSnapshot,
        storageScope: "default",
        workspaceRestoreVersionRef: ref(7),
      }),
    );

    await waitFor(() =>
      expect(restoreWorkspaceSnapshot).toHaveBeenCalledWith(definitions, 7),
    );
    expect(restoreLatestRunSnapshot).not.toHaveBeenCalled();
    expect(buildStarterWorkflow).not.toHaveBeenCalled();
  });

  it("builds the starter workflow only after restore fallbacks miss", async () => {
    const canvasHydrated = ref(false);
    const buildStarterWorkflow = vi.fn();

    renderHook(() =>
      useGraphWorkspaceRestore({
        appendConsole: vi.fn(),
        buildStarterWorkflow,
        canvasHydrated,
        definitionsLoadStarted: ref(false),
        reloadNodeDefinitions: vi.fn(async () => definitions),
        restoreLatestRunSnapshot: vi.fn(async () => false),
        restoreVersionIsCurrent: vi.fn(() => true),
        restoreWorkspaceSnapshot: vi.fn(async () => false),
        storageScope: "default",
        workspaceRestoreVersionRef: ref(3),
      }),
    );

    await waitFor(() =>
      expect(buildStarterWorkflow).toHaveBeenCalledWith(definitions),
    );
    expect(canvasHydrated.current).toBe(true);
  });

  it("does not apply fallbacks when the restore version becomes stale", async () => {
    const buildStarterWorkflow = vi.fn();
    const reloadNodeDefinitions = vi.fn(async () => definitions);

    renderHook(() =>
      useGraphWorkspaceRestore({
        appendConsole: vi.fn(),
        buildStarterWorkflow,
        canvasHydrated: ref(false),
        definitionsLoadStarted: ref(false),
        reloadNodeDefinitions,
        restoreLatestRunSnapshot: vi.fn(async () => false),
        restoreVersionIsCurrent: vi.fn(() => false),
        restoreWorkspaceSnapshot: vi.fn(async () => false),
        storageScope: "default",
        workspaceRestoreVersionRef: ref(4),
      }),
    );

    await waitFor(() => expect(reloadNodeDefinitions).toHaveBeenCalledTimes(1));
    expect(buildStarterWorkflow).not.toHaveBeenCalled();
  });

  it("resets the load guard when definition loading fails", async () => {
    const appendConsole = vi.fn();
    const definitionsLoadStarted = ref(false);

    renderHook(() =>
      useGraphWorkspaceRestore({
        appendConsole,
        buildStarterWorkflow: vi.fn(),
        canvasHydrated: ref(false),
        definitionsLoadStarted,
        reloadNodeDefinitions: vi.fn(async () => {
          throw new Error("definitions unavailable");
        }),
        restoreLatestRunSnapshot: vi.fn(async () => false),
        restoreVersionIsCurrent: vi.fn(() => true),
        restoreWorkspaceSnapshot: vi.fn(async () => false),
        storageScope: "default",
        workspaceRestoreVersionRef: ref(5),
      }),
    );

    await waitFor(() =>
      expect(appendConsole).toHaveBeenCalledWith(
        "Failed to load node definitions: definitions unavailable",
      ),
    );
    expect(definitionsLoadStarted.current).toBe(false);
  });
});
