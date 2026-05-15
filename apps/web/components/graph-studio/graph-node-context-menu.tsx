"use client";

import { Eraser, Layers, Pencil } from "lucide-react";
import type { CSSProperties } from "react";
import type { GraphExecutionMode } from "./utils/graph-node-execution";

export type GraphNodeColorChoice = {
  id: string;
  label: string;
  accent: string;
  surface: string;
  header: string;
};

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
  const primaryExecutionModes: GraphExecutionMode[] = ["enabled", "frozen"];
  const executionMenuLabels: Record<GraphExecutionMode, string> = {
    enabled: "Enabled",
    frozen: targetCount > 1 ? "Mute selected" : "Mute",
    bypassed: "Advanced: Bypass",
    muted: "Legacy: Disable output",
  };
  return (
    <div className="graph-node-context-menu" data-testid="graph-node-context-menu" style={{ left: x, top: y }} role="menu">
      <div className="graph-node-context-title">{targetCount > 1 ? `${targetCount} selected nodes` : "Node"}</div>
      <div className="graph-node-context-section">
        <span>Execution</span>
        <div className="graph-node-execution-grid" role="group" aria-label="Node execution mode">
          {primaryExecutionModes.map((mode) => (
            <button
              key={mode}
              type="button"
              className={mode === executionMode ? "graph-node-execution-choice graph-node-execution-choice-active" : "graph-node-execution-choice"}
              onClick={() => onSetExecutionMode(mode)}
            >
              {executionMenuLabels[mode]}
            </button>
          ))}
        </div>
        {executionMode === "bypassed" || executionMode === "muted" ? (
          <button
            type="button"
            className="graph-node-execution-choice graph-node-execution-choice-active"
            onClick={() => onSetExecutionMode(executionMode)}
          >
            {executionMenuLabels[executionMode]}
          </button>
        ) : null}
      </div>
      <div className="graph-node-context-section">
        <span>Color</span>
        <div className="graph-node-color-grid" role="group" aria-label="Node colors">
          {colors.map((color) => (
            <button
              key={color.id}
              type="button"
              className="graph-node-color-choice"
              style={{ "--graph-node-choice-color": color.accent, "--graph-node-choice-surface": color.surface } as CSSProperties}
              aria-label={`Set node color ${color.label}`}
              title={color.label}
              onClick={() => onSelectColor(color)}
            />
          ))}
        </div>
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
