import { describe, expect, it } from "vitest";

import { styleForCopiedGraphNode } from "@/components/graph-studio/utils/graph-clipboard";
import type { StudioNode } from "@/components/graph-studio/types";

describe("graph clipboard", () => {
  it("copies effective resized node dimensions from React Flow nodes", () => {
    const style = styleForCopiedGraphNode({
      id: "node-1",
      position: { x: 0, y: 0 },
      width: 520,
      height: 460,
      style: { width: 300, height: 280 },
      data: {},
    } as StudioNode);

    expect(style).toMatchObject({ width: 520, height: 460 });
  });

  it("falls back to persisted style dimensions when measured dimensions are absent", () => {
    const style = styleForCopiedGraphNode({
      id: "node-1",
      position: { x: 0, y: 0 },
      style: { width: 420, height: 360 },
      data: {},
    } as StudioNode);

    expect(style).toMatchObject({ width: 420, height: 360 });
  });
});
