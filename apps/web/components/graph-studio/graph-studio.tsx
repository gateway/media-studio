"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { flushSync } from "react-dom";
import {
  addEdge,
  ReactFlowProvider,
  useReactFlow,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";

import { buildStudioGraphReturnHref } from "@/lib/studio-navigation";
import { formatCreditsAmount } from "@/lib/utils";
import {
  isGraphAssistantAvailable,
  isGraphAssistantDebugEnabled,
} from "@/lib/graph-assistant-debug";
import {
  GRAPH_NODE_DEFINITIONS_EVENT,
  GRAPH_NODE_DEFINITIONS_STORAGE_KEY,
  readGraphNodeDefinitionsRevision,
} from "@/lib/graph-node-definitions-sync";
import { GraphCanvas } from "./graph-canvas";
import { GraphConsole } from "./graph-console";
import { CreativeAssistantPanel } from "./creative-assistant-panel";
import { GraphLeftRail } from "./graph-left-rail";
import type { GraphSidebarDialog } from "./graph-library-dialogs";
import { GraphPreviewOverlay } from "./graph-preview-overlay";
import { GraphPricingConfirmation } from "./graph-pricing-confirmation";
import { GraphStudioUnsupported } from "./graph-studio-unsupported";
import { GraphStudioDialogs } from "./graph-studio-dialogs";
import {
  GraphStudioFixtureLayer,
  graphStudioFixtureKind,
} from "./graph-test-fixtures";
import { GraphToolbar } from "./graph-toolbar";
import { NODE_COLOR_CHOICES } from "./graph-studio-constants";
import { useGraphClipboard } from "./hooks/use-graph-clipboard";
import { useGraphConsole } from "./hooks/use-graph-console";
import { useGraphConnections } from "./hooks/use-graph-connections";
import { useGraphContextMenus } from "./hooks/use-graph-context-menus";
import { useGraphDefinitionHydration } from "./hooks/use-graph-definition-hydration";
import { useGraphKeyboardShortcuts } from "./hooks/use-graph-keyboard-shortcuts";
import { useGraphGroups } from "./hooks/use-graph-groups";
import { useGraphMediaLibrary } from "./hooks/use-graph-media-library";
import { useGraphNodeFieldLayout } from "./hooks/use-graph-node-field-layout";
import { useGraphNodeOperations } from "./hooks/use-graph-node-operations";
import { useGraphNodePreviews } from "./hooks/use-graph-node-previews";
import { useGraphNodeSearchState } from "./hooks/use-graph-node-search";
import { useGraphPricingEstimate } from "./hooks/use-graph-pricing-estimate";
import {
  GraphProviderModelCatalogProvider,
  useGraphProviderModelCatalog,
} from "./hooks/use-graph-provider-model-catalog";
import { useGraphRunHistory } from "./hooks/use-graph-run-history";
import { useGraphStudioSupport } from "./hooks/use-graph-studio-support";
import { useGraphAssistantHistory } from "./hooks/use-graph-assistant-history";
import { useGraphTabWorkspace } from "./hooks/use-graph-tab-workspace";
import { useGraphTabs } from "./hooks/use-graph-tabs";
import { useGraphTemplates } from "./hooks/use-graph-templates";
import { useGraphUndoHistory } from "./hooks/use-graph-undo-history";
import {
  useGraphRunLifecycle,
  type GraphValidationError,
} from "./hooks/use-graph-run-lifecycle";
import { useGraphWorkflowActions } from "./hooks/use-graph-workflow-actions";
import { useGraphWorkflowMenuState } from "./hooks/use-graph-workflow-menu-state";
import { useGraphToolbarWorkflowActions } from "./hooks/use-graph-toolbar-workflow-actions";
import { useGraphWorkspaceRestore } from "./hooks/use-graph-workspace-restore";
import { useGraphWorkflowTransfer } from "./hooks/use-graph-workflow-transfer";
import type {
  GraphGroup,
  GraphMediaPreview,
  GraphNodeDefinition,
  GraphRun,
  GraphRunEvent,
  GraphRunHistoryItem,
  GraphWorkflowPayload,
  GraphWorkflowRecord,
  StudioEdge,
  StudioNode,
} from "./types";
import { jsonFetch } from "./utils/graph-api";
import { graphGroupsForCanvas } from "./utils/graph-groups";
import { filterGraphNodeNoopChanges } from "./utils/graph-node-changes";
import {
  assetIdsFromGraphRun,
  readGraphMediaDragPayload,
} from "./utils/graph-media-preview";
import {
  graphEdgeClassForPortType,
  graphEdgeStyleForPortType,
  computeGraphMediaPreviewFitSize,
  findOpenGraphNodePosition,
  graphNodePlacementSize,
  graphMediaPreviewFitSignature,
} from "./utils/graph-node-layout";
import { suppressGraphEdgeSelectionChanges } from "./utils/graph-edge-selection";
import { filterGraphCanvasEdgesForCurrentContract } from "./utils/graph-edge-contract";
import {
  clearGraphNodeRunState,
  graphNodeDataWithRunState,
  graphRunNodeStateMatchesExecutionMode,
} from "./utils/graph-node-runtime";
import {
  inputGraphHandleId,
  outputGraphHandleId,
} from "./utils/graph-port-handles";
import {
  formatGraphRunEventsForConsole,
  graphNodeActivitiesFromRunEvents,
} from "./utils/graph-run-events";
import {
  createGraphNode as createNode,
  workflowFromCanvas as buildWorkflowPayload,
  type GraphNodeHandlers,
} from "./utils/graph-serialization";
import type { GraphHistorySnapshot } from "./utils/graph-history";
import {
  blankGraphWorkflowPayload,
  graphWorkflowDirtyState,
  graphWorkflowSnapshotSignature,
  graphWorkflowSnapshotsMatch,
  shouldReloadSavedWorkflowRecordOnRestore,
} from "./utils/graph-tabs";
import { hydrateGraphWorkflowForCanvas } from "./utils/graph-workflow-hydration";

function selectedAssetId(fields: Record<string, unknown>) {
  const assetId = fields.asset_id;
  return typeof assetId === "string" && assetId.trim() ? assetId : null;
}

type GraphMediaLibraryRequest = {
  nodeId: string;
  mediaType: "image" | "video" | "audio";
};

export function GraphStudio() {
  const [mounted, setMounted] = useState(false);
  const supportState = useGraphStudioSupport();
  useEffect(() => {
    setMounted(true);
  }, []);
  if (!mounted) {
    return (
      <div
        className="graph-shell graph-shell-loading"
        aria-label="Loading Graph Studio"
      />
    );
  }
  if (!supportState.supported) {
    return <GraphStudioUnsupported state={supportState} />;
  }
  return (
    <ReactFlowProvider>
      <GraphStudioClient />
    </ReactFlowProvider>
  );
}

function GraphStudioClient() {
  const { screenToFlowPosition } = useReactFlow<StudioNode, StudioEdge>();
  const assistantDebugEnabled = isGraphAssistantDebugEnabled();
  const graphFixture = useMemo(() => graphStudioFixtureKind(), []);
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [workflowName, setWorkflowName] = useState("Nano Image Pipeline");
  const { consoleLines, setConsoleLines, appendConsole } = useGraphConsole();
  const { templates, refreshTemplates, instantiateTemplate, deleteTemplate } =
    useGraphTemplates({ appendConsole });
  const {
    tabs,
    activeTabId,
    sessionRestored,
    storageScope,
    updateTab,
    updateActiveTab,
    updateTabAssistantSession,
    openBlankTab,
    openWorkflowTab,
    closeTab,
    closeOtherTabs,
    switchTab,
  } = useGraphTabs();
  const [run, setRun] = useState<GraphRun | null>(null);
  const [workflowUpdatedAt, setWorkflowUpdatedAt] = useState<string | null>(
    null,
  );
  const {
    references,
    setReferences,
    assets,
    availableCredits,
    creditsUnavailable,
    refreshCredits,
    refreshImageAssets,
    refreshAssetsByIds,
    refreshReferencesByIds,
    refreshReferenceMedia,
    refreshMediaLibrary,
    importImageFile,
  } = useGraphMediaLibrary();
  const [previewOverlay, setPreviewOverlay] = useState<{
    previews: GraphMediaPreview[];
    index: number;
  } | null>(null);
  const { nodeSearch, setNodeSearch, openNodeSearch } =
    useGraphNodeSearchState(screenToFlowPosition);
  const [imageLibraryRequest, setImageLibraryRequest] =
    useState<GraphMediaLibraryRequest | null>(null);
  const imageLibraryNodeId = imageLibraryRequest?.nodeId ?? null;
  const imageLibraryMediaType = imageLibraryRequest?.mediaType ?? "image";
  const setImageLibraryNodeId = useCallback(
    (
      nodeId: string | null,
      mediaType: GraphMediaLibraryRequest["mediaType"] = "image",
    ) => {
      setImageLibraryRequest(nodeId ? { nodeId, mediaType } : null);
    },
    [],
  );
  const [sidebarDialog, setSidebarDialog] = useState<GraphSidebarDialog | null>(
    null,
  );
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantConnectionProven, setAssistantConnectionProven] =
    useState(false);
  const assistantEnabled = assistantDebugEnabled && assistantConnectionProven;
  const [assistantWorkspaceResetVersion, setAssistantWorkspaceResetVersion] =
    useState(0);
  const [consoleHeight, setConsoleHeight] = useState(170);
  const [showMiniMap, setShowMiniMap] = useState(false);
  const {
    workflowMenuOpen,
    setWorkflowMenuOpen,
    renameDialogOpen,
    setRenameDialogOpen,
    renameDraft,
    setRenameDraft,
    closeWorkflowMenu,
    toggleWorkflowMenu,
  } = useGraphWorkflowMenuState();
  const [historyReady, setHistoryReady] = useState(false);
  const [groups, setGroups] = useState<GraphGroup[]>([]);
  const {
    nodeContextMenu,
    setNodeContextMenu,
    groupContextMenu,
    setGroupContextMenu,
    groupTitleDraft,
    setGroupTitleDraft,
    closeGroupContextMenu,
    closeContextMenus,
  } = useGraphContextMenus({ groups });
  const [renamingNodeId, setRenamingNodeId] = useState<string | null>(null);
  const [nodeRenameDraft, setNodeRenameDraft] = useState("");

  useEffect(() => {
    if (!assistantDebugEnabled) {
      setAssistantConnectionProven(false);
      setAssistantOpen(false);
      return;
    }

    let cancelled = false;
    fetch("/api/control/health", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Health check returned ${response.status}.`);
        }
        return (await response.json()) as { codex_local_ready?: unknown };
      })
      .then((payload) => {
        if (cancelled) return;
        const available = isGraphAssistantAvailable(payload);
        setAssistantConnectionProven(available);
        if (!available) setAssistantOpen(false);
      })
      .catch(() => {
        if (cancelled) return;
        setAssistantConnectionProven(false);
        setAssistantOpen(false);
      });

    return () => {
      cancelled = true;
    };
  }, [assistantDebugEnabled]);
  const activeTab = useMemo(
    () => tabs.find((tab) => tab.tab_id === activeTabId) ?? null,
    [activeTabId, tabs],
  );
  const galleryHref = useMemo(
    () => buildStudioGraphReturnHref(activeTabId),
    [activeTabId],
  );
  const handleAssistantSessionChange = useCallback(
    (assistantSessionId: string | null) => {
      updateTabAssistantSession(activeTabId, assistantSessionId);
    },
    [activeTabId, updateTabAssistantSession],
  );

  const openCanvasNodeSearch = useCallback(
    (
      x: number,
      y: number,
      connection?: Parameters<typeof openNodeSearch>[2],
    ) => {
      openNodeSearch(x, y, connection);
      closeWorkflowMenu();
      closeContextMenus();
    },
    [closeContextMenus, closeWorkflowMenu, openNodeSearch],
  );
  const [nodes, setNodes, applyNodesChange] = useNodesState<StudioNode>([]);
  const nodesRef = useRef<StudioNode[]>([]);
  const onNodesChange = useCallback(
    (changes: Parameters<typeof applyNodesChange>[0]) => {
      const filteredChanges = filterGraphNodeNoopChanges(
        changes,
        nodesRef.current,
      );
      if (!filteredChanges.length) return;
      applyNodesChange(filteredChanges);
    },
    [applyNodesChange],
  );
  const [edges, setEdges, applyEdgesChange] = useEdgesState<StudioEdge>([]);
  const edgesRef = useRef<StudioEdge[]>([]);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);
  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);
  const {
    definitions,
    definitionsLoadStarted,
    canvasHydrated,
    latestDefinitionsRevision,
    reloadNodeDefinitions,
  } = useGraphDefinitionHydration({ setNodes });
  const providerModelCatalog = useGraphProviderModelCatalog({
    nodes,
    appendConsole,
  });
  const onEdgesChange = useCallback(
    (changes: Parameters<typeof applyEdgesChange>[0]) => {
      const filteredChanges = suppressGraphEdgeSelectionChanges(changes);
      if (!filteredChanges.length) return;
      applyEdgesChange(filteredChanges);
    },
    [applyEdgesChange],
  );
  const workflowFromCanvas = useCallback(
    (
      nextWorkflowId: string | null,
      nextWorkflowName: string,
      currentNodes: StudioNode[],
      currentEdges: StudioEdge[],
    ) =>
      buildWorkflowPayload(
        nextWorkflowId,
        nextWorkflowName,
        currentNodes,
        currentEdges,
        groups,
      ),
    [groups],
  );
  const currentWorkflowPayload = useMemo(
    () => workflowFromCanvas(workflowId, workflowName, nodes, edges),
    [edges, nodes, workflowFromCanvas, workflowId, workflowName],
  );
  const selectedAssistantNodeIds = useMemo(
    () => nodes.filter((node) => node.selected).map((node) => node.id),
    [nodes],
  );
  const currentHistorySnapshot = useMemo<GraphHistorySnapshot | null>(
    () => ({
      workflowId,
      workflowName,
      workflowUpdatedAt,
      workflow: currentWorkflowPayload,
    }),
    [currentWorkflowPayload, workflowId, workflowName, workflowUpdatedAt],
  );
  const currentHistorySnapshotRef = useRef<GraphHistorySnapshot | null>(
    currentHistorySnapshot,
  );
  currentHistorySnapshotRef.current = currentHistorySnapshot;
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;
  const workspaceRestoreVersionRef = useRef(0);
  const markWorkspaceChanged = useCallback(() => {
    workspaceRestoreVersionRef.current += 1;
  }, []);
  const restoreVersionIsCurrent = useCallback(
    (version: number) => workspaceRestoreVersionRef.current === version,
    [],
  );
  const {
    workflows,
    refreshWorkflows,
    saveWorkflow,
    saveWorkflowAs,
    openRenameWorkflow,
    commitRenameWorkflow,
    closeWorkflow,
    deleteWorkflowRecord,
  } = useGraphWorkflowActions({
    workflowId,
    workflowName,
    renameDraft,
    nodes,
    edges,
    workflowFromCanvas,
    setWorkflowId,
    setWorkflowName,
    setWorkflowUpdatedAt,
    setRun,
    setNodes,
    setEdges,
    setConsoleLines,
    onCloseWorkspace: () => setGroups([]),
    setWorkflowMenuOpen,
    setRenameDialogOpen,
    appendConsole,
  });

  const resetNodeRunState = useCallback(() => {
    setNodes((current) => {
      let changed = false;
      const nextNodes = current.map((node) => {
        const data = node.data as StudioNode["data"];
        const nextData = clearGraphNodeRunState(data);
        if (nextData === data) return node;
        changed = true;
        return {
          ...node,
          data: nextData,
        };
      });
      return changed ? nextNodes : current;
    });
  }, [setNodes]);

  const applyValidationErrorsToNodes = useCallback(
    (errors: GraphValidationError[]) => {
      const messagesByNode = new Map<string, string[]>();
      errors.forEach((error) => {
        if (!error.node_id) return;
        messagesByNode.set(error.node_id, [
          ...(messagesByNode.get(error.node_id) ?? []),
          error.message,
        ]);
      });
      setNodes((current) => {
        let changed = false;
        const nextNodes = current.map((node) => {
          const messages = messagesByNode.get(node.id);
          if (!messages?.length) return node;
          const nextMessage = messages.join("; ");
          const nextActivityTone: StudioNode["data"]["activityTone"] = "error";
          const data = node.data as StudioNode["data"];
          if (
            data.status === "failed" &&
            data.progress === null &&
            data.errorMessage === nextMessage &&
            data.activityLabel === "error" &&
            data.activityDetail === nextMessage &&
            data.activityTone === nextActivityTone
          ) {
            return node;
          }
          changed = true;
          return {
            ...node,
            data: {
              ...data,
              status: "failed",
              progress: null,
              errorMessage: nextMessage,
              activityLabel: "error",
              activityDetail: nextMessage,
              activityTone: nextActivityTone,
            },
          };
        });
        return changed ? nextNodes : current;
      });
    },
    [setNodes],
  );

  const applyRunNodesToCanvas = useCallback(
    (currentRun: GraphRun) => {
      setNodes((existing) => {
        let changed = false;
        const nextNodes = existing.map((node) => {
          const runNode = currentRun.nodes?.find(
            (item) => item.node_id === node.id,
          );
          if (!runNode) return node;
          const data = node.data as StudioNode["data"];
          const nextData = graphNodeDataWithRunState(data, runNode);
          if (nextData === data) return node;
          changed = true;
          return {
            ...node,
            data: nextData,
          };
        });
        return changed ? nextNodes : existing;
      });
    },
    [setNodes],
  );
  const applyRunEventsToCanvas = useCallback(
    (events: GraphRunEvent[], currentRun: GraphRun | null) => {
      const activities = graphNodeActivitiesFromRunEvents(events, currentRun);
      setNodes((existing) => {
        let changed = false;
        const nextNodes = existing.map((node) => {
          const activity = activities[node.id];
          const data = node.data as StudioNode["data"];
          const runNode = currentRun?.nodes?.find(
            (item) => item.node_id === node.id,
          );
          if (runNode && !graphRunNodeStateMatchesExecutionMode(data, runNode))
            return node;
          if (!activity) return node;
          const nextDetail = activity.detail ?? null;
          if (
            data.activityLabel === activity.label &&
            data.activityDetail === nextDetail &&
            data.activityTone === activity.tone
          ) {
            return node;
          }
          changed = true;
          return {
            ...node,
            data: {
              ...data,
              activityLabel: activity.label,
              activityDetail: nextDetail,
              activityTone: activity.tone,
            },
          };
        });
        return changed ? nextNodes : existing;
      });
    },
    [setNodes],
  );

  useEffect(() => {
    setEdges((currentEdges) => {
      const nextEdges = filterGraphCanvasEdgesForCurrentContract(
        nodes,
        currentEdges,
      );
      return nextEdges.length === currentEdges.length
        ? currentEdges
        : nextEdges;
    });
  }, [nodes, setEdges]);

  const {
    ensureNodeHeight,
    onFieldChange,
    setNodeFields,
    toggleNodeAdvancedExpanded,
    toggleNodeCollapsed,
  } = useGraphNodeFieldLayout({ nodes, setNodes });

  const startNodeRename = useCallback(
    (nodeId: string) => {
      const node = nodesRef.current.find((item) => item.id === nodeId);
      if (!node) return;
      const data = node.data as StudioNode["data"];
      setNodeRenameDraft(data.customTitle?.trim() || data.definition.title);
      setRenamingNodeId(nodeId);
      closeContextMenus();
    },
    [closeContextMenus],
  );

  const commitNodeRename = useCallback(() => {
    const targetNodeId = renamingNodeId;
    if (!targetNodeId) return;
    const trimmedTitle = nodeRenameDraft.trim();
    setNodes((current) =>
      current.map((node) => {
        if (node.id !== targetNodeId) return node;
        const data = node.data as StudioNode["data"];
        return {
          ...node,
          data: {
            ...data,
            customTitle:
              trimmedTitle && trimmedTitle !== data.definition.title
                ? trimmedTitle
                : null,
          },
        };
      }),
    );
    setRenamingNodeId(null);
    setNodeRenameDraft("");
  }, [nodeRenameDraft, renamingNodeId, setNodes]);

  const cancelNodeRename = useCallback(() => {
    setRenamingNodeId(null);
    setNodeRenameDraft("");
  }, []);

  const {
    setGraphNodeColor,
    setGraphNodeExecutionMode,
    setGraphNodeCachedOutput,
    toggleGraphNodeExecutionMode,
    clearGraphNodes,
  } = useGraphNodeOperations({
    nodes,
    setNodes,
    setEdges,
    appendConsole,
    closeContextMenu: closeContextMenus,
  });
  const {
    createGroupFromSelection,
    renameGroup,
    setGroupColor,
    deleteGroup,
    setGroupExecutionMode,
  } = useGraphGroups({
    groups,
    nodes,
    setGroups,
    setNodes,
    appendConsole,
  });
  const {
    runHistory,
    selectedHistoryRunId,
    selectedRunArtifacts,
    refreshRunHistory,
    inspectRunArtifacts,
  } = useGraphRunHistory({
    workflowId,
    appendConsole,
  });
  const handleNodeImageDrop = useCallback(
    async (nodeId: string, file: File) => {
      try {
        const reference = await importImageFile(file);
        setNodeFields(nodeId, {
          reference_id: reference.reference_id,
          asset_id: "",
        });
        appendConsole(`Attached reference ${reference.reference_id}.`);
      } catch (error) {
        appendConsole((error as Error).message);
      }
    },
    [appendConsole, importImageFile, setNodeFields],
  );

  const definitionsByType = useMemo(
    () =>
      new Map(definitions.map((definition) => [definition.type, definition])),
    [definitions],
  );
  const definitionsByCategory = useMemo(
    () =>
      definitions.reduce<Record<string, GraphNodeDefinition[]>>(
        (groups, definition) => {
          const key = definition.category || "Other";
          groups[key] = [...(groups[key] ?? []), definition];
          return groups;
        },
        {},
      ),
    [definitions],
  );
  const {
    activeConnection,
    manualWireDrag,
    clearActiveConnection,
    edgeIsValid,
    startInputRewire,
    onConnect,
    onConnectStart,
    onConnectEnd,
    onReconnect,
    onReconnectEnd,
  } = useGraphConnections({
    nodes,
    edges,
    setEdges,
    appendConsole,
    setNodeSearch,
    openNodeSearch: openCanvasNodeSearch,
  });

  const nodeHandlers = useMemo<GraphNodeHandlers>(
    () => ({
      onFieldChange,
      onSetFields: setNodeFields,
      onOpenImageLibrary: (nodeId, mediaType) =>
        setImageLibraryNodeId(nodeId, mediaType ?? "image"),
      onImageDrop: handleNodeImageDrop,
      onInputRewireStart: startInputRewire,
      onToggleCollapsed: toggleNodeCollapsed,
      onToggleAdvancedExpanded: toggleNodeAdvancedExpanded,
      onEnsureNodeHeight: ensureNodeHeight,
      onOpenPreview: (preview, collection) => {
        const previews = collection?.length ? collection : [preview];
        const index = Math.max(
          0,
          previews.findIndex(
            (item) =>
              item.url === preview.url && item.fullUrl === preview.fullUrl,
          ),
        );
        setPreviewOverlay({ previews, index });
      },
      onStartRenameNode: startNodeRename,
      onRenameNodeDraftChange: setNodeRenameDraft,
      onCommitRenameNode: commitNodeRename,
      onCancelRenameNode: cancelNodeRename,
    }),
    [
      cancelNodeRename,
      commitNodeRename,
      ensureNodeHeight,
      handleNodeImageDrop,
      onFieldChange,
      setImageLibraryNodeId,
      setNodeFields,
      startInputRewire,
      startNodeRename,
      toggleNodeAdvancedExpanded,
      toggleNodeCollapsed,
    ],
  );

  const addDefinitionNode = useCallback(
    (definition: GraphNodeDefinition) => {
      setNodes((current) => {
        const nextNode = createNode(definition, { x: 120, y: 120 }, nodeHandlers);
        nextNode.position = findOpenGraphNodePosition({
          existingNodes: current,
          size: graphNodePlacementSize(nextNode),
        });
        return [...current, nextNode];
      });
    },
    [nodeHandlers, setNodes],
  );

  const addDefinitionNodeFromSearch = useCallback(
    (definition: GraphNodeDefinition) => {
      const searchState = nodeSearch;
      const newNode = createNode(
        definition,
        searchState?.flowPosition ?? { x: 120, y: 120 },
        nodeHandlers,
      );
      if (!searchState?.flowPosition) {
        newNode.position = findOpenGraphNodePosition({
          existingNodes: nodes,
          size: graphNodePlacementSize(newNode),
        });
      }
      setNodes((current) => [...current, newNode]);
      if (
        searchState?.connection?.from === "output" &&
        searchState.connection.nodeId &&
        searchState.connection.handleId
      ) {
        const targetPort = definition.ports.inputs.find((port) => {
          const accepts = port.accepts?.length ? port.accepts : [port.type];
          return accepts.includes(searchState.connection?.portType ?? "");
        });
        if (targetPort) {
          setEdges((current) =>
            addEdge(
              {
                id: `edge-${searchState.connection?.nodeId}-${searchState.connection?.handleId}-${newNode.id}-${targetPort.id}`,
                source: searchState.connection?.nodeId ?? "",
                sourceHandle: searchState.connection?.handleId ?? null,
                target: newNode.id,
                targetHandle: inputGraphHandleId(targetPort.id),
                animated: false,
                className: graphEdgeClassForPortType(
                  searchState.connection?.portType,
                ),
                style: graphEdgeStyleForPortType(
                  searchState.connection?.portType,
                ),
                reconnectable: true,
              },
              current,
            ),
          );
        }
      }
      setNodeSearch(null);
      clearActiveConnection();
    },
    [
      clearActiveConnection,
      nodeHandlers,
      nodeSearch,
      nodes.length,
      setEdges,
      setNodes,
    ],
  );

  const buildStarterWorkflow = useCallback(
    (items: GraphNodeDefinition[]) => {
      const byType = new Map(
        items.map((definition) => [definition.type, definition]),
      );
      const load = byType.get("media.load_image");
      const prompt = byType.get("prompt.text");
      const model = byType.get("model.kie.nano_banana_pro");
      const save = byType.get("media.save_image");
      if (!load || !prompt || !model || !save) return false;
      const loadNode = createNode(load, { x: 80, y: 240 }, nodeHandlers);
      const promptNode = createNode(prompt, { x: 80, y: -60 }, nodeHandlers);
      promptNode.data.fields.text =
        "Transform this reference into a cinematic, high-detail editorial image.";
      const modelNode = createNode(model, { x: 480, y: 90 }, nodeHandlers);
      const saveNode = createNode(save, { x: 920, y: 220 }, nodeHandlers);
      setNodes([loadNode, promptNode, modelNode, saveNode]);
      setGroups([]);
      setEdges([
        {
          id: "edge-prompt-model",
          source: promptNode.id,
          sourceHandle: outputGraphHandleId("text"),
          target: modelNode.id,
          targetHandle: inputGraphHandleId("prompt"),
          animated: false,
          className: graphEdgeClassForPortType("text"),
          style: graphEdgeStyleForPortType("text"),
          reconnectable: true,
        },
        {
          id: "edge-load-model",
          source: loadNode.id,
          sourceHandle: outputGraphHandleId("image"),
          target: modelNode.id,
          targetHandle: inputGraphHandleId("image_refs"),
          animated: false,
          className: graphEdgeClassForPortType("image"),
          style: graphEdgeStyleForPortType("image"),
          reconnectable: true,
        },
        {
          id: "edge-model-save",
          source: modelNode.id,
          sourceHandle: outputGraphHandleId("image"),
          target: saveNode.id,
          targetHandle: inputGraphHandleId("image"),
          animated: false,
          className: graphEdgeClassForPortType("image"),
          style: graphEdgeStyleForPortType("image"),
          reconnectable: true,
        },
      ]);
      setHistoryReady(true);
      return true;
    },
    [nodeHandlers, setEdges, setNodes],
  );

  const addLoadMediaNode = useCallback(
    (
      mediaType: "image" | "video" | "audio",
      fields: Record<string, unknown>,
      position?: { x: number; y: number },
    ) => {
      const definition = definitionsByType.get(`media.load_${mediaType}`);
      if (!definition) {
        appendConsole(`Load ${mediaType} node is not available.`);
        return;
      }
      setNodes((current) => {
        const nextNode = createNode(
          definition,
          position ?? { x: 120, y: 120 },
          nodeHandlers,
        );
        if (!position) {
          nextNode.position = findOpenGraphNodePosition({
            existingNodes: current,
            size: graphNodePlacementSize(nextNode),
          });
        }
        nextNode.data.fields = { ...nextNode.data.fields, ...fields };
        return [...current, nextNode];
      });
      const assetId = mediaType === "image" ? selectedAssetId(fields) : null;
      if (assetId) {
        void refreshAssetsByIds([assetId]).catch((error) =>
          appendConsole(
            `Selected image asset could not be hydrated: ${(error as Error).message}`,
          ),
        );
      }
    },
    [appendConsole, definitionsByType, nodeHandlers, refreshAssetsByIds, setNodes],
  );

  const addLoadImageNode = useCallback(
    (fields: Record<string, unknown>, position?: { x: number; y: number }) =>
      addLoadMediaNode("image", fields, position),
    [addLoadMediaNode],
  );

  const hydrateWorkflowPayload = useCallback(
    (
      workflow: GraphWorkflowPayload,
      options?: {
        workflowId?: string | null;
        workflowName?: string;
        workflowUpdatedAt?: string | null;
        run?: GraphRun | null;
        highlightNodeIds?: string[];
        assistantGenerated?: boolean;
        definitionsByType?: Map<string, GraphNodeDefinition>;
      },
    ) => {
      if (!workflow.nodes.length) {
        setWorkflowId(options?.workflowId ?? workflow.workflow_id ?? null);
        setWorkflowName(
          options?.workflowName || workflow.name || "New workflow",
        );
        setWorkflowUpdatedAt(options?.workflowUpdatedAt ?? null);
        setRun(options?.run ?? null);
        setNodes([]);
        setEdges([]);
        setGroups([]);
        canvasHydrated.current = true;
        setHistoryReady(true);
        return;
      }
      const restored = hydrateGraphWorkflowForCanvas({
        workflow,
        definitionsByType: options?.definitionsByType ?? definitionsByType,
        handlers: nodeHandlers,
        run: options?.run,
        onMissingDefinition: (nodeType) =>
          appendConsole(`Missing node definition for ${nodeType}.`),
      });
      setWorkflowId(options?.workflowId ?? workflow.workflow_id ?? null);
      setWorkflowName(
        options?.workflowName || workflow.name || "Untitled workflow",
      );
      setWorkflowUpdatedAt(options?.workflowUpdatedAt ?? null);
      setRun(options?.run ?? null);
      const highlightedNodeIds = new Set(options?.highlightNodeIds ?? []);
      setNodes(
        highlightedNodeIds.size || options?.assistantGenerated
          ? restored.nodes.map((node) =>
              highlightedNodeIds.has(node.id) || options?.assistantGenerated
                ? {
                    ...node,
                    selected: true,
                    data: {
                      ...(node.data as StudioNode["data"]),
                      activityLabel: "added",
                      activityDetail: "Created by Media Assistant",
                      activityTone: "success",
                    },
                  }
                : { ...node, selected: false },
            )
          : restored.nodes,
      );
      setEdges(restored.edges);
      setGroups(restored.groups);
      canvasHydrated.current = true;
      setHistoryReady(true);
    },
    [appendConsole, definitionsByType, nodeHandlers, setEdges, setNodes],
  );
  const applyUndoHistorySnapshot = useCallback(
    (historySnapshot: GraphHistorySnapshot) => {
      if (!historySnapshot.workflow.nodes.length) {
        const blankWorkflow = blankGraphWorkflowPayload(
          historySnapshot.workflowName ||
            historySnapshot.workflow.name ||
            "New workflow",
        );
        hydrateWorkflowPayload(blankWorkflow, {
          workflowId: null,
          workflowName: blankWorkflow.name,
          workflowUpdatedAt: null,
        });
        updateTab(activeTabIdRef.current, {
          workflowId: null,
          workflowName: blankWorkflow.name,
          workflow: blankWorkflow,
          savedWorkflowSignature: null,
          workflowUpdatedAt: null,
          runId: null,
          runStatus: null,
          consoleLines: ["Graph Studio ready."],
          dirty: false,
        });
        setConsoleLines(["Graph Studio ready."]);
        setSidebarDialog(null);
        closeWorkflowMenu();
        setNodeSearch(null);
        closeContextMenus();
        return;
      }
      hydrateWorkflowPayload(historySnapshot.workflow, {
        workflowId: historySnapshot.workflowId,
        workflowName: historySnapshot.workflowName,
        workflowUpdatedAt: historySnapshot.workflowUpdatedAt ?? null,
      });
      updateTab(activeTabIdRef.current, {
        workflowId: historySnapshot.workflowId,
        workflowName: historySnapshot.workflowName,
        workflow: historySnapshot.workflow,
        savedWorkflowSignature: historySnapshot.workflowId
          ? graphWorkflowSnapshotSignature(historySnapshot.workflow)
          : null,
        workflowUpdatedAt: historySnapshot.workflowUpdatedAt ?? null,
        runId: null,
        runStatus: null,
        consoleLines,
        dirty: Boolean(historySnapshot.workflowId),
      });
      setSidebarDialog(null);
      closeWorkflowMenu();
      setNodeSearch(null);
      closeContextMenus();
    },
    [
      closeContextMenus,
      closeWorkflowMenu,
      consoleLines,
      hydrateWorkflowPayload,
      setConsoleLines,
      updateTab,
    ],
  );
  const { canUndo, canRedo, undo, redo, commitSnapshot, replaceHistoryForTab } =
    useGraphUndoHistory({
      enabled: historyReady,
      activeTabId,
      snapshot: currentHistorySnapshot,
      applySnapshot: applyUndoHistorySnapshot,
    });

  const {
    assistantRedoAvailable,
    assistantUndoAvailable,
    applyAssistantWorkflow,
    redoGraphChange,
    undoGraphChange,
  } = useGraphAssistantHistory({
    activeTab,
    activeTabId,
    consoleLines,
    currentHistorySnapshot,
    currentWorkflowPayload,
    currentHistorySnapshotRef,
    nodesRef,
    edgesRef,
    workflowId,
    workflowName,
    workflowUpdatedAt,
    applyUndoHistorySnapshot,
    commitSnapshot,
    hydrateWorkflowPayload,
    markWorkspaceChanged,
    redo,
    undo,
    updateTab,
  });
  const applyAssistantWorkflowRef = useRef(applyAssistantWorkflow);
  useEffect(() => {
    applyAssistantWorkflowRef.current = applyAssistantWorkflow;
  }, [applyAssistantWorkflow]);
  const applyAssistantWorkflowWithFreshDefinitions = useCallback(
    async (
      workflow: GraphWorkflowPayload,
      options?: {
        highlightNodeIds?: string[];
        baseWorkflow?: GraphWorkflowPayload;
      },
    ) => {
      let refreshedDefinitionsByType:
        | Map<string, GraphNodeDefinition>
        | undefined;
      if (workflow.nodes.some((node) => node.type === "preset.render")) {
        try {
          const refreshedDefinitions = await reloadNodeDefinitions(true);
          refreshedDefinitionsByType = new Map(
            refreshedDefinitions.map((definition) => [
              definition.type,
              definition,
            ]),
          );
        } catch (error) {
          appendConsole(
            `Could not refresh graph node definitions before applying assistant plan: ${(error as Error).message}`,
          );
        }
      }
      applyAssistantWorkflowRef.current(workflow, {
        ...options,
        definitionsByType: refreshedDefinitionsByType,
      });
      if (refreshedDefinitionsByType) {
        const applyRefreshedCanvas = () => {
          const restored = hydrateGraphWorkflowForCanvas({
            workflow,
            definitionsByType: refreshedDefinitionsByType,
            handlers: nodeHandlers,
          });
          const highlightedNodeIds = new Set(options?.highlightNodeIds ?? []);
          setNodes(
            highlightedNodeIds.size
              ? restored.nodes.map((node) =>
                  highlightedNodeIds.has(node.id)
                    ? {
                        ...node,
                        selected: true,
                        data: {
                          ...(node.data as StudioNode["data"]),
                          activityLabel: "added",
                          activityDetail: "Created by Media Assistant",
                          activityTone: "success",
                        },
                      }
                    : { ...node, selected: false },
                )
              : restored.nodes,
          );
          setEdges(restored.edges);
          setGroups(restored.groups);
        };
        flushSync(applyRefreshedCanvas);
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            applyRefreshedCanvas();
          });
        });
      }
    },
    [appendConsole, nodeHandlers, reloadNodeDefinitions, setEdges, setNodes],
  );

  const hydrateLastRun = useCallback(
    async (runId: string, preloadedRun?: GraphRun) => {
      try {
        const current =
          preloadedRun ??
          (await jsonFetch<GraphRun>(`/api/control/media/graph/runs/${runId}`));
        setRun(current);
        applyRunNodesToCanvas(current);
        await refreshImageAssets().catch(() => undefined);
        await refreshAssetsByIds(assetIdsFromGraphRun(current)).catch(
          () => undefined,
        );
        await refreshReferenceMedia().catch(() => undefined);
        const events = await jsonFetch<{ items: GraphRunEvent[] }>(
          `/api/control/media/graph/runs/${runId}/events`,
        );
        if (events.items.length) {
          applyRunEventsToCanvas(events.items, current);
          setConsoleLines(formatGraphRunEventsForConsole(events.items, nodes));
        }
      } catch (error) {
        appendConsole(
          `Last run could not be restored: ${(error as Error).message}`,
        );
      }
    },
    [
      appendConsole,
      applyRunEventsToCanvas,
      applyRunNodesToCanvas,
      nodes,
      refreshAssetsByIds,
      refreshImageAssets,
      refreshReferenceMedia,
    ],
  );

  const hydrateLatestRunForWorkflow = useCallback(
    async (
      targetWorkflowId: string,
      currentWorkflow?: GraphWorkflowPayload | null,
    ) => {
      const payload = await jsonFetch<{ items?: GraphRunHistoryItem[] }>(
        "/api/control/media/graph/runs/summary?limit=15",
      );
      const latestRunSummary = payload.items?.find(
        (item) => item.workflow_id === targetWorkflowId,
      );
      if (latestRunSummary?.run_id) {
        const latestRun = await jsonFetch<GraphRun>(
          `/api/control/media/graph/runs/${latestRunSummary.run_id}`,
        );
        if (
          currentWorkflow &&
          latestRun.workflow_json &&
          !graphWorkflowSnapshotsMatch(currentWorkflow, latestRun.workflow_json)
        ) {
          appendConsole(
            `Skipped last-run restore for ${currentWorkflow.name} because the latest run came from a different workflow state.`,
          );
          return;
        }
        await hydrateLastRun(latestRunSummary.run_id, latestRun);
      }
    },
    [appendConsole, hydrateLastRun],
  );

  const loadWorkflowRecord = useCallback(
    (record: GraphWorkflowRecord) => {
      markWorkspaceChanged();
      const workflow = record.workflow_json;
      if (!workflow) {
        appendConsole(
          `Workflow ${record.workflow_id} has no saved graph data.`,
        );
        return;
      }
      const nextWorkflowName =
        record.name || workflow.name || "Untitled workflow";
      const savedWorkflow = {
        ...workflow,
        workflow_id: record.workflow_id,
        name: nextWorkflowName,
      };
      const savedCanvas = hydrateGraphWorkflowForCanvas({
        workflow: savedWorkflow,
        definitionsByType,
        handlers: nodeHandlers,
      });

      openWorkflowTab(
        {
          workflowId: record.workflow_id,
          workflowName: nextWorkflowName,
          workflow: savedWorkflow,
          savedWorkflowSignature: graphWorkflowSnapshotSignature(savedWorkflow),
          workflowUpdatedAt: record.updated_at ?? null,
          runId: null,
          runStatus: null,
          dirty: false,
        },
        {
          workflowId,
          workflowName,
          workflow: workflowFromCanvas(workflowId, workflowName, nodes, edges),
          savedWorkflowSignature: activeTab?.saved_workflow_signature ?? null,
          workflowUpdatedAt,
          runId: run?.run_id ?? null,
          runStatus: run?.status ?? null,
          consoleLines,
          dirty: graphWorkflowDirtyState({
            workflowId,
            workflowName,
            workflow: workflowFromCanvas(
              workflowId,
              workflowName,
              nodes,
              edges,
            ),
            savedWorkflowSignature: activeTab?.saved_workflow_signature ?? null,
            dirtyFallback: Boolean(activeTab?.dirty),
          }),
        },
      );
      setWorkflowId(record.workflow_id);
      setWorkflowName(nextWorkflowName);
      setWorkflowUpdatedAt(record.updated_at ?? null);
      setRun(null);
      setNodes(savedCanvas.nodes);
      setEdges(savedCanvas.edges);
      setGroups(savedCanvas.groups);
      canvasHydrated.current = true;
      setSidebarDialog(null);
      appendConsole(`Loaded workflow ${nextWorkflowName}.`);
      void hydrateLatestRunForWorkflow(record.workflow_id, savedWorkflow).catch(
        (error) => {
          appendConsole(
            `Latest run preview could not be restored: ${(error as Error).message}`,
          );
        },
      );
    },
    [
      activeTab,
      appendConsole,
      consoleLines,
      definitionsByType,
      edges,
      hydrateLatestRunForWorkflow,
      markWorkspaceChanged,
      nodeHandlers,
      nodes,
      openWorkflowTab,
      run?.run_id,
      setEdges,
      setNodes,
      workflowFromCanvas,
      workflowId,
      workflowName,
      workflowUpdatedAt,
    ],
  );

  const restoreWorkspaceSnapshot = useCallback(
    async (items: GraphNodeDefinition[], restoreVersion: number) => {
      if (!restoreVersionIsCurrent(restoreVersion)) return true;
      if (!sessionRestored || !activeTab) return false;
      let workflow = activeTab.workflow_json ?? null;
      let restoredWorkflowId =
        activeTab.workflow_id ?? workflow?.workflow_id ?? null;
      let restoredWorkflowName =
        activeTab.workflow_name || workflow?.name || "Untitled workflow";
      let restoredWorkflowUpdatedAt = activeTab.workflow_updated_at ?? null;
      let restoredSavedWorkflowSignature =
        activeTab.saved_workflow_signature ?? null;
      if (shouldReloadSavedWorkflowRecordOnRestore(activeTab)) {
        try {
          const record = await jsonFetch<GraphWorkflowRecord>(
            `/api/control/media/graph/workflows/${restoredWorkflowId}`,
          );
          if (!restoreVersionIsCurrent(restoreVersion)) return true;
          if (record.workflow_json) {
            workflow = {
              ...record.workflow_json,
              workflow_id: record.workflow_id,
              name:
                record.name || record.workflow_json.name || "Untitled workflow",
            };
            restoredWorkflowId = record.workflow_id;
            restoredWorkflowName =
              record.name || workflow.name || "Untitled workflow";
            restoredWorkflowUpdatedAt = record.updated_at ?? null;
            restoredSavedWorkflowSignature =
              graphWorkflowSnapshotSignature(workflow);
            updateActiveTab({
              workflowId: record.workflow_id,
              workflowName: restoredWorkflowName,
              workflow: workflow,
              savedWorkflowSignature: restoredSavedWorkflowSignature,
              workflowUpdatedAt: restoredWorkflowUpdatedAt,
              runId: activeTab.run_id ?? null,
              runStatus: activeTab.run_status ?? null,
              consoleLines: activeTab.console_lines ?? ["Graph Studio ready."],
              dirty: false,
            });
          }
        } catch {}
      }

      if (!workflow) return false;

      if (Array.isArray(workflow.nodes) && workflow.nodes.length === 0) {
        if (!restoreVersionIsCurrent(restoreVersion)) return true;
        setWorkflowId(restoredWorkflowId);
        setWorkflowName(restoredWorkflowName || "New workflow");
        setWorkflowUpdatedAt(restoredWorkflowUpdatedAt);
        setRun(null);
        setNodes([]);
        setEdges([]);
        setGroups([]);
        setConsoleLines(
          activeTab.console_lines?.length
            ? activeTab.console_lines
            : ["Graph Studio ready."],
        );
        canvasHydrated.current = true;
        setHistoryReady(true);
        return true;
      }
      if (!workflow?.nodes?.length) return false;
      const byType = new Map(
        items.map((definition) => [definition.type, definition]),
      );
      const restored = hydrateGraphWorkflowForCanvas({
        workflow,
        definitionsByType: byType,
        handlers: nodeHandlers,
      });
      if (!restored.nodes.length) return false;
      if (!restoreVersionIsCurrent(restoreVersion)) return true;
      setWorkflowId(restoredWorkflowId);
      setWorkflowName(restoredWorkflowName || "Untitled workflow");
      setWorkflowUpdatedAt(restoredWorkflowUpdatedAt);
      setRun(null);
      setNodes(restored.nodes);
      setEdges(restored.edges);
      setGroups(restored.groups);
      setConsoleLines(
        activeTab.console_lines?.length
          ? activeTab.console_lines
          : ["Graph Studio ready."],
      );
      canvasHydrated.current = true;
      setHistoryReady(true);
      if (!restoreVersionIsCurrent(restoreVersion)) return true;
      if (activeTab.run_id) {
        void hydrateLastRun(activeTab.run_id);
      } else if (restoredWorkflowId && !activeTab.dirty) {
        void hydrateLatestRunForWorkflow(String(restoredWorkflowId), workflow);
      }
      return true;
    },
    [
      activeTab,
      hydrateLastRun,
      hydrateLatestRunForWorkflow,
      nodeHandlers,
      restoreVersionIsCurrent,
      sessionRestored,
      setEdges,
      setNodes,
      updateActiveTab,
    ],
  );

  const restoreLatestRunSnapshot = useCallback(
    async (items: GraphNodeDefinition[], restoreVersion: number) => {
      if (!restoreVersionIsCurrent(restoreVersion)) return true;
      const payload = await jsonFetch<{ items?: GraphRun[] }>(
        "/api/control/media/graph/runs?limit=1",
      );
      if (!restoreVersionIsCurrent(restoreVersion)) return true;
      const latestRun = payload.items?.[0];
      const workflow = latestRun?.workflow_json;
      if (!latestRun || !workflow?.nodes?.length) return false;
      const byType = new Map(
        items.map((definition) => [definition.type, definition]),
      );
      const restored = hydrateGraphWorkflowForCanvas({
        workflow,
        definitionsByType: byType,
        handlers: nodeHandlers,
        run: latestRun,
      });
      if (!restored.nodes.length) return false;
      if (!restoreVersionIsCurrent(restoreVersion)) return true;
      setWorkflowId(latestRun.workflow_id ?? workflow.workflow_id ?? null);
      setWorkflowName(workflow.name || "Untitled workflow");
      setWorkflowUpdatedAt(null);
      setRun(latestRun);
      setNodes(restored.nodes);
      setEdges(restored.edges);
      setGroups(restored.groups);
      canvasHydrated.current = true;
      setHistoryReady(true);
      await refreshImageAssets().catch(() => undefined);
      await refreshAssetsByIds(assetIdsFromGraphRun(latestRun)).catch(
        () => undefined,
      );
      if (!restoreVersionIsCurrent(restoreVersion)) return true;
      const events = await jsonFetch<{ items: GraphRunEvent[] }>(
        `/api/control/media/graph/runs/${latestRun.run_id}/events`,
      );
      if (!restoreVersionIsCurrent(restoreVersion)) return true;
      if (events.items.length) {
        applyRunEventsToCanvas(events.items, latestRun);
        setConsoleLines(
          formatGraphRunEventsForConsole(events.items, restored.nodes),
        );
      }
      appendConsole(`Restored latest graph run ${latestRun.run_id}.`);
      return true;
    },
    [
      appendConsole,
      applyRunEventsToCanvas,
      nodeHandlers,
      refreshAssetsByIds,
      refreshImageAssets,
      restoreVersionIsCurrent,
      setEdges,
      setNodes,
    ],
  );

  useGraphWorkspaceRestore({
    appendConsole,
    buildStarterWorkflow,
    canvasHydrated,
    definitionsLoadStarted,
    reloadNodeDefinitions,
    restoreLatestRunSnapshot,
    restoreVersionIsCurrent,
    restoreWorkspaceSnapshot,
    storageScope,
    workspaceRestoreVersionRef,
  });

  useEffect(() => {
    const maybeRefreshDefinitions = () => {
      const revision = readGraphNodeDefinitionsRevision();
      if (
        !revision?.changedAt ||
        revision.changedAt === latestDefinitionsRevision.current
      ) {
        return;
      }
      latestDefinitionsRevision.current = revision.changedAt;
      void reloadNodeDefinitions(true)
        .then(() => {
          appendConsole(
            `Updated graph node definitions after ${revision.reason.replaceAll("-", " ")}.`,
          );
        })
        .catch((error) => {
          appendConsole(
            `Failed to refresh graph node definitions: ${(error as Error).message}`,
          );
        });
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === GRAPH_NODE_DEFINITIONS_STORAGE_KEY) {
        maybeRefreshDefinitions();
      }
    };
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        maybeRefreshDefinitions();
      }
    };

    window.addEventListener(
      GRAPH_NODE_DEFINITIONS_EVENT,
      maybeRefreshDefinitions as EventListener,
    );
    window.addEventListener("storage", handleStorage);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener(
        GRAPH_NODE_DEFINITIONS_EVENT,
        maybeRefreshDefinitions as EventListener,
      );
      window.removeEventListener("storage", handleStorage);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [appendConsole, reloadNodeDefinitions]);

  useEffect(() => {
    refreshWorkflows().catch((error) =>
      appendConsole(`Failed to load workflows: ${error.message}`),
    );
    refreshTemplates().catch((error) =>
      appendConsole(`Failed to load templates: ${error.message}`),
    );
    void refreshCredits();
  }, [appendConsole, refreshCredits, refreshTemplates, refreshWorkflows]);

  useEffect(() => {
    void refreshMediaLibrary();
  }, [refreshMediaLibrary]);

  useEffect(() => {
    if (sidebarDialog !== "runs") return;
    refreshRunHistory().catch((error) =>
      appendConsole(`Failed to load run history: ${(error as Error).message}`),
    );
  }, [appendConsole, refreshRunHistory, sidebarDialog]);

  const { copySelectedNodes, pasteCopiedNodes } = useGraphClipboard({
    nodes,
    edges,
    nodeHandlers,
    groups,
    setNodes,
    setEdges,
    setGroups,
    appendConsole,
  });

  useGraphKeyboardShortcuts({
    nodes,
    imageLibraryNodeId,
    copySelectedNodes,
    pasteCopiedNodes,
    undoGraphChange,
    redoGraphChange,
    toggleGraphNodeExecutionMode,
    setConsoleOpen,
    setNodeSearch,
    setImageLibraryNodeId,
    setPreviewOverlay,
    setSidebarDialog,
    setWorkflowMenuOpen,
    setRenameDialogOpen,
    setNodeContextMenu,
    cancelNodeRename,
    openNodeSearchCentered: () => {
      openCanvasNodeSearch(
        Math.floor(window.innerWidth / 2 - 180),
        Math.floor(window.innerHeight / 2 - 220),
      );
      setSidebarDialog(null);
    },
  });

  useEffect(() => {
    const onOpenImageLibrary = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          nodeId?: string;
          mediaType?: "image" | "video" | "audio";
        }>
      ).detail;
      if (detail?.nodeId) {
        setImageLibraryNodeId(detail.nodeId, detail.mediaType ?? "image");
      }
    };
    const onNodeImageDrop = (event: Event) => {
      const detail = (event as CustomEvent<{ nodeId?: string; file?: File }>)
        .detail;
      if (detail?.nodeId && detail.file) {
        void handleNodeImageDrop(detail.nodeId, detail.file);
      }
    };
    window.addEventListener(
      "graph-studio-open-image-library",
      onOpenImageLibrary,
    );
    window.addEventListener("graph-studio-node-image-drop", onNodeImageDrop);
    return () => {
      window.removeEventListener(
        "graph-studio-open-image-library",
        onOpenImageLibrary,
      );
      window.removeEventListener(
        "graph-studio-node-image-drop",
        onNodeImageDrop,
      );
    };
  }, [handleNodeImageDrop, setImageLibraryNodeId]);

  const {
    importWorkflowInputRef,
    exportWorkflow,
    exportWorkflowBundle,
    importWorkflowFile,
  } = useGraphWorkflowTransfer({
    workflowId,
    workflowName,
    nodes,
    edges,
    definitions,
    references,
    setReferences,
    workflowFromCanvas,
    hydrateWorkflowPayload,
    setWorkflowMenuOpen,
    appendConsole,
  });

  const startConsoleResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startY = event.clientY;
      const startHeight = consoleHeight;
      const onPointerMove = (moveEvent: PointerEvent) => {
        const delta = startY - moveEvent.clientY;
        setConsoleHeight(Math.max(80, Math.min(420, startHeight + delta)));
      };
      const onPointerUp = () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
      };
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    },
    [consoleHeight],
  );

  const {
    graphEstimate,
    pricingByNode,
    confirmPricingForRun,
    pricingConfirmation,
    answerPricingConfirmation,
  } = useGraphPricingEstimate({
    workflowId,
    workflowName,
    nodes,
    edges,
    availableCredits,
    workflowFromCanvas,
    appendConsole,
  });

  const { runWorkflow, cancelRun, transportMetrics } = useGraphRunLifecycle({
    run,
    setRun,
    workflowId,
    workflowName,
    nodes,
    edges,
    saveWorkflow,
    workflowFromCanvas,
    resetNodeRunState,
    applyValidationErrorsToNodes,
    applyRunNodesToCanvas,
    applyRunEventsToCanvas,
    refreshCredits,
    refreshImageAssets,
    refreshAssetsByIds,
    refreshReferenceMedia,
    setConsoleLines,
    appendConsole,
    confirmPricingForRun,
  });

  const onDrop = useCallback(
    async (event: ReactDragEvent) => {
      event.preventDefault();
      const graphMedia = readGraphMediaDragPayload(event.dataTransfer);
      if (graphMedia) {
        const mediaType =
          graphMedia.mediaType === "video" || graphMedia.mediaType === "audio"
            ? graphMedia.mediaType
            : "image";
        addLoadMediaNode(
          mediaType,
          graphMedia.source === "reference"
            ? { reference_id: graphMedia.id }
            : { asset_id: graphMedia.id },
          { x: event.clientX - 260, y: event.clientY - 120 },
        );
        appendConsole(`Added Load ${mediaType} node for ${graphMedia.id}.`);
        return;
      }
      const file = event.dataTransfer.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      try {
        const reference = await importImageFile(file);
        addLoadImageNode(
          { reference_id: reference.reference_id },
          { x: event.clientX - 260, y: event.clientY - 120 },
        );
        appendConsole(`Imported reference ${reference.reference_id}.`);
      } catch (error) {
        appendConsole((error as Error).message);
      }
    },
    [addLoadImageNode, addLoadMediaNode, appendConsole, importImageFile],
  );

  const nodesForRender = useGraphNodePreviews({
    nodes,
    edges,
    assets,
    references,
    nodeHandlers,
    activeConnection,
    renamingNodeId,
    nodeRenameDraft,
    pricingByNode,
  });
  useEffect(() => {
    if (!nodesForRender.length) return;
    const previewByNodeId = new Map(
      nodesForRender.map((node) => [
        node.id,
        (node.data as StudioNode["data"]).mediaPreview ?? null,
      ]),
    );
    setNodes((current) => {
      let changed = false;
      const nextNodes = current.map((node) => {
        const data = node.data as StudioNode["data"];
        const preview = previewByNodeId.get(node.id);
        const signature = graphMediaPreviewFitSignature(preview);
        if (!signature) return node;
        if ((data.mediaAutoFitSignature as string | undefined) === signature)
          return node;
        const fitted = computeGraphMediaPreviewFitSize({
          definition: data.definition,
          node,
          preview,
          autoSizedHeight: data.autoSizedHeight,
        });
        if (!fitted) return node;
        changed = true;
        return {
          ...node,
          style: {
            ...node.style,
            width: fitted.width,
            height: fitted.height,
          },
          data: {
            ...data,
            autoSizedHeight: fitted.autoSizedHeight,
            mediaAutoFitSignature: signature,
          },
        };
      });
      return changed ? nextNodes : current;
    });
  }, [nodesForRender, setNodes]);
  const groupsForRender = useMemo(
    () => graphGroupsForCanvas(groups, nodesForRender),
    [groups, nodesForRender],
  );

  const attachReferenceToNode = useCallback(
    (nodeId: string, referenceId: string) => {
      setNodeFields(nodeId, { reference_id: referenceId, asset_id: "" });
      void refreshReferencesByIds([referenceId]).catch((error) =>
        appendConsole(
          `Selected reference media could not be hydrated: ${(error as Error).message}`,
        ),
      );
      setImageLibraryNodeId(null);
      appendConsole(`Attached reference ${referenceId}.`);
    },
    [appendConsole, refreshReferencesByIds, setNodeFields, setImageLibraryNodeId],
  );

  const attachAssetToNode = useCallback(
    (nodeId: string, assetId: string) => {
      setNodeFields(nodeId, { asset_id: assetId, reference_id: "" });
      void refreshAssetsByIds([assetId]).catch((error) =>
        appendConsole(
          `Selected media asset could not be hydrated: ${(error as Error).message}`,
        ),
      );
      setImageLibraryNodeId(null);
      appendConsole(`Attached asset ${assetId}.`);
    },
    [appendConsole, refreshAssetsByIds, setNodeFields, setImageLibraryNodeId],
  );

  const restoreRunFromHistory = useCallback(
    async (historyRun: GraphRunHistoryItem) => {
      markWorkspaceChanged();
      try {
        const fullRun = historyRun.workflow_json?.nodes?.length
          ? (historyRun as GraphRun)
          : await jsonFetch<GraphRun>(
              `/api/control/media/graph/runs/${historyRun.run_id}`,
            );
        const workflow = fullRun.workflow_json;
        if (!workflow?.nodes?.length) {
          appendConsole(
            `Run ${historyRun.run_id} does not include a restorable workflow snapshot.`,
          );
          return;
        }
        hydrateWorkflowPayload(workflow, {
          workflowId: fullRun.workflow_id,
          workflowName: workflow.name,
          workflowUpdatedAt,
          run: fullRun,
        });
        setSidebarDialog(null);
        appendConsole(`Restored graph run ${historyRun.run_id}.`);
      } catch (error) {
        appendConsole(
          `Run ${historyRun.run_id} could not be restored: ${(error as Error).message}`,
        );
      }
    },
    [
      appendConsole,
      hydrateWorkflowPayload,
      markWorkspaceChanged,
      workflowUpdatedAt,
    ],
  );

  const {
    snapshotActiveTab,
    switchWorkflowTab,
    closeWorkflowTab,
    closeOtherWorkflowTabs,
    openNewWorkflowTab,
    closeActiveWorkflow,
  } = useGraphTabWorkspace({
    activeTab,
    activeTabId,
    tabs,
    storageScope,
    workflowId,
    workflowName,
    workflowUpdatedAt,
    nodes,
    edges,
    run,
    consoleLines,
    canvasHydrated: canvasHydrated.current,
    workflowFromCanvas,
    updateActiveTab,
    switchTab,
    closeTab,
    closeOtherTabs,
    openBlankTab,
    hydrateWorkflowPayload,
    hydrateLastRun,
    closeWorkflow,
    replaceHistoryForTab,
    setConsoleLines,
  });
  const switchWorkflowTabAndMark = useCallback(
    (tabId: string) => {
      markWorkspaceChanged();
      switchWorkflowTab(tabId);
    },
    [markWorkspaceChanged, switchWorkflowTab],
  );
  const closeWorkflowTabAndMark = useCallback(
    (tabId: string) => {
      markWorkspaceChanged();
      closeWorkflowTab(tabId);
    },
    [closeWorkflowTab, markWorkspaceChanged],
  );
  const openNewWorkflowTabAndMark = useCallback(() => {
    markWorkspaceChanged();
    openNewWorkflowTab();
  }, [markWorkspaceChanged, openNewWorkflowTab]);
  const closeOtherWorkflowTabsAndMark = useCallback(() => {
    markWorkspaceChanged();
    closeOtherWorkflowTabs();
  }, [closeOtherWorkflowTabs, markWorkspaceChanged]);
  const closeActiveWorkflowAndMark = useCallback(() => {
    markWorkspaceChanged();
    closeActiveWorkflow();
    setAssistantWorkspaceResetVersion((current) => current + 1);
  }, [closeActiveWorkflow, markWorkspaceChanged]);
  const toolbarWorkflowActions = useGraphToolbarWorkflowActions({
    commitRenameWorkflow,
    consoleLines,
    edges,
    nodes,
    openRenameWorkflow,
    renameDraft,
    run,
    saveWorkflow,
    saveWorkflowAs,
    setRenameDraft,
    setWorkflowUpdatedAt,
    updateActiveTab,
    workflowFromCanvas,
    workflowId,
    workflowName,
    workflowUpdatedAt,
    closeWorkflowMenu,
  });

  return (
    <GraphProviderModelCatalogProvider value={providerModelCatalog}>
      <div
        className="graph-studio-shell"
        onDrop={onDrop}
        onDragOver={(event) => event.preventDefault()}
      >
        <GraphLeftRail
          galleryHref={galleryHref}
          sidebarDialog={sidebarDialog}
          showMiniMap={showMiniMap}
          consoleOpen={consoleOpen}
          assistantOpen={assistantEnabled && assistantOpen}
          assistantEnabled={assistantEnabled}
          onToggleDialog={(dialog) =>
            setSidebarDialog((current) => (current === dialog ? null : dialog))
          }
          onToggleMiniMap={() => setShowMiniMap((current) => !current)}
          onToggleConsole={() => setConsoleOpen((current) => !current)}
          onToggleAssistant={() => {
            if (assistantEnabled) {
              setAssistantOpen((current) => !current);
            }
          }}
        />
        <main
          className={`graph-main ${consoleOpen ? "" : "graph-main-console-collapsed"}`}
          style={
            consoleOpen
              ? {
                  gridTemplateRows: `auto minmax(0, 1fr) 6px ${consoleHeight}px`,
                }
              : undefined
          }
        >
          <GraphToolbar
            workflowName={workflowName}
            tabs={tabs}
            activeTabId={activeTabId}
            workflowMenuOpen={workflowMenuOpen}
            renameDialogOpen={renameDialogOpen}
            renameDraft={renameDraft}
            run={run}
            transportMetrics={transportMetrics}
            creditText={
              creditsUnavailable
                ? "Credits unavailable"
                : availableCredits == null
                  ? "Credits syncing"
                  : `${formatCreditsAmount(availableCredits)} credits`
            }
            creditsUnavailable={creditsUnavailable}
            graphPricing={graphEstimate}
            onToggleWorkflowMenu={toggleWorkflowMenu}
            onCloseWorkflowMenu={closeWorkflowMenu}
            onSwitchTab={switchWorkflowTabAndMark}
            onNewTab={openNewWorkflowTabAndMark}
            onCloseTab={closeWorkflowTabAndMark}
            onCloseOtherTabs={closeOtherWorkflowTabsAndMark}
            canUndo={canUndo || assistantUndoAvailable}
            canRedo={canRedo || assistantRedoAvailable}
            onUndo={undoGraphChange}
            onRedo={redoGraphChange}
            onSave={toolbarWorkflowActions.onSave}
            onSaveAs={toolbarWorkflowActions.onSaveAs}
            onExportWorkflow={exportWorkflow}
            onExportBundle={() => {
              void exportWorkflowBundle();
            }}
            onOpenRename={toolbarWorkflowActions.onOpenRename}
            onCloseWorkflow={closeActiveWorkflowAndMark}
            onRenameDraftChange={setRenameDraft}
            onCommitRename={toolbarWorkflowActions.onCommitRename}
            onCancelRename={() => setRenameDialogOpen(false)}
            onRun={runWorkflow}
            onCancelRun={cancelRun}
          />
          {assistantEnabled ? (
            <CreativeAssistantPanel
              open={assistantOpen}
              bottomOffset={consoleOpen ? consoleHeight + 22 : 18}
              workspaceKey={`${activeTabId}:${assistantWorkspaceResetVersion}`}
              workflowId={workflowId}
              workflowName={workflowName}
              workflow={currentWorkflowPayload}
              latestRunId={run?.run_id ?? activeTab?.run_id ?? null}
              latestRunStatus={run?.status ?? activeTab?.run_status ?? null}
              selectedNodeIds={selectedAssistantNodeIds}
              initialAssistantSessionId={activeTab?.assistant_session_id ?? null}
              reviewReturnTo={`/graph-studio?tab=${encodeURIComponent(activeTabId)}`}
              references={references}
              importImageFile={importImageFile}
              onBeforeReviewNavigate={snapshotActiveTab}
              onAssistantSessionChange={handleAssistantSessionChange}
              onApplyWorkflow={applyAssistantWorkflowWithFreshDefinitions}
              onUndoLastAssistantChange={undoGraphChange}
              onRunWorkflow={runWorkflow}
              onOpenPreview={(preview, collection) => {
                const previews = collection?.length ? collection : [preview];
                const index = Math.max(
                  0,
                  previews.findIndex((item) => item.url === preview.url),
                );
                setPreviewOverlay({ previews, index });
              }}
              onClose={() => setAssistantOpen(false)}
              onEvent={(message) => appendConsole(message)}
            />
          ) : null}
          <GraphCanvas
            nodes={nodesForRender}
            edges={edges}
            showMiniMap={showMiniMap}
            groups={groupsForRender}
            activeConnection={activeConnection}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onConnectStart={onConnectStart}
            onConnectEnd={onConnectEnd}
            onReconnect={onReconnect}
            onReconnectEnd={onReconnectEnd}
            isValidConnection={edgeIsValid}
            setNodes={setNodes}
            setEdges={setEdges}
            setNodeSearch={setNodeSearch}
            setWorkflowMenuOpen={setWorkflowMenuOpen}
            setNodeContextMenu={setNodeContextMenu}
            setGroupContextMenu={setGroupContextMenu}
            openNodeSearch={openCanvasNodeSearch}
          />
          <GraphConsole
            open={consoleOpen}
            lines={consoleLines}
            onResizeStart={startConsoleResize}
          />
        </main>
        {manualWireDrag ? (
          <svg
            className="graph-wire-drag-overlay"
            aria-hidden="true"
            width="100vw"
            height="100vh"
          >
            <path
              className={`graph-wire-drag-path graph-wire-drag-path-${manualWireDrag.portType}`}
              d={`M ${manualWireDrag.sourcePoint.x} ${manualWireDrag.sourcePoint.y} C ${manualWireDrag.sourcePoint.x + 90} ${manualWireDrag.sourcePoint.y}, ${
                manualWireDrag.pointer.x - 90
              } ${manualWireDrag.pointer.y}, ${manualWireDrag.pointer.x} ${manualWireDrag.pointer.y}`}
            />
          </svg>
        ) : null}
        <input
          ref={importWorkflowInputRef}
          type="file"
          accept=".json,.zip,.media-studio-graph.json,.media-studio-graph.zip,application/json,application/zip"
          className="graph-hidden-file-input"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) {
              void importWorkflowFile(file);
            }
          }}
        />
        <GraphPreviewOverlay
          previews={previewOverlay?.previews ?? []}
          index={previewOverlay?.index ?? 0}
          onClose={() => setPreviewOverlay(null)}
          onNavigate={(index) =>
            setPreviewOverlay((current) =>
              current ? { ...current, index } : current,
            )
          }
        />
        <GraphPricingConfirmation
          state={pricingConfirmation}
          availableCredits={availableCredits}
          onAnswer={answerPricingConfirmation}
        />
        <GraphStudioFixtureLayer kind={graphFixture} />
        <GraphStudioDialogs
          sidebarDialog={sidebarDialog}
          definitions={definitions}
          definitionsByCategory={definitionsByCategory}
          workflows={workflows}
          templates={templates}
          workflowId={workflowId}
          runHistory={runHistory}
          selectedHistoryRunId={selectedHistoryRunId}
          selectedRunArtifacts={selectedRunArtifacts}
          nodeSearch={nodeSearch}
          nodeContextMenu={nodeContextMenu}
          groupContextMenu={groupContextMenu}
          groups={groups}
          nodes={nodes}
          groupTitleDraft={groupTitleDraft}
          imageLibraryNodeId={imageLibraryNodeId}
          imageLibraryMediaType={imageLibraryMediaType}
          onCloseSidebar={() => setSidebarDialog(null)}
          onLoadStarterTemplate={() => {
            markWorkspaceChanged();
            if (buildStarterWorkflow(definitions)) {
              setWorkflowName("Nano Image Pipeline");
              setWorkflowId(null);
              setRun(null);
              setSidebarDialog(null);
              appendConsole("Loaded Nano image pipeline template.");
            }
          }}
          onLoadWorkflow={loadWorkflowRecord}
          onInstantiateTemplate={(template) => {
            instantiateTemplate(template.template_id)
              .then(loadWorkflowRecord)
              .catch((error) =>
                appendConsole(
                  `Instantiate template failed: ${(error as Error).message}`,
                ),
              );
          }}
          onDeleteWorkflow={(workflow) => {
            void deleteWorkflowRecord(workflow).catch((error) =>
              appendConsole(
                `Delete workflow failed: ${(error as Error).message}`,
              ),
            );
          }}
          onDeleteTemplate={(template) => {
            void deleteTemplate(template.template_id).catch((error) =>
              appendConsole(
                `Delete template failed: ${(error as Error).message}`,
              ),
            );
          }}
          onImportWorkflow={() => importWorkflowInputRef.current?.click()}
          onAddDefinitionNode={(definition) => {
            addDefinitionNode(definition);
            setSidebarDialog(null);
          }}
          onAddLoadImageNode={(fields) => {
            addLoadImageNode(fields);
            setSidebarDialog(null);
          }}
          onRefreshRunHistory={() => {
            refreshRunHistory().catch((error) =>
              appendConsole(
                `Failed to load run history: ${(error as Error).message}`,
              ),
            );
          }}
          onInspectRun={(runId) => {
            inspectRunArtifacts(runId).catch((error) =>
              appendConsole(
                `Failed to inspect artifacts: ${(error as Error).message}`,
              ),
            );
          }}
          onRestoreRun={restoreRunFromHistory}
          onPinArtifact={(artifact) =>
            setGraphNodeCachedOutput(artifact.node_id, artifact.run_id, {
              [artifact.output_port]: [artifact.artifact_id],
            })
          }
          onNodeSearchQueryChange={(query) =>
            setNodeSearch((current) =>
              current ? { ...current, query } : current,
            )
          }
          onNodeSearchSelect={addDefinitionNodeFromSearch}
          onNodeSearchClose={() => setNodeSearch(null)}
          onSetNodeExecutionMode={setGraphNodeExecutionMode}
          onSetNodeColor={setGraphNodeColor}
          onClearNodes={clearGraphNodes}
          onCreateGroup={() => {
            createGroupFromSelection();
            closeContextMenus();
          }}
          onRenameNode={startNodeRename}
          onGroupTitleDraftChange={setGroupTitleDraft}
          onRenameGroup={renameGroup}
          onSetGroupColor={setGroupColor}
          onSetGroupExecutionMode={setGroupExecutionMode}
          onDeleteGroup={deleteGroup}
          onCloseGroupContext={closeGroupContextMenu}
          onCloseImageLibrary={() => setImageLibraryNodeId(null)}
          onAttachReference={attachReferenceToNode}
          onAttachAsset={attachAssetToNode}
        />
      </div>
    </GraphProviderModelCatalogProvider>
  );
}
