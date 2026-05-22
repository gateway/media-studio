"use client";

import type { PointerEvent as ReactPointerEvent } from "react";

function consoleLineTone(line: string) {
  if (/failed|warning|cancelled/i.test(line)) return "warning";
  if (/completed|saved asset|run completed/i.test(line)) return "success";
  if (/rendering|starting|submitted|checking|queued|processing/i.test(line)) return "active";
  if (/cached|reused|disabled|bypassed/i.test(line)) return "muted";
  return "default";
}

export function GraphConsole({
  open,
  lines,
  onResizeStart,
}: {
  open: boolean;
  lines: string[];
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  if (!open) return null;
  return (
    <>
      <div className="graph-console-resizer" data-testid="graph-console-resizer" onPointerDown={onResizeStart} />
      <section className="graph-console" data-testid="graph-console">
        {lines.map((line, index) => (
          <div className={`graph-console-line graph-console-line-${consoleLineTone(line)}`} key={`${line}-${index}`}>
            <p>{line}</p>
          </div>
        ))}
      </section>
    </>
  );
}
