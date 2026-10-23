// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { GraphStudio } from "./graph-studio";
import type { GraphCanvas } from "./graph-canvas";
import type { GraphConsole } from "./graph-console";
import type { GraphStudioDialogs } from "./graph-studio-dialogs";
import type { GraphToolbar } from "./graph-toolbar";
import type { GraphNodeDefinition, GraphRun, GraphWorkflowPayload, GraphWorkflowRecord } from "./types";
import { __resetGraphStartupReadsForTests } from "./utils/graph-startup-reads";
import {
  graphWorkflowSnapshotSignature,
  readGraphTabSession,
  writeGraphTabSession,
} from "./utils/graph-tabs";

let loadSavedWorkflow: ComponentProps<typeof GraphStudioDialogs>["onLoadWorkflow"];
let restoreHistoryRun: ComponentProps<typeof GraphStudioDialogs>["onRestoreRun"];

// Keep the real restore, tab, hydration and version coordination; replace visual surfaces only.
vi.mock("./graph-canvas", () => ({
  GraphCanvas: ({ nodes, edges, groups = [] }: ComponentProps<typeof GraphCanvas>) => (
    <>
      <output data-testid="canvas">{nodes.map((node) => node.id).join(",")}</output>
      <output data-testid="canvas-state">{JSON.stringify({ nodes: nodes.map((node) => ({ id: node.id, fields: node.data.fields })), edges: edges.map(({ id, source, target }) => ({ id, source, target })), groups: groups.map(({ id, node_ids }) => ({ id, node_ids })) })}</output>
      <button onClick={() => nodes[0]?.data.onFieldChange(nodes[0].id, "text", "Edited note")}>Edit node</button>
    </>
  ),
}));
vi.mock("./graph-toolbar", () => ({
  GraphToolbar: ({ workflowName, activeTabId, tabs, run, onNewTab, onSwitchTab, onCloseTab, onUndo, canUndo }: ComponentProps<typeof GraphToolbar>) => (
    <>
      <h1>{workflowName}</h1>
      <output data-testid="identity">{JSON.stringify({ activeTabId, workflowName, runId: run?.run_id ?? null })}</output>
      <button onClick={onNewTab}>New tab</button>
      <button onClick={onUndo} disabled={!canUndo}>Undo</button>
      {tabs?.map((tab) => <span key={tab.tab_id}>
        <button onClick={() => onSwitchTab?.(tab.tab_id)}>Switch {tab.tab_id}</button>
        <button onClick={() => onCloseTab?.(tab.tab_id)}>Close {tab.tab_id}</button>
      </span>)}
    </>
  ),
}));
vi.mock("./graph-console", () => ({
  GraphConsole: ({ lines }: ComponentProps<typeof GraphConsole>) => <output data-testid="console">{lines.join("\n")}</output>,
}));
vi.mock("./graph-left-rail", () => ({ GraphLeftRail: () => null }));
vi.mock("./graph-studio-dialogs", () => ({
  GraphStudioDialogs: ({ onLoadWorkflow, onRestoreRun }: ComponentProps<typeof GraphStudioDialogs>) => {
    loadSavedWorkflow = onLoadWorkflow;
    restoreHistoryRun = onRestoreRun;
    return null;
  },
}));
vi.mock("./graph-preview-overlay", () => ({ GraphPreviewOverlay: () => null }));
vi.mock("./graph-pricing-confirmation", () => ({ GraphPricingConfirmation: () => null }));

