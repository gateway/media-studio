"use client";

import { Layers, Trash2 } from "lucide-react";
import type { CSSProperties } from "react";

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
  const primaryExecutionModes: GraphExecutionMode[] = ["enabled", "frozen"];
  const labels: Record<GraphExecutionMode, string> = {
    enabled: "Enabled",
    frozen: "Mute group",
    bypassed: "Advanced: Bypass",
    muted: "Legacy: Disable output",
  };
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
        <div className="graph-node-execution-grid" role="group" aria-label="Group execution mode">
          {primaryExecutionModes.map((mode) => (
            <button
              key={mode}
              type="button"
              className={mode === executionMode ? "graph-node-execution-choice graph-node-execution-choice-active" : "graph-node-execution-choice"}
              onClick={() => onSetExecutionMode(mode)}
            >
              {labels[mode]}
            </button>
          ))}
        </div>
        {executionMode === "bypassed" || executionMode === "muted" ? (
          <button
            type="button"
            className="graph-node-execution-choice graph-node-execution-choice-active"
            onClick={() => onSetExecutionMode(executionMode)}
          >
            {labels[executionMode]}
          </button>
        ) : null}
      </div>
      <div className="graph-node-context-section">
        <span>Color</span>
        <div className="graph-node-color-grid" role="group" aria-label="Group colors">
          {colors.map((color) => (
            <button
              key={color.id}
              type="button"
              className="graph-node-color-choice"
              style={{ "--graph-node-choice-color": color.accent, "--graph-node-choice-surface": color.surface } as CSSProperties}
              aria-label={`Set group color ${color.label}`}
              title={color.label}
              onClick={() => onSelectColor(color)}
            />
          ))}
        </div>
      </div>
      <button type="button" role="menuitem" onClick={onDelete}>
        <Trash2 size={14} />
        Ungroup
      </button>
    </div>
  );
}
