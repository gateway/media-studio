import type { Node } from "@xyflow/react";
import type { StudioNode } from "../types";
import { normalizeGraphExecutionMode, type GraphExecutionMode } from "./graph-node-execution";

export function selectedGraphNodeIds(nodes: Node[]): string[] {
  return nodes.filter((node) => node.selected).map((node) => node.id);
}

export function contextMenuTargetNodeIds(nodes: Node[], nodeId: string): string[] {
  const selectedIds = selectedGraphNodeIds(nodes);
  return selectedIds.includes(nodeId) ? selectedIds : [nodeId];
}

export function executionModeForNodeIds(nodes: Node[], nodeIds: string[]): GraphExecutionMode {
  const ids = new Set(nodeIds);
  const modes = nodes
    .filter((node) => ids.has(node.id))
    .map((node) => normalizeGraphExecutionMode((node.data as StudioNode["data"] | undefined)?.executionMode));
  if (!modes.length) return "enabled";
  return modes.every((mode) => mode === modes[0]) ? modes[0] : "enabled";
}

export function nextToggledExecutionMode(nodes: Node[], nodeIds: string[], targetMode: GraphExecutionMode): GraphExecutionMode {
  const ids = new Set(nodeIds);
  const targetNodes = nodes.filter((node) => ids.has(node.id));
  if (!targetNodes.length || targetMode === "enabled") return "enabled";
  const allAlreadyTarget = targetNodes.every((node) => normalizeGraphExecutionMode((node.data as StudioNode["data"] | undefined)?.executionMode) === targetMode);
  return allAlreadyTarget ? "enabled" : targetMode;
}
