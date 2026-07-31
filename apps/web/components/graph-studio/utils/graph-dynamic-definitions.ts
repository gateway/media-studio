import type { GraphNodeDefinition, GraphWorkflowPayload } from "../types";

const DYNAMIC_DEFINITION_NODE_TYPES = new Set(["preset.render", "prompt.recipe"]);

export function graphWorkflowNeedsFreshDefinitions(workflow: GraphWorkflowPayload): boolean {
  return workflow.nodes.some((node) => DYNAMIC_DEFINITION_NODE_TYPES.has(node.type));
}

export async function graphDefinitionsForWorkflowHydration({
  workflow,
  definitionsByType,
  reloadDefinitions,
}: {
  workflow: GraphWorkflowPayload;
  definitionsByType: Map<string, GraphNodeDefinition>;
  reloadDefinitions: (force?: boolean) => Promise<GraphNodeDefinition[]>;
}): Promise<Map<string, GraphNodeDefinition>> {
  if (!graphWorkflowNeedsFreshDefinitions(workflow)) return definitionsByType;
  const refreshedDefinitions = await reloadDefinitions(true);
  return new Map(refreshedDefinitions.map((definition) => [definition.type, definition]));
}
