"use client";

import { GripHorizontal } from "lucide-react";
import { useRef, useState } from "react";
import type { RefObject } from "react";

/** An upper-corner grip lets a bottom-anchored composer grow into the conversation. */
export function AssistantPromptInput({ inputRef, value, placeholder, onChange }: {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  const [height, setHeight] = useState<number>();
  const drag = useRef<{ pointerId: number; y: number; height: number } | null>(null);
  function resize(next: number) {
    const input = inputRef.current;
    if (!input) return;
    const style = getComputedStyle(input);
    setHeight(Math.max(parseFloat(style.minHeight), Math.min(parseFloat(style.maxHeight), next)));
  }
  return (
    <div className="graph-assistant-prompt-field">
      <textarea ref={inputRef} value={value} placeholder={placeholder}
        style={height === undefined ? undefined : { height }}
        onChange={(event) => onChange(event.target.value)} aria-label="Assistant message" />
      <button type="button" className="graph-assistant-prompt-resizer"
        aria-label="Resize prompt height" title="Drag up to expand, down to shrink. Arrow keys resize when focused."
        onPointerDown={(event) => {
          if (event.button !== 0 || !inputRef.current) return;
          event.preventDefault(); event.stopPropagation();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { pointerId: event.pointerId, y: event.clientY, height: inputRef.current.getBoundingClientRect().height };
        }}
        onPointerMove={(event) => {
          if (!drag.current || drag.current.pointerId !== event.pointerId) return;
          resize(drag.current.height + drag.current.y - event.clientY);
        }}
        onPointerUp={(event) => {
          drag.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => { drag.current = null; }}
        onLostPointerCapture={() => { drag.current = null; }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
          event.preventDefault(); event.stopPropagation();
          resize((inputRef.current?.getBoundingClientRect().height ?? 60) + (event.key === "ArrowUp" ? 20 : -20));
        }}
      ><GripHorizontal size={14} aria-hidden="true" /></button>
    </div>
  );
}
