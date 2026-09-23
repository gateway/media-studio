import { describe, expect, it } from "vitest";
import type { GraphGroup, GraphWorkflowPayload, StudioNode } from "../types";
import { reflowAssistantRegions } from "./graph-assistant-reflow";

function fixture(count = 4) {
  const ids = [...Array.from({ length: count }, (_, index) => `ref-${index}`), "recipe", "image", "review", "video", "preview"];
  const nodes = ids.map((id, index) => ({
    id, position: { x: 0, y: index * 700 }, measured: { width: id.startsWith("ref") ? 680 : 420, height: id === "recipe" ? 1900 : 620 },
    data: { fields: { prompt: "Preserve every word" }, executionMode: id === "video" ? "muted" : "enabled" },
  })) as StudioNode[];
  const edges = [
    ...ids.filter((id) => id.startsWith("ref")).flatMap((id) => [{ source: id, target: "image" }, { source: id, target: "video" }]),
    { source: "recipe", target: "image" }, { source: "image", target: "review" }, { source: "image", target: "video" }, { source: "video", target: "preview" },
  ].map((edge, index) => ({ ...edge, id: `edge-${index}`, source_port: "image", target_port: "image" }));
  const workflow = { nodes: nodes.map((node) => ({ id: node.id, type: node.id === "recipe" ? "prompt.recipe" : node.id, position: node.position, fields: {} })), edges, metadata: { groups: [{ id: "production", node_ids: ids, title: "Production", color: "blue", bounds: { x: 0, y: 0, width: 1000, height: 10000 } }] } } as GraphWorkflowPayload;
  return { nodes, workflow, ids: new Set(ids) };
}

function checkGeometry(nodes: StudioNode[], workflow: GraphWorkflowPayload) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const [index, node] of nodes.entries()) {
    for (const other of nodes.slice(index + 1)) {
      expect(node.position.x + node.measured!.width! + 96 <= other.position.x
        || other.position.x + other.measured!.width! + 96 <= node.position.x
        || node.position.y + node.measured!.height! + 96 <= other.position.y
        || other.position.y + other.measured!.height! + 96 <= node.position.y).toBe(true);
    }
  }
  for (const edge of workflow.edges) {
    const source = byId.get(edge.source)!;
    expect(source.position.x + source.measured!.width! + 96).toBeLessThanOrEqual(byId.get(edge.target)!.position.x);
  }
}

describe("width-first Assistant layout", () => {
  it("fits a tall recipe, four references and branched outputs within the tallest node", () => {
    const { nodes, workflow, ids } = fixture();
    const before = JSON.stringify(workflow);
    const next = reflowAssistantRegions(nodes, ids, workflow);
    expect(Math.max(...next.map((node) => node.position.y + node.measured!.height!)) - Math.min(...next.map((node) => node.position.y))).toBe(1900);
    expect(new Set(next.filter((node) => node.id.startsWith("ref")).map((node) => node.position.x)).size).toBeGreaterThan(1);
    checkGeometry(next, workflow);
    next.forEach((node, index) => expect(node.data).toBe(nodes[index].data));
    expect(JSON.stringify(workflow)).toBe(before);
    expect(reflowAssistantRegions(next, ids, workflow)).toBe(next);
  });

  it("reflows when actual recipe height and preview width change, then settles", () => {
    const { nodes, workflow, ids } = fixture();
    const first = reflowAssistantRegions(nodes, ids, workflow);
    const grown = first.map((node) => node.id === "recipe" ? { ...node, measured: { width: 560, height: 2500 } } : node.id === "image" ? { ...node, measured: { width: 1000, height: 700 } } : node);
    const next = reflowAssistantRegions(grown, ids, workflow);
    checkGeometry(next, workflow);
    expect(Math.max(...next.map((node) => node.position.y + node.measured!.height!)) - Math.min(...next.map((node) => node.position.y))).toBe(2500);
    expect(reflowAssistantRegions(next, ids, workflow)).toBe(next);
  });

  it("keeps partial-group edits and unrelated user positions intact", () => {
    const { nodes, workflow } = fixture();
    expect(reflowAssistantRegions(nodes, new Set(["image"]), workflow)).toBe(nodes);
  });

  it("moves whole groups horizontally around other groups without mixing membership", () => {
    const { nodes, workflow, ids } = fixture();
    const other = { ...nodes[0], id: "other", position: { x: 1800, y: 0 } };
    workflow.nodes.push({ ...workflow.nodes[0], id: "other", position: other.position });
    const groups = workflow.metadata!.groups as GraphGroup[];
    groups.push({ id: "other-group", node_ids: ["other"], title: "Other", color: "blue", bounds: { x: 1800, y: 0, width: 800, height: 900 } });
    ids.add("other");
    const next = reflowAssistantRegions([...nodes, other], ids, workflow);
    const right = Math.max(...next.filter((node) => node.id !== "other").map((node) => node.position.x + node.measured!.width!));
    expect(next.at(-1)!.position.x).toBeGreaterThanOrEqual(right + 288);
    expect(groups[1].node_ids).toEqual(["other"]);
  });

  it("packs a large reference fan-in without iterative solver passes", () => {
    const { nodes, workflow, ids } = fixture(500);
    const next = reflowAssistantRegions(nodes, ids, workflow);
    expect(next.length).toBe(nodes.length);
    expect(reflowAssistantRegions(next, ids, workflow)).toBe(next);
  });
});
