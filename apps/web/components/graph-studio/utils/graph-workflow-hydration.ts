import type { GraphNodeDefinition, GraphRun, GraphWorkflowPayload, StudioEdge, StudioNode } from "../types";
import { readGraphGroupsFromWorkflow } from "./graph-groups";
import { computeGraphNodeLayout } from "./graph-node-layout";
import { graphVisibleFieldMetrics } from "./graph-node-fields";
import { graphEdgeClassForPortType, graphEdgeStyleForPortType } from "./graph-node-layout";
import { inputGraphHandleId, outputGraphHandleId } from "./graph-port-handles";
import { nodeUiFromMetadata } from "./graph-media-preview";
import { graphNodeDataWithRunState } from "./graph-node-runtime";
import { graphNormalizePromptProviderFields } from "./graph-prompt-provider";
import { createGraphNode, nodeStyleFromMetadata, type GraphNodeHandlers } from "./graph-serialization";
import { normalizeGraphWorkflowPayload } from "./graph-workflow-normalization";

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
  const normalizedWorkflow = normalizeGraphWorkflowPayload(workflow);
  const runNodesById = new Map((run?.nodes ?? []).map((node) => [node.node_id, node]));
  const savedNodesById = new Map(normalizedWorkflow.nodes.map((node) => [node.id, node]));
  const nodes = normalizedWorkflow.nodes.reduce<StudioNode[]>((items, savedNode) => {
    const definition = definitionsByType.get(savedNode.type);
    if (!definition) {
      onMissingDefinition?.(savedNode.type);
      return items;
    }
    const node = createGraphNode(definition, savedNode.position, handlers);
    const savedUi = nodeUiFromMetadata(savedNode.metadata);
    const runNode = runNodesById.get(savedNode.id);
    const mergedFields = graphNormalizePromptProviderFields(definition.type, {
      ...node.data.fields,
      ...savedNode.fields,
    });
    const previewHeaderFieldIds =
      definition.type === "media.save_image" || definition.type === "media.save_video" || definition.type === "media.save_audio" ? ["project_id"] : [];
    const layoutMetrics = graphVisibleFieldMetrics(definition, mergedFields, [], {
      advancedExpanded: savedUi.advancedExpanded,
      previewHeaderFieldIds,
      extraLayoutRows: definition.type === "prompt.recipe" && String(mergedFields.recipe_id ?? "").trim() ? 2 : 0,
    });
    const autoLayout = computeGraphNodeLayout(definition, undefined, {
      visibleFieldCount: layoutMetrics.layoutFieldCount,
      visiblePortCount: definition.ports.inputs.filter((port) => !port.advanced).length + definition.ports.outputs.filter((port) => !port.advanced).length,
      textareaCount: layoutMetrics.textareaCount,
    });
    const useCollapsedAutoHeight = definition.fields.some((field) => field.advanced) && !savedUi.hasSavedAdvancedExpanded;
    const savedStyle = nodeStyleFromMetadata(definition, savedNode.metadata);
    const effectiveStyle = useCollapsedAutoHeight
      ? {
          ...savedStyle,
          height: autoLayout.minHeight,
          minHeight: autoLayout.minHeight,
        }
      : savedStyle;
    const baseData = {
      ...node.data,
      fields: mergedFields,
      collapsed: savedUi.collapsed,
      advancedExpanded: savedUi.advancedExpanded,
      accentColor: savedUi.accentColor,
      nodeColor: savedUi.nodeColor,
      nodeHeaderColor: savedUi.nodeHeaderColor,
      customTitle: savedUi.customTitle,
      executionMode: savedUi.executionMode,
      executionCache: savedUi.executionCache,
      autoSizedHeight: typeof effectiveStyle.height === "number" ? effectiveStyle.height : null,
    };
    items.push({
      ...node,
      id: savedNode.id,
      style: effectiveStyle,
      data: runNode ? graphNodeDataWithRunState(baseData, runNode) : baseData,
    });
    return items;
  }, []);
  const edges = normalizedWorkflow.edges.map((edge) => {
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
  return { nodes, edges, groups: readGraphGroupsFromWorkflow(normalizedWorkflow) };
}
