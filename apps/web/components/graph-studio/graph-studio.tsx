"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent } from "react";
import { addEdge, ReactFlowProvider, useReactFlow, useEdgesState, useNodesState } from "@xyflow/react";

import { formatCreditsAmount } from "@/lib/utils";
import { GraphCanvas } from "./graph-canvas";
import { GraphConsole } from "./graph-console";
import { GraphLeftRail } from "./graph-left-rail";
import type { GraphSidebarDialog } from "./graph-library-dialogs";
import { GraphPreviewOverlay } from "./graph-preview-overlay";
import { GraphPricingConfirmation } from "./graph-pricing-confirmation";
import { GraphStudioDialogs } from "./graph-studio-dialogs";
import { GraphToolbar } from "./graph-toolbar";
import { NODE_COLOR_CHOICES, WORKSPACE_STORAGE_KEY } from "./graph-studio-constants";
import { useGraphClipboard } from "./hooks/use-graph-clipboard";
import { useGraphConsole } from "./hooks/use-graph-console";
import { useGraphConnections } from "./hooks/use-graph-connections";
import { useGraphKeyboardShortcuts } from "./hooks/use-graph-keyboard-shortcuts";
import { useGraphGroups } from "./hooks/use-graph-groups";
import { useGraphMediaLibrary } from "./hooks/use-graph-media-library";
import { useGraphNodeOperations } from "./hooks/use-graph-node-operations";
import { useGraphNodePreviews } from "./hooks/use-graph-node-previews";
import { useGraphNodeSearchState } from "./hooks/use-graph-node-search";
import { useGraphPricingEstimate } from "./hooks/use-graph-pricing-estimate";
import { useGraphRunHistory } from "./hooks/use-graph-run-history";
import { useGraphTabs } from "./hooks/use-graph-tabs";
import { useGraphTemplates } from "./hooks/use-graph-templates";
import { useGraphRunLifecycle, type GraphValidationError } from "./hooks/use-graph-run-lifecycle";
import { useGraphWorkflowActions } from "./hooks/use-graph-workflow-actions";
import { useGraphWorkflowTransfer } from "./hooks/use-graph-workflow-transfer";
import type { GraphGroup, GraphMediaPreview, GraphNodeDefinition, GraphRun, GraphRunEvent, GraphWorkflowPayload, GraphWorkflowRecord, StudioEdge, StudioNode } from "./types";
import { jsonFetch } from "./utils/graph-api";
import { graphGroupsForCanvas } from "./utils/graph-groups";
import { assetIdsFromGraphRun, readGraphMediaDragPayload } from "./utils/graph-media-preview";
import { graphEdgeClassForPortType, graphEdgeStyleForPortType } from "./utils/graph-node-layout";
import { inputGraphHandleId, outputGraphHandleId } from "./utils/graph-port-handles";
import { formatGraphRunEventsForConsole, graphNodeActivitiesFromRunEvents } from "./utils/graph-run-events";
import { createGraphNode as createNode, workflowFromCanvas as buildWorkflowPayload, type GraphNodeHandlers } from "./utils/graph-serialization";
import { blankGraphWorkflowPayload } from "./utils/graph-tabs";
import { hydrateGraphWorkflowForCanvas } from "./utils/graph-workflow-hydration";
export function GraphStudio() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) {
    return <div className="graph-shell graph-shell-loading" aria-label="Loading Graph Studio" />;
  }
  return <ReactFlowProvider><GraphStudioClient /></ReactFlowProvider>;
}

