// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GraphWorkspaceTab, GraphWorkflowPayload } from "../types";
import { graphTabsStorageKey, writeGraphTabSession } from "../utils/graph-tabs";
import { useGraphTabs } from "./use-graph-tabs";
import { __resetGraphStartupReadsForTests } from "../utils/graph-startup-reads";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function workflow(name: string): GraphWorkflowPayload {
  return { schema_version: 1, workflow_id: null, name, nodes: [], edges: [] };
}

function tab(tabId: string, name: string): GraphWorkspaceTab {
  return {
    tab_id: tabId,
    workflow_id: `${tabId}-workflow`,
    workflow_name: name,
    workflow_json: workflow(name),
    saved_workflow_signature: null,
    workflow_updated_at: null,
    run_id: null,
    run_status: null,
    console_lines: [],
    dirty: false,
    updated_at: new Date().toISOString(),
  };
}

const storage = new Map<string, string>();
const localStorageMock = {
  getItem(key: string) {
    return storage.get(key) ?? null;
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

beforeEach(() => {
  Object.defineProperty(window, "localStorage", {
    value: localStorageMock,
    configurable: true,
  });
});

afterEach(() => {
  __resetGraphStartupReadsForTests();
  vi.unstubAllGlobals();
  localStorageMock.clear();
  window.history.replaceState(null, "", "/");
});

describe("graph storage identity continuity", () => {
  it("preserves all six tabs through healthy, offline and recovered remounts", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ install_id: "installation-A" }),
    );
    vi.stubGlobal("fetch", fetcher);
    writeGraphTabSession("installation-A", "a", [
      tab("a", "Draft A"),
      tab("b", "Draft B"),
    ]);
    writeGraphTabSession("default", "legacy", [tab("legacy", "Keep legacy")]);
    const legacy = storage.get(graphTabsStorageKey("default"));
    const first = renderHook(() => useGraphTabs());
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      first.result.current.chooseStorageScope("installation-A");
    });
    for (let i = 0; i < 4; i++)
      act(() => {
        first.result.current.openBlankTab();
      });
    const ids = first.result.current.tabs.map((t) => t.tab_id).sort();
    first.unmount();
    for (const offline of [true, false]) {
      __resetGraphStartupReadsForTests();
      fetcher.mockImplementation(async () => {
        if (offline) throw new Error("offline");
        return Response.json({ install_id: "installation-A" });
      });
      const next = renderHook(() => useGraphTabs());
      await act(async () => {
        await Promise.resolve();
      });
      expect(next.result.current.storageScope).toBe("installation-A");
      expect(next.result.current.tabs.map((t) => t.tab_id).sort()).toEqual(ids);
      expect(storage.get(graphTabsStorageKey("default"))).toBe(legacy);
      next.unmount();
    }
  });
  it.each([{}, { install_id: "   " }])(
    "does not select default for missing identity %j",
    async (payload) => {
      writeGraphTabSession("default", "legacy", [tab("legacy", "Keep legacy")]);
      const original = new Map(storage);
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json(payload)),
      );
      const mounted = renderHook(() => useGraphTabs());
      await act(async () => {
        await Promise.resolve();
      });
      expect(mounted.result.current.storageScope).toBeNull();
      expect(storage).toEqual(original);
      mounted.unmount();
    },
  );
  it("leaves all existing sets untouched when offline with no verified identity", async () => {
    writeGraphTabSession("default", "legacy", [tab("legacy", "Keep legacy")]);
    writeGraphTabSession("installation-A", "a", [tab("a", "Keep A")]);
    const original = new Map(storage);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const mounted = renderHook(() => useGraphTabs());
    await act(async () => {
      await Promise.resolve();
    });
    expect(mounted.result.current.storageScope).toBeNull();
    expect(storage).toEqual(original);
    mounted.unmount();
  });
  it("does not overwrite stored drafts when an edit arrives before identity", async () => {
    const health = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => health.promise),
    );
    writeGraphTabSession("installation-A", "a", [tab("a", "Stored A")]);
    const original = storage.get(graphTabsStorageKey("installation-A"));
    const mounted = renderHook(() => useGraphTabs());
    act(() => {
      mounted.result.current.openBlankTab();
    });
    await act(async () => {
      health.resolve(Response.json({ install_id: "installation-A" }));
      await health.promise;
    });
    expect(storage.get(graphTabsStorageKey("installation-A"))).toBe(original);
    mounted.unmount();
  });
});

