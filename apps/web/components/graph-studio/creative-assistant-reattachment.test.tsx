// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CreativeAssistantPanel } from "./creative-assistant-panel";
import { useCreativeAssistant } from "./hooks/use-creative-assistant";
import { assistantJsonResponse as json, assistantTestSession as session, assistantTestWorkflow as workflow } from "./creative-assistant-test-fixtures";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const saved = { ...session, messages: [{ assistant_message_id: "user", role: "user" as const, content_text: "Audit my graph." }] };
const finished = { ...saved, messages: [...saved.messages, { assistant_message_id: "reply", role: "assistant" as const, content_text: "The saved graph is unchanged." }] };
const active = { active: true, stage: "thinking", label: "Checking your graph", elapsed_seconds: 12, last_milestone: "Read the graph" };
const idle = { active: false, stage: "idle", label: "", elapsed_seconds: 0 };
const props = { workspaceKey: "A", workflowId: "workflow-1", workflowName: "Graph", workflow, enabled: true,
  initialAssistantSessionId: "session-1", importImageFile: vi.fn(), onApplyWorkflow: vi.fn() };
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
function deferred() {
  let resolve!: (value: Response) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Response>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

it("reattaches an active saved turn, blocks sends, and refreshes its terminal transcript once without replay", async () => {
  vi.useFakeTimers(); let polls = 0; let reads = 0;
  const finalRead = deferred();
  const fetch = vi.fn((url: string) => {
    if (url.endsWith("/progress")) return json(++polls === 1 ? active : idle);
    if (url.endsWith("/session-1")) return ++reads === 1 ? json(saved) : finalRead.promise;
    return json({ ready: true });
  });
  vi.stubGlobal("fetch", fetch);
  const { result } = renderHook(() => useCreativeAssistant(props)); await settle();
  expect(result.current.busy).toBe(true); expect(result.current.cancellable).toBe(true);
  await act(async () => { await result.current.sendContentMessage("Do not replay."); });
  expect(fetch.mock.calls.some(([url]) => url.endsWith("/messages"))).toBe(false);
  await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
  expect(result.current.busy).toBe(true); expect(result.current.progress?.active).toBe(false);
  await act(async () => { finalRead.resolve(await json(finished)); });
  expect(result.current.busy).toBe(false);
  expect(result.current.session?.messages.map(m => m.assistant_message_id)).toEqual(["user", "reply"]);
  await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
  expect(reads).toBe(2); expect(polls).toBe(2);
});

it("refreshes a turn that completes between hydration and the first progress read", async () => {
  vi.useFakeTimers(); let reads = 0;
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    if (url.endsWith("/progress")) return json(idle);
    if (url.endsWith("/session-1")) return json(++reads === 1 ? saved : finished);
    return json({ ready: true });
  }));
  const { result } = renderHook(() => useCreativeAssistant(props)); await settle();
  expect(result.current.busy).toBe(false); expect(reads).toBe(2);
  expect(result.current.session?.messages.at(-1)?.content_text).toBe(finished.messages.at(-1)?.content_text);
});

it("does not claim completion for a saved unanswered message with inactive tracking", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn((url: string) => json(url.endsWith("/progress") ? idle : url.endsWith("/session-1") ? saved : { ready: true }));
  vi.stubGlobal("fetch", fetch);
  const { result } = renderHook(() => useCreativeAssistant(props)); await settle();
  expect(result.current.busy).toBe(false); expect(result.current.session?.messages).toEqual(saved.messages);
  expect(fetch.mock.calls.some(([url]) => url.endsWith("/messages"))).toBe(false);
});

it("keeps uncertain attachment busy through failed polls and reconciles after final-refresh failure", async () => {
  vi.useFakeTimers(); let polls = 0; let reads = 0;
  const fetch = vi.fn((url: string) => {
    if (url.endsWith("/progress")) return ++polls === 1 ? Promise.reject(new Error("offline")) : json(idle);
    if (url.endsWith("/session-1")) return ++reads === 2 ? Promise.reject(new Error("refresh failed")) : json(reads === 1 ? saved : finished);
    return json({ ready: true });
  });
  vi.stubGlobal("fetch", fetch);
  const { result } = renderHook(() => useCreativeAssistant(props)); await settle();
  expect(result.current.busy).toBe(true); expect(result.current.progressUnavailable).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
  expect(result.current.busy).toBe(true); expect(result.current.session?.messages).toEqual(saved.messages);
  await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
  expect(result.current.busy).toBe(false); expect(result.current.session?.messages).toEqual(finished.messages);
  expect(fetch.mock.calls.some(([url]) => url.endsWith("/messages"))).toBe(false);
});

