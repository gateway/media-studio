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
  it("restores the saved workspace before trying latest-run or blank fallbacks", async () => {
    const restoreBlankWorkflow = vi.fn();
    const restoreLatestRunSnapshot = vi.fn(async () => true);
    const restoreWorkspaceSnapshot = vi.fn(async () => true);

    renderHook(() =>
      useGraphWorkspaceRestore({
        appendConsole: vi.fn(),
        definitionsLoadStarted: ref(false),
        reloadNodeDefinitions: vi.fn(async () => definitions),
        restoreBlankWorkflow,
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
    expect(restoreBlankWorkflow).not.toHaveBeenCalled();
  });

  it("restores a blank workflow only after restore fallbacks miss", async () => {
    const restoreBlankWorkflow = vi.fn();

    renderHook(() =>
      useGraphWorkspaceRestore({
        appendConsole: vi.fn(),
        definitionsLoadStarted: ref(false),
        reloadNodeDefinitions: vi.fn(async () => definitions),
        restoreBlankWorkflow,
        restoreLatestRunSnapshot: vi.fn(async () => false),
        restoreVersionIsCurrent: vi.fn(() => true),
        restoreWorkspaceSnapshot: vi.fn(async () => false),
        storageScope: "default",
        workspaceRestoreVersionRef: ref(3),
      }),
    );

    await waitFor(() => expect(restoreBlankWorkflow).toHaveBeenCalledTimes(1));
  });

  it("does not apply fallbacks when the restore version becomes stale", async () => {
    const restoreBlankWorkflow = vi.fn();
    const reloadNodeDefinitions = vi.fn(async () => definitions);

    renderHook(() =>
      useGraphWorkspaceRestore({
        appendConsole: vi.fn(),
        definitionsLoadStarted: ref(false),
        reloadNodeDefinitions,
        restoreBlankWorkflow,
        restoreLatestRunSnapshot: vi.fn(async () => false),
        restoreVersionIsCurrent: vi.fn(() => false),
        restoreWorkspaceSnapshot: vi.fn(async () => false),
        storageScope: "default",
        workspaceRestoreVersionRef: ref(4),
      }),
    );

    await waitFor(() => expect(reloadNodeDefinitions).toHaveBeenCalledTimes(1));
    expect(restoreBlankWorkflow).not.toHaveBeenCalled();
  });

  it("resets the load guard when definition loading fails", async () => {
    const appendConsole = vi.fn();
    const definitionsLoadStarted = ref(false);

    renderHook(() =>
      useGraphWorkspaceRestore({
        appendConsole,
        definitionsLoadStarted,
        reloadNodeDefinitions: vi.fn(async () => {
          throw new Error("definitions unavailable");
        }),
        restoreBlankWorkflow: vi.fn(),
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
