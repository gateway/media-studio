"use client";

import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import { Image as ImageIcon } from "lucide-react";

import type { GraphNodeData, StudioNode } from "./types";

function openNodeImageLibrary(nodeId: string, data: GraphNodeData) {
  data.onOpenImageLibrary?.(nodeId);
  window.dispatchEvent(new CustomEvent("graph-studio-open-image-library", { detail: { nodeId } }));
}

function dropNodeImage(nodeId: string, data: GraphNodeData, file: File) {
  if (data.onImageDrop) {
    data.onImageDrop(nodeId, file);
    return;
  }
  window.dispatchEvent(new CustomEvent("graph-studio-node-image-drop", { detail: { nodeId, file } }));
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

function FieldControl({
  nodeId,
  field,
  value,
  disabled,
  onFieldChange,
}: {
  nodeId: string;
  field: GraphNodeData["definition"]["fields"][number];
  value: unknown;
  disabled?: boolean;
  onFieldChange: GraphNodeData["onFieldChange"];
}) {
  if (field.hidden) return null;
  const commonClass = "graph-node-field-control nodrag";
  if (field.type === "textarea") {
    return (
      <textarea
        className={commonClass}
        value={String(value ?? "")}
        placeholder={field.placeholder ?? ""}
        disabled={disabled}
        onChange={(event) => onFieldChange(nodeId, field.id, event.target.value)}
      />
    );
  }
  if (field.type === "select") {
    return (
      <select
        className={commonClass}
        value={String(value ?? field.default ?? "")}
        disabled={disabled}
        onChange={(event) => onFieldChange(nodeId, field.id, event.target.value)}
      >
        <option value="">Auto</option>
        {(field.options ?? []).map((option) => (
          <option key={String(option)} value={String(option)}>
            {String(option)}
          </option>
        ))}
      </select>
    );
  }
  if (field.type === "boolean") {
    return (
      <input
        className="nodrag"
        type="checkbox"
        checked={Boolean(value ?? field.default ?? false)}
        disabled={disabled}
        onChange={(event) => onFieldChange(nodeId, field.id, event.target.checked)}
      />
    );
  }
  return (
    <input
      className={commonClass}
      type={field.type === "integer" || field.type === "float" || field.type === "number" ? "number" : "text"}
      value={String(value ?? field.default ?? "")}
      placeholder={field.placeholder ?? ""}
      min={field.min ?? undefined}
      max={field.max ?? undefined}
      disabled={disabled}
      onChange={(event) => onFieldChange(nodeId, field.id, event.target.value)}
    />
  );
}

export function GraphNode({ id, data, selected }: NodeProps<StudioNode>) {
  const definition = data.definition;
  const status = data.status ?? "idle";
  const isLoadImage = definition.type === "media.load_image";
  const showPreview = Boolean(data.mediaPreview) || isLoadImage || Boolean(definition.ui?.show_preview);
  const connectedInputPorts = new Set(data.connectedInputPorts ?? []);
  const activeConnection = data.activeConnection ?? null;
  const connectableFieldIds = new Set(definition.fields.filter((field) => field.connectable || field.port_type).map((field) => field.id));
  const visibleFields = definition.fields.filter((field) => !field.hidden && field.type !== "asset_picker" && field.type !== "reference_media_picker");
  const inputHandleClass = (port: GraphNodeData["definition"]["ports"]["inputs"][number]) => {
    const accepts = port.accepts?.length ? port.accepts : [port.type];
    const compatible = activeConnection?.from === "output" && accepts.includes(activeConnection.portType);
    return `graph-handle graph-handle-${port.type} ${compatible ? "graph-handle-compatible" : ""}`;
  };
  const outputHandleClass = (port: GraphNodeData["definition"]["ports"]["outputs"][number]) => {
    const compatible = activeConnection?.from === "input" && port.type === activeConnection.portType;
    return `graph-handle graph-handle-${port.type} ${compatible ? "graph-handle-compatible" : ""}`;
  };
  return (
    <div
      className={`graph-node graph-node-${status}`}
      data-testid={`graph-node-${definition.type}`}
      onDragOver={(event) => {
        if (!isLoadImage) return;
        event.preventDefault();
        event.stopPropagation();
      }}
      onDrop={(event) => {
        if (!isLoadImage) return;
        event.preventDefault();
        event.stopPropagation();
        const graphMedia = readGraphMediaDragPayload(event.dataTransfer);
        if (graphMedia && (!graphMedia.mediaType || graphMedia.mediaType === "image")) {
          data.onSetFields?.(
            id,
            graphMedia.source === "reference" ? { reference_id: graphMedia.id, asset_id: "" } : { asset_id: graphMedia.id, reference_id: "" },
          );
          return;
        }
        const file = event.dataTransfer.files?.[0];
        if (file?.type.startsWith("image/")) {
          dropNodeImage(id, data, file);
        }
      }}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={260}
        minHeight={180}
        keepAspectRatio={false}
        handleClassName="graph-node-resize-handle"
        lineClassName="graph-node-resize-line"
      />
      <div className="graph-node-header">
        <div>
          <div className="graph-node-title">{definition.title}</div>
          <div className="graph-node-kind">{definition.category}</div>
        </div>
        <span className="graph-node-status">{status}</span>
      </div>
      <div className="graph-node-body">
        {showPreview ? (
          <div className="graph-node-preview" data-testid={`graph-node-preview-${id}`}>
            {data.mediaPreview?.url ? (
              data.mediaPreview.mediaType === "video" ? (
                <video src={data.mediaPreview.url} controls muted playsInline />
              ) : (
                <img src={data.mediaPreview.url} alt={data.mediaPreview.label ?? "Graph node preview"} />
              )
            ) : isLoadImage ? (
              <button
                className="graph-node-preview-empty nodrag"
                type="button"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  openNodeImageLibrary(id, data);
                }}
              >
                <ImageIcon size={18} />
                <span>Drop image or choose from library</span>
              </button>
            ) : (
              <div className="graph-node-preview-empty">
                <span>No preview yet</span>
              </div>
            )}
          </div>
        ) : null}
        {isLoadImage ? (
          <button
            className="graph-node-library-button nodrag"
            type="button"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              openNodeImageLibrary(id, data);
            }}
          >
            Open Image Library
          </button>
        ) : null}
        {definition.ports.inputs.filter((port) => !connectableFieldIds.has(port.id)).map((port) => (
          <div className={`graph-node-port-row graph-node-port-input ${activeConnection?.from === "output" && inputHandleClass(port).includes("graph-handle-compatible") ? "graph-port-compatible" : ""}`} key={port.id}>
            <Handle id={port.id} type="target" position={Position.Left} className={inputHandleClass(port)} />
            <span>{port.label}</span>
            <small>{port.type}</small>
          </div>
        ))}
        {visibleFields.map((field) => {
          const fieldConnected = connectedInputPorts.has(field.id);
          const fieldPort = definition.ports.inputs.find((port) => port.id === field.id);
          return (
            <label className={`graph-node-field ${fieldPort ? "graph-node-field-connectable" : ""} ${fieldConnected ? "graph-node-field-connected" : ""}`} key={field.id}>
              {fieldPort ? <Handle id={fieldPort.id} type="target" position={Position.Left} className={inputHandleClass(fieldPort)} /> : null}
              <span>
                {field.label}
                {field.required ? " *" : ""}
              </span>
              <FieldControl nodeId={id} field={field} value={data.fields[field.id]} disabled={fieldConnected} onFieldChange={data.onFieldChange} />
            </label>
          );
        })}
        {definition.ports.outputs.map((port) => (
          <div className={`graph-node-port-row graph-node-port-output ${activeConnection?.from === "input" && outputHandleClass(port).includes("graph-handle-compatible") ? "graph-port-compatible" : ""}`} key={port.id}>
            <span>{port.label}</span>
            <small>{port.type}</small>
            <Handle id={port.id} type="source" position={Position.Right} className={outputHandleClass(port)} />
          </div>
        ))}
      </div>
    </div>
  );
}
