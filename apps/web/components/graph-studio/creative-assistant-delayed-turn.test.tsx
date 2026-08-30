// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { CreativeAssistantPanel } from "./creative-assistant-panel";
import { useCreativeAssistant } from "./hooks/use-creative-assistant";
import {
  assistantJsonResponse as jsonResponse,
  assistantTestSession as session,
  assistantTestWorkflow as workflow,
} from "./creative-assistant-test-fixtures";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.localStorage?.clear?.();
});

it("uses one natural-language composer without legacy mode controls", async () => {
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    if (url.includes("/media/assistant/sessions?")) return jsonResponse({ items: [] });
    if (url.endsWith("/media/assistant/sessions")) return jsonResponse({ ...session, messages: [] });
    return Promise.resolve(new Response("not found", { status: 404 }));
  }));

  render(
    <CreativeAssistantPanel
      open
      workspaceKey="tab-one-composer"
      workflowId="workflow-1"
      workflowName="Assistant Graph"
      workflow={workflow}
      references={[]}
      importImageFile={vi.fn()}
      onApplyWorkflow={vi.fn()}
      onClose={vi.fn()}
    />,
  );

  expect(screen.queryByRole("group", { name: "Assistant mode" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Media Presets" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Recipes" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Graph", exact: true })).toBeNull();
  expect(screen.getByRole("textbox", { name: /assistant message/i }).getAttribute("placeholder")).toBe(
    "Describe what you want to create, change, or understand.",
  );
});

function PlanCancellationHarness() {
  const assistant = useCreativeAssistant({
    workspaceKey: "tab-plan-cancel-retry",
    workflowId: "workflow-1",
    workflowName: "Assistant Graph",
    workflow,
    enabled: true,
    initialAssistantSessionId: "session-1",
    importImageFile: vi.fn(),
    onApplyWorkflow: vi.fn(),
  });
  return (
    <div>
      <button type="button" onClick={() => void assistant.createPlanFromContent("Build the next graph section.")}>Start plan</button>
      {assistant.busy ? <button type="button" onClick={() => void assistant.cancelAssistant()}>Stop plan</button> : null}
      <button type="button" disabled={assistant.busy}>Start another turn</button>
      <span>{assistant.status}</span>
      <span>{assistant.progress?.label}</span>
      {assistant.error ? <p>{assistant.error}</p> : null}
    </div>
  );
}

it("shows Stop only after a first-use session has a real cancellation target", async () => {
  let resolveSession: ((response: Response) => void) | undefined;
  const delayedSession = new Promise<Response>((resolve) => {
    resolveSession = resolve;
  });
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    if (url.includes("/media/assistant/sessions?")) return jsonResponse({ items: [] });
    if (url.endsWith("/media/assistant/sessions")) return delayedSession;
    if (url.endsWith("/media/assistant/sessions/session-1/messages")) return new Promise<Response>(() => {});
    return Promise.resolve(new Response("not found", { status: 404 }));
  }));

  render(
    <CreativeAssistantPanel
      open
      workspaceKey="tab-delayed-session-target"
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
    target: { value: "Help me build the next graph section." },
  });
  fireEvent.click(screen.getByRole("button", { name: /send chat message/i }));

  expect(screen.queryByRole("button", { name: /stop assistant request/i })).toBeNull();
  await act(async () => {
    resolveSession?.(jsonResponse({ ...session, messages: [] }));
    await Promise.resolve();
  });
  await waitFor(() => expect(screen.getByRole("button", { name: /stop assistant request/i })).toBeTruthy());
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

