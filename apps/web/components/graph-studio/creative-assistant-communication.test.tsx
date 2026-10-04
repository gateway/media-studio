// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CreativeAssistantPanel } from "./creative-assistant-panel";
import { assistantIdleProgress, assistantSessionResponse, assistantJsonResponse as json, assistantTestSession as session, assistantTestWorkflow as workflow } from "./creative-assistant-test-fixtures";
import type { AssistantPlanResponse, AssistantProgress } from "./types";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
function panel() {
  return render(<CreativeAssistantPanel open workspaceKey="communication" workflowId="workflow-1" workflowName="Graph"
    workflow={workflow} references={[]} importImageFile={vi.fn()} onApplyWorkflow={vi.fn()} onClose={vi.fn()} />);
}
async function send() {
  fireEvent.change(screen.getByRole("textbox", { name: /assistant message/i }), { target: { value: "Change only the resolution." } });
  await act(async () => Promise.resolve());
  fireEvent.click(screen.getByRole("button", { name: /send chat message/i }));
}

it.each(["thinking", "tool", "compacting"] as const)("retains confirmed work on failed %s polling, recovers without resending, and finishes", async (stage) => {
  vi.useFakeTimers();
  let resolveMessage!: (response: Response) => void;
  const message = new Promise<Response>((resolve) => { resolveMessage = resolve; });
  let polls = 0;
  const fetch = vi.fn((url: string) => {
    if (url.includes("/sessions?")) return json({ items: [] });
    if (url.endsWith("/sessions")) return json({ ...session, messages: [] });
    if (url.endsWith("/messages")) return message;
    if (url.endsWith("/progress")) {
      polls += 1;
      if (polls === 2 || polls === 3) return Promise.reject(new Error("offline"));
      return json({ active: true, stage, label: stage === "tool" ? "Checked your graph" : "Continuing your request…",
        elapsed_seconds: polls === 1 ? 12 : 30, last_milestone: "Checked your graph" } satisfies AssistantProgress);
    }
    return json({ ready: true });
  });
  vi.stubGlobal("fetch", fetch);
  panel(); await send();
  await act(async () => vi.advanceTimersByTimeAsync(1));
  const status = () => screen.getByRole("status", { name: "Assistant progress" }).textContent;
  expect(status()).toMatch(/last confirmed: checked your graph/i);
  await act(async () => vi.advanceTimersByTimeAsync(2_000));
  expect(status()).toMatch(/status unavailable.*may still be working.*last status received.*last confirmed/i);
  expect(status()).not.toMatch(/completed|finished|percent|compaction/i);
  await act(async () => vi.advanceTimersByTimeAsync(2_000));
  expect(status()).toMatch(/4 seconds ago/i);
  expect(screen.getByRole("button", { name: /stop assistant request/i })).toBeTruthy();
  await act(async () => vi.advanceTimersByTimeAsync(2_000));
  expect(status()).not.toMatch(/unavailable/i);
  expect(status()).toMatch(/30 seconds elapsed.*last confirmed/i);
  await act(async () => { resolveMessage(await json({ ...session, messages: [{ assistant_message_id: "reply", role: "assistant", content_text: "Resolution change prepared for review." }] })); });
  expect(screen.queryByRole("status", { name: "Assistant progress" })).toBeNull();
  expect(screen.getByText(/resolution change prepared/i)).toBeTruthy();
  expect(fetch.mock.calls.filter(([url]) => url.endsWith("/messages"))).toHaveLength(1);
});

it("shows unavailable status even before the first successful poll and resets on Stop", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    if (url.includes("/sessions?")) return json({ items: [] });
    if (url.endsWith("/sessions")) return json({ ...session, messages: [] });
    if (url.endsWith("/messages")) return new Promise<Response>(() => {});
    if (url.endsWith("/progress")) return Promise.reject(new Error("offline"));
    if (url.endsWith("/cancel")) return json({ ...session, messages: [] });
    return json({ ...session, messages: [] });
  }));
  panel(); await send();
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(screen.getByRole("status", { name: "Assistant progress" }).textContent).toMatch(/status unavailable/i);
  expect(screen.getByRole("status", { name: "Assistant progress" }).textContent).not.toMatch(/last confirmed|seconds ago/i);
  await act(async () => Promise.resolve());
  fireEvent.click(screen.getByRole("button", { name: /stop assistant request/i }));
  await act(async () => Promise.resolve());
  expect(screen.queryByRole("status", { name: "Assistant progress" })).toBeNull();
});

it("prioritizes stopping over a previously successful progress poll", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    if (url.includes("/sessions?")) return json({ items: [] });
    if (url.endsWith("/sessions")) return json({ ...session, messages: [] });
    if (url.endsWith("/messages") || url.endsWith("/cancel")) return new Promise<Response>(() => {});
    if (url.endsWith("/progress")) return json({ active: true, stage: "tool", label: "Checked your graph", elapsed_seconds: 30 });
    return json({ ...session, messages: [] });
  }));
  panel(); await send();
  await act(async () => vi.advanceTimersByTimeAsync(1));
  await act(async () => Promise.resolve());
  fireEvent.click(screen.getByRole("button", { name: /stop assistant request/i }));
  expect(screen.getByRole("status", { name: "Assistant progress" }).textContent).toMatch(/stopping/i);
  expect(screen.getByRole("status", { name: "Assistant progress" }).textContent).not.toMatch(/continuing|last confirmed/i);
});

