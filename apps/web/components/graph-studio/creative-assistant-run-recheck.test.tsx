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
          price_estimate: { pricing_summary: { total: { estimated_credits: 0, estimated_cost_usd: 0 } } },
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
          price_estimate: { pricing_summary: { total: { estimated_credits: 0, estimated_cost_usd: 0 } } },
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
  act(() => {
    runButton.click();
    runButton.click();
  });
  expect(onRunWorkflow).toHaveBeenCalledTimes(1);

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
          price_estimate: { pricing_summary: { total: { estimated_credits: 0, estimated_cost_usd: 0 } } },
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


it.each([
  { payload: { confirmation_token: "different-token" } },
  { payload: null },
  { label: null },
  { price_estimate: null },
])("shows a blocker instead of an unusable run action (%j)", async (invalidFields) => {
  const onRunWorkflow = vi.fn();
  const invalidSession = {
    ...session,
    messages: [{
      assistant_message_id: "message-invalid-run",
      assistant_session_id: "session-1",
      role: "assistant",
      content_text: "Ready for review.",
      content_json: {
        mode: "assistant_kernel",
        next_action: {
          kind: "run_workflow",
          price_estimate: { pricing_summary: { total: { estimated_credits: 0, estimated_cost_usd: 0 } } },
          label: "Review and run",
          confirmation_token: "current-token",
          requires_confirmation: true,
          payload: { confirmation_token: "current-token" },
          ...invalidFields,
        },
      },
    }],
  };
  vi.stubGlobal("fetch", vi.fn((url: string) => url.includes("/media/assistant/sessions?")
    ? jsonResponse({ items: [invalidSession] }) : jsonResponse({})));
  render(<CreativeAssistantPanel open workspaceKey="invalid-confirmation" workflowId="workflow-1"
    workflowName="Confirmation test" workflow={workflow} references={[]} importImageFile={vi.fn()}
    onApplyWorkflow={vi.fn()} onRunWorkflow={onRunWorkflow} onClose={vi.fn()} />);

  expect(await screen.findByRole("button", { name: "Recheck graph and pricing" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Review and run" })).toBeNull();
  expect(screen.getByText(/run confirmation is incomplete|estimate is unavailable/i)).toBeTruthy();
  expect(onRunWorkflow).not.toHaveBeenCalled();
});


it.each([
  { outcome: undefined, expected: /run outcome is unknown.*run history/i, runnable: false },
  { outcome: null, expected: /Run cancelled before spending credits/i, runnable: true },
])("distinguishes an unconfirmed launch from cancellation ($outcome)", async ({ outcome, expected, runnable }) => {
  const onRunWorkflow = vi.fn().mockResolvedValue(outcome);
  const runSession = {
    ...session,
    messages: [{
      assistant_message_id: "message-no-launch",
      assistant_session_id: "session-1", role: "assistant", content_text: "Ready for review.",
      content_json: { mode: "assistant_kernel", next_action: {
        kind: "run_workflow",
          price_estimate: { pricing_summary: { total: { estimated_credits: 0, estimated_cost_usd: 0 } } }, label: "Review and run", requires_confirmation: true,
        confirmation_token: "launch-token", payload: { confirmation_token: "launch-token" },
      } },
    }],
  };
  vi.stubGlobal("fetch", vi.fn((url: string) => url.includes("/media/assistant/sessions?")
    ? jsonResponse({ items: [runSession] }) : jsonResponse({})));
  render(<CreativeAssistantPanel open workspaceKey="missing-launch" workflowId="workflow-1"
    workflowName="Confirmation test" workflow={workflow} references={[]} importImageFile={vi.fn()}
    onApplyWorkflow={vi.fn()} onRunWorkflow={onRunWorkflow} onClose={vi.fn()} />);

  fireEvent.click(await screen.findByRole("button", { name: "Review and run" }));
  expect(await screen.findByText(expected)).toBeTruthy();
  expect(Boolean(screen.queryByRole("button", { name: "Recheck graph and pricing" }))).toBe(false);
  expect(Boolean(screen.queryByRole("button", { name: "Review and run" }))).toBe(runnable);
  expect(onRunWorkflow).toHaveBeenCalledTimes(1);
});
