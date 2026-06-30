"use client";

import { CircleDollarSign, Coins, LoaderCircle, Plus, Play, Redo2, Undo2, Workflow, X } from "lucide-react";
import { humanizeGraphRunStatus } from "@/lib/status-language";
import { GraphRunDiagnostics } from "./graph-run-diagnostics";
import type { GraphEstimateResponse, GraphRun, GraphRunTransportMetrics, GraphWorkspaceTab } from "./types";
import { graphEstimateToolbarLabel, graphPricingWarningLabel } from "./utils/graph-pricing";

function compactCreditText(value: string) {
  const numericValue = Number(value.replace(/credits?/i, "").replace(/,/g, "").trim());
  if (Number.isFinite(numericValue)) {
    if (Math.abs(numericValue) >= 1000) return `${(numericValue / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })}k`;
    return numericValue.toLocaleString(undefined, { maximumFractionDigits: 1 });
  }
  return value.replace(/\s*credits?$/i, " cr");
}

function compactPricingText(value: string) {
  return value.replace(/^Graph\s+/i, "").replace(/\s*cr\b/i, "").replace(/\s+estimated$/i, "");
}

const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled"]);

function graphTabRunStatusLabel(status: string | null | undefined) {
  if (!status || TERMINAL_RUN_STATUSES.has(status)) return null;
  return humanizeGraphRunStatus(status);
}

