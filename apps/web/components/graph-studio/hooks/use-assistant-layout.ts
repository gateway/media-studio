import { useCallback, useEffect, useRef } from "react";

import type { GraphWorkflowPayload, StudioNode } from "../types";
import { spaceAssistantNodes } from "../utils/graph-assistant-layout";

type LayoutScope = { tabId: string | null; positions: Map<string, { x: number; y: number }>; proposed?: Map<string, { x: number; y: number }> };

export function useAssistantLayout({ nodes, setNodes, activeTabId }: {
  nodes: StudioNode[];
  setNodes: (updater: (current: StudioNode[]) => StudioNode[]) => void;
  activeTabId: string | null;
}) {
  const scope = useRef<LayoutScope | null>(null);
  const stopAssistantLayout = useCallback(() => { scope.current = null; }, []);
  const beginAssistantLayout = useCallback((workflow: GraphWorkflowPayload, base?: GraphWorkflowPayload) => {
    const previous = new Map(base?.nodes.map((node) => [node.id, node.position]) ?? []);
    scope.current = {
      tabId: activeTabId,
      positions: new Map(workflow.nodes.filter((node) => {
        const position = previous.get(node.id);
        return !position || position.x !== node.position.x || position.y !== node.position.y;
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
    const next = spaceAssistantNodes(nodes, new Set(pending.positions.keys()));
    pending.proposed = undefined;
    if (next === nodes) return;
    pending.proposed = new Map(next.filter((node) => pending.positions.has(node.id)).map((node) => [node.id, { ...node.position }]));
    setNodes((current) => current === nodes ? next : current);
  }, [activeTabId, nodes, setNodes]);

  return { beginAssistantLayout, stopAssistantLayout };
}
