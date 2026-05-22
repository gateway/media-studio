import { useCallback, useRef, useState } from "react";
import { addEdge, reconnectEdge, type Connection, type Edge } from "@xyflow/react";

import type { GraphNodeData, StudioEdge, StudioNode } from "../types";
import { graphEdgeClassForPortType, graphEdgeStyleForPortType } from "../utils/graph-node-layout";
import { graphHandleDirection, graphPortIdFromHandle, outputGraphHandleId } from "../utils/graph-port-handles";
import { graphPortAccepts } from "../utils/graph-port-compatibility";
import { closestCompatibleWireSnapTarget, inputWireSnapHandleId, type WireSnapCandidate } from "../utils/graph-wire-snap";
import type { GraphNodeSearchPopoverState } from "./use-graph-node-search";

type ActiveConnection = NonNullable<GraphNodeData["activeConnection"]>;
type PendingInputRewire = {
  edgeId: string;
  source: string;
  sourceHandle: string | null;
  oldTarget: string;
  oldTargetHandle: string | null;
  portType: string;
};
export type ManualWireDrag = {
  edge: StudioEdge;
  portType: string;
  sourcePoint: { x: number; y: number };
  pointer: { x: number; y: number };
};

type SetEdges = (updater: (current: StudioEdge[]) => StudioEdge[]) => void;

const CONNECTION_SNAP_RADIUS_PX = 84;

