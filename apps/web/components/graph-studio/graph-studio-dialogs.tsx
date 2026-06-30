"use client";

import { useEffect } from "react";

import { GraphNodeSearchPopover } from "./components/node-search/graph-node-search-popover";
import type { MediaPickerMediaType } from "@/components/media/media-image-picker-types";
import { GraphGroupContextMenuHost } from "./graph-group-context-menu-host";
import { GraphImageSelectorDialog } from "./graph-image-selector-dialog";
import { GraphLibraryDialog, type GraphSidebarDialog } from "./graph-library-dialogs";
import { GraphNodeContextMenu } from "./graph-node-context-menu";
import { NODE_COLOR_CHOICES } from "./graph-studio-constants";
import type { GraphArtifact, GraphGroup, GraphNodeDefinition, GraphRunHistoryItem, GraphTemplateRecord, GraphWorkflowRecord, StudioNode } from "./types";
import type { GraphNodeColorChoice } from "./graph-node-context-menu";
import type { GraphExecutionMode } from "./utils/graph-node-execution";
import { graphMediaDragPayload } from "./utils/graph-media-preview";
import { executionModeForNodeIds } from "./utils/graph-selection";
import { useGraphImageSelectorSources } from "./hooks/use-graph-image-selector-sources";
import type { GraphNodeSearchPopoverState } from "./hooks/use-graph-node-search";

