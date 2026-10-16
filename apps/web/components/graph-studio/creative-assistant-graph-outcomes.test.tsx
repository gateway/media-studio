// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CreativeAssistantPanel } from "./creative-assistant-panel";
import { assistantIdleProgress, assistantSessionResponse, assistantJsonResponse as json, assistantTestSession as session, assistantTestWorkflow as workflow } from "./creative-assistant-test-fixtures";
import type { AssistantPlanResponse } from "./types";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function missingMediaPlan(): AssistantPlanResponse {
  return {
    plan: { assistant_plan_id: "missing-images", assistant_session_id: "session-1", status: "validated", capability: "plan_graph" },
    graph_plan: { capability: "plan_graph", summary: "Prepared an advertising image graph.", questions: [], operations: [{ op: "add_node", node_type: "media.load_image" }], warnings: [], requires_confirmation: true, metadata: {} },
    workflow: { ...workflow, nodes: [
      { id: "person", type: "media.load_image", position: { x: 0, y: 0 }, fields: {}, metadata: { ui: { customTitle: "Person photo" } } },
      { id: "product", type: "media.load_image", position: { x: 0, y: 200 }, fields: {}, metadata: { ui: { customTitle: "Product photo" } } },
    ] },
    validation: { valid: false, errors: [
      { code: "missing_media_reference", message: "Load media needs an asset or reference media for this required input.", node_id: "person" },
      { code: "missing_media_reference", message: "Load media needs an asset or reference media for this required input.", node_id: "product" },
    ], warnings: [] },
    pricing: { pricing_summary: { total: {} }, nodes: {}, warnings: [] },
  };
}

async function review(plan: AssistantPlanResponse, canvas = workflow, apply = vi.fn(), progress?: Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn((url: string) => url.endsWith("/progress") ? (progress ?? json(assistantIdleProgress)) :
    (url.includes("/sessions?") || url.endsWith("/session-1")) ? assistantSessionResponse(url, { ...session, messages: [], latest_plan: plan }) : json({ ready: true })));
  render(<CreativeAssistantPanel open workspaceKey="missing-media" workflowId="workflow-1" workflowName="Graph" workflow={canvas}
    references={[]} importImageFile={vi.fn()} onApplyWorkflow={apply} onClose={vi.fn()} />);
  return within(await screen.findByRole("region", { name: plan.plan.status === "applied" ? "Added graph status" : "Graph review" }));
}


it("does not expose a tool instruction as the primary rename review", async () => {
  const plan = missingMediaPlan();
  plan.workflow.nodes = [];
  plan.validation = { valid: true, errors: [], warnings: [] };
  plan.graph_plan.operations = [{ op: "rename_workflow", title: "MAREL-007 — inputs supplied" }];
  plan.graph_plan.summary = "Prepare a fresh rename-only proposal from the current graph, freshly validating it and preserving both current media selections, all nodes, connections, and prompt. Do not apply or run.";
  const instruction = plan.graph_plan.summary;

  const view = await review(plan);
  expect(view.queryByText(instruction)).toBeNull();
});

it.each([
  [[{ op: "add_node", node_type: "prompt.text", title: "Warm lighting" }], "Graph additions prepared", "Add to canvas", "Add nodes"],
  [[{ op: "set_node_field", node_id: "person", fields: { resolution: "2K" } }], "Node changes prepared", "Apply node changes", "Update node settings"],
  [[{ op: "arrange_workflow" }], "Workflow layout ready", "Tidy workflow", "Arrange the workflow"],
  [[{ op: "rename_workflow", title: "Dawn" }, { op: "add_node", title: "Warm lighting" }, { op: "set_node_field", fields: { text: "amber" } }, { op: "arrange_workflow" }], "Workflow changes prepared", "Apply changes", "Rename the workflow"],
])("explains prepared operations without treating summary prose as authoritative", async (operations, heading, action, effect) => {
  const plan = missingMediaPlan();
  plan.validation = { valid: true, errors: [], warnings: [] };
  plan.graph_plan.operations = operations as AssistantPlanResponse["graph_plan"]["operations"];
  plan.graph_plan.summary = "Prepare this proposal; do not apply or run.";
  const view = await review(plan);
  expect(view.getByText(heading as string)).toBeTruthy();
  expect(await view.findByRole("button", { name: action as string })).toBeTruthy();
  expect(screen.getByRole("region", { name: "Graph review" }).textContent).toContain(effect as string);
  expect(view.queryByText(plan.graph_plan.summary)).toBeNull();
});

