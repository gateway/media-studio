// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  window.localStorage?.clear?.();
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