function GraphStudioClient() {
  const { screenToFlowPosition } = useReactFlow<StudioNode, StudioEdge>();
  const [definitions, setDefinitions] = useState<GraphNodeDefinition[]>([]);
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [workflowName, setWorkflowName] = useState("Nano Image Pipeline");
  const { consoleLines, setConsoleLines, appendConsole } = useGraphConsole();
  const { templates, refreshTemplates, instantiateTemplate, deleteTemplate } = useGraphTemplates({ appendConsole });
  const { tabs, activeTabId, updateActiveTab, openBlankTab, openWorkflowTab, closeTab, switchTab } = useGraphTabs();
  const [run, setRun] = useState<GraphRun | null>(null);
  const {
    references,
    setReferences,
    assets,
    availableCredits,
    creditsUnavailable,
    refreshCredits,
    refreshImageAssets,
    refreshAssetsByIds,
    refreshReferenceMedia,
    refreshMediaLibrary,
    importImageFile,
  } = useGraphMediaLibrary();
  const [previewOverlay, setPreviewOverlay] = useState<{ previews: GraphMediaPreview[]; index: number } | null>(null);
  const { nodeSearch, setNodeSearch, openNodeSearch } = useGraphNodeSearchState(screenToFlowPosition);
  const [imageLibraryNodeId, setImageLibraryNodeId] = useState<string | null>(null);
  const [sidebarDialog, setSidebarDialog] = useState<GraphSidebarDialog | null>(null);
  const [consoleOpen, setConsoleOpen] = useState(true);
  const [consoleHeight, setConsoleHeight] = useState(170);
  const [showMiniMap, setShowMiniMap] = useState(false);
  const [workflowMenuOpen, setWorkflowMenuOpen] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [groups, setGroups] = useState<GraphGroup[]>([]);
  const [nodeContextMenu, setNodeContextMenu] = useState<{ nodeIds: string[]; anchorNodeId: string; x: number; y: number } | null>(null);
  const [groupContextMenu, setGroupContextMenu] = useState<{ groupId: string; x: number; y: number } | null>(null);
  const [groupTitleDraft, setGroupTitleDraft] = useState("");
  const [renamingNodeId, setRenamingNodeId] = useState<string | null>(null);
  const [nodeRenameDraft, setNodeRenameDraft] = useState("");
  const definitionsLoadStarted = useRef(false);
  const canvasHydrated = useRef(false);

  const openCanvasNodeSearch = useCallback((x: number, y: number, connection?: Parameters<typeof openNodeSearch>[2]) => {
    openNodeSearch(x, y, connection); setWorkflowMenuOpen(false); setNodeContextMenu(null); setGroupContextMenu(null);
  }, [openNodeSearch]);
  const [nodes, setNodes, onNodesChange] = useNodesState<StudioNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<StudioEdge>([]);
  const workflowFromCanvas = useCallback(
    (nextWorkflowId: string | null, nextWorkflowName: string, currentNodes: StudioNode[], currentEdges: StudioEdge[]) =>
      buildWorkflowPayload(nextWorkflowId, nextWorkflowName, currentNodes, currentEdges, groups),
    [groups],
  );

  const { workflows, refreshWorkflows, saveWorkflow, saveWorkflowAs, openRenameWorkflow, commitRenameWorkflow, closeWorkflow, deleteWorkflowRecord } = useGraphWorkflowActions({
    workflowId,
    workflowName,
    renameDraft,
    nodes,
    edges,
    workflowFromCanvas,
    setWorkflowId,
    setWorkflowName,
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
    setNodes((current) =>
      current.map((node) => ({
        ...node,
        data: {
          ...(node.data as StudioNode["data"]),
          status: "idle", progress: null, errorMessage: null, activityLabel: null, activityDetail: null, activityTone: null,
        },
      })),
    );
  }, [setNodes]);

  const applyValidationErrorsToNodes = useCallback(
    (errors: GraphValidationError[]) => {
      const messagesByNode = new Map<string, string[]>();
      errors.forEach((error) => {
        if (!error.node_id) return;
        messagesByNode.set(error.node_id, [...(messagesByNode.get(error.node_id) ?? []), error.message]);
      });
      setNodes((current) =>
        current.map((node) => {
          const messages = messagesByNode.get(node.id);
          if (!messages?.length) return node;
          return {
            ...node,
            data: {
              ...(node.data as StudioNode["data"]),
              status: "failed", progress: null, errorMessage: messages.join("; "), activityLabel: "error", activityDetail: messages.join("; "), activityTone: "error",
            },
          };
        }),
      );
    },
    [setNodes],
  );

  const applyRunNodesToCanvas = useCallback(
    (currentRun: GraphRun) => {
      setNodes((existing) =>
        existing.map((node) => {
          const runNode = currentRun.nodes?.find((item) => item.node_id === node.id);
          if (!runNode) return node;
          return {
            ...node,
            data: {
              ...(node.data as StudioNode["data"]),
              status: runNode.status,
              progress: runNode.progress ?? null,
              errorMessage: runNode.error ?? null,
              outputSnapshot: runNode.output_snapshot_json,
            },
          };
        }),
      );
    },
    [setNodes],
  );
  const applyRunEventsToCanvas = useCallback((events: GraphRunEvent[], currentRun: GraphRun | null) => {
    const activities = graphNodeActivitiesFromRunEvents(events, currentRun);
    setNodes((existing) => existing.map((node) => {
      const activity = activities[node.id];
      return activity ? { ...node, data: { ...(node.data as StudioNode["data"]), activityLabel: activity.label, activityDetail: activity.detail ?? null, activityTone: activity.tone } } : node;
    }));
  }, [setNodes]);

  const onFieldChange = useCallback((nodeId: string, fieldId: string, value: unknown) => {
    setNodes((current) =>
      current.map((node) => {
        if (node.id !== nodeId) return node;
        const data = node.data as StudioNode["data"];
        return {
          ...node,
          data: {
            ...data,
            fields: {
              ...data.fields,
              [fieldId]: value,
            },
          },
        };
      }),
    );
  }, []);

  const setNodeFields = useCallback(
    (nodeId: string, fields: Record<string, unknown>) => {
      setNodes((current) =>
        current.map((node) => {
          if (node.id !== nodeId) return node;
          const data = node.data as StudioNode["data"];
          return {
            ...node,
            data: {
              ...data,
              fields: {
                ...data.fields,
                ...fields,
              },
            },
          };
        }),
      );
    },
    [setNodes],
  );

  const toggleNodeCollapsed = useCallback(
    (nodeId: string) => {
      setNodes((current) =>
        current.map((node) => {
          if (node.id !== nodeId) return node;
          const data = node.data as StudioNode["data"];
          return {
            ...node,
            data: {
              ...data,
              collapsed: !data.collapsed,
            },
          };
        }),
      );
    },
    [setNodes],
  );

  const startNodeRename = useCallback(
    (nodeId: string) => {
      const node = nodes.find((item) => item.id === nodeId);
      if (!node) return;
      const data = node.data as StudioNode["data"];
      setNodeRenameDraft(data.customTitle?.trim() || data.definition.title);
      setRenamingNodeId(nodeId);
      setNodeContextMenu(null);
    },
    [nodes],
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
            customTitle: trimmedTitle && trimmedTitle !== data.definition.title ? trimmedTitle : null,
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

  const { setGraphNodeColor, setGraphNodeExecutionMode, setGraphNodeCachedOutput, toggleGraphNodeExecutionMode, clearGraphNodes } = useGraphNodeOperations({
    nodes,
    setNodes,
    setEdges,
    appendConsole,
    closeContextMenu: () => setNodeContextMenu(null),
  });
  const { createGroupFromSelection, renameGroup, setGroupColor, deleteGroup, setGroupExecutionMode } = useGraphGroups({
    groups,
    nodes,
    setGroups,
    setNodes,
    appendConsole,
  });
  const { runHistory, selectedHistoryRunId, selectedRunArtifacts, refreshRunHistory, inspectRunArtifacts } = useGraphRunHistory({
    workflowId,
    appendConsole,
  });
  const handleNodeImageDrop = useCallback(
    async (nodeId: string, file: File) => {
      try {
        const reference = await importImageFile(file);
        setNodeFields(nodeId, { reference_id: reference.reference_id, asset_id: "" });
        appendConsole(`Attached reference ${reference.reference_id}.`);
      } catch (error) {
        appendConsole((error as Error).message);
      }
    },
    [appendConsole, importImageFile, setNodeFields],
  );

  const definitionsByType = useMemo(() => new Map(definitions.map((definition) => [definition.type, definition])), [definitions]);
  const definitionsByCategory = useMemo(
    () =>
      definitions.reduce<Record<string, GraphNodeDefinition[]>>((groups, definition) => {
        const key = definition.category || "Other";
        groups[key] = [...(groups[key] ?? []), definition];
        return groups;
      }, {}),
    [definitions],
  );
  const { activeConnection, manualWireDrag, clearActiveConnection, edgeIsValid, startInputRewire, onConnect, onConnectStart, onConnectEnd, onReconnect, onReconnectEnd } = useGraphConnections({
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
      onOpenImageLibrary: (nodeId) => setImageLibraryNodeId(nodeId),
      onImageDrop: handleNodeImageDrop,
      onInputRewireStart: startInputRewire,
      onToggleCollapsed: toggleNodeCollapsed,
      onOpenPreview: (preview, collection) => {
        const previews = collection?.length ? collection : [preview];
        const index = Math.max(0, previews.findIndex((item) => item.url === preview.url && item.fullUrl === preview.fullUrl));
        setPreviewOverlay({ previews, index });
      },
      onStartRenameNode: startNodeRename,
      onRenameNodeDraftChange: setNodeRenameDraft,
      onCommitRenameNode: commitNodeRename,
      onCancelRenameNode: cancelNodeRename,
    }),
    [cancelNodeRename, commitNodeRename, handleNodeImageDrop, onFieldChange, setNodeFields, startInputRewire, startNodeRename, toggleNodeCollapsed],
  );

  const addDefinitionNode = useCallback(
    (definition: GraphNodeDefinition) => {
      setNodes((current) => [...current, createNode(definition, { x: 120 + current.length * 80, y: 120 + current.length * 60 }, nodeHandlers)]);
    },
    [nodeHandlers, setNodes],
  );

  const addDefinitionNodeFromSearch = useCallback(
    (definition: GraphNodeDefinition) => {
      const searchState = nodeSearch;
      const newNode = createNode(
        definition,
        searchState?.flowPosition ? searchState.flowPosition : { x: 120 + nodes.length * 80, y: 120 + nodes.length * 60 },
        nodeHandlers,
      );
      setNodes((current) => [...current, newNode]);
      if (searchState?.connection?.from === "output" && searchState.connection.nodeId && searchState.connection.handleId) {
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
                className: graphEdgeClassForPortType(searchState.connection?.portType),
                style: graphEdgeStyleForPortType(searchState.connection?.portType),
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
    [clearActiveConnection, nodeHandlers, nodeSearch, nodes.length, setEdges, setNodes],
  );

  const buildStarterWorkflow = useCallback(
    (items: GraphNodeDefinition[]) => {
      const byType = new Map(items.map((definition) => [definition.type, definition]));
      const load = byType.get("media.load_image");
      const prompt = byType.get("prompt.text");
      const model = byType.get("model.kie.nano_banana_pro");
      const save = byType.get("media.save_image");
      if (!load || !prompt || !model || !save) return false;
      const loadNode = createNode(load, { x: 80, y: 240 }, nodeHandlers);
      const promptNode = createNode(prompt, { x: 80, y: -60 }, nodeHandlers);
      promptNode.data.fields.text = "Transform this reference into a cinematic, high-detail editorial image.";
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
      return true;
    },
    [nodeHandlers, setEdges, setNodes],
  );

  const addLoadMediaNode = useCallback(
    (mediaType: "image" | "video" | "audio", fields: Record<string, unknown>, position?: { x: number; y: number }) => {
      const definition = definitionsByType.get(`media.load_${mediaType}`);
      if (!definition) {
        appendConsole(`Load ${mediaType} node is not available.`);
        return;
      }
      setNodes((current) => {
        const nextNode = createNode(definition, position ?? { x: 120 + current.length * 80, y: 120 + current.length * 60 }, nodeHandlers);
        nextNode.data.fields = { ...nextNode.data.fields, ...fields };
        return [...current, nextNode];
      });
    },
    [appendConsole, definitionsByType, nodeHandlers, setNodes],
  );

  const addLoadImageNode = useCallback(
    (fields: Record<string, unknown>, position?: { x: number; y: number }) => addLoadMediaNode("image", fields, position),
    [addLoadMediaNode],
  );

  const hydrateWorkflowPayload = useCallback(
    (workflow: GraphWorkflowPayload, options?: { workflowId?: string | null; workflowName?: string; run?: GraphRun | null }) => {
      const restored = hydrateGraphWorkflowForCanvas({
        workflow,
        definitionsByType,
        handlers: nodeHandlers,
        run: options?.run,
        onMissingDefinition: (nodeType) => appendConsole(`Missing node definition for ${nodeType}.`),
      });
      setWorkflowId(options?.workflowId ?? workflow.workflow_id ?? null);
      setWorkflowName(options?.workflowName || workflow.name || "Untitled workflow");
      setRun(options?.run ?? null);
      setNodes(restored.nodes);
      setEdges(restored.edges);
      setGroups(restored.groups);
      canvasHydrated.current = true;
    },
    [appendConsole, definitionsByType, nodeHandlers, setEdges, setNodes],
  );

  const hydrateLastRun = useCallback(
    async (runId: string) => {
      try {
        const current = await jsonFetch<GraphRun>(`/api/control/media/graph/runs/${runId}`);
        setRun(current);
        applyRunNodesToCanvas(current);
        await refreshImageAssets().catch(() => undefined);
        await refreshAssetsByIds(assetIdsFromGraphRun(current)).catch(() => undefined);
        await refreshReferenceMedia().catch(() => undefined);
        const events = await jsonFetch<{ items: GraphRunEvent[] }>(`/api/control/media/graph/runs/${runId}/events`);
        if (events.items.length) {
          applyRunEventsToCanvas(events.items, current);
          setConsoleLines(formatGraphRunEventsForConsole(events.items, nodes));
        }
      } catch (error) {
        appendConsole(`Last run could not be restored: ${(error as Error).message}`);
      }
    },
    [appendConsole, applyRunEventsToCanvas, applyRunNodesToCanvas, nodes, refreshAssetsByIds, refreshImageAssets, refreshReferenceMedia],
  );

  const hydrateLatestRunForWorkflow = useCallback(
    async (targetWorkflowId: string) => {
      const payload = await jsonFetch<{ items?: GraphRun[] }>("/api/control/media/graph/runs?limit=25");
      const latestRun = payload.items?.find((item) => item.workflow_id === targetWorkflowId);
      if (latestRun?.run_id) {
        await hydrateLastRun(latestRun.run_id);
      }
    },
    [hydrateLastRun],
  );

  const loadWorkflowRecord = useCallback(
    (record: GraphWorkflowRecord) => {
      const workflow = record.workflow_json;
      if (!workflow) {
        appendConsole(`Workflow ${record.workflow_id} has no saved graph data.`);
        return;
      }
      const nextWorkflowName = record.name || workflow.name || "Untitled workflow";
      const savedWorkflow = { ...workflow, workflow_id: record.workflow_id, name: nextWorkflowName };
      const savedCanvas = hydrateGraphWorkflowForCanvas({ workflow: savedWorkflow, definitionsByType, handlers: nodeHandlers });

      openWorkflowTab(
        { workflowId: record.workflow_id, workflowName: nextWorkflowName, workflow: savedWorkflow, runId: null, dirty: false },
        { workflowId, workflowName, workflow: workflowFromCanvas(workflowId, workflowName, nodes, edges), runId: run?.run_id ?? null, consoleLines, dirty: true },
      );
      setWorkflowId(record.workflow_id);
      setWorkflowName(nextWorkflowName);
      setRun(null);
      setNodes(savedCanvas.nodes);
      setEdges(savedCanvas.edges);
      setGroups(savedCanvas.groups);
      canvasHydrated.current = true;
      setSidebarDialog(null);
      appendConsole(`Loaded workflow ${nextWorkflowName}.`);
      void hydrateLatestRunForWorkflow(record.workflow_id).catch((error) => {
        appendConsole(`Latest run preview could not be restored: ${(error as Error).message}`);
      });
    },
    [appendConsole, consoleLines, definitionsByType, edges, hydrateLatestRunForWorkflow, nodeHandlers, nodes, openWorkflowTab, run?.run_id, setEdges, setNodes, workflowFromCanvas, workflowId, workflowName],
  );

  const restoreWorkspaceSnapshot = useCallback(
    (items: GraphNodeDefinition[]) => {
      const raw = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
      if (!raw) return false;
      let snapshot: { workflowId?: string | null; workflowName?: string; workflow?: GraphWorkflowPayload; runId?: string | null; updatedAt?: string | null };
      try {
        snapshot = JSON.parse(raw) as typeof snapshot;
      } catch {
        return false;
      }
      const workflow = snapshot.workflow;
      if (workflow && Array.isArray(workflow.nodes) && workflow.nodes.length === 0) {
        setWorkflowId(snapshot.workflowId ?? workflow.workflow_id ?? null);
        setWorkflowName(snapshot.workflowName || workflow.name || "New workflow");
        setRun(null); setNodes([]); setEdges([]); setGroups([]); canvasHydrated.current = true;
        appendConsole(`Restored ${snapshot.workflowName || workflow.name || "New workflow"} from the last browser session.`);
        return true;
      }
      if (!workflow?.nodes?.length) return false;
      if (!snapshot.workflowId && !workflow.workflow_id && !snapshot.runId && !snapshot.updatedAt) return false;
      const promptNode = workflow.nodes.find((node) => node.type === "prompt.text");
      const modelNode = workflow.nodes.find((node) => node.type === "model.kie.nano_banana_pro");
      const blankStarterSnapshot =
        !snapshot.workflowId &&
        !workflow.workflow_id &&
        !snapshot.runId &&
        promptNode?.fields?.text === "Transform this reference into a cinematic, high-detail editorial image." &&
        (!modelNode?.fields?.aspect_ratio || modelNode.fields.aspect_ratio === "Auto") &&
        (!modelNode?.fields?.resolution || modelNode.fields.resolution === "Auto") &&
        (!modelNode?.fields?.output_format || modelNode.fields.output_format === "Auto");
      if (blankStarterSnapshot) return false;
      const byType = new Map(items.map((definition) => [definition.type, definition]));
      const restored = hydrateGraphWorkflowForCanvas({ workflow, definitionsByType: byType, handlers: nodeHandlers });
      if (!restored.nodes.length) return false;
      setWorkflowId(snapshot.workflowId ?? workflow.workflow_id ?? null);
      setWorkflowName(snapshot.workflowName || workflow.name || "Untitled workflow");
      setNodes(restored.nodes);
      setEdges(restored.edges);
      setGroups(restored.groups);
      canvasHydrated.current = true;
      appendConsole(`Restored ${snapshot.workflowName || workflow.name || "workflow"} from the last browser session.`);
      if (snapshot.runId) {
        void hydrateLastRun(snapshot.runId);
      } else if (snapshot.workflowId ?? workflow.workflow_id) {
        void hydrateLatestRunForWorkflow(String(snapshot.workflowId ?? workflow.workflow_id));
      }
      return true;
    },
    [appendConsole, hydrateLastRun, hydrateLatestRunForWorkflow, nodeHandlers, setEdges, setNodes],
  );

  const restoreLatestRunSnapshot = useCallback(
    async (items: GraphNodeDefinition[]) => {
      const payload = await jsonFetch<{ items?: GraphRun[] }>("/api/control/media/graph/runs?limit=1");
      const latestRun = payload.items?.[0];
      const workflow = latestRun?.workflow_json;
      if (!latestRun || !workflow?.nodes?.length) return false;
      const byType = new Map(items.map((definition) => [definition.type, definition]));
      const restored = hydrateGraphWorkflowForCanvas({ workflow, definitionsByType: byType, handlers: nodeHandlers, run: latestRun });
      if (!restored.nodes.length) return false;
      setWorkflowId(latestRun.workflow_id ?? workflow.workflow_id ?? null);
      setWorkflowName(workflow.name || "Untitled workflow");
      setRun(latestRun);
      setNodes(restored.nodes);
      setEdges(restored.edges);
      setGroups(restored.groups);
      canvasHydrated.current = true;
      await refreshImageAssets().catch(() => undefined);
      await refreshAssetsByIds(assetIdsFromGraphRun(latestRun)).catch(() => undefined);
      const events = await jsonFetch<{ items: GraphRunEvent[] }>(`/api/control/media/graph/runs/${latestRun.run_id}/events`);
      if (events.items.length) {
        applyRunEventsToCanvas(events.items, latestRun);
        setConsoleLines(formatGraphRunEventsForConsole(events.items, restored.nodes));
      }
      appendConsole(`Restored latest graph run ${latestRun.run_id}.`);
      return true;
    },
    [appendConsole, applyRunEventsToCanvas, nodeHandlers, refreshAssetsByIds, refreshImageAssets, setEdges, setNodes],
  );

  useEffect(() => {
    if (definitionsLoadStarted.current) return;
    definitionsLoadStarted.current = true;
    jsonFetch<{ items: GraphNodeDefinition[] }>("/api/control/media/graph/node-definitions")
      .then(async (payload) => {
        setDefinitions(payload.items);
        if (!restoreWorkspaceSnapshot(payload.items)) {
          const restoredLatestRun = await restoreLatestRunSnapshot(payload.items).catch(() => false);
          if (!restoredLatestRun) {
            buildStarterWorkflow(payload.items);
            canvasHydrated.current = true;
          }
        }
      })
      .catch((error) => {
        definitionsLoadStarted.current = false;
        appendConsole(`Failed to load node definitions: ${error.message}`);
      });
  }, [appendConsole, buildStarterWorkflow, restoreLatestRunSnapshot, restoreWorkspaceSnapshot]);

  useEffect(() => {
    refreshWorkflows().catch((error) => appendConsole(`Failed to load workflows: ${error.message}`));
    refreshTemplates().catch((error) => appendConsole(`Failed to load templates: ${error.message}`));
    void refreshCredits();
  }, [appendConsole, refreshCredits, refreshTemplates, refreshWorkflows]);

  useEffect(() => {
    void refreshMediaLibrary();
  }, [refreshMediaLibrary]);

  useEffect(() => {
    if (sidebarDialog !== "runs") return;
    refreshRunHistory().catch((error) => appendConsole(`Failed to load run history: ${(error as Error).message}`));
  }, [appendConsole, refreshRunHistory, sidebarDialog]);

  useEffect(() => {
    const group = groupContextMenu ? groups.find((item) => item.id === groupContextMenu.groupId) : null;
    setGroupTitleDraft(group?.title ?? "");
  }, [groupContextMenu?.groupId, groups]);

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
      openCanvasNodeSearch(Math.floor(window.innerWidth / 2 - 180), Math.floor(window.innerHeight / 2 - 220));
      setSidebarDialog(null);
    },
  });

  useEffect(() => {
    const onOpenImageLibrary = (event: Event) => {
      const detail = (event as CustomEvent<{ nodeId?: string }>).detail;
      if (detail?.nodeId) {
        setImageLibraryNodeId(detail.nodeId);
      }
    };
    const onNodeImageDrop = (event: Event) => {
      const detail = (event as CustomEvent<{ nodeId?: string; file?: File }>).detail;
      if (detail?.nodeId && detail.file) {
        void handleNodeImageDrop(detail.nodeId, detail.file);
      }
    };
    window.addEventListener("graph-studio-open-image-library", onOpenImageLibrary);
    window.addEventListener("graph-studio-node-image-drop", onNodeImageDrop);
    return () => {
      window.removeEventListener("graph-studio-open-image-library", onOpenImageLibrary);
      window.removeEventListener("graph-studio-node-image-drop", onNodeImageDrop);
    };
  }, [handleNodeImageDrop]);

  const { importWorkflowInputRef, exportWorkflow, exportWorkflowBundle, importWorkflowFile } = useGraphWorkflowTransfer({
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

  const startConsoleResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
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
  }, [consoleHeight]);

  const { graphEstimate, pricingByNode, confirmPricingForRun, pricingConfirmation, answerPricingConfirmation } = useGraphPricingEstimate({ workflowId, workflowName, nodes, edges, availableCredits, workflowFromCanvas, appendConsole });

  const { runWorkflow } = useGraphRunLifecycle({
    run, setRun, workflowId, workflowName, nodes, edges, saveWorkflow, workflowFromCanvas, resetNodeRunState, applyValidationErrorsToNodes, applyRunNodesToCanvas, applyRunEventsToCanvas,
    refreshCredits, refreshImageAssets, refreshAssetsByIds, refreshReferenceMedia, setConsoleLines, appendConsole, confirmPricingForRun,
  });

  useEffect(() => {
    if (!canvasHydrated.current || !nodes.length) return;
    const snapshot = {
      workflowId,
      workflowName,
      workflow: workflowFromCanvas(workflowId, workflowName, nodes, edges),
      runId: run?.run_id ?? null,
      updatedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(snapshot));
  }, [edges, nodes, run?.run_id, workflowId, workflowName]);

  const onDrop = useCallback(
    async (event: ReactDragEvent) => {
      event.preventDefault();
      const graphMedia = readGraphMediaDragPayload(event.dataTransfer);
      if (graphMedia) {
        const mediaType = graphMedia.mediaType === "video" || graphMedia.mediaType === "audio" ? graphMedia.mediaType : "image";
        addLoadMediaNode(
          mediaType,
          graphMedia.source === "reference" ? { reference_id: graphMedia.id } : { asset_id: graphMedia.id },
          { x: event.clientX - 260, y: event.clientY - 120 },
        );
        appendConsole(`Added Load ${mediaType} node for ${graphMedia.id}.`);
        return;
      }
      const file = event.dataTransfer.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      try {
        const reference = await importImageFile(file);
        addLoadImageNode({ reference_id: reference.reference_id }, { x: event.clientX - 260, y: event.clientY - 120 });
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
  const groupsForRender = useMemo(() => graphGroupsForCanvas(groups, nodesForRender), [groups, nodesForRender]);

  const attachReferenceToNode = useCallback((nodeId: string, referenceId: string) => {
    setNodeFields(nodeId, { reference_id: referenceId, asset_id: "" }); setImageLibraryNodeId(null); appendConsole(`Attached reference ${referenceId}.`);
  }, [appendConsole, setNodeFields]);

  const attachAssetToNode = useCallback((nodeId: string, assetId: string) => {
    setNodeFields(nodeId, { asset_id: assetId, reference_id: "" }); setImageLibraryNodeId(null); appendConsole(`Attached asset ${assetId}.`);
  }, [appendConsole, setNodeFields]);

  const restoreRunFromHistory = useCallback(
    (historyRun: GraphRun) => {
      const workflow = historyRun.workflow_json;
      if (!workflow?.nodes?.length) {
        appendConsole(`Run ${historyRun.run_id} does not include a restorable workflow snapshot.`);
        return;
      }
      hydrateWorkflowPayload(workflow, { workflowId: historyRun.workflow_id, workflowName: workflow.name, run: historyRun });
      setSidebarDialog(null);
      appendConsole(`Restored graph run ${historyRun.run_id}.`);
    },
    [appendConsole, hydrateWorkflowPayload],
  );

  const snapshotActiveTab = useCallback(
    () => updateActiveTab({ workflowId, workflowName, workflow: workflowFromCanvas(workflowId, workflowName, nodes, edges), runId: run?.run_id ?? null, consoleLines, dirty: true }),
    [consoleLines, edges, nodes, run?.run_id, updateActiveTab, workflowFromCanvas, workflowId, workflowName],
  );

  const switchWorkflowTab = useCallback((tabId: string) => { snapshotActiveTab(); const tab = switchTab(tabId); if (tab?.workflow_json) { hydrateWorkflowPayload(tab.workflow_json, { workflowId: tab.workflow_id ?? null, workflowName: tab.workflow_name }); setConsoleLines(tab.console_lines?.length ? tab.console_lines : ["Graph Studio ready."]); if (tab.run_id) void hydrateLastRun(tab.run_id); } else closeWorkflow(); }, [closeWorkflow, hydrateLastRun, hydrateWorkflowPayload, setConsoleLines, snapshotActiveTab, switchTab]);

  const closeWorkflowTab = useCallback((tabId: string) => {
    const snapshot = { workflowId, workflowName, workflow: workflowFromCanvas(workflowId, workflowName, nodes, edges), runId: run?.run_id ?? null, consoleLines, dirty: true };
    const result = closeTab(tabId, snapshot);
    if (result.closedActive && result.nextActiveTab.workflow_json) hydrateWorkflowPayload(result.nextActiveTab.workflow_json, { workflowId: result.nextActiveTab.workflow_id ?? null, workflowName: result.nextActiveTab.workflow_name });
    else if (result.closedActive) closeWorkflow();
  }, [closeTab, closeWorkflow, consoleLines, edges, hydrateWorkflowPayload, nodes, run?.run_id, workflowFromCanvas, workflowId, workflowName]);

  const openNewWorkflowTab = useCallback(() => { snapshotActiveTab(); openBlankTab(); closeWorkflow(); }, [closeWorkflow, openBlankTab, snapshotActiveTab]);

  const closeActiveWorkflow = useCallback(() => { const workflow = blankGraphWorkflowPayload(); updateActiveTab({ workflowId: null, workflowName: workflow.name, workflow, runId: null, consoleLines: ["Graph Studio ready."], dirty: false }); closeWorkflow(); window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify({ workflowId: null, workflowName: workflow.name, workflow, runId: null, updatedAt: new Date().toISOString() })); }, [closeWorkflow, updateActiveTab]);

  return (
    <div className="graph-studio-shell" onDrop={onDrop} onDragOver={(event) => event.preventDefault()}>
      <GraphLeftRail
        sidebarDialog={sidebarDialog}
        showMiniMap={showMiniMap}
        onToggleDialog={(dialog) => setSidebarDialog((current) => (current === dialog ? null : dialog))}
        onToggleMiniMap={() => setShowMiniMap((current) => !current)}
      />
      <main className={`graph-main ${consoleOpen ? "" : "graph-main-console-collapsed"}`} style={consoleOpen ? { gridTemplateRows: `auto minmax(0, 1fr) 6px ${consoleHeight}px` } : undefined}>
        <GraphToolbar
          workflowName={workflowName}
          tabs={tabs}
          activeTabId={activeTabId}
          workflowMenuOpen={workflowMenuOpen}
          renameDialogOpen={renameDialogOpen}
          renameDraft={renameDraft}
          run={run}
          creditText={availableCredits == null ? "Credits unavailable" : `${formatCreditsAmount(availableCredits)} credits`}
          creditsUnavailable={creditsUnavailable}
          graphPricing={graphEstimate}
          onToggleWorkflowMenu={() => setWorkflowMenuOpen((current) => !current)}
          onSwitchTab={switchWorkflowTab}
          onNewTab={openNewWorkflowTab}
          onCloseTab={closeWorkflowTab}
          onSave={() => {
            void saveWorkflow().then((savedWorkflowId) => {
              updateActiveTab({ workflowId: savedWorkflowId, workflowName, workflow: workflowFromCanvas(savedWorkflowId, workflowName, nodes, edges), runId: run?.run_id ?? null, consoleLines, dirty: false });
              setWorkflowMenuOpen(false);
            });
          }}
          onSaveAs={() => { void saveWorkflowAs().then((savedWorkflowId) => updateActiveTab({ workflowId: savedWorkflowId, workflowName: `${workflowName || "Workflow"} Copy`, workflow: workflowFromCanvas(savedWorkflowId, `${workflowName || "Workflow"} Copy`, nodes, edges), runId: run?.run_id ?? null, consoleLines, dirty: false })); }}
          onExportWorkflow={exportWorkflow}
          onExportBundle={() => { void exportWorkflowBundle(); }}
          onOpenRename={() => openRenameWorkflow(setRenameDraft)}
          onCloseWorkflow={closeActiveWorkflow}
          onRenameDraftChange={setRenameDraft}
          onCommitRename={() => {
            const nextName = renameDraft.trim();
            void commitRenameWorkflow().then((savedWorkflowId) => {
              if (nextName) updateActiveTab({ workflowId: savedWorkflowId ?? workflowId, workflowName: nextName, workflow: workflowFromCanvas(savedWorkflowId ?? workflowId, nextName, nodes, edges), runId: run?.run_id ?? null, consoleLines, dirty: false });
            });
          }}
          onCancelRename={() => setRenameDialogOpen(false)}
          onRun={runWorkflow}
        />
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
        <GraphConsole open={consoleOpen} lines={consoleLines} onResizeStart={startConsoleResize} />
      </main>
      {manualWireDrag ? (
        <svg className="graph-wire-drag-overlay" aria-hidden="true" width="100vw" height="100vh">
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
        onNavigate={(index) => setPreviewOverlay((current) => (current ? { ...current, index } : current))}
      />
      <GraphPricingConfirmation state={pricingConfirmation} availableCredits={availableCredits} onAnswer={answerPricingConfirmation} />
      <GraphStudioDialogs
        sidebarDialog={sidebarDialog}
        definitions={definitions}
        definitionsByCategory={definitionsByCategory}
        workflows={workflows}
        templates={templates}
        references={references}
        assets={assets}
        workflowId={workflowId} runHistory={runHistory} selectedHistoryRunId={selectedHistoryRunId} selectedRunArtifacts={selectedRunArtifacts}
        nodeSearch={nodeSearch}
        nodeContextMenu={nodeContextMenu}
        groupContextMenu={groupContextMenu}
        groups={groups}
        nodes={nodes}
        groupTitleDraft={groupTitleDraft}
        imageLibraryNodeId={imageLibraryNodeId}
        onCloseSidebar={() => setSidebarDialog(null)}
        onLoadStarterTemplate={() => {
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
          instantiateTemplate(template.template_id).then(loadWorkflowRecord).catch((error) => appendConsole(`Instantiate template failed: ${(error as Error).message}`));
        }}
        onDeleteWorkflow={(workflow) => {
          void deleteWorkflowRecord(workflow).catch((error) => appendConsole(`Delete workflow failed: ${(error as Error).message}`));
        }}
        onDeleteTemplate={(template) => {
          void deleteTemplate(template.template_id).catch((error) => appendConsole(`Delete template failed: ${(error as Error).message}`));
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
          refreshRunHistory().catch((error) => appendConsole(`Failed to load run history: ${(error as Error).message}`));
        }}
        onInspectRun={(runId) => {
          inspectRunArtifacts(runId).catch((error) => appendConsole(`Failed to inspect artifacts: ${(error as Error).message}`));
        }}
        onRestoreRun={restoreRunFromHistory}
        onPinArtifact={(artifact) => setGraphNodeCachedOutput(artifact.node_id, artifact.run_id, { [artifact.output_port]: [artifact.artifact_id] })}
        onNodeSearchQueryChange={(query) => setNodeSearch((current) => (current ? { ...current, query } : current))}
        onNodeSearchSelect={addDefinitionNodeFromSearch}
        onNodeSearchClose={() => setNodeSearch(null)}
        onSetNodeExecutionMode={setGraphNodeExecutionMode}
        onSetNodeColor={setGraphNodeColor}
        onClearNodes={clearGraphNodes}
        onCreateGroup={() => {
          createGroupFromSelection(); setNodeContextMenu(null);
        }}
        onRenameNode={startNodeRename}
        onGroupTitleDraftChange={setGroupTitleDraft}
        onRenameGroup={renameGroup}
        onSetGroupColor={setGroupColor}
        onSetGroupExecutionMode={setGroupExecutionMode}
        onDeleteGroup={deleteGroup}
        onCloseGroupContext={() => setGroupContextMenu(null)}
        onCloseImageLibrary={() => setImageLibraryNodeId(null)}
        onAttachReference={attachReferenceToNode}
        onAttachAsset={attachAssetToNode}
      />
    </div>
  );
}
