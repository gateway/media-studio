// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GraphWorkspaceTab, GraphWorkflowPayload } from "../types";
import { writeGraphTabSession } from "../utils/graph-tabs";
import { useGraphTabs } from "./use-graph-tabs";

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
  vi.unstubAllGlobals();
  localStorageMock.clear();
  window.history.replaceState(null, "", "/");
});

describe("useGraphTabs", () => {
  it("does not let delayed scoped storage restore overwrite a user-created tab", async () => {
    const healthResponse = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(() => healthResponse.promise));
    writeGraphTabSession("install-late", "old-tab", [tab("old-tab", "Old restored workflow")]);

    const { result } = renderHook(() => useGraphTabs());
    const initialActiveTabId = result.current.activeTabId;

    act(() => {
      result.current.openBlankTab();
    });

    const newActiveTabId = result.current.activeTabId;
    expect(newActiveTabId).not.toBe(initialActiveTabId);

    await act(async () => {
      healthResponse.resolve(
        new Response(JSON.stringify({ install_id: "install-late" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      await healthResponse.promise;
      await Promise.resolve();
    });

    expect(result.current.activeTabId).toBe(newActiveTabId);
    expect(result.current.tabs.some((item) => item.workflow_name === "Old restored workflow")).toBe(false);
  });

  it("uses the requested tab from the return URL when restoring scoped tabs", async () => {
    const healthResponse = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(() => healthResponse.promise));
    window.history.replaceState(null, "", "/graph-studio?tab=target-tab");
    writeGraphTabSession("install-return", "dream-tab", [
      tab("dream-tab", "Dream Magazine Cover Portrait"),
      tab("target-tab", "Assistant draft workflow"),
    ]);

    const { result } = renderHook(() => useGraphTabs());

    await act(async () => {
      healthResponse.resolve(
        new Response(JSON.stringify({ install_id: "install-return" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      await healthResponse.promise;
      await Promise.resolve();
    });

    expect(result.current.activeTabId).toBe("target-tab");
    expect(result.current.tabs.find((item) => item.tab_id === result.current.activeTabId)?.workflow_name).toBe("Assistant draft workflow");
    expect(window.location.pathname + window.location.search).toBe("/graph-studio");
  });

  it("associates a returned assistant session only with the requested graph tab", async () => {
    const healthResponse = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(() => healthResponse.promise));
    window.history.replaceState(null, "", "/graph-studio?tab=target-tab&assistantSession=session-9");
    writeGraphTabSession("install-return", "dream-tab", [
      tab("dream-tab", "Dream Magazine Cover Portrait"),
      tab("target-tab", "Assistant draft workflow"),
    ]);

    const { result } = renderHook(() => useGraphTabs());

    await act(async () => {
      healthResponse.resolve(
        new Response(JSON.stringify({ install_id: "install-return" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      await healthResponse.promise;
      await Promise.resolve();
    });

    expect(result.current.activeTabId).toBe("target-tab");
    expect(result.current.tabs.find((item) => item.tab_id === "target-tab")?.assistant_session_id).toBe("session-9");
    expect(result.current.tabs.find((item) => item.tab_id === "dream-tab")?.assistant_session_id).toBeNull();
    expect(window.location.pathname + window.location.search).toBe("/graph-studio");
  });

  it("opens a blank workflow tab without inheriting the active assistant session", async () => {
    const healthResponse = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(() => healthResponse.promise));
    window.history.replaceState(null, "", "/graph-studio?tab=target-tab&assistantSession=session-9");
    writeGraphTabSession("install-return", "target-tab", [tab("target-tab", "Assistant draft workflow")]);

    const { result } = renderHook(() => useGraphTabs());

    await act(async () => {
      healthResponse.resolve(
        new Response(JSON.stringify({ install_id: "install-return" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      await healthResponse.promise;
      await Promise.resolve();
    });

    act(() => {
      result.current.openBlankTab();
    });

    const activeTab = result.current.tabs.find((item) => item.tab_id === result.current.activeTabId);
    expect(activeTab?.workflow_id).toBeNull();
    expect(activeTab?.assistant_session_id).toBeNull();
  });

  it("can close restored stale tabs without deleting the active workflow tab", async () => {
    const healthResponse = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(() => healthResponse.promise));
    writeGraphTabSession("install-return", "target-tab", [
      tab("dream-tab", "Dream Magazine Cover Portrait"),
      tab("target-tab", "Assistant draft workflow"),
    ]);

    const { result } = renderHook(() => useGraphTabs());

    await act(async () => {
      healthResponse.resolve(
        new Response(JSON.stringify({ install_id: "install-return" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      await healthResponse.promise;
      await Promise.resolve();
    });

    act(() => {
      result.current.closeOtherTabs();
    });

    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.tabs[0].workflow_name).toBe("Assistant draft workflow");
    expect(result.current.activeTabId).toBe("target-tab");
  });
});
