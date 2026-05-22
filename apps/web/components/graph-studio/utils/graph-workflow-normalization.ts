import type { GraphWorkflowPayload } from "../types";

const SEEDANCE_LEGACY_TARGET_PORTS: Record<string, string> = {
  image_refs: "reference_images",
  video_refs: "reference_videos",
  audio_refs: "reference_audios",
};

export function normalizeGraphWorkflowPayload(workflow: GraphWorkflowPayload): GraphWorkflowPayload {
  const seedanceNodeIds = new Set(
    workflow.nodes
      .filter((node) => node.type === "model.kie.seedance_2_0")
      .map((node) => node.id),
  );
  if (!seedanceNodeIds.size) return workflow;
  let changed = false;
  const edges = workflow.edges.map((edge) => {
    if (!seedanceNodeIds.has(edge.target)) return edge;
    const normalizedPort = SEEDANCE_LEGACY_TARGET_PORTS[edge.target_port];
    if (!normalizedPort) return edge;
    changed = true;
    return {
      ...edge,
      target_port: normalizedPort,
    };
  });
  return changed ? { ...workflow, edges } : workflow;
}
