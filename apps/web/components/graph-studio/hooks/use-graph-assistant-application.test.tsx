// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useGraphAssistantApplication } from "./use-graph-assistant-application";
import type { GraphNodeDefinition, GraphWorkflowPayload } from "../types";
import type { GraphNodeHandlers } from "../utils/graph-serialization";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const base: GraphWorkflowPayload = { schema_version: 1, name: "A", nodes: [], edges: [], metadata: {} };
const definition: GraphNodeDefinition = { type: "prompt.recipe", title: "Recipe", category: "prompt", ports: { inputs: [], outputs: [] }, fields: [] };
const proposed: GraphWorkflowPayload = { ...base, nodes: [{ id: "recipe-A", type: "prompt.recipe", position: { x: 0, y: 0 }, fields: {} }] };
function fixture() {
  let resolve!: (value: GraphNodeDefinition[]) => void;
  const refresh = new Promise<GraphNodeDefinition[]>(done => { resolve = done; });
  const workspace = { current: 1 }; const tab = { current: "A" as string | null };
  const snapshot = { current: { workflow: base, workflowId: null, workflowName: "A", workflowUpdatedAt: null } };
  const canvas = { setNodes: vi.fn(), setEdges: vi.fn(), setGroups: vi.fn() };
  const apply = vi.fn(() => { workspace.current += 1; });
  const appendConsole = vi.fn(); const layout = vi.fn();
  const hook = renderHook(() => useGraphAssistantApplication({
    applyAssistantWorkflow: apply, reloadNodeDefinitions: vi.fn(() => refresh), appendConsole,
    beginAssistantLayout: layout, nodeHandlers: {} as GraphNodeHandlers, ...canvas,
    activeTabIdRef: tab, workspaceRestoreVersionRef: workspace, currentHistorySnapshotRef: snapshot,
  }));
  return { ...hook, resolve, workspace, tab, snapshot, canvas, apply, appendConsole, layout };
}

it.each(["switch", "return", "edit"])("preserves the current canvas after a definition refresh followed by %s", async (change) => {
  const f = fixture(); let applying!: Promise<void>;
  act(() => { applying = f.result.current(proposed); });
  const outcome = applying.then(() => null, error => error);
  if (change === "edit") f.snapshot.current = { ...f.snapshot.current, workflow: { ...base, name: "Edited A" } };
  else { f.workspace.current += 1; f.tab.current = change === "return" ? "A" : "B"; }
  await act(async () => { f.resolve([definition]); await outcome; });
  expect(await outcome).toBeInstanceOf(Error);
  expect(f.apply).not.toHaveBeenCalled(); expect(f.layout).not.toHaveBeenCalled();
  expect(f.canvas.setNodes).not.toHaveBeenCalled(); expect(f.appendConsole).not.toHaveBeenCalled();
});

it("does not overwrite another canvas in deferred animation frames after the owned application", async () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
  const f = fixture(); let applying!: Promise<void>;
  act(() => { applying = f.result.current(proposed); });
  await act(async () => { f.resolve([definition]); await applying; });
  expect(f.apply).toHaveBeenCalledOnce(); expect(f.canvas.setNodes).toHaveBeenCalledOnce();
  expect(f.canvas.setNodes.mock.calls[0][0]).toEqual([expect.objectContaining({ id: "recipe-A" })]);
  Object.values(f.canvas).forEach(mock => mock.mockClear()); f.layout.mockClear();
  f.workspace.current += 1; f.tab.current = "B";
  act(() => { while (frames.length) frames.shift()!(0); });
  expect(f.canvas.setNodes).not.toHaveBeenCalled(); expect(f.canvas.setEdges).not.toHaveBeenCalled();
  expect(f.canvas.setGroups).not.toHaveBeenCalled(); expect(f.layout).not.toHaveBeenCalled();
});
