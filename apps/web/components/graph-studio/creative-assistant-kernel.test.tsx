// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { CreativeAssistantPanel } from "./creative-assistant-panel";
import type { AssistantPlanResponse } from "./types";
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

const plan: AssistantPlanResponse = {
  plan: {
    assistant_plan_id: "plan-1",
    assistant_session_id: "session-1",
    status: "validated",
    capability: "plan_graph",
  },
  graph_plan: {
    capability: "plan_graph",
    summary: "Graph proposal",
    questions: [],
    operations: [{ op: "add_node" }],
    warnings: [],
    requires_confirmation: true,
    metadata: { kernel_proposal: true },
  },
  workflow: {
    ...workflow,
    nodes: [{ id: "prompt", type: "prompt.text", position: { x: 0, y: 0 }, fields: { text: "Create an image" } }],
  },
  validation: { valid: true, errors: [], warnings: [] },
  pricing: { pricing_summary: { total: { estimated_credits: 0, estimated_cost_usd: 0 } }, nodes: {}, warnings: [] },
};

it("renders and applies only the kernel-owned graph confirmation", async () => {
  const onApplyWorkflow = vi.fn();
  const fetchMock = vi.fn((url: string) => {
    if (url.includes("/media/assistant/sessions?")) return jsonResponse({ items: [] });
    if (url.endsWith("/media/assistant/sessions")) return jsonResponse({ ...session, messages: [] });
    if (url.endsWith("/media/assistant/sessions/session-1/messages")) {
      return jsonResponse({
        ...session,
        messages: [{
          assistant_message_id: "message-assistant-kernel",
          assistant_session_id: "session-1",
          role: "assistant",
          content_text: "Graph proposal ready.",
          content_json: {
            mode: "assistant_kernel",
            next_action: {
              kind: "confirm_graph",
              label: "Add to canvas",
              proposal_id: "plan-1",
              confirmation_token: "confirm-token-1",
              requires_confirmation: true,
              payload: {
                proposal_id: "plan-1",
                confirmation_token: "confirm-token-1",
              },
            },
          },
        }],
        latest_plan: plan,
      });
    }
    if (url.endsWith("/media/assistant/plans/plan-1/apply")) {
      return jsonResponse({ ...plan, plan: { ...plan.plan, status: "applied" } });
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  });
  vi.stubGlobal("fetch", fetchMock);

  render(
    <CreativeAssistantPanel
      open
      workspaceKey="tab-1"
      workflowId="workflow-1"
      workflowName="Assistant Graph"
      workflow={workflow}
      references={[]}
      importImageFile={vi.fn()}
      onApplyWorkflow={onApplyWorkflow}
      onClose={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByRole("textbox", { name: /assistant message/i }), {
    target: { value: "Build a small image graph." },
  });
  fireEvent.click(screen.getByRole("button", { name: /send chat message/i }));

  await waitFor(() => expect(screen.getByRole("button", { name: "Add to canvas" })).toBeTruthy());
  expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/plans"))).toBe(false);
  expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/apply"))).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Add to canvas" }));

  await waitFor(() => expect(onApplyWorkflow).toHaveBeenCalled());
  const applyCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/media/assistant/plans/plan-1/apply"));
  expect(JSON.parse(String(applyCall?.[1]?.body))).toMatchObject({
    workflow,
    proposal_id: "plan-1",
    confirmation_token: "confirm-token-1",
  });
});

it("requests a text-to-image model when wiring a saved Prompt Recipe", async () => {
  const savedRecipeMessage = {
    assistant_message_id: "message-recipe-saved",
    assistant_session_id: "session-1",
    role: "system_summary",
    content_text: "Saved the confirmed assistant artifact.",
    content_json: {
      activity_kind: "prompt_recipe_saved",
      saved_artifact: {
        kind: "prompt_recipe",
        id: "recipe-1",
        key: "storyboard_prompt_writer",
        label: "Storyboard Prompt Writer",
      },
    },
  };
  const fetchMock = vi.fn((url: string) => {
    if (url.includes("/media/assistant/sessions?")) {
      return jsonResponse({ items: [{ ...session, messages: [savedRecipeMessage] }] });
    }
    if (url.endsWith("/media/assistant/sessions/session-1/plans")) return jsonResponse(plan);
    if (url.endsWith("/media/assistant/sessions/session-1")) {
      return jsonResponse({ ...session, messages: [savedRecipeMessage], latest_plan: plan });
    }
    return jsonResponse({});
  });
  vi.stubGlobal("fetch", fetchMock);

  render(
    <CreativeAssistantPanel
      open
      workspaceKey="tab-saved-recipe"
      workflowId="workflow-1"
      workflowName="Assistant Graph"
      workflow={workflow}
      references={[]}
      importImageFile={vi.fn()}
      onApplyWorkflow={vi.fn()}
      onClose={vi.fn()}
    />,
  );

  fireEvent.click(await screen.findByRole("button", { name: "Use Storyboard Prompt Writer in this graph" }));
  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/plans"))).toBe(true));
  const planCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/plans"));
  const request = JSON.parse(String(planCall?.[1]?.body));
  expect(request.message).toContain("Storyboard Prompt Writer");
  expect(request.message).toContain("text-to-image model");
  expect(request.workflow.nodes).toHaveLength(0);
});

