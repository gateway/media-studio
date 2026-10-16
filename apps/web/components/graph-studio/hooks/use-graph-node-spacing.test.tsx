// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { StrictMode, useState } from "react";
import { describe, expect, it } from "vitest";
import type { StudioNode } from "../types";
import { useGraphNodeSpacing } from "./use-graph-node-spacing";

function node(id: string, x: number, y: number, height = 200): StudioNode {
  return { id, position: { x, y }, measured: { width: 420, height }, data: {} } as StudioNode;
}
function mount(initial: StudioNode[]) {
  return renderHook(() => {
    const [nodes, setNodes] = useState(initial);
    useGraphNodeSpacing(nodes, setNodes);
    return { nodes, setNodes };
  }, { wrapper: StrictMode });
}
function expectClear(nodes: StudioNode[]) {
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const a = nodes[i], b = nodes[j];
    expect(a.position.x + a.measured!.width! <= b.position.x || b.position.x + b.measured!.width! <= a.position.x
      || a.position.y + a.measured!.height! <= b.position.y || b.position.y + b.measured!.height! <= a.position.y).toBe(true);
  }
}
describe("canvas collision protection", () => {
  it.each(["pointerup", "pointercancel", "blur"])("defers group movement until %s", (endEvent) => {
    const { result } = mount([node("a", 0, 0), node("b", 800, 0)]);
    act(() => window.dispatchEvent(new Event("pointerdown")));
    const overlapping = [node("a", 0, 0), node("b", 100, 0)];
    act(() => result.current.setNodes(overlapping));
    expect(result.current.nodes).toBe(overlapping);
    act(() => window.dispatchEvent(new Event(endEvent)));
    expectClear(result.current.nodes);
  });
  it("settles restored overlaps, growing recipe fields and output previews without changing data", () => {
    const initial = [node("recipe-a", 0, 0, 1900), node("recipe-b", 0, 420, 1900), node("output-a", 500, 0, 700), node("output-b", 500, 420, 700)];
    const { result } = mount(initial);
    expectClear(result.current.nodes);
    expect(result.current.nodes.map(n => n.data)).toEqual(initial.map(n => n.data));
    act(() => result.current.setNodes(nodes => nodes.map(n => n.id === "output-a" ? { ...n, measured: { width: 650, height: 1200 } } : n)));
    expectClear(result.current.nodes);
    const settled = result.current.nodes;
    act(() => result.current.setNodes(settled));
    expect(result.current.nodes).toBe(settled);
  });
  it("uses collapsed rendered height and waits for measurement and pointer release", () => {
    const collapsed = { ...node("a", 0, 0, 54), style: { height: 1900 } };
    const initial = [collapsed, node("b", 0, 160)];
    const { result } = mount(initial);
    expect(result.current.nodes).toBe(initial);
    act(() => result.current.setNodes([collapsed, { ...node("b", 0, 0), dragging: true }]));
    expect(result.current.nodes[1].position.y).toBe(0);
    act(() => result.current.setNodes(nodes => nodes.map(n => ({ ...n, dragging: false, resizing: true }))));
    expect(result.current.nodes[1].position.y).toBe(0);
    act(() => result.current.setNodes(nodes => nodes.map(n => ({ ...n, resizing: false }))));
    expectClear(result.current.nodes);
    const unmeasured = [node("a", 0, 0), { ...node("b", 0, 0), measured: undefined }];
    act(() => result.current.setNodes(unmeasured));
    expect(result.current.nodes).toBe(unmeasured);
    act(() => result.current.setNodes(nodes => nodes.map(n => ({ ...n, measured: { width: 420, height: 200 } }))));
    expectClear(result.current.nodes);
  });
});
