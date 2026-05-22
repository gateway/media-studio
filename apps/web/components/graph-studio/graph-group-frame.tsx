"use client";

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";

import type { GraphNodeColorChoice } from "./graph-node-context-menu";
import type { GraphGroup } from "./types";
import { dispatchGraphGroupMove, dispatchGraphGroupRename, dispatchGraphGroupResize } from "./utils/graph-groups";
import { normalizeGraphExecutionMode } from "./utils/graph-node-execution";

function viewportZoom(element: HTMLElement): number {
  const transform = getComputedStyle(element.closest(".react-flow__viewport") ?? element).transform;
  const match = transform.match(/^matrix\(([^,]+)/);
  const zoom = match ? Number.parseFloat(match[1]) : 1;
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

export function GraphGroupFrame({
  group,
  color,
  onContextMenu,
}: {
  group: GraphGroup;
  color: GraphNodeColorChoice;
  onContextMenu: (event: MouseEvent, group: GraphGroup) => void;
}) {
  const mode = normalizeGraphExecutionMode(group.execution?.mode);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const resizeStart = useRef<{ x: number; y: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(group.title);
  useEffect(() => {
    if (!editing) setTitleDraft(group.title);
  }, [editing, group.title]);
  const commitRename = () => {
    dispatchGraphGroupRename({ groupId: group.id, title: titleDraft });
    setEditing(false);
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStart.current = { x: event.clientX, y: event.clientY };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return;
    event.preventDefault();
    event.stopPropagation();
    const zoom = viewportZoom(event.currentTarget);
    const delta = { x: (event.clientX - dragStart.current.x) / zoom, y: (event.clientY - dragStart.current.y) / zoom };
    if (Math.abs(delta.x) < 0.5 && Math.abs(delta.y) < 0.5) return;
    dragStart.current = { x: event.clientX, y: event.clientY };
    dispatchGraphGroupMove({ groupId: group.id, delta });
  };
  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    dragStart.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };
  const onResizePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeStart.current = { x: event.clientX, y: event.clientY };
  };
  const onResizePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!resizeStart.current) return;
    event.preventDefault();
    event.stopPropagation();
    const zoom = viewportZoom(event.currentTarget);
    const delta = { width: (event.clientX - resizeStart.current.x) / zoom, height: (event.clientY - resizeStart.current.y) / zoom };
    if (Math.abs(delta.width) < 0.5 && Math.abs(delta.height) < 0.5) return;
    resizeStart.current = { x: event.clientX, y: event.clientY };
    dispatchGraphGroupResize({ groupId: group.id, delta });
  };
  const onResizePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    resizeStart.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };
  const frameStyle = {
    left: group.bounds.x,
    top: group.bounds.y,
    width: group.bounds.width,
    height: group.bounds.height,
    "--graph-group-accent": color.accent,
    "--graph-group-surface": color.surface,
  } as CSSProperties;
  const titleStyle = {
    left: group.bounds.x,
    top: group.bounds.y,
    width: group.bounds.width,
    "--graph-group-accent": color.accent,
    "--graph-group-surface": color.surface,
  } as CSSProperties;
  const resizeStyle = {
    left: group.bounds.x + group.bounds.width,
    top: group.bounds.y + group.bounds.height,
  } as CSSProperties;
  return (
    <>
      <div className={`graph-group-frame graph-group-frame-${mode}`} data-testid="graph-group-frame" style={frameStyle} />
      <div
        className="graph-group-frame-title"
        style={titleStyle}
        onContextMenu={(event) => onContextMenu(event, group)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        {editing ? (
          <input
            className="graph-group-frame-title-input nodrag nopan"
            autoFocus
            value={titleDraft}
            onPointerDown={(event) => event.stopPropagation()}
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitRename();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setTitleDraft(group.title);
                setEditing(false);
              }
            }}
          />
        ) : (
          <span
            onPointerDown={(event) => {
              if (event.button === 0) event.stopPropagation();
            }}
            onClick={(event) => {
              event.stopPropagation();
              setEditing(true);
            }}
          >
            {group.title}
          </span>
        )}
        {mode !== "enabled" ? <small>{mode}</small> : null}
      </div>
      <div
        className="graph-group-resize-handle"
        data-testid="graph-group-resize-handle"
        style={resizeStyle}
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerEnd}
        onPointerCancel={onResizePointerEnd}
      />
    </>
  );
}
