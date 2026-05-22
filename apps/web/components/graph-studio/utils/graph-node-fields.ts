import type { GraphNodeDefinition, GraphNodeField } from "../types";

export type GraphVisibleFieldMetrics = {
  visibleFields: GraphNodeField[];
  previewHeaderFields: GraphNodeField[];
  bodyFields: GraphNodeField[];
  primaryBodyFields: GraphNodeField[];
  advancedBodyFields: GraphNodeField[];
  textareaCount: number;
  layoutFieldCount: number;
};

const GRAPH_SAVE_NODE_TYPES = new Set(["media.save_image", "media.save_video", "media.save_audio", "media.save_music_track"]);

export function graphPreviewHeaderFieldIds(definition: GraphNodeDefinition): string[] {
  return GRAPH_SAVE_NODE_TYPES.has(definition.type) ? ["project_id"] : [];
}

export function graphFieldValue(fields: Record<string, unknown>, id: string, definition: GraphNodeDefinition) {
  if (fields[id] != null && fields[id] !== "") return fields[id];
  return definition.fields.find((field) => field.id === id)?.default;
}

function valuesEqual(left: unknown, right: unknown) {
  return String(left ?? "") === String(right ?? "");
}

export function evaluateGraphVisibleCondition(
  condition: GraphNodeField["visible_if"],
  fields: Record<string, unknown>,
  definition: GraphNodeDefinition,
) {
  if (!condition?.field) return true;
  const currentValue = graphFieldValue(fields, condition.field, definition);
  if ("equals" in condition) return valuesEqual(currentValue, condition.equals);
  if ("not_equals" in condition) return !valuesEqual(currentValue, condition.not_equals);
  if (Array.isArray(condition.in)) return condition.in.some((value) => valuesEqual(currentValue, value));
  if (Array.isArray(condition.not_in)) return !condition.not_in.some((value) => valuesEqual(currentValue, value));
  return true;
}

export function isGraphFieldVisible(field: GraphNodeField, fields: Record<string, unknown>, definition: GraphNodeDefinition) {
  if (field.hidden) return false;
  return evaluateGraphVisibleCondition(field.visible_if, fields, definition);
}

function connectionDependentPortForField(definition: GraphNodeDefinition, fieldId: string): string | null {
  const rules = definition.ui?.connection_dependent_fields;
  if (!rules || typeof rules !== "object" || Array.isArray(rules)) return null;
  const value = (rules as Record<string, unknown>)[fieldId];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function visibleGraphFields(definition: GraphNodeDefinition, fields: Record<string, unknown>, connectedInputPorts: string[] = []) {
  const connected = new Set(connectedInputPorts);
  return definition.fields.filter((field) => {
    const dependentPort = connectionDependentPortForField(definition, field.id);
    if (dependentPort && !connected.has(dependentPort)) return false;
    return isGraphFieldVisible(field, fields, definition);
  });
}

export function graphVisibleFieldMetrics(
  definition: GraphNodeDefinition,
  fields: Record<string, unknown>,
  connectedInputPorts: string[] = [],
  options?: {
    advancedExpanded?: boolean;
    previewHeaderFieldIds?: string[];
    extraLayoutRows?: number;
  },
): GraphVisibleFieldMetrics {
  const previewHeaderFieldIds = new Set(options?.previewHeaderFieldIds ?? []);
  const visibleFields = visibleGraphFields(definition, fields, connectedInputPorts);
  const previewHeaderFields = visibleFields.filter((field) => previewHeaderFieldIds.has(field.id));
  const bodyFields = visibleFields.filter((field) => !previewHeaderFieldIds.has(field.id));
  const primaryBodyFields = bodyFields.filter((field) => !field.advanced);
  const advancedBodyFields = bodyFields.filter((field) => field.advanced);
  const fieldsInLayout = [...previewHeaderFields, ...primaryBodyFields, ...(options?.advancedExpanded ? advancedBodyFields : [])];
  const textareaCount = fieldsInLayout.filter((field) => field.type === "textarea").length;
  const layoutFieldCount =
    previewHeaderFields.length +
    primaryBodyFields.length +
    (advancedBodyFields.length ? 1 : 0) +
    (options?.advancedExpanded ? advancedBodyFields.length : 0) +
    (options?.extraLayoutRows ?? 0);
  return {
    visibleFields,
    previewHeaderFields,
    bodyFields,
    primaryBodyFields,
    advancedBodyFields,
    textareaCount,
    layoutFieldCount,
  };
}
