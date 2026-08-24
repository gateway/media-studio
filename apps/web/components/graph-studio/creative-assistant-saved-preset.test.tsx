// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    summary: "Saved preset graph proposal",
    questions: [],
    operations: [{ op: "add_node" }],
    warnings: [],
    requires_confirmation: true,
    metadata: { kernel_proposal: true },
  },
  workflow: {
    ...workflow,
    nodes: [{ id: "preset", type: "preset.render", position: { x: 0, y: 0 }, fields: { preset_id: "preset-1" } }],
  },
  validation: { valid: true, errors: [], warnings: [] },
  pricing: { pricing_summary: { total: { estimated_credits: 6, estimated_cost_usd: 0.03 } }, nodes: {}, warnings: [] },
};

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
      key: "storyboard_writer",
      label: "Storyboard Writer",
    },
  },
};

const savedRecipeGraphRequestMessage = {
  assistant_message_id: "message-graph-request",
  assistant_session_id: "session-1",
  role: "user",
  content_text: "Create a clean replacement workflow that uses the saved Prompt Recipe named Storyboard Writer with exact id recipe-1 and key storyboard_writer, then sends the rendered prompt into a compatible text-to-image model with preview and save image nodes.",
  content_json: {},
};

const clarificationMessage = {
  assistant_message_id: "message-clarification",
  assistant_session_id: "session-1",
  role: "assistant",
  content_text: "Which sample values should the graph use for Story Beat and Mood?",
  content_json: {
    mode: "assistant_kernel",
    next_action: { kind: "none", requires_confirmation: false },
  },
};

it("passes exact preset identity and usable field values into saved-preset graph planning", async () => {
  const savedPresetMessage = {
    assistant_message_id: "message-preset-saved",
    assistant_session_id: "session-1",
    role: "system_summary",
    content_text: "Saved the confirmed assistant artifact.",
    content_json: {
      activity_kind: "media_preset_saved",
      saved_artifact: {
        kind: "media_preset",
        id: "preset-1",
        key: "navy_field_guide",
        label: "Navy Field Guide",
      },
    },
  };
  const priorKernelMessage = {
    assistant_message_id: "message-prior-kernel",
    assistant_session_id: "session-1",
    role: "assistant",
    content_text: "The previous request ended without a graph proposal.",
    content_json: {
      mode: "assistant_kernel",
      next_action: { kind: "none", requires_confirmation: false },
    },
  };
  const confirmedPlanMessage = {
    assistant_message_id: "message-confirmed-plan",
    assistant_session_id: "session-1",
    role: "assistant",
    content_text: "The saved-preset graph is ready for review.",
    content_json: {
      mode: "assistant_kernel",
      next_action: {
        kind: "confirm_graph",
        label: "Add to canvas",
        proposal_id: "plan-1",
        confirmation_token: "confirm-plan-1",
        requires_confirmation: true,
        payload: {
          proposal_id: "plan-1",
          confirmation_token: "confirm-plan-1",
        },
      },
    },
  };
  const onApplyWorkflow = vi.fn();
  const fetchMock = vi.fn((url: string) => {
    if (url.includes("/media/assistant/sessions?")) {
      return jsonResponse({ items: [{ ...session, messages: [savedPresetMessage, priorKernelMessage] }] });
    }
    if (url.endsWith("/media/assistant/sessions/session-1/plans")) return jsonResponse(plan);
    if (url.endsWith("/media/assistant/sessions/session-1")) {
      return jsonResponse({
        ...session,
        messages: [savedPresetMessage, priorKernelMessage, confirmedPlanMessage],
        latest_plan: plan,
      });
    }
    if (url.endsWith("/media/assistant/plans/plan-1/apply")) {
      return jsonResponse({ ...plan, plan: { ...plan.plan, status: "applied" } });
    }
    return jsonResponse({});
  });
  vi.stubGlobal("fetch", fetchMock);

  render(
    <CreativeAssistantPanel
      open
      workspaceKey="tab-saved-preset"
      workflowId="workflow-1"
      workflowName="Assistant Graph"
      workflow={workflow}
      references={[]}
      importImageFile={vi.fn()}
      onApplyWorkflow={onApplyWorkflow}
      onClose={vi.fn()}
    />,
  );

  fireEvent.click(await screen.findByRole("button", { name: "Test Navy Field Guide in a clean graph" }));
  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/plans"))).toBe(true));
  const planCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/plans"));
  const request = JSON.parse(String(planCall?.[1]?.body));
  expect(request.message).toContain("preset-1");
  expect(request.message).toContain("navy_field_guide");
  expect(request.message).toContain("sample values");
  expect(request.workflow.nodes).toHaveLength(0);
  fireEvent.click(await screen.findByRole("button", { name: "Add to canvas" }));
  await waitFor(() => expect(onApplyWorkflow).toHaveBeenCalled());
  const applyCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/media/assistant/plans/plan-1/apply"));
  expect(JSON.parse(String(applyCall?.[1]?.body)).workflow.nodes).toHaveLength(0);
});