it("requires an explicit legacy choice, preserves the other set, and remembers it offline", async () => {
  const draft = {
    ...tab("legacy", "Offline draft"),
    dirty: true,
    assistant_session_id: "assistant-one",
    workflow_json: {
      ...workflow("Offline draft"),
      nodes: [
        {
          id: "text",
          type: "prompt.text",
          position: { x: 37, y: 91 },
          fields: { text: "Exact draft" },
        },
      ],
    },
  };
  writeGraphTabSession("default", "legacy", [draft]);
  writeGraphTabSession("installation-A", "a", [tab("a", "Keep A")]);
  const a = storage.get(graphTabsStorageKey("installation-A"));
  const fetcher = vi.fn(async () =>
    Response.json({ install_id: "installation-A" }),
  );
  vi.stubGlobal("fetch", fetcher);
  const first = renderHook(() => useGraphTabs());
  await act(async () => {
    await Promise.resolve();
  });
  expect(first.result.current.storageScope).toBeNull();
  expect(first.result.current.storageChoices).toHaveLength(2);
  act(() => first.result.current.chooseStorageScope("not-an-offered-choice"));
  expect(first.result.current.storageScope).toBeNull();
  await act(async () => {
    first.result.current.chooseStorageScope("default");
  });
  expect(first.result.current.tabs[0]).toMatchObject(draft);
  const legacy = storage.get(graphTabsStorageKey("default"));
  first.unmount();
  for (const offline of [true, false]) {
    __resetGraphStartupReadsForTests();
    fetcher.mockImplementation(async () => {
      if (offline) throw new Error("offline");
      return Response.json({ install_id: "installation-A" });
    });
    const next = renderHook(() => useGraphTabs());
    await act(async () => {
      await Promise.resolve();
    });
    expect(next.result.current.storageScope).toBe("default");
    expect(next.result.current.tabs[0]).toMatchObject(draft);
    expect(storage.get(graphTabsStorageKey("installation-A"))).toBe(a);
    expect(storage.get(graphTabsStorageKey("default"))).toBe(legacy);
    next.unmount();
  }
});
it("retry restores the verified installation without ever touching legacy data", async () => {
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(Response.json({ install_id: "A" }));
  vi.stubGlobal("fetch", fetcher);
  writeGraphTabSession("A", "a", [tab("a", "Stored A")]);
  const mounted = renderHook(() => useGraphTabs());
  await act(async () => {
    await Promise.resolve();
  });
  expect(mounted.result.current.storageRestoreError).toBeTruthy();
  await act(async () => {
    mounted.result.current.retryStorageRestore();
  });
  expect(mounted.result.current.storageScope).toBe("A");
  expect(mounted.result.current.tabs[0].tab_id).toBe("a");
  expect(storage.has(graphTabsStorageKey("default"))).toBe(false);
  mounted.unmount();
});
it("a verified different installation selects its own workspace without changing the prior one", async () => {
  writeGraphTabSession("A", "a", [tab("a", "Keep A")]);
  writeGraphTabSession("B", "b", [tab("b", "Keep B")]);
  const fetcher = vi.fn(async () => Response.json({ install_id: "A" }));
  vi.stubGlobal("fetch", fetcher);
  const first = renderHook(() => useGraphTabs());
  await act(async () => {
    await Promise.resolve();
  });
  const original = storage.get(graphTabsStorageKey("A"));
  first.unmount();
  __resetGraphStartupReadsForTests();
  fetcher.mockImplementation(async () => Response.json({ install_id: "B" }));
  const second = renderHook(() => useGraphTabs());
  await act(async () => {
    await Promise.resolve();
  });
  expect(second.result.current.tabs[0].tab_id).toBe("b");
  expect(storage.get(graphTabsStorageKey("A"))).toBe(original);
  second.unmount();
});
it("storage denial does not permit draft writes and can recover on retry", async () => {
  writeGraphTabSession("A", "a", [tab("a", "Keep A")]);
  const original = new Map(storage);
  const spy = vi.spyOn(localStorageMock, "setItem").mockImplementation(() => {
    throw new Error("denied");
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ install_id: "A" })),
  );
  const mounted = renderHook(() => useGraphTabs());
  await act(async () => {
    await Promise.resolve();
  });
  expect(mounted.result.current.storageScope).toBeNull();
  expect(storage).toEqual(original);
  spy.mockRestore();
  await act(async () => {
    mounted.result.current.retryStorageRestore();
  });
  expect(mounted.result.current.tabs[0].tab_id).toBe("a");
  mounted.unmount();
});
it("an abandoned mount cannot persist identity or blank tabs", async () => {
  const health = deferred<Response>();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => health.promise),
  );
  const original = new Map(storage);
  const mounted = renderHook(() => useGraphTabs());
  mounted.unmount();
  await act(async () => {
    health.resolve(Response.json({ install_id: "A" }));
    await health.promise;
  });
  expect(storage).toEqual(original);
});
it("scoped writes preserve old unscoped drafts", () => {
  writeGraphTabSession(null, "legacy", [tab("legacy", "Unscoped draft")]);
  const original = storage.get(graphTabsStorageKey(null));
  writeGraphTabSession("A", "a", [tab("a", "A")]);
  expect(storage.get(graphTabsStorageKey(null))).toBe(original);
});

it("remembers a chosen offline set when returning from another verified installation", async () => {
  writeGraphTabSession("default", "legacy", [tab("legacy", "Offline draft")]);
  writeGraphTabSession("A", "old", [tab("old", "Older A")]);
  const fetcher = vi.fn(async () => Response.json({ install_id: "A" }));
  vi.stubGlobal("fetch", fetcher);
  const first = renderHook(() => useGraphTabs());
  await act(async () => { await Promise.resolve(); });
  await act(async () => { first.result.current.chooseStorageScope("default"); });
  first.unmount();
  for (const installId of ["B", "A"]) {
    __resetGraphStartupReadsForTests();
    fetcher.mockImplementation(async () => Response.json({ install_id: installId }));
    const next = renderHook(() => useGraphTabs());
    await act(async () => { await Promise.resolve(); });
    expect(next.result.current.storageScope).toBe(installId === "A" ? "default" : "B");
    next.unmount();
  }
});
