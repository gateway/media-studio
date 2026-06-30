"use client";

import type { CSSProperties } from "react";

import type { GraphExecutionMode } from "./utils/graph-node-execution";

export type GraphNodeColorChoice = {
  id: string;
  label: string;
  accent: string;
  surface: string;
  header: string;
};

const PRIMARY_EXECUTION_MODES: GraphExecutionMode[] = ["enabled", "frozen"];

export function graphExecutionMenuLabels(target: "node" | "group", targetCount = 1): Record<GraphExecutionMode, string> {
  return {
    enabled: "Enabled",
    frozen: target === "group" ? "Mute group" : targetCount > 1 ? "Mute selected" : "Mute",
    bypassed: "Advanced: Bypass",
    muted: "Legacy: Disable output",
  };
}

export function GraphExecutionModeControls({
  ariaLabel,
  executionMode,
  labels,
  onSetExecutionMode,
}: {
  ariaLabel: string;
  executionMode: GraphExecutionMode;
  labels: Record<GraphExecutionMode, string>;
  onSetExecutionMode: (mode: GraphExecutionMode) => void;
}) {
  const legacyModeVisible = executionMode === "bypassed" || executionMode === "muted";

  return (
    <>
      <div className="graph-node-execution-grid" role="group" aria-label={ariaLabel}>
        {PRIMARY_EXECUTION_MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            className={
              mode === executionMode
                ? "graph-node-execution-choice graph-node-execution-choice-active"
                : "graph-node-execution-choice"
            }
            onClick={() => onSetExecutionMode(mode)}
          >
            {labels[mode]}
          </button>
        ))}
      </div>
      {legacyModeVisible ? (
        <button
          type="button"
          className="graph-node-execution-choice graph-node-execution-choice-active"
          onClick={() => onSetExecutionMode(executionMode)}
        >
          {labels[executionMode]}
        </button>
      ) : null}
    </>
  );
}

export function GraphColorChoiceGrid({
  ariaLabel,
  colors,
  targetLabel,
  onSelectColor,
}: {
  ariaLabel: string;
  colors: GraphNodeColorChoice[];
  targetLabel: "node" | "group";
  onSelectColor: (color: GraphNodeColorChoice) => void;
}) {
  return (
    <div className="graph-node-color-grid" role="group" aria-label={ariaLabel}>
      {colors.map((color) => (
        <button
          key={color.id}
          type="button"
          className="graph-node-color-choice"
          style={{ "--graph-node-choice-color": color.accent, "--graph-node-choice-surface": color.surface } as CSSProperties}
          aria-label={`Set ${targetLabel} color ${color.label}`}
          title={color.label}
          onClick={() => onSelectColor(color)}
        />
      ))}
    </div>
  );
}