const definition: GraphNodeDefinition = {
  type: "utility.note", title: "Note", category: "Utility", fields: [],
  ports: { inputs: [], outputs: [] },
};
const historyDefinitions: GraphNodeDefinition[] = [
  { type: "prompt.text", title: "Text", category: "Prompt", fields: [{ id: "text", label: "Text", type: "textarea" }], ports: { inputs: [], outputs: [{ id: "text", label: "Text", type: "text" }] } },
  { type: "display.any", title: "Display", category: "Preview", fields: [], ports: { inputs: [{ id: "value", label: "Value", type: "any" }], outputs: [] } },
];
const localWorkflow: GraphWorkflowPayload = {
  schema_version: 1, workflow_id: "saved-a", name: "Local snapshot",
  nodes: [{ id: "local-node", type: definition.type, position: { x: 10, y: 20 }, fields: {} }],
  edges: [],
};
const savedRecord = {
  workflow_id: "saved-a", name: "Saved record", updated_at: "2026-10-18T01:00:00Z",
  workflow_json: { ...localWorkflow, nodes: [{ ...localWorkflow.nodes[0], id: "saved-node" }] },
} satisfies GraphWorkflowRecord;
const recordUrl = "/api/control/media/graph/workflows/saved-a";
const reloadRecord = vi.fn<() => Promise<Response>>();
const historyRequests: { runId: string; resolve: (response: Response) => void }[] = [];
const fetcher = vi.fn(async (url: string) => {
  if (/\/graph\/runs\/history-[^/]+$/.test(url)) return new Promise<Response>((resolve) => historyRequests.push({ runId: url.split("/").at(-1)!, resolve }));
  if (url === recordUrl) return reloadRecord();
  if (url === "/api/control/health") return Response.json({ install_id: "restore-test" });
  if (url === "/api/control/media/graph/node-definitions") return Response.json({ items: [definition, ...historyDefinitions] });
  return Response.json({ items: [], available_credits: 0 });
});

function storeSnapshot(workflow: GraphWorkflowPayload | null = localWorkflow) {
  writeGraphTabSession("restore-test", "tab-a", [{
    tab_id: "tab-a", workflow_id: "saved-a", workflow_name: "Local snapshot",
    workflow_json: workflow, saved_workflow_signature: graphWorkflowSnapshotSignature(workflow),
    workflow_updated_at: "2026-10-17T01:00:00Z", dirty: false,
    console_lines: ["Local console"],
  }]);
}

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
  vi.stubGlobal("ResizeObserver", vi.fn(() => ({ observe: vi.fn(), disconnect: vi.fn() })));
  vi.stubGlobal("fetch", fetcher);
  fetcher.mockClear();
  historyRequests.length = 0;
  reloadRecord.mockReset();
  reloadRecord.mockResolvedValue(Response.json(savedRecord));
  storeSnapshot();
});

afterEach(() => {
  cleanup();
  __resetGraphStartupReadsForTests();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

it("reloads a saved record and updates its name, timestamp and saved signature", async () => {
  render(<GraphStudio />);
  await waitFor(() => expect(screen.getByTestId("canvas").textContent).toBe("saved-node"));
  expect(screen.getByRole("heading").textContent).toBe("Saved record");
  const tab = readGraphTabSession("restore-test")?.tabs[0];
  expect(tab?.workflow_id).toBe(savedRecord.workflow_id);
  expect(tab?.workflow_updated_at).toBe(savedRecord.updated_at);
  expect(tab?.saved_workflow_signature).toBe(graphWorkflowSnapshotSignature(tab?.workflow_json));
  expect(screen.getByTestId("console").textContent).toBe("Local console");
  expect(reloadRecord).toHaveBeenCalledTimes(1);
});

it.each(["missing record", "missing workflow JSON", "network failure"])(
  "silently restores the tab snapshot after %s",
  async (failure) => {
    if (failure === "missing record") reloadRecord.mockResolvedValue(Response.json({}, { status: 404 }));
    if (failure === "missing workflow JSON") reloadRecord.mockResolvedValue(Response.json({ workflow_id: "saved-a" }));
    if (failure === "network failure") reloadRecord.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<GraphStudio />);
    await waitFor(() => expect(screen.getByTestId("canvas").textContent).toBe("local-node"));
    expect(screen.getByRole("heading").textContent).toBe("Local snapshot");
    expect(screen.getByTestId("console").textContent).toBe("Local console");
    expect(readGraphTabSession("restore-test")?.tabs[0].workflow_updated_at).toBe("2026-10-17T01:00:00Z");
    expect(reloadRecord).toHaveBeenCalledTimes(1);
  },
);

it.each(["success", "failure"])("ignores a stale saved-record reload after %s", async (outcome) => {
  let settle!: (response: Response) => void;
  let reject!: (error: Error) => void;
  reloadRecord.mockImplementation(() => new Promise<Response>((resolve, fail) => { settle = resolve; reject = fail; }));
  render(<GraphStudio />);
  await waitFor(() => expect(reloadRecord).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "New tab" }));
  const tabsBeforeReply = readGraphTabSession("restore-test")?.tabs;
  await act(async () => {
    if (outcome === "success") settle(Response.json(savedRecord));
    else reject(new TypeError("Failed to fetch"));
  });
  expect(screen.getByRole("heading").textContent).toBe("New workflow");
  expect(screen.getByTestId("canvas").textContent).toBe("");
  expect(screen.getByTestId("console").textContent).toBe("Graph Studio ready.");
  expect(readGraphTabSession("restore-test")?.tabs).toEqual(tabsBeforeReply);
});

