import type { GraphNodeDefinition } from "../types";
import { graphMediaPresetApplySelectionDefinition } from "./graph-media-preset";

export function resolveGraphNodeDefinition(
  definition: GraphNodeDefinition,
  fields: Record<string, unknown> = {},
): GraphNodeDefinition {
  if (definition.type === "preset.render") {
    return graphMediaPresetApplySelectionDefinition(definition, fields);
  }
  if (definition.type === "prompt.recipe") {
    return definition;
  }
  return definition;
}
