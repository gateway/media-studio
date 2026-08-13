// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
