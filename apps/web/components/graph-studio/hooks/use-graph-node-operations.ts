import type { Edge, Node } from "@xyflow/react";
import { useCallback } from "react";

import type { GraphNodeColorChoice } from "../graph-node-context-menu";
import type { StudioNode } from "../types";
import { defaultGraphFields } from "../utils/graph-serialization";
import { nextToggledExecutionMode } from "../utils/graph-selection";
import type { GraphExecutionMode } from "../utils/graph-node-execution";
import { graphNodeDataWithExecutionMode } from "../utils/graph-node-runtime";

type SetNodes = (updater: (current: StudioNode[]) => StudioNode[]) => void;
type SetEdges = (updater: (current: Edge[]) => Edge[]) => void;

export function useGraphNodeOperations({
  nodes,
  setNodes,
  setEdges,
  appendConsole,
  closeContextMenu,
}: {
  nodes: Node[];
  setNodes: SetNodes;
  setEdges: SetEdges;
  appendConsole: (line: string) => void;
  closeContextMenu: () => void;
}) {
  const setGraphNodeColor = useCallback(
    (nodeIds: string[], color: GraphNodeColorChoice) => {
      const ids = new Set(nodeIds);
      setNodes((current) =>
        current.map((node) => {
          if (!ids.has(node.id)) return node;
          const data = node.data as StudioNode["data"];
          const reset = color.id === "default";
          return {
            ...node,
            data: {
              ...data,
              accentColor: reset ? null : color.accent,
              nodeColor: reset ? null : color.surface,
              nodeHeaderColor: reset ? null : color.header,
            },
          };
        }),
      );
      closeContextMenu();
    },
    [closeContextMenu, setNodes],
  );

  const setGraphNodeExecutionMode = useCallback(
    (nodeIds: string[], mode: GraphExecutionMode) => {
      const ids = new Set(nodeIds);
      setNodes((current) =>
        current.map((node) => {
          if (!ids.has(node.id)) return node;
          const data = node.data as StudioNode["data"];
          return {
            ...node,
            data: graphNodeDataWithExecutionMode(data, mode),
          };
        }),
      );
      closeContextMenu();
    },
    [closeContextMenu, setNodes],
  );

  const setGraphNodeCachedOutput = useCallback(
    (nodeId: string, runId: string, artifactIds: Record<string, string[]>) => {
      setNodes((current) =>
        current.map((node) => {
          if (node.id !== nodeId) return node;
          const data = node.data as StudioNode["data"];
          return {
            ...node,
            data: {
              ...graphNodeDataWithExecutionMode(data, "frozen"),
              executionCache: { cachedRunId: runId, cachedArtifactIds: artifactIds },
            },
          };
        }),
      );
      appendConsole(`Muted ${nodeId} against run ${runId}.`);
    },
    [appendConsole, setNodes],
  );

  const toggleGraphNodeExecutionMode = useCallback(
    (nodeIds: string[], mode: GraphExecutionMode) => {
      setGraphNodeExecutionMode(nodeIds, nextToggledExecutionMode(nodes, nodeIds, mode));
    },
    [nodes, setGraphNodeExecutionMode],
  );

  const clearGraphNodes = useCallback(
    (nodeIds: string[]) => {
      const ids = new Set(nodeIds);
      setNodes((current) =>
        current.map((node) => {
          if (!ids.has(node.id)) return node;
          const data = node.data as StudioNode["data"];
          return {
            ...node,
            data: {
              ...data,
              fields: defaultGraphFields(data.definition),
              mediaPreview: null,
              outputSnapshot: undefined,
              connectedInputPorts: [],
              activeConnection: null,
              status: "idle",
              progress: null,
              errorMessage: null,
              executionMode: "enabled",
              executionCache: null,
            },
          };
        }),
      );
      setEdges((current) => current.filter((edge) => !ids.has(edge.source) && !ids.has(edge.target)));
      closeContextMenu();
      appendConsole(`Cleared ${nodeIds.length} node${nodeIds.length === 1 ? "" : "s"} and connections.`);
    },
    [appendConsole, closeContextMenu, setEdges, setNodes],
  );

  return {
    setGraphNodeColor,
    setGraphNodeExecutionMode,
    setGraphNodeCachedOutput,
    toggleGraphNodeExecutionMode,
    clearGraphNodes,
  };
}