it("restores Stop for an attached turn and cancels only its session", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn((url: string) => json(url.endsWith("/progress") ? active : url.endsWith("/session-1") || url.endsWith("/cancel") ? saved : { ready: true }));
  vi.stubGlobal("fetch", fetch);
  render(<CreativeAssistantPanel open {...props} references={[]} onClose={vi.fn()} />); await settle();
  expect(screen.getByRole("status", { name: "Assistant progress" }).textContent).toMatch(/last confirmed: read the graph/i);
  fireEvent.click(screen.getByRole("button", { name: "Stop assistant request" })); await settle();
  expect(fetch.mock.calls.filter(([url]) => url.endsWith("/cancel")).map(([url]) => url)).toEqual(["/api/control/media/assistant/sessions/session-1/cancel"]);
  expect(screen.queryByRole("button", { name: "Stop assistant request" })).toBeNull();
});

it.each(["hydration", "progress", "terminal refresh", "cancel"])("ignores an old workspace's late %s response", async (stage) => {
  vi.useFakeTimers(); const late = deferred(); let reads = 0;
  const other = { ...session, assistant_session_id: "session-2", owner_id: "workflow-2", messages: [] };
  const fetch = vi.fn((url: string) => {
    if (url.endsWith("/session-1")) {
      reads += 1;
      return (stage === "hydration" || (stage === "terminal refresh" && reads === 2)) ? late.promise : json(saved);
    }
    if (url.endsWith("/session-2")) return json(other);
    if (url.endsWith("session-1/progress")) return stage === "progress" ? late.promise : json(stage === "terminal refresh" ? idle : active);
    if (url.endsWith("/progress")) return json(idle);
    if (url.endsWith("/cancel")) return late.promise;
    return json({ ready: true });
  });
  vi.stubGlobal("fetch", fetch);
  const { result, rerender } = renderHook(p => useCreativeAssistant(p), { initialProps: props }); await settle();
  if (stage === "cancel") act(() => { void result.current.cancelAssistant(); });
  rerender({ ...props, workspaceKey: "B", workflowId: "workflow-2", initialAssistantSessionId: "session-2" }); await settle();
  await act(async () => { late.resolve(await json(stage === "progress" ? active : finished)); });
  expect(result.current.session?.assistant_session_id).toBe("session-2");
  expect(result.current.session?.messages).toEqual([]); expect(result.current.busy).toBe(false);
});

it("ignores aborted hydration even when returning to the same workspace before it resolves", async () => {
  vi.useFakeTimers(); const late = deferred(); let reads = 0;
  const current = { ...session, messages: [{ assistant_message_id: "current", role: "assistant" as const, content_text: "Current hydration" }] };
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    if (url.endsWith("/session-1")) return ++reads === 1 ? late.promise : json(current);
    if (url.endsWith("/progress")) return json(idle);
    if (url.endsWith("/session-2")) return json({ ...session, assistant_session_id: "session-2", messages: [] });
    return json({ ready: true });
  }));
  const { result, rerender } = renderHook(p => useCreativeAssistant(p), { initialProps: props }); await settle();
  rerender({ ...props, workspaceKey: "B", workflowId: "workflow-2", initialAssistantSessionId: "session-2" }); await settle();
  rerender(props); await settle();
  await act(async () => { late.resolve(await json(saved)); });
  expect(result.current.session?.messages).toEqual(current.messages);
});