it.each(["failed", "rejected"])("does not offer confirmation or claim success for a %s proposal", async status => {
  const plan = missingMediaPlan();
  plan.plan.status = status as "failed" | "rejected";
  plan.graph_plan.operations = [{ op: "rename_workflow", title: "Dawn" }];
  const view = await review(plan);
  expect(view.queryByRole("button", { name: "Rename workflow" })).toBeNull();
  expect(view.getByText(/not completed/)).toBeTruthy();
});

it("preserves creative context behind an explicit disclosure", async () => {
  const plan = missingMediaPlan(); plan.validation = { valid: true, errors: [], warnings: [] };
  plan.graph_plan.summary = "Warm amber lighting with deep navy shadows, preserving the 4:3 framing.";
  const view = await review(plan);
  expect(view.queryByText(plan.graph_plan.summary)).toBeNull();
  fireEvent.click(view.getByText("Assistant context"));

  await act(async () => Promise.resolve());
  expect(await view.findByText(plan.graph_plan.summary)).toBeTruthy();
});

it("shows every effect after a mixed proposal is delivered", async () => {
  const plan = missingMediaPlan(); plan.validation = { valid: true, errors: [], warnings: [] };
  plan.plan.status = "applied";
  plan.workflow.name = "Dawn";
  plan.graph_plan.operations = [{ op: "rename_workflow", title: "Dawn" }, { op: "add_node", title: "Warm lighting" }, { op: "set_node_field", node_id: "person", fields: { resolution: "2K" } }, { op: "arrange_workflow" }];
  const view = await review(plan, plan.workflow);
  expect(view.getByText("Workflow changes applied")).toBeTruthy();
  expect(screen.getByRole("region", { name: "Added graph status" }).textContent).toContain("Rename the workflow to ‘Dawn’; Add nodes: Warm lighting; Update node settings or titles; Arrange the workflow");
  expect(view.queryByRole("button", { name: "Apply changes" })).toBeNull();
});

it("blocks non-media errors and keeps no-op questions visible", async () => {
  const plan = missingMediaPlan();
  plan.validation.errors.push({ code: "missing_prompt", message: "Add the advertising prompt.", node_id: "prompt" });
  const view = await review(plan);
  expect(view.queryByRole("button", { name: "Add to canvas" })).toBeNull();
  expect(view.getByText("Add the advertising prompt.")).toBeTruthy();
  cleanup();
  plan.graph_plan.operations = []; plan.graph_plan.questions = ["Which clips should I combine?"];
  const noop = await review(plan);
  expect(noop.getByText("Which clips should I combine?")).toBeTruthy();
  expect(noop.queryByRole("button", { name: "Apply changes" })).toBeNull();
});

it("replaces a stale confirmation action with fresh-review recovery", async () => {
  const plan = missingMediaPlan(); plan.validation = { valid: true, errors: [], warnings: [] };
  plan.graph_plan.operations = [{ op: "rename_workflow", title: "Dawn" }];
  const view = await review(plan);
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ detail: "The canvas changed after this graph proposal was created. Ask for a fresh proposal." }), { status: 400, headers: { "content-type": "application/json" } }))));
  fireEvent.click(await view.findByRole("button", { name: "Rename workflow" }));
  expect(await view.findByText("Changes need a fresh review")).toBeTruthy();
  expect(view.queryByRole("button", { name: "Rename workflow" })).toBeNull();
  expect(view.getByRole("button", { name: "Review graph again" })).toBeTruthy();
  expect(view.queryByText("Workflow renamed")).toBeNull();
});

it("does not claim completion when confirmed changes fail to reach the canvas", async () => {
  const plan = missingMediaPlan(); plan.validation = { valid: true, errors: [], warnings: [] };
  plan.graph_plan.operations = [{ op: "set_node_field", node_id: "person", fields: { resolution: "2K" } }];
  const apply = vi.fn(async () => { throw new Error("The source workflow changed while preparing the graph."); });
  let releaseProgress!: (response: Response) => void;
  const progress = new Promise<Response>(resolve => { releaseProgress = resolve; });
  const view = await review(plan, plan.workflow, apply, progress);
  const sessionFetch = globalThis.fetch;
  vi.stubGlobal("fetch", vi.fn((url: string) => url.endsWith("/apply")
    ? json({ ...plan, plan: { ...plan.plan, status: "applied" } })
    : sessionFetch(url)));
  // Complete the background session refresh after installing the approval response.
  await act(async () => { releaseProgress(await json(assistantIdleProgress)); });
  fireEvent.click(await view.findByRole("button", { name: "Apply node changes" }));
  expect(await view.findByText("Approved graph needs placement")).toBeTruthy();
  expect(view.getByRole("button", { name: "Place approved graph on canvas" })).toBeTruthy();
  expect(view.getByText("Approved; awaiting placement")).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Added graph status" })).toBeNull();
});