it("restores an empty saved workflow without trying the latest-run fallback", async () => {
  reloadRecord.mockResolvedValue(Response.json({ ...savedRecord, workflow_json: { ...localWorkflow, nodes: [] } }));
  render(<GraphStudio />);
  await waitFor(() => expect(screen.getByRole("heading").textContent).toBe("Saved record"));
  expect(screen.getByTestId("canvas").textContent).toBe("");
  expect(screen.getByTestId("console").textContent).toBe("Local console");
  expect(fetcher.mock.calls.some(([url]) => url.includes("/runs"))).toBe(false);
});

it("preserves an empty dirty draft with its saved baseline through restore", async () => {
  const tab = readGraphTabSession("restore-test")!.tabs[0];
  writeGraphTabSession("restore-test", tab.tab_id, [{
    ...tab, workflow_json: { ...localWorkflow, nodes: [] }, dirty: true,
  }]);

  render(<GraphStudio />);
  await waitFor(() => expect(screen.getByRole("heading").textContent).toBe("Local snapshot"));
  expect(screen.getByTestId("canvas").textContent).toBe("");
  const restored = readGraphTabSession("restore-test")!.tabs[0];
  expect(restored.workflow_json?.nodes).toEqual([]);
  expect(restored.dirty).toBe(true);
  expect(restored.saved_workflow_signature).toBe(tab.saved_workflow_signature);
  expect(reloadRecord).not.toHaveBeenCalled();
  expect(fetcher.mock.calls.some(([url]) => url.includes("/runs"))).toBe(false);
});

it("keeps an empty tab snapshot when the record reload fails", async () => {
  storeSnapshot({ ...localWorkflow, nodes: [] });
  reloadRecord.mockRejectedValue(new TypeError("Failed to fetch"));
  render(<GraphStudio />);
  await waitFor(() => expect(screen.getByRole("heading").textContent).toBe("Local snapshot"));
  expect(screen.getByTestId("canvas").textContent).toBe("");
  expect(screen.getByTestId("console").textContent).toBe("Local console");
  expect(fetcher.mock.calls.some(([url]) => url.includes("/runs"))).toBe(false);
});

it("tries latest-run and blank fallbacks when neither the record nor a tab workflow is available", async () => {
  storeSnapshot(null);
  reloadRecord.mockResolvedValue(Response.json({}, { status: 404 }));
  render(<GraphStudio />);
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => url.includes("/runs"))).toBe(true));
  expect(screen.getByRole("heading").textContent).toBe("New workflow");
  expect(screen.getByTestId("canvas").textContent).toBe("");
  expect(screen.getByTestId("console").textContent).toBe("Graph Studio ready.");
});


it.each([false, true])("keeps restored saved tabs clean unless edited (edited=%s)", async (edited) => {
  render(<GraphStudio />);
  await waitFor(() => expect(screen.getByTestId("canvas").textContent).toBe("saved-node"));
  if (edited) fireEvent.click(screen.getByRole("button", { name: "Edit node" }));
  fireEvent.click(screen.getByRole("button", { name: "New tab" }));
  const savedTab = readGraphTabSession("restore-test")?.tabs.find((tab) => tab.workflow_id === "saved-a");
  expect(savedTab?.dirty).toBe(edited);
  if (edited) expect(savedTab?.workflow_json?.nodes[0].fields.text).toBe("Edited note");
});


it("keeps a saved workflow opened from the browser clean when switching tabs", async () => {
  render(<GraphStudio />);
  await waitFor(() => expect(screen.getByTestId("canvas").textContent).toBe("saved-node"));
  fireEvent.click(screen.getByRole("button", { name: "New tab" }));
  await act(async () => { await loadSavedWorkflow(savedRecord); });
  await waitFor(() => expect(screen.getByTestId("canvas").textContent).toBe("saved-node"));
  fireEvent.click(screen.getByRole("button", { name: "New tab" }));
  const savedTab = readGraphTabSession("restore-test")?.tabs.find((tab) => tab.workflow_id === "saved-a");
  expect(savedTab?.dirty).toBe(false);
});

