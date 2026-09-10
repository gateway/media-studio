import { describe, expect, it } from "vitest";

import { graphNodeHeaderKindLabel } from "./graph-node-header";

describe("graphNodeHeaderKindLabel", () => {
  it("keeps non-model categories unchanged", () => {
    expect(graphNodeHeaderKindLabel({ title: "Save Image", category: "Media" })).toBe("Media");
  });

  it("shows the original model name for renamed image model nodes", () => {
    expect(graphNodeHeaderKindLabel({ title: "GPT Image 2 - Image to Image", category: "Models/Image" }, "Hero Frame")).toBe("GPT Image 2 - Image to Image");
  });

  it("shows only the category when the model name is already in the title", () => {
    expect(graphNodeHeaderKindLabel({ title: "Seedance 2.0 Pro", category: "Models/Video" })).toBe("Video model");
  });
});