export function GraphStudioDialogs({
  sidebarDialog,
  definitions,
  definitionsByCategory,
  workflows,
  templates,
  workflowId,
  runHistory,
  selectedHistoryRunId,
  selectedRunArtifacts,
  nodeSearch,
  nodeContextMenu,
  groupContextMenu,
  groups,
  nodes,
  groupTitleDraft,
  imageLibraryNodeId,
  imageLibraryMediaType = "image",
  onCloseSidebar,
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
  onNodeSearchQueryChange,
  onNodeSearchSelect,
  onNodeSearchClose,
  onSetNodeExecutionMode,
  onSetNodeColor,
  onClearNodes,
  onCreateGroup,
  onRenameNode,
  onGroupTitleDraftChange,
  onRenameGroup,
  onSetGroupColor,
  onSetGroupExecutionMode,
  onDeleteGroup,
  onCloseGroupContext,
  onCloseImageLibrary,
  onAttachReference,
  onAttachAsset,
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
  nodeSearch: GraphNodeSearchPopoverState | null;
  nodeContextMenu: { nodeIds: string[]; anchorNodeId: string; x: number; y: number } | null;
  groupContextMenu: { groupId: string; x: number; y: number } | null;
  groups: GraphGroup[];
  nodes: StudioNode[];
  groupTitleDraft: string;
  imageLibraryNodeId: string | null;
  imageLibraryMediaType?: MediaPickerMediaType;
  onCloseSidebar: () => void;
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
  onRestoreRun: (run: GraphRunHistoryItem) => void | Promise<void>;
  onPinArtifact: (artifact: GraphArtifact) => void;
  onNodeSearchQueryChange: (query: string) => void;
  onNodeSearchSelect: (definition: GraphNodeDefinition) => void;
  onNodeSearchClose: () => void;
  onSetNodeExecutionMode: (nodeIds: string[], mode: GraphExecutionMode) => void;
  onSetNodeColor: (nodeIds: string[], color: GraphNodeColorChoice) => void;
  onClearNodes: (nodeIds: string[]) => void;
  onCreateGroup: () => void;
  onRenameNode: (nodeId: string) => void;
  onGroupTitleDraftChange: (value: string) => void;
  onRenameGroup: (groupId: string, title: string) => void;
  onSetGroupColor: (groupId: string, color: GraphNodeColorChoice) => void;
  onSetGroupExecutionMode: (groupId: string, mode: GraphExecutionMode) => void;
  onDeleteGroup: (groupId: string) => void;
  onCloseGroupContext: () => void;
  onCloseImageLibrary: () => void;
  onAttachReference: (nodeId: string, referenceId: string) => void;
  onAttachAsset: (nodeId: string, assetId: string) => void;
}) {
  const selectorMediaType =
    sidebarDialog === "images" ? "image" : imageLibraryMediaType;
  const imageSelector = useGraphImageSelectorSources(selectorMediaType);
  const imageSelectorOpen = sidebarDialog === "images" || Boolean(imageLibraryNodeId);
  const imageSelectorMode = imageLibraryNodeId
    ? ({ kind: "attach-node", nodeId: imageLibraryNodeId } as const)
    : ({ kind: "add-node" } as const);

  useEffect(() => {
    if (!imageSelectorOpen) return;
    void imageSelector.loadProjects();
    void imageSelector.loadSource("generated");
  }, [imageSelector.loadProjects, imageSelector.loadSource, imageSelectorOpen]);

  function closeImageSelector() {
    if (sidebarDialog === "images") {
      onCloseSidebar();
    }
    if (imageLibraryNodeId) {
      onCloseImageLibrary();
    }
  }

  function handleSearchChange(source: "generated" | "imported", query: string) {
    imageSelector.setSearchQuery(query);
    void imageSelector.loadSource(source, {
      query,
      projectId: imageSelector.projectId,
    });
  }

  function handleProjectScopeChange(
    source: "generated" | "imported",
    projectId: string | null,
  ) {
    imageSelector.setProjectId(projectId);
    void imageSelector.loadSource(source, {
      projectId,
    });
  }

  return (
    <>
      <GraphLibraryDialog
        sidebarDialog={sidebarDialog === "images" ? null : sidebarDialog}
        definitions={definitions}
        definitionsByCategory={definitionsByCategory}
        workflows={workflows}
        templates={templates}
        workflowId={workflowId}
        runHistory={runHistory}
        selectedHistoryRunId={selectedHistoryRunId}
        selectedRunArtifacts={selectedRunArtifacts}
        onClose={onCloseSidebar}
        onLoadStarterTemplate={onLoadStarterTemplate}
        onLoadWorkflow={onLoadWorkflow}
        onInstantiateTemplate={onInstantiateTemplate}
        onDeleteWorkflow={onDeleteWorkflow}
        onDeleteTemplate={onDeleteTemplate}
        onImportWorkflow={onImportWorkflow}
        onAddDefinitionNode={onAddDefinitionNode}
        onRefreshRunHistory={onRefreshRunHistory}
        onInspectRun={onInspectRun}
        onRestoreRun={onRestoreRun}
        onPinArtifact={onPinArtifact}
      />
      <GraphImageSelectorDialog
        open={imageSelectorOpen}
        mediaType={selectorMediaType}
        mode={imageSelectorMode}
        generated={imageSelector.generated}
        imported={imageSelector.imported}
        searchQuery={imageSelector.searchQuery}
        projectId={imageSelector.projectId}
        projectOptions={imageSelector.projectOptions}
        loadingProjectOptions={imageSelector.loadingProjectOptions}
        onClose={closeImageSelector}
        onSearchChange={handleSearchChange}
        onLoadMore={(source) =>
          void imageSelector.loadSource(source, { append: true })
        }
        onProjectScopeChange={handleProjectScopeChange}
        onAddNode={onAddLoadImageNode}
        onAttachToNode={(nodeId, fields) => {
          if ("reference_id" in fields) {
            onAttachReference(nodeId, fields.reference_id);
            return;
          }
          onAttachAsset(nodeId, fields.asset_id);
        }}
        onDragItem={
          imageSelectorMode.kind === "add-node"
            ? (source, item, event) => {
                event.dataTransfer.setData(
                  "application/x-media-studio-graph-media",
                  graphMediaDragPayload({
                    source: source === "generated" ? "asset" : "reference",
                    id: item.id,
                    mediaType: selectorMediaType,
                  }),
                );
              }
            : undefined
        }
      />
      {nodeSearch ? (
        <GraphNodeSearchPopover state={nodeSearch} definitions={definitions} onQueryChange={onNodeSearchQueryChange} onSelect={onNodeSearchSelect} onClose={onNodeSearchClose} />
      ) : null}
      {nodeContextMenu ? (
        <GraphNodeContextMenu
          x={nodeContextMenu.x}
          y={nodeContextMenu.y}
          colors={NODE_COLOR_CHOICES}
          targetCount={nodeContextMenu.nodeIds.length}
          canRename={nodeContextMenu.nodeIds.length === 1}
          executionMode={executionModeForNodeIds(nodes, nodeContextMenu.nodeIds)}
          onSetExecutionMode={(mode) => onSetNodeExecutionMode(nodeContextMenu.nodeIds, mode)}
          onSelectColor={(color) => onSetNodeColor(nodeContextMenu.nodeIds, color)}
          onClear={() => onClearNodes(nodeContextMenu.nodeIds)}
          onCreateGroup={onCreateGroup}
          onRename={() => {
            if (nodeContextMenu.nodeIds.length === 1) onRenameNode(nodeContextMenu.anchorNodeId);
          }}
        />
      ) : null}
      <GraphGroupContextMenuHost
        contextMenu={groupContextMenu}
        groups={groups}
        nodes={nodes}
        titleDraft={groupTitleDraft}
        onTitleDraftChange={onGroupTitleDraftChange}
        onRenameGroup={onRenameGroup}
        onSetGroupColor={onSetGroupColor}
        onSetGroupExecutionMode={onSetGroupExecutionMode}
        onDeleteGroup={onDeleteGroup}
        onClose={onCloseGroupContext}
      />
    </>
  );
}
