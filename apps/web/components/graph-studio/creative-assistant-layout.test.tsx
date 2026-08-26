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

it("presents and applies a layout-only Assistant proposal as a workflow tidy", async () => {
  const arrangedWorkflow = {
    ...workflow,
    nodes: [
      { id: "prompt", type: "prompt.text", position: { x: 96, y: 96 }, fields: { text: "Keep me" } },
      { id: "model", type: "model.kie.gpt_image_2_text_to_image", position: { x: 612, y: 96 }, fields: {} },
      { id: "preview", type: "preview.image", position: { x: 1088, y: 96 }, fields: {} },
    ],
    metadata: {
      groups: [{
        id: "shot-1",
        title: "Shot 1",
        color: "blue",
        node_ids: ["prompt", "model", "preview"],
        bounds: { x: 0, y: 0, width: 1544, height: 752 },
      }],
    },
  };
  const layoutPlan: AssistantPlanResponse = {
    plan: {
      assistant_plan_id: "plan-1",
      assistant_session_id: "session-1",
      status: "validated",
      capability: "plan_graph",
    },
    graph_plan: {
      capability: "plan_graph",
      summary: "The workflow is arranged left to right with consistent padded groups.",
      questions: [],
      operations: [{ op: "arrange_workflow" }],
      warnings: [],
      requires_confirmation: true,
      metadata: {
        kernel_proposal: true,
        arrange_workflow: true,
        diff_summary: {
          nodes_moved: [{ id: "prompt" }, { id: "model" }, { id: "preview" }],
          groups_repositioned: [{ id: "shot-1" }],
        },
      },
    },
    workflow: arrangedWorkflow,
    validation: { valid: true, errors: [], warnings: [] },
    pricing: { pricing_summary: { total: { estimated_credits: 0, estimated_cost_usd: 0 } }, nodes: {}, warnings: [] },
  };
  const assistantMessage = {
    assistant_message_id: "message-layout-kernel",
    assistant_session_id: "session-1",
    role: "assistant",
    content_text: "The layout-only proposal is ready.",
    content_json: {
      mode: "assistant_kernel",
      next_action: {
        kind: "confirm_graph",
        label: "Tidy workflow",
        proposal_id: "plan-1",
        confirmation_token: "layout-token-1",
        requires_confirmation: true,
        payload: { proposal_id: "plan-1", confirmation_token: "layout-token-1" },
      },
    },
  };
  const onApplyWorkflow = vi.fn();
  const fetchMock = vi.fn((url: string) => {
    if (url.includes("/media/assistant/sessions?")) return jsonResponse({ items: [] });
    if (url.endsWith("/media/assistant/sessions")) return jsonResponse({ ...session, messages: [] });
    if (url.endsWith("/media/assistant/sessions/session-1/messages")) {
      return jsonResponse({ ...session, messages: [assistantMessage], latest_plan: layoutPlan });
    }
    if (url.endsWith("/media/assistant/plans/plan-1/apply")) {
      return jsonResponse({ ...layoutPlan, plan: { ...layoutPlan.plan, status: "applied" } });
    }
    return jsonResponse({});
  });
  vi.stubGlobal("fetch", fetchMock);

  render(
    <CreativeAssistantPanel
      open
      workspaceKey="tab-layout"
      workflowId="workflow-1"
      workflowName="Assistant Graph"
      workflow={arrangedWorkflow}
      references={[]}
      importImageFile={vi.fn()}
      onApplyWorkflow={onApplyWorkflow}
      onClose={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByRole("textbox", { name: /assistant message/i }), {
    target: { value: "Tidy this workflow without changing its meaning." },
  });
  fireEvent.click(screen.getByRole("button", { name: /send chat message/i }));

  expect(await screen.findByText("Workflow layout ready")).toBeTruthy();
  expect(screen.getByText("Arrange 3 nodes and 1 group")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Tidy workflow" })).toBeTruthy();
  expect(screen.queryByText("No canvas changes are required.")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Tidy workflow" }));
  await waitFor(() => expect(onApplyWorkflow).toHaveBeenCalled());
  expect(await screen.findByText("Workflow layout updated")).toBeTruthy();
  expect(screen.getByText("The workflow is arranged left to right with consistent padded groups.")).toBeTruthy();
});
