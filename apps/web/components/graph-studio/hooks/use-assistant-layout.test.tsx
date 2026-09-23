// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { StrictMode, useRef, useState } from "react";
import { describe, expect, it } from "vitest";

import type { GraphGroup, GraphWorkflowPayload, StudioNode } from "../types";
import { spaceAssistantNodes } from "../utils/graph-assistant-layout";
import { graphGroupsForCanvas, pruneGraphGroupMembership, serializeGraphGroups } from "../utils/graph-groups";
import { useGraphGroups } from "./use-graph-groups";
import { useAssistantLayout } from "./use-assistant-layout";

function node(id: string, x: number, y: number, height = 620): StudioNode {
  return { id, position: { x, y }, measured: { width: 420, height }, data: {} } as StudioNode;
}
function workflow(nodes: StudioNode[]) {
  return { nodes: nodes.map((item) => ({ id: item.id, position: item.position })) } as GraphWorkflowPayload;
}

describe("Assistant rendered layout", () => {

  it("settles a complete width-first proposal and stops after undo or manual movement", () => {
    const initial = [node("ref", 0, 0, 620), node("recipe", 0, 716, 1900), node("output", 516, 0, 620)];
    const proposal = { ...workflow(initial), edges: [
      { id: "ref-out", source: "ref", target: "output", source_port: "image", target_port: "image" },
      { id: "recipe-out", source: "recipe", target: "output", source_port: "text", target_port: "prompt" },
    ] } as GraphWorkflowPayload;
    const { result } = renderHook(() => {
      const [nodes, setNodes] = useState(initial);
      return { nodes, setNodes, ...useAssistantLayout({ nodes, setNodes, activeTabId: "one" }) };
    }, { wrapper: StrictMode });
    act(() => {
      result.current.beginAssistantLayout(proposal, proposal, "one", true);
      result.current.setNodes([...initial]);
    });
    expect(Math.max(...result.current.nodes.map((node) => node.position.y + node.measured!.height!))).toBe(1900);
    expect(result.current.nodes[2].position.x).toBeGreaterThan(result.current.nodes[1].position.x);
    act(() => result.current.setNodes((nodes) => nodes.map((node) => node.id === "recipe" ? { ...node, measured: { width: 420, height: 2400 } } : node)));
    expect(Math.max(...result.current.nodes.map((node) => node.position.y + node.measured!.height!))).toBe(2400);
    // An undo restores the user's snapshot and must not be re-packed by an effect.
    act(() => result.current.setNodes(initial));
    expect(result.current.nodes).toBe(initial);
    act(() => result.current.setNodes((nodes) => nodes.map((node) => node.id === "recipe" ? { ...node, measured: { width: 420, height: 2600 } } : node)));
    expect(result.current.nodes.map((node) => node.position)).toEqual(initial.map((node) => node.position));
  });

  it("retains all group members through reflow and growth, but supports explicit drag-out", () => {
    const initial = [node("preset", 0, 0), node("preview", 0, 716)];
    const { result } = renderHook(() => {
      const [nodes, setNodes] = useState(initial);
      const [groups, setGroups] = useState<GraphGroup[]>([{ id: "group", title: "Postcards", color: "blue", node_ids: ["preset", "preview"], bounds: { x: -96, y: -96, width: 612, height: 1328 } }]);
      const manualNodeMoveRef = useRef(false);
      const layout = useAssistantLayout({ nodes, setNodes, activeTabId: "one" });
      useGraphGroups({ manualNodeMoveRef, groups, nodes, setGroups, setNodes, appendConsole: () => {} });
      return { nodes, groups, setNodes, setGroups, manualNodeMoveRef, ...layout };
    }, { wrapper: StrictMode });
    act(() => {
      result.current.beginAssistantLayout(workflow(initial));
      result.current.setNodes([node("preset", 0, 0, 817), node("preview", 0, 716, 650)]);
    });
    expect(result.current.groups[0].node_ids).toEqual(["preset", "preview"]);
    expect(result.current.groups[0].bounds.height).toBe(1755);
    act(() => result.current.setNodes((nodes) => [nodes[0], { ...nodes[1], measured: { width: 420, height: 900 } }]));
    expect(result.current.groups[0].node_ids).toEqual(["preset", "preview"]);
    expect(result.current.groups[0].bounds.height).toBe(2005);
    const originalRight = result.current.groups[0].bounds.x + result.current.groups[0].bounds.width;
    for (let x = 20; x <= 600; x += 20) {
      act(() => {
        result.current.stopAssistantLayout();
        result.current.manualNodeMoveRef.current = true;
        const moved = result.current.nodes.map((item) => item.id === "preview" ? { ...item, position: { x, y: item.position.y }, dragging: x < 600 } : item);
        result.current.setGroups((groups) => pruneGraphGroupMembership(groups, moved));
        result.current.setNodes(moved);
      });
      expect(result.current.groups[0].bounds.x + result.current.groups[0].bounds.width).toBe(originalRight);
    }
    expect(result.current.groups[0].node_ids).toEqual(["preset"]);
  });

  it("repairs the observed 817px preset overlap and keeps the corrected layout stable", () => {
    const nodes = [node("preset", 0, 0, 817), node("preview", 0, 716, 650)];
    const next = spaceAssistantNodes(nodes, new Set(["preset", "preview"]));
    expect(next[1].position).toEqual({ x: 0, y: 913 });
    expect(spaceAssistantNodes(next, new Set(["preset", "preview"]))).toBe(next);
    const groups = [{ id: "group", title: "Postcards", color: "blue", node_ids: ["preset", "preview"], bounds: { x: -96, y: -96, width: 612, height: 1328 } }];
    const rendered = graphGroupsForCanvas(groups, next);
    expect(rendered[0].bounds).toEqual({ x: -96, y: -96, width: 612, height: 1755 });
    expect(serializeGraphGroups(groups, next)[0].bounds).toEqual(rendered[0].bounds);
  });

  it("preserves existing nodes and moves only the added node away from obstacles", () => {
    const existing = node("user", 0, 0, 817);
    const next = spaceAssistantNodes([existing, node("new", 0, 716)], new Set(["new"]));
    expect(next[0]).toBe(existing);
    expect(next[1].position.y).toBe(913);
  });

  it("spaces horizontal nodes using their rendered widths", () => {
    const nodes = [node("left", 0, 0), node("right", 350, 0)];
    expect(spaceAssistantNodes(nodes, new Set(["left", "right"]))[1].position.x).toBe(516);
  });

  it("keeps downstream nodes horizontal when wide references shift earlier columns", () => {
    const nodes = [node("reference", 0, 0), node("middle", 450, 0), node("downstream", 900, 0)];
    nodes[0].measured = { width: 720, height: 620 };
    const ids = new Set(nodes.map((item) => item.id));
    const next = spaceAssistantNodes(nodes, ids);
    expect(next.map((item) => item.position.y)).toEqual([0, 0, 0]);
    expect(next[2].position.x).toBeGreaterThanOrEqual(next[1].position.x + 420 + 96);
    expect(spaceAssistantNodes(next, ids)).toBe(next);
  });

  it("corrects later content growth but stops after a manual move or tab change", () => {
    const initial = [node("preset", 0, 0), node("preview", 0, 716)];
    const { result, rerender } = renderHook(({ tabId }) => {
      const [nodes, setNodes] = useState(initial);
      return { nodes, setNodes, ...useAssistantLayout({ nodes, setNodes, activeTabId: tabId }) };
    }, { initialProps: { tabId: "one" }, wrapper: StrictMode });
    act(() => {
      result.current.beginAssistantLayout(workflow(initial));
      result.current.setNodes([node("preset", 0, 0, 817), initial[1]]);
    });
    expect(result.current.nodes[1].position.y).toBe(913);
    act(() => result.current.setNodes((nodes) => [node("preset", 0, 0, 900), nodes[1]]));
    expect(result.current.nodes[1].position.y).toBe(996);
    act(() => result.current.setNodes((nodes) => [nodes[0], { ...nodes[1], position: { x: 20, y: 700 } }]));
    act(() => result.current.setNodes((nodes) => [node("preset", 0, 0, 1000), nodes[1]]));
    expect(result.current.nodes[1].position).toEqual({ x: 20, y: 700 });
    act(() => result.current.beginAssistantLayout(workflow(result.current.nodes)));
    rerender({ tabId: "two" });
    act(() => result.current.setNodes((nodes) => [node("preset", 0, 0, 1100), nodes[1]]));
    expect(result.current.nodes[1].position.y).toBe(700);
  });
});
