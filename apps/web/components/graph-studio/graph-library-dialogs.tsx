"use client";

import { useMemo, useState } from "react";
import { Blocks, Search, Trash2, Upload, Workflow, X } from "lucide-react";

import type { MediaAsset, MediaReference } from "@/lib/types";
import { GraphNodeTypeBadge } from "./components/graph-node-type-badge";
import { GraphRunHistoryPanel } from "./graph-run-history-panel";
import { GraphTemplateBrowser } from "./graph-template-browser";
import type { GraphArtifact, GraphNodeDefinition, GraphRun, GraphTemplateRecord, GraphWorkflowRecord } from "./types";
import { rankGraphNodeDefinitions } from "./hooks/use-graph-node-search";
import { graphMediaDragPayload } from "./utils/graph-media-preview";
import { formatGraphTimestamp } from "./utils/graph-time";

export type GraphSidebarDialog = "workflows" | "nodes" | "images" | "runs";

export function GraphLibraryDialog({
  sidebarDialog,
  definitions,
  definitionsByCategory,
  workflows,
  templates,
  references,
  assets,
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
  onAddLoadImageNode,
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
  references: MediaReference[];
  assets: MediaAsset[];
  workflowId: string | null;
  runHistory: GraphRun[];
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
  onAddLoadImageNode: (fields: Record<string, unknown>) => void;
  onRefreshRunHistory: () => void;
  onInspectRun: (runId: string) => void;
  onRestoreRun: (run: GraphRun) => void;
  onPinArtifact: (artifact: GraphArtifact) => void;
}) {
  const [nodeLibraryQuery, setNodeLibraryQuery] = useState("");
  const imageAssets = assets.filter((asset) => asset.generation_kind === "image");
  const filteredDefinitionsByCategory = useMemo(() => {
    const query = nodeLibraryQuery.trim();
    if (!query) return definitionsByCategory;
    return rankGraphNodeDefinitions(definitions, query).reduce<Record<string, GraphNodeDefinition[]>>((groups, item) => {
      const category = item.definition.category || "Other";
      groups[category] = [...(groups[category] ?? []), item.definition];
      return groups;
    }, {});
  }, [definitions, definitionsByCategory, nodeLibraryQuery]);
  if (!sidebarDialog) return null;

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
      {sidebarDialog === "images" ? (
        <div className="graph-modal-grid">
          <section>
            <div className="graph-section-title">Reference Images</div>
            <div className="graph-media-list" data-testid="graph-reference-list">
              {references.length ? (
                references.map((reference) => (
                  <button
                    key={reference.reference_id}
                    type="button"
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData(
                        "application/x-media-studio-graph-media",
                        graphMediaDragPayload({ source: "reference", id: reference.reference_id, mediaType: reference.kind }),
                      );
                    }}
                    onClick={() => onAddLoadImageNode({ reference_id: reference.reference_id })}
                  >
                    {reference.thumb_url || reference.stored_url ? <img src={reference.thumb_url ?? reference.stored_url ?? ""} alt="" /> : <span className="graph-media-empty" />}
                    <span>{reference.original_filename ?? reference.reference_id}</span>
                  </button>
                ))
              ) : (
                <div className="graph-sidebar-empty">No reference images yet.</div>
              )}
            </div>
          </section>
          <section>
              <div className="graph-section-title">Generated Images</div>
              <div className="graph-media-list" data-testid="graph-asset-list">
              {imageAssets.length ? (
                imageAssets.map((asset) => (
                  <button
                    key={String(asset.asset_id)}
                    type="button"
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData(
                        "application/x-media-studio-graph-media",
                        graphMediaDragPayload({ source: "asset", id: String(asset.asset_id), mediaType: asset.generation_kind }),
                      );
                    }}
                    onClick={() => onAddLoadImageNode({ asset_id: String(asset.asset_id) })}
                  >
                    {asset.hero_thumb_url || asset.hero_web_url ? <img src={asset.hero_thumb_url ?? asset.hero_web_url ?? ""} alt="" /> : <span className="graph-media-empty" />}
                    <span>{asset.prompt_summary ?? String(asset.asset_id)}</span>
                  </button>
                ))
              ) : (
                <div className="graph-sidebar-empty">No generated image assets yet.</div>
              )}
            </div>
          </section>
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

export function GraphImageLibraryDialog({
  imageLibraryNodeId,
  references,
  assets,
  onClose,
  onAttachReference,
  onAttachAsset,
}: {
  imageLibraryNodeId: string | null;
  references: MediaReference[];
  assets: MediaAsset[];
  onClose: () => void;
  onAttachReference: (nodeId: string, referenceId: string) => void;
  onAttachAsset: (nodeId: string, assetId: string) => void;
}) {
  const mediaAssets = assets.filter((asset) => ["image", "video", "audio"].includes(String(asset.generation_kind)));
  if (!imageLibraryNodeId) return null;

  return (
    <div className="graph-image-library-modal" data-testid="graph-image-library-modal" role="dialog" aria-label="Media library">
      <div className="graph-modal-header">
        <div>
          <div className="graph-section-title">Media Library</div>
          <strong>Select media for Load node</strong>
        </div>
        <button type="button" aria-label="Close image library" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <div className="graph-modal-grid">
        <section>
          <div className="graph-section-title">References</div>
          <div className="graph-media-list">
            {references.length ? (
              references.map((reference) => (
                <button key={reference.reference_id} type="button" onClick={() => onAttachReference(imageLibraryNodeId, reference.reference_id)}>
                  {reference.thumb_url || reference.stored_url ? <img src={reference.thumb_url ?? reference.stored_url ?? ""} alt="" /> : <span className="graph-media-empty" />}
                  <span>{reference.original_filename ?? reference.reference_id}</span>
                </button>
              ))
            ) : (
              <div className="graph-sidebar-empty">No reference media yet.</div>
            )}
          </div>
        </section>
        <section>
          <div className="graph-section-title">Generated Media</div>
          <div className="graph-media-list">
            {mediaAssets.length ? (
              mediaAssets.map((asset) => (
                <button key={String(asset.asset_id)} type="button" onClick={() => onAttachAsset(imageLibraryNodeId, String(asset.asset_id))}>
                  {asset.hero_thumb_url || asset.hero_web_url ? <img src={asset.hero_thumb_url ?? asset.hero_web_url ?? ""} alt="" /> : <span className="graph-media-empty" />}
                  <span>{asset.prompt_summary ?? String(asset.asset_id)}</span>
                </button>
              ))
            ) : (
              <div className="graph-sidebar-empty">No generated media assets yet.</div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
