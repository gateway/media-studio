import type { GraphNodeDefinition, GraphRun, GraphWorkflowPayload, StudioEdge, StudioNode } from "../types";
import { resolveGraphNodeDefinition } from "./graph-effective-node-definition";
import { readGraphGroupsFromWorkflow } from "./graph-groups";
import { computeGraphNodeLayout } from "./graph-node-layout";
import { graphExtraLayoutRows, graphPreviewHeaderFieldIds, graphVisibleFieldMetrics } from "./graph-node-fields";
import { graphEdgeClassForPortType, graphEdgeStyleForPortType } from "./graph-node-layout";
import { visibleGraphInputPorts, visibleGraphOutputPorts } from "./graph-node-ports";
import { inputGraphHandleId, outputGraphHandleId } from "./graph-port-handles";
import { nodeUiFromMetadata } from "./graph-media-preview";
import { graphNodeDataWithRunState } from "./graph-node-runtime";
import { graphNormalizePromptProviderFields } from "./graph-prompt-provider";
import { createGraphNode, nodeStyleFromMetadata, type GraphNodeHandlers } from "./graph-serialization";
import { filterGraphWorkflowEdgesForCurrentContract } from "./graph-edge-contract";
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
    const effectiveDefinition = resolveGraphNodeDefinition(definition, mergedFields);
    const previewHeaderFieldIds = graphPreviewHeaderFieldIds(effectiveDefinition);
    const layoutMetrics = graphVisibleFieldMetrics(effectiveDefinition, mergedFields, [], {
      advancedExpanded: savedUi.advancedExpanded,
      previewHeaderFieldIds,
      extraLayoutRows: graphExtraLayoutRows(effectiveDefinition, mergedFields),
    });
    const visibleInputPorts = visibleGraphInputPorts(effectiveDefinition, mergedFields);
    const visibleOutputPorts = visibleGraphOutputPorts(effectiveDefinition, mergedFields);
    const autoLayout = computeGraphNodeLayout(effectiveDefinition, undefined, {
      visibleFieldCount: layoutMetrics.layoutFieldCount,
      visiblePortCount: visibleInputPorts.length + visibleOutputPorts.length,
      textareaCount: layoutMetrics.textareaCount,
    });
    const useCollapsedAutoHeight = effectiveDefinition.fields.some((field) => field.advanced) && !savedUi.hasSavedAdvancedExpanded;
    const savedStyle = nodeStyleFromMetadata(effectiveDefinition, savedNode.metadata, {
      visibleFieldCount: layoutMetrics.layoutFieldCount,
      visiblePortCount: visibleInputPorts.length + visibleOutputPorts.length,
      textareaCount: layoutMetrics.textareaCount,
    });
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
  const edges = filterGraphWorkflowEdgesForCurrentContract({
    edges: normalizedWorkflow.edges,
    nodes: normalizedWorkflow.nodes,
    definitionsByType,
  }).map((edge) => {
    const sourceNode = savedNodesById.get(edge.source);
    const sourceDefinition = sourceNode ? definitionsByType.get(sourceNode.type) : null;
    const sourceFields = sourceNode?.fields ?? {};
    const sourceType = sourceDefinition
      ? resolveGraphNodeDefinition(sourceDefinition, sourceFields).ports.outputs.find((port) => port.id === edge.source_port)?.type
      : null;
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
