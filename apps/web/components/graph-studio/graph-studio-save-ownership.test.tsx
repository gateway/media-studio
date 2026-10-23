// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { GraphStudio } from "./graph-studio";
import type { GraphCanvas } from "./graph-canvas";
import type { GraphConsole } from "./graph-console";
import type { GraphToolbar } from "./graph-toolbar";
import type { GraphNodeDefinition, GraphWorkflowPayload } from "./types";
import { __resetGraphStartupReadsForTests } from "./utils/graph-startup-reads";
import {
  graphWorkflowSnapshotSignature,
  readGraphTabSession,
  writeGraphTabSession,
} from "./utils/graph-tabs";


// Keep the real save, tab, hydration and version coordination; replace visual surfaces only.
vi.mock("./graph-canvas", () => ({
  GraphCanvas: ({ nodes }: ComponentProps<typeof GraphCanvas>) => (
    <>
      <output data-testid="canvas">{nodes.map((node) => node.id).join(",")}</output>
      <button onClick={() => nodes[0]?.data.onFieldChange(nodes[0].id, "text", "Edited note")}>Edit node</button>
    </>
  ),
}));
vi.mock("./graph-toolbar", () => ({
  GraphToolbar: ({ workflowName, tabs, activeTabId, onSave, onSaveAs, onSwitchTab, onCloseTab, onRenameDraftChange, onCommitRename, onRun }: ComponentProps<typeof GraphToolbar>) => (
    <>
      <output data-testid="identity">{JSON.stringify({ workflowName, activeTabId })}</output>
      <button onClick={onSave}>Save</button>
      <button onClick={() => onRun()}>Run</button>
      <button onClick={onSaveAs}>Save As</button>
      <button onClick={() => onRenameDraftChange("Renamed A")}>Set rename</button>
      <button onClick={onCommitRename}>Commit rename</button>
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
vi.mock("./graph-studio-dialogs", () => ({ GraphStudioDialogs: () => null }));
vi.mock("./graph-preview-overlay", () => ({ GraphPreviewOverlay: () => null }));
vi.mock("./graph-pricing-confirmation", () => ({ GraphPricingConfirmation: () => null }));

const definition: GraphNodeDefinition = {
  type: "utility.note", title: "Note", category: "Utility", fields: [], ports: { inputs: [], outputs: [] },
};
function workflow(id: string | null, name: string, nodeId: string): GraphWorkflowPayload {
  return { schema_version: 1, workflow_id: id, name, nodes: [{ id: nodeId, type: definition.type, position: { x: 10, y: 20 }, fields: { text: nodeId } }], edges: [], metadata: { created_by: "graph-studio", groups: [] } };
}
const requests: { url: string; method: string; payload: GraphWorkflowPayload; resolve: (value: Response) => void }[] = [];
const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
  if (url.endsWith("/validate")) return Response.json({ valid: false, errors: [{ code: "missing_required_input", message: "Blocked by test" }], warnings: [] });
  if (url.includes("/graph/workflows") && init?.method) return new Promise<Response>((resolve) => requests.push({ url, method: init.method!, payload: JSON.parse(String(init.body)) as GraphWorkflowPayload, resolve }));
  if (url === "/api/control/health") return Response.json({ install_id: "save-owner-test" });
  if (url === "/api/control/media/graph/node-definitions") return Response.json({ items: [definition] });
  return Response.json({ items: [], available_credits: 0 });
});
function session() { return readGraphTabSession("save-owner-test")!; }
function identity() { return JSON.parse(screen.getByTestId("identity").textContent!) as { workflowName: string; activeTabId: string }; }
async function ready() {
  render(<GraphStudio />);
  await waitFor(() => expect(screen.getByTestId("canvas").textContent).toBe("node-a"));
}
async function settle(index: number, id = "saved-a", name = "A", stamp = "2026-10-23T01:00:00Z") {
  await act(async () => { requests[index].resolve(Response.json({ workflow_id: id, name, updated_at: stamp, workflow_json: { ...requests[index].payload, workflow_id: id, name } })); });
}
beforeEach(() => {
  requests.length = 0;
  window.localStorage.clear();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
  vi.stubGlobal("ResizeObserver", vi.fn(() => ({ observe: vi.fn(), disconnect: vi.fn() })));
  vi.stubGlobal("fetch", fetcher);
  fetcher.mockClear();
  writeGraphTabSession("save-owner-test", "a", [
    { tab_id: "a", workflow_id: "saved-a", workflow_name: "A", workflow_json: workflow("saved-a", "A", "node-a"), saved_workflow_signature: null, dirty: true, workflow_updated_at: "a-before" },
    { tab_id: "b", workflow_id: null, workflow_name: "B", workflow_json: workflow(null, "B", "node-b"), saved_workflow_signature: null, dirty: true, workflow_updated_at: null },
  ]);
});
afterEach(() => { cleanup(); __resetGraphStartupReadsForTests(); vi.unstubAllGlobals(); window.localStorage.clear(); });

it.each(["Save", "Save As", "Commit rename"])("keeps delayed %s completion with A after switching to B", async (action) => {
  await ready();
  if (action === "Commit rename") fireEvent.click(screen.getByRole("button", { name: "Set rename", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: action, exact: true }));
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0].method).toBe(action === "Save As" ? "POST" : "PATCH");
  fireEvent.click(screen.getByRole("button", { name: "Switch b", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "Edit node", exact: true }));
  const before = identity();
  const savedId = action === "Save As" ? "copy-a" : "saved-a";
  const savedName = action === "Commit rename" ? "Renamed A" : action === "Save As" ? "A Copy" : "A";
  await settle(0, savedId, savedName);
  expect(identity()).toEqual(before);
  expect(screen.getByTestId("canvas").textContent).toBe("node-b");
  const source = session().tabs.find((tab) => tab.tab_id === "a")!;
  expect(source.workflow_id).toBe(savedId);
  expect(source.saved_workflow_signature).toBe(graphWorkflowSnapshotSignature({ ...requests[0].payload, workflow_id: savedId, name: savedName }));
  expect(source.dirty).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Save", exact: true }));
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(requests[1]).toMatchObject({ url: "/api/control/media/graph/workflows", method: "POST", payload: { workflow_id: null, name: "B", nodes: [{ id: "node-b", fields: { text: "Edited note" } }] } });
  await settle(1, "saved-b", "B");
});


