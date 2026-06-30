"use client";

import {
  Background,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  SelectionMode,
  ViewportPortal,
  type OnConnect,
  type OnConnectEnd,
  type OnConnectStart,
  type OnEdgesChange,
  type OnNodesChange,
  type Connection,
  type Edge,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";

import { NODE_COLOR_CHOICES } from "./graph-studio-constants";
import { GraphEdge } from "./graph-edge";
import { GraphGroupFrame } from "./graph-group-frame";
import { GraphNode } from "./graph-node";
import type { GraphGroup, StudioEdge, StudioNode } from "./types";
import { graphCanvasInteractionConfig } from "./utils/graph-canvas-interaction";
import { graphEdgeStyleForPortType } from "./utils/graph-node-layout";
import { isTextEntryTarget } from "./utils/graph-media-preview";
import { contextMenuTargetNodeIds } from "./utils/graph-selection";
import type { GraphNodeSearchPopoverState } from "./hooks/use-graph-node-search";

const nodeTypes = { graphNode: GraphNode };
const edgeTypes = { graphEdge: GraphEdge };
const EDGE_CLICK_DISTANCE_PX = 24;
const EDGE_CLICK_IGNORED_TARGETS = [
  ".react-flow__node",
  ".react-flow__controls",
  ".react-flow__minimap",
  ".react-flow__handle",
  ".graph-edge-delete-button",
  "[data-input-port]",
  "button",
  "input",
  "textarea",
  "select",
].join(", ");
const EDGE_SELECTION_SUPPRESS_MS = 450;
const DEFAULT_EDGE_OPTIONS = { type: "graphEdge", reconnectable: true, interactionWidth: 28 } as const;
const PRO_OPTIONS = { hideAttribution: true } as const;

function graphNodeIdFromPoint(clientX: number, clientY: number): string | null {
  if (typeof document.elementsFromPoint !== "function") return null;
  for (const element of document.elementsFromPoint(clientX, clientY)) {
    if (!(element instanceof Element)) continue;
    if (isTextEntryTarget(element)) return null;
    const nodeElement = element.closest<HTMLElement>(".react-flow__node");
    const nodeId = nodeElement?.getAttribute("data-id");
    if (nodeId) return nodeId;
  }
  return null;
}

function nearestGraphEdgeIdFromPoint(clientX: number, clientY: number) {
  let nearestEdgeId: string | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  document.querySelectorAll<SVGPathElement>(".react-flow__edge-interaction").forEach((path) => {
    const edgeId = path.closest<SVGGElement>(".react-flow__edge")?.getAttribute("data-id");
    if (!edgeId) return;
    const totalLength = typeof path.getTotalLength === "function" ? path.getTotalLength() : 0;
    if (totalLength > 0 && typeof path.getPointAtLength === "function") {
      const matrix = path.getScreenCTM();
      const svg = path.ownerSVGElement;
      const steps = 28;
      const graphPoints: Array<{ x: number; y: number }> = [];
      for (let step = 0; step <= steps; step += 1) {
        graphPoints.push(path.getPointAtLength((totalLength * step) / steps));
      }
      if (matrix && svg) {
        const point = svg.createSVGPoint();
        graphPoints.forEach((graphPoint) => {
          point.x = graphPoint.x;
          point.y = graphPoint.y;
          const screenPoint = point.matrixTransform(matrix);
          const distance = Math.hypot(screenPoint.x - clientX, screenPoint.y - clientY);
          if (distance < nearestDistance) {
            nearestEdgeId = edgeId;
            nearestDistance = distance;
          }
        });
        return;
      }
      const rect = path.getBoundingClientRect();
      const minX = Math.min(...graphPoints.map((point) => point.x));
      const maxX = Math.max(...graphPoints.map((point) => point.x));
      const minY = Math.min(...graphPoints.map((point) => point.y));
      const maxY = Math.max(...graphPoints.map((point) => point.y));
      graphPoints.forEach((graphPoint) => {
        const xRange = Math.max(maxX - minX, 1);
        const yRange = Math.max(maxY - minY, 1);
        const screenX = rect.left + ((graphPoint.x - minX) / xRange) * rect.width;
        const screenY = rect.top + ((graphPoint.y - minY) / yRange) * rect.height;
        const distance = Math.hypot(screenX - clientX, screenY - clientY);
        if (distance < nearestDistance) {
          nearestEdgeId = edgeId;
          nearestDistance = distance;
        }
      });
      return;
    }
    const rect = path.getBoundingClientRect();
    const dx = Math.max(rect.left - clientX, 0, clientX - rect.right);
    const dy = Math.max(rect.top - clientY, 0, clientY - rect.bottom);
    const distance = Math.hypot(dx, dy);
    if (distance < nearestDistance) {
      nearestEdgeId = edgeId;
      nearestDistance = distance;
    }
  });
  return nearestEdgeId && nearestDistance <= EDGE_CLICK_DISTANCE_PX ? nearestEdgeId : null;
}

export function GraphCanvas({
  nodes,
  edges,
  showMiniMap,
  groups,
  activeConnection,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onConnectStart,
  onConnectEnd,
  onReconnect,
  onReconnectEnd,
  isValidConnection,
  setNodes,
  setEdges,
  setNodeSearch,
  setWorkflowMenuOpen,
  setNodeContextMenu,
  setGroupContextMenu,
  openNodeSearch,
}: {
  nodes: StudioNode[];
  edges: StudioEdge[];
  showMiniMap: boolean;
  groups: GraphGroup[];
  activeConnection: StudioNode["data"]["activeConnection"];
  onNodesChange: OnNodesChange<StudioNode>;
  onEdgesChange: OnEdgesChange<StudioEdge>;
  onConnect: OnConnect;
  onConnectStart: OnConnectStart;
  onConnectEnd: OnConnectEnd;
  onReconnect: (oldEdge: StudioEdge, newConnection: Connection) => void;
  onReconnectEnd: (event: MouseEvent | TouchEvent, edge: StudioEdge, handleType: string, connectionState: { isValid: boolean | null; toHandle?: unknown }) => void;
  isValidConnection: (connection: Connection | Edge) => boolean;
  setNodes: (updater: (current: StudioNode[]) => StudioNode[]) => void;
  setEdges: (updater: (current: StudioEdge[]) => StudioEdge[]) => void;
  setNodeSearch: (value: GraphNodeSearchPopoverState | null) => void;
  setWorkflowMenuOpen: (value: false) => void;
  setNodeContextMenu: (value: { nodeIds: string[]; anchorNodeId: string; x: number; y: number } | null) => void;
  setGroupContextMenu: (value: { groupId: string; x: number; y: number } | null) => void;
  openNodeSearch: (x: number, y: number, connection?: GraphNodeSearchPopoverState["connection"]) => void;
}) {
  const [deleteEdgeId, setDeleteEdgeId] = useState<string | null>(null);
  const connectionWasActive = useRef(false);
  const suppressEdgeSelectionUntil = useRef(0);
  const interactionConfig = useMemo(() => graphCanvasInteractionConfig(), []);
  const defaultEdgeOptions = useMemo(() => DEFAULT_EDGE_OPTIONS, []);
  const proOptions = useMemo(() => PRO_OPTIONS, []);
  const connectionLineStyle = useMemo(
    () => (activeConnection ? graphEdgeStyleForPortType(activeConnection.portType) : undefined),
    [activeConnection?.portType],
  );
  const isEdgeSelectionSuppressed = () => Date.now() < suppressEdgeSelectionUntil.current;
  const renderedEdges = useMemo(
    () =>
      edges.map((edge) => ({
        ...edge,
        className: `${edge.className ?? ""} ${deleteEdgeId === edge.id ? "graph-edge-delete-armed" : ""}`.trim(),
        type: edge.type ?? "graphEdge",
        data: {
          ...(edge.data && typeof edge.data === "object" ? edge.data : {}),
          deleteArmed: deleteEdgeId === edge.id,
          onDelete: (edgeId: string) => {
            setEdges((current) => current.filter((item) => item.id !== edgeId));
            setDeleteEdgeId(null);
          },
        },
      })),
    [deleteEdgeId, edges, setEdges],
  );
  useEffect(() => {
    if (activeConnection) {
      connectionWasActive.current = true;
      return;
    }
    if (!connectionWasActive.current) return;
    connectionWasActive.current = false;
    suppressEdgeSelectionUntil.current = Date.now() + EDGE_SELECTION_SUPPRESS_MS;
    setDeleteEdgeId(null);
    const clearSelectedEdges = () => {
      setDeleteEdgeId(null);
      setEdges((current) => current.map((edge) => (edge.selected ? { ...edge, selected: false } : edge)));
    };
    const frame = window.requestAnimationFrame(clearSelectedEdges);
    const delayed = window.setTimeout(clearSelectedEdges, 120);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(delayed);
    };
  }, [activeConnection, setEdges]);

  const handleNodeClick = useCallback(
    (event: ReactMouseEvent, node: StudioNode) => {
      if (!event.shiftKey && !event.metaKey && !event.ctrlKey) return;
      event.preventDefault();
      event.stopPropagation();
      const selectedIds = new Set(nodes.filter((item) => item.selected).map((item) => item.id));
      if (selectedIds.has(node.id)) {
        selectedIds.delete(node.id);
      } else {
        selectedIds.add(node.id);
      }
      setNodes((current) => current.map((item) => ({ ...item, selected: selectedIds.has(item.id) })));
    },
    [nodes, setNodes],
  );

  const openNodeContextMenuAt = useCallback(
    (node: StudioNode, x: number, y: number) => {
      const nodeIds = contextMenuTargetNodeIds(nodes, node.id);
      if (!node.selected) {
        setNodes((current) => current.map((item) => ({ ...item, selected: item.id === node.id })));
      }
      setNodeContextMenu({ nodeIds, anchorNodeId: node.id, x, y });
      setNodeSearch(null);
      setWorkflowMenuOpen(false);
    },
    [nodes, setNodeContextMenu, setNodeSearch, setNodes, setWorkflowMenuOpen],
  );

  const handleNodeContextMenu = useCallback(
    (event: ReactMouseEvent, node: StudioNode) => {
      if (isTextEntryTarget(event.target)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      openNodeContextMenuAt(node, event.clientX, event.clientY);
    },
    [openNodeContextMenuAt],
  );

  const handleEdgeClick = useCallback(
    (event: ReactMouseEvent, edge: StudioEdge) => {
      event.preventDefault();
      event.stopPropagation();
      if (isEdgeSelectionSuppressed()) {
        setDeleteEdgeId(null);
        setEdges((current) => current.map((item) => (item.selected ? { ...item, selected: false } : item)));
        return;
      }
      setDeleteEdgeId(edge.id);
    },
    [setEdges],
  );

  const handlePaneClick = useCallback(
    (event: ReactMouseEvent) => {
      if (isEdgeSelectionSuppressed()) {
        setDeleteEdgeId(null);
        return;
      }
      const nearestEdgeId = nearestGraphEdgeIdFromPoint(event.clientX, event.clientY);
      if (nearestEdgeId) {
        setDeleteEdgeId(nearestEdgeId);
        setNodeSearch(null);
        setWorkflowMenuOpen(false);
        setNodeContextMenu(null);
        setGroupContextMenu(null);
        return;
      }
      setDeleteEdgeId(null);
      setNodeSearch(null);
      setWorkflowMenuOpen(false);
      setNodeContextMenu(null);
      setGroupContextMenu(null);
    },
    [setGroupContextMenu, setNodeContextMenu, setNodeSearch, setWorkflowMenuOpen],
  );

  return (
    <div
      className="graph-canvas"
      data-testid="graph-canvas"
      onClickCapture={(event) => {
        if (activeConnection) return;
        if (isEdgeSelectionSuppressed()) {
          setDeleteEdgeId(null);
          return;
        }
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest(EDGE_CLICK_IGNORED_TARGETS)) return;
        const nearestEdgeId = nearestGraphEdgeIdFromPoint(event.clientX, event.clientY);
        if (!nearestEdgeId) return;
        event.preventDefault();
        event.stopPropagation();
        setDeleteEdgeId(nearestEdgeId);
        setNodeSearch(null);
        setWorkflowMenuOpen(false);
        setNodeContextMenu(null);
        setGroupContextMenu(null);
      }}
      onContextMenuCapture={(event) => {
        if (activeConnection) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (
          event.target instanceof HTMLElement &&
          event.target.closest(".react-flow__node, .react-flow__controls, .react-flow__minimap, .react-flow__handle, [data-input-port]")
        ) {
          return;
        }
        const nodeIdAtPoint = graphNodeIdFromPoint(event.clientX, event.clientY);
        const nodeAtPoint = nodeIdAtPoint ? nodes.find((node) => node.id === nodeIdAtPoint) : null;
        if (nodeAtPoint) {
          event.preventDefault();
          event.stopPropagation();
          openNodeContextMenuAt(nodeAtPoint, event.clientX, event.clientY);
          setGroupContextMenu(null);
          return;
        }
        event.preventDefault();
        setNodeContextMenu(null);
        setGroupContextMenu(null);
        openNodeSearch(event.clientX, event.clientY);
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={renderedEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        onNodeContextMenu={handleNodeContextMenu}
        onEdgeClick={handleEdgeClick}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onReconnect={onReconnect}
        onReconnectEnd={onReconnectEnd}
        isValidConnection={isValidConnection}
        connectionMode={ConnectionMode.Loose}
        defaultEdgeOptions={defaultEdgeOptions}
        edgesReconnectable
        reconnectRadius={26}
        connectionLineStyle={connectionLineStyle}
        selectionKeyCode={interactionConfig.selectionKeyCode}
        multiSelectionKeyCode={interactionConfig.multiSelectionKeyCode}
        selectionMode={SelectionMode.Partial}
        selectionOnDrag={interactionConfig.selectionOnDrag}
        panOnDrag={interactionConfig.panOnDrag}
        minZoom={0.12}
        maxZoom={2}
        proOptions={proOptions}
        onPaneClick={handlePaneClick}
        fitView
      >
        <ViewportPortal>
          {groups.map((group) => {
            const color = NODE_COLOR_CHOICES.find((choice) => choice.id === group.color) ?? NODE_COLOR_CHOICES[0];
            return (
              <GraphGroupFrame
                key={group.id}
                group={group}
                color={color}
                onContextMenu={(event, targetGroup) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setNodeSearch(null);
                  setNodeContextMenu(null);
                  setWorkflowMenuOpen(false);
                  setGroupContextMenu({ groupId: targetGroup.id, x: event.clientX, y: event.clientY });
                }}
              />
            );
          })}
        </ViewportPortal>
        <Background />
        {showMiniMap ? <MiniMap pannable zoomable /> : null}
        <Controls />
      </ReactFlow>
    </div>
  );
}
