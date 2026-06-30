"use client";

import { Eraser, Layers, Pencil } from "lucide-react";
import { GraphColorChoiceGrid, GraphExecutionModeControls, graphExecutionMenuLabels } from "./graph-context-menu-controls";
import type { GraphNodeColorChoice } from "./graph-context-menu-controls";
import type { GraphExecutionMode } from "./utils/graph-node-execution";

export type { GraphNodeColorChoice } from "./graph-context-menu-controls";

export function GraphNodeContextMenu({
  x,
  y,
  colors,
  targetCount,
  canRename,
  onSelectColor,
  executionMode,
  onSetExecutionMode,
  onClear,
  onRename,
  onCreateGroup,
}: {
  x: number;
  y: number;
  colors: GraphNodeColorChoice[];
  targetCount: number;
  canRename: boolean;
  onSelectColor: (color: GraphNodeColorChoice) => void;
  executionMode: GraphExecutionMode;
  onSetExecutionMode: (mode: GraphExecutionMode) => void;
  onClear: () => void;
  onRename: () => void;
  onCreateGroup?: () => void;
}) {
  const executionMenuLabels = graphExecutionMenuLabels("node", targetCount);
  return (
    <div className="graph-node-context-menu" data-testid="graph-node-context-menu" style={{ left: x, top: y }} role="menu">
      <div className="graph-node-context-title">{targetCount > 1 ? `${targetCount} selected nodes` : "Node"}</div>
      <div className="graph-node-context-section">
        <span>Execution</span>
        <GraphExecutionModeControls
          ariaLabel="Node execution mode"
          executionMode={executionMode}
          labels={executionMenuLabels}
          onSetExecutionMode={onSetExecutionMode}
        />
      </div>
      <div className="graph-node-context-section">
        <span>Color</span>
        <GraphColorChoiceGrid
          ariaLabel="Node colors"
          colors={colors}
          targetLabel="node"
          onSelectColor={onSelectColor}
        />
      </div>
      <button type="button" role="menuitem" onClick={onRename} disabled={!canRename} title={canRename ? "Rename node" : "Rename is available for one selected node"}>
        <Pencil size={14} />
        Rename
      </button>
      {targetCount > 1 && onCreateGroup ? (
        <button type="button" role="menuitem" onClick={onCreateGroup}>
          <Layers size={14} />
          Create group
        </button>
      ) : null}
      <button type="button" role="menuitem" onClick={onClear}>
        <Eraser size={14} />
        {targetCount > 1 ? "Clear selected" : "Clear node"}
      </button>
    </div>
  );
}
