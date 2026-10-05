// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { CreativeAssistantPanel } from "./creative-assistant-panel";
import {
  assistantIdleProgress, assistantSessionResponse, assistantJsonResponse as jsonResponse,
  assistantTestSession as session,
  assistantTestWorkflow as workflow,
} from "./creative-assistant-test-fixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage?.clear?.();
});

it("preserves kernel reply markdown and renders only safe typed tool activity", async () => {
  const reply = "Opening **note**.\n\n- First item\n- *Second item*\n\nThe sandbox term stays visible.";
  const fetchMock = vi.fn((url: string) => {
    if (url.endsWith("/progress")) return jsonResponse(assistantIdleProgress);
    if (url.includes("/media/assistant/sessions?") || url.endsWith("/media/assistant/sessions/session-1")) {
      return assistantSessionResponse(url, {
          ...session,
          messages: [{
            assistant_message_id: "message-markdown-kernel",
            assistant_session_id: "session-1",
            role: "assistant",
            content_text: reply,
            content_json: {
              mode: "assistant_kernel",
              next_action: { kind: "none", requires_confirmation: false },
              kernel_turn: {
                trace: {
                  tool_calls: [
                    {
                      tool_name: "propose_graph_operations",
                      activity: {
                        kind: "graph_proposal",
                        label: "Prepared a graph proposal",
                        tone: "success",
                      },
                    },
                    {
                      tool_name: "update_production_plan_step",
                      activity: {
                        kind: "production_plan",
                        label: "Updated the production plan",
                        tone: "error",
                      },
                    },
                  ],
                },
              },
            },
          }],
      });
    }
    return jsonResponse({});
  });
  vi.stubGlobal("fetch", fetchMock);

  const { container } = render(
    <CreativeAssistantPanel
      open
      workspaceKey="tab-markdown"
      workflowId="workflow-1"
      workflowName="Assistant Graph"
      workflow={workflow}
      references={[]}
      importImageFile={vi.fn()}
      onApplyWorkflow={vi.fn()}
      onClose={vi.fn()}
    />,
  );

  expect(await screen.findByText("Prepared a graph proposal")).toBeTruthy();
  expect(screen.queryByText("Updated the production plan")).toBeNull();
  expect(container.querySelectorAll(".graph-assistant-message-content p")).toHaveLength(2);
  expect(container.querySelectorAll(".graph-assistant-message-content li")).toHaveLength(2);
  expect(container.querySelector(".graph-assistant-message-content strong")?.textContent).toBe("note");
  expect(container.querySelector(".graph-assistant-message-content em")?.textContent).toBe("Second item");
  expect(screen.queryByText("propose_graph_operations")).toBeNull();
});

it.each([
  "I can run this graph whenever you are ready.",
  "Run the current workflow.",
])("does not infer a run control from kernel reply wording", async (reply) => {
  const onRunWorkflow = vi.fn();
  const fetchMock = vi.fn((url: string) => {
    if (url.endsWith("/progress")) return jsonResponse(assistantIdleProgress);
    if (url.includes("/media/assistant/sessions?") || url.endsWith("/media/assistant/sessions/session-1")) {
      return assistantSessionResponse(url, {
          ...session,
          messages: [{
            assistant_message_id: "message-no-action-kernel",
            assistant_session_id: "session-1",
            role: "assistant",
            content_text: reply,
            content_json: {
              mode: "assistant_kernel",
              next_action: { kind: "none", requires_confirmation: false },
            },
          }],
      });
    }
    return jsonResponse({});
  });
  vi.stubGlobal("fetch", fetchMock);

  render(
    <CreativeAssistantPanel
      open
      workspaceKey={"tab-no-action-" + reply.length}
      workflowId="workflow-1"
      workflowName="Assistant Graph"
      workflow={workflow}
      references={[]}
      importImageFile={vi.fn()}
      onApplyWorkflow={vi.fn()}
      onRunWorkflow={onRunWorkflow}
      onClose={vi.fn()}
    />,
  );

  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  expect(screen.queryByRole("group", { name: "Assistant mode" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Review and run" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Run it" })).toBeNull();
  expect(onRunWorkflow).not.toHaveBeenCalled();
});

it("renders a persisted requested image in its reply and focuses selection without editing or running", async () => {
  const binding = { run_id: "original-run", artifact_id: "original", version: "v1" };
  const image = { ...binding, node_title: "Original board", output_port: "image", output_index: 0, media_type: "image", available: true, url: "/original.png" };
  let selected = false;
  const onApplyWorkflow = vi.fn(); const onRunWorkflow = vi.fn();
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    if (url.endsWith("/progress")) return jsonResponse(assistantIdleProgress);
    if ((url.includes("/media/assistant/sessions?") || url.endsWith("/media/assistant/sessions/session-1"))) return assistantSessionResponse(url, { ...session, messages: [{
      assistant_message_id: "shown-original", assistant_session_id: "session-1", role: "assistant",
      content_text: "Here is the original.", content_json: { mode: "assistant_kernel", kernel_turn: { artifacts: [{ kind: "result_display", data: binding }] } },
    }] });
    if (url.includes("/results")) {
      if (init?.method === "POST") { expect(JSON.parse(String(init.body))).toEqual({ ...binding, selected: true }); selected = true; }
      return jsonResponse({ run_id: "original-run", status: "completed", items: [image], selected_artifact_ids: selected ? ["original"] : [], selected_result_bindings: selected ? { original: binding } : {} });
    }
    return jsonResponse({});
  }));
  render(<CreativeAssistantPanel open workspaceKey="requested-image" workflowId="workflow-1" workflowName="Current board" workflow={workflow}
    references={[]} importImageFile={vi.fn()} onApplyWorkflow={onApplyWorkflow} onRunWorkflow={onRunWorkflow} onClose={vi.fn()} />);
  expect(await screen.findByRole("region", { name: "Requested image" })).toBeTruthy();
  await act(async () => Promise.resolve());
  fireEvent.click(screen.getByRole("button", { name: "Use in chat — Original board" }));
  await screen.findByRole("button", { name: "In this conversation — Original board" });
  expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Assistant message" }));
  expect(onApplyWorkflow).not.toHaveBeenCalled(); expect(onRunWorkflow).not.toHaveBeenCalled();
});
