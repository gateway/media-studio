import { useCallback, useMemo } from "react";

import type { MediaAsset, MediaReference } from "@/lib/types";
import type { GraphMediaPreview, GraphNodePricingEstimate, StudioEdge, StudioNode } from "../types";
import { firstOutputRef, outputRefs, previewFromAsset, previewFromReference } from "../utils/graph-media-preview";
import { graphPortIdFromHandle } from "../utils/graph-port-handles";
import { graphReferenceBadgesForNodes } from "../utils/graph-reference-badges";
import type { GraphNodeHandlers } from "../utils/graph-serialization";

export function useGraphNodePreviews({
  nodes,
  edges,
  assets,
  references,
  nodeHandlers,
  activeConnection,
  renamingNodeId,
  nodeRenameDraft,
  pricingByNode,
}: {
  nodes: StudioNode[];
  edges: StudioEdge[];
  assets: MediaAsset[];
  references: MediaReference[];
  nodeHandlers: GraphNodeHandlers;
  activeConnection: StudioNode["data"]["activeConnection"];
  renamingNodeId: string | null;
  nodeRenameDraft: string;
  pricingByNode?: Record<string, GraphNodePricingEstimate>;
}) {
  const resolveNodePreview = useCallback(
    (data: StudioNode["data"]): GraphMediaPreview | null => {
      if (data.fields.asset_id) {
        return previewFromAsset(assets.find((asset) => String(asset.asset_id) === String(data.fields.asset_id)));
      }
      if (data.fields.reference_id) {
        return previewFromReference(references.find((reference) => reference.reference_id === data.fields.reference_id));
      }
      const outputRef = firstOutputRef(data.outputSnapshot);
      if (outputRef?.asset_id) {
        return previewFromAsset(assets.find((asset) => String(asset.asset_id) === String(outputRef.asset_id)));
      }
      if (outputRef?.reference_id) {
        return previewFromReference(references.find((reference) => reference.reference_id === outputRef.reference_id));
      }
      return null;
    },
    [assets, references],
  );

  const resolveNodePreviews = useCallback(
    (data: StudioNode["data"]): GraphMediaPreview[] => {
      return outputRefs(data.outputSnapshot)
        .map((ref) => {
          if (ref.asset_id) return previewFromAsset(assets.find((asset) => String(asset.asset_id) === String(ref.asset_id)));
          if (ref.reference_id) return previewFromReference(references.find((reference) => reference.reference_id === ref.reference_id));
          return null;
        })
        .filter((preview): preview is GraphMediaPreview => Boolean(preview));
    },
    [assets, references],
  );

  return useMemo<StudioNode[]>(() => {
    const referenceBadgesByNode = graphReferenceBadgesForNodes(nodes, edges);
    return nodes.map((node) => {
      const data = node.data as StudioNode["data"];
      return {
        ...node,
        data: {
          ...data,
          ...nodeHandlers,
          activeConnection,
          mediaPreview: resolveNodePreview(data),
          mediaPreviews: resolveNodePreviews(data),
          referenceBadges: referenceBadgesByNode.get(node.id) ?? [],
          connectedInputPorts: edges.filter((edge) => edge.target === node.id).map((edge) => String(graphPortIdFromHandle(edge.targetHandle) ?? "")),
          connectedOutputPorts: edges.filter((edge) => edge.source === node.id).map((edge) => String(graphPortIdFromHandle(edge.sourceHandle) ?? "")),
          isRenamingTitle: renamingNodeId === node.id,
          titleDraft: renamingNodeId === node.id ? nodeRenameDraft : undefined,
          pricingEstimate: pricingByNode?.[node.id] ?? null,
        },
      };
    });
  }, [activeConnection, edges, nodeHandlers, nodeRenameDraft, nodes, pricingByNode, renamingNodeId, resolveNodePreview, resolveNodePreviews]);
}
