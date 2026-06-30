"use client";

import Link from "next/link";
import { Blocks, GalleryHorizontalEnd, History, Images, Map as MapIcon, MessageSquare, SquareTerminal, Workflow } from "lucide-react";

type SidebarDialog = "workflows" | "nodes" | "images" | "runs";

export function GraphLeftRail({
  sidebarDialog,
  showMiniMap,
  consoleOpen,
  assistantOpen,
  assistantEnabled = false,
  galleryHref,
  onToggleDialog,
  onToggleMiniMap,
  onToggleConsole,
  onToggleAssistant,
}: {
  sidebarDialog: SidebarDialog | null;
  showMiniMap: boolean;
  consoleOpen: boolean;
  assistantOpen: boolean;
  assistantEnabled?: boolean;
  galleryHref: string;
  onToggleDialog: (dialog: SidebarDialog) => void;
  onToggleMiniMap: () => void;
  onToggleConsole: () => void;
  onToggleAssistant: () => void;
}) {
  return (
    <aside className="graph-sidebar" aria-label="Graph Studio tools">
      <Link
        className="graph-sidebar-icon"
        data-testid="graph-sidebar-gallery-link"
        href={galleryHref}
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
      {assistantEnabled ? (
        <button
          className={`graph-sidebar-icon ${assistantOpen ? "graph-sidebar-icon-active" : ""}`}
          data-testid="graph-sidebar-assistant-button"
          type="button"
          aria-label={assistantOpen ? "Hide Media Assistant" : "Show Media Assistant"}
          title={assistantOpen ? "Hide Media Assistant" : "Media Assistant"}
          onClick={onToggleAssistant}
        >
          <MessageSquare size={19} />
        </button>
      ) : null}
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
      <button
        className={`graph-sidebar-icon ${consoleOpen ? "graph-sidebar-icon-active" : ""}`}
        data-testid="graph-sidebar-console-button"
        type="button"
        aria-label={consoleOpen ? "Hide console" : "Show console"}
        title={consoleOpen ? "Hide console" : "Show console"}
        onClick={onToggleConsole}
      >
        <SquareTerminal size={19} />
      </button>
    </aside>
  );
}
