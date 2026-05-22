"use client";

import { useState } from "react";

export function useGraphWorkflowMenuState() {
  const [workflowMenuOpen, setWorkflowMenuOpen] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");

  return {
    workflowMenuOpen,
    setWorkflowMenuOpen,
    renameDialogOpen,
    setRenameDialogOpen,
    renameDraft,
    setRenameDraft,
    closeWorkflowMenu: () => setWorkflowMenuOpen(false),
    toggleWorkflowMenu: () => setWorkflowMenuOpen((current) => !current),
    closeRenameDialog: () => setRenameDialogOpen(false),
  };
}
