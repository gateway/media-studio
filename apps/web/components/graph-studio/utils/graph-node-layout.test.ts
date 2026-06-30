import { describe, expect, it } from "vitest";

import { graphExtraLayoutRows } from "@/components/graph-studio/utils/graph-node-fields";
import {
  computeGraphNodeLayout,
  computeGraphMediaPreviewFitSize,
  findOpenGraphNodePosition,
  GRAPH_NODE_AUTO_HEIGHT_HARD_MAX,
  GRAPH_NODE_COLLAPSED_HEIGHT,
  graphNodePlacementSize,
  graphNodeUsesContentAutoHeight,
  graphPortColor,
  resolveGraphContentAutoHeight,
  resolveGraphNodeCollapseStyle,
  shouldSyncGraphContentAutoHeight,
} from "@/components/graph-studio/utils/graph-node-layout";
import type { GraphNodeDefinition } from "@/components/graph-studio/types";

describe("computeGraphNodeLayout", () => {
  it("keeps display nodes out of content-driven auto-height enforcement", () => {
    expect(graphNodeUsesContentAutoHeight("display.any")).toBe(false);
    expect(graphNodeUsesContentAutoHeight("media.load_image")).toBe(false);
    expect(graphNodeUsesContentAutoHeight("preview.image")).toBe(false);
    expect(graphNodeUsesContentAutoHeight("preset.render")).toBe(true);
    expect(graphNodeUsesContentAutoHeight("prompt.recipe")).toBe(true);
  });

  it("reserves measured layout rows for selected saved media preset summaries", () => {
    const definition: GraphNodeDefinition = {
      type: "preset.render",
      title: "Media Preset",
      description: "Run a saved Media Preset.",
      category: "Preset",
      fields: [
        { id: "preset_id", label: "Media Preset", type: "preset_picker" },
        { id: "preset_model_key", label: "Model", type: "select" },
        { id: "text__main_character", label: "Main Character", type: "text" },
        { id: "text__companion_creature", label: "Companion Creature", type: "text" },
      ],
      ports: { inputs: [], outputs: [{ id: "image", label: "Image", type: "image" }] },
      source: {
        preset_catalog: [
          {
            preset_id: "preset-1",
            key: "ink_wash_samurai",
            label: "Ink-Wash Samurai Spirit Poster",
            selection_summary: {
              title: "Ink-Wash Samurai Spirit Poster",
              subtitle: "Media Preset",
              description: "Assistant draft for review before saving.",
              details: ["Model: GPT Image 2 Text to Image", "Image slots: 0", "Required images: none"],
            },
          },
        ],
      },
    };

    expect(graphNodeUsesContentAutoHeight(definition)).toBe(true);
    expect(graphExtraLayoutRows(definition, { preset_id: "preset-1" })).toBe(2);
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

  it("shrinks stale auto-height nodes back to measured content", () => {
    expect(
      resolveGraphContentAutoHeight({
        requiredHeight: 430,
        minHeight: 300,
        maxHeight: 1200,
        currentHeight: 5152,
        previousAutoHeight: null,
      }),
    ).toEqual({ height: 430, minHeight: 300, autoSizedHeight: 430 });
  });

  it("allows measured auto-height content to exceed the configured node max", () => {
    expect(
      resolveGraphContentAutoHeight({
        requiredHeight: 1600,
        minHeight: 560,
        maxHeight: 1240,
        currentHeight: 1240,
        previousAutoHeight: 1240,
      }),
    ).toEqual({ height: 1600, minHeight: 560, autoSizedHeight: 1600 });
  });

  it("still caps runaway auto-height measurement at the hard maximum", () => {
    expect(
      resolveGraphContentAutoHeight({
        requiredHeight: GRAPH_NODE_AUTO_HEIGHT_HARD_MAX + 400,
        minHeight: 560,
        maxHeight: 1240,
        currentHeight: 1240,
        previousAutoHeight: 1240,
      }),
    ).toEqual({
      height: GRAPH_NODE_AUTO_HEIGHT_HARD_MAX,
      minHeight: 560,
      autoSizedHeight: GRAPH_NODE_AUTO_HEIGHT_HARD_MAX,
    });
  });

  it("preserves deliberate manual height above the latest auto-height", () => {
    expect(
      resolveGraphContentAutoHeight({
        requiredHeight: 430,
        minHeight: 300,
        maxHeight: 1200,
        currentHeight: 700,
        previousAutoHeight: 430,
      }),
    ).toEqual({ height: 700, minHeight: 300, autoSizedHeight: 430 });
  });

  it("keeps a manual shrink when the wrapper still contains unchanged measured content", () => {
    expect(
      shouldSyncGraphContentAutoHeight({
        requiredHeight: 900,
        currentWrapperHeight: 934,
        previousMeasuredHeight: 900,
      }),
    ).toBe(false);
  });

  it("resyncs unchanged measured content when the wrapper was manually resized too small", () => {
    expect(
      shouldSyncGraphContentAutoHeight({
        requiredHeight: 1452,
        currentWrapperHeight: 1120,
        previousMeasuredHeight: 1452,
      }),
    ).toBe(true);
  });

  it("resyncs when advanced content changes the measured height after a manual resize", () => {
    expect(
      shouldSyncGraphContentAutoHeight({
        requiredHeight: 1452,
        currentWrapperHeight: 1120,
        previousMeasuredHeight: 900,
      }),
    ).toBe(true);
  });

  it("shrinks programmatic dynamic-field heights when the wrapper was last auto-sized", () => {
    expect(
      resolveGraphContentAutoHeight({
        requiredHeight: 533,
        minHeight: 360,
        maxHeight: 1200,
        currentHeight: 696,
        previousAutoHeight: 696,
      }),
    ).toEqual({ height: 533, minHeight: 360, autoSizedHeight: 533 });
  });

  it("syncs the wrapper height when auto-height nodes collapse and expand", () => {
    expect(
      resolveGraphNodeCollapseStyle({
        collapsed: true,
        autoSizedHeight: 627,
        minHeight: 360,
        maxHeight: 1200,
      }),
    ).toEqual({ height: GRAPH_NODE_COLLAPSED_HEIGHT, minHeight: GRAPH_NODE_COLLAPSED_HEIGHT });
    expect(
      resolveGraphNodeCollapseStyle({
        collapsed: false,
        autoSizedHeight: 627,
        minHeight: 360,
        maxHeight: 1200,
      }),
    ).toEqual({ height: 627, minHeight: 360 });
  });

  it("restores expanded auto-height above the configured max after collapse", () => {
    expect(
      resolveGraphNodeCollapseStyle({
        collapsed: false,
        autoSizedHeight: 1600,
        minHeight: 560,
        maxHeight: 1240,
      }),
    ).toEqual({ height: 1600, minHeight: 560 });
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

  it("auto-grows a save video node for portrait output previews", () => {
    const definition = mediaPreviewDefinition("media.save_video", "Save Video", "video", {
      default_size: { width: 320, height: 520 },
      accent: "yellow",
    });

    const fitted = computeGraphMediaPreviewFitSize({
      definition,
      node: { style: { width: 320, height: 520 } },
      autoSizedHeight: 520,
      preview: {
        mediaType: "video",
        url: "/video.mp4",
        width: 1016,
        height: 2036,
      },
    });

    expect(fitted?.width).toBeGreaterThanOrEqual(380);
    expect(fitted?.height).toBeGreaterThan(650);
  });

  it("auto-grows save image, preview image, preview video, and display any nodes from preview dimensions", () => {
    const cases: Array<{ definition: GraphNodeDefinition; mediaType: "image" | "video" }> = [
      {
        definition: mediaPreviewDefinition("media.save_image", "Save Image", "image", { default_size: { width: 280, height: 320 } }),
        mediaType: "image",
      },
      {
        definition: mediaPreviewDefinition("preview.image", "Preview Image", "image", { default_size: { width: 360, height: 420 }, preview: true }),
        mediaType: "image",
      },
      {
        definition: mediaPreviewDefinition("preview.video", "Preview Video", "video", { default_size: { width: 360, height: 400 }, preview: true }),
        mediaType: "video",
      },
      {
        definition: mediaPreviewDefinition("display.any", "Display Any", "any", { default_size: { width: 460, height: 520 } }),
        mediaType: "video",
      },
    ];

    cases.forEach(({ definition, mediaType }) => {
      const layout = computeGraphNodeLayout(definition);
      const fitted = computeGraphMediaPreviewFitSize({
        definition,
        node: { style: { width: layout.width, height: layout.height } },
        autoSizedHeight: layout.height,
        preview: {
          mediaType,
          url: `/${definition.type}.mp4`,
          width: 1016,
          height: 2036,
        },
      });

      expect(fitted, definition.type).not.toBeNull();
      expect(fitted?.height, definition.type).toBeGreaterThan(layout.height);
    });
  });

  it("does not override a manually resized media node", () => {
    const definition: GraphNodeDefinition = {
      type: "media.save_video",
      title: "Save Video",
      description: "Expose a video as a graph output.",
      category: "Media",
      fields: [],
      ports: { inputs: [], outputs: [{ id: "video", label: "Video", type: "video" }] },
      ui: { default_size: { width: 320, height: 520 }, accent: "yellow" },
    };

    expect(
      computeGraphMediaPreviewFitSize({
        definition,
        node: { style: { width: 640, height: 820 } },
        autoSizedHeight: 520,
        preview: {
          mediaType: "video",
          url: "/video.mp4",
          width: 1016,
          height: 2036,
        },
      }),
    ).toBeNull();
  });

  it("uses the audio-family port color for music track wires", () => {
    expect(graphPortColor("music_track")).toBe(graphPortColor("audio"));
  });

  it("places the next default-added tall media node outside the existing node", () => {
    const existingNode = {
      position: { x: 120, y: 120 },
      style: { width: 360, height: 694 },
    };
    const nextSize = graphNodePlacementSize({
      style: { width: 360, height: 694 },
    });

    const position = findOpenGraphNodePosition({
      existingNodes: [existingNode],
      size: nextSize,
      preferredPosition: { x: 120, y: 120 },
    });

    expect(position.x).toBe(120);
    expect(position.y).toBeGreaterThanOrEqual(886);
  });
});

function mediaPreviewDefinition(type: string, title: string, portType: string, ui: Record<string, unknown>): GraphNodeDefinition {
  const outputType = portType === "any" ? "any" : portType;
  return {
    type,
    title,
    description: `${title} test node.`,
    category: "Media",
    fields: type === "media.save_video" ? [
      { id: "project_id", label: "Group", type: "select" },
      { id: "format_preset", label: "Format", type: "select" },
      { id: "audio_policy", label: "Audio", type: "select" },
    ] : [],
    ports: {
      inputs: portType === "any" ? [{ id: "value", label: "Value", type: "any" }] : [{ id: portType, label: title, type: portType }],
      outputs: portType === "any"
        ? [{ id: "value", label: "Value", type: "any" }]
        : type.startsWith("media.save_")
          ? [
              { id: "asset", label: "Asset", type: "asset" },
              { id: portType, label: title, type: outputType },
            ]
          : [{ id: portType, label: title, type: outputType }],
    },
    ui,
  };
}
