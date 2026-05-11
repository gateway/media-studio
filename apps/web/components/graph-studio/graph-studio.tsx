"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  Background,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  addEdge,
  reconnectEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
} from "@xyflow/react";
import { Blocks, Images, Map as MapIcon, Play, Search, Workflow, X } from "lucide-react";

import type { MediaAsset, MediaReference } from "@/lib/types";
import { GraphNode } from "./graph-node";
import type { GraphMediaPreview, GraphNodeData, GraphNodeDefinition, GraphRun, GraphRunEvent, GraphWorkflowPayload, GraphWorkflowRecord, StudioEdge, StudioNode } from "./types";

const nodeTypes = { graphNode: GraphNode };
type GraphNodeHandlers = Pick<GraphNodeData, "onFieldChange" | "onSetFields" | "onOpenImageLibrary" | "onImageDrop">;
type ActiveConnection = NonNullable<GraphNodeData["activeConnection"]>;
type ConnectMenuState = {
  x: number;
  y: number;
  connection: ActiveConnection & {
    nodeId: string | null;
    handleId: string | null;
  };
};
type SidebarDialog = "workflows" | "nodes" | "images";
type PendingInputRewire = {
  source: string;
  sourceHandle: string | null;
  oldTarget: string;
  oldTargetHandle: string | null;
  portType: string;
};

function defaultFields(definition: GraphNodeDefinition) {
  const fields: Record<string, unknown> = {};
  definition.fields.forEach((field) => {
    if (field.default !== undefined && field.default !== null) {
      fields[field.id] = field.default;
    }
  });
  return fields;
}

function createNode(definition: GraphNodeDefinition, position: { x: number; y: number }, handlers: GraphNodeHandlers): StudioNode {
  const defaultSize = (definition.ui?.default_size ?? {}) as { width?: number; height?: number };
  return {
    id: `${definition.type}-${crypto.randomUUID().slice(0, 8)}`,
    type: "graphNode",
    position,
    style: {
      width: defaultSize.width ?? 340,
      minHeight: defaultSize.height ?? undefined,
    },
    data: {
      definition,
      fields: defaultFields(definition),
      status: "idle",
      progress: null,
      ...handlers,
    },
  };
}

