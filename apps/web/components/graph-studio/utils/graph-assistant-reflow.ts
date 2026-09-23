import type { GraphWorkflowPayload, StudioNode } from "../types";
import { readGraphGroupsFromWorkflow } from "./graph-groups";

const GAP = 96;
type Rect = { x: number; y: number; width: number; height: number };
type Position = { x: number; y: number };

function size(node: StudioNode) {
  return {
    width: Math.max(node.measured?.width ?? 0, Number(node.style?.width) || node.width || 0),
    height: Math.max(node.measured?.height ?? 0, Number(node.style?.height) || node.height || 0),
  };
}

function overlaps(a: Rect, b: Rect) {
  return a.x < b.x + b.width + GAP && a.x + a.width + GAP > b.x
    && a.y < b.y + b.height + GAP && a.y + a.height + GAP > b.y;
}

// The browser repeats the server's stage packing with measured geometry. Only
// complete managed groups participate; partial edits retain obstacle correction.
export function reflowAssistantRegions(nodes: StudioNode[], managedIds: Set<string>, workflow: GraphWorkflowPayload) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const proposal = new Map(workflow.nodes.map((node) => [node.id, node]));
  const sizes = new Map(nodes.map((node) => [node.id, size(node)]));
  if (nodes.some((node) => managedIds.has(node.id) && (!sizes.get(node.id)!.width || !sizes.get(node.id)!.height))) return nodes;
  const grouped = new Set<string>();
  const regions: string[][] = [];
  const groups = readGraphGroupsFromWorkflow(workflow);
  for (const group of groups) {
    const ids = group.node_ids.filter((id) => byId.has(id));
    ids.forEach((id) => grouped.add(id));
    if (ids.length && ids.every((id) => managedIds.has(id))) regions.push(ids);
  }
  const ungrouped = workflow.nodes.filter((node) => managedIds.has(node.id) && !grouped.has(node.id)).map((node) => node.id);
  if (ungrouped.length) regions.push(ungrouped);
  const bounds = (ids: string[]): Rect => {
    const x = Math.min(...ids.map((id) => proposal.get(id)!.position.x));
    const y = Math.min(...ids.map((id) => proposal.get(id)!.position.y));
    return { x, y, width: 0, height: 0 };
  };
  regions.sort((a, b) => bounds(a).x - bounds(b).x || bounds(a).y - bounds(b).y);
  const participating = new Set(regions.flat());
  const occupied: Rect[] = nodes.filter((node) => !participating.has(node.id)).map((node) => ({ ...node.position, ...sizes.get(node.id)! }));
  const positions = new Map<string, Position>();
  for (const ids of regions) {
    const eligible = new Set(ids);
    const outgoing = new Map(ids.map((id) => [id, new Set<string>()]));
    const indegree = new Map(ids.map((id) => [id, 0]));
    const levels = new Map(ids.map((id) => [id, 0]));
    for (const edge of workflow.edges ?? []) {
      if (!eligible.has(edge.source) || !eligible.has(edge.target) || edge.source === edge.target || outgoing.get(edge.source)!.has(edge.target)) continue;
      outgoing.get(edge.source)!.add(edge.target);
      indegree.set(edge.target, indegree.get(edge.target)! + 1);
    }
    const pending = ids.filter((id) => indegree.get(id) === 0).sort();
    const visited = new Set<string>();
    for (let index = 0; index < pending.length; index += 1) {
      const id = pending[index];
      visited.add(id);
      for (const target of outgoing.get(id)!) {
        levels.set(target, Math.max(levels.get(target)!, levels.get(id)! + 1));
        indegree.set(target, indegree.get(target)! - 1);
        if (indegree.get(target) === 0) pending.push(target);
      }
    }
    // Match the backend's deterministic fallback for invalid/cyclic graphs.
    for (const id of ids) if (!visited.has(id)) levels.set(id, 0);
    const title = (id: string) => {
      const node = proposal.get(id);
      const ui = node?.metadata?.ui as { customTitle?: string } | undefined;
      return String(ui?.customTitle || node?.type || id).toLowerCase();
    };
    const ordered = [...ids].sort((a, b) => levels.get(a)! - levels.get(b)! || title(a).localeCompare(title(b)) || a.localeCompare(b));
    const height = Math.max(...ids.map((id) => sizes.get(id)!.height));
    const columns: string[][] = [];
    let usedHeight = 0;
    let lastLevel = -1;
    for (const id of ordered) {
      const item = sizes.get(id)!;
      if (levels.get(id) !== lastLevel || usedHeight + GAP + item.height > height) {
        columns.push([]);
        usedHeight = 0;
      }
      const column = columns[columns.length - 1];
      usedHeight += (column.length ? GAP : 0) + item.height;
      column.push(id);
      lastLevel = levels.get(id)!;
    }
    const origin = bounds(ids);
    const local = new Map<string, Position>();
    let x = 0;
    for (const column of columns) {
      const width = Math.max(...column.map((id) => sizes.get(id)!.width));
      const columnHeight = column.reduce((total, id) => total + sizes.get(id)!.height, 0) + GAP * (column.length - 1);
      let y = (height - columnHeight) / 2;
      for (const id of column) {
        local.set(id, { x: x + (width - sizes.get(id)!.width) / 2, y });
        y += sizes.get(id)!.height + GAP;
      }
      x += width + GAP;
    }
    // Reserve the complete group frame, so nodes never migrate into another
    // group's bounds as measured previews or recipes grow.
    const padding = ids.some((id) => grouped.has(id)) ? GAP : 0;
    const rect = { x: origin.x - padding, y: origin.y - padding, width: x - GAP + 2 * padding, height: height + 2 * padding };
    for (;;) {
      const conflict = occupied.find((other) => overlaps(rect, other));
      if (!conflict) break;
      rect.x = conflict.x + conflict.width + GAP;
    }
    occupied.push(rect);
    for (const [id, position] of local) positions.set(id, { x: rect.x + padding + position.x, y: rect.y + padding + position.y });
  }
  let changed = false;
  const next = nodes.map((node) => {
    const position = positions.get(node.id);
    if (!position || (position.x === node.position.x && position.y === node.position.y)) return node;
    changed = true;
    return { ...node, position };
  });
  return changed ? next : nodes;
}
