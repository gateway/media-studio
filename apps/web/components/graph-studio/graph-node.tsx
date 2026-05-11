"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";

import type { GraphNodeData, StudioNode } from "./types";

function FieldControl({
  nodeId,
  field,
  value,
  onFieldChange,
}: {
  nodeId: string;
  field: GraphNodeData["definition"]["fields"][number];
  value: unknown;
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
        onChange={(event) => onFieldChange(nodeId, field.id, event.target.value)}
      />
    );
  }
  if (field.type === "select") {
    return (
      <select
        className={commonClass}
        value={String(value ?? field.default ?? "")}
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
      onChange={(event) => onFieldChange(nodeId, field.id, event.target.value)}
    />
  );
}

export function GraphNode({ id, data }: NodeProps<StudioNode>) {
  const definition = data.definition;
  const status = data.status ?? "idle";
  return (
    <div className={`graph-node graph-node-${status}`} data-testid={`graph-node-${definition.type}`}>
      <div className="graph-node-header">
        <div>
          <div className="graph-node-title">{definition.title}</div>
          <div className="graph-node-kind">{definition.category}</div>
        </div>
        <span className="graph-node-status">{status}</span>
      </div>
      <div className="graph-node-body">
        {definition.ports.inputs.map((port) => (
          <div className="graph-node-port-row graph-node-port-input" key={port.id}>
            <Handle id={port.id} type="target" position={Position.Left} className={`graph-handle graph-handle-${port.type}`} />
            <span>{port.label}</span>
            <small>{port.type}</small>
          </div>
        ))}
        {definition.fields.map((field) => (
          <label className="graph-node-field" key={field.id}>
            <span>
              {field.label}
              {field.required ? " *" : ""}
            </span>
            <FieldControl nodeId={id} field={field} value={data.fields[field.id]} onFieldChange={data.onFieldChange} />
          </label>
        ))}
        {definition.ports.outputs.map((port) => (
          <div className="graph-node-port-row graph-node-port-output" key={port.id}>
            <span>{port.label}</span>
            <small>{port.type}</small>
            <Handle id={port.id} type="source" position={Position.Right} className={`graph-handle graph-handle-${port.type}`} />
          </div>
        ))}
      </div>
    </div>
  );
}
