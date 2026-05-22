import { useCallback, useMemo, useRef } from "react";

import type { MediaAsset, MediaReference } from "@/lib/types";
import type { GraphMediaPreview, GraphNodePricingEstimate, StudioEdge, StudioNode } from "../types";
import { firstOutputRef, outputRefs, previewFromAsset, previewFromReference } from "../utils/graph-media-preview";
import { graphPortIdFromHandle } from "../utils/graph-port-handles";
import { graphReferenceBadgesForNodes } from "../utils/graph-reference-badges";
import type { GraphNodeHandlers } from "../utils/graph-serialization";

type CachedRenderNode = {
  source: StudioNode;
  signature: string;
  rendered: StudioNode;
};

function previewSignature(preview: GraphMediaPreview | null) {
  return preview ? [preview.mediaType, preview.url, preview.fullUrl, preview.posterUrl, preview.label].join("|") : "";
}

function previewsSignature(previews: GraphMediaPreview[]) {
  return previews.map(previewSignature).join(";");
}

function connectedPortsByNode(edges: StudioEdge[]) {
  const inputs = new Map<string, string[]>();
  const outputs = new Map<string, string[]>();
  for (const edge of edges) {
    const targetPorts = inputs.get(edge.target) ?? [];
    targetPorts.push(String(graphPortIdFromHandle(edge.targetHandle) ?? ""));
    inputs.set(edge.target, targetPorts);

    const sourcePorts = outputs.get(edge.source) ?? [];
    sourcePorts.push(String(graphPortIdFromHandle(edge.sourceHandle) ?? ""));
    outputs.set(edge.source, sourcePorts);
  }
  return { inputs, outputs };
}

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
  const renderCacheRef = useRef<Map<string, CachedRenderNode>>(new Map());
  const renderedArrayRef = useRef<StudioNode[]>([]);
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
    const connectedPorts = connectedPortsByNode(edges);
    const nextCache = new Map<string, CachedRenderNode>();
    const renderedNodes = nodes.map((node) => {
      const data = node.data as StudioNode["data"];
      const mediaPreview = resolveNodePreview(data);
      const mediaPreviews = resolveNodePreviews(data);
      const referenceBadges = referenceBadgesByNode.get(node.id) ?? [];
      const connectedInputPorts = connectedPorts.inputs.get(node.id) ?? [];
      const connectedOutputPorts = connectedPorts.outputs.get(node.id) ?? [];
      const pricingEstimate = pricingByNode?.[node.id] ?? null;
      const signature = JSON.stringify({
        activeConnection,
        mediaPreview: previewSignature(mediaPreview),
        mediaPreviews: previewsSignature(mediaPreviews),
        referenceBadges,
        connectedInputPorts,
        connectedOutputPorts,
        isRenamingTitle: renamingNodeId === node.id,
        titleDraft: renamingNodeId === node.id ? nodeRenameDraft : null,
        pricingEstimate,
      });
      const cached = renderCacheRef.current.get(node.id);
      if (cached?.source === node && cached.signature === signature) {
        nextCache.set(node.id, cached);
        return cached.rendered;
      }
      const rendered: StudioNode = {
        ...node,
        data: {
          ...data,
          ...nodeHandlers,
          activeConnection,
          mediaPreview,
          mediaPreviews,
          referenceBadges,
          connectedInputPorts,
          connectedOutputPorts,
          isRenamingTitle: renamingNodeId === node.id,
          titleDraft: renamingNodeId === node.id ? nodeRenameDraft : undefined,
          pricingEstimate,
        },
      };
      nextCache.set(node.id, { source: node, signature, rendered });
      return rendered;
    });
    renderCacheRef.current = nextCache;

    const previousRenderedNodes = renderedArrayRef.current;
    if (
      previousRenderedNodes.length === renderedNodes.length &&
      renderedNodes.every((node, index) => node === previousRenderedNodes[index])
    ) {
      return previousRenderedNodes;
    }

    renderedArrayRef.current = renderedNodes;
    return renderedNodes;
  }, [activeConnection, edges, nodeHandlers, nodeRenameDraft, nodes, pricingByNode, renamingNodeId, resolveNodePreview, resolveNodePreviews]);
}
