import type { GraphNodeDefinition } from "../types";

const MODEL_CATEGORY_PREFIX = "Models/";

export function graphNodeHeaderKindLabel(
  definition: Pick<GraphNodeDefinition, "category" | "title">,
  displayTitle = definition.title,
) {
  if (!definition.category.startsWith(MODEL_CATEGORY_PREFIX)) return definition.category;
  if (displayTitle.trim() !== definition.title.trim()) return definition.title;

  const modelKind = definition.category.slice(MODEL_CATEGORY_PREFIX.length).trim();
  return modelKind ? `${modelKind} model` : "Model";
}
