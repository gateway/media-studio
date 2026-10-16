import { useEffect, useState } from "react";

import type { StudioNode } from "../types";
import { spaceAssistantNodes } from "../utils/graph-assistant-layout";

// Loaded graphs, expanded fields and arriving previews need the same collision
// protection as Assistant proposals. Wait for rendered bounds and release of
// pointer interactions; retained expanded heights must not inflate collapsed nodes.
export function useGraphNodeSpacing(nodes: StudioNode[], setNodes: (updater: (current: StudioNode[]) => StudioNode[]) => void) {
  const [pointerActive, setPointerActive] = useState(false);
  useEffect(() => {
    // Group frames move nodes without React Flow's dragging flag. Capture pointer
    // activity before frame handlers stop propagation, and resume on cancellation too.
    const begin = () => setPointerActive(true);
    const end = () => setPointerActive(false);
    window.addEventListener("pointerdown", begin, true);
    window.addEventListener("pointerup", end, true);
    window.addEventListener("pointercancel", end, true);
    window.addEventListener("blur", end);
    return () => {
      window.removeEventListener("pointerdown", begin, true);
      window.removeEventListener("pointerup", end, true);
      window.removeEventListener("pointercancel", end, true);
      window.removeEventListener("blur", end);
    };
  }, []);
  useEffect(() => {
    if (pointerActive) return;
    const visible = nodes.filter((node) => !node.hidden);
    if (visible.some((node) => node.dragging || node.resizing || !node.measured?.width || !node.measured?.height)) return;
    const spaced = spaceAssistantNodes(visible, new Set(visible.map((node) => node.id)), true);
    if (spaced === visible) return;
    const byId = new Map(spaced.map((node) => [node.id, node]));
    const next = nodes.map((node) => byId.get(node.id) ?? node);
    // Never overwrite a newer tab, drag or Assistant layout queued meanwhile.
    setNodes((current) => current === nodes ? next : current);
  }, [nodes, setNodes, pointerActive]);
}
