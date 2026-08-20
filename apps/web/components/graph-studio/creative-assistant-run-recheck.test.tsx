// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { CreativeAssistantPanel } from "./creative-assistant-panel";
import { JsonFetchError } from "./utils/graph-api";
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

it("offers a safe recheck after the graph changes without starting a run", async () => {
  const onRunWorkflow = vi.fn().mockRejectedValue(
    new JsonFetchError(
      "The graph changed after this run confirmation was prepared.",
      "workflow_fingerprint_mismatch",
    ),
  );
  const runSession = {
    ...session,
    messages: [{
      assistant_message_id: "message-run-confirmation",
      assistant_session_id: "session-1",
      role: "assistant",
      content_text: "The graph is ready for confirmation.",
      content_json: {
        mode: "assistant_kernel",
        next_action: {
          kind: "run_workflow",
          label: "Review and run",
          confirmation_token: "run-token-stale",
          requires_confirmation: true,
          payload: { confirmation_token: "run-token-stale" },
        },
      },
    }],
  };
  const fetchMock = vi.fn((url: string) => {
    if (url.includes("/media/assistant/sessions?")) return jsonResponse({ items: [runSession] });
    if (url.endsWith("/messages")) {
      return jsonResponse({
        ...runSession,
        messages: [{
          assistant_message_id: "message-rechecked",
          assistant_session_id: "session-1",
          role: "assistant",
          content_text: "The current graph has been checked again.",
          content_json: { mode: "assistant_kernel", next_action: { kind: "none" } },
        }],
      });
    }
    return jsonResponse({});
  });
  vi.stubGlobal("fetch", fetchMock);

  render(
    <CreativeAssistantPanel
      open
      workspaceKey="tab-stale-run"
      workflowId="workflow-1"
      workflowName="Preset test"
      workflow={workflow}
      references={[]}
      importImageFile={vi.fn()}
      onApplyWorkflow={vi.fn()}
      onRunWorkflow={onRunWorkflow}
      onClose={vi.fn()}
    />,
  );

  fireEvent.click(await screen.findByRole("button", { name: "Review and run" }));
  const recheck = await screen.findByRole("button", { name: "Recheck graph and pricing" });
  expect(onRunWorkflow).toHaveBeenCalledTimes(1);

  fireEvent.click(recheck);
  await waitFor(() => expect(screen.queryByRole("button", { name: "Recheck graph and pricing" })).toBeNull());
  expect(onRunWorkflow).toHaveBeenCalledTimes(1);
  const messageCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/messages"));
  expect(String(messageCall?.[1]?.body)).toContain("current graph");
});

it("keeps slow run progress distinct from assistant reasoning progress", async () => {
  let resolveRun: ((value: { run_id: string }) => void) | undefined;
  const onRunWorkflow = vi.fn(() => new Promise<{ run_id: string }>((resolve) => {
    resolveRun = resolve;
  }));
  const runSession = {
    ...session,
    messages: [{
      assistant_message_id: "message-slow-run-confirmation",
      assistant_session_id: "session-1",
      role: "assistant",
      content_text: "The graph is ready for confirmation.",
      content_json: {
        mode: "assistant_kernel",
        next_action: {
          kind: "run_workflow",
          label: "Review and run",
          confirmation_token: "run-token-slow",
          requires_confirmation: true,
          payload: { confirmation_token: "run-token-slow" },
        },
      },
    }],
  };
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    if (url.includes("/media/assistant/sessions?")) return jsonResponse({ items: [runSession] });
    return jsonResponse({});
  }));

  render(
    <CreativeAssistantPanel
      open
      workspaceKey="tab-slow-run"
      workflowId="workflow-1"
      workflowName="Preset test"
      workflow={workflow}
      references={[]}
      importImageFile={vi.fn()}
      onApplyWorkflow={vi.fn()}
      onRunWorkflow={onRunWorkflow}
      onClose={vi.fn()}
    />,
  );
  const runButton = await screen.findByRole("button", { name: "Review and run" });
  vi.useFakeTimers();
  fireEvent.click(runButton);

  const initialProgress = screen.getByRole("status", { name: "Assistant run progress" }).textContent;
  await act(async () => vi.advanceTimersByTime(30_000));
  expect(screen.getByRole("status", { name: "Assistant run progress" }).textContent).toBe(initialProgress);

  await act(async () => {
    resolveRun?.({ run_id: "graph-run-slow" });
    await Promise.resolve();
  });
  expect(screen.queryByRole("status", { name: "Assistant run progress" })).toBeNull();
});

it("does not let a run from the previous workflow clear the current assistant turn", async () => {
  let resolveRun: ((value: { run_id: string }) => void) | undefined;
  let resolveMessage: ((response: Response) => void) | undefined;
  const onRunWorkflow = vi.fn(() => new Promise<{ run_id: string }>((resolve) => {
    resolveRun = resolve;
  }));
  const delayedMessage = new Promise<Response>((resolve) => {
    resolveMessage = resolve;
  });
  const runSession = {
    ...session,
    messages: [{
      assistant_message_id: "message-navigation-run-confirmation",
      assistant_session_id: "session-1",
      role: "assistant",
      content_text: "The graph is ready for confirmation.",
      content_json: {
        mode: "assistant_kernel",
        next_action: {
          kind: "run_workflow",
          label: "Review and run",
          confirmation_token: "run-token-navigation",
          requires_confirmation: true,
          payload: { confirmation_token: "run-token-navigation" },
        },
      },
    }],
  };
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    if (url.includes("/media/assistant/sessions?")) return jsonResponse({ items: [runSession] });
    if (url.endsWith("/media/assistant/sessions/session-1/messages")) return delayedMessage;
    return jsonResponse({});
  }));
  const panel = (workspaceKey: string) => (
    <CreativeAssistantPanel
      open
      workspaceKey={workspaceKey}
      workflowId="workflow-1"
      workflowName="Preset test"
      workflow={workflow}
      references={[]}
      importImageFile={vi.fn()}
      onApplyWorkflow={vi.fn()}
      onRunWorkflow={onRunWorkflow}
      onClose={vi.fn()}
    />
  );
  const { rerender } = render(panel("tab-run-navigation-a"));
  fireEvent.click(await screen.findByRole("button", { name: "Review and run" }));
  expect(screen.getByRole("status", { name: "Assistant run progress" })).toBeTruthy();

  rerender(panel("tab-run-navigation-b"));
  await waitFor(() => expect(screen.queryByRole("status", { name: "Assistant run progress" })).toBeNull());
  fireEvent.change(screen.getByRole("textbox", { name: /assistant message/i }), {
    target: { value: "Help with this workflow instead." },
  });
  fireEvent.click(screen.getByRole("button", { name: /send chat message/i }));
  await waitFor(() => expect(screen.getByRole("status", { name: "Assistant progress" })).toBeTruthy());

  await act(async () => {
    resolveRun?.({ run_id: "graph-run-from-workflow-a" });
    await Promise.resolve();
  });
  expect(screen.getByRole("status", { name: "Assistant progress" })).toBeTruthy();

  await act(async () => {
    resolveMessage?.(jsonResponse({ ...runSession, messages: [] }));
    await Promise.resolve();
  });
});
