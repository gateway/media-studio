// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CreativeAssistantPanel } from "./creative-assistant-panel";
import { assistantIdleProgress as idle, assistantJsonResponse as json, assistantTestSession as session, assistantTestWorkflow as workflow } from "./creative-assistant-test-fixtures";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const health = { codex_local_ready: true, codex_local_command_available: true, codex_local_login_configured: true };
const props = { open: true, workspaceKey: "A", workflowId: null, workflowName: "Fresh A", workflow,
  references: [], importImageFile: vi.fn(), onApplyWorkflow: vi.fn(), onClose: vi.fn() };
function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>(done => { resolve = done; });
  return { promise, resolve };
}

it("does not submit stale content after leaving and returning while a new session is being created", async () => {
  const creating = deferred();
  const fresh = { ...session, owner_kind: "standalone", owner_id: null, messages: [] };
  const fetch = vi.fn((url: string) => {
    if (url.endsWith("/health")) return json(health);
    if (url.endsWith("/sessions")) return creating.promise;
    if (url.endsWith("/progress")) return json(idle);
    if (url.endsWith("/messages")) return json({ ...fresh, messages: [{ assistant_message_id: "stale", role: "assistant", content_text: "Stale A request was submitted." }] });
    return json(fresh);
  });
  vi.stubGlobal("fetch", fetch);
  const { rerender } = render(<CreativeAssistantPanel {...props} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Assistant message" }), { target: { value: "Original A request" } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Send chat message" }).hasAttribute("disabled")).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Send chat message" }));
  await waitFor(() => expect(fetch.mock.calls.some(([url]) => url.endsWith("/sessions"))).toBe(true));
  rerender(<CreativeAssistantPanel {...props} workspaceKey="B" workflowName="Fresh B" />);
  rerender(<CreativeAssistantPanel {...props} />);
  await act(async () => { creating.resolve(await json(fresh)); });
  expect(fetch.mock.calls.filter(([url]) => url.endsWith("/messages"))).toHaveLength(0);
  expect(screen.queryByText("Stale A request was submitted.")).toBeNull();
});

it("explains background ownership for a confirmed active turn and keeps another workspace isolated", async () => {
  const activeA = { ...session, messages: [{ assistant_message_id: "a-user", role: "user", content_text: "Read fresh A only." }] };
  const other = { ...session, assistant_session_id: "session-2", messages: [] };
  const fetch = vi.fn((url: string) => {
    if (url.endsWith("/health")) return json(health);
    if (url.endsWith("session-1/progress")) return json({ ...idle, active: true, stage: "thinking", label: "Checking fresh A" });
    if (url.endsWith("/progress")) return json(idle);
    return json(url.endsWith("/session-1") ? activeA : other);
  });
  vi.stubGlobal("fetch", fetch);
  const { rerender } = render(<CreativeAssistantPanel {...props} initialAssistantSessionId="session-1" />);
  await waitFor(() => expect(screen.getByRole("status", { name: "Assistant progress" }).textContent).toContain("Switching workflows keeps this request running here."));
  expect(screen.getByRole("button", { name: "Stop assistant request" })).toBeTruthy();
  rerender(<CreativeAssistantPanel {...props} workspaceKey="B" workflowName="Fresh B" initialAssistantSessionId="session-2" />);
  await waitFor(() => expect(screen.queryByRole("status", { name: "Assistant progress" })).toBeNull());
  expect(screen.queryByText("Read fresh A only.")).toBeNull();
  expect(fetch.mock.calls.some(([url]) => url.endsWith("/cancel") || url.endsWith("/messages"))).toBe(false);
});

