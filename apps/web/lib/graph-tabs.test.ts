// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import {
  applyGraphTabSnapshot,
  blankGraphWorkflowPayload,
  GRAPH_TABS_MAX_CONSOLE_LINE_CHARS,
  GRAPH_TABS_MAX_CONSOLE_LINES,
  GRAPH_TABS_MAX_RESTORABLE_TABS,
  GRAPH_TABS_SCHEMA_VERSION,
  GRAPH_TABS_STORAGE_KEY,
  graphTabsStorageKey,
  graphWorkflowSnapshotsMatch,
  graphTabCloseTarget,
  graphTabOpenWorkflowTarget,
  graphWorkflowDirtyState,
  graphWorkflowSnapshotSignature,
  readGraphTabSession,
  shouldReloadSavedWorkflowRecordOnRestore,
  writeGraphTabSession,
} from "@/components/graph-studio/utils/graph-tabs";
import type { GraphWorkspaceTab, GraphWorkflowPayload } from "@/components/graph-studio/types";

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
const localStorageOriginalSetItem = localStorageMock.setItem.bind(localStorageMock);

Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  configurable: true,
});

function tab(tab_id: string, name: string): GraphWorkspaceTab {
  return { tab_id, workflow_name: name, workflow_id: `${tab_id}-workflow`, workflow_json: workflow(name), dirty: false };
}

function workflow(name: string): GraphWorkflowPayload {
  return { schema_version: 1, workflow_id: null, name, nodes: [], edges: [] };
}

afterEach(() => {
  Object.defineProperty(window.localStorage, "setItem", {
    configurable: true,
    value: localStorageOriginalSetItem,
  });
  window.localStorage.removeItem(GRAPH_TABS_STORAGE_KEY);
  window.localStorage.clear();
});