it("keeps the scrollable Assistant body pinned while opening, typing, and receiving a reply", async () => {
  let resolveMessage: ((response: Response) => void) | undefined;
  const delayedMessage = new Promise<Response>((resolve) => {
    resolveMessage = resolve;
  });
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    if (url.includes("/media/assistant/sessions?")) return jsonResponse({ items: [] });
    if (url.endsWith("/media/assistant/sessions")) return jsonResponse({ ...session, messages: [] });
    if (url.endsWith("/media/assistant/sessions/session-1/messages")) return delayedMessage;
    return Promise.resolve(new Response("not found", { status: 404 }));
  }));
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(900);

  const { container, rerender } = render(
    <CreativeAssistantPanel
      open={false}
      workspaceKey="tab-scroll-latest"
      workflowId="workflow-1"
      workflowName="Assistant Graph"
      workflow={workflow}
      references={[]}
      importImageFile={vi.fn()}
      onApplyWorkflow={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  rerender(
    <CreativeAssistantPanel
      open
      workspaceKey="tab-scroll-latest"
      workflowId="workflow-1"
      workflowName="Assistant Graph"
      workflow={workflow}
      references={[]}
      importImageFile={vi.fn()}
      onApplyWorkflow={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  const scrollContainer = container.querySelector(".graph-assistant-body") as HTMLElement;
  await waitFor(() => expect(scrollContainer.scrollTop).toBe(900));
  scrollContainer.scrollTop = 0;

  const composer = screen.getByRole("textbox", { name: /assistant message/i });
  fireEvent.change(composer, { target: { value: "Keep the newest reply visible." } });
  await waitFor(() => expect(scrollContainer.scrollTop).toBe(900));

  fireEvent.click(screen.getByRole("button", { name: /send chat message/i }));
  scrollContainer.scrollTop = 0;
  resolveMessage?.(jsonResponse({
    ...session,
    messages: [{
      assistant_message_id: "message-scroll-success",
      assistant_session_id: "session-1",
      role: "assistant",
      content_text: "The newest reply should remain visible.",
      content_json: { mode: "assistant_kernel" },
    }],
  }));

  await waitFor(() => expect(scrollContainer.scrollTop).toBe(900));

  rerender(
    <CreativeAssistantPanel
      open={false}
      workspaceKey="tab-scroll-latest"
      workflowId="workflow-1"
      workflowName="Assistant Graph"
      workflow={workflow}
      references={[]}
      importImageFile={vi.fn()}
      onApplyWorkflow={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  rerender(
    <CreativeAssistantPanel
      open
      workspaceKey="tab-scroll-latest"
      workflowId="workflow-1"
      workflowName="Assistant Graph"
      workflow={workflow}
      references={[]}
      importImageFile={vi.fn()}
      onApplyWorkflow={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  const reopenedScrollContainer = container.querySelector(".graph-assistant-body") as HTMLElement;
  await waitFor(() => expect(reopenedScrollContainer.scrollTop).toBe(900));
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
  await waitFor(() => expect(screen.getByRole("button", { name: /stop assistant request/i })).toBeTruthy());
  expect(container.querySelector(".graph-assistant-message-thinking")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: /stop assistant request/i }));

  await waitFor(() => expect(container.querySelector(".graph-assistant-message-thinking")).toBeNull());
});

it("keeps Stop retryable while the server is still unwinding the turn", async () => {
  const delayedMessage = new Promise<Response>(() => {});
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    if (url.includes("/media/assistant/sessions?")) return jsonResponse({ items: [] });
    if (url.endsWith("/media/assistant/sessions")) return jsonResponse({ ...session, messages: [] });
    if (url.endsWith("/media/assistant/sessions/session-1/messages")) return delayedMessage;
    if (url.endsWith("/media/assistant/sessions/session-1/cancel")) {
      return Promise.resolve(new Response(
        JSON.stringify({ detail: "The assistant is still stopping. Try again in a moment." }),
        { status: 409, headers: { "content-type": "application/json" } },
      ));
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  }));

  render(
    <CreativeAssistantPanel
      open
      workspaceKey="tab-progress-cancel-retry"
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
  await waitFor(() => expect(screen.getByRole("button", { name: /stop assistant request/i })).toBeTruthy());

  fireEvent.click(screen.getByRole("button", { name: /stop assistant request/i }));

  await waitFor(() => expect(screen.getByText(/still stopping/i)).toBeTruthy());
  expect(screen.getByRole("button", { name: /stop assistant request/i })).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox", { name: /assistant message/i }), {
    target: { value: "Try another request too early." },
  });
  expect(screen.getByRole("button", { name: /send chat message/i }).hasAttribute("disabled")).toBe(true);
});

it("keeps a non-chat plan cancellation retryable while the server unwinds", async () => {
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    if (url.includes("/media/assistant/sessions?")) return jsonResponse({ items: [] });
    if (url.endsWith("/media/assistant/sessions/session-1")) return jsonResponse({ ...session, messages: [] });
    if (url.endsWith("/media/assistant/sessions/session-1/plans")) {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          setTimeout(() => reject(new DOMException("The operation was aborted.", "AbortError")), 25);
        });
      });
    }
    if (url.endsWith("/media/assistant/sessions/session-1/progress")) {
      return jsonResponse({
        active: true,
        stage: "thinking",
        label: "Thinking through your request…",
        elapsed_seconds: 7,
      });
    }
    if (url.endsWith("/media/assistant/sessions/session-1/cancel")) {
      return Promise.resolve(new Response(
        JSON.stringify({ detail: "The assistant is still stopping. Try again in a moment." }),
        { status: 409, headers: { "content-type": "application/json" } },
      ));
    }
    if (url.endsWith("/health")) return jsonResponse({});
    return Promise.resolve(new Response("not found", { status: 404 }));
  }));

  render(<PlanCancellationHarness />);
  fireEvent.click(screen.getByRole("button", { name: "Start plan" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Stop plan" })).toBeTruthy());
  await waitFor(() => expect(screen.getByText("Thinking through your request…")).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Stop plan" }));

  await waitFor(() => expect(screen.getByText(/still stopping/i)).toBeTruthy());
  await act(async () => new Promise((resolve) => setTimeout(resolve, 40)));
  expect(screen.getByText("cancelling")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Stop plan" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Start another turn" }).hasAttribute("disabled")).toBe(true);
});