it("reattaches to submitted A work after rapid switches and shows its final reply without replay or applying it", async () => {
  vi.useFakeTimers();
  const message = deferred(); let accepted = false; let completed = false;
  const user = { assistant_message_id: "a-user", role: "user", content_text: "Read A without changes." };
  const reply = { assistant_message_id: "a-reply", role: "assistant", content_text: "A completed without graph changes.", content_json: { mode: "assistant_kernel", next_action: { kind: "none" } } };
  const fetch = vi.fn((url: string) => {
    if (url.endsWith("/health")) return json(health);
    if (url.endsWith("/messages")) { accepted = true; return message.promise; }
    if (url.endsWith("session-1/progress")) return json({ ...idle, active: accepted && !completed, stage: accepted && !completed ? "thinking" : "idle", label: accepted && !completed ? "Checking A" : "" });
    if (url.endsWith("/progress")) return json(idle);
    return json(url.endsWith("/session-1") ? { ...session, messages: completed ? [user, reply] : accepted ? [user] : [] } : { ...session, assistant_session_id: "session-2", messages: [] });
  });
  vi.stubGlobal("fetch", fetch);
  const apply = vi.fn();
  const { rerender } = render(<CreativeAssistantPanel {...props} onApplyWorkflow={apply} initialAssistantSessionId="session-1" />);
  const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
  await settle();
  fireEvent.change(screen.getByRole("textbox", { name: "Assistant message" }), { target: { value: "Read A without changes." } });
  fireEvent.click(screen.getByRole("button", { name: "Send chat message" })); await settle();
  const showB = () => rerender(<CreativeAssistantPanel {...props} onApplyWorkflow={apply} workspaceKey="B" workflowName="Fresh B" initialAssistantSessionId="session-2" />);
  const showA = () => rerender(<CreativeAssistantPanel {...props} onApplyWorkflow={apply} initialAssistantSessionId="session-1" />);
  showB(); await settle(); showA(); await settle(); showB(); await settle();
  expect(screen.queryByText("Read A without changes.")).toBeNull();
  completed = true;
  await act(async () => { message.resolve(await json({ ...session, messages: [user, reply] })); });
  expect(screen.queryByText("A completed without graph changes.")).toBeNull();
  showA(); await settle();
  expect(screen.getByText("A completed without graph changes.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Stop assistant request" })).toBeNull();
  expect(fetch.mock.calls.filter(([url]) => url.endsWith("/messages"))).toHaveLength(1);
  expect(fetch.mock.calls.some(([url]) => url.endsWith("/cancel"))).toBe(false);
  expect(apply).not.toHaveBeenCalled();
});


it.each(["success", "failure", "return-to-A", "canvas-completion"])("keeps late Apply %s owned by its original operation", async (outcome) => {
  const applying = deferred(); const canvas = deferred();
  const plan = { plan: { assistant_plan_id: "plan-1", assistant_session_id: "session-1", status: "validated", capability: "plan_graph" },
    graph_plan: { capability: "plan_graph", summary: "Add a note to A", operations: [{ op: "add_node" }], questions: [], warnings: [], requires_confirmation: true, metadata: { kernel_proposal: true } },
    workflow: { ...workflow, nodes: [{ id: "note", type: "prompt.text", position: { x: 0, y: 0 }, fields: { text: "A note" } }] }, validation: { valid: true, errors: [], warnings: [] }, pricing: { pricing_summary: { total: {} }, nodes: {}, warnings: [] } };
  const proposal = { assistant_message_id: "proposal", role: "assistant", content_text: "A graph ready.", content_json: { mode: "assistant_kernel", next_action: { kind: "confirm_graph", label: "Add to canvas", requires_confirmation: true, proposal_id: "plan-1", confirmation_token: "token", payload: { confirmation_token: "token" } } } };
  let monitoring = false;
  const fetch = vi.fn((url: string) => {
    if (url.endsWith("/health")) return json(health);
    if (url.endsWith("/apply")) return applying.promise;
    if (url.endsWith("/progress")) return json({ ...idle, active: monitoring, stage: monitoring ? "thinking" : "idle", label: monitoring ? "Owned request in progress" : "" });
    if (url.endsWith("/session-1")) return json({ ...session, messages: [proposal], latest_plan: plan });
    return json({ ...session, assistant_session_id: "session-2", messages: [{ assistant_message_id: "b-user", role: "user", content_text: "B is working." }] });
  });
  vi.stubGlobal("fetch", fetch);
  const event = vi.fn(); const apply = vi.fn(() => canvas.promise.then(() => undefined));
  const panel = { ...props, workflowId: "workflow-1", initialAssistantSessionId: "session-1", onEvent: event, onApplyWorkflow: apply };
  const { rerender } = render(<CreativeAssistantPanel {...panel} />);
  const applyButton = await screen.findByRole("button", { name: "Add to canvas" });
  await waitFor(() => expect(applyButton.hasAttribute("disabled")).toBe(false));
  fireEvent.click(applyButton);
  await waitFor(() => expect(fetch.mock.calls.some(([url]) => url.endsWith("/apply"))).toBe(true));
  if (outcome === "canvas-completion") {
    await act(async () => { applying.resolve(await json(plan)); });
    await waitFor(() => expect(apply).toHaveBeenCalledOnce());
  }
  monitoring = true;
  rerender(<CreativeAssistantPanel {...panel} workspaceKey="B" initialAssistantSessionId="session-2" />);
  await screen.findByRole("button", { name: "Stop assistant request" });
  if (outcome === "return-to-A") {
    rerender(<CreativeAssistantPanel {...panel} />);
    await screen.findByRole("button", { name: "Stop assistant request" });
  }
  await act(async () => {
    if (outcome === "canvas-completion") canvas.resolve(await json({}));
    else applying.resolve(outcome === "failure" ? new Response(JSON.stringify({ detail: "Old A apply failed" }), { status: 500 }) : await json(plan));
  });
  expect(screen.getByRole("button", { name: "Stop assistant request" })).toBeTruthy();
  expect(screen.queryByText("Old A apply failed")).toBeNull();
  expect(event).not.toHaveBeenCalledWith("Assistant plan applied to the canvas.", "success");
  if (outcome !== "canvas-completion") expect(apply).not.toHaveBeenCalled();
});


