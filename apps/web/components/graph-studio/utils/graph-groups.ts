import type { Node } from "@xyflow/react";

import type { GraphGroup, GraphWorkflowPayload, StudioNode } from "../types";
import { normalizeGraphExecutionMode, type GraphExecutionMode } from "./graph-node-execution";

const GROUP_PADDING = 42;
const MIN_GROUP_SIZE = 180;
export const GRAPH_GROUP_MOVE_EVENT = "graph-studio:group-move";
export const GRAPH_GROUP_RENAME_EVENT = "graph-studio:group-rename";
export const GRAPH_GROUP_RESIZE_EVENT = "graph-studio:group-resize";

export type GraphGroupMoveDetail = {
  groupId: string;
  delta: { x: number; y: number };
};

export type GraphGroupRenameDetail = {
  groupId: string;
  title: string;
};

export type GraphGroupResizeDetail = {
  groupId: string;
  delta: { width: number; height: number };
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nodeWidth(node: Node): number {
  const styleWidth = typeof node.style?.width === "number" ? node.style.width : Number(node.style?.width);
  return node.measured?.width ?? node.width ?? (Number.isFinite(styleWidth) ? styleWidth : 280);
}

function nodeHeight(node: Node): number {
  const styleHeight = typeof node.style?.height === "number" ? node.style.height : Number(node.style?.height);
  return node.measured?.height ?? node.height ?? (Number.isFinite(styleHeight) ? styleHeight : 260);
}

function nodeRect(node: Node): GraphGroup["bounds"] {
  return { x: node.position.x, y: node.position.y, width: nodeWidth(node), height: nodeHeight(node) };
}

function rectsTouchOrOverlap(a: GraphGroup["bounds"], b: GraphGroup["bounds"]): boolean {
  const aRight = a.x + a.width;
  const aBottom = a.y + a.height;
  const bRight = b.x + b.width;
  const bBottom = b.y + b.height;
  return a.x <= bRight && aRight >= b.x && a.y <= bBottom && aBottom >= b.y;
}

export function graphGroupColorChoiceId(color: string | null | undefined): string {
  return typeof color === "string" && color.trim() ? color : "default";
}

export function selectedNodeIdsForGroup(nodes: Node[]): string[] {
  return nodes.filter((node) => node.selected).map((node) => node.id);
}

export function computeGraphGroupBounds(nodes: Node[], nodeIds: string[], fallback?: GraphGroup["bounds"]): GraphGroup["bounds"] {
  const ids = new Set(nodeIds);
  const members = nodes.filter((node) => ids.has(node.id));
  if (!members.length) {
    return fallback ?? { x: 0, y: 0, width: MIN_GROUP_SIZE, height: MIN_GROUP_SIZE };
  }
  const left = Math.min(...members.map((node) => node.position.x));
  const top = Math.min(...members.map((node) => node.position.y));
  const right = Math.max(...members.map((node) => node.position.x + nodeWidth(node)));
  const bottom = Math.max(...members.map((node) => node.position.y + nodeHeight(node)));
  return {
    x: left - GROUP_PADDING,
    y: top - GROUP_PADDING,
    width: Math.max(MIN_GROUP_SIZE, right - left + GROUP_PADDING * 2),
    height: Math.max(MIN_GROUP_SIZE, bottom - top + GROUP_PADDING * 2),
  };
}

export function graphGroupsForCanvas(groups: GraphGroup[], nodes: Node[]): GraphGroup[] {
  const nodeIds = new Set(nodes.map((node) => node.id));
  return groups
    .map((group) => ({
      ...group,
      node_ids: group.node_ids.filter((nodeId) => nodeIds.has(nodeId)),
    }))
    .filter((group) => group.node_ids.length > 0)
    .map((group) => ({
      ...group,
      color: graphGroupColorChoiceId(group.color),
      bounds: group.bounds,
      execution: group.execution ? { mode: normalizeGraphExecutionMode(group.execution.mode) } : null,
    }));
}

export function dispatchGraphGroupMove(detail: GraphGroupMoveDetail): void {
  window.dispatchEvent(new CustomEvent<GraphGroupMoveDetail>(GRAPH_GROUP_MOVE_EVENT, { detail }));
}

export function dispatchGraphGroupRename(detail: GraphGroupRenameDetail): void {
  window.dispatchEvent(new CustomEvent<GraphGroupRenameDetail>(GRAPH_GROUP_RENAME_EVENT, { detail }));
}

export function dispatchGraphGroupResize(detail: GraphGroupResizeDetail): void {
  window.dispatchEvent(new CustomEvent<GraphGroupResizeDetail>(GRAPH_GROUP_RESIZE_EVENT, { detail }));
}

export function moveGraphGroupNodes(nodes: StudioNode[], group: GraphGroup, delta: { x: number; y: number }): StudioNode[] {
  if (!delta.x && !delta.y) return nodes;
  const memberIds = new Set(group.node_ids);
  return nodes.map((node) => {
    if (!memberIds.has(node.id)) return node;
    return { ...node, position: { x: node.position.x + delta.x, y: node.position.y + delta.y } };
  });
}

export function moveGraphGroupBounds(groups: GraphGroup[], groupId: string, delta: { x: number; y: number }): GraphGroup[] {
  if (!delta.x && !delta.y) return groups;
  return groups.map((group) =>
    group.id === groupId
      ? { ...group, bounds: { ...group.bounds, x: group.bounds.x + delta.x, y: group.bounds.y + delta.y } }
      : group,
  );
}

export function resizeGraphGroupBounds(groups: GraphGroup[], groupId: string, delta: { width: number; height: number }): GraphGroup[] {
  if (!delta.width && !delta.height) return groups;
  return groups.map((group) =>
    group.id === groupId
      ? {
          ...group,
          bounds: {
            ...group.bounds,
            width: Math.max(MIN_GROUP_SIZE, group.bounds.width + delta.width),
            height: Math.max(MIN_GROUP_SIZE, group.bounds.height + delta.height),
          },
        }
      : group,
  );
}

export function readGraphGroupsFromWorkflow(workflow?: GraphWorkflowPayload | null): GraphGroup[] {
  const metadata = asRecord(workflow?.metadata);
  const rawGroups = Array.isArray(metadata?.groups) ? metadata.groups : [];
  return rawGroups.flatMap((item) => {
    const record = asRecord(item);
    const bounds = asRecord(record?.bounds);
    const execution = asRecord(record?.execution);
    const nodeIds = Array.isArray(record?.node_ids) ? record.node_ids.filter((nodeId): nodeId is string => typeof nodeId === "string") : [];
    if (!record || typeof record.id !== "string" || !nodeIds.length) return [];
    return [
      {
        id: record.id,
        title: typeof record.title === "string" && record.title.trim() ? record.title : "Group",
        color: graphGroupColorChoiceId(typeof record.color === "string" ? record.color : null),
        node_ids: nodeIds,
        bounds: {
          x: numberValue(bounds?.x, 0),
          y: numberValue(bounds?.y, 0),
          width: numberValue(bounds?.width, MIN_GROUP_SIZE),
          height: numberValue(bounds?.height, MIN_GROUP_SIZE),
        },
        execution: execution ? { mode: normalizeGraphExecutionMode(execution.mode) } : null,
      },
    ];
  });
}

export function serializeGraphGroups(groups: GraphGroup[], nodes: StudioNode[]): GraphGroup[] {
  return graphGroupsForCanvas(groups, nodes).map((group) => ({
    id: group.id,
    title: group.title,
    color: group.color,
    node_ids: group.node_ids,
    bounds: group.bounds,
    execution: group.execution?.mode ? { mode: normalizeGraphExecutionMode(group.execution.mode) } : null,
  }));
}

export function pruneGraphGroupMembership(groups: GraphGroup[], nodes: Node[]): GraphGroup[] {
  return syncGraphGroupMembership(groups, nodes);
}

export function syncGraphGroupMembership(groups: GraphGroup[], nodes: Node[]): GraphGroup[] {
  let changed = false;
  const next = groups
    .map((group) => {
      const memberIds = nodes.filter((node) => rectsTouchOrOverlap(group.bounds, nodeRect(node))).map((node) => node.id);
      if (memberIds.length !== group.node_ids.length || memberIds.some((nodeId, index) => nodeId !== group.node_ids[index])) changed = true;
      return memberIds.length ? { ...group, node_ids: memberIds } : null;
    })
    .filter((group): group is GraphGroup => Boolean(group));
  return changed ? next : groups;
}

export function applyExecutionModeToNodes(nodes: StudioNode[], nodeIds: string[], mode: GraphExecutionMode): StudioNode[] {
  const ids = new Set(nodeIds);
  return nodes.map((node) => {
    if (!ids.has(node.id)) return node;
    return {
      ...node,
      data: {
        ...(node.data as StudioNode["data"]),
        executionMode: mode,
      },
    };
  });
}
