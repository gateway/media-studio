// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { GraphStudio } from "./graph-studio";
import type { GraphCanvas } from "./graph-canvas";
import type { GraphConsole } from "./graph-console";
import type { GraphToolbar } from "./graph-toolbar";
import type { GraphNodeDefinition, GraphWorkflowPayload, GraphWorkflowRecord } from "./types";
import { __resetGraphStartupReadsForTests } from "./utils/graph-startup-reads";
import {
  graphWorkflowSnapshotSignature,
  readGraphTabSession,
  writeGraphTabSession,
} from "./utils/graph-tabs";

// Keep the real restore, tab, hydration and version coordination; replace visual surfaces only.
vi.mock("./graph-canvas", () => ({
  GraphCanvas: ({ nodes }: ComponentProps<typeof GraphCanvas>) => (
    <output data-testid="canvas">{nodes.map((node) => node.id).join(",")}</output>
  ),
}));
vi.mock("./graph-toolbar", () => ({
  GraphToolbar: ({ workflowName, onNewTab }: ComponentProps<typeof GraphToolbar>) => (
    <>
      <h1>{workflowName}</h1>
      <button onClick={onNewTab}>New tab</button>
    </>
  ),
}));
vi.mock("./graph-console", () => ({
  GraphConsole: ({ lines }: ComponentProps<typeof GraphConsole>) => <output data-testid="console">{lines.join("\n")}</output>,
}));
vi.mock("./graph-left-rail", () => ({ GraphLeftRail: () => null }));
vi.mock("./graph-studio-dialogs", () => ({ GraphStudioDialogs: () => null }));
vi.mock("./graph-preview-overlay", () => ({ GraphPreviewOverlay: () => null }));
vi.mock("./graph-pricing-confirmation", () => ({ GraphPricingConfirmation: () => null }));

const definition: GraphNodeDefinition = {
  type: "utility.note", title: "Note", category: "Utility", fields: [],
  ports: { inputs: [], outputs: [] },
};
const localWorkflow: GraphWorkflowPayload = {
  schema_version: 1, workflow_id: "saved-a", name: "Local snapshot",
  nodes: [{ id: "local-node", type: definition.type, position: { x: 10, y: 20 }, fields: {} }],
  edges: [],
};
const savedRecord: GraphWorkflowRecord = {
  workflow_id: "saved-a", name: "Saved record", updated_at: "2026-10-18T01:00:00Z",
  workflow_json: { ...localWorkflow, nodes: [{ ...localWorkflow.nodes[0], id: "saved-node" }] },
};
const recordUrl = "/api/control/media/graph/workflows/saved-a";
const reloadRecord = vi.fn<() => Promise<Response>>();
const fetcher = vi.fn(async (url: string) => {
  if (url === recordUrl) return reloadRecord();
  if (url === "/api/control/health") return Response.json({ install_id: "restore-test" });
  if (url === "/api/control/media/graph/node-definitions") return Response.json({ items: [definition] });
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
  expect(tab?.saved_workflow_signature).toBe(graphWorkflowSnapshotSignature({
    ...savedRecord.workflow_json, workflow_id: savedRecord.workflow_id, name: savedRecord.name,
  }));
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
