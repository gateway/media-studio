"use client";

import type { MediaAsset, MediaReference } from "@/lib/types";

import { GraphNodeSearchPopover } from "./components/node-search/graph-node-search-popover";
import { GraphGroupContextMenuHost } from "./graph-group-context-menu-host";
import { GraphImageLibraryDialog, GraphLibraryDialog, type GraphSidebarDialog } from "./graph-library-dialogs";
import { GraphNodeContextMenu } from "./graph-node-context-menu";
import { NODE_COLOR_CHOICES } from "./graph-studio-constants";
import type { GraphArtifact, GraphGroup, GraphNodeDefinition, GraphRun, GraphTemplateRecord, GraphWorkflowRecord, StudioNode } from "./types";
import type { GraphNodeColorChoice } from "./graph-node-context-menu";
import type { GraphExecutionMode } from "./utils/graph-node-execution";
import { executionModeForNodeIds } from "./utils/graph-selection";
import type { GraphNodeSearchPopoverState } from "./hooks/use-graph-node-search";

export function GraphStudioDialogs({
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
  nodeSearch,
  nodeContextMenu,
  groupContextMenu,
  groups,
  nodes,
  groupTitleDraft,
  imageLibraryNodeId,
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
  references: MediaReference[];
  assets: MediaAsset[];
  workflowId: string | null;
  runHistory: GraphRun[];
  selectedHistoryRunId: string | null;
  selectedRunArtifacts: GraphArtifact[];
  nodeSearch: GraphNodeSearchPopoverState | null;
  nodeContextMenu: { nodeIds: string[]; anchorNodeId: string; x: number; y: number } | null;
  groupContextMenu: { groupId: string; x: number; y: number } | null;
  groups: GraphGroup[];
  nodes: StudioNode[];
  groupTitleDraft: string;
  imageLibraryNodeId: string | null;
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
  onRestoreRun: (run: GraphRun) => void;
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
  return (
    <>
      <GraphLibraryDialog
        sidebarDialog={sidebarDialog}
        definitions={definitions}
        definitionsByCategory={definitionsByCategory}
        workflows={workflows}
        templates={templates}
        references={references}
        assets={assets}
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
        onAddLoadImageNode={onAddLoadImageNode}
        onRefreshRunHistory={onRefreshRunHistory}
        onInspectRun={onInspectRun}
        onRestoreRun={onRestoreRun}
        onPinArtifact={onPinArtifact}
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
      <GraphImageLibraryDialog
        imageLibraryNodeId={imageLibraryNodeId}
        references={references}
        assets={assets}
        onClose={onCloseImageLibrary}
        onAttachReference={onAttachReference}
        onAttachAsset={onAttachAsset}
      />
    </>
  );
}
