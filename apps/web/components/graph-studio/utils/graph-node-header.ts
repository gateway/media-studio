import type { GraphNodeDefinition } from "../types";

const MODEL_CATEGORY_PREFIX = "Models/";

export function graphNodeHeaderKindLabel(definition: Pick<GraphNodeDefinition, "category" | "title">) {
  if (!definition.category.startsWith(MODEL_CATEGORY_PREFIX)) return definition.category;

  const modelKind = definition.category.slice(MODEL_CATEGORY_PREFIX.length).trim().toLowerCase();
  const modelLabel = modelKind ? `${modelKind} model` : "model";
  return `${definition.title} - ${modelLabel}`;
}
