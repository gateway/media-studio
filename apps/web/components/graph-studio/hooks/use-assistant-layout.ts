import { useCallback, useEffect, useRef } from "react";

import type { GraphWorkflowPayload, StudioNode } from "../types";
import { spaceAssistantNodes } from "../utils/graph-assistant-layout";
import { reflowAssistantRegions } from "../utils/graph-assistant-reflow";

type LayoutScope = { tabId: string | null; workflow: GraphWorkflowPayload; positions: Map<string, { x: number; y: number }>; proposed?: Map<string, { x: number; y: number }> };

export function useAssistantLayout({ nodes, setNodes, activeTabId }: {
  nodes: StudioNode[];
  setNodes: (updater: (current: StudioNode[]) => StudioNode[]) => void;
  activeTabId: string | null;
}) {
  const scope = useRef<LayoutScope | null>(null);
  const stopAssistantLayout = useCallback(() => { scope.current = null; }, []);
  const beginAssistantLayout = useCallback((workflow: GraphWorkflowPayload, base?: GraphWorkflowPayload, tabId = activeTabId, layoutOnly = false) => {
    const previous = new Map(base?.nodes.map((node) => [node.id, node.position]) ?? []);
    const baseById = new Map(base?.nodes.map((node) => [node.id, node]) ?? []);
    const geometryOnly = base?.nodes.length === workflow.nodes.length && workflow.nodes.every((node) => {
      const before = baseById.get(node.id);
      return before && before.type === node.type && JSON.stringify(before.fields) === JSON.stringify(node.fields)
        && JSON.stringify(before.metadata) === JSON.stringify(node.metadata);
    }) && JSON.stringify(base?.edges) === JSON.stringify(workflow.edges)
      && workflow.nodes.some((node) => previous.get(node.id)?.x !== node.position.x || previous.get(node.id)?.y !== node.position.y);
    scope.current = {
      tabId,
      workflow,
      positions: new Map(workflow.nodes.filter((node) => {
        const position = previous.get(node.id);
        return layoutOnly || geometryOnly || !position || position.x !== node.position.x || position.y !== node.position.y;
      }).map((node) => [node.id, { ...node.position }])),
    };
  }, [activeTabId]);

  useEffect(() => {
    const pending = scope.current;
    if (!pending) return;
    if (pending.tabId !== activeTabId) { scope.current = null; return; }
    if (!pending.positions.size) return;
    const managed = nodes.filter((node) => pending.positions.has(node.id));
    // Accept the previous or proposed position while React commits queued updates.
    // A user move/undo must end correction, and the state updater stays replay-safe.
    if (managed.length !== pending.positions.size || managed.some((node) => {
      const previous = pending.positions.get(node.id)!;
      const proposed = pending.proposed?.get(node.id);
      return (previous.x !== node.position.x || previous.y !== node.position.y)
        && (!proposed || proposed.x !== node.position.x || proposed.y !== node.position.y);
    })) {
      scope.current = null;
      return;
    }
    pending.positions = new Map(managed.map((node) => [node.id, { ...node.position }]));
    const ids = new Set(pending.positions.keys());
    // Legacy/incremental edits keep their obstacle correction. Full proposals
    // can be packed again after the real recipe/preview dimensions arrive.
    const packed = pending.workflow.edges ? reflowAssistantRegions(nodes, ids, pending.workflow) : nodes;
    const next = spaceAssistantNodes(packed, ids);
    pending.proposed = undefined;
    if (next === nodes || next.every((node, index) => node.position.x === nodes[index].position.x && node.position.y === nodes[index].position.y)) return;
    pending.proposed = new Map(next.filter((node) => pending.positions.has(node.id)).map((node) => [node.id, { ...node.position }]));
    setNodes((current) => current === nodes ? next : current);
  }, [activeTabId, nodes, setNodes]);

  return { beginAssistantLayout, stopAssistantLayout };
}
