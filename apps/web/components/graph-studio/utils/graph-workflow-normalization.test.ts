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
});