it("keeps a reloaded empty saved workflow clean", async () => {
  reloadRecord.mockResolvedValue(Response.json({
    ...savedRecord, workflow_json: { ...savedRecord.workflow_json, nodes: [] },
  }));
  render(<GraphStudio />);
  await waitFor(() => expect(screen.getByRole("heading").textContent).toBe("Saved record"));
  fireEvent.click(screen.getByRole("button", { name: "New tab" }));
  expect(readGraphTabSession("restore-test")?.tabs.find((tab) => tab.workflow_id === "saved-a")?.dirty).toBe(false);
});


it("does not accept a partially hydrated saved graph as clean", async () => {
  reloadRecord.mockResolvedValue(Response.json({
    ...savedRecord, workflow_json: {
      ...savedRecord.workflow_json,
      nodes: [...savedRecord.workflow_json.nodes, { id: "missing-node", type: "unavailable.node", position: { x: 0, y: 0 }, fields: {} }],
    },
  }));
  render(<GraphStudio />);
  await waitFor(() => expect(screen.getByTestId("canvas").textContent).toBe("saved-node"));
  fireEvent.click(screen.getByRole("button", { name: "New tab" }));
  expect(readGraphTabSession("restore-test")?.tabs.find((tab) => tab.workflow_id === "saved-a")?.dirty).toBe(true);
});

const historicalRun: GraphRun = {
  run_id: "history-a", workflow_id: "saved-a", status: "completed",
  workflow_json: {
    schema_version: 1, workflow_id: "saved-a", name: "Historical A",
    nodes: [
      { id: "history-text", type: "prompt.text", position: { x: 100, y: 100 }, fields: { text: "Historical text" } },
      { id: "history-result", type: "display.any", position: { x: 600, y: 100 }, fields: {} },
    ],
    edges: [{ id: "history-edge", source: "history-text", source_port: "text", target: "history-result", target_port: "value" }],
    metadata: { groups: [{ id: "history-group", title: "History group", color: "default", node_ids: ["history-text", "history-result"], bounds: { x: 0, y: 0, width: 1000, height: 600 } }] },
  },
};

function draftState() {
  const session = readGraphTabSession("restore-test")!;
  return { active: session.active_tab_id, tabs: session.tabs.map(({ updated_at: _timestamp, ...tab }) => tab) };
}

async function readyForHistory() {
  const source = readGraphTabSession("restore-test")!.tabs[0];
  writeGraphTabSession("restore-test", "tab-a", [source, {
    tab_id: "tab-b", workflow_id: null, workflow_name: "Draft B", dirty: true,
    workflow_json: { ...localWorkflow, workflow_id: null, name: "Draft B", nodes: [{ ...localWorkflow.nodes[0], id: "node-b", fields: { text: "Keep B" } }] },
    console_lines: ["B console"],
  }]);
  render(<GraphStudio />);
  await waitFor(() => expect(screen.getByTestId("canvas").textContent).toBe("saved-node"));
}

function beginHistoryRestore(runId = "history-a") {
  const completion = Promise.resolve(restoreHistoryRun({ run_id: runId, workflow_id: "saved-a", status: "completed" }));
  expect(historyRequests.at(-1)?.runId).toBe(runId);
  return completion;
}

it.each(["switch to B", "close source", "new tab", "away and back"])("ignores a late history restore after %s", async (change) => {
  await readyForHistory();
  const completion = beginHistoryRestore();
  if (change === "new tab") fireEvent.click(screen.getByRole("button", { name: "New tab", exact: true }));
  else if (change === "close source") fireEvent.click(screen.getByRole("button", { name: "Close tab-a", exact: true }));
  else {
    fireEvent.click(screen.getByRole("button", { name: "Switch tab-b", exact: true }));
    if (change === "away and back") fireEvent.click(screen.getByRole("button", { name: "Switch tab-a", exact: true }));
  }
  const before = { identity: screen.getByTestId("identity").textContent, canvas: screen.getByTestId("canvas-state").textContent, drafts: draftState(), console: screen.getByTestId("console").textContent };
  await act(async () => { historyRequests[0].resolve(Response.json(historicalRun)); await completion; });
  expect(screen.getByTestId("identity").textContent).toBe(before.identity);
  expect(screen.getByTestId("canvas-state").textContent).toBe(before.canvas);
  expect(draftState()).toEqual(before.drafts);
  expect(screen.getByTestId("console").textContent).toBe(before.console);
});

