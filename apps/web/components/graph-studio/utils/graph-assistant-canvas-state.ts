import type { GraphWorkflowPayload } from "../types";
import { readGraphGroupsFromWorkflow } from "./graph-groups";
import { normalizeGraphExecutionMode } from "./graph-node-execution";
import { graphWorkflowSnapshotsMatch } from "./graph-tabs";

// Confirmation records cannot prove browser delivery. Compare content without measured geometry or transient UI/cache state.
function canvasContent(workflow: GraphWorkflowPayload): GraphWorkflowPayload {
  return {
    schema_version: 1, workflow_id: workflow.workflow_id ?? null, name: workflow.name,
    nodes: workflow.nodes.map(node => ({
      id: node.id, type: node.type, fields: node.fields, position: { x: 0, y: 0 },
      metadata: {
        source_result: node.metadata?.source_result ?? null,
        ui: { customTitle: ((node.metadata?.ui ?? {}) as Record<string, unknown>).customTitle ?? null },
        execution: { mode: normalizeGraphExecutionMode(((node.metadata?.execution ?? {}) as Record<string, unknown>).mode) },
      },
    })).sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...workflow.edges].sort((a, b) => a.id.localeCompare(b.id)),
    metadata: { groups: readGraphGroupsFromWorkflow(workflow).map(group => ({
      id: group.id, title: group.title, color: group.color, node_ids: [...group.node_ids].sort(),
      execution: { mode: normalizeGraphExecutionMode(group.execution?.mode) },
    })).sort((a, b) => a.id.localeCompare(b.id)) },
  };
}

export function assistantGraphContentIsOnCanvas(confirmed: GraphWorkflowPayload, current: GraphWorkflowPayload): boolean {
  return graphWorkflowSnapshotsMatch(canvasContent(confirmed), canvasContent(current));
}