it.each([false, true])("keeps narrow edit prepared/applied wording distinct (applied=%s) without inviting refinement", async (applied) => {
  const plan: AssistantPlanResponse = {
    plan: { assistant_plan_id: "edit", assistant_session_id: "session-1", status: applied ? "applied" : "validated", capability: "plan_graph" },
    graph_plan: { capability: "plan_graph", summary: "", questions: [], operations: [{ op: "set_node_field", node_id: "image", field: "resolution", value: "2K" }], warnings: [], requires_confirmation: true, metadata: {} },
    workflow, validation: { valid: true, errors: [], warnings: [] }, pricing: { pricing_summary: { total: { estimated_credits: 8, estimated_cost_usd: 0.08 } }, nodes: {}, warnings: [] },
  };
  vi.stubGlobal("fetch", vi.fn((url: string) => url.endsWith("/progress") ? json(assistantIdleProgress) : (url.includes("/sessions?") || url.endsWith("/session-1"))
    ? assistantSessionResponse(url, { ...session, messages: [], latest_plan: plan }) : json({ ready: true })));
  panel();
  await act(async () => Promise.resolve());
  const review = screen.getByRole("region", { name: applied ? "Added graph status" : "Graph review" });
  expect(review.textContent).toMatch(applied ? /updated on the canvas/i : /prepared for review/i);
  expect(review.textContent).not.toMatch(/want.*adjust|refine|should we/i);
  if (!applied) expect(review.textContent).not.toMatch(/updated.*canvas/i);
});

it("waits for the final reply after the server reports idle without claiming completion", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    if (url.includes("/sessions?")) return json({ items: [] });
    if (url.endsWith("/sessions")) return json({ ...session, messages: [] });
    if (url.endsWith("/messages")) return new Promise<Response>(() => {});
    if (url.endsWith("/progress")) return json({ active: false, stage: "idle", label: "", elapsed_seconds: 0 });
    return json({ ready: true });
  }));
  panel(); await send();
  await act(async () => vi.advanceTimersByTimeAsync(1));
  const status = screen.getByRole("status", { name: "Assistant progress" }).textContent;
  expect(status).toMatch(/waiting.*reply/i);
  expect(status).not.toMatch(/thinking|continuing|completed|finished/i);
});

it("does not describe an earlier run confirmation as waiting for the user while a new turn is working", async () => {
  vi.useFakeTimers();
  const existing = { ...session, messages: [{ assistant_message_id: "run", role: "assistant", content_text: "Run review ready.", content_json: {
    mode: "assistant_kernel", next_action: { kind: "run_workflow", label: "Review and run", requires_confirmation: true, confirmation_token: "token", payload: { confirmation_token: "token" }, price_estimate: { pricing_summary: { total: { estimated_credits: 8, estimated_cost_usd: 0.08 }, has_unknown_pricing: false } } },
  } }] };
  let sending = false;
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    if ((url.includes("/sessions?") || url.endsWith("/session-1"))) return assistantSessionResponse(url, existing);
    if (url.endsWith("/messages")) { sending = true; return new Promise<Response>(() => {}); }
    if (url.endsWith("/progress")) return sending ? json({ active: true, stage: "thinking", label: "Thinking through your request…", elapsed_seconds: 1 }) : json(assistantIdleProgress);
    return json({ ready: true });
  }));
  render(<CreativeAssistantPanel open workspaceKey="communication-run" workflowId="workflow-1" workflowName="Graph"
    workflow={workflow} references={[]} importImageFile={vi.fn()} onApplyWorkflow={vi.fn()} onRunWorkflow={vi.fn()} onClose={vi.fn()} />);
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(screen.getByRole("region", { name: "Graph run confirmation" }).textContent).toMatch(/waiting for your confirmation/i);
  await send();
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(screen.queryByRole("region", { name: "Graph run confirmation" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Review and run" })).toBeNull();
});

it("scopes applied-graph run wording to the application event, allowing earlier run history", async () => {
  const plan: AssistantPlanResponse = {
    plan: { assistant_plan_id: "applied", assistant_session_id: "session-1", status: "applied", capability: "plan_graph" },
    graph_plan: { capability: "plan_graph", summary: "", questions: [], operations: [{ op: "add_node", node_type: "prompt.text" }], warnings: [], requires_confirmation: true, metadata: {} },
    workflow, validation: { valid: true, errors: [], warnings: [] }, pricing: { pricing_summary: { total: {} }, nodes: {}, warnings: [] },
  };
  vi.stubGlobal("fetch", vi.fn((url: string) => url.endsWith("/progress") ? json(assistantIdleProgress) : (url.includes("/sessions?") || url.endsWith("/session-1"))
    ? assistantSessionResponse(url, { ...session, messages: [], latest_plan: plan }) : json({ ready: true })));
  panel();
  await act(async () => Promise.resolve());
  const copy = screen.getByRole("region", { name: "Added graph status" }).textContent;
  expect(copy).toMatch(/changes are on the canvas.*applying them did not start a run/i);
  expect(copy).not.toMatch(/nothing has run|want.*adjust|should we/i);
});
