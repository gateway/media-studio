// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GRAPH_NODE_DEFINITIONS_EVENT,
  GRAPH_NODE_DEFINITIONS_STORAGE_KEY,
  invalidateGraphNodeDefinitions,
  readGraphNodeDefinitionsRevision,
} from "@/lib/graph-node-definitions-sync";

const storage = new Map<string, string>();
const localStorageMock = {
  getItem(key: string) {
    return storage.has(key) ? storage.get(key) ?? null : null;
  },
  setItem(key: string, value: string) {
    storage.set(key, String(value));
  },
  removeItem(key: string) {
    storage.delete(key);
  },
  clear() {
    storage.clear();
  },
};

Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  configurable: true,
});

describe("graph node definitions sync", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("reads a stored revision payload", () => {
    window.localStorage.setItem(
      GRAPH_NODE_DEFINITIONS_STORAGE_KEY,
      JSON.stringify({ changedAt: "2026-05-17T00:00:00.000Z", reason: "prompt-recipe-updated" }),
    );

    expect(readGraphNodeDefinitionsRevision()).toEqual({
      changedAt: "2026-05-17T00:00:00.000Z",
      reason: "prompt-recipe-updated",
    });
  });

  it("broadcasts a revision", async () => {
    const listener = vi.fn();
    window.addEventListener(GRAPH_NODE_DEFINITIONS_EVENT, listener as EventListener);

    const revision = await invalidateGraphNodeDefinitions("media-preset-created");

    expect(revision.reason).toBe("media-preset-created");
    expect(readGraphNodeDefinitionsRevision()?.reason).toBe("media-preset-created");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
