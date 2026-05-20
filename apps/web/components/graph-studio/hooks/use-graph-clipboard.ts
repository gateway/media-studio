import type { MutableRefObject } from "react";
import { useCallback, useRef } from "react";

import type { GraphGroup, GraphNodeDefinition, StudioEdge, StudioNode } from "../types";
import { styleForCopiedGraphNode } from "../utils/graph-clipboard";
import { cloneRecord } from "../utils/graph-media-preview";
import { computeGraphGroupBounds } from "../utils/graph-groups";
import type { GraphExecutionMode } from "../utils/graph-node-execution";
import { graphEdgeClassForPortType, graphEdgeStyleForPortType } from "../utils/graph-node-layout";
import { graphPortIdFromHandle } from "../utils/graph-port-handles";
import type { GraphNodeHandlers } from "../utils/graph-serialization";

type GraphClipboardNode = {
  id: string;
  position: { x: number; y: number };
  style?: StudioNode["style"];
  definition: GraphNodeDefinition;
  fields: Record<string, unknown>;
  collapsed?: boolean;
  advancedExpanded?: boolean;
  autoSizedHeight?: number | null;
  accentColor?: string | null;
  nodeColor?: string | null;
  nodeHeaderColor?: string | null;
  customTitle?: string | null;
  executionMode?: GraphExecutionMode;
  executionCache?: StudioNode["data"]["executionCache"];
};

type GraphClipboard = {
  nodes: GraphClipboardNode[];
  edges: StudioEdge[];
  groups: GraphGroup[];
};

type SetNodes = (updater: (current: StudioNode[]) => StudioNode[]) => void;
type SetEdges = (updater: (current: StudioEdge[]) => StudioEdge[]) => void;

export function useGraphClipboard({
  nodes,
  edges,
  nodeHandlers,
  groups = [],
  setNodes,
  setEdges,
  setGroups,
  appendConsole,
}: {
  nodes: StudioNode[];
  edges: StudioEdge[];
  nodeHandlers: GraphNodeHandlers;
  groups?: GraphGroup[];
  setNodes: SetNodes;
  setEdges: SetEdges;
  setGroups?: (updater: (current: GraphGroup[]) => GraphGroup[]) => void;
  appendConsole: (line: string) => void;
}) {
  const graphClipboard = useRef<GraphClipboard | null>(null);
  const pasteOffset = useRef(0);

  const copySelectedNodes = useCallback(() => {
    const selectedNodes = nodes.filter((node) => node.selected);
    if (!selectedNodes.length) {
      appendConsole("Select one or more nodes to copy.");
      return;
    }
    const selectedIds = new Set(selectedNodes.map((node) => node.id));
    graphClipboard.current = {
      nodes: selectedNodes.map((node) => {
        const data = node.data as StudioNode["data"];
        return {
          id: node.id,
          position: { x: node.position.x, y: node.position.y },
          style: styleForCopiedGraphNode(node),
          definition: data.definition,
          fields: cloneRecord(data.fields),
          collapsed: data.collapsed,
          advancedExpanded: data.advancedExpanded,
          autoSizedHeight: data.autoSizedHeight ?? null,
          accentColor: data.accentColor ?? null,
          nodeColor: data.nodeColor ?? null,
          nodeHeaderColor: data.nodeHeaderColor ?? null,
          customTitle: data.customTitle ?? null,
          executionMode: data.executionMode ?? "enabled",
          executionCache: cloneRecord(data.executionCache ?? null),
        };
      }),
      edges: edges.filter((edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target)).map((edge) => cloneRecord(edge)),
      groups: groups.filter((group) => group.node_ids.every((nodeId) => selectedIds.has(nodeId))).map((group) => cloneRecord(group)),
    };
    pasteOffset.current = 0;
    appendConsole(`Copied ${selectedNodes.length} node${selectedNodes.length === 1 ? "" : "s"}.`);
  }, [appendConsole, edges, groups, nodes]);

  const pasteCopiedNodes = useCallback(() => {
    const clipboard = graphClipboard.current;
    if (!clipboard?.nodes.length) {
      appendConsole("No copied graph nodes to paste.");
      return;
    }
    pasteOffset.current += 36;
    const idMap = new Map<string, string>();
    const pastedNodes = clipboard.nodes.map((node) => {
      const nextId = `${node.definition.type}-${crypto.randomUUID().slice(0, 8)}`;
      idMap.set(node.id, nextId);
      return {
        id: nextId,
        type: "graphNode",
        position: {
          x: node.position.x + pasteOffset.current,
          y: node.position.y + pasteOffset.current,
        },
        style: cloneRecord(node.style ?? {}),
        selected: true,
        data: {
          definition: node.definition,
          fields: cloneRecord(node.fields),
          collapsed: node.collapsed,
          advancedExpanded: node.advancedExpanded,
          autoSizedHeight: node.autoSizedHeight ?? null,
          accentColor: node.accentColor ?? null,
          nodeColor: node.nodeColor ?? null,
          nodeHeaderColor: node.nodeHeaderColor ?? null,
          customTitle: node.customTitle ?? null,
          executionMode: node.executionMode ?? "enabled",
          executionCache: cloneRecord(node.executionCache ?? null),
          outputSnapshot: undefined,
          mediaPreview: undefined,
          connectedInputPorts: [],
          activeConnection: null,
          status: "idle",
          progress: null,
          errorMessage: null,
          ...nodeHandlers,
        },
      } satisfies StudioNode;
    });
    const pastedEdges = clipboard.edges.flatMap((edge) => {
      const source = idMap.get(edge.source);
      const target = idMap.get(edge.target);
      if (!source || !target) return [];
      const sourcePortType = clipboard.nodes
        .find((node) => node.id === edge.source)
        ?.definition.ports.outputs.find((port) => port.id === graphPortIdFromHandle(edge.sourceHandle))?.type;
      return [
        {
          ...cloneRecord(edge),
          id: `edge-${source}-${edge.sourceHandle}-${target}-${edge.targetHandle}`,
          source,
          target,
          selected: false,
          animated: false,
          className: graphEdgeClassForPortType(sourcePortType),
          style: graphEdgeStyleForPortType(sourcePortType),
          reconnectable: true,
        } satisfies StudioEdge,
      ];
    });
    const pastedGroups = clipboard.groups.map((group) => {
      const nodeIds = group.node_ids.flatMap((nodeId) => {
        const nextId = idMap.get(nodeId);
        return nextId ? [nextId] : [];
      });
      return {
        ...cloneRecord(group),
        id: `graphgroup-${crypto.randomUUID().slice(0, 8)}`,
        node_ids: nodeIds,
        bounds: computeGraphGroupBounds(pastedNodes, nodeIds, group.bounds),
      };
    }).filter((group) => group.node_ids.length > 0);
    setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), ...pastedNodes]);
    setEdges((current) => [...current.map((edge) => ({ ...edge, selected: false })), ...pastedEdges]);
    if (setGroups && pastedGroups.length) {
      setGroups((current) => [...current, ...pastedGroups]);
    }
    appendConsole(`Pasted ${pastedNodes.length} node${pastedNodes.length === 1 ? "" : "s"}.`);
  }, [appendConsole, nodeHandlers, setEdges, setGroups, setNodes]);

  return { copySelectedNodes, pasteCopiedNodes, graphClipboard: graphClipboard as MutableRefObject<GraphClipboard | null> };
}
