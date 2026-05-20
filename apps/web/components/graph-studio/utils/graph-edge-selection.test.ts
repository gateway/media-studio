import { describe, expect, it } from "vitest";

import { suppressGraphEdgeSelectionChanges } from "@/components/graph-studio/utils/graph-edge-selection";

describe("graph edge selection", () => {
  it("removes selection-only edge changes while preserving operational changes", () => {
    const filtered = suppressGraphEdgeSelectionChanges([
      { id: "edge-a", type: "select", selected: true },
      { id: "edge-b", type: "remove" },
      { id: "edge-c", type: "replace", item: { id: "edge-c" } as never },
      { id: "edge-d", type: "select", selected: false },
    ]);

    expect(filtered).toHaveLength(2);
    expect(filtered.map((change) => change.type)).toEqual(["remove", "replace"]);
  });
});