it("keeps intervening same-tab edits and their undo history instead of restoring an obsolete snapshot", async () => {
  await readyForHistory();
  const completion = beginHistoryRestore();
  fireEvent.click(screen.getByRole("button", { name: "Edit node", exact: true }));
  const before = draftState();
  await act(async () => { historyRequests[0].resolve(Response.json(historicalRun)); await completion; });
  expect(screen.getByTestId("canvas").textContent).toBe("saved-node");
  expect(draftState()).toEqual(before);
  expect(before.tabs.find((tab) => tab.tab_id === "tab-a")?.workflow_json?.nodes[0].fields.text).toBe("Edited note");
  fireEvent.click(screen.getByRole("button", { name: "Undo", exact: true }));
  expect(screen.getByTestId("canvas").textContent).toBe("saved-node");
  expect(readGraphTabSession("restore-test")!.tabs[0].workflow_json?.nodes[0].fields.text).not.toBe("Edited note");
});

it("keeps a newer history restore when an older reply arrives afterward", async () => {
  await readyForHistory();
  const older = beginHistoryRestore();
  const newer = beginHistoryRestore("history-newer");
  await act(async () => { historyRequests[1].resolve(Response.json({ ...historicalRun, run_id: "history-newer", workflow_json: { ...historicalRun.workflow_json, name: "Newer history" } })); await newer; });
  const before = draftState();
  await act(async () => { historyRequests[0].resolve(Response.json(historicalRun)); await older; });
  expect(screen.getByRole("heading").textContent).toBe("Newer history");
  expect(draftState()).toEqual(before);
  expect(screen.getByTestId("console").textContent).not.toContain("Restored graph run history-a.");
});

it("restores the same owner's historical nodes, edges, groups, run and console, with normal undo", async () => {
  await readyForHistory();
  const completion = beginHistoryRestore();
  await act(async () => { historyRequests[0].resolve(Response.json(historicalRun)); await completion; });
  expect(JSON.parse(screen.getByTestId("identity").textContent!)).toEqual({ activeTabId: "tab-a", workflowName: "Historical A", runId: "history-a" });
  expect(JSON.parse(screen.getByTestId("canvas-state").textContent!)).toMatchObject({ nodes: [{ id: "history-text" }, { id: "history-result" }], edges: [{ id: "history-edge", source: "history-text", target: "history-result" }], groups: [{ id: "history-group", node_ids: ["history-text", "history-result"] }] });
  const source = readGraphTabSession("restore-test")!.tabs.find((tab) => tab.tab_id === "tab-a")!;
  expect(source).toMatchObject({ workflow_id: "saved-a", workflow_name: "Historical A", run_id: "history-a" });
  expect(source.workflow_json?.edges).toEqual(historicalRun.workflow_json?.edges);
  expect(source.workflow_json?.metadata?.groups).toMatchObject([{ id: "history-group", node_ids: ["history-text", "history-result"] }]);
  expect(source.console_lines).toContain("Restored graph run history-a.");
  fireEvent.click(screen.getByRole("button", { name: "Undo", exact: true }));
  expect(screen.getByTestId("canvas").textContent).toBe("saved-node");
});

it.each([false, true])("reports a failed history read only while its source still owns the workspace (stale=%s)", async (stale) => {
  await readyForHistory();
  const completion = beginHistoryRestore();
  if (stale) fireEvent.click(screen.getByRole("button", { name: "Switch tab-b", exact: true }));
  const before = { drafts: draftState(), canvas: screen.getByTestId("canvas-state").textContent, console: screen.getByTestId("console").textContent };
  await act(async () => { historyRequests[0].resolve(Response.json({ detail: "History unavailable" }, { status: 503 })); await completion; });
  expect(screen.getByTestId("canvas-state").textContent).toBe(before.canvas);
  if (stale) {
    expect(draftState()).toEqual(before.drafts);
    expect(screen.getByTestId("console").textContent).toBe(before.console);
  } else {
    expect(screen.getByTestId("console").textContent).toContain("Run history-a could not be restored:");
    expect(readGraphTabSession("restore-test")!.tabs[0].workflow_json).toEqual(before.drafts.tabs[0].workflow_json);
  }
});
