import { describe, expect, it } from "vitest";

import { computeGraphNodeLayout, graphNodeUsesContentAutoHeight } from "@/components/graph-studio/utils/graph-node-layout";
import type { GraphNodeDefinition } from "@/components/graph-studio/types";

describe("computeGraphNodeLayout", () => {
  it("keeps display nodes out of content-driven auto-height enforcement", () => {
    expect(graphNodeUsesContentAutoHeight("display.any")).toBe(false);
    expect(graphNodeUsesContentAutoHeight("media.load_image")).toBe(false);
    expect(graphNodeUsesContentAutoHeight("preview.image")).toBe(false);
    expect(graphNodeUsesContentAutoHeight("prompt.recipe")).toBe(true);
  });

  it("disables content-driven auto-height for preview-backed node definitions", () => {
    const definition: GraphNodeDefinition = {
      type: "model.kie.previewish",
      title: "Previewish",
      description: "A node with a live preview shell.",
      category: "Models/Image",
      fields: [],
      ports: { inputs: [], outputs: [] },
      ui: {
        preview: true,
      },
    };

    expect(graphNodeUsesContentAutoHeight(definition)).toBe(false);
  });

  it("lets content-driven height exceed the configured min size", () => {
    const definition: GraphNodeDefinition = {
      type: "prompt.recipe",
      title: "Prompt Recipe",
      description: "Run a saved prompt recipe.",
      category: "Prompt",
      fields: [],
      ports: { inputs: [], outputs: [] },
      ui: {
        default_size: { width: 420, height: 760 },
        min_size: { width: 360, height: 560 },
      },
    };

    const layout = computeGraphNodeLayout(definition, undefined, {
      visibleFieldCount: 12,
      visiblePortCount: 5,
      textareaCount: 1,
    });

    expect(layout.minHeight).toBeGreaterThan(560);
  });

  it("gives video preview nodes enough width and height for freeform resizing", () => {
    const definition: GraphNodeDefinition = {
      type: "media.load_video",
      title: "Load Video",
      description: "Load a video asset.",
      category: "Media",
      fields: [],
      ports: {
        inputs: [],
        outputs: [{ id: "video", label: "Video", type: "video" }],
      },
      ui: {
        preview: true,
      },
    };

    const layout = computeGraphNodeLayout(definition);

    expect(layout.minWidth).toBeGreaterThanOrEqual(380);
    expect(layout.minHeight).toBeGreaterThanOrEqual(360);
    expect(layout.maxWidth).toBeGreaterThan(layout.minWidth);
    expect(layout.maxHeight).toBeGreaterThan(layout.minHeight);
  });
});
