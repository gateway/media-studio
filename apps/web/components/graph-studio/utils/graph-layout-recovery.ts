import type { GraphWorkflowPayload } from "../types";
import { graphWorkflowSnapshotSignature } from "./graph-tabs";

type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid layout backup.");
  return value as RecordValue;
}
function coordinates(value: unknown, keys: string[]) {
  const result = record(value);
  if (Object.keys(result).length !== keys.length || keys.some(key => typeof result[key] !== "number" || !Number.isFinite(result[key]))) {
    throw new Error("Invalid layout coordinates.");
  }
  return result as Record<string, number>;
}

export async function graphWorkflowLayoutHash(workflow: GraphWorkflowPayload) {
  const signature = graphWorkflowSnapshotSignature(workflow);
  if (!signature) throw new Error("This workflow cannot restore a layout.");
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(signature));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

// Compare content and identity independently of node positions/group enclosures.
export function graphLayoutContentSignature(workflow: GraphWorkflowPayload) {
  const copy = JSON.parse(JSON.stringify(workflow)) as GraphWorkflowPayload;
  copy.nodes.forEach(node => { node.position = { x: 0, y: 0 }; });
  const groups = copy.metadata?.groups;
  if (Array.isArray(groups)) groups.forEach(group => { record(group).bounds = { x: 0, y: 0, width: 0, height: 0 }; });
  return graphWorkflowSnapshotSignature(copy);
}

function readBackup(text: string, workflow: GraphWorkflowPayload) {
  const backup = record(JSON.parse(text));
  if (backup.kind !== "media-studio.graph.layout-recovery" || backup.schema_version !== 1
    || backup.workflow_id !== (workflow.workflow_id ?? null)
    || !Array.isArray(backup.nodes) || !Array.isArray(backup.groups)
    || ![backup.expected_workflow_sha256, backup.restored_workflow_sha256].every(value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value))) {
    throw new Error("Choose a layout recovery backup for this workflow.");
  }
  return { expected_workflow_sha256: backup.expected_workflow_sha256, restored_workflow_sha256: backup.restored_workflow_sha256, nodes: backup.nodes, groups: backup.groups };
}

function restoreNodePositions(nodes: GraphWorkflowPayload["nodes"], patches: unknown[]) {
  const nodeIds = new Set<string>();
  for (const value of patches) {
    const patch = record(value);
    const node = nodes.find(item => item.id === patch.id);
    if (!node || nodeIds.has(node.id)) throw new Error("Layout backup has missing or repeated nodes.");
    nodeIds.add(node.id);
    const position = coordinates(patch.position, ["x", "y"]);
    node.position = { x: position.x, y: position.y };
  }
}

function restoreGroupBounds(groups: unknown[], patches: unknown[]) {
  const groupIds = new Set<unknown>();
  for (const value of patches) {
    const patch = record(value);
    const group = groups.find(item => record(item).id === patch.id);
    if (!group || groupIds.has(patch.id)) throw new Error("Layout backup has missing or repeated groups.");
    groupIds.add(patch.id);
    const bounds = coordinates(patch.bounds, ["x", "y", "width", "height"]);
    if (bounds.width <= 0 || bounds.height <= 0) throw new Error("Invalid layout bounds.");
    record(group).bounds = { ...bounds };
  }
}

export async function restoreGraphLayout(text: string, workflow: GraphWorkflowPayload) {
  const backup = readBackup(text, workflow);
  const restored = JSON.parse(JSON.stringify(workflow)) as GraphWorkflowPayload;
  restoreNodePositions(restored.nodes, backup.nodes);
  restoreGroupBounds(Array.isArray(restored.metadata?.groups) ? restored.metadata.groups : [], backup.groups);
  const currentHash = await graphWorkflowLayoutHash(workflow);
  if (currentHash === backup.restored_workflow_sha256) return { workflow, changed: false };
  if (currentHash !== backup.expected_workflow_sha256) throw new Error("This draft changed since the backup was made. Nothing was restored.");
  if (await graphWorkflowLayoutHash(restored) !== backup.restored_workflow_sha256) throw new Error("Layout backup verification failed. Nothing was restored.");
  return { workflow: restored, changed: true };
}
