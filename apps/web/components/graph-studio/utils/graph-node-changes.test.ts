import type { NodeChange } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import type { StudioNode } from "../types";
import { filterGraphNodeNoopChanges } from "./graph-node-changes";

function node(overrides: Partial<StudioNode> = {}): StudioNode {
  return {
    id: "node-1",
    type: "graphNode",
    position: { x: 20, y: 30 },
    selected: true,
    dragging: false,
    measured: { width: 360, height: 640 },
    width: 360,
    height: 640,
    data: {},
    ...overrides,
  } as StudioNode;
}

describe("filterGraphNodeNoopChanges", () => {
  it("drops repeated dimension measurements that would otherwise replace node state", () => {
    const changes: NodeChange<StudioNode>[] = [
      {
        id: "node-1",
        type: "dimensions",
        dimensions: { width: 360, height: 640 },
        setAttributes: true,
      },
    ];

    expect(filterGraphNodeNoopChanges(changes, [node()])).toEqual([]);
  });

  it("keeps real dimension updates so user resize still works", () => {
    const changes: NodeChange<StudioNode>[] = [
      {
        id: "node-1",
        type: "dimensions",
        dimensions: { width: 420, height: 720 },
        setAttributes: true,
        resizing: true,
      },
    ];

    expect(filterGraphNodeNoopChanges(changes, [node()])).toEqual(changes);
  });

  it("drops no-op position and selection changes", () => {
    const changes: NodeChange<StudioNode>[] = [
      { id: "node-1", type: "position", position: { x: 20, y: 30 }, dragging: false },
      { id: "node-1", type: "select", selected: true },
    ];

    expect(filterGraphNodeNoopChanges(changes, [node()])).toEqual([]);
  });

  it("keeps unknown-node and real position changes", () => {
    const changes: NodeChange<StudioNode>[] = [
      { id: "node-unknown", type: "select", selected: true },
      { id: "node-1", type: "position", position: { x: 42, y: 30 } },
    ];

    expect(filterGraphNodeNoopChanges(changes, [node()])).toEqual(changes);
  });
});
