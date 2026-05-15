"use client";

import { useLayoutEffect, useRef } from "react";

import type { GraphNodeData } from "./types";

function GraphNodeTextareaField({
  nodeId,
  field,
  value,
  disabled,
  onFieldChange,
  className,
}: {
  nodeId: string;
  field: GraphNodeData["definition"]["fields"][number];
  value: unknown;
  disabled?: boolean;
  onFieldChange: GraphNodeData["onFieldChange"];
  className: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const selectionRef = useRef<{ start: number; end: number } | null>(null);
  const textValue = String(value ?? "");

  useLayoutEffect(() => {
    const selection = selectionRef.current;
    const textarea = textareaRef.current;
    if (!selection || !textarea || document.activeElement !== textarea) return;
    const start = Math.min(selection.start, textarea.value.length);
    const end = Math.min(selection.end, textarea.value.length);
    textarea.setSelectionRange(start, end);
  }, [textValue]);

  return (
    <textarea
      ref={textareaRef}
      className={className}
      value={textValue}
      placeholder={field.placeholder ?? ""}
      disabled={disabled}
      onChange={(event) => {
        selectionRef.current = {
          start: event.currentTarget.selectionStart,
          end: event.currentTarget.selectionEnd,
        };
        onFieldChange(nodeId, field.id, event.currentTarget.value);
      }}
    />
  );
}

export function GraphNodeFieldControl({
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
    return <GraphNodeTextareaField nodeId={nodeId} field={field} value={value} disabled={disabled} onFieldChange={onFieldChange} className={commonClass} />;
  }
  if (field.type === "select" || field.type === "enum" || field.type === "preset_picker" || field.type === "asset_picker" || field.type === "reference_media_picker") {
    const emptyLabel = field.id === "project_id" ? "No group" : "Auto";
    const showEmptyOption = !field.required && (field.default === undefined || field.default === null || field.default === "");
    return (
      <select
        className={commonClass}
        value={String(value ?? field.default ?? "")}
        disabled={disabled}
        onChange={(event) => onFieldChange(nodeId, field.id, event.target.value)}
      >
        {showEmptyOption ? <option value="">{emptyLabel}</option> : null}
        {(field.options ?? []).map((option) => {
          const optionValue = typeof option === "object" && option !== null && "value" in option ? (option as { value: unknown }).value : option;
          const optionLabel = typeof option === "object" && option !== null && "label" in option ? (option as { label: unknown }).label : optionValue;
          return (
            <option key={String(optionValue)} value={String(optionValue)}>
              {String(optionLabel)}
            </option>
          );
        })}
      </select>
    );
  }
  if (field.type === "boolean" || field.type === "bool") {
    const booleanValue = Boolean(value ?? field.default ?? false);
    return (
      <select
        className={commonClass}
        value={booleanValue ? "true" : "false"}
        disabled={disabled}
        onChange={(event) => onFieldChange(nodeId, field.id, event.target.value === "true")}
      >
        <option value="false">Off</option>
        <option value="true">On</option>
      </select>
    );
  }
  const numeric = field.type === "integer" || field.type === "float" || field.type === "number" || field.type === "int_range" || field.type === "float_range";
  return (
    <input
      className={commonClass}
      type={field.type === "color" ? "color" : numeric ? "number" : "text"}
      value={String(value ?? field.default ?? "")}
      placeholder={field.placeholder ?? ""}
      min={field.min ?? undefined}
      max={field.max ?? undefined}
      disabled={disabled}
      onChange={(event) => onFieldChange(nodeId, field.id, event.target.value)}
    />
  );
}
