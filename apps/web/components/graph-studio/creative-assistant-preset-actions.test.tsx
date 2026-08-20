// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
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

function renderPresetSession(
  workspaceKey: string,
  assistantSession: Record<string, unknown>,
  run?: { id: string; status: string },
) {
  const messages = Array.isArray(assistantSession.messages) ? assistantSession.messages : [];
  const presetSession = {
    ...assistantSession,
    messages: [{
      assistant_message_id: "message-preset-mode",
      assistant_session_id: "session-1",
      role: "user",
      content_text: "Help me test this preset.",
      content_json: { assistant_mode: "preset" },
    }, ...messages],
  };
  const fetchMock = vi.fn((url: string) => {
    if (url.includes("/media/assistant/sessions?")) return jsonResponse({ items: [presetSession] });
    if (url.endsWith("/media/assistant/sessions/session-1/messages")) {
      const reviewPlan = appliedPresetPlan("text_to_image");
      reviewPlan.plan.status = "validated";
      return jsonResponse({
        ...presetSession,
        messages: [{
          assistant_message_id: "message-plan-confirmation",
          assistant_session_id: "session-1",
          role: "assistant",
          content_text: "The test graph is ready for review.",
          content_json: {
            mode: "assistant_kernel",
            next_action: {
              kind: "confirm_graph",
              label: "Add to canvas",
              proposal_id: reviewPlan.plan.assistant_plan_id,
              confirmation_token: "confirm-token-1",
              requires_confirmation: true,
              payload: { confirmation_token: "confirm-token-1" },
            },
          },
        }],
        latest_plan: reviewPlan,
      });
    }
    return jsonResponse({});
  });
  vi.stubGlobal("fetch", fetchMock);
  return { ...render(
    <CreativeAssistantPanel
      open
      workspaceKey={workspaceKey}
      workflowId="workflow-1"
      workflowName="Preset test"
      workflow={workflow}
      latestRunId={run?.id}
      latestRunStatus={run?.status}
      references={[]}
      importImageFile={vi.fn()}
      onApplyWorkflow={vi.fn()}
      onRunWorkflow={vi.fn()}
      onClose={vi.fn()}
    />,
  ), fetchMock };
}

function appliedPresetPlan(mode: "text_to_image" | "image_to_image", required = true): AssistantPlanResponse {
  const imageNode = {
    id: "source-image",
    type: "media.load_image",
    position: { x: 0, y: 0 },
    fields: {},
    metadata: { ui: { customTitle: "Subject photo" } },
  };
  return {
    plan: {
      assistant_plan_id: `plan-${mode}`,
      assistant_session_id: "session-1",
      status: "applied",
      capability: "plan_graph",
      applied_workflow_id: "workflow-1",
    },
    graph_plan: {
      capability: "plan_graph",
      summary: "Preset test graph",
      questions: [],
      operations: [{ op: "add_node", node_type: mode === "image_to_image" ? "media.load_image" : "prompt.text" }],
      warnings: [],
      requires_confirmation: true,
      metadata: {
        template_id: mode === "image_to_image" ? "preset_style_i2i_sandbox_v1" : "preset_style_t2i_sandbox_v1",
        template_mode: mode,
        template_slot_count: mode === "image_to_image" ? 1 : 0,
      },
    },
    workflow: {
      ...workflow,
      nodes: mode === "image_to_image" ? [imageNode] : [],
    },
    validation: mode === "image_to_image" && required
      ? {
          valid: false,
          errors: [{ code: "missing_media_reference", message: "Load media needs an asset or reference media for this required input.", node_id: "source-image" }],
          warnings: [],
        }
      : { valid: true, errors: [], warnings: [] },
    pricing: { pricing_summary: { total: { estimated_credits: 8, estimated_cost_usd: 0.08 } }, nodes: {}, warnings: [] },
  };
}

