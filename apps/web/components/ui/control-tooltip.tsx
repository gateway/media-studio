import type { ReactNode } from "react";

export function ControlTooltip({ children }: { children: ReactNode }) {
  return (
    <span className="control-tooltip" aria-hidden="true">
      {children}
    </span>
  );
}
