import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";

export type AssistantPlacement = "right" | "floating";
const STORAGE_KEY = "media-studio:graph-studio:assistant-layout";
const MIN_WIDTH = 320;
const GRAPH_MIN_WIDTH = 480;

function readPreference(): { placement: AssistantPlacement; width: number } {
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null");
    return {
      placement: value?.placement === "floating" ? "floating" : "right",
      width: typeof value?.width === "number" && Number.isFinite(value.width)
        ? Math.max(MIN_WIDTH, value.width) : 420,
    };
  } catch {
    return { placement: "right", width: 420 };
  }
}

/** Layout preferences never enter the workflow or assistant session state. */
export function useAssistantDock(open: boolean) {
  const containerRef = useRef<HTMLElement>(null);
  const [preference, setPreference] = useState<{ placement: AssistantPlacement; width: number }>({ placement: "right", width: 420 });
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { setPreference(readPreference()); setLoaded(true); }, []);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [minimized, setMinimized] = useState(false);
  const drag = useRef<{ pointerId: number; x: number; width: number } | null>(null);
  const maxWidth = Math.max(MIN_WIDTH, Math.floor(availableWidth - GRAPH_MIN_WIDTH));
  const width = Math.min(preference.width, maxWidth);
  const docked = open && !minimized && preference.placement === "right" && availableWidth >= MIN_WIDTH + GRAPH_MIN_WIDTH;

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setAvailableWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preference)); }
    catch { /* Layout remains usable when browser storage is unavailable. */ }
  }, [preference, loaded]);
  useEffect(() => { drag.current = null; }, [docked, maxWidth]);

  function resize(next: number) {
    setPreference((current) => ({ ...current, width: Math.max(MIN_WIDTH, Math.min(maxWidth, next)) }));
  }
  return {
    containerRef, width, docked, placement: preference.placement, setMinimized,
    setPlacement: (placement: AssistantPlacement) => setPreference((current) => ({ ...current, placement })),
    splitterProps: {
      role: "separator", tabIndex: 0,
      "aria-label": "Resize Media Assistant", "aria-orientation": "vertical" as const,
      "aria-valuemin": MIN_WIDTH, "aria-valuemax": maxWidth, "aria-valuenow": width,
      onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        event.preventDefault(); event.stopPropagation();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointerId: event.pointerId, x: event.clientX, width };
      },
      onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
        if (!drag.current || drag.current.pointerId !== event.pointerId) return;
        resize(drag.current.width + drag.current.x - event.clientX);
      },
      onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
        drag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      },
      onPointerCancel: () => { drag.current = null; },
      onLostPointerCapture: () => { drag.current = null; },
      onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
        const step = event.shiftKey ? 50 : 10;
        const next = { ArrowLeft: width + step, ArrowRight: width - step, Home: MIN_WIDTH, End: maxWidth }[event.key];
        if (next === undefined) return;
        event.preventDefault(); event.stopPropagation(); resize(next);
      },
    },
  };
}
