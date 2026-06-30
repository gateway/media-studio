"use client";

import { useMemo, useState } from "react";
import { Blocks, Search, Trash2, Upload, Workflow, X } from "lucide-react";

import { GraphNodeTypeBadge } from "./components/graph-node-type-badge";
import { GraphRunHistoryPanel } from "./graph-run-history-panel";
import { GraphTemplateBrowser } from "./graph-template-browser";
import type { GraphArtifact, GraphNodeDefinition, GraphRunHistoryItem, GraphTemplateRecord, GraphWorkflowRecord } from "./types";
import { graphDefinitionHiddenInSearch, rankGraphNodeDefinitions } from "./hooks/use-graph-node-search";
import { formatGraphTimestamp } from "./utils/graph-time";

export type GraphSidebarDialog = "workflows" | "nodes" | "images" | "runs";

export function GraphLibraryDialog({
  sidebarDialog,
  definitions,
  definitionsByCategory,
  workflows,
  templates,
  workflowId,
  runHistory,
  selectedHistoryRunId,
  selectedRunArtifacts,
  onClose,
  onLoadStarterTemplate,
  onLoadWorkflow,
  onInstantiateTemplate,
  onDeleteWorkflow,
  onDeleteTemplate,
  onImportWorkflow,
  onAddDefinitionNode,
  onRefreshRunHistory,
  onInspectRun,
  onRestoreRun,
  onPinArtifact,
}: {
  sidebarDialog: GraphSidebarDialog | null;
  definitions: GraphNodeDefinition[];
  definitionsByCategory: Record<string, GraphNodeDefinition[]>;
  workflows: GraphWorkflowRecord[];
  templates: GraphTemplateRecord[];
  workflowId: string | null;
  runHistory: GraphRunHistoryItem[];
  selectedHistoryRunId: string | null;
  selectedRunArtifacts: GraphArtifact[];
  onClose: () => void;
  onLoadStarterTemplate: () => void;
  onLoadWorkflow: (workflow: GraphWorkflowRecord) => void;
  onInstantiateTemplate: (template: GraphTemplateRecord) => void;
  onDeleteWorkflow: (workflow: GraphWorkflowRecord) => void;
  onDeleteTemplate: (template: GraphTemplateRecord) => void;
  onImportWorkflow: () => void;
  onAddDefinitionNode: (definition: GraphNodeDefinition) => void;
  onRefreshRunHistory: () => void;
  onInspectRun: (runId: string) => void;
  onRestoreRun: (run: GraphRunHistoryItem) => void | Promise<void>;
  onPinArtifact: (artifact: GraphArtifact) => void;
}) {
  const [nodeLibraryQuery, setNodeLibraryQuery] = useState("");
  const filteredDefinitionsByCategory = useMemo(() => {
    const query = nodeLibraryQuery.trim();
    if (!query) {
      return Object.entries(definitionsByCategory).reduce<Record<string, GraphNodeDefinition[]>>((groups, [category, items]) => {
        const visibleItems = items.filter((definition) => !graphDefinitionHiddenInSearch(definition));
        if (visibleItems.length) groups[category] = visibleItems;
        return groups;
      }, {});
    }
    return rankGraphNodeDefinitions(definitions, query).reduce<Record<string, GraphNodeDefinition[]>>((groups, item) => {
      const category = item.definition.category || "Other";
      groups[category] = [...(groups[category] ?? []), item.definition];
      return groups;
    }, {});
  }, [definitions, definitionsByCategory, nodeLibraryQuery]);
  if (!sidebarDialog || sidebarDialog === "images") return null;

  return (
    <div className="graph-library-modal" data-testid={`graph-${sidebarDialog}-modal`} role="dialog" aria-label={sidebarDialog}>
      <div className="graph-modal-header">
        <div>
          <div className="graph-section-title">{sidebarDialog}</div>
          <strong>{sidebarDialog === "workflows" ? "Workflows" : sidebarDialog === "nodes" ? "Nodes" : sidebarDialog === "runs" ? "Run History" : "Images"}</strong>
        </div>
        <button type="button" aria-label="Close graph dialog" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      {sidebarDialog === "workflows" ? (
        <div className="graph-dialog-list">
          <button className="graph-dialog-row graph-dialog-import-row" type="button" onClick={onImportWorkflow}>
            <span className="graph-dialog-row-icon">
              <Upload size={17} />
            </span>
            <span>
              <strong>Import workflow</strong>
              <small>Open JSON or bundled ZIP</small>
            </span>
          </button>
          <div className="graph-section-title">Starter Templates</div>
          <button className="graph-dialog-row" data-testid="graph-template-nano-image-pipeline" type="button" onClick={onLoadStarterTemplate}>
            <span className="graph-template-thumb" />
            <span>
              <strong>Nano image pipeline</strong>
              <small>Prompt Text -&gt; Nano Banana Pro -&gt; Save Image</small>
            </span>
          </button>
          <div className="graph-section-title">Saved Workflows</div>
          {workflows.length ? (
            workflows.map((workflow) => (
              <div className="graph-dialog-row graph-workflow-row" key={workflow.workflow_id}>
                <button className="graph-workflow-load-button" type="button" onClick={() => onLoadWorkflow(workflow)}>
                  <span className="graph-dialog-row-icon">
                    <Workflow size={17} />
                  </span>
                  <span>
                    <strong>{workflow.name || "Untitled workflow"}</strong>
                    <small>{formatGraphTimestamp(workflow.updated_at) || workflow.workflow_id}</small>
                  </span>
                </button>
                <button
                  className="graph-workflow-delete-button"
                  type="button"
                  aria-label={`Delete workflow ${workflow.name || workflow.workflow_id}`}
                  title="Delete workflow"
                  onClick={() => onDeleteWorkflow(workflow)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))
          ) : (
            <div className="graph-sidebar-empty">No saved workflows yet.</div>
          )}
          <GraphTemplateBrowser templates={templates} onInstantiate={onInstantiateTemplate} onDeleteTemplate={onDeleteTemplate} />
        </div>
      ) : null}
      {sidebarDialog === "nodes" ? (
        <div className="graph-dialog-categories">
          <label className="graph-dialog-search">
            <Search size={15} />
            <input value={nodeLibraryQuery} onChange={(event) => setNodeLibraryQuery(event.target.value)} placeholder="Search nodes..." autoComplete="off" />
          </label>
          {Object.entries(filteredDefinitionsByCategory).map(([category, items]) => (
            <section className="graph-dialog-category" key={category}>
              <div className="graph-section-title">{category}</div>
              <div className="graph-dialog-list">
                {items.map((definition) => (
                  <button className="graph-dialog-row graph-node-library-row" key={definition.type} type="button" title={definition.description ?? definition.type} onClick={() => onAddDefinitionNode(definition)}>
                    <span className="graph-dialog-row-icon">
                      <Blocks size={17} />
                    </span>
                    <span className="graph-node-library-row-main">
                      <strong>{definition.title}</strong>
                      <GraphNodeTypeBadge definition={definition} />
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ))}
          {nodeLibraryQuery.trim() && !Object.keys(filteredDefinitionsByCategory).length ? <div className="graph-sidebar-empty">No matching nodes.</div> : null}
        </div>
      ) : null}
      {sidebarDialog === "runs" ? (
        <GraphRunHistoryPanel
          workflowId={workflowId}
          runs={runHistory}
          artifacts={selectedRunArtifacts}
          selectedRunId={selectedHistoryRunId}
          onRefresh={onRefreshRunHistory}
          onInspectRun={onInspectRun}
          onRestoreRun={onRestoreRun}
          onPinArtifact={onPinArtifact}
        />
      ) : null}
    </div>
  );
}
