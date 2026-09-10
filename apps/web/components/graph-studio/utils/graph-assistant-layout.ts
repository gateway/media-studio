import type { StudioNode } from "../types";

export const ASSISTANT_NODE_GAP = 96;

function size(node: StudioNode) {
  return {
    width: Math.max(node.measured?.width ?? 0, Number(node.style?.width) || node.width || 0),
    height: Math.max(node.measured?.height ?? 0, Number(node.style?.height) || node.height || 0),
  };
}

// Only nodes in the just-applied Assistant proposal may move. Existing canvas
// nodes are obstacles, and a user move ends automatic correction in the hook.
export function spaceAssistantNodes(nodes: StudioNode[], managedIds: Set<string>): StudioNode[] {
  const placed = nodes.filter((node) => !managedIds.has(node.id));
  const managed = nodes.filter((node) => managedIds.has(node.id))
    .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
  const replacements = new Map<string, StudioNode>();
  for (const original of managed) {
    let node = original;
    const dimensions = size(node);
    if (!dimensions.width || !dimensions.height) return nodes;
    for (;;) {
      const conflict = placed.find((other) => {
        const otherSize = size(other);
        return node.position.x < other.position.x + otherSize.width + ASSISTANT_NODE_GAP
          && node.position.x + dimensions.width + ASSISTANT_NODE_GAP > other.position.x
          && node.position.y < other.position.y + otherSize.height + ASSISTANT_NODE_GAP
          && node.position.y + dimensions.height + ASSISTANT_NODE_GAP > other.position.y;
      });
      if (!conflict) break;
      const otherSize = size(conflict);
      const sameColumn = Math.abs(original.position.x - conflict.position.x) < Math.min(dimensions.width, otherSize.width) / 2;
      node = {
        ...node,
        position: sameColumn
          ? { x: node.position.x, y: conflict.position.y + otherSize.height + ASSISTANT_NODE_GAP }
          : { x: conflict.position.x + otherSize.width + ASSISTANT_NODE_GAP, y: node.position.y },
      };
    }
    placed.push(node);
    if (node !== original) replacements.set(node.id, node);
  }
  return replacements.size ? nodes.map((node) => replacements.get(node.id) ?? node) : nodes;
}