it("saves a kernel preset only after the user clicks its server-owned confirmation", async () => {
  const assistantMessage = {
    assistant_message_id: "message-preset-kernel",
    assistant_session_id: "session-1",
    role: "assistant",
    content_text: "The validated preset draft is ready.",
    content_json: {
      mode: "assistant_kernel",
      next_action: {
        kind: "save_media_preset",
        label: "Save verified preset",
        proposal_id: "aspreset-1",
        confirmation_token: "preset-token-1",
        requires_confirmation: true,
        payload: {
          proposal_id: "aspreset-1",
          confirmation_token: "preset-token-1", quality_state: "quality_verified", save_mode: "verified",
        },
      },
    },
  };
  const fetchMock = vi.fn((url: string) => {
    if (url.includes("/media/assistant/sessions?")) return jsonResponse({ items: [] });
    if (url.endsWith("/media/assistant/sessions")) return jsonResponse({ ...session, messages: [] });
    if (url.endsWith("/media/assistant/sessions/session-1/messages")) {
      return jsonResponse({
        ...session,
        messages: [assistantMessage],
        summary_json: { kernel_preset_proposal: { proposal_id: "aspreset-1", consumed: false } },
      });
    }
    if (url.endsWith("/media/assistant/sessions/session-1/preset-saves")) {
      return jsonResponse({
        capability: "save_media_preset",
        artifact_kind: "media_preset",
        created: true,
        record: { preset_id: "preset-1", key: "amber-board", label: "Amber Board" },
        message: "Preset saved.",
        assistant_session: {
          ...session,
          messages: [assistantMessage],
          summary_json: { kernel_preset_proposal: { proposal_id: "aspreset-1", consumed: true } },
        },
      });
    }
    return jsonResponse({});
  });
  vi.stubGlobal("fetch", fetchMock);

  render(
    <CreativeAssistantPanel
      open
      workspaceKey="tab-preset"
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
    target: { value: "Save this preset." },
  });
  fireEvent.click(screen.getByRole("button", { name: /send chat message/i }));

  await waitFor(() => expect(screen.getByRole("button", { name: "Save confirmed Media Preset" })).toBeTruthy());
  expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/preset-saves"))).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Save confirmed Media Preset" }));

  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/preset-saves"))).toBe(true));
  const saveCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/preset-saves"));
  expect(JSON.parse(String(saveCall?.[1]?.body))).toMatchObject({
    proposal_id: "aspreset-1",
    confirmation_token: "preset-token-1",
  });
  await waitFor(() => expect(screen.queryByRole("button", { name: "Save confirmed Media Preset" })).toBeNull());
});

