import { describe, expect, it } from "vitest";

import { closestCompatibleWireSnapTarget, inputWireSnapHandleId, type WireSnapCandidate } from "@/components/graph-studio/utils/graph-wire-snap";

const rect = (left: number, top: number): WireSnapCandidate["rect"] => ({ left, top, width: 20, height: 20 });

describe("graph wire snapping", () => {
  it("normalizes raw input ports to canonical input handle ids", () => {
    expect(inputWireSnapHandleId("image", null)).toBe("in:image");
    expect(inputWireSnapHandleId("in:video", null)).toBe("in:video");
    expect(inputWireSnapHandleId(null, "audio")).toBe("in:audio");
  });

  it("rejects output handles as wire snap targets", () => {
    expect(inputWireSnapHandleId("out:image", null)).toBeNull();
  });

  it("chooses the nearest compatible input target inside the snap radius", () => {
    const candidates: WireSnapCandidate[] = [
      { nodeId: "far", rawHandleId: "in:image", rect: rect(170, 0) },
      { nodeId: "near", rawHandleId: "in:image", rect: rect(16, 0) },
      { nodeId: "output", rawHandleId: "out:image", rect: rect(0, 0) },
    ];

    expect(
      closestCompatibleWireSnapTarget({
        candidates,
        clientX: 20,
        clientY: 10,
        source: "source",
        sourceHandle: "out:image",
        radius: 84,
        isValidConnection: (connection) => connection.target === "near",
      }),
    ).toMatchObject({ nodeId: "near", handleId: "in:image" });
  });
});
