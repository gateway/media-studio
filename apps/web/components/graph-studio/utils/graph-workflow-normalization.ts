import type { GraphWorkflowPayload } from "../types";

const SEEDANCE_LEGACY_TARGET_PORTS: Record<string, string> = {
  image_refs: "reference_images",
  video_refs: "reference_videos",
  audio_refs: "reference_audios",
};

const SAVE_NODE_LEGACY_OUTPUT_PORTS: Record<string, Record<string, string>> = {
  "media.save_image": { asset: "image" },
  "media.save_images": { asset: "images", assets: "images" },
  "media.save_video": { asset: "video" },
  "media.save_audio": { asset: "audio" },
  "media.save_music_track": { asset: "audio" },
};

export function normalizeGraphWorkflowPayload(workflow: GraphWorkflowPayload): GraphWorkflowPayload {
  const seedanceNodeIds = new Set(
    workflow.nodes
      .filter((node) => node.type === "model.kie.seedance_2_0")
      .map((node) => node.id),
  );
  const nodeTypesById = new Map(workflow.nodes.map((node) => [node.id, node.type]));
  let changed = false;
  const edges = workflow.edges.map((edge) => {
    const normalizedSourcePort =
      SAVE_NODE_LEGACY_OUTPUT_PORTS[nodeTypesById.get(edge.source) ?? ""]?.[
        edge.source_port
      ];
    const normalizedTargetPort = seedanceNodeIds.has(edge.target)
      ? SEEDANCE_LEGACY_TARGET_PORTS[edge.target_port]
      : undefined;
    if (!normalizedSourcePort && !normalizedTargetPort) return edge;
    changed = true;
    return {
      ...edge,
      ...(normalizedSourcePort ? { source_port: normalizedSourcePort } : {}),
      ...(normalizedTargetPort ? { target_port: normalizedTargetPort } : {}),
    };
  });
  return changed ? { ...workflow, edges } : workflow;
}
