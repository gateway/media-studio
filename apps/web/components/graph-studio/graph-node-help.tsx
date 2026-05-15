"use client";

import { Info } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { GraphNodeDefinition } from "./types";
import { buildGraphNodeHelpContent } from "./utils/graph-node-help";

const HELP_POPOVER_WIDTH = 320;
const HELP_POPOVER_MARGIN = 12;
const HELP_POPOVER_OFFSET = 8;

export function GraphNodeHelp({ definition }: { definition: GraphNodeDefinition }) {
  const [hovered, setHovered] = useState(false);
  const [popoverHovered, setPopoverHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState<{ left: number; top: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const closeHoverRef = useRef<number | null>(null);
  const popoverId = useId();
  const open = hovered || popoverHovered || pinned;
  const helpContent = buildGraphNodeHelpContent(definition);
  const updatePopoverPosition = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(HELP_POPOVER_WIDTH, window.innerWidth - HELP_POPOVER_MARGIN * 2);
    const left = Math.min(
      window.innerWidth - width - HELP_POPOVER_MARGIN,
      Math.max(HELP_POPOVER_MARGIN, rect.right - width),
    );
    const preferredTop = rect.bottom + HELP_POPOVER_OFFSET;
    const top = Math.min(preferredTop, window.innerHeight - HELP_POPOVER_MARGIN);
    setPopoverPosition({ left, top });
  }, []);
  const clearCloseHoverTimer = useCallback(() => {
    if (closeHoverRef.current) {
      window.clearTimeout(closeHoverRef.current);
      closeHoverRef.current = null;
    }
  }, []);
  const scheduleCloseHover = useCallback(() => {
    clearCloseHoverTimer();
    closeHoverRef.current = window.setTimeout(() => {
      setHovered(false);
      setPopoverHovered(false);
    }, 90);
  }, [clearCloseHoverTimer]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePopoverPosition();
  }, [open, updatePopoverPosition]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", updatePopoverPosition);
    window.addEventListener("scroll", updatePopoverPosition, true);
    return () => {
      window.removeEventListener("resize", updatePopoverPosition);
      window.removeEventListener("scroll", updatePopoverPosition, true);
    };
  }, [open, updatePopoverPosition]);

  useEffect(() => () => clearCloseHoverTimer(), [clearCloseHoverTimer]);
  useEffect(() => {
    const closeOtherPinnedHelp = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== popoverId) {
        setPinned(false);
        setPopoverHovered(false);
      }
    };
    window.addEventListener("graph-node-help-pin", closeOtherPinnedHelp);
    return () => window.removeEventListener("graph-node-help-pin", closeOtherPinnedHelp);
  }, [popoverId]);

  const popover =
    open && popoverPosition
      ? createPortal(
          <span
            className="graph-node-help-popover"
            id={popoverId}
            role="tooltip"
            style={{ left: popoverPosition.left, top: popoverPosition.top }}
            onMouseEnter={() => {
              clearCloseHoverTimer();
              setPopoverHovered(true);
            }}
            onMouseLeave={scheduleCloseHover}
          >
            <strong>{definition.title}</strong>
            <span>{helpContent.summary}</span>
            {helpContent.lines.map((line) => <span key={line}>{line}</span>)}
          </span>,
          document.body,
        )
      : null;

  return (
    <span
      className="graph-node-help-wrap"
      onMouseEnter={() => {
        clearCloseHoverTimer();
        setHovered(true);
      }}
      onMouseLeave={scheduleCloseHover}
    >
      <button
        ref={buttonRef}
        className="graph-node-help nodrag nopan"
        type="button"
        aria-label={`${definition.title} help`}
        aria-expanded={open}
        aria-describedby={open ? popoverId : undefined}
        onFocus={() => {
          clearCloseHoverTimer();
          setHovered(true);
        }}
        onBlur={scheduleCloseHover}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          window.dispatchEvent(new CustomEvent("graph-node-help-pin", { detail: popoverId }));
          setPinned((current) => !current);
        }}
      >
        <Info size={11} strokeWidth={2.4} />
      </button>
      {popover}
    </span>
  );
}