it("does not clear reattached work when an old aborted send rejects after navigating away and back", async () => {
  vi.useFakeTimers(); const message = deferred(); let starts = 0;
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    if (url.endsWith("/session-1")) return json(saved);
    if (url.endsWith("/session-2")) return json({ ...session, assistant_session_id: "session-2", owner_id: "workflow-2", messages: [] });
    if (url.endsWith("/messages")) return message.promise;
    if (url.endsWith("session-1/progress")) return json(starts ? active : idle);
    if (url.endsWith("/progress")) return json(idle);
    return json({ ready: true });
  }));
  const { result, rerender } = renderHook(p => useCreativeAssistant(p), { initialProps: props }); await settle();
  starts = 1;
  act(() => { void result.current.sendContentMessage("Read only."); }); await settle();
  rerender({ ...props, workspaceKey: "B", workflowId: "workflow-2", initialAssistantSessionId: "session-2" }); await settle();
  rerender(props); await settle();
  expect(result.current.busy).toBe(true);
  await act(async () => { message.reject(new DOMException("Old transport stopped", "AbortError")); });
  expect(result.current.busy).toBe(true); expect(result.current.cancellable).toBe(true);
});

it.each([404, 410])("reports an unavailable saved session (%s) without starting replacement work", async (status) => {
  vi.useFakeTimers();
  const fetch = vi.fn((url: string) => url.endsWith("/session-1")
    ? Promise.resolve(new Response(JSON.stringify({ detail: "Saved session unavailable." }), { status }))
    : json({ ready: true }));
  vi.stubGlobal("fetch", fetch);
  const { result } = renderHook(() => useCreativeAssistant(props)); await settle();
  expect(result.current.busy).toBe(false); expect(result.current.session).toBeNull();
  expect(result.current.error).toMatch(/unavailable/i);
  expect(fetch.mock.calls.some(([url]) => url.endsWith("/messages") || url.endsWith("/sessions"))).toBe(false);
});

it("loads archived transcript history without inventing an active turn or resending", async () => {
  vi.useFakeTimers(); const archived = { ...finished, status: "archived" };
  const fetch = vi.fn((url: string) => json(url.endsWith("/progress") ? idle : url.endsWith("/session-1") ? archived : { ready: true }));
  vi.stubGlobal("fetch", fetch);
  const { result } = renderHook(() => useCreativeAssistant(props)); await settle();
  expect(result.current.busy).toBe(false); expect(result.current.cancellable).toBe(false);
  expect(result.current.session?.status).toBe("archived");
  expect(fetch.mock.calls.some(([url]) => url.endsWith("/messages"))).toBe(false);
});

it.each(["active", "terminal refresh"])("attaches only the requested session when its identity changes within the same workspace (%s)", async (stage) => {
  vi.useFakeTimers(); const late = deferred(); const nextHydration = deferred(); let reads = 0;
  const other = { ...saved, assistant_session_id: "session-2", messages: [] };
  const published = vi.fn();
  const fetch = vi.fn((url: string) => {
    if (url.endsWith("/session-1")) return ++reads === 1 ? json(saved) : late.promise;
    if (url.endsWith("session-1/progress")) return stage === "active" ? late.promise : json(idle);
    if (url.endsWith("/session-2")) return nextHydration.promise.then(response => response.clone());
    if (url.endsWith("session-2/progress")) return json(active);
    if (url.endsWith("/cancel")) return json(other);
    return json({ ready: true });
  });
  vi.stubGlobal("fetch", fetch);
  const { result, rerender } = renderHook(p => useCreativeAssistant(p), {
    initialProps: { ...props, onAssistantSessionChange: published },
  }); await settle(); published.mockClear();
  rerender({ ...props, initialAssistantSessionId: "session-2", onAssistantSessionChange: published }); await settle();
  expect(result.current.busy).toBe(true); expect(result.current.cancellable).toBe(false);
  await act(async () => { late.resolve(await json(stage === "active" ? idle : finished)); });
  expect(result.current.busy).toBe(true);
  expect(published).not.toHaveBeenCalledWith("session-1");
  await act(async () => { nextHydration.resolve(await json(other)); }); await settle();
  expect(result.current.session?.assistant_session_id).toBe("session-2");
  expect(result.current.busy).toBe(true); expect(result.current.cancellable).toBe(true);
  expect(result.current.progress).toEqual(active);
  expect(fetch.mock.calls.some(([url]) => url.endsWith("/messages"))).toBe(false);
  await act(async () => { await result.current.cancelAssistant(); });
  expect(fetch.mock.calls.filter(([url]) => url.endsWith("/cancel")).map(([url]) => url)).toEqual(["/api/control/media/assistant/sessions/session-2/cancel"]);
});