it("binds a delayed first POST to the inactive source without converting B into that record", async () => {
  const initial = session();
  const source = initial.tabs.find((tab) => tab.tab_id === "a")!;
  source.workflow_id = null;
  source.workflow_json!.workflow_id = null;
  writeGraphTabSession("save-owner-test", "a", initial.tabs);
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Save", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "Switch b", exact: true }));
  const before = identity();
  await settle(0, "created-a", "A");
  expect(identity()).toEqual(before);
  expect(session().tabs.find((tab) => tab.tab_id === "a")?.workflow_id).toBe("created-a");
  expect(session().tabs.find((tab) => tab.tab_id === "b")?.workflow_id).toBeNull();
});

it.each(["active", "inactive", "return"])("keeps edits made during save when the source is %s", async (position) => {
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Save", exact: true }));
  if (position === "return") {
    fireEvent.click(screen.getByRole("button", { name: "Switch b", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Switch a", exact: true }));
  }
  fireEvent.click(screen.getByRole("button", { name: "Edit node", exact: true }));
  if (position === "inactive") fireEvent.click(screen.getByRole("button", { name: "Switch b", exact: true }));
  await settle(0);
  const source = session().tabs.find((tab) => tab.tab_id === "a")!;
  expect(source.workflow_json?.nodes[0].fields.text).toBe("Edited note");
  expect(source.dirty).toBe(true);
  expect(source.saved_workflow_signature).toBe(graphWorkflowSnapshotSignature(requests[0].payload));
  if (position === "inactive") fireEvent.click(screen.getByRole("button", { name: "Switch a", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "Save", exact: true }));
  expect(requests[1]).toMatchObject({ method: "PATCH", url: "/api/control/media/graph/workflows/saved-a", payload: { nodes: [{ id: "node-a", fields: { text: "Edited note" } }] } });
  await settle(1);
});

it("ignores completion for a closed source tab", async () => {
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Save As", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "Close a", exact: true }));
  const before = identity();
  await settle(0, "copy-a", "A Copy");
  expect(identity()).toEqual(before);
  expect(session().tabs.map((tab) => tab.tab_id)).toEqual(["b"]);
  expect(session().tabs[0].workflow_id).toBeNull();
});

it("does not roll back the latest Save As identity or baseline when responses arrive out of order", async () => {
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Save As", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "Edit node", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "Save As", exact: true }));
  await settle(1, "latest-copy", "A Copy", "2026-10-23T02:00:00Z");
  const source = session().tabs.find((tab) => tab.tab_id === "a")!;
  await settle(0, "older-copy", "A Copy", "2026-10-23T01:00:00Z");
  const after = session().tabs.find((tab) => tab.tab_id === "a")!;
  expect(after.workflow_id).toBe("latest-copy");
  expect(after.workflow_json).toEqual(source.workflow_json);
  expect(after.saved_workflow_signature).toBe(source.saved_workflow_signature);
  expect(after.workflow_updated_at).toBe(source.workflow_updated_at);
  fireEvent.click(screen.getByRole("button", { name: "Save", exact: true }));
  expect(requests[2].url).toBe("/api/control/media/graph/workflows/latest-copy");
  await settle(2, "latest-copy", "A Copy");
});

it("allows independent pending saves in two tabs", async () => {
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Save", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "Switch b", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "Save", exact: true }));
  await settle(1, "saved-b", "B");
  const before = identity();
  await settle(0);
  expect(identity()).toEqual(before);
  expect(session().tabs.find((tab) => tab.tab_id === "a")?.workflow_id).toBe("saved-a");
  expect(session().tabs.find((tab) => tab.tab_id === "b")?.workflow_id).toBe("saved-b");
});

it("keeps an ordinary unchanged save clean with the returned timestamp", async () => {
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Save", exact: true }));
  await settle(0);
  const source = session().tabs.find((tab) => tab.tab_id === "a")!;
  expect(source.dirty).toBe(false);
  expect(source.workflow_updated_at).toBe("2026-10-23T01:00:00Z");
  expect(source.workflow_json?.nodes[0].id).toBe("node-a");
});

it("binds the existing Run auto-save before blocked validation so the next Save updates that record", async () => {
  const initial = session();
  const source = initial.tabs.find((tab) => tab.tab_id === "a")!;
  source.workflow_id = null;
  source.workflow_json!.workflow_id = null;
  writeGraphTabSession("save-owner-test", "a", initial.tabs);
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Run", exact: true }));
  await settle(0, "run-saved-a", "A");
  await waitFor(() => expect(screen.getByTestId("console").textContent).toContain("Run blocked before spending credits"));
  expect(session().tabs.find((tab) => tab.tab_id === "a")?.workflow_id).toBe("run-saved-a");
  expect(fetcher.mock.calls.some(([url]) => url.endsWith("/runs"))).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Save", exact: true }));
  expect(requests[1]).toMatchObject({ method: "PATCH", url: "/api/control/media/graph/workflows/run-saved-a" });
  await settle(1, "run-saved-a", "A");
});