it("keeps a complex assistant turn connected beyond the former browser cutoff", async () => {
  vi.useFakeTimers();
  let resolveMessage: ((response: Response) => void) | undefined;
  let messageSignal: AbortSignal | undefined;
  let attachMessageSignal: ((signal: AbortSignal | undefined) => void) | undefined;
  const delayedMessage = new Promise<Response>((resolve, reject) => {
    resolveMessage = resolve;
    attachMessageSignal = (signal: AbortSignal | undefined) => {
      messageSignal = signal;
      signal?.addEventListener("abort", () => {
        reject(new DOMException("The operation was aborted.", "AbortError"));
      });
    };
  });
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    if (url.includes("/media/assistant/sessions?")) return jsonResponse({ items: [] });
    if (url.endsWith("/media/assistant/sessions")) return jsonResponse({ ...session, messages: [] });
    if (url.endsWith("/media/assistant/sessions/session-1/messages")) {
      attachMessageSignal?.(init?.signal);
      return delayedMessage;
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  }));

  const { container } = render(
    <CreativeAssistantPanel
      open
      workspaceKey="tab-long-complex-turn"
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
    target: { value: "Develop this complex story into a production plan." },
  });
  fireEvent.click(screen.getByRole("button", { name: /send chat message/i }));
  await act(async () => Promise.resolve());
  await act(async () => Promise.resolve());

  await act(async () => vi.advanceTimersByTimeAsync(219_999));
  expect(messageSignal?.aborted).toBe(false);
  expect(container.querySelector(".graph-assistant-message-thinking")).toBeTruthy();

  await act(async () => {
    resolveMessage?.(jsonResponse({
      ...session,
      messages: [{
        assistant_message_id: "message-long-success",
        assistant_session_id: "session-1",
        role: "assistant",
        content_text: "The detailed production plan is ready.",
        content_json: { mode: "assistant_kernel" },
      }],
    }));
    await Promise.resolve();
  });

  expect(screen.getByText("The detailed production plan is ready.")).toBeTruthy();
  expect(container.querySelector(".graph-assistant-message-thinking")).toBeNull();
});

it("ends a lost assistant request at the documented browser ceiling", async () => {
  vi.useFakeTimers();
  let messageSignal: AbortSignal | undefined;
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    if (url.includes("/media/assistant/sessions?")) return jsonResponse({ items: [] });
    if (url.endsWith("/media/assistant/sessions")) return jsonResponse({ ...session, messages: [] });
    if (url.endsWith("/media/assistant/sessions/session-1/messages")) {
      messageSignal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        messageSignal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  }));

  render(
    <CreativeAssistantPanel
      open
      workspaceKey="tab-browser-ceiling"
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
    target: { value: "Develop this complex story into a production plan." },
  });
  fireEvent.click(screen.getByRole("button", { name: /send chat message/i }));
  await act(async () => Promise.resolve());
  await act(async () => Promise.resolve());

  await act(async () => vi.advanceTimersByTimeAsync(219_999));
  expect(messageSignal?.aborted).toBe(false);
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(messageSignal?.aborted).toBe(true);
});

it("shows elapsed time and completed typed milestones during a live turn", async () => {
  vi.useFakeTimers();
  const delayedMessage = new Promise<Response>(() => {});
  let progressCalls = 0;
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    if (url.includes("/media/assistant/sessions?")) return jsonResponse({ items: [] });
    if (url.endsWith("/media/assistant/sessions")) return jsonResponse({ ...session, messages: [] });
    if (url.endsWith("/media/assistant/sessions/session-1/messages")) return delayedMessage;
    if (url.endsWith("/media/assistant/sessions/session-1/progress")) {
      progressCalls += 1;
      return jsonResponse(progressCalls === 1
        ? {
            active: true,
            stage: "thinking",
            label: "Thinking through your request…",
            elapsed_seconds: 4,
          }
        : progressCalls === 2 ? {
            active: true,
            stage: "tool",
            label: "Checked your graph",
            elapsed_seconds: 12,
          }
        : {
            active: true,
            stage: "tool",
            label: "Checked your graph",
            elapsed_seconds: 130,
          });
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  }));

  const { container } = render(
    <CreativeAssistantPanel
      open
      workspaceKey="tab-truthful-progress"
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
    target: { value: "Review the current graph before proposing the next step." },
  });
  fireEvent.click(screen.getByRole("button", { name: /send chat message/i }));
  await act(async () => Promise.resolve());
  await act(async () => vi.advanceTimersByTimeAsync(1));

  expect(container.querySelector(".graph-assistant-message-thinking")?.textContent).toContain(
    "Thinking through your request… 4 seconds elapsed. No graph changes or runs have happened yet.",
  );

  await act(async () => vi.advanceTimersByTimeAsync(2_000));
  expect(container.querySelector(".graph-assistant-message-thinking")?.textContent).toContain(
    "Checked your graph · 12 seconds elapsed. Continuing…",
  );

  await act(async () => vi.advanceTimersByTimeAsync(2_000));
  expect(container.querySelector(".graph-assistant-message-thinking")?.textContent).toContain(
    "Checked your graph · 130 seconds elapsed. This is taking longer than usual, but it is still working. You can stop it at any time.",
  );
});