describe("graph workspace tabs", () => {
  it("returns the previous tab when closing the active throwaway tab", () => {
    const tabs = [tab("main", "Nano Slice Four Kling"), tab("scratch", "New workflow")];
    expect(graphTabCloseTarget(tabs, "scratch", "scratch")?.tab_id).toBe("main");
  });

  it("keeps the active tab when closing an inactive tab", () => {
    const tabs = [tab("main", "Nano Slice Four Kling"), tab("scratch", "New workflow")];
    expect(graphTabCloseTarget(tabs, "main", "scratch")?.tab_id).toBe("main");
  });

  it("applies the current canvas snapshot before tab persistence", () => {
    const updated = applyGraphTabSnapshot(tab("main", "Old"), {
      workflowId: "workflow-live",
      workflowName: "Live canvas",
      workflow: workflow("Live canvas"),
      runId: "run-1",
      runStatus: "running",
      consoleLines: ["node.started", "node.completed"],
      dirty: true,
    });
    expect(updated.workflow_id).toBe("workflow-live");
    expect(updated.workflow_name).toBe("Live canvas");
    expect(updated.run_id).toBe("run-1");
    expect(updated.run_status).toBe("running");
    expect(updated.console_lines).toEqual(["node.started", "node.completed"]);
    expect(updated.dirty).toBe(true);
    expect(updated.workflow_json?.name).toBe("Live canvas");
  });

  it("opens a selected saved workflow in a separate tab while snapshotting the active tab", () => {
    const active = tab("main", "Current workflow");
    const selected = applyGraphTabSnapshot({ ...tab("selected", "Selected workflow"), workflow_id: null }, {
      workflowId: "workflow-selected",
      workflowName: "Selected workflow",
      workflow: { ...workflow("Selected workflow"), workflow_id: "workflow-selected" },
      runId: null,
      dirty: false,
    });
    const result = graphTabOpenWorkflowTarget([active], active.tab_id, selected, {
      workflowId: active.workflow_id,
      workflowName: "Current edited workflow",
      workflow: workflow("Current edited workflow"),
      runId: "run-current",
      consoleLines: ["current console"],
      dirty: true,
    });
    expect(result.activeTabId).toBe(selected.tab_id);
    expect(result.tabs).toHaveLength(2);
    expect(result.tabs[0].workflow_name).toBe("Current edited workflow");
    expect(result.tabs[0].dirty).toBe(true);
    expect(result.tabs[1].workflow_id).toBe("workflow-selected");
    expect(result.tabs[1].workflow_name).toBe("Selected workflow");
  });

  it("focuses an already-open workflow tab instead of duplicating it", () => {
    const active = tab("main", "Current workflow");
    const existing = tab("selected", "Old selected name");
    const selected = applyGraphTabSnapshot(existing, {
      workflowId: existing.workflow_id,
      workflowName: "Fresh selected name",
      workflow: workflow("Fresh selected name"),
      runId: null,
      dirty: false,
    });
    const result = graphTabOpenWorkflowTarget([active, existing], active.tab_id, selected);
    expect(result.activeTabId).toBe(existing.tab_id);
    expect(result.tabs).toHaveLength(2);
    expect(result.tabs[1].workflow_name).toBe("Fresh selected name");
  });

  it("creates a blank workflow payload for workflow close", () => {
    expect(blankGraphWorkflowPayload()).toEqual({
      schema_version: 1,
      workflow_id: null,
      name: "New workflow",
      nodes: [],
      edges: [],
      metadata: { created_by: "graph-studio", groups: [] },
    });
  });

  it("reads the current graph tab session schema from local storage", () => {
    const tabs = [tab("main", "Live workflow")];
    writeGraphTabSession(null, "main", tabs);
    const raw = JSON.parse(window.localStorage.getItem(GRAPH_TABS_STORAGE_KEY) || "null");
    expect(raw.schema_version).toBe(GRAPH_TABS_SCHEMA_VERSION);

    const restored = readGraphTabSession();
    expect(restored?.active_tab_id).toBe("main");
    expect(restored?.tabs).toHaveLength(1);
    expect(restored?.tabs[0].workflow_name).toBe("Live workflow");
  });

  it("dedupes restored saved workflow tabs without dropping dirty scratch copies", () => {
    const first = tab("first", "Steve test");
    const duplicate = { ...tab("duplicate", "Steve test duplicate"), workflow_id: first.workflow_id, updated_at: "2026-05-23T10:00:00.000Z" };
    const active = { ...tab("active", "Steve test active"), workflow_id: first.workflow_id, updated_at: "2026-05-23T09:00:00.000Z" };
    const dirtyCopy = { ...tab("dirty", "Steve test edits"), workflow_id: first.workflow_id, dirty: true };
    window.localStorage.setItem(
      GRAPH_TABS_STORAGE_KEY,
      JSON.stringify({
        schema_version: GRAPH_TABS_SCHEMA_VERSION,
        active_tab_id: active.tab_id,
        tabs: [first, duplicate, active, dirtyCopy],
      }),
    );

    const restored = readGraphTabSession();
    expect(restored?.active_tab_id).toBe(active.tab_id);
    expect(restored?.tabs.map((item) => item.tab_id)).toEqual([active.tab_id, dirtyCopy.tab_id]);
  });

  it("scopes graph tab sessions by install id", () => {
    const firstScope = "install-one";
    const secondScope = "install-two";
    writeGraphTabSession(firstScope, "main", [tab("main", "First install workflow")]);
    writeGraphTabSession(secondScope, "main", [tab("main", "Second install workflow")]);

    expect(window.localStorage.getItem(GRAPH_TABS_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(graphTabsStorageKey(firstScope))).toContain("First install workflow");
    expect(window.localStorage.getItem(graphTabsStorageKey(secondScope))).toContain("Second install workflow");
    expect(readGraphTabSession(firstScope)?.tabs[0].workflow_name).toBe("First install workflow");
    expect(readGraphTabSession(secondScope)?.tabs[0].workflow_name).toBe("Second install workflow");
  });

  it("does not migrate legacy unscoped graph tabs when an install scope is present", () => {
    writeGraphTabSession(null, "main", [tab("main", "Old unscoped workflow")]);
    expect(readGraphTabSession("fresh-install")).toBeNull();
  });

  it("caps persisted tabs and trims stored console lines", () => {
    const tabs = Array.from({ length: GRAPH_TABS_MAX_RESTORABLE_TABS + 3 }, (_, index) =>
      applyGraphTabSnapshot(tab(`tab-${index}`, `Workflow ${index}`), {
        workflowId: `workflow-${index}`,
        workflowName: `Workflow ${index}`,
        workflow: workflow(`Workflow ${index}`),
        dirty: index === 0,
        consoleLines: Array.from({ length: GRAPH_TABS_MAX_CONSOLE_LINES + 10 }, (_, lineIndex) =>
          `line ${lineIndex} ${"x".repeat(GRAPH_TABS_MAX_CONSOLE_LINE_CHARS + 25)}`,
        ),
      }),
    );
    writeGraphTabSession(null, "tab-0", tabs);
    const raw = JSON.parse(window.localStorage.getItem(GRAPH_TABS_STORAGE_KEY) || "null");
    expect(raw.tabs).toHaveLength(GRAPH_TABS_MAX_RESTORABLE_TABS);
    expect(raw.active_tab_id).toBe("tab-0");
    expect(raw.tabs[0].console_lines).toHaveLength(GRAPH_TABS_MAX_CONSOLE_LINES);
    expect(raw.tabs[0].console_lines[0].length).toBeLessThanOrEqual(GRAPH_TABS_MAX_CONSOLE_LINE_CHARS);
  });

  it("falls back to smaller session variants when local storage is tight", () => {
    let attempts = 0;
    Object.defineProperty(window.localStorage, "setItem", {
      configurable: true,
      value(key: string, value: string) {
        attempts += 1;
        if (attempts < 3 && key === GRAPH_TABS_STORAGE_KEY && value.includes("console_lines")) {
          throw new Error("Quota exceeded");
        }
        return localStorageOriginalSetItem(key, value);
      },
    });

    writeGraphTabSession(
      null,
      "main",
      [
        applyGraphTabSnapshot(tab("main", "Main"), {
          workflowId: "main-workflow",
          workflowName: "Main",
          workflow: workflow("Main"),
          consoleLines: ["a", "b", "c"],
          dirty: true,
        }),
      ],
    );

    const raw = JSON.parse(window.localStorage.getItem(GRAPH_TABS_STORAGE_KEY) || "null");
    expect(attempts).toBe(3);
    expect(raw.tabs[0].console_lines).toEqual([]);
  });

  it("reloads saved workflow records when the cached session payload is missing or empty", () => {
    expect(
      shouldReloadSavedWorkflowRecordOnRestore({
        ...tab("saved", "Saved workflow"),
        workflow_json: null,
      }),
    ).toBe(true);

    expect(
      shouldReloadSavedWorkflowRecordOnRestore({
        ...tab("saved-empty", "Saved workflow"),
        dirty: true,
        workflow_json: { schema_version: 1, workflow_id: "saved-empty-workflow", name: "Saved workflow", nodes: [], edges: [] },
      }),
    ).toBe(true);

    expect(
      shouldReloadSavedWorkflowRecordOnRestore({
        ...tab("saved-complete", "Saved workflow"),
        saved_workflow_signature: graphWorkflowSnapshotSignature({
          schema_version: 1,
          workflow_id: "saved-complete-workflow",
          name: "Saved workflow",
          nodes: [{ id: "node-1", type: "prompt.text", position: { x: 0, y: 0 }, fields: {} }],
          edges: [],
        }),
        dirty: true,
        workflow_json: { schema_version: 1, workflow_id: "saved-complete-workflow", name: "Saved workflow", nodes: [{ id: "node-1", type: "prompt.text", position: { x: 0, y: 0 }, fields: {} }], edges: [] },
      }),
    ).toBe(false);

    const completeWorkflow = {
      schema_version: 1 as const,
      workflow_id: "saved-clean-workflow",
      name: "Saved workflow",
      nodes: [{ id: "node-1", type: "prompt.text", position: { x: 0, y: 0 }, fields: {} }],
      edges: [],
    };
    expect(
      shouldReloadSavedWorkflowRecordOnRestore({
        ...tab("saved-clean", "Saved workflow"),
        saved_workflow_signature: graphWorkflowSnapshotSignature(completeWorkflow),
        dirty: false,
        workflow_json: completeWorkflow,
      }),
    ).toBe(true);
  });

  it("keeps signature-less saved tab snapshots authoritative on restore", () => {
    expect(
      shouldReloadSavedWorkflowRecordOnRestore({
        ...tab("legacy-current", "Saved workflow"),
        workflow_id: "saved-workflow",
        saved_workflow_signature: null,
        dirty: false,
        workflow_json: {
          schema_version: 1,
          workflow_id: "saved-workflow",
          name: "Saved workflow",
          nodes: [
            {
              id: "preset",
              type: "media.preset",
              position: { x: 0, y: 0 },
              fields: { car_name: "1998 Jeep Wrangler Sport" },
            },
          ],
          edges: [],
        },
      }),
    ).toBe(false);
  });

  it("tracks saved-workflow signatures so switching tabs does not leave sticky false-dirty state behind", () => {
    const savedWorkflow = {
      schema_version: 1 as const,
      workflow_id: "workflow-saved",
      name: "Saved workflow",
      nodes: [{ id: "node-1", type: "prompt.text", position: { x: 0, y: 0 }, fields: {} }],
      edges: [],
    };
    const savedSignature = graphWorkflowSnapshotSignature(savedWorkflow);
    expect(
      graphWorkflowDirtyState({
        workflowId: "workflow-saved",
        workflowName: "Saved workflow",
        workflow: savedWorkflow,
        savedWorkflowSignature: savedSignature,
        dirtyFallback: true,
      }),
    ).toBe(false);
    expect(
      graphWorkflowDirtyState({
        workflowId: "workflow-saved",
        workflowName: "Saved workflow",
        workflow: { ...savedWorkflow, name: "Saved workflow changed" },
        savedWorkflowSignature: savedSignature,
        dirtyFallback: false,
      }),
    ).toBe(true);
  });

  it("does not treat a later run snapshot as the same workflow when execution metadata changed", () => {
    const saved = {
      schema_version: 1 as const,
      workflow_id: "workflow-saved",
      name: "Saved workflow",
      nodes: [
        {
          id: "recipe",
          type: "prompt.recipe",
          position: { x: 0, y: 0 },
          fields: {},
          metadata: { execution: { mode: "enabled" } },
        },
      ],
      edges: [],
      metadata: {
        groups: [{ id: "group-1", title: "Group 1", color: "default", node_ids: ["recipe"], bounds: { x: 0, y: 0, width: 200, height: 200 }, execution: { mode: "enabled" } }],
      },
    };
    const runSnapshot = {
      ...saved,
      nodes: [
        {
          ...saved.nodes[0],
          metadata: { execution: { mode: "frozen" } },
        },
      ],
      metadata: {
        groups: [{ id: "group-1", title: "Group 1", color: "default", node_ids: ["recipe"], bounds: { x: 0, y: 0, width: 200, height: 200 }, execution: { mode: "frozen" } }],
      },
    };

    expect(graphWorkflowSnapshotsMatch(saved, saved)).toBe(true);
    expect(graphWorkflowSnapshotsMatch(saved, runSnapshot)).toBe(false);
  });
});
