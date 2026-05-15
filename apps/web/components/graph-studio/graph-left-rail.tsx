"use client";

import Link from "next/link";
import { Blocks, GalleryHorizontalEnd, History, Images, Map as MapIcon, Workflow } from "lucide-react";

type SidebarDialog = "workflows" | "nodes" | "images" | "runs";

export function GraphLeftRail({
  sidebarDialog,
  showMiniMap,
  onToggleDialog,
  onToggleMiniMap,
}: {
  sidebarDialog: SidebarDialog | null;
  showMiniMap: boolean;
  onToggleDialog: (dialog: SidebarDialog) => void;
  onToggleMiniMap: () => void;
}) {
  return (
    <aside className="graph-sidebar" aria-label="Graph Studio tools">
      <Link
        className="graph-sidebar-icon"
        data-testid="graph-sidebar-gallery-link"
        href="/studio"
        aria-label="Back to gallery"
        title="Gallery"
      >
        <GalleryHorizontalEnd size={19} />
      </Link>
      <button
        className={`graph-sidebar-icon ${sidebarDialog === "workflows" ? "graph-sidebar-icon-active" : ""}`}
        data-testid="graph-sidebar-workflows-button"
        type="button"
        aria-label="Open workflows"
        title="Workflows"
        onClick={() => onToggleDialog("workflows")}
      >
        <Workflow size={19} />
      </button>
      <button
        className={`graph-sidebar-icon ${sidebarDialog === "nodes" ? "graph-sidebar-icon-active" : ""}`}
        data-testid="graph-sidebar-nodes-button"
        type="button"
        aria-label="Open nodes"
        title="Nodes"
        onClick={() => onToggleDialog("nodes")}
      >
        <Blocks size={19} />
      </button>
      <button
        className={`graph-sidebar-icon ${sidebarDialog === "images" ? "graph-sidebar-icon-active" : ""}`}
        data-testid="graph-sidebar-images-button"
        type="button"
        aria-label="Open images"
        title="Images"
        onClick={() => onToggleDialog("images")}
      >
        <Images size={19} />
      </button>
      <button
        className={`graph-sidebar-icon ${sidebarDialog === "runs" ? "graph-sidebar-icon-active" : ""}`}
        data-testid="graph-sidebar-runs-button"
        type="button"
        aria-label="Open run history"
        title="Run history"
        onClick={() => onToggleDialog("runs")}
      >
        <History size={19} />
      </button>
      <button
        className={`graph-sidebar-icon ${showMiniMap ? "graph-sidebar-icon-active" : ""}`}
        data-testid="graph-sidebar-minimap-button"
        type="button"
        aria-label={showMiniMap ? "Hide minimap" : "Show minimap"}
        title={showMiniMap ? "Hide minimap" : "Show minimap"}
        onClick={onToggleMiniMap}
      >
        <MapIcon size={19} />
      </button>
    </aside>
  );
}
