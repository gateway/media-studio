import type { GraphNodeDefinition, GraphRun, GraphWorkflowPayload, StudioEdge, StudioNode } from "../types";
import { readGraphGroupsFromWorkflow } from "./graph-groups";
import { graphEdgeClassForPortType, graphEdgeStyleForPortType } from "./graph-node-layout";
import { inputGraphHandleId, outputGraphHandleId } from "./graph-port-handles";
import { nodeUiFromMetadata } from "./graph-media-preview";
import { createGraphNode, nodeStyleFromMetadata, type GraphNodeHandlers } from "./graph-serialization";

export type HydratedGraphWorkflow = {
  nodes: StudioNode[];
  edges: StudioEdge[];
  groups: ReturnType<typeof readGraphGroupsFromWorkflow>;
};

export function hydrateGraphWorkflowForCanvas({
  workflow,
  definitionsByType,
  handlers,
  run,
  onMissingDefinition,
}: {
  workflow: GraphWorkflowPayload;
  definitionsByType: Map<string, GraphNodeDefinition>;
  handlers: GraphNodeHandlers;
  run?: GraphRun | null;
  onMissingDefinition?: (nodeType: string) => void;
}): HydratedGraphWorkflow {
  const runNodesById = new Map((run?.nodes ?? []).map((node) => [node.node_id, node]));
  const savedNodesById = new Map(workflow.nodes.map((node) => [node.id, node]));
  const nodes = workflow.nodes.reduce<StudioNode[]>((items, savedNode) => {
    const definition = definitionsByType.get(savedNode.type);
    if (!definition) {
      onMissingDefinition?.(savedNode.type);
      return items;
    }
    const node = createGraphNode(definition, savedNode.position, handlers);
    const savedUi = nodeUiFromMetadata(savedNode.metadata);
    const runNode = runNodesById.get(savedNode.id);
    items.push({
      ...node,
      id: savedNode.id,
      style: nodeStyleFromMetadata(definition, savedNode.metadata),
      data: {
        ...node.data,
        fields: {
          ...node.data.fields,
          ...savedNode.fields,
        },
        collapsed: savedUi.collapsed,
        accentColor: savedUi.accentColor,
        nodeColor: savedUi.nodeColor,
        nodeHeaderColor: savedUi.nodeHeaderColor,
        customTitle: savedUi.customTitle,
        executionMode: savedUi.executionMode,
        executionCache: savedUi.executionCache,
        status: runNode?.status ?? "idle",
        progress: runNode?.progress ?? null,
        errorMessage: runNode?.error ?? null,
        outputSnapshot: runNode?.output_snapshot_json,
      },
    });
    return items;
  }, []);
  const edges = workflow.edges.map((edge) => {
    const sourceNode = savedNodesById.get(edge.source);
    const sourceType = sourceNode ? definitionsByType.get(sourceNode.type)?.ports.outputs.find((port) => port.id === edge.source_port)?.type : null;
    return {
      id: edge.id,
      source: edge.source,
      sourceHandle: outputGraphHandleId(edge.source_port),
      target: edge.target,
      targetHandle: inputGraphHandleId(edge.target_port),
      animated: false,
      className: graphEdgeClassForPortType(sourceType),
      style: graphEdgeStyleForPortType(sourceType),
      reconnectable: true,
      selected: false,
    };
  });
  return { nodes, edges, groups: readGraphGroupsFromWorkflow(workflow) };
}