export function GraphToolbar({
  workflowName,
  tabs,
  activeTabId,
  workflowMenuOpen,
  renameDialogOpen,
  renameDraft,
  run,
  transportMetrics,
  creditText,
  creditsUnavailable,
  graphPricing,
  onToggleWorkflowMenu,
  onCloseWorkflowMenu,
  onSwitchTab,
  onNewTab,
  onCloseTab,
  onCloseOtherTabs,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onSave,
  onSaveAs,
  onExportWorkflow,
  onExportBundle,
  onOpenRename,
  onCloseWorkflow,
  onRenameDraftChange,
  onCommitRename,
  onCancelRename,
  onRun,
  onCancelRun,
}: {
  workflowName: string;
  tabs?: GraphWorkspaceTab[];
  activeTabId?: string | null;
  workflowMenuOpen: boolean;
  renameDialogOpen: boolean;
  renameDraft: string;
  run: GraphRun | null;
  transportMetrics: GraphRunTransportMetrics;
  creditText: string;
  creditsUnavailable: boolean;
  graphPricing: GraphEstimateResponse | null;
  onToggleWorkflowMenu: () => void;
  onCloseWorkflowMenu?: () => void;
  onSwitchTab?: (tabId: string) => void;
  onNewTab?: () => void;
  onCloseTab?: (tabId: string) => void;
  onCloseOtherTabs?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onExportWorkflow: () => void;
  onExportBundle: () => void;
  onOpenRename: () => void;
  onCloseWorkflow: () => void;
  onRenameDraftChange: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onRun: () => void;
  onCancelRun?: () => void;
}) {
  const runActive = Boolean(run && !["completed", "failed", "cancelled"].includes(run.status));
  const runCancelling = run?.status === "cancelling";
  const pricingWarning = graphPricingWarningLabel(graphPricing);
  const creditLabel = compactCreditText(creditText);
  const pricingLabel = graphEstimateToolbarLabel(graphPricing);
  const compactPricingLabel = compactPricingText(pricingLabel);
  const closeActiveTabOrWorkflow = () => {
    if (tabs && tabs.length > 1 && activeTabId && onCloseTab) {
      onCloseTab(activeTabId);
      onCloseWorkflowMenu?.();
      return;
    }
    onCloseWorkflow();
    onCloseWorkflowMenu?.();
  };
  return (
    <div className="graph-toolbar">
      <div className="graph-workflow-tabs" data-testid="graph-workflow-tabs">
        {(tabs?.length ? tabs : [{ tab_id: "active", workflow_name: workflowName } as GraphWorkspaceTab]).map((tab) => {
          const active = (activeTabId ?? "active") === tab.tab_id;
          const tabRunStatus = graphTabRunStatusLabel(active ? run?.status ?? tab.run_status : tab.run_status);
          return (
            <div
              className={`graph-workflow-tab-shell ${active ? "graph-workflow-tab-active" : ""} ${tab.dirty ? "graph-workflow-tab-dirty" : ""} ${tabRunStatus ? "graph-workflow-tab-running" : ""}`}
              key={tab.tab_id}
            >
              <button
                className="graph-workflow-tab"
                type="button"
                aria-haspopup={active ? "menu" : undefined}
                aria-expanded={active ? workflowMenuOpen : undefined}
                title={tab.workflow_name || "Untitled workflow"}
                onClick={() => (active ? onToggleWorkflowMenu() : onSwitchTab?.(tab.tab_id))}
              >
                <Workflow size={15} />
                <span>{tab.workflow_name || "Untitled workflow"}</span>
                {tabRunStatus ? (
                  <small
                    className="graph-workflow-tab-indicator graph-workflow-tab-status"
                    aria-label={`Run status: ${tabRunStatus}`}
                    title={`Run status: ${tabRunStatus}`}
                  />
                ) : null}
                {tab.dirty ? (
                  <small
                    className="graph-workflow-tab-indicator graph-workflow-tab-unsaved"
                    aria-label="Unsaved workflow changes"
                    title="Unsaved workflow changes"
                  />
                ) : null}
              </button>
              {tabs && tabs.length > 1 ? (
                <button className="graph-workflow-tab-close" type="button" aria-label={`Close ${tab.workflow_name || "workflow"} tab`} onClick={() => onCloseTab?.(tab.tab_id)}>
                  <X size={12} />
                </button>
              ) : null}
            </div>
          );
        })}
        <button className="graph-workflow-tab-add" type="button" aria-label="New workflow tab" title="New workflow tab" onClick={onNewTab}>
          <Plus size={14} />
        </button>
      </div>
      {workflowMenuOpen ? (
        <div className="graph-workflow-menu" data-testid="graph-workflow-menu" role="menu">
          <button type="button" role="menuitem" onClick={onSave}>
            Save
          </button>
          <button type="button" role="menuitem" onClick={onSaveAs}>
            Save As
          </button>
          <button type="button" role="menuitem" onClick={onExportWorkflow}>
            Export Workflow
          </button>
          <button type="button" role="menuitem" onClick={onExportBundle}>
            Export Workflow Bundle
          </button>
          <button type="button" role="menuitem" onClick={onOpenRename}>
            Rename
          </button>
          {tabs && tabs.length > 1 && onCloseOtherTabs ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onCloseOtherTabs();
                onCloseWorkflowMenu?.();
              }}
            >
              Close Other Tabs
            </button>
          ) : null}
          <button type="button" role="menuitem" onClick={closeActiveTabOrWorkflow}>
            Close
          </button>
        </div>
      ) : null}
      <div className="graph-toolbar-actions">
        <button
          className="graph-toolbar-history-button"
          type="button"
          aria-label="Undo graph change"
          title="Undo (Cmd/Ctrl+Z)"
          disabled={!canUndo}
          onClick={onUndo}
        >
          <Undo2 size={14} />
        </button>
        <button
          className="graph-toolbar-history-button"
          type="button"
          aria-label="Redo graph change"
          title="Redo (Cmd/Ctrl+Shift+Z / Ctrl+Y)"
          disabled={!canRedo}
          onClick={onRedo}
        >
          <Redo2 size={14} />
        </button>
      </div>
      {renameDialogOpen ? (
        <div className="graph-rename-modal" role="dialog" aria-modal="true" aria-label="Rename workflow" data-testid="graph-rename-dialog">
          <div className="graph-modal-header">
            <strong>Rename workflow</strong>
            <button type="button" aria-label="Close rename dialog" onClick={onCancelRename}>
              <X size={16} />
            </button>
          </div>
          <input
            autoFocus
            value={renameDraft}
            onChange={(event) => onRenameDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onCommitRename();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                onCancelRename();
              }
            }}
          />
          <div className="graph-rename-actions">
            <button type="button" onClick={onCancelRename}>
              Cancel
            </button>
            <button type="button" onClick={onCommitRename}>
              Rename
            </button>
          </div>
        </div>
      ) : null}
      <div className="graph-toolbar-spacer" />
      <GraphRunDiagnostics run={run} transportMetrics={transportMetrics} />
      <div
        className={`graph-credit-balance ${creditsUnavailable ? "graph-credit-balance-muted" : ""}`}
        data-testid="graph-credit-balance"
        aria-label={`Credits ${creditText}`}
        title={`Credits: ${creditText}`}
      >
        <Coins size={13} aria-hidden="true" />
        <span>{creditLabel}</span>
      </div>
      <div
        className={`graph-credit-balance graph-pricing-balance ${pricingWarning ? "graph-credit-balance-warning" : ""}`}
        data-testid="graph-pricing-balance"
        aria-label={`Estimated graph cost ${pricingLabel.replace(/\s+estimated$/i, "")}${pricingWarning ? `. ${pricingWarning}` : ""}`}
        title={`Estimated cost: ${pricingLabel}${pricingWarning ? ` (${pricingWarning})` : ""}`}
      >
        <CircleDollarSign size={13} aria-hidden="true" />
        <span>{compactPricingLabel}</span>
      </div>
      {runActive ? (
        <button
          className={`graph-run-button graph-run-button-cancel ${runCancelling ? "graph-run-button-processing" : ""}`}
          type="button"
          data-testid="graph-cancel-button"
          disabled={runCancelling}
          aria-busy={runCancelling}
          onClick={onCancelRun}
        >
          {runCancelling ? <LoaderCircle size={18} /> : <X size={18} />}
          {runCancelling ? "Cancelling" : "Cancel"}
        </button>
      ) : (
        <button className="graph-run-button" type="button" data-testid="graph-run-button" onClick={onRun}>
          <Play size={18} />
          Run
        </button>
      )}
    </div>
  );
}
