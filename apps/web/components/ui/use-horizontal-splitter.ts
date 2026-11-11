"use client";

import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

export function useHorizontalSplitter({
  label,
  width,
  minWidth,
  maxWidth,
  growTowards,
  enabled,
  onResize,
}: {
  label: string;
  width: number;
  minWidth: number;
  maxWidth: number;
  growTowards: "left" | "right";
  enabled: boolean;
  onResize: (width: number) => void;
}) {
  const drag = useRef<{ pointerId: number; x: number; width: number } | null>(
    null,
  );
  const direction = growTowards === "right" ? 1 : -1;
  useEffect(() => {
    drag.current = null;
  }, [enabled, maxWidth]);

  function resize(next: number) {
    onResize(Math.max(minWidth, Math.min(maxWidth, next)));
  }

  return {
    role: "separator",
    tabIndex: 0,
    "aria-label": label,
    "aria-orientation": "vertical" as const,
    "aria-valuemin": minWidth,
    "aria-valuemax": maxWidth,
    "aria-valuenow": width,
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { pointerId: event.pointerId, x: event.clientX, width };
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      if (!drag.current || drag.current.pointerId !== event.pointerId) return;
      resize(drag.current.width + direction * (event.clientX - drag.current.x));
    },
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
      if (!drag.current || drag.current.pointerId !== event.pointerId) return;
      drag.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
    },
    onPointerCancel: () => {
      drag.current = null;
    },
    onLostPointerCapture: () => {
      drag.current = null;
    },
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      const step = (event.shiftKey ? 50 : 10) * direction;
      const next = {
        ArrowLeft: width - step,
        ArrowRight: width + step,
        Home: minWidth,
        End: maxWidth,
      }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      resize(next);
    },
  };
}