function workflowFromCanvas(workflowId: string | null, name: string, nodes: Node[], edges: Edge[]): GraphWorkflowPayload {
  return {
    schema_version: 1,
    workflow_id: workflowId,
    name,
    nodes: nodes.map((node) => ({
      id: node.id,
      type: String((node.data as StudioNode["data"]).definition.type),
      position: { x: node.position.x, y: node.position.y },
      fields: { ...(node.data as StudioNode["data"]).fields },
      metadata: {},
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      source_port: String(edge.sourceHandle ?? ""),
      target: edge.target,
      target_port: String(edge.targetHandle ?? ""),
    })),
    metadata: { created_by: "graph-studio" },
  };
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (!response.ok) {
    let message = `Request failed with ${response.status}`;
    try {
      const payload = await response.json();
      message = payload.detail ?? payload.error ?? message;
    } catch {
      // Keep generic message.
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

function isTextEntryTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable || tagName === "input" || tagName === "textarea" || tagName === "select";
}

function previewFromReference(reference: MediaReference | undefined): GraphMediaPreview | null {
  if (!reference) return null;
  const url = reference.thumb_url ?? reference.poster_url ?? reference.stored_url;
  if (!url) return null;
  return {
    mediaType: reference.kind === "video" ? "video" : "image",
    url,
    label: reference.original_filename ?? reference.reference_id,
  };
}

function previewFromAsset(asset: MediaAsset | undefined): GraphMediaPreview | null {
  if (!asset) return null;
  const url = asset.hero_thumb_url ?? asset.hero_poster_url ?? asset.hero_web_url ?? asset.hero_original_url;
  if (!url) return null;
  return {
    mediaType: asset.generation_kind === "video" ? "video" : "image",
    url,
    label: asset.prompt_summary ?? String(asset.asset_id),
  };
}

function firstOutputRef(snapshot: Record<string, unknown> | undefined): { asset_id?: string; reference_id?: string } | null {
  if (!snapshot) return null;
  for (const port of ["image", "asset", "video"]) {
    const refs = snapshot[port];
    if (Array.isArray(refs) && refs[0] && typeof refs[0] === "object") {
      return refs[0] as { asset_id?: string; reference_id?: string };
    }
  }
  return null;
}

function graphMediaDragPayload(payload: { source: "reference" | "asset"; id: string; mediaType?: string | null }) {
  return JSON.stringify(payload);
}

function edgeClassForPortType(portType: string | null | undefined) {
  return portType ? `graph-edge graph-edge-${portType}` : "graph-edge";
}

function edgeStyleForPortType(portType: string | null | undefined) {
  const colors: Record<string, string> = {
    image: "#d1ff47",
    video: "#61dafb",
    text: "#f6d8a8",
    job: "#c3a6ff",
    asset: "#ffb5a6",
  };
  return { stroke: colors[portType ?? ""] ?? "#d1ff47", strokeWidth: 2 };
}

function readGraphMediaDragPayload(dataTransfer: DataTransfer): { source: "reference" | "asset"; id: string; mediaType?: string | null } | null {
  const raw = dataTransfer.getData("application/x-media-studio-graph-media");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { source?: unknown; id?: unknown; mediaType?: unknown };
    if ((parsed.source === "reference" || parsed.source === "asset") && typeof parsed.id === "string") {
      return {
        source: parsed.source,
        id: parsed.id,
        mediaType: typeof parsed.mediaType === "string" ? parsed.mediaType : null,
      };
    }
  } catch {
    return null;
  }
  return null;
}

export function GraphStudio() {
  const [definitions, setDefinitions] = useState<GraphNodeDefinition[]>([]);
  const [search, setSearch] = useState("");
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [workflowName, setWorkflowName] = useState("Nano Image Pipeline");
  const [consoleLines, setConsoleLines] = useState<string[]>(["Graph Studio ready."]);
  const [run, setRun] = useState<GraphRun | null>(null);
  const [references, setReferences] = useState<MediaReference[]>([]);
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [workflows, setWorkflows] = useState<GraphWorkflowRecord[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [imageLibraryNodeId, setImageLibraryNodeId] = useState<string | null>(null);
  const [sidebarDialog, setSidebarDialog] = useState<SidebarDialog | null>(null);
  const [consoleOpen, setConsoleOpen] = useState(true);
  const [consoleHeight, setConsoleHeight] = useState(170);
  const [showMiniMap, setShowMiniMap] = useState(false);
  const [workflowMenuOpen, setWorkflowMenuOpen] = useState(false);
  const [activeConnection, setActiveConnection] = useState<ActiveConnection | null>(null);
  const [activeConnectionStart, setActiveConnectionStart] = useState<{ nodeId: string | null; handleId: string | null } | null>(null);
  const [connectMenu, setConnectMenu] = useState<ConnectMenuState | null>(null);
  const pendingInputRewire = useRef<PendingInputRewire | null>(null);

  const appendConsole = useCallback((line: string) => {
    setConsoleLines((current) => [line, ...current].slice(0, 80));
  }, []);

  const refreshWorkflows = useCallback(async () => {
    const payload = await jsonFetch<{ items?: GraphWorkflowRecord[] }>("/api/control/media/graph/workflows");
    setWorkflows(payload.items ?? []);
  }, []);

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

  const [nodes, setNodes, onNodesChange] = useNodesState<StudioNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<StudioEdge>([]);

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

  const importImageFile = useCallback(
    async (file: File) => {
      const data = new FormData();
      data.append("file", file);
      const response = await fetch("/api/control/reference-media/import", { method: "POST", body: data });
      if (!response.ok) {
        throw new Error("Image import failed.");
      }
      const payload = (await response.json()) as { item?: MediaReference };
      if (!payload.item?.reference_id) {
        throw new Error("Image import did not return a reference.");
      }
      setReferences((current) => [payload.item as MediaReference, ...current.filter((item) => item.reference_id !== payload.item?.reference_id)].slice(0, 8));
      return payload.item;
    },
    [],
  );

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

  const nodeHandlers = useMemo<GraphNodeHandlers>(
    () => ({
      onFieldChange,
      onSetFields: setNodeFields,
      onOpenImageLibrary: (nodeId) => setImageLibraryNodeId(nodeId),
      onImageDrop: handleNodeImageDrop,
    }),
    [handleNodeImageDrop, onFieldChange, setNodeFields],
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
  const filteredDefinitions = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return definitions;
    return definitions.filter((definition) => {
      const haystack = [definition.title, definition.type, definition.category, ...(definition.search_aliases ?? [])].join(" ").toLowerCase();
      return haystack.includes(needle);
    });
  }, [definitions, search]);

  const edgeIsValid = useCallback(
    (connection: Connection | Edge) => {
      const source = nodes.find((node) => node.id === connection.source);
      const target = nodes.find((node) => node.id === connection.target);
      if (!source || !target || !connection.sourceHandle || !connection.targetHandle) return false;
      const targetAlreadyConnected = edges.some(
        (edge) =>
          edge.target === connection.target &&
          edge.targetHandle === connection.targetHandle &&
          edge.id !== ("id" in connection ? connection.id : undefined),
      );
      if (targetAlreadyConnected) return false;
      const sourceDef = (source.data as StudioNode["data"]).definition;
      const targetDef = (target.data as StudioNode["data"]).definition;
      const sourcePort = sourceDef.ports.outputs.find((port) => port.id === connection.sourceHandle);
      const targetPort = targetDef.ports.inputs.find((port) => port.id === connection.targetHandle);
      if (!sourcePort || !targetPort) return false;
      return (targetPort.accepts?.length ? targetPort.accepts : [targetPort.type]).includes(sourcePort.type);
    },
    [edges, nodes],
  );

  const portTypeForHandle = useCallback(
    (nodeId: string | null | undefined, handleId: string | null | undefined, handleKind: "source" | "target") => {
      if (!nodeId || !handleId) return null;
      const node = nodes.find((item) => item.id === nodeId);
      if (!node) return null;
      const definition = (node.data as StudioNode["data"]).definition;
      const ports = handleKind === "source" ? definition.ports.outputs : definition.ports.inputs;
      return ports.find((port) => port.id === handleId)?.type ?? null;
    },
    [nodes],
  );

  const compatibleDefinitionsForConnection = useCallback(
    (connection: ActiveConnection) =>
      definitions.filter((definition) => {
        const ports = connection.from === "output" ? definition.ports.inputs : definition.ports.outputs;
        return ports.some((port) => {
          const accepts = port.accepts?.length ? port.accepts : [port.type];
          return connection.from === "output" ? accepts.includes(connection.portType) : port.type === connection.portType;
        });
      }),
    [definitions],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      const pendingRewire = pendingInputRewire.current;
      const normalizedConnection = pendingRewire
        ? {
            ...connection,
            source: pendingRewire.source,
            sourceHandle: pendingRewire.sourceHandle,
            target:
              connection.target === pendingRewire.oldTarget && connection.targetHandle === pendingRewire.oldTargetHandle
                ? connection.source
                : connection.target,
            targetHandle:
              connection.target === pendingRewire.oldTarget && connection.targetHandle === pendingRewire.oldTargetHandle
                ? connection.sourceHandle
                : connection.targetHandle,
          }
        : connection;
      if (!edgeIsValid(normalizedConnection)) {
        appendConsole("Connection rejected: incompatible ports.");
        pendingInputRewire.current = null;
        return;
      }
      const sourcePortType = portTypeForHandle(normalizedConnection.source, normalizedConnection.sourceHandle, "source");
      setEdges((current) =>
        addEdge(
          {
            ...normalizedConnection,
            id: `edge-${normalizedConnection.source}-${normalizedConnection.sourceHandle}-${normalizedConnection.target}-${normalizedConnection.targetHandle}`,
            animated: true,
            className: edgeClassForPortType(sourcePortType),
            style: edgeStyleForPortType(sourcePortType),
            reconnectable: true,
          },
          current,
        ),
      );
      pendingInputRewire.current = null;
    },
    [appendConsole, edgeIsValid, portTypeForHandle, setEdges],
  );

  const onConnectStart = useCallback(
    (_event: MouseEvent | TouchEvent, params: { nodeId: string | null; handleId: string | null; handleType: "source" | "target" | null }) => {
      if (params.handleType === "target") {
        const existingEdge = edges.find((edge) => edge.target === params.nodeId && edge.targetHandle === params.handleId);
        if (!existingEdge) {
          pendingInputRewire.current = null;
          setActiveConnection(null);
          setActiveConnectionStart(null);
          return;
        }
        const portType = portTypeForHandle(existingEdge.source, existingEdge.sourceHandle, "source");
        if (!portType) return;
        pendingInputRewire.current = {
          source: existingEdge.source,
          sourceHandle: existingEdge.sourceHandle ?? null,
          oldTarget: existingEdge.target,
          oldTargetHandle: existingEdge.targetHandle ?? null,
          portType,
        };
        setEdges((current) => current.filter((edge) => edge.id !== existingEdge.id));
        setActiveConnection({ from: "output", portType });
        setActiveConnectionStart({ nodeId: existingEdge.source, handleId: existingEdge.sourceHandle ?? null });
        setConnectMenu(null);
        return;
      }
      const portType = portTypeForHandle(params.nodeId, params.handleId, "source");
      if (!portType) return;
      setActiveConnection({ from: "output", portType });
      setActiveConnectionStart({ nodeId: params.nodeId, handleId: params.handleId });
      setConnectMenu(null);
    },
    [edges, portTypeForHandle, setEdges],
  );

  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, connectionState: { isValid: boolean | null; toHandle?: unknown }) => {
      if (pendingInputRewire.current && !connectionState.isValid) {
        pendingInputRewire.current = null;
        setActiveConnection(null);
        setActiveConnectionStart(null);
        appendConsole("Connection removed.");
        return;
      }
      if (connectionState.isValid || connectionState.toHandle || !activeConnection) {
        pendingInputRewire.current = null;
        setActiveConnection(null);
        setActiveConnectionStart(null);
        return;
      }
      const mouseEvent = "clientX" in event ? event : null;
      if (!mouseEvent) {
        setActiveConnection(null);
        setActiveConnectionStart(null);
        return;
      }
      setConnectMenu({
        x: mouseEvent.clientX,
        y: mouseEvent.clientY,
        connection: {
          ...activeConnection,
          nodeId: activeConnectionStart?.nodeId ?? null,
          handleId: activeConnectionStart?.handleId ?? null,
        },
      });
      setActiveConnection(null);
      setActiveConnectionStart(null);
    },
    [activeConnection, activeConnectionStart, appendConsole],
  );

  const onReconnect = useCallback(
    (oldEdge: StudioEdge, newConnection: Connection) => {
      if (!edgeIsValid({ ...newConnection, id: oldEdge.id } as StudioEdge)) {
        return;
      }
      const sourcePortType = portTypeForHandle(newConnection.source, newConnection.sourceHandle, "source");
      setEdges((current) =>
        reconnectEdge(oldEdge, newConnection, current).map((edge) =>
          edge.id === oldEdge.id
            ? {
                ...edge,
                className: edgeClassForPortType(sourcePortType),
                style: edgeStyleForPortType(sourcePortType),
                reconnectable: true,
              }
            : edge,
        ),
      );
    },
    [edgeIsValid, portTypeForHandle, setEdges],
  );

  const onReconnectEnd = useCallback(
    (_event: MouseEvent | TouchEvent, edge: StudioEdge, _handleType: string, connectionState: { isValid: boolean | null; toHandle?: unknown }) => {
      if (connectionState.isValid || connectionState.toHandle) return;
      setEdges((current) => current.filter((item) => item.id !== edge.id));
      appendConsole("Connection removed.");
    },
    [appendConsole, setEdges],
  );

  const addDefinitionNode = useCallback(
    (definition: GraphNodeDefinition) => {
      setNodes((current) => [...current, createNode(definition, { x: 120 + current.length * 80, y: 120 + current.length * 60 }, nodeHandlers)]);
    },
    [nodeHandlers, setNodes],
  );

  const addDefinitionNodeFromConnectMenu = useCallback(
    (definition: GraphNodeDefinition) => {
      if (!connectMenu) return;
      const newNode = createNode(definition, { x: connectMenu.x - 360, y: connectMenu.y - 90 }, nodeHandlers);
      setNodes((current) => [...current, newNode]);
      if (connectMenu.connection.from === "output" && connectMenu.connection.nodeId && connectMenu.connection.handleId) {
        const targetPort = definition.ports.inputs.find((port) => {
          const accepts = port.accepts?.length ? port.accepts : [port.type];
          return accepts.includes(connectMenu.connection.portType);
        });
        if (targetPort) {
          setEdges((current) =>
            addEdge(
              {
                id: `edge-${connectMenu.connection.nodeId}-${connectMenu.connection.handleId}-${newNode.id}-${targetPort.id}`,
                source: connectMenu.connection.nodeId ?? "",
                sourceHandle: connectMenu.connection.handleId,
                target: newNode.id,
                targetHandle: targetPort.id,
                animated: true,
                className: edgeClassForPortType(connectMenu.connection.portType),
                style: edgeStyleForPortType(connectMenu.connection.portType),
                reconnectable: true,
              },
              current,
            ),
          );
        }
      }
      setConnectMenu(null);
      setActiveConnection(null);
    },
    [connectMenu, nodeHandlers, setEdges, setNodes],
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
      setEdges([
        {
          id: "edge-prompt-model",
          source: promptNode.id,
          sourceHandle: "text",
          target: modelNode.id,
          targetHandle: "prompt",
          animated: true,
          className: edgeClassForPortType("text"),
          style: edgeStyleForPortType("text"),
          reconnectable: true,
        },
        {
          id: "edge-load-model",
          source: loadNode.id,
          sourceHandle: "image",
          target: modelNode.id,
          targetHandle: "image_refs",
          animated: true,
          className: edgeClassForPortType("image"),
          style: edgeStyleForPortType("image"),
          reconnectable: true,
        },
        {
          id: "edge-model-save",
          source: modelNode.id,
          sourceHandle: "image",
          target: saveNode.id,
          targetHandle: "image",
          animated: true,
          className: edgeClassForPortType("image"),
          style: edgeStyleForPortType("image"),
          reconnectable: true,
        },
      ]);
      return true;
    },
    [nodeHandlers, setEdges, setNodes],
  );

  const addLoadImageNode = useCallback(
    (fields: Record<string, unknown>, position?: { x: number; y: number }) => {
      const definition = definitionsByType.get("media.load_image");
      if (!definition) {
        appendConsole("Load Image node is not available.");
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

  const loadWorkflowRecord = useCallback(
    (record: GraphWorkflowRecord) => {
      const workflow = record.workflow_json;
      if (!workflow) {
        appendConsole(`Workflow ${record.workflow_id} has no saved graph data.`);
        return;
      }

      const savedNodes = workflow.nodes
        .map((savedNode) => {
          const definition = definitionsByType.get(savedNode.type);
          if (!definition) return null;
          const node = createNode(definition, savedNode.position, nodeHandlers);
          return {
            ...node,
            id: savedNode.id,
            data: {
              ...node.data,
              fields: {
                ...node.data.fields,
                ...savedNode.fields,
              },
            },
          };
        })
        .filter((node): node is StudioNode => Boolean(node));

      const savedNodeById = new Map(workflow.nodes.map((node) => [node.id, node]));
      const savedEdges = workflow.edges.map((edge) => {
        const sourceNode = savedNodeById.get(edge.source);
        const sourceType = sourceNode ? definitionsByType.get(sourceNode.type)?.ports.outputs.find((port) => port.id === edge.source_port)?.type : null;
        return {
          id: edge.id,
          source: edge.source,
          sourceHandle: edge.source_port,
          target: edge.target,
          targetHandle: edge.target_port,
          animated: true,
          className: edgeClassForPortType(sourceType),
          style: edgeStyleForPortType(sourceType),
          reconnectable: true,
        };
      });

      setWorkflowId(record.workflow_id);
      setWorkflowName(record.name || workflow.name || "Untitled workflow");
      setRun(null);
      setNodes(savedNodes);
      setEdges(savedEdges);
      setSidebarDialog(null);
      appendConsole(`Loaded workflow ${record.name || record.workflow_id}.`);
    },
    [appendConsole, definitionsByType, nodeHandlers, setEdges, setNodes],
  );

  useEffect(() => {
    jsonFetch<{ items: GraphNodeDefinition[] }>("/api/control/media/graph/node-definitions")
      .then((payload) => {
        setDefinitions(payload.items);
        buildStarterWorkflow(payload.items);
      })
      .catch((error) => appendConsole(`Failed to load node definitions: ${error.message}`));
  }, [appendConsole, buildStarterWorkflow]);

  useEffect(() => {
    refreshWorkflows().catch((error) => appendConsole(`Failed to load workflows: ${error.message}`));
  }, [appendConsole, refreshWorkflows]);

  useEffect(() => {
    Promise.all([
      jsonFetch<{ items?: MediaReference[] }>("/api/control/reference-media?kind=image&limit=8").catch(() => ({ items: [] })),
      jsonFetch<{ assets?: MediaAsset[] }>("/api/control/media-assets?generation_kind=image&limit=8").catch(() => ({ assets: [] })),
    ]).then(([referencePayload, assetPayload]) => {
      setReferences(referencePayload.items ?? []);
      setAssets(assetPayload.assets ?? []);
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSearchOpen(false);
        setContextMenu(null);
        setImageLibraryNodeId(null);
        setSidebarDialog(null);
        setWorkflowMenuOpen(false);
        setConnectMenu(null);
        return;
      }
      if (imageLibraryNodeId) return;
      if (isTextEntryTarget(event.target)) return;
      if (event.key.toLowerCase() === "c") {
        event.preventDefault();
        setConsoleOpen((current) => !current);
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        setSearchOpen(true);
        setContextMenu(null);
        setSidebarDialog(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [imageLibraryNodeId]);

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

  const saveWorkflow = useCallback(async (nextName = workflowName, nextWorkflowId = workflowId) => {
    const payload = workflowFromCanvas(nextWorkflowId, nextName, nodes, edges);
    const record = await jsonFetch<{ workflow_id: string }>(
      nextWorkflowId ? `/api/control/media/graph/workflows/${nextWorkflowId}` : "/api/control/media/graph/workflows",
      {
        method: nextWorkflowId ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      },
    );
    setWorkflowId(record.workflow_id);
    setWorkflowName(nextName);
    refreshWorkflows().catch(() => undefined);
    appendConsole(`Saved workflow ${record.workflow_id}.`);
    return record.workflow_id;
  }, [appendConsole, edges, nodes, refreshWorkflows, workflowId, workflowName]);

  const saveWorkflowAs = useCallback(async () => {
    const nextName = `${workflowName || "Workflow"} Copy`;
    const payload = workflowFromCanvas(null, nextName, nodes, edges);
    const record = await jsonFetch<{ workflow_id: string }>("/api/control/media/graph/workflows", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    setWorkflowName(nextName);
    setWorkflowId(record.workflow_id);
    refreshWorkflows().catch(() => undefined);
    appendConsole(`Saved workflow ${record.workflow_id}.`);
    setWorkflowMenuOpen(false);
  }, [appendConsole, edges, nodes, refreshWorkflows, workflowName]);

  const renameWorkflow = useCallback(() => {
    const nextName = window.prompt("Rename workflow", workflowName);
    if (!nextName?.trim()) return;
    const trimmedName = nextName.trim();
    if (workflowId) {
      void saveWorkflow(trimmedName, workflowId).then(() => appendConsole(`Renamed workflow to ${trimmedName}.`));
    } else {
      setWorkflowName(trimmedName);
      appendConsole(`Renamed workflow to ${trimmedName}.`);
    }
    setWorkflowMenuOpen(false);
  }, [appendConsole, saveWorkflow, workflowId, workflowName]);

  const closeWorkflow = useCallback(() => {
    setWorkflowId(null);
    setWorkflowName("New workflow");
    setRun(null);
    setNodes([]);
    setEdges([]);
    setConsoleLines(["Graph Studio ready."]);
    setWorkflowMenuOpen(false);
  }, [setEdges, setNodes]);

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

  const validateWorkflow = useCallback(async () => {
    const id = workflowId ?? (await saveWorkflow());
    const result = await jsonFetch<{ valid: boolean; errors: Array<{ message: string }>; warnings: Array<{ message: string }> }>(
      `/api/control/media/graph/workflows/${id}/validate`,
      {
        method: "POST",
        body: JSON.stringify(workflowFromCanvas(id, workflowName, nodes, edges)),
      },
    );
    appendConsole(result.valid ? `Validation passed with ${result.warnings.length} warning(s).` : `Validation failed: ${result.errors.map((item) => item.message).join("; ")}`);
  }, [appendConsole, edges, nodes, saveWorkflow, workflowId, workflowName]);

  const runWorkflow = useCallback(async () => {
    const id = workflowId ?? (await saveWorkflow());
    const created = await jsonFetch<GraphRun>(`/api/control/media/graph/workflows/${id}/runs`, {
      method: "POST",
      body: JSON.stringify({ workflow: workflowFromCanvas(id, workflowName, nodes, edges) }),
    });
    setRun(created);
    appendConsole(`Started graph run ${created.run_id}.`);
  }, [appendConsole, edges, nodes, saveWorkflow, workflowId, workflowName]);

  useEffect(() => {
    if (!run || ["completed", "failed", "cancelled"].includes(run.status)) return;
    const timer = window.setInterval(async () => {
      try {
        const current = await jsonFetch<GraphRun>(`/api/control/media/graph/runs/${run.run_id}`);
        setRun(current);
        if (current.nodes?.some((item) => item.output_snapshot_json && Object.keys(item.output_snapshot_json).length)) {
          jsonFetch<{ assets?: MediaAsset[] }>("/api/control/media-assets?generation_kind=image&limit=20")
            .then((payload) => setAssets(payload.assets ?? []))
            .catch(() => undefined);
        }
        setNodes((existing) =>
          existing.map((node) => {
            const runNode = current.nodes?.find((item) => item.node_id === node.id);
            if (!runNode) return node;
            return {
              ...node,
              data: {
                ...(node.data as StudioNode["data"]),
                status: runNode.status,
                progress: runNode.progress ?? null,
                outputSnapshot: runNode.output_snapshot_json,
              },
            };
          }),
        );
        const events = await jsonFetch<{ items: GraphRunEvent[] }>(`/api/control/media/graph/runs/${run.run_id}/events`);
        setConsoleLines(events.items.slice(-20).reverse().map((event) => `${event.event_type}${event.node_id ? ` (${event.node_id})` : ""}`));
      } catch (error) {
        appendConsole(`Run polling failed: ${(error as Error).message}`);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [appendConsole, run, setNodes]);

  const onDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault();
      const graphMedia = readGraphMediaDragPayload(event.dataTransfer);
      if (graphMedia) {
        if (graphMedia.mediaType && graphMedia.mediaType !== "image") {
          appendConsole(`Dropped ${graphMedia.mediaType} media is waiting for the matching load node.`);
          return;
        }
        addLoadImageNode(
          graphMedia.source === "reference" ? { reference_id: graphMedia.id } : { asset_id: graphMedia.id },
          { x: event.clientX - 260, y: event.clientY - 120 },
        );
        appendConsole(`Added Load Image node for ${graphMedia.id}.`);
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
    [addLoadImageNode, appendConsole, importImageFile],
  );

  const resolveNodePreview = useCallback(
    (data: StudioNode["data"]): GraphMediaPreview | null => {
      if (data.fields.asset_id) {
        return previewFromAsset(assets.find((asset) => String(asset.asset_id) === String(data.fields.asset_id)));
      }
      if (data.fields.reference_id) {
        return previewFromReference(references.find((reference) => reference.reference_id === data.fields.reference_id));
      }
      const outputRef = firstOutputRef(data.outputSnapshot);
      if (outputRef?.asset_id) {
        return previewFromAsset(assets.find((asset) => String(asset.asset_id) === String(outputRef.asset_id)));
      }
      if (outputRef?.reference_id) {
        return previewFromReference(references.find((reference) => reference.reference_id === outputRef.reference_id));
      }
      return null;
    },
    [assets, references],
  );

  const nodesForRender = useMemo<StudioNode[]>(
    () =>
      nodes.map((node) => {
        const data = node.data as StudioNode["data"];
        return {
          ...node,
          data: {
            ...data,
            ...nodeHandlers,
            activeConnection,
            mediaPreview: resolveNodePreview(data),
            connectedInputPorts: edges.filter((edge) => edge.target === node.id).map((edge) => String(edge.targetHandle ?? "")),
          },
        };
      }),
    [activeConnection, edges, nodeHandlers, nodes, resolveNodePreview],
  );

  const attachReferenceToNode = useCallback(
    (nodeId: string, referenceId: string) => {
      setNodeFields(nodeId, { reference_id: referenceId, asset_id: "" });
      setImageLibraryNodeId(null);
      appendConsole(`Attached reference ${referenceId}.`);
    },
    [appendConsole, setNodeFields],
  );

  const attachAssetToNode = useCallback(
    (nodeId: string, assetId: string) => {
      setNodeFields(nodeId, { asset_id: assetId, reference_id: "" });
      setImageLibraryNodeId(null);
      appendConsole(`Attached asset ${assetId}.`);
    },
    [appendConsole, setNodeFields],
  );

  return (
    <div
      className="graph-studio-shell"
      onDrop={onDrop}
      onDragOver={(event) => event.preventDefault()}
    >
      <aside className="graph-sidebar" aria-label="Graph Studio tools">
        <button
          className={`graph-sidebar-icon ${sidebarDialog === "workflows" ? "graph-sidebar-icon-active" : ""}`}
          data-testid="graph-sidebar-workflows-button"
          type="button"
          aria-label="Open workflows"
          title="Workflows"
          onClick={() => setSidebarDialog((current) => (current === "workflows" ? null : "workflows"))}
        >
          <Workflow size={19} />
        </button>
        <button
          className={`graph-sidebar-icon ${sidebarDialog === "nodes" ? "graph-sidebar-icon-active" : ""}`}
          data-testid="graph-sidebar-nodes-button"
          type="button"
          aria-label="Open nodes"
          title="Nodes"
          onClick={() => setSidebarDialog((current) => (current === "nodes" ? null : "nodes"))}
        >
          <Blocks size={19} />
        </button>
        <button
          className={`graph-sidebar-icon ${sidebarDialog === "images" ? "graph-sidebar-icon-active" : ""}`}
          data-testid="graph-sidebar-images-button"
          type="button"
          aria-label="Open images"
          title="Images"
          onClick={() => setSidebarDialog((current) => (current === "images" ? null : "images"))}
        >
          <Images size={19} />
        </button>
      </aside>
      <main className={`graph-main ${consoleOpen ? "" : "graph-main-console-collapsed"}`} style={consoleOpen ? { gridTemplateRows: `auto minmax(0, 1fr) 6px ${consoleHeight}px` } : undefined}>
        <div className="graph-toolbar">
          <div className="graph-workflow-tabs" data-testid="graph-workflow-tabs">
            <button
              className="graph-workflow-tab graph-workflow-tab-active"
              type="button"
              aria-haspopup="menu"
              aria-expanded={workflowMenuOpen}
              onClick={() => setWorkflowMenuOpen((current) => !current)}
            >
              <Workflow size={15} />
              <span>{workflowName || "Untitled workflow"}</span>
            </button>
            {workflowMenuOpen ? (
              <div className="graph-workflow-menu" data-testid="graph-workflow-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    void saveWorkflow().then(() => setWorkflowMenuOpen(false));
                  }}
                >
                  Save
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    void saveWorkflowAs();
                  }}
                >
                  Save As
                </button>
                <button type="button" role="menuitem" onClick={renameWorkflow}>
                  Rename
                </button>
                <button type="button" role="menuitem" onClick={closeWorkflow}>
                  Close
                </button>
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={showMiniMap}
                  onClick={() => {
                    setShowMiniMap((current) => !current);
                    setWorkflowMenuOpen(false);
                  }}
                >
                  <MapIcon size={14} />
                  {showMiniMap ? "Hide Minimap" : "Show Minimap"}
                </button>
              </div>
            ) : null}
          </div>
          <div className="graph-toolbar-actions">
            <button type="button" onClick={validateWorkflow}>Validate</button>
          </div>
          <div className="graph-toolbar-spacer" />
          <div className="graph-run-status" data-testid="graph-run-status">
            {run ? `${run.status} ${run.error ? `- ${run.error}` : ""}` : "No run yet"}
          </div>
          <button className="graph-run-button" type="button" data-testid="graph-run-button" onClick={runWorkflow}>
            <Play size={16} /> Run
          </button>
        </div>
        <div
          className="graph-canvas"
          data-testid="graph-canvas"
          onContextMenu={(event) => {
            event.preventDefault();
            setContextMenu({ x: event.clientX, y: event.clientY });
            setSearchOpen(false);
          }}
        >
          <ReactFlow
            nodes={nodesForRender}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onConnectStart={onConnectStart}
            onConnectEnd={onConnectEnd}
            onReconnect={onReconnect}
            onReconnectEnd={onReconnectEnd}
            onEdgeClick={(_event, edge) => {
              setEdges((current) => current.filter((item) => item.id !== edge.id));
              appendConsole(`Disconnected ${edge.sourceHandle ?? "output"} from ${edge.targetHandle ?? "input"}.`);
            }}
            isValidConnection={edgeIsValid}
            connectionMode={ConnectionMode.Loose}
            defaultEdgeOptions={{ reconnectable: true, interactionWidth: 28 }}
            edgesReconnectable
            reconnectRadius={18}
            connectionLineStyle={activeConnection ? edgeStyleForPortType(activeConnection.portType) : undefined}
            proOptions={{ hideAttribution: true }}
            onPaneClick={() => {
              setContextMenu(null);
              setWorkflowMenuOpen(false);
              setConnectMenu(null);
            }}
            fitView
          >
            <Background />
            {showMiniMap ? <MiniMap pannable zoomable /> : null}
            <Controls />
          </ReactFlow>
        </div>
        {consoleOpen ? (
          <>
            <div className="graph-console-resizer" data-testid="graph-console-resizer" onPointerDown={startConsoleResize} />
            <section className="graph-console" data-testid="graph-console">
              {consoleLines.map((line, index) => (
                <div key={`${line}-${index}`}>{line}</div>
              ))}
            </section>
          </>
        ) : null}
      </main>
      {sidebarDialog ? (
        <div className="graph-library-modal" data-testid={`graph-${sidebarDialog}-modal`} role="dialog" aria-label={sidebarDialog}>
          <div className="graph-modal-header">
            <div>
              <div className="graph-section-title">{sidebarDialog}</div>
              <strong>{sidebarDialog === "workflows" ? "Workflows" : sidebarDialog === "nodes" ? "Nodes" : "Images"}</strong>
            </div>
            <button type="button" aria-label="Close graph dialog" onClick={() => setSidebarDialog(null)}>
              <X size={16} />
            </button>
          </div>
          {sidebarDialog === "workflows" ? (
            <div className="graph-dialog-list">
              <button
                className="graph-dialog-row"
                data-testid="graph-template-nano-image-pipeline"
                type="button"
                onClick={() => {
                  if (buildStarterWorkflow(definitions)) {
                    setWorkflowName("Nano Image Pipeline");
                    setWorkflowId(null);
                    setRun(null);
                    setSidebarDialog(null);
                    appendConsole("Loaded Nano image pipeline template.");
                  }
                }}
              >
                <span className="graph-template-thumb" />
                <span>
                  <strong>Nano image pipeline</strong>
                  <small>Prompt Text -&gt; Nano Banana Pro -&gt; Save Image</small>
                </span>
              </button>
              {workflows.length ? (
                workflows.map((workflow) => (
                  <button className="graph-dialog-row" key={workflow.workflow_id} type="button" onClick={() => loadWorkflowRecord(workflow)}>
                    <span className="graph-dialog-row-icon">
                      <Workflow size={17} />
                    </span>
                    <span>
                      <strong>{workflow.name || "Untitled workflow"}</strong>
                      <small>{workflow.updated_at ? new Date(workflow.updated_at).toLocaleString() : workflow.workflow_id}</small>
                    </span>
                  </button>
                ))
              ) : (
                <div className="graph-sidebar-empty">No saved workflows yet.</div>
              )}
            </div>
          ) : null}
          {sidebarDialog === "nodes" ? (
            <div className="graph-dialog-categories">
              {Object.entries(definitionsByCategory).map(([category, items]) => (
                <section className="graph-dialog-category" key={category}>
                  <div className="graph-section-title">{category}</div>
                  <div className="graph-dialog-list">
                    {items.map((definition) => (
                      <button
                        className="graph-dialog-row"
                        key={definition.type}
                        type="button"
                        onClick={() => {
                          addDefinitionNode(definition);
                          setSidebarDialog(null);
                        }}
                      >
                        <span className="graph-dialog-row-icon">
                          <Blocks size={17} />
                        </span>
                        <span>
                          <strong>{definition.title}</strong>
                          <small>{definition.description ?? definition.type}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
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
                        onClick={() => {
                          addLoadImageNode({ reference_id: reference.reference_id });
                          setSidebarDialog(null);
                        }}
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
                  {assets.length ? (
                    assets.map((asset) => (
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
                        onClick={() => {
                          addLoadImageNode({ asset_id: String(asset.asset_id) });
                          setSidebarDialog(null);
                        }}
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
        </div>
      ) : null}
      {connectMenu ? (
        <div className="graph-context-menu graph-connect-menu" data-testid="graph-connect-menu" style={{ left: connectMenu.x, top: connectMenu.y }}>
          <div className="graph-section-title">Compatible Nodes</div>
          {compatibleDefinitionsForConnection(connectMenu.connection).length ? (
            compatibleDefinitionsForConnection(connectMenu.connection).map((definition) => (
              <button key={definition.type} type="button" onClick={() => addDefinitionNodeFromConnectMenu(definition)}>
                <strong>{definition.title}</strong>
                <span>{definition.category}</span>
              </button>
            ))
          ) : (
            <div className="graph-sidebar-empty">No compatible nodes yet.</div>
          )}
        </div>
      ) : null}
      {contextMenu ? (
        <div className="graph-context-menu" data-testid="graph-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
          <div className="graph-section-title">Add Node</div>
          {definitions.map((definition) => (
            <button
              key={definition.type}
              type="button"
              onClick={() => {
                setNodes((current) => [...current, createNode(definition, { x: contextMenu.x - 360, y: contextMenu.y - 90 }, nodeHandlers)]);
                setContextMenu(null);
              }}
            >
              <strong>{definition.title}</strong>
              <span>{definition.category}</span>
            </button>
          ))}
        </div>
      ) : null}
      {imageLibraryNodeId ? (
        <div className="graph-image-library-modal" data-testid="graph-image-library-modal" role="dialog" aria-label="Image library">
          <div className="graph-modal-header">
            <div>
              <div className="graph-section-title">Image Library</div>
              <strong>Select image for Load Image</strong>
            </div>
            <button type="button" aria-label="Close image library" onClick={() => setImageLibraryNodeId(null)}>
              <X size={16} />
            </button>
          </div>
          <div className="graph-modal-grid">
            <section>
              <div className="graph-section-title">References</div>
              <div className="graph-media-list">
                {references.length ? (
                  references.map((reference) => (
                    <button key={reference.reference_id} type="button" onClick={() => attachReferenceToNode(imageLibraryNodeId, reference.reference_id)}>
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
              <div className="graph-media-list">
                {assets.length ? (
                  assets.map((asset) => (
                    <button key={String(asset.asset_id)} type="button" onClick={() => attachAssetToNode(imageLibraryNodeId, String(asset.asset_id))}>
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
        </div>
      ) : null}
      {searchOpen ? (
        <div className="graph-node-search-modal" data-testid="graph-node-search-modal" role="dialog" aria-label="Node search">
          <div className="graph-search">
            <Search size={15} />
            <input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search nodes" />
          </div>
          <div className="graph-node-list">
            {filteredDefinitions.map((definition) => (
              <button
                key={definition.type}
                type="button"
                onClick={() => {
                  addDefinitionNode(definition);
                  setSearchOpen(false);
                }}
              >
                <strong>{definition.title}</strong>
                <span>{definition.category}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
