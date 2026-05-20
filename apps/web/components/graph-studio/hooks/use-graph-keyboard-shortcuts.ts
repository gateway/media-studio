import { useEffect } from "react";

import type { StudioNode } from "../types";
import type { GraphExecutionMode } from "../utils/graph-node-execution";
import { isTextEntryTarget } from "../utils/graph-media-preview";

export function useGraphKeyboardShortcuts({
  nodes,
  imageLibraryNodeId,
  copySelectedNodes,
  pasteCopiedNodes,
  undoGraphChange,
  redoGraphChange,
  toggleGraphNodeExecutionMode,
  setConsoleOpen,
  setNodeSearch,
  setImageLibraryNodeId,
  setPreviewOverlay,
  setSidebarDialog,
  setWorkflowMenuOpen,
  setRenameDialogOpen,
  setNodeContextMenu,
  cancelNodeRename,
  openNodeSearchCentered,
}: {
  nodes: StudioNode[];
  imageLibraryNodeId: string | null;
  copySelectedNodes: () => void;
  pasteCopiedNodes: () => void;
  undoGraphChange: () => boolean;
  redoGraphChange: () => boolean;
  toggleGraphNodeExecutionMode: (nodeIds: string[], mode: GraphExecutionMode) => void;
  setConsoleOpen: (updater: (current: boolean) => boolean) => void;
  setNodeSearch: (value: null) => void;
  setImageLibraryNodeId: (value: null) => void;
  setPreviewOverlay: (value: null) => void;
  setSidebarDialog: (value: null) => void;
  setWorkflowMenuOpen: (value: false) => void;
  setRenameDialogOpen: (value: false) => void;
  setNodeContextMenu: (value: null) => void;
  cancelNodeRename: () => void;
  openNodeSearchCentered: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isCopyPasteModifier = event.metaKey || event.ctrlKey;
      if (isCopyPasteModifier && !isTextEntryTarget(event.target)) {
        const key = event.key.toLowerCase();
        if (key === "z") {
          event.preventDefault();
          if (event.shiftKey) {
            redoGraphChange();
          } else {
            undoGraphChange();
          }
          return;
        }
        if (key === "y") {
          event.preventDefault();
          redoGraphChange();
          return;
        }
        if (key === "c") {
          event.preventDefault();
          copySelectedNodes();
          return;
        }
        if (key === "v") {
          event.preventDefault();
          pasteCopiedNodes();
          return;
        }
        if (key === "m") {
          const selectedIds = nodes.filter((node) => node.selected).map((node) => node.id);
          if (selectedIds.length) {
            event.preventDefault();
            toggleGraphNodeExecutionMode(selectedIds, "frozen");
          }
          return;
        }
      }
      if (event.key === "Escape") {
        setNodeSearch(null);
        setImageLibraryNodeId(null);
        setPreviewOverlay(null);
        setSidebarDialog(null);
        setWorkflowMenuOpen(false);
        setRenameDialogOpen(false);
        setNodeContextMenu(null);
        cancelNodeRename();
        return;
      }
      if (imageLibraryNodeId) return;
      if (isTextEntryTarget(event.target)) return;
      if (event.key.toLowerCase() === "c") {
        event.preventDefault();
        setConsoleOpen((current) => !current);
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        openNodeSearchCentered();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    cancelNodeRename,
    copySelectedNodes,
    imageLibraryNodeId,
    nodes,
    openNodeSearchCentered,
    pasteCopiedNodes,
    redoGraphChange,
    setConsoleOpen,
    setImageLibraryNodeId,
    setNodeContextMenu,
    setNodeSearch,
    setPreviewOverlay,
    setRenameDialogOpen,
    setSidebarDialog,
    setWorkflowMenuOpen,
    toggleGraphNodeExecutionMode,
    undoGraphChange,
  ]);
}
