import type { GraphNodeDefinition, GraphNodePort } from "../types";

export function graphPortAccepts(sourceType: string | null | undefined, targetPort: GraphNodePort | null | undefined) {
  if (!sourceType || !targetPort) return false;
  if (sourceType === "any" || targetPort.type === "any") return true;
  const accepted = targetPort.accepts?.length ? targetPort.accepts : [targetPort.type];
  return accepted.includes(sourceType) || accepted.includes("any");
}

export function graphDefinitionAcceptsInput(definition: GraphNodeDefinition, portType: string) {
  return definition.ports.inputs.some((port) => graphPortAccepts(portType, port));
}

export function graphDefinitionEmitsOutput(definition: GraphNodeDefinition, portType: string) {
  return definition.ports.outputs.some((port) => port.type === portType || port.type === "any" || portType === "any");
}
