import type { GraphNodeDefinition, GraphNodeField } from "../types";

function fieldValue(fields: Record<string, unknown>, id: string, definition: GraphNodeDefinition) {
  if (fields[id] != null && fields[id] !== "") return fields[id];
  return definition.fields.find((field) => field.id === id)?.default;
}

function valuesEqual(left: unknown, right: unknown) {
  return String(left ?? "") === String(right ?? "");
}

export function isGraphFieldVisible(field: GraphNodeField, fields: Record<string, unknown>, definition: GraphNodeDefinition) {
  if (field.hidden) return false;
  const condition = field.visible_if;
  if (!condition?.field) return true;
  const currentValue = fieldValue(fields, condition.field, definition);
  if ("equals" in condition) return valuesEqual(currentValue, condition.equals);
  if ("not_equals" in condition) return !valuesEqual(currentValue, condition.not_equals);
  if (Array.isArray(condition.in)) return condition.in.some((value) => valuesEqual(currentValue, value));
  if (Array.isArray(condition.not_in)) return !condition.not_in.some((value) => valuesEqual(currentValue, value));
  return true;
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
