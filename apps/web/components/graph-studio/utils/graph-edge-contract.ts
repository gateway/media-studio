import type { Edge } from "@xyflow/react";

import type { GraphNodeDefinition, GraphWorkflowPayload, StudioEdge, StudioNode } from "../types";
import { resolveGraphNodeDefinition } from "./graph-effective-node-definition";
import { graphPortIdFromHandle } from "./graph-port-handles";
import { visibleGraphInputPorts, visibleGraphOutputPorts } from "./graph-node-ports";

type GraphWorkflowNode = GraphWorkflowPayload["nodes"][number];
type GraphWorkflowEdge = GraphWorkflowPayload["edges"][number];
type EdgeContractNode = Pick<GraphWorkflowNode, "id" | "type" | "fields">;

function edgeNodeDefinition(
  node: EdgeContractNode | StudioNode | null | undefined,
  definitionsByType?: Map<string, GraphNodeDefinition>,
): GraphNodeDefinition | null {
  if (!node) return null;
  if ("data" in node && node.data?.definition) return node.data.definition;
  if (!definitionsByType || !("type" in node)) return null;
  return typeof node.type === "string" ? definitionsByType.get(node.type) ?? null : null;
}

function edgeNodeFields(node: EdgeContractNode | StudioNode | null | undefined): Record<string, unknown> {
  if (!node) return {};
  if ("data" in node) return node.data?.fields ?? {};
  return node.fields ?? {};
}

export function graphWorkflowEdgeMatchesCurrentContract({
  edge,
  nodesById,
  definitionsByType,
}: {
  edge: GraphWorkflowEdge;
  nodesById: Map<string, EdgeContractNode>;
  definitionsByType: Map<string, GraphNodeDefinition>;
}): boolean {
  const sourceNode = nodesById.get(edge.source);
  const targetNode = nodesById.get(edge.target);
  const sourceDefinition = edgeNodeDefinition(sourceNode, definitionsByType);
  const targetDefinition = edgeNodeDefinition(targetNode, definitionsByType);
  if (!sourceDefinition || !targetDefinition) return false;
  const sourceFields = edgeNodeFields(sourceNode);
  const targetFields = edgeNodeFields(targetNode);
  const effectiveSourceDefinition = resolveGraphNodeDefinition(sourceDefinition, sourceFields);
  const effectiveTargetDefinition = resolveGraphNodeDefinition(targetDefinition, targetFields);
  const sourcePorts = visibleGraphOutputPorts(effectiveSourceDefinition, sourceFields);
  const targetPorts = visibleGraphInputPorts(effectiveTargetDefinition, targetFields);
  return sourcePorts.some((port) => port.id === edge.source_port) && targetPorts.some((port) => port.id === edge.target_port);
}

export function filterGraphWorkflowEdgesForCurrentContract({
  edges,
  nodes,
  definitionsByType,
}: {
  edges: GraphWorkflowEdge[];
  nodes: EdgeContractNode[];
  definitionsByType: Map<string, GraphNodeDefinition>;
}): GraphWorkflowEdge[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  return edges.filter((edge) => graphWorkflowEdgeMatchesCurrentContract({ edge, nodesById, definitionsByType }));
}

export function graphCanvasEdgeMatchesCurrentContract({
  edge,
  nodesById,
}: {
  edge: Edge;
  nodesById: Map<string, StudioNode>;
}): boolean {
  const sourceNode = nodesById.get(edge.source);
  const targetNode = nodesById.get(edge.target);
  const sourceDefinition = edgeNodeDefinition(sourceNode);
  const targetDefinition = edgeNodeDefinition(targetNode);
  if (!sourceDefinition || !targetDefinition) return false;
  const sourcePortId = graphPortIdFromHandle(edge.sourceHandle);
  const targetPortId = graphPortIdFromHandle(edge.targetHandle);
  if (!sourcePortId || !targetPortId) return false;
  const sourceFields = edgeNodeFields(sourceNode);
  const targetFields = edgeNodeFields(targetNode);
  const effectiveSourceDefinition = resolveGraphNodeDefinition(sourceDefinition, sourceFields);
  const effectiveTargetDefinition = resolveGraphNodeDefinition(targetDefinition, targetFields);
  const sourcePorts = visibleGraphOutputPorts(effectiveSourceDefinition, sourceFields);
  const targetPorts = visibleGraphInputPorts(effectiveTargetDefinition, targetFields);
  return sourcePorts.some((port) => port.id === sourcePortId) && targetPorts.some((port) => port.id === targetPortId);
}

export function filterGraphCanvasEdgesForCurrentContract(nodes: StudioNode[], edges: StudioEdge[]): StudioEdge[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  return edges.filter((edge) => graphCanvasEdgeMatchesCurrentContract({ edge, nodesById }) as boolean);
}