it("does not offer primary preset save for an applied graph without quality proof", async () => {
  const appliedPlan: AssistantPlanResponse = { ...plan, plan: { ...plan.plan, status: "applied", applied_workflow_id: "workflow-1" } };
  const fetchMock = vi.fn((url: string) => {
    if (url.includes("/media/assistant/sessions?")) {
      return jsonResponse({ items: [{ ...session, messages: [], latest_plan: appliedPlan }] });
    }
    return jsonResponse({});
  });
  vi.stubGlobal("fetch", fetchMock);

  render(
    <CreativeAssistantPanel
      open
      workspaceKey="tab-unverified-preset"
      workflowId="workflow-1"
      workflowName="Assistant Graph"
      workflow={workflow}
      references={[]}
      importImageFile={vi.fn()}
      onApplyWorkflow={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Media Presets" }));
  await waitFor(() => expect(screen.getByLabelText("Added graph status")).toBeTruthy());
  expect(screen.queryByText("Save as preset")).toBeNull();
});

it("saves a kernel recipe only after the user clicks its server-owned confirmation", async () => {
  const assistantMessage = {
    assistant_message_id: "message-recipe-kernel",
    assistant_session_id: "session-1",
    role: "assistant",
    content_text: "The validated recipe draft is ready.",
    content_json: {
      mode: "assistant_kernel",
      next_action: {
        kind: "save_prompt_recipe",
        label: "Save recipe",
        proposal_id: "asrecipe-1",
        confirmation_token: "recipe-token-1",
        requires_confirmation: true,
        payload: {
          proposal_id: "asrecipe-1",
          confirmation_token: "recipe-token-1",
        },
      },
    },
  };
  const fetchMock = vi.fn((url: string) => {
    if (url.includes("/media/assistant/sessions?")) return jsonResponse({ items: [] });
    if (url.endsWith("/media/assistant/sessions")) return jsonResponse({ ...session, messages: [] });
    if (url.endsWith("/media/assistant/sessions/session-1/messages")) {
      return jsonResponse({
        ...session,
        messages: [assistantMessage],
        summary_json: { kernel_recipe_proposal: { proposal_id: "asrecipe-1", consumed: false } },
      });
    }
    if (url.endsWith("/media/assistant/sessions/session-1/recipe-saves")) {
      return jsonResponse({
        capability: "save_prompt_recipe",
        artifact_kind: "prompt_recipe",
        created: true,
        record: { recipe_id: "recipe-1", key: "storyboard-writer", label: "Storyboard Writer" },
        message: "Recipe saved.",
        assistant_session: {
          ...session,
          messages: [assistantMessage],
          summary_json: { kernel_recipe_proposal: { proposal_id: "asrecipe-1", consumed: true } },
        },
      });
    }
    return jsonResponse({});
  });
  vi.stubGlobal("fetch", fetchMock);

  render(
    <CreativeAssistantPanel
      open
      workspaceKey="tab-recipe"
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
    target: { value: "Save this recipe." },
  });
  fireEvent.click(screen.getByRole("button", { name: /send chat message/i }));

  await waitFor(() => expect(screen.getByRole("button", { name: "Save confirmed Prompt Recipe" })).toBeTruthy());
  expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/recipe-saves"))).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Save confirmed Prompt Recipe" }));

  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/recipe-saves"))).toBe(true));
  const saveCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/recipe-saves"));
  expect(JSON.parse(String(saveCall?.[1]?.body))).toMatchObject({
    proposal_id: "asrecipe-1",
    confirmation_token: "recipe-token-1",
  });
  await waitFor(() => expect(screen.queryByRole("button", { name: "Save confirmed Prompt Recipe" })).toBeNull());
});

it("runs only after the user clicks the typed kernel action", async () => {
  const onRunWorkflow = vi.fn().mockResolvedValue({ run_id: "graph-run-1" });
  const fetchMock = vi.fn((url: string) => {
    if (url.includes("/media/assistant/sessions?")) return jsonResponse({ items: [] });
    if (url.endsWith("/media/assistant/sessions")) return jsonResponse({ ...session, messages: [] });
    if (url.endsWith("/media/assistant/sessions/session-1/messages")) {
      return jsonResponse({
        ...session,
        messages: [{
          assistant_message_id: "message-run-kernel",
          assistant_session_id: "session-1",
          role: "assistant",
          content_text: "The graph can be started after you approve it.",
          content_json: {
            mode: "assistant_kernel",
            next_action: {
              kind: "run_workflow",
              label: "Review and run",
              confirmation_token: "run-token-1",
              requires_confirmation: true,
              payload: {
                confirmation_token: "run-token-1",
                workflow_fingerprint: "workflow-fingerprint-1",
              },
            },
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
      workspaceKey="tab-run"
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
  fireEvent.change(screen.getByRole("textbox", { name: /assistant message/i }), {
    target: { value: "Run it" },
  });
  fireEvent.click(screen.getByRole("button", { name: /send chat message/i }));

  await waitFor(() => expect(screen.getByRole("button", { name: "Review and run" })).toBeTruthy());
  expect(onRunWorkflow).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Review and run" }));
  await waitFor(() => expect(onRunWorkflow).toHaveBeenCalledWith({
    sessionId: "session-1",
    token: "run-token-1",
  }));
  expect(screen.queryByRole("button", { name: "Review and run" })).toBeNull();
  expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/run-confirmations"))).toBe(false);
});

it("preserves kernel reply markdown and renders only safe typed tool activity", async () => {
  const reply = "Opening **note**.\n\n- First item\n- *Second item*\n\nThe sandbox term stays visible.";
  const fetchMock = vi.fn((url: string) => {
    if (url.includes("/media/assistant/sessions?")) {
      return jsonResponse({
        items: [{
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
    if (url.includes("/media/assistant/sessions?")) {
      return jsonResponse({
        items: [{
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
        }],
      });
    }
    return jsonResponse({});
  });
  vi.stubGlobal("fetch", fetchMock);

  render(
    <CreativeAssistantPanel
      open
      workspaceKey={`tab-no-action-${reply.length}`}
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
  fireEvent.click(screen.getByRole("button", { name: "Media Presets" }));
  expect(screen.queryByRole("button", { name: "Review and run" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Run it" })).toBeNull();
  expect(onRunWorkflow).not.toHaveBeenCalled();
});