it("shows the persisted clarification when saved-artifact graph planning needs input", async () => {
  const fetchMock = vi.fn((url: string) => {
    if (url.includes("/media/assistant/sessions?")) {
      return jsonResponse({ items: [{ ...session, messages: [savedRecipeMessage] }] });
    }
    if (url.endsWith("/media/assistant/sessions/session-1/plans")) {
      return Promise.resolve(new Response(JSON.stringify({
        detail: "The assistant did not produce a confirmable graph proposal.",
      }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }));
    }
    if (url.endsWith("/media/assistant/sessions/session-1")) {
      return jsonResponse({ ...session, messages: [savedRecipeMessage, savedRecipeGraphRequestMessage, clarificationMessage] });
    }
    return jsonResponse({});
  });
  vi.stubGlobal("fetch", fetchMock);

  const { container } = render(
    <CreativeAssistantPanel
      open
      workspaceKey="tab-saved-recipe-clarification"
      workflowId="workflow-1"
      workflowName="Assistant Graph"
      workflow={workflow}
      references={[]}
      importImageFile={vi.fn()}
      onApplyWorkflow={vi.fn()}
      onClose={vi.fn()}
    />,
  );

  fireEvent.click(await screen.findByRole("button", { name: "Create a clean graph with Storyboard Writer" }));

  await waitFor(() => expect(container.querySelectorAll(".graph-assistant-message-assistant")).toHaveLength(1));
  expect(container.querySelector(".graph-assistant-message-plan")).toBeNull();
  expect(container.querySelector(".graph-assistant-error")).toBeNull();
});

it("preserves an upstream planning error instead of masking it with an unrelated reply", async () => {
  const unrelatedMessage = {
    ...clarificationMessage,
    assistant_message_id: "message-unrelated",
    content_text: "A separate assistant reply arrived.",
  };
  const fetchMock = vi.fn((url: string) => {
    if (url.includes("/media/assistant/sessions?")) {
      return jsonResponse({ items: [{ ...session, messages: [savedRecipeMessage] }] });
    }
    if (url.endsWith("/media/assistant/sessions/session-1/plans")) {
      return Promise.resolve(new Response(JSON.stringify({ detail: "Upstream assistant unavailable." }), {
        status: 502,
        headers: { "content-type": "application/json" },
      }));
    }
    if (url.endsWith("/media/assistant/sessions/session-1")) {
      return jsonResponse({ ...session, messages: [savedRecipeMessage, unrelatedMessage] });
    }
    return jsonResponse({});
  });
  vi.stubGlobal("fetch", fetchMock);

  const { container } = render(
    <CreativeAssistantPanel
      open
      workspaceKey="tab-saved-recipe-upstream-error"
      workflowId="workflow-1"
      workflowName="Assistant Graph"
      workflow={workflow}
      references={[]}
      importImageFile={vi.fn()}
      onApplyWorkflow={vi.fn()}
      onClose={vi.fn()}
    />,
  );

  fireEvent.click(await screen.findByRole("button", { name: "Create a clean graph with Storyboard Writer" }));

  expect(await screen.findByText("Upstream assistant unavailable.")).toBeTruthy();
  expect(container.querySelectorAll(".graph-assistant-message-assistant")).toHaveLength(0);
});

it("stops a delayed clarification refresh without replacing the cancelled session", async () => {
  let resolveRefresh: ((response: Response) => void) | undefined;
  let refreshSignal: AbortSignal | undefined;
  const delayedRefresh = new Promise<Response>((resolve) => {
    resolveRefresh = resolve;
  });
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url.includes("/media/assistant/sessions?")) {
      return jsonResponse({ items: [{ ...session, messages: [savedRecipeMessage] }] });
    }
    if (url.endsWith("/media/assistant/sessions/session-1/plans")) {
      return Promise.resolve(new Response(JSON.stringify({
        detail: "The assistant did not produce a confirmable graph proposal.",
      }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }));
    }
    if (url.endsWith("/media/assistant/sessions/session-1/cancel")) {
      return jsonResponse({ ...session, messages: [savedRecipeMessage] });
    }
    if (url.endsWith("/media/assistant/sessions/session-1")) {
      refreshSignal = init?.signal ?? undefined;
      return delayedRefresh;
    }
    return jsonResponse({});
  });
  vi.stubGlobal("fetch", fetchMock);

  const { container } = render(
    <CreativeAssistantPanel
      open
      workspaceKey="tab-saved-recipe-cancel-refresh"
      workflowId="workflow-1"
      workflowName="Assistant Graph"
      workflow={workflow}
      references={[]}
      importImageFile={vi.fn()}
      onApplyWorkflow={vi.fn()}
      onClose={vi.fn()}
    />,
  );

  fireEvent.click(await screen.findByRole("button", { name: "Create a clean graph with Storyboard Writer" }));
  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/session-1"))).toBe(true));
  fireEvent.click(await screen.findByRole("button", { name: /stop assistant request/i }));
  await waitFor(() => expect(refreshSignal?.aborted).toBe(true));

  await act(async () => {
    resolveRefresh?.(jsonResponse({
      ...session,
      messages: [savedRecipeMessage, savedRecipeGraphRequestMessage, clarificationMessage],
    }));
    await Promise.resolve();
  });

  await waitFor(() => expect(container.querySelectorAll(".graph-assistant-message-assistant")).toHaveLength(0));
});
