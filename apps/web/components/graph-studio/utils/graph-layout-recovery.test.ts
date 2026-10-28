import { describe, expect, it } from "vitest";
import type { GraphWorkflowPayload } from "../types";
import { graphLayoutContentSignature, graphWorkflowLayoutHash, restoreGraphLayout } from "./graph-layout-recovery";

const current: GraphWorkflowPayload = {
  schema_version: 1, workflow_id: "saved", name: "Dirty draft",
  nodes: [{ id: "note", type: "utility.note", position: { x: 0, y: 900 }, fields: { text: "Keep this" }, metadata: { execution: { mode: "frozen" } } }],
  edges: [], metadata: { created_by: "graph-studio", groups: [{ id: "group", title: "Keep title", color: "blue", node_ids: ["note"], bounds: { x: -96, y: -96, width: 600, height: 1500 }, execution: { mode: "frozen" } }] },
};
const original = JSON.parse(JSON.stringify(current)) as GraphWorkflowPayload;
original.nodes[0].position.y = 100;
(original.metadata!.groups as { bounds: { height: number } }[])[0].bounds.height = 600;
async function backup() {
  return {
    kind: "media-studio.graph.layout-recovery", schema_version: 1, workflow_id: "saved",
    expected_workflow_sha256: await graphWorkflowLayoutHash(current), restored_workflow_sha256: await graphWorkflowLayoutHash(original),
    nodes: [{ id: "note", position: { x: 0, y: 100 } }],
    groups: [{ id: "group", bounds: { x: -96, y: -96, width: 600, height: 600 } }],
  };
}

describe("guarded layout recovery", () => {
  it("restores only geometry and recognizes an already restored draft", async () => {
    const text = JSON.stringify(await backup());
    const result = await restoreGraphLayout(text, current);
    expect(result).toEqual({ workflow: original, changed: true });
    expect(graphLayoutContentSignature(result.workflow)).toBe(graphLayoutContentSignature(current));
    expect(current.nodes[0].position.y).toBe(900);
    expect(await restoreGraphLayout(text, result.workflow)).toEqual({ workflow: original, changed: false });
  });

  it.each(["content", "position", "identity"])("refuses conflicting current %s", async (change) => {
    const edited = JSON.parse(JSON.stringify(current)) as GraphWorkflowPayload;
    if (change === "content") edited.nodes[0].fields.text = "New user edit";
    if (change === "position") edited.nodes[0].position.x = 1;
    if (change === "identity") edited.workflow_id = "another";
    await expect(restoreGraphLayout(JSON.stringify(await backup()), edited)).rejects.toThrow();
  });

  const invalidBackups = {
    kind: (value: Awaited<ReturnType<typeof backup>>) => { value.kind = "workflow"; },
    version: (value: Awaited<ReturnType<typeof backup>>) => { value.schema_version = 2; },
    hash: (value: Awaited<ReturnType<typeof backup>>) => { value.expected_workflow_sha256 = "invalid"; },
    target: (value: Awaited<ReturnType<typeof backup>>) => { value.restored_workflow_sha256 = "0".repeat(64); },
    "missing node": (value: Awaited<ReturnType<typeof backup>>) => { value.nodes[0].id = "unknown"; },
    "duplicate node": (value: Awaited<ReturnType<typeof backup>>) => { value.nodes.push(value.nodes[0]); },
    "missing group": (value: Awaited<ReturnType<typeof backup>>) => { value.groups[0].id = "unknown"; },
    "duplicate group": (value: Awaited<ReturnType<typeof backup>>) => { value.groups.push(value.groups[0]); },
    coordinate: (value: Awaited<ReturnType<typeof backup>>) => { value.nodes[0].position.y = Infinity; },
    bounds: (value: Awaited<ReturnType<typeof backup>>) => { value.groups[0].bounds.width = -1; },
  };
  it.each(Object.entries(invalidBackups))("rejects invalid backup %s without mutating the draft", async (_name, invalidate) => {
    const value = await backup();
    invalidate(value);
    const before = JSON.stringify(current);
    await expect(restoreGraphLayout(JSON.stringify(value), current)).rejects.toThrow();
    expect(JSON.stringify(current)).toBe(before);
  });

  it("rejects malformed JSON", async () => {
    await expect(restoreGraphLayout("{", current)).rejects.toThrow();
  });
});