it.each(["success", "failure", "return-to-A"])("keeps saved-artifact planning %s owned after navigation", async (outcome) => {
  const planning = deferred(); let monitoring = false;
  const saved = { assistant_message_id: "saved", role: "system_summary", content_text: "Saved recipe.", content_json: {
    activity_kind: "prompt_recipe_saved", saved_artifact: { kind: "prompt_recipe", id: "recipe-A", key: "fresh_A", label: "Fresh A Recipe" },
  } };
  const fetch = vi.fn((url: string) => {
    if (url.endsWith("/health")) return json(health);
    if (url.endsWith("/plans")) return planning.promise;
    if (url.endsWith("/progress")) return json({ ...idle, active: monitoring, stage: monitoring ? "thinking" : "idle", label: monitoring ? "Owned request in progress" : "" });
    return json({ ...session, assistant_session_id: url.endsWith("/session-1") ? "session-1" : "session-2", messages: url.endsWith("/session-1") ? [saved] : [] });
  });
  vi.stubGlobal("fetch", fetch); const event = vi.fn();
  const panel = { ...props, workflowId: "workflow-1", initialAssistantSessionId: "session-1", onEvent: event };
  const { rerender } = render(<CreativeAssistantPanel {...panel} />);
  const graphButton = await screen.findByRole("button", { name: "Create a clean graph with Fresh A Recipe" });
  await waitFor(() => expect(graphButton.hasAttribute("disabled")).toBe(false));
  fireEvent.click(graphButton);
  await waitFor(() => expect(fetch.mock.calls.some(([url]) => url.endsWith("/plans"))).toBe(true));
  monitoring = true;
  rerender(<CreativeAssistantPanel {...panel} workspaceKey="B" initialAssistantSessionId="session-2" />);
  await screen.findByRole("button", { name: "Stop assistant request" });
  if (outcome === "return-to-A") { rerender(<CreativeAssistantPanel {...panel} />); await screen.findByRole("button", { name: "Stop assistant request" }); }
  await act(async () => { planning.resolve(outcome === "failure" ? new Response(JSON.stringify({ detail: "Old A planning failed" }), { status: 500 }) : await json({})); });
  expect(screen.getByRole("button", { name: "Stop assistant request" })).toBeTruthy();
  expect(screen.queryByText("Old A planning failed")).toBeNull();
  expect(event).not.toHaveBeenCalledWith("Assistant planning stopped.", "muted");
  expect(props.onApplyWorkflow).not.toHaveBeenCalled();
});
