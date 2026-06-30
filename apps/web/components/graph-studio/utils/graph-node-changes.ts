import type { NodeChange } from "@xyflow/react";

import type { StudioNode } from "../types";

function numbersMatch(first: unknown, second: unknown) {
  return (
    typeof first === "number" &&
    Number.isFinite(first) &&
    typeof second === "number" &&
    Number.isFinite(second) &&
    Math.abs(first - second) <= 0.5
  );
}

function samePosition(
  current: StudioNode["position"],
  next: { x: number; y: number } | undefined,
) {
  if (!next) return true;
  return numbersMatch(current.x, next.x) && numbersMatch(current.y, next.y);
}

function dimensionChangeIsNoop(
  change: Extract<NodeChange<StudioNode>, { type: "dimensions" }>,
  node: StudioNode,
) {
  const dimensions = change.dimensions;
  const sameMeasured =
    !dimensions ||
    (numbersMatch(node.measured?.width, dimensions.width) &&
      numbersMatch(node.measured?.height, dimensions.height));
  if (!sameMeasured) return false;

  const setAttributes = change.setAttributes;
  const sameWidthAttribute =
    (setAttributes !== true && setAttributes !== "width") ||
    numbersMatch(node.width, dimensions?.width);
  const sameHeightAttribute =
    (setAttributes !== true && setAttributes !== "height") ||
    numbersMatch(node.height, dimensions?.height);
  const sameResizing =
    typeof change.resizing !== "boolean" || node.resizing === change.resizing;

  return sameWidthAttribute && sameHeightAttribute && sameResizing;
}

function nodeChangeIsNoop(change: NodeChange<StudioNode>, node: StudioNode) {
  if (change.type === "select") {
    return Boolean(node.selected) === change.selected;
  }

  if (change.type === "position") {
    const sameDragging =
      typeof change.dragging !== "boolean" || node.dragging === change.dragging;
    return samePosition(node.position, change.position) && sameDragging;
  }

  if (change.type === "dimensions") {
    return dimensionChangeIsNoop(change, node);
  }

  return false;
}

export function filterGraphNodeNoopChanges(
  changes: NodeChange<StudioNode>[],
  nodes: StudioNode[],
) {
  if (!changes.length || !nodes.length) return changes;
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  return changes.filter((change) => {
    const node = "id" in change ? nodesById.get(change.id) : null;
    return !node || !nodeChangeIsNoop(change, node);
  });
}
