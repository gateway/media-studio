import type { Edge, Node } from "@xyflow/react";

import type { GraphGroup, GraphNodeData, GraphNodeDefinition, GraphWorkflowPayload, StudioNode } from "../types";
import { computeGraphNodeLayout } from "./graph-node-layout";
import { normalizeGraphExecutionMode } from "./graph-node-execution";
import { serializeGraphGroups } from "./graph-groups";
import { graphPortIdFromHandle } from "./graph-port-handles";

export type GraphNodeHandlers = Pick<
  GraphNodeData,
  | "onFieldChange"
  | "onSetFields"
  | "onOpenImageLibrary"
  | "onImageDrop"
  | "onInputRewireStart"
  | "onToggleCollapsed"
  | "onOpenPreview"
  | "onStartRenameNode"
  | "onRenameNodeDraftChange"
  | "onCommitRenameNode"
  | "onCancelRenameNode"
>;

export function defaultGraphFields(definition: GraphNodeDefinition) {
  const fields: Record<string, unknown> = {};
  definition.fields.forEach((field) => {
    if (field.default !== undefined && field.default !== null) {
      fields[field.id] = field.default;
    }
  });
  return fields;
}

export function createGraphNode(definition: GraphNodeDefinition, position: { x: number; y: number }, handlers: GraphNodeHandlers): StudioNode {
  const layout = computeGraphNodeLayout(definition);
  return {
    id: `${definition.type}-${crypto.randomUUID().slice(0, 8)}`,
    type: "graphNode",
    position,
    style: {
      width: layout.width,
      height: layout.height,
      minHeight: layout.minHeight,
    },
    data: {
      definition,
      fields: defaultGraphFields(definition),
      status: "idle",
      progress: null,
      executionMode: "enabled",
      ...handlers,
    },
  };
}

export function workflowFromCanvas(workflowId: string | null, name: string, nodes: Node[], edges: Edge[], groups: GraphGroup[] = []): GraphWorkflowPayload {
  const studioNodes = nodes as StudioNode[];
  return {
    schema_version: 1,
    workflow_id: workflowId,
    name,
    nodes: nodes.map((node) => ({
      id: node.id,
      type: String((node.data as StudioNode["data"]).definition.type),
      position: { x: node.position.x, y: node.position.y },
      fields: { ...(node.data as StudioNode["data"]).fields },
      metadata: {
        style: {
          width: typeof node.width === "number" ? node.width : node.style?.width,
          height: typeof node.height === "number" ? node.height : node.style?.height,
        },
        ui: {
          collapsed: Boolean((node.data as StudioNode["data"]).collapsed),
          accentColor: (node.data as StudioNode["data"]).accentColor ?? null,
          nodeColor: (node.data as StudioNode["data"]).nodeColor ?? null,
          nodeHeaderColor: (node.data as StudioNode["data"]).nodeHeaderColor ?? null,
          customTitle: (node.data as StudioNode["data"]).customTitle ?? null,
        },
        execution: {
          mode: normalizeGraphExecutionMode((node.data as StudioNode["data"]).executionMode),
          cached_run_id: (node.data as StudioNode["data"]).executionCache?.cachedRunId ?? null,
          cached_artifact_ids: (node.data as StudioNode["data"]).executionCache?.cachedArtifactIds ?? {},
        },
      },
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      source_port: String(graphPortIdFromHandle(edge.sourceHandle) ?? ""),
      target: edge.target,
      target_port: String(graphPortIdFromHandle(edge.targetHandle) ?? ""),
    })),
    metadata: { created_by: "graph-studio", groups: serializeGraphGroups(groups, studioNodes) },
  };
}

export function nodeStyleFromMetadata(definition: GraphNodeDefinition, metadata?: Record<string, unknown>) {
  const layout = computeGraphNodeLayout(definition, metadata);
  return {
    width: layout.width,
    height: layout.height,
    minHeight: layout.minHeight,
  };
}
