// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CreativeAssistantPanel } from "./creative-assistant-panel";
import type { GraphWorkflowPayload } from "./types";
import { assistantTestSession as session, assistantTestWorkflow as base, assistantJsonResponse as json, assistantIdleProgress as idle } from "./creative-assistant-test-fixtures";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const graph: GraphWorkflowPayload = { ...base, nodes: [{ id: "a-node", type: "prompt.text", position: { x: 0, y: 0 }, fields: { text: "A006 exact content" }, metadata: { ui: { customTitle: "A006 marker" }, execution: { mode: "enabled" } } }] };
function mount(canvas: GraphWorkflowPayload, layoutOnly = false) {
  const plan = { plan: { assistant_plan_id: "plan-A", assistant_session_id: "session-1", status: "applied", capability: "plan_graph" },
    graph_plan: { capability: "plan_graph", summary: "A006 confirmed graph", operations: [{ op: layoutOnly ? "arrange_workflow" : "add_node" }], questions: [], warnings: [], metadata: {} },
    workflow: graph, validation: { valid: true, errors: [], warnings: [] }, pricing: { pricing_summary: { total: {} }, nodes: {}, warnings: [] } };
  const current = { ...session, latest_plan: plan, messages: [{ assistant_message_id: "applied", role: "system_summary", content_text: "Applied the confirmed graph proposal without running it.", content_json: { activity_kind: "graph_plan_applied" } }] };
  const fetch = vi.fn((url: string) => json(url.endsWith("/progress") ? idle : url.endsWith("/session-1") ? current : { ready: true }));
  const apply = vi.fn(); vi.stubGlobal("fetch", fetch);
  render(<CreativeAssistantPanel open workspaceKey="A" initialAssistantSessionId="session-1" workflowId="workflow-1" workflowName="A" workflow={canvas} references={[]} importImageFile={vi.fn()} onApplyWorkflow={apply} onClose={vi.fn()} />);
  return { fetch, apply };
}

it.each(["blank", "changed-prompt", "changed-title", "changed-mode"])("keeps a persisted Apply confirmation truthful on a %s canvas", async (difference) => {
  const node = graph.nodes[0];
  const canvas = difference === "blank" ? base : { ...graph, nodes: [{ ...node,
    fields: difference === "changed-prompt" ? { text: "Manual edit" } : node.fields,
    metadata: difference === "changed-title" ? { ...node.metadata, ui: { customTitle: "Manual title" } }
      : difference === "changed-mode" ? { ...node.metadata, execution: { mode: "muted" } } : node.metadata,
  }] };
  const f = mount(canvas); await act(async () => Promise.resolve());
  expect(screen.getByRole("region", { name: "Graph confirmation status" }).textContent).toContain("Graph confirmation saved");
  expect(screen.queryByRole("region", { name: "Added graph status" })).toBeNull();
  expect(screen.queryByText("Applied the confirmed graph proposal without running it.")).toBeNull();
  expect(screen.getByRole("button", { name: "Review graph again" })).toBeTruthy();
  expect(f.fetch.mock.calls.some(([url]) => url.endsWith("/apply") || url.endsWith("/messages"))).toBe(false);
  expect(f.apply).not.toHaveBeenCalled();
});

it("retains truthful content completion after measured layout changes", async () => {
  mount({ ...graph, nodes: [{ ...graph.nodes[0], position: { x: 500, y: 96 }, metadata: { ...graph.nodes[0].metadata, style: { height: 700 }, ui: { customTitle: "A006 marker", collapsed: true } } }] });
  await act(async () => Promise.resolve());
  expect(screen.getByRole("region", { name: "Added graph status" }).textContent).toContain("Graph added");
});

it("does not infer current layout delivery from persisted confirmation alone", async () => {
  mount(graph, true); await act(async () => Promise.resolve());
  expect(screen.getByRole("region", { name: "Graph confirmation status" }).textContent).toContain("Layout confirmation saved");
  expect(screen.queryByText("Workflow layout updated")).toBeNull();
});
