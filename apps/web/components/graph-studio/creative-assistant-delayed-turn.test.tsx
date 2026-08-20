// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { CreativeAssistantPanel } from "./creative-assistant-panel";
import {
  assistantJsonResponse as jsonResponse,
  assistantTestSession as session,
  assistantTestWorkflow as workflow,
} from "./creative-assistant-test-fixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.localStorage?.clear?.();
});

it("shows changing progress during a long assistant turn and resets it for a retry after failure", async () => {
  vi.useFakeTimers();
  let resolveMessage: ((response: Response) => void) | undefined;
  let resolveRetry: ((response: Response) => void) | undefined;
  const delayedMessage = new Promise<Response>((resolve) => {
    resolveMessage = resolve;
  });
  const delayedRetry = new Promise<Response>((resolve) => {
    resolveRetry = resolve;
  });
  let messageRequestCount = 0;
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    if (url.includes("/media/assistant/sessions?")) return jsonResponse({ items: [] });
    if (url.endsWith("/media/assistant/sessions")) return jsonResponse({ ...session, messages: [] });
    if (url.endsWith("/media/assistant/sessions/session-1/messages")) {
      messageRequestCount += 1;
      return messageRequestCount === 1 ? delayedMessage : delayedRetry;
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  }));

  const { container } = render(
    <CreativeAssistantPanel
      open
      workspaceKey="tab-progress-turn"
      workflowId="workflow-1"
      workflowName="Assistant Graph"
      workflow={workflow}
      references={[]}
      importImageFile={vi.fn()}
      onApplyWorkflow={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByRole("textbox", { name: /assistant message/i }), {
    target: { value: "Help me make this idea clearer." },
  });
  fireEvent.click(screen.getByRole("button", { name: /send chat message/i }));

  const startingText = container.querySelector(".graph-assistant-message-thinking")?.textContent;
  expect(startingText).toBeTruthy();
  await act(async () => vi.advanceTimersByTime(10_000));
  const reviewingText = container.querySelector(".graph-assistant-message-thinking")?.textContent;
  expect(reviewingText).toBeTruthy();
  expect(reviewingText).not.toBe(startingText);
  await act(async () => vi.advanceTimersByTime(20_000));
  const continuingText = container.querySelector(".graph-assistant-message-thinking")?.textContent;
  expect(continuingText).toBeTruthy();
  expect(continuingText).not.toBe(reviewingText);

  await act(async () => {
    resolveMessage?.(new Response(JSON.stringify({ detail: "Assistant request failed." }), {
      status: 500,
      headers: { "content-type": "application/json" },
    }));
    await Promise.resolve();
  });
  expect(container.querySelector(".graph-assistant-message-thinking")).toBeNull();

  fireEvent.change(screen.getByRole("textbox", { name: /assistant message/i }), {
    target: { value: "Please try that again." },
  });
  fireEvent.click(screen.getByRole("button", { name: /send chat message/i }));
  expect(container.querySelector(".graph-assistant-message-thinking")?.textContent).toBe(startingText);

  await act(async () => {
    resolveRetry?.(jsonResponse({
      ...session,
      messages: [{
        assistant_message_id: "message-progress-success",
        assistant_session_id: "session-1",
        role: "assistant",
        content_text: "I can help shape the idea and suggest the next useful choice.",
        content_json: { mode: "assistant_kernel" },
      }],
    }));
    await Promise.resolve();
  });

  expect(container.querySelector(".graph-assistant-message-thinking")).toBeNull();
});