it("restores a pending plan when a standalone session's graph later gains a workflow id", async () => {
  const restoredPlan = appliedPresetPlan("text_to_image");
  restoredPlan.plan.status = "validated";
  const assistantMessage = {
    assistant_message_id: "message-plan-confirmation",
    assistant_session_id: "session-1",
    role: "assistant",
    content_text: "The test graph is ready for review.",
    content_json: {
      mode: "assistant_kernel",
      next_action: {
        kind: "confirm_graph",
        label: "Add to canvas",
        proposal_id: restoredPlan.plan.assistant_plan_id,
        confirmation_token: "confirm-token-1",
        requires_confirmation: true,
        payload: { confirmation_token: "confirm-token-1" },
      },
    },
  };
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    if (url.endsWith("/media/assistant/sessions/session-1")) {
      return jsonResponse({
        ...session,
        owner_kind: "standalone",
        owner_id: null,
        messages: [assistantMessage],
        latest_plan: restoredPlan,
      });
    }
    return jsonResponse({});
  }));

  render(
    <CreativeAssistantPanel
      open
      workspaceKey="tab-restored-plan"
      workflowId="workflow-1"
      workflowName="Preset test"
      workflow={workflow}
      references={[]}
      importImageFile={vi.fn()}
      initialAssistantSessionId="session-1"
      onApplyWorkflow={vi.fn()}
      onClose={vi.fn()}
    />,
  );

  await waitFor(() => expect(screen.getByRole("button", { name: "Add to canvas" })).toBeTruthy());
});

it("offers one primary Create test graph action for a preset draft", async () => {
  const { fetchMock } = renderPresetSession("tab-draft", {
    ...session,
    messages: [{
      assistant_message_id: "message-draft",
      assistant_session_id: "session-1",
      role: "assistant",
      content_text: "I prepared a reusable direction from the references.",
      content_json: { mode: "assistant_kernel", next_action: { kind: "none", requires_confirmation: false } },
    }],
    summary_json: {
      kernel_preset_draft: {
        label: "Field guide",
        rules_json: { preset_lane: "text_to_image" },
        input_slots_json: [],
        input_schema_json: [{ key: "profession", label: "Profession" }],
      },
    },
  });

  const action = await screen.findByRole("button", { name: "Create test graph" });
  expect(screen.getAllByRole("button", { name: "Create test graph" })).toHaveLength(1);
  action.click();
  await waitFor(() => expect(screen.getByRole("button", { name: "Add to canvas" })).toBeTruthy());
  expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/messages"))).toBe(true);
  expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/apply"))).toBe(false);
});

