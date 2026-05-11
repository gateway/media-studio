"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
} from "@xyflow/react";
import { Play, Save, Search, Upload, Workflow } from "lucide-react";

import { GraphNode } from "./graph-node";
import type { MediaAsset, MediaReference } from "@/lib/types";
import type { GraphNodeDefinition, GraphRun, GraphRunEvent, GraphWorkflowPayload, StudioEdge, StudioNode } from "./types";

const nodeTypes = { graphNode: GraphNode };

function defaultFields(definition: GraphNodeDefinition) {
  const fields: Record<string, unknown> = {};
  definition.fields.forEach((field) => {
    if (field.default !== undefined && field.default !== null) {
      fields[field.id] = field.default;
    }
  });
  return fields;
}

function createNode(definition: GraphNodeDefinition, position: { x: number; y: number }, onFieldChange: StudioNode["data"]["onFieldChange"]): StudioNode {
  return {
    id: `${definition.type}-${crypto.randomUUID().slice(0, 8)}`,
    type: "graphNode",
    position,
    data: {
      definition,
      fields: defaultFields(definition),
      status: "idle",
      progress: null,
      onFieldChange,
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

export function GraphStudio() {
  const [definitions, setDefinitions] = useState<GraphNodeDefinition[]>([]);
  const [search, setSearch] = useState("");
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [workflowName, setWorkflowName] = useState("Nano Image Pipeline");
  const [consoleLines, setConsoleLines] = useState<string[]>(["Graph Studio ready."]);
  const [run, setRun] = useState<GraphRun | null>(null);
  const [references, setReferences] = useState<MediaReference[]>([]);
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const appendConsole = useCallback((line: string) => {
    setConsoleLines((current) => [line, ...current].slice(0, 80));
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

  const definitionsByType = useMemo(() => new Map(definitions.map((definition) => [definition.type, definition])), [definitions]);
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
      const sourceDef = (source.data as StudioNode["data"]).definition;
      const targetDef = (target.data as StudioNode["data"]).definition;
      const sourcePort = sourceDef.ports.outputs.find((port) => port.id === connection.sourceHandle);
      const targetPort = targetDef.ports.inputs.find((port) => port.id === connection.targetHandle);
      if (!sourcePort || !targetPort) return false;
      return (targetPort.accepts?.length ? targetPort.accepts : [targetPort.type]).includes(sourcePort.type);
    },
    [nodes],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!edgeIsValid(connection)) {
        appendConsole("Connection rejected: incompatible ports.");
        return;
      }
      setEdges((current) =>
        addEdge(
          {
            ...connection,
            id: `edge-${connection.source}-${connection.sourceHandle}-${connection.target}-${connection.targetHandle}`,
            animated: true,
          },
          current,
        ),
      );
    },
    [appendConsole, edgeIsValid, setEdges],
  );

  const addDefinitionNode = useCallback(
    (definition: GraphNodeDefinition) => {
      setNodes((current) => [...current, createNode(definition, { x: 120 + current.length * 80, y: 120 + current.length * 60 }, onFieldChange)]);
    },
    [onFieldChange, setNodes],
  );

  const buildStarterWorkflow = useCallback(
    (items: GraphNodeDefinition[]) => {
      const byType = new Map(items.map((definition) => [definition.type, definition]));
      const load = byType.get("media.load_image");
      const model = byType.get("model.kie.nano_banana_pro");
      const save = byType.get("media.save_image");
      if (!load || !model || !save) return false;
      const loadNode = createNode(load, { x: 80, y: 180 }, onFieldChange);
      const modelNode = createNode(model, { x: 450, y: 110 }, onFieldChange);
      modelNode.data.fields.prompt = "Transform this reference into a cinematic, high-detail editorial image.";
      const saveNode = createNode(save, { x: 880, y: 220 }, onFieldChange);
      setNodes([loadNode, modelNode, saveNode]);
      setEdges([
        {
          id: "edge-load-model",
          source: loadNode.id,
          sourceHandle: "image",
          target: modelNode.id,
          targetHandle: "image_refs",
          animated: true,
        },
        {
          id: "edge-model-save",
          source: modelNode.id,
          sourceHandle: "image",
          target: saveNode.id,
          targetHandle: "image",
          animated: true,
        },
      ]);
      return true;
    },
    [onFieldChange, setEdges, setNodes],
  );

  const addLoadImageNode = useCallback(
    (fields: Record<string, unknown>, position?: { x: number; y: number }) => {
      const definition = definitionsByType.get("media.load_image");
      if (!definition) {
        appendConsole("Load Image node is not available.");
        return;
      }
      setNodes((current) => {
        const nextNode = createNode(definition, position ?? { x: 120 + current.length * 80, y: 120 + current.length * 60 }, onFieldChange);
        nextNode.data.fields = { ...nextNode.data.fields, ...fields };
        return [...current, nextNode];
      });
    },
    [appendConsole, definitionsByType, onFieldChange, setNodes],
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
        return;
      }
      if (isTextEntryTarget(event.target)) return;
      if (event.code === "Space") {
        event.preventDefault();
        setSearchOpen(true);
        setContextMenu(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const saveWorkflow = useCallback(async () => {
    const payload = workflowFromCanvas(workflowId, workflowName, nodes, edges);
    const record = await jsonFetch<{ workflow_id: string }>(
      workflowId ? `/api/control/media/graph/workflows/${workflowId}` : "/api/control/media/graph/workflows",
      {
        method: workflowId ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      },
    );
    setWorkflowId(record.workflow_id);
    appendConsole(`Saved workflow ${record.workflow_id}.`);
    return record.workflow_id;
  }, [appendConsole, edges, nodes, workflowId, workflowName]);

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
      const file = event.dataTransfer.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      const data = new FormData();
      data.append("file", file);
      const response = await fetch("/api/control/reference-media/import", { method: "POST", body: data });
      if (!response.ok) {
        appendConsole("Image import failed.");
        return;
      }
      const payload = (await response.json()) as { item?: MediaReference };
      if (!payload.item?.reference_id) {
        appendConsole("Image import did not return a reference.");
        return;
      }
      addLoadImageNode({ reference_id: payload.item.reference_id }, { x: event.clientX - 260, y: event.clientY - 120 });
      setReferences((current) => [payload.item as MediaReference, ...current.filter((item) => item.reference_id !== payload.item?.reference_id)].slice(0, 8));
      appendConsole(`Imported reference ${payload.item.reference_id}.`);
    },
    [addLoadImageNode, appendConsole],
  );

  return (
    <div className="graph-studio-shell" onDrop={onDrop} onDragOver={(event) => event.preventDefault()}>
      <aside className="graph-sidebar">
        <div className="graph-sidebar-title">
          <Workflow size={18} />
          <span>Graph Studio</span>
        </div>
        <label className="graph-workflow-name">
          Workflow
          <input value={workflowName} onChange={(event) => setWorkflowName(event.target.value)} />
        </label>
        <div className="graph-search">
          <Search size={15} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search nodes" />
        </div>
        <div className="graph-node-list" data-testid="graph-node-palette">
          {filteredDefinitions.map((definition) => (
            <button key={definition.type} type="button" onClick={() => addDefinitionNode(definition)}>
              <strong>{definition.title}</strong>
              <span>{definition.category}</span>
            </button>
          ))}
        </div>
        <section className="graph-sidebar-section">
          <div className="graph-section-title">Templates</div>
          <button
            className="graph-template-card"
            data-testid="graph-template-nano-image-pipeline"
            type="button"
            onClick={() => {
              if (buildStarterWorkflow(definitions)) {
                setWorkflowName("Nano Image Pipeline");
                setWorkflowId(null);
                appendConsole("Loaded Nano image pipeline template.");
              }
            }}
          >
            <span className="graph-template-thumb" />
            <span>
              <strong>Nano image pipeline</strong>
              <small>Load Image -&gt; Nano Banana Pro -&gt; Save Image</small>
            </span>
          </button>
        </section>
        <section className="graph-sidebar-section">
          <div className="graph-section-title">Recent References</div>
          <div className="graph-media-list" data-testid="graph-reference-list">
            {references.length ? (
              references.map((reference) => (
                <button key={reference.reference_id} type="button" onClick={() => addLoadImageNode({ reference_id: reference.reference_id })}>
                  {reference.thumb_url || reference.stored_url ? <img src={reference.thumb_url ?? reference.stored_url ?? ""} alt="" /> : <span className="graph-media-empty" />}
                  <span>{reference.original_filename ?? reference.reference_id}</span>
                </button>
              ))
            ) : (
              <div className="graph-sidebar-empty">No reference images yet.</div>
            )}
          </div>
        </section>
        <section className="graph-sidebar-section">
          <div className="graph-section-title">Recent Images</div>
          <div className="graph-media-list" data-testid="graph-asset-list">
            {assets.length ? (
              assets.map((asset) => (
                <button key={String(asset.asset_id)} type="button" onClick={() => addLoadImageNode({ asset_id: String(asset.asset_id) })}>
                  {asset.hero_thumb_url || asset.hero_web_url ? <img src={asset.hero_thumb_url ?? asset.hero_web_url ?? ""} alt="" /> : <span className="graph-media-empty" />}
                  <span>{asset.prompt_summary ?? String(asset.asset_id)}</span>
                </button>
              ))
            ) : (
              <div className="graph-sidebar-empty">No image assets yet.</div>
            )}
          </div>
        </section>
        <div className="graph-drop-hint">
          <Upload size={16} />
          Drop an image on the canvas to import it as a Load Image node.
        </div>
      </aside>
      <main className="graph-main">
        <div className="graph-toolbar">
          <button type="button" onClick={saveWorkflow}>
            <Save size={16} /> Save
          </button>
          <button type="button" onClick={validateWorkflow}>Validate</button>
          <button type="button" onClick={runWorkflow}>
            <Play size={16} /> Run
          </button>
          <div className="graph-run-status" data-testid="graph-run-status">
            {run ? `${run.status} ${run.error ? `- ${run.error}` : ""}` : "No run yet"}
          </div>
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
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            isValidConnection={edgeIsValid}
            onPaneClick={() => setContextMenu(null)}
            fitView
          >
            <Background />
            <MiniMap pannable zoomable />
            <Controls />
          </ReactFlow>
        </div>
        <section className="graph-console" data-testid="graph-console">
          {consoleLines.map((line, index) => (
            <div key={`${line}-${index}`}>{line}</div>
          ))}
        </section>
      </main>
      {contextMenu ? (
        <div className="graph-context-menu" data-testid="graph-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
          <div className="graph-section-title">Add Node</div>
          {definitions.map((definition) => (
            <button
              key={definition.type}
              type="button"
              onClick={() => {
                setNodes((current) => [...current, createNode(definition, { x: contextMenu.x - 360, y: contextMenu.y - 90 }, onFieldChange)]);
                setContextMenu(null);
              }}
            >
              <strong>{definition.title}</strong>
              <span>{definition.category}</span>
            </button>
          ))}
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
