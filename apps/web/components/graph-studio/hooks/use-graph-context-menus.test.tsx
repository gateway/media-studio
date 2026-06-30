// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { GraphGroup } from "../types";
import { useGraphContextMenus } from "./use-graph-context-menus";

function group(overrides: Partial<GraphGroup> = {}): GraphGroup {
  return {
    id: "group-1",
    title: "Storyboard group",
    color: "default",
    node_ids: ["node-1", "node-2"],
    bounds: { x: 0, y: 0, width: 100, height: 80 },
    execution: { mode: "enabled" },
    ...overrides,
  };
}

describe("useGraphContextMenus", () => {
  it("hydrates the group title draft from the selected group menu", () => {
    const { result } = renderHook(() =>
      useGraphContextMenus({ groups: [group()] }),
    );

    act(() => {
      result.current.setGroupContextMenu({ groupId: "group-1", x: 10, y: 12 });
    });

    expect(result.current.groupTitleDraft).toBe("Storyboard group");
  });

  it("updates the group title draft when group data changes", () => {
    const { result, rerender } = renderHook(
      ({ groups }) => useGraphContextMenus({ groups }),
      { initialProps: { groups: [group()] } },
    );

    act(() => {
      result.current.setGroupContextMenu({ groupId: "group-1", x: 10, y: 12 });
    });
    rerender({ groups: [group({ title: "Renamed group" })] });

    expect(result.current.groupTitleDraft).toBe("Renamed group");
  });

  it("clears both context menus together", () => {
    const { result } = renderHook(() =>
      useGraphContextMenus({ groups: [group()] }),
    );

    act(() => {
      result.current.setNodeContextMenu({
        nodeIds: ["node-1"],
        anchorNodeId: "node-1",
        x: 4,
        y: 8,
      });
      result.current.setGroupContextMenu({ groupId: "group-1", x: 10, y: 12 });
    });
    act(() => {
      result.current.closeContextMenus();
    });

    expect(result.current.nodeContextMenu).toBeNull();
    expect(result.current.groupContextMenu).toBeNull();
    expect(result.current.groupTitleDraft).toBe("");
  });

  it("can close only the node context menu", () => {
    const { result } = renderHook(() =>
      useGraphContextMenus({ groups: [group()] }),
    );

    act(() => {
      result.current.setNodeContextMenu({
        nodeIds: ["node-1"],
        anchorNodeId: "node-1",
        x: 4,
        y: 8,
      });
      result.current.setGroupContextMenu({ groupId: "group-1", x: 10, y: 12 });
    });
    act(() => {
      result.current.closeNodeContextMenu();
    });

    expect(result.current.nodeContextMenu).toBeNull();
    expect(result.current.groupContextMenu).toEqual({
      groupId: "group-1",
      x: 10,
      y: 12,
    });
  });

  it("can close only the group context menu", () => {
    const { result } = renderHook(() =>
      useGraphContextMenus({ groups: [group()] }),
    );

    act(() => {
      result.current.setNodeContextMenu({
        nodeIds: ["node-1"],
        anchorNodeId: "node-1",
        x: 4,
        y: 8,
      });
      result.current.setGroupContextMenu({ groupId: "group-1", x: 10, y: 12 });
    });
    act(() => {
      result.current.closeGroupContextMenu();
    });

    expect(result.current.nodeContextMenu).toEqual({
      nodeIds: ["node-1"],
      anchorNodeId: "node-1",
      x: 4,
      y: 8,
    });
    expect(result.current.groupContextMenu).toBeNull();
    expect(result.current.groupTitleDraft).toBe("");
  });
});