it("makes the applied text-to-image next action Run test without offering Save", async () => {
  renderPresetSession("tab-t2i", { ...session, messages: [], latest_plan: appliedPresetPlan("text_to_image") });

  expect(await screen.findByText(/no image input is needed/i)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Run test" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /save.*preset/i })).toBeNull();
});

it("shows unverified save as a warned secondary action", async () => {
  renderPresetSession("tab-unverified-save", {
    ...session,
    messages: [{
      assistant_message_id: "message-unverified-save",
      assistant_session_id: "session-1",
      role: "assistant",
      content_text: "You chose to keep the draft without visual proof.",
      content_json: {
        mode: "assistant_kernel",
        next_action: {
          kind: "save_media_preset",
          label: "Save unverified draft",
          proposal_id: "proposal-unverified",
          confirmation_token: "token-unverified",
          requires_confirmation: true,
          payload: { quality_state: "test_ready", save_mode: "unverified" },
        },
      },
    }],
  });

  const action = await screen.findByRole("button", { name: "Save unverified draft" });
  expect(screen.getByText(/has not been visually verified/i)).toBeTruthy();
  expect(action.classList.contains("graph-assistant-card-action-primary")).toBe(false);
  expect(screen.queryByRole("button", { name: "Save verified preset" })).toBeNull();
});

it.each([
  [true, /required image input: subject photo/i],
  [false, /optional image input: subject photo/i],
])("names an image-to-image slot and whether it is required", async (required, expectedCopy) => {
  renderPresetSession(`tab-i2i-${required}`, {
    ...session,
    messages: [],
    latest_plan: appliedPresetPlan("image_to_image", required),
    summary_json: { kernel_preset_draft: { input_slots_json: [{ label: "Subject photo", required }] } },
  });

  expect(await screen.findByText(expectedCopy)).toBeTruthy();
  if (required) expect(screen.queryByRole("button", { name: "Run test" })).toBeNull();
  else expect(screen.getByRole("button", { name: "Run test" })).toBeTruthy();
});

it("keeps a filled image-to-image slot labeled required from the typed draft", async () => {
  renderPresetSession("tab-i2i-filled", {
    ...session,
    messages: [],
    latest_plan: appliedPresetPlan("image_to_image", false),
    summary_json: { kernel_preset_draft: { input_slots_json: [{ label: "Subject photo", required: true }] } },
  });

  expect(await screen.findByText(/required image input: subject photo/i)).toBeTruthy();
  expect(screen.queryByText(/add it on the canvas/i)).toBeNull();
  expect(screen.getByRole("button", { name: "Run test" })).toBeTruthy();
});

it("does not offer Run test for an applied graph without a price", async () => {
  const unpriced = appliedPresetPlan("text_to_image");
  unpriced.pricing.pricing_summary.total = {};
  renderPresetSession("tab-unpriced", { ...session, messages: [], latest_plan: unpriced });

  await waitFor(() => expect(screen.getByLabelText("Added graph status")).toBeTruthy());
  expect(screen.queryByRole("button", { name: "Run test" })).toBeNull();
});

it("does not restore a consumed run confirmation after hydration", async () => {
  const { fetchMock } = renderPresetSession("tab-consumed-run", {
    ...session,
    summary_json: { kernel_run_confirmation: { consumed: true } },
    messages: [{
      assistant_message_id: "message-run",
      assistant_session_id: "session-1",
      role: "assistant",
      content_text: "The graph is ready for confirmation.",
      content_json: {
        mode: "assistant_kernel",
        next_action: {
          kind: "run_workflow",
          label: "Review and run",
          confirmation_token: "run-token-1",
          requires_confirmation: true,
          payload: { confirmation_token: "run-token-1" },
        },
      },
    }],
  });

  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  expect(screen.queryByRole("button", { name: "Review and run" })).toBeNull();
});

it("does not show Create test graph beside a run confirmation", async () => {
  renderPresetSession("tab-run-only", {
    ...session,
    summary_json: {
      kernel_run_confirmation: { consumed: false },
      kernel_preset_draft: { label: "Field guide", rules_json: { preset_lane: "text_to_image" }, input_slots_json: [] },
    },
    messages: [{
      assistant_message_id: "message-run-only",
      assistant_session_id: "session-1",
      role: "assistant",
      content_text: "The graph is ready for confirmation.",
      content_json: {
        mode: "assistant_kernel",
        next_action: {
          kind: "run_workflow",
          label: "Review and run",
          confirmation_token: "run-token-2",
          requires_confirmation: true,
          payload: { confirmation_token: "run-token-2" },
        },
      },
    }],
  });

  expect(await screen.findByRole("button", { name: "Review and run" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Create test graph" })).toBeNull();
});

it("does not return to Create test graph after the paid test run starts", async () => {
  const { fetchMock } = renderPresetSession("tab-running", {
    ...session,
    summary_json: {
      kernel_run_confirmation: { consumed: true },
      kernel_preset_draft: {
        label: "Field guide",
        rules_json: { preset_lane: "text_to_image" },
        input_slots_json: [],
      },
    },
    messages: [],
  }, { id: "run-1", status: "running" });

  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  expect(screen.queryByRole("button", { name: "Create test graph" })).toBeNull();
});

it("keeps Create test graph for a fresh draft when the workflow has an older run", async () => {
  renderPresetSession("tab-old-run", {
    ...session,
    summary_json: {
      kernel_preset_draft: {
        label: "New field guide",
        rules_json: { preset_lane: "text_to_image" },
        input_slots_json: [],
      },
    },
    messages: [],
  }, { id: "run-old", status: "completed" });

  expect(await screen.findByRole("button", { name: "Create test graph" })).toBeTruthy();
});
