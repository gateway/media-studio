"use client";

import { NODE_COLOR_CHOICES } from "./graph-studio-constants";
import { GraphGroupContextMenu } from "./graph-group-context-menu";
import type { GraphGroup, StudioNode } from "./types";
import type { GraphNodeColorChoice } from "./graph-node-context-menu";
import type { GraphExecutionMode } from "./utils/graph-node-execution";
import { executionModeForNodeIds } from "./utils/graph-selection";

export function GraphGroupContextMenuHost({
  contextMenu,
  groups,
  nodes,
  titleDraft,
  onTitleDraftChange,
  onRenameGroup,
  onSetGroupColor,
  onSetGroupExecutionMode,
  onDeleteGroup,
  onClose,
}: {
  contextMenu: { groupId: string; x: number; y: number } | null;
  groups: GraphGroup[];
  nodes: StudioNode[];
  titleDraft: string;
  onTitleDraftChange: (value: string) => void;
  onRenameGroup: (groupId: string, title: string) => void;
  onSetGroupColor: (groupId: string, color: GraphNodeColorChoice) => void;
  onSetGroupExecutionMode: (groupId: string, mode: GraphExecutionMode) => void;
  onDeleteGroup: (groupId: string) => void;
  onClose: () => void;
}) {
  const group = contextMenu ? groups.find((item) => item.id === contextMenu.groupId) : null;
  if (!contextMenu || !group) return null;
  return (
    <GraphGroupContextMenu
      x={contextMenu.x}
      y={contextMenu.y}
      title={group.title}
      titleDraft={titleDraft || group.title}
      colors={NODE_COLOR_CHOICES}
      executionMode={executionModeForNodeIds(nodes, group.node_ids)}
      onTitleDraftChange={onTitleDraftChange}
      onCommitTitle={() => {
        onRenameGroup(group.id, titleDraft || group.title);
        onTitleDraftChange("");
      }}
      onSelectColor={(color) => {
        onRenameGroup(group.id, titleDraft || group.title);
        onTitleDraftChange("");
        onSetGroupColor(group.id, color);
        onClose();
      }}
      onSetExecutionMode={(mode) => {
        onRenameGroup(group.id, titleDraft || group.title);
        onTitleDraftChange("");
        onSetGroupExecutionMode(group.id, mode);
        onClose();
      }}
      onDelete={() => {
        onRenameGroup(group.id, titleDraft || group.title);
        onTitleDraftChange("");
        onDeleteGroup(group.id);
        onClose();
      }}
    />
  );
}
