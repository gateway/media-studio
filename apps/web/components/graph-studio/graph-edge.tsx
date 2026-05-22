"use client";

import { BaseEdge, EdgeLabelRenderer, Position, getBezierPath, useViewport, type EdgeProps } from "@xyflow/react";

type GraphEdgeData = {
  deleteArmed?: boolean;
  onDelete?: (edgeId: string) => void;
};

const HANDLE_RADIUS = 9;

function centeredAnchor(value: number, position: Position | undefined, axis: "x" | "y") {
  if (axis === "x") {
    if (position === Position.Left) return value + HANDLE_RADIUS;
    if (position === Position.Right) return value - HANDLE_RADIUS;
    return value;
  }
  if (position === Position.Top) return value + HANDLE_RADIUS;
  if (position === Position.Bottom) return value - HANDLE_RADIUS;
  return value;
}

export function GraphEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  data,
  style,
  markerEnd,
  markerStart,
  interactionWidth,
}: EdgeProps) {
  const { zoom } = useViewport();
  const centeredSourceX = centeredAnchor(sourceX, sourcePosition, "x");
  const centeredSourceY = centeredAnchor(sourceY, sourcePosition, "y");
  const centeredTargetX = centeredAnchor(targetX, targetPosition, "x");
  const centeredTargetY = centeredAnchor(targetY, targetPosition, "y");
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX: centeredSourceX,
    sourceY: centeredSourceY,
    targetX: centeredTargetX,
    targetY: centeredTargetY,
    sourcePosition,
    targetPosition,
  });
  const edgeData = data as GraphEdgeData | undefined;
  const onDelete = typeof edgeData?.onDelete === "function" ? edgeData.onDelete : null;
  const showDeleteButton = Boolean(selected || edgeData?.deleteArmed);

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={style}
        markerEnd={markerEnd}
        markerStart={markerStart}
        interactionWidth={interactionWidth}
      />
      {showDeleteButton && onDelete ? (
        <EdgeLabelRenderer>
          <button
            aria-label="Delete wire"
            className="graph-edge-delete-button nodrag nopan"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onDelete(id);
            }}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            style={{ transform: `translate(${labelX}px, ${labelY}px) translate(-50%, -50%) scale(${1 / Math.max(zoom, 0.1)})` }}
            type="button"
          >
            x
          </button>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
