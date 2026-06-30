"use client";

import type { ReactNode } from "react";

export function GraphSectionTitle({ children }: { children: ReactNode }) {
  return <div className="graph-section-title">{children}</div>;
}

export function GraphSidebarEmpty({ children }: { children: ReactNode }) {
  return <div className="graph-sidebar-empty">{children}</div>;
}

export function GraphDialogRowIcon({ children }: { children: ReactNode }) {
  return <span className="graph-dialog-row-icon">{children}</span>;
}
