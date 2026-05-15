import type { Connection } from "@xyflow/react";

import { graphHandleDirection, graphPortIdFromHandle, inputGraphHandleId } from "./graph-port-handles";

export type WireSnapCandidate = {
  nodeId: string | null;
  rawHandleId?: string | null;
  inputPort?: string | null;
  rect: Pick<DOMRect, "left" | "top" | "width" | "height">;
};

export type WireSnapTarget = {
  nodeId: string;
  handleId: string;
  distance: number;
};

export function inputWireSnapHandleId(rawHandleId?: string | null, inputPort?: string | null): string | null {
  const rawValue = rawHandleId ?? inputPort ?? null;
  if (!rawValue || graphHandleDirection(rawValue) === "output") return null;
  const portId = graphPortIdFromHandle(rawValue);
  return portId ? inputGraphHandleId(portId) : null;
}

export function closestCompatibleWireSnapTarget({
  candidates,
  clientX,
  clientY,
  source,
  sourceHandle,
  edgeId,
  isValidConnection,
  radius,
}: {
  candidates: WireSnapCandidate[];
  clientX: number;
  clientY: number;
  source: string | null | undefined;
  sourceHandle: string | null | undefined;
  edgeId?: string;
  isValidConnection: (connection: Connection & { id?: string }) => boolean;
  radius: number;
}): WireSnapTarget | null {
  if (!source || !sourceHandle) return null;
  const targets = new Map<string, WireSnapTarget>();
  candidates.forEach((candidate) => {
    if (!candidate.nodeId || candidate.nodeId === source || !candidate.rect.width || !candidate.rect.height) return;
    const targetHandle = inputWireSnapHandleId(candidate.rawHandleId, candidate.inputPort);
    if (!targetHandle) return;
    const distance = Math.hypot(clientX - (candidate.rect.left + candidate.rect.width / 2), clientY - (candidate.rect.top + candidate.rect.height / 2));
    if (distance > radius) return;
    if (!isValidConnection({ id: edgeId ?? "__snap_probe__", source, sourceHandle, target: candidate.nodeId, targetHandle })) return;
    const existing = targets.get(`${candidate.nodeId}:${targetHandle}`);
    if (!existing || distance < existing.distance) {
      targets.set(`${candidate.nodeId}:${targetHandle}`, { nodeId: candidate.nodeId, handleId: targetHandle, distance });
    }
  });
  return [...targets.values()].sort((left, right) => left.distance - right.distance)[0] ?? null;
}