it("clears its busy state when a delayed assistant turn completes without a refresh", async () => {
  let resolveMessage: ((response: Response) => void) | undefined;
  const delayedMessage = new Promise<Response>((resolve) => {
    resolveMessage = resolve;
  });
  const fetchMock = vi.fn((url: string) => {
    if (url.includes("/media/assistant/sessions?")) return jsonResponse({ items: [] });
    if (url.endsWith("/media/assistant/sessions")) return jsonResponse({ ...session, messages: [] });
    if (url.endsWith("/media/assistant/sessions/session-1/messages")) return delayedMessage;
    return Promise.resolve(new Response("not found", { status: 404 }));
  });
  vi.stubGlobal("fetch", fetchMock);

  const { container } = render(
    <CreativeAssistantPanel
      open
      workspaceKey="tab-delayed-turn"
      workflowId="workflow-1"
      workflowName="Assistant Graph"
      workflow={workflow}
      references={[]}
      importImageFile={vi.fn()}
      onApplyWorkflow={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByRole("textbox", { name: /assistant message/i }), {
    target: { value: "Help me make this idea clearer." },
  });
  fireEvent.click(screen.getByRole("button", { name: /send chat message/i }));

  await waitFor(() => expect(container.querySelector(".graph-assistant-message-thinking")).toBeTruthy());
  resolveMessage?.(jsonResponse({
    ...session,
    messages: [{
      assistant_message_id: "message-delayed-success",
      assistant_session_id: "session-1",
      role: "assistant",
      content_text: "I can help shape the idea and suggest the next useful choice.",
      content_json: { mode: "assistant_kernel" },
    }],
  }));

  await waitFor(() => expect(container.querySelector(".graph-assistant-message-thinking")).toBeNull());
  expect(container.querySelectorAll(".graph-assistant-message-assistant")).toHaveLength(1);
});

it("clears long-turn progress when the user changes workflows", async () => {
  vi.useFakeTimers();
  const delayedMessage = new Promise<Response>(() => {});
  const fetchMock = vi.fn((url: string) => {
    if (url.includes("/media/assistant/sessions?")) return jsonResponse({ items: [] });
    if (url.endsWith("/media/assistant/sessions")) return jsonResponse({ ...session, messages: [] });
    if (url.endsWith("/media/assistant/sessions/session-1/messages")) return delayedMessage;
    return Promise.resolve(new Response("not found", { status: 404 }));
  });
  vi.stubGlobal("fetch", fetchMock);

  const panel = (
    workspaceKey: string,
  ) => (
    <CreativeAssistantPanel
      open
      workspaceKey={workspaceKey}
      workflowId="workflow-1"
      workflowName="Assistant Graph"
      workflow={workflow}
      references={[]}
      importImageFile={vi.fn()}
      onApplyWorkflow={vi.fn()}
      onClose={vi.fn()}
    />
  );
  const { container, rerender } = render(panel("tab-progress-navigation-a"));
  fireEvent.change(screen.getByRole("textbox", { name: /assistant message/i }), {
    target: { value: "Help me make this idea clearer." },
  });
  fireEvent.click(screen.getByRole("button", { name: /send chat message/i }));
  await act(async () => vi.advanceTimersByTime(10_000));
  expect(container.querySelector(".graph-assistant-message-thinking")).toBeTruthy();

  rerender(panel("tab-progress-navigation-b"));
  await act(async () => Promise.resolve());

  expect(container.querySelector(".graph-assistant-message-thinking")).toBeNull();
});

it("clears progress when the user stops an assistant turn", async () => {
  const delayedMessage = new Promise<Response>(() => {});
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    if (url.includes("/media/assistant/sessions?")) return jsonResponse({ items: [] });
    if (url.endsWith("/media/assistant/sessions")) return jsonResponse({ ...session, messages: [] });
    if (url.endsWith("/media/assistant/sessions/session-1/messages")) return delayedMessage;
    if (url.endsWith("/media/assistant/sessions/session-1/cancel")) return jsonResponse({ ...session, messages: [] });
    return Promise.resolve(new Response("not found", { status: 404 }));
  }));

  const { container } = render(
    <CreativeAssistantPanel
      open
      workspaceKey="tab-progress-cancel"
      workflowId="workflow-1"
      workflowName="Assistant Graph"
      workflow={workflow}
      references={[]}
      importImageFile={vi.fn()}
      onApplyWorkflow={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByRole("textbox", { name: /assistant message/i }), {
    target: { value: "Help me make this idea clearer." },
  });
  fireEvent.click(screen.getByRole("button", { name: /send chat message/i }));
  await waitFor(() => expect(container.querySelector(".graph-assistant-message-thinking")).toBeTruthy());

  fireEvent.click(screen.getByRole("button", { name: /stop assistant request/i }));

  await waitFor(() => expect(container.querySelector(".graph-assistant-message-thinking")).toBeNull());
});