function escapeAttr(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function clearSelectedEdges(edges: StudioEdge[]) {
  return edges.map((edge) => (edge.selected ? { ...edge, selected: false } : edge));
}

export function useGraphConnections({
  nodes,
  edges,
  setEdges,
  appendConsole,
  setNodeSearch,
  openNodeSearch,
}: {
  nodes: StudioNode[];
  edges: StudioEdge[];
  setEdges: SetEdges;
  appendConsole: (line: string) => void;
  setNodeSearch: (value: null) => void;
  openNodeSearch: (x: number, y: number, connection?: GraphNodeSearchPopoverState["connection"]) => void;
}) {
  const [activeConnection, setActiveConnection] = useState<ActiveConnection | null>(null);
  const [activeConnectionStart, setActiveConnectionStart] = useState<{ nodeId: string | null; handleId: string | null } | null>(null);
  const [manualWireDrag, setManualWireDrag] = useState<ManualWireDrag | null>(null);
  const pendingInputRewire = useRef<PendingInputRewire | null>(null);

  const clearActiveConnection = useCallback(() => {
    pendingInputRewire.current = null;
    setActiveConnection(null);
    setActiveConnectionStart(null);
    setManualWireDrag(null);
  }, []);

  const edgeIsValid = useCallback(
    (connection: Connection | Edge) => {
      const source = nodes.find((node) => node.id === connection.source);
      const target = nodes.find((node) => node.id === connection.target);
      if (!source || !target || !connection.sourceHandle || !connection.targetHandle) return false;
      if (graphHandleDirection(connection.sourceHandle) === "input" || graphHandleDirection(connection.targetHandle) === "output") return false;
      const sourceHandle = graphPortIdFromHandle(connection.sourceHandle);
      const targetHandle = graphPortIdFromHandle(connection.targetHandle);
      if (!sourceHandle || !targetHandle) return false;
      const sourceDef = (source.data as StudioNode["data"]).definition;
      const targetDef = (target.data as StudioNode["data"]).definition;
      const sourcePort = sourceDef.ports.outputs.find((port) => port.id === sourceHandle);
      const targetPort = targetDef.ports.inputs.find((port) => port.id === targetHandle);
      if (!sourcePort || !targetPort) return false;
      if (!graphPortAccepts(sourcePort.type, targetPort)) return false;
      const currentEdgeId = "id" in connection ? connection.id : undefined;
      const duplicateEdge = edges.some(
        (edge) =>
          edge.source === connection.source &&
          graphPortIdFromHandle(edge.sourceHandle) === sourceHandle &&
          edge.target === connection.target &&
          graphPortIdFromHandle(edge.targetHandle) === targetHandle &&
          edge.id !== currentEdgeId,
      );
      if (duplicateEdge) return false;
      const targetConnectionCount = edges.filter(
        (edge) => edge.target === connection.target && graphPortIdFromHandle(edge.targetHandle) === targetHandle && edge.id !== currentEdgeId,
      ).length;
      if (!targetPort.array && targetConnectionCount > 0) return false;
      if (typeof targetPort.max === "number" && targetConnectionCount >= targetPort.max) return false;
      return true;
    },
    [edges, nodes],
  );

  const portTypeForHandle = useCallback(
    (nodeId: string | null | undefined, handleId: string | null | undefined, handleKind: "source" | "target") => {
      if (!nodeId || !handleId) return null;
      const direction = graphHandleDirection(handleId);
      if ((handleKind === "source" && direction === "input") || (handleKind === "target" && direction === "output")) return null;
      const portId = graphPortIdFromHandle(handleId);
      const node = nodes.find((item) => item.id === nodeId);
      if (!node) return null;
      const definition = (node.data as StudioNode["data"]).definition;
      const ports = handleKind === "source" ? definition.ports.outputs : definition.ports.inputs;
      return ports.find((port) => port.id === portId)?.type ?? null;
    },
    [nodes],
  );

  const nearestTargetHandle = useCallback(
    ({
      clientX,
      clientY,
      source,
      sourceHandle,
      edgeId,
    }: {
      clientX: number;
      clientY: number;
      source: string | null | undefined;
      sourceHandle: string | null | undefined;
      edgeId?: string;
    }) => {
      if (!source || !sourceHandle) return null;
      const candidates: WireSnapCandidate[] = [];
      document.querySelectorAll<HTMLElement>(".react-flow__handle.target, [data-input-port]").forEach((element) => {
        const rect = element.getBoundingClientRect();
        candidates.push({
          nodeId:
            element.getAttribute("data-nodeid") ??
            element.getAttribute("data-graph-node-id") ??
            element.closest<HTMLElement>(".react-flow__node")?.getAttribute("data-id") ??
            null,
          rawHandleId: element.getAttribute("data-handleid"),
          inputPort: element.getAttribute("data-input-port"),
          rect,
        });
      });
      return closestCompatibleWireSnapTarget({
        candidates,
        clientX,
        clientY,
        source,
        sourceHandle,
        edgeId,
        isValidConnection: (connection) => edgeIsValid(connection as StudioEdge),
        radius: CONNECTION_SNAP_RADIUS_PX,
      });
    },
    [edgeIsValid],
  );

  const startInputRewire = useCallback(
    (nodeId: string, portId: string, point: { clientX: number; clientY: number; pointerId?: number }) => {
      const edge = edges.find((item) => item.target === nodeId && graphPortIdFromHandle(item.targetHandle) === portId);
      if (!edge) return;
      const sourceNode = nodes.find((item) => item.id === edge.source);
      if (!sourceNode) return;
      const sourceDef = (sourceNode.data as StudioNode["data"]).definition;
      const sourcePort = sourceDef.ports.outputs.find((port) => port.id === graphPortIdFromHandle(edge.sourceHandle));
      if (!sourcePort) return;
      const sourceHandle = document.querySelector(
        `.react-flow__handle.source[data-nodeid="${escapeAttr(edge.source)}"][data-handleid="${escapeAttr(outputGraphHandleId(graphPortIdFromHandle(edge.sourceHandle)))}"]`,
      ) as HTMLElement | null;
      const sourceRect = sourceHandle?.getBoundingClientRect();
      const sourcePoint = sourceRect
        ? { x: sourceRect.left + sourceRect.width / 2, y: sourceRect.top + sourceRect.height / 2 }
        : { x: point.clientX, y: point.clientY };
      setEdges((current) => current.filter((item) => item.id !== edge.id));
      setManualWireDrag({
        edge,
        portType: sourcePort.type,
        sourcePoint,
        pointer: { x: point.clientX, y: point.clientY },
      });
      setActiveConnection({ from: "output", portType: sourcePort.type });
      setActiveConnectionStart({ nodeId: edge.source, handleId: edge.sourceHandle ?? null });
      setNodeSearch(null);

      const startPoint = { x: point.clientX, y: point.clientY };
      let didDrag = false;
      const restoreOriginalEdge = () => {
        setEdges((current) => (current.some((item) => item.id === edge.id) ? current : addEdge(edge, current)));
      };
      const onPointerMove = (moveEvent: PointerEvent) => {
        if (point.pointerId !== undefined && moveEvent.pointerId !== point.pointerId) return;
        if (Math.hypot(moveEvent.clientX - startPoint.x, moveEvent.clientY - startPoint.y) > 4) {
          didDrag = true;
        }
        setManualWireDrag((current) => (current ? { ...current, pointer: { x: moveEvent.clientX, y: moveEvent.clientY } } : current));
      };
      const onPointerEnd = (upEvent: PointerEvent) => {
        if (point.pointerId !== undefined && upEvent.pointerId !== point.pointerId) return;
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerEnd);
        window.removeEventListener("pointercancel", onPointerCancel);
        if (!didDrag) {
          restoreOriginalEdge();
          setManualWireDrag(null);
          setActiveConnection(null);
          setActiveConnectionStart(null);
          return;
        }
        const targetElement = document
          .elementsFromPoint(upEvent.clientX, upEvent.clientY)
          .map((element) => element.closest(".react-flow__handle.target, [data-input-port]"))
          .find((element): element is HTMLElement => element instanceof HTMLElement);
        const targetNodeId =
          targetElement?.getAttribute("data-nodeid") ??
          targetElement?.getAttribute("data-graph-node-id") ??
          targetElement?.closest<HTMLElement>(".react-flow__node")?.getAttribute("data-id") ??
          null;
        const targetHandleId = inputWireSnapHandleId(targetElement?.getAttribute("data-handleid"), targetElement?.getAttribute("data-input-port"));
        const snappedHandle =
          targetNodeId && targetHandleId
            ? { nodeId: targetNodeId, handleId: targetHandleId }
            : nearestTargetHandle({
                clientX: upEvent.clientX,
                clientY: upEvent.clientY,
                source: edge.source,
                sourceHandle: edge.sourceHandle,
                edgeId: edge.id,
              });
        if (snappedHandle?.nodeId && snappedHandle.handleId) {
          const connection: Connection = {
            source: edge.source,
            sourceHandle: edge.sourceHandle ?? null,
            target: snappedHandle.nodeId,
            targetHandle: snappedHandle.handleId,
          };
          if (edgeIsValid({ ...connection, id: edge.id } as StudioEdge)) {
            setEdges((current) =>
              addEdge(
                {
                  ...connection,
                  id: `edge-${edge.source}-${edge.sourceHandle}-${snappedHandle.nodeId}-${snappedHandle.handleId}`,
                  animated: false,
                  className: graphEdgeClassForPortType(sourcePort.type),
                  style: graphEdgeStyleForPortType(sourcePort.type),
                  reconnectable: true,
                  selected: false,
                },
                clearSelectedEdges(current),
              ),
            );
          } else {
            appendConsole("Connection removed.");
          }
        } else {
          appendConsole("Connection removed.");
        }
        setManualWireDrag(null);
        setActiveConnection(null);
        setActiveConnectionStart(null);
      };
      const onPointerCancel = (cancelEvent: PointerEvent) => {
        if (point.pointerId !== undefined && cancelEvent.pointerId !== point.pointerId) return;
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerEnd);
        window.removeEventListener("pointercancel", onPointerCancel);
        restoreOriginalEdge();
        setManualWireDrag(null);
        setActiveConnection(null);
        setActiveConnectionStart(null);
      };
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerEnd);
      window.addEventListener("pointercancel", onPointerCancel);
    },
    [appendConsole, edgeIsValid, edges, nearestTargetHandle, nodes, setEdges, setNodeSearch],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      const pendingRewire = pendingInputRewire.current;
      const normalizedConnection = pendingRewire
        ? {
            ...connection,
            id: pendingRewire.edgeId,
            source: pendingRewire.source,
            sourceHandle: pendingRewire.sourceHandle,
            target:
              connection.target === pendingRewire.oldTarget && connection.targetHandle === pendingRewire.oldTargetHandle
                ? connection.source
                : connection.target,
            targetHandle:
              connection.target === pendingRewire.oldTarget && connection.targetHandle === pendingRewire.oldTargetHandle
                ? connection.sourceHandle
                : connection.targetHandle,
          }
        : connection;
      if (!edgeIsValid(normalizedConnection as StudioEdge)) {
        appendConsole("Connection rejected: incompatible ports.");
        pendingInputRewire.current = null;
        return;
      }
      const sourcePortType = portTypeForHandle(normalizedConnection.source, normalizedConnection.sourceHandle, "source");
      setEdges((current) => {
        const withoutRewiredEdge = pendingRewire ? current.filter((edge) => edge.id !== pendingRewire.edgeId) : current;
        const nextEdge: StudioEdge = {
          ...normalizedConnection,
          id: `edge-${normalizedConnection.source}-${normalizedConnection.sourceHandle}-${normalizedConnection.target}-${normalizedConnection.targetHandle}`,
          animated: false,
          className: graphEdgeClassForPortType(sourcePortType),
          style: graphEdgeStyleForPortType(sourcePortType),
          reconnectable: true,
          selected: false,
        };
        return addEdge(nextEdge, clearSelectedEdges(withoutRewiredEdge));
      });
      pendingInputRewire.current = null;
    },
    [appendConsole, edgeIsValid, portTypeForHandle, setEdges],
  );

  const onConnectStart = useCallback(
    (_event: MouseEvent | TouchEvent, params: { nodeId: string | null; handleId: string | null; handleType: "source" | "target" | null }) => {
      if (params.handleType === "target") {
        const existingEdge = edges.find((edge) => edge.target === params.nodeId && edge.targetHandle === params.handleId);
        if (!existingEdge) {
          pendingInputRewire.current = null;
          setActiveConnection(null);
          setActiveConnectionStart(null);
          return;
        }
        const portType = portTypeForHandle(existingEdge.source, existingEdge.sourceHandle, "source");
        if (!portType) return;
        pendingInputRewire.current = {
          edgeId: existingEdge.id,
          source: existingEdge.source,
          sourceHandle: existingEdge.sourceHandle ?? null,
          oldTarget: existingEdge.target,
          oldTargetHandle: existingEdge.targetHandle ?? null,
          portType,
        };
        setActiveConnection({ from: "output", portType });
        setActiveConnectionStart({ nodeId: existingEdge.source, handleId: existingEdge.sourceHandle ?? null });
        setNodeSearch(null);
        return;
      }
      const portType = portTypeForHandle(params.nodeId, params.handleId, "source");
      if (!portType) return;
      setActiveConnection({ from: "output", portType });
      setActiveConnectionStart({ nodeId: params.nodeId, handleId: params.handleId });
      setNodeSearch(null);
    },
    [edges, portTypeForHandle, setNodeSearch],
  );

  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, connectionState: { isValid: boolean | null; toHandle?: unknown }) => {
      if (pendingInputRewire.current && !connectionState.isValid) {
        const pendingRewire = pendingInputRewire.current;
        pendingInputRewire.current = null;
        const mouseEvent = "clientX" in event ? event : null;
        const snappedHandle = mouseEvent
          ? nearestTargetHandle({
              clientX: mouseEvent.clientX,
              clientY: mouseEvent.clientY,
              source: pendingRewire.source,
              sourceHandle: pendingRewire.sourceHandle,
              edgeId: pendingRewire.edgeId,
            })
          : null;
        if (snappedHandle?.nodeId && snappedHandle.handleId) {
          const connection: Connection = {
            source: pendingRewire.source,
            sourceHandle: pendingRewire.sourceHandle,
            target: snappedHandle.nodeId,
            targetHandle: snappedHandle.handleId,
          };
          const sourcePortType = portTypeForHandle(connection.source, connection.sourceHandle, "source");
          setEdges((current) =>
            addEdge(
              {
                ...connection,
                id: `edge-${connection.source}-${connection.sourceHandle}-${connection.target}-${connection.targetHandle}`,
                animated: false,
                className: graphEdgeClassForPortType(sourcePortType),
                style: graphEdgeStyleForPortType(sourcePortType),
                reconnectable: true,
                selected: false,
              },
              clearSelectedEdges(current.filter((edge) => edge.id !== pendingRewire.edgeId)),
            ),
          );
          setActiveConnection(null);
          setActiveConnectionStart(null);
          return;
        }
        const edgeId = pendingRewire.edgeId;
        setEdges((current) => current.filter((edge) => edge.id !== edgeId));
        setActiveConnection(null);
        setActiveConnectionStart(null);
        appendConsole("Connection removed.");
        return;
      }
      if (connectionState.isValid || connectionState.toHandle || !activeConnection) {
        pendingInputRewire.current = null;
        setActiveConnection(null);
        setActiveConnectionStart(null);
        return;
      }
      const mouseEvent = "clientX" in event ? event : null;
      if (!mouseEvent) {
        setActiveConnection(null);
        setActiveConnectionStart(null);
        return;
      }
      const snappedHandle = nearestTargetHandle({
        clientX: mouseEvent.clientX,
        clientY: mouseEvent.clientY,
        source: activeConnectionStart?.nodeId,
        sourceHandle: activeConnectionStart?.handleId,
      });
      if (snappedHandle?.nodeId && snappedHandle.handleId && activeConnectionStart?.nodeId && activeConnectionStart.handleId) {
        const connection: Connection = {
          source: activeConnectionStart.nodeId,
          sourceHandle: activeConnectionStart.handleId,
          target: snappedHandle.nodeId,
          targetHandle: snappedHandle.handleId,
        };
        const sourcePortType = portTypeForHandle(connection.source, connection.sourceHandle, "source");
        setEdges((current) =>
          addEdge(
            {
              ...connection,
              id: `edge-${connection.source}-${connection.sourceHandle}-${connection.target}-${connection.targetHandle}`,
              animated: false,
              className: graphEdgeClassForPortType(sourcePortType),
              style: graphEdgeStyleForPortType(sourcePortType),
              reconnectable: true,
              selected: false,
            },
            clearSelectedEdges(current),
          ),
        );
        setActiveConnection(null);
        setActiveConnectionStart(null);
        return;
      }
      openNodeSearch(mouseEvent.clientX, mouseEvent.clientY, {
        ...activeConnection,
        nodeId: activeConnectionStart?.nodeId ?? null,
        handleId: activeConnectionStart?.handleId ?? null,
      });
      setActiveConnection(null);
      setActiveConnectionStart(null);
    },
    [activeConnection, activeConnectionStart, appendConsole, nearestTargetHandle, openNodeSearch, portTypeForHandle, setEdges],
  );

  const onReconnect = useCallback(
    (oldEdge: StudioEdge, newConnection: Connection) => {
      if (!edgeIsValid({ ...newConnection, id: oldEdge.id } as StudioEdge)) {
        return;
      }
      const sourcePortType = portTypeForHandle(newConnection.source, newConnection.sourceHandle, "source");
      setEdges((current) =>
        reconnectEdge(oldEdge, newConnection, current).map((edge) =>
          edge.id === oldEdge.id
            ? {
                ...edge,
                className: graphEdgeClassForPortType(sourcePortType),
                style: graphEdgeStyleForPortType(sourcePortType),
                reconnectable: true,
              }
            : edge,
        ),
      );
    },
    [edgeIsValid, portTypeForHandle, setEdges],
  );

  const onReconnectEnd = useCallback(
    (_event: MouseEvent | TouchEvent, edge: StudioEdge, _handleType: string, connectionState: { isValid: boolean | null; toHandle?: unknown }) => {
      if (connectionState.isValid || connectionState.toHandle) return;
      setEdges((current) => current.filter((item) => item.id !== edge.id));
      appendConsole("Connection removed.");
    },
    [appendConsole, setEdges],
  );

  return {
    activeConnection,
    manualWireDrag,
    clearActiveConnection,
    edgeIsValid,
    startInputRewire,
    onConnect,
    onConnectStart,
    onConnectEnd,
    onReconnect,
    onReconnectEnd,
  };
}
