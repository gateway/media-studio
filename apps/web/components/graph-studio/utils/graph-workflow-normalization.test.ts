import { describe, expect, it } from "vitest";

import { normalizeGraphWorkflowPayload } from "@/components/graph-studio/utils/graph-workflow-normalization";

describe("normalizeGraphWorkflowPayload", () => {
  it("remaps legacy Seedance target ports to the role-aware inputs", () => {
    const workflow = {
      schema_version: 1 as const,
      name: "Legacy Seedance",
      nodes: [
        { id: "image", type: "media.load_image", position: { x: 0, y: 0 }, fields: {} },
        { id: "video", type: "media.load_video", position: { x: 0, y: 200 }, fields: {} },
        { id: "audio", type: "media.load_audio", position: { x: 0, y: 400 }, fields: {} },
        { id: "model", type: "model.kie.seedance_2_0", position: { x: 320, y: 120 }, fields: {} },
      ],
      edges: [
        { id: "edge-image", source: "image", source_port: "image", target: "model", target_port: "image_refs" },
        { id: "edge-video", source: "video", source_port: "video", target: "model", target_port: "video_refs" },
        { id: "edge-audio", source: "audio", source_port: "audio", target: "model", target_port: "audio_refs" },
      ],
      metadata: {},
    };

    const normalized = normalizeGraphWorkflowPayload(workflow);

    expect(normalized.edges.map((edge) => edge.target_port)).toEqual(["reference_images", "reference_videos", "reference_audios"]);
  });

  it("remaps legacy save-node asset outputs to typed media outputs", () => {
    const workflow = {
      schema_version: 1 as const,
      name: "Legacy save outputs",
      nodes: [
        { id: "save-image", type: "media.save_image", position: { x: 0, y: 0 }, fields: {} },
        { id: "save-images", type: "media.save_images", position: { x: 0, y: 200 }, fields: {} },
        { id: "save-video", type: "media.save_video", position: { x: 0, y: 400 }, fields: {} },
        { id: "save-audio", type: "media.save_audio", position: { x: 0, y: 600 }, fields: {} },
        { id: "save-track", type: "media.save_music_track", position: { x: 0, y: 800 }, fields: {} },
        { id: "display", type: "display.any", position: { x: 320, y: 0 }, fields: {} },
      ],
      edges: [
        { id: "edge-image", source: "save-image", source_port: "asset", target: "display", target_port: "value" },
        { id: "edge-images", source: "save-images", source_port: "assets", target: "display", target_port: "value" },
        { id: "edge-video", source: "save-video", source_port: "asset", target: "display", target_port: "value" },
        { id: "edge-audio", source: "save-audio", source_port: "asset", target: "display", target_port: "value" },
        { id: "edge-track", source: "save-track", source_port: "asset", target: "display", target_port: "value" },
      ],
      metadata: {},
    };

    const normalized = normalizeGraphWorkflowPayload(workflow);

    expect(normalized.edges.map((edge) => edge.source_port)).toEqual([
      "image",
      "images",
      "video",
      "audio",
      "audio",
    ]);
  });
});
