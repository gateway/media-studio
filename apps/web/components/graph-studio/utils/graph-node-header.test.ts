import { describe, expect, it } from "vitest";

import { graphNodeHeaderKindLabel } from "./graph-node-header";

describe("graphNodeHeaderKindLabel", () => {
  it("keeps non-model categories unchanged", () => {
    expect(graphNodeHeaderKindLabel({ title: "Save Image", category: "Media" })).toBe("Media");
  });

  it("shows the original model name for renamed image model nodes", () => {
    expect(graphNodeHeaderKindLabel({ title: "GPT Image 2 - Image to Image", category: "Models/Image" })).toBe("GPT Image 2 - Image to Image - image model");
  });

  it("shows the original model name for video model nodes", () => {
    expect(graphNodeHeaderKindLabel({ title: "Seedance 2.0 Pro", category: "Models/Video" })).toBe("Seedance 2.0 Pro - video model");
  });
});
