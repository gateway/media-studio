"use client";

import { Layers, Trash2 } from "lucide-react";

import { GraphColorChoiceGrid, GraphExecutionModeControls, graphExecutionMenuLabels } from "./graph-context-menu-controls";
import type { GraphNodeColorChoice } from "./graph-node-context-menu";
import type { GraphExecutionMode } from "./utils/graph-node-execution";

export function GraphGroupContextMenu({
  x,
  y,
  title,
  titleDraft,
  colors,
  executionMode,
  onTitleDraftChange,
  onCommitTitle,
  onSelectColor,
  onSetExecutionMode,
  onDelete,
}: {
  x: number;
  y: number;
  title: string;
  titleDraft: string;
  colors: GraphNodeColorChoice[];
  executionMode: GraphExecutionMode;
  onTitleDraftChange: (value: string) => void;
  onCommitTitle: () => void;
  onSelectColor: (color: GraphNodeColorChoice) => void;
  onSetExecutionMode: (mode: GraphExecutionMode) => void;
  onDelete: () => void;
}) {
  const labels = graphExecutionMenuLabels("group");
  return (
    <div className="graph-node-context-menu graph-group-context-menu" data-testid="graph-group-context-menu" style={{ left: x, top: y }} role="menu">
      <div className="graph-node-context-title">
        <Layers size={12} />
        <span>{title}</span>
      </div>
      <div className="graph-node-context-section">
        <span>Group name</span>
        <input
          className="graph-group-title-input"
          value={titleDraft}
          onChange={(event) => onTitleDraftChange(event.target.value)}
          onBlur={onCommitTitle}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onCommitTitle();
            }
          }}
        />
      </div>
      <div className="graph-node-context-section">
        <span>Execution</span>
        <GraphExecutionModeControls
          ariaLabel="Group execution mode"
          executionMode={executionMode}
          labels={labels}
          onSetExecutionMode={onSetExecutionMode}
        />
      </div>
      <div className="graph-node-context-section">
        <span>Color</span>
        <GraphColorChoiceGrid
          ariaLabel="Group colors"
          colors={colors}
          targetLabel="group"
          onSelectColor={onSelectColor}
        />
      </div>
      <button type="button" role="menuitem" onClick={onDelete}>
        <Trash2 size={14} />
        Ungroup
      </button>
    </div>
  );
}
