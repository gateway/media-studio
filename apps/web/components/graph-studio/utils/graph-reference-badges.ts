import type { StudioEdge, StudioNode } from "../types";
import { graphPortIdFromHandle } from "./graph-port-handles";
import { visibleGraphInputPorts, visibleGraphOutputPorts } from "./graph-node-ports";

const MEDIA_REFERENCE_TYPES = new Set(["image", "video", "audio"]);

function titleForNode(node: StudioNode) {
  return node.data.customTitle?.trim() || node.data.definition.title || node.id;
}

function referenceNoun(type: string) {
  if (type === "video") return "video reference";
  if (type === "audio") return "audio reference";
  return "image reference";
}

function targetPortAcceptsMediaType(portType: string, targetPort: { type: string; accepts?: string[] }) {
  if (targetPort.type === "any") return true;
  const accepted = targetPort.accepts?.length ? targetPort.accepts : [targetPort.type];
  return accepted.includes(portType) || accepted.includes("any");
}

export type GraphReferenceBadge = {
  id: string;
  label: string;
  token: string;
  mediaType: "image" | "video" | "audio";
  index: number;
  targetNodeId: string;
  targetTitle: string;
  targetPortId: string;
  targetPortLabel: string;
};

export function graphReferenceBadgesForNodes(nodes: StudioNode[], edges: StudioEdge[]) {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const grouped = new Map<string, Array<{ edge: StudioEdge; mediaType: "image" | "video" | "audio"; targetPortLabel: string }>>();

  for (const edge of edges) {
    const source = nodesById.get(edge.source);
    const target = nodesById.get(edge.target);
    if (!source || !target) continue;
    const sourcePortId = graphPortIdFromHandle(edge.sourceHandle);
    const targetPortId = graphPortIdFromHandle(edge.targetHandle);
    if (!sourcePortId || !targetPortId) continue;
    const sourcePort = visibleGraphOutputPorts(source.data.definition, source.data.fields).find((port) => port.id === sourcePortId);
    const targetPort = visibleGraphInputPorts(target.data.definition, target.data.fields).find((port) => port.id === targetPortId);
    if (!sourcePort || !targetPort) continue;
    if (!MEDIA_REFERENCE_TYPES.has(sourcePort.type) || !targetPortAcceptsMediaType(sourcePort.type, targetPort)) continue;
    const acceptsMultiple = Boolean(targetPort.array) || Number(targetPort.max) > 1;
    if (!acceptsMultiple) continue;
    const mediaType = sourcePort.type as "image" | "video" | "audio";
    const groupKey = `${target.id}:${targetPort.id}`;
    const bucket = grouped.get(groupKey) ?? [];
    bucket.push({ edge, mediaType, targetPortLabel: targetPort.label });
    grouped.set(groupKey, bucket);
  }

  const badgesBySource = new Map<string, GraphReferenceBadge[]>();
  for (const items of grouped.values()) {
    items.forEach((item, index) => {
      const target = nodesById.get(item.edge.target);
      if (!target) return;
      const targetPortId = String(graphPortIdFromHandle(item.edge.targetHandle) ?? "");
      const referenceLabel = referenceNoun(item.mediaType);
      const badge: GraphReferenceBadge = {
        id: item.edge.id,
        label: `${referenceLabel} ${index + 1}`,
        token: `[${referenceLabel} ${index + 1}]`,
        mediaType: item.mediaType,
        index: index + 1,
        targetNodeId: target.id,
        targetTitle: titleForNode(target),
        targetPortId,
        targetPortLabel: item.targetPortLabel,
      };
      const sourceBadges = badgesBySource.get(item.edge.source) ?? [];
      sourceBadges.push(badge);
      badgesBySource.set(item.edge.source, sourceBadges);
    });
  }
  return badgesBySource;
}
