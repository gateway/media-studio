// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { openAssistantReviewDraftMock, openAssistantReviewUrlMock, writeAssistantReviewDraftMock } = vi.hoisted(() => ({
  openAssistantReviewDraftMock: vi.fn(),
  openAssistantReviewUrlMock: vi.fn(),
  writeAssistantReviewDraftMock: vi.fn(() => "draft-1"),
}));

vi.mock("@/lib/assistant-review-drafts", () => ({
  assistantReviewReturnTarget: (returnTo?: string, assistantSessionId?: string | null) =>
    assistantSessionId
      ? `${returnTo || "/graph-studio"}${(returnTo || "/graph-studio").includes("?") ? "&" : "?"}assistantSession=${assistantSessionId}`
      : (returnTo || "/graph-studio"),
  openAssistantReviewDraft: openAssistantReviewDraftMock,
  openAssistantReviewUrl: openAssistantReviewUrlMock,
  writeAssistantReviewDraft: writeAssistantReviewDraftMock,
}));

import { CreativeAssistantPanel } from "./creative-assistant-panel";
import type { AssistantPlanResponse, GraphWorkflowPayload } from "./types";
import type { MediaReference } from "@/lib/types";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage?.clear?.();
  openAssistantReviewDraftMock.mockClear();
  openAssistantReviewUrlMock.mockClear();
  writeAssistantReviewDraftMock.mockClear();
  writeAssistantReviewDraftMock.mockReturnValue("draft-1");
});

const workflow: GraphWorkflowPayload = {
  schema_version: 1,
  workflow_id: "workflow-1",
  name: "Assistant Graph",
  nodes: [],
  edges: [],
  metadata: {},
};

const plannedWorkflow: GraphWorkflowPayload = {
  ...workflow,
  nodes: [
    { id: "prompt", type: "prompt.text", position: { x: 0, y: 0 }, fields: { text: "Create an image" } },
    { id: "preview", type: "preview.image", position: { x: 420, y: 0 }, fields: {} },
  ],
  edges: [],
};

const planResponse: AssistantPlanResponse = {
  plan: {
    assistant_plan_id: "plan-1",
    assistant_session_id: "session-1",
    status: "validated",
    capability: "plan_graph",
  },
  graph_plan: {
    capability: "plan_graph",
    summary: "Create a small image workflow.",
    questions: [],
    operations: [{ op: "add_node" }],
    warnings: [],
    requires_confirmation: true,
    metadata: {
      template_id: "preset_style_t2i_sandbox_v1",
      template_mode: "text_to_image",
      template_slot_count: 0,
    },
  },
  workflow: plannedWorkflow,
  validation: { valid: true, errors: [], warnings: [] },
  pricing: { pricing_summary: { total: { estimated_credits: 6, estimated_cost_usd: 0.03 } }, nodes: {}, warnings: [] },
};

const failedPresetTestWorkflowPlanResponse: AssistantPlanResponse = {
  ...planResponse,
  plan: {
    ...planResponse.plan,
    status: "failed",
  },
  graph_plan: {
    ...planResponse.graph_plan,
    metadata: {
      template_id: "preset_style_i2i_sandbox_v1",
      template_mode: "image_to_image",
      template_slot_count: 1,
    },
  },
  validation: {
    valid: false,
    errors: [{ code: "missing_media", message: "Load media needs an asset or reference media for this required input." }],
    warnings: [],
  },
};

const noOpPlanResponse: AssistantPlanResponse = {
  ...planResponse,
  graph_plan: {
    capability: "plan_graph",
    summary: "Clip assembly is not ready yet. I need at least two approved story clip outputs before creating a video.combine branch.",
    questions: ["Approve or identify the story clip outputs you want stitched together, then ask me to build the combine graph."],
    operations: [],
    warnings: ["No combine nodes were created because there are not enough approved video clips in story state."],
    requires_confirmation: true,
    metadata: { template_id: "story_clip_combine_guard_v1" },
  },
  workflow,
  validation: { valid: true, errors: [], warnings: [] },
  pricing: { pricing_summary: { total: { estimated_credits: 0, estimated_cost_usd: 0 } }, nodes: {}, warnings: [] },
};

const referenceImage: MediaReference = {
  reference_id: "reference-1",
  kind: "image",
  status: "ready",
  original_filename: "woman-reference.png",
  stored_path: "references/woman-reference.png",
  stored_url: "/api/control/reference-media/reference-1/file",
  thumb_url: "/api/control/reference-media/reference-1/thumb",
  file_size_bytes: 1000,
  sha256: "abc123",
  usage_count: 0,
};

function jsonResponse(payload: unknown) {
  return Promise.resolve(new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } }));
}

describe("CreativeAssistantPanel", () => {
  it("restores the stored assistant mode for a workflow workspace", async () => {
    const storedValues = new Map<string, string>([["media-studio:graph-assistant-mode:tab-preset", "preset"]]);
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: vi.fn((key: string) => storedValues.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => {
          storedValues.set(key, value);
        }),
        clear: vi.fn(() => storedValues.clear()),
      },
    });
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/api/control/reference-media?")) {
        return jsonResponse({ ok: true, items: [referenceImage], limit: 24, offset: 0, next_offset: null });
      }
      if (url.includes("/media/assistant/sessions?")) {
        return jsonResponse({ items: [] });
      }
      if (url.includes("/api/control/health")) {
        return jsonResponse({});
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CreativeAssistantPanel
        open
        workspaceKey="tab-preset"
        workflowId="workflow-1"
        workflowName="Assistant Graph"
        workflow={workflow}
        latestRunId={null}
        references={[]}
        importImageFile={vi.fn()}
        onApplyWorkflow={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByText("Start a preset")).toBeTruthy();
  });

  it("renders assistant inline markdown as readable chat blocks", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/api/control/reference-media?")) {
        return jsonResponse({ ok: true, items: [], limit: 24, offset: 0, next_offset: null });
      }
      if (url.includes("/media/assistant/sessions?")) {
        return jsonResponse({
          items: [
            {
              assistant_session_id: "session-story-format",
              owner_kind: "graph_workflow",
              owner_id: "workflow-1",
              provider_kind: "codex_local",
              status: "active",
              messages: [
                {
                  assistant_message_id: "message-story-format",
                  assistant_session_id: "session-story-format",
                  role: "assistant",
                  content_text:
                    "Strong core: haunted orbital myth. - **Story spine:** Mira opens the eclipse gate. 1. **Shot 1:** Wide camera, cathedral drifting above Earth. 2. **Shot 2:** Oren raises the rusted sword.",
                  content_json: {},
                },
              ],
            },
          ],
        });
      }
      if (url.includes("/api/control/health")) {
        return jsonResponse({});
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(
      <CreativeAssistantPanel
        open
        workspaceKey="tab-story-format"
        workflowId="workflow-1"
        workflowName="Assistant Graph"
        workflow={workflow}
        latestRunId={null}
        references={[]}
        importImageFile={vi.fn()}
        onApplyWorkflow={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByText("Story spine:")).toBeTruthy();
    const items = Array.from(container.querySelectorAll(".graph-assistant-message-content li")).map((item) => item.textContent);
    expect(items).toEqual([
      "Story spine: Mira opens the eclipse gate.",
      "Shot 1: Wide camera, cathedral drifting above Earth.",
      "Shot 2: Oren raises the rusted sword.",
    ]);
  });

  it("shows selected node context with supported editable fields and branch", async () => {
    const workflowWithSelection: GraphWorkflowPayload = {
      ...workflow,
      nodes: [
        {
          id: "character-recipe",
          type: "prompt.recipe",
          position: { x: 0, y: 0 },
          fields: { user_prompt: "western character sheet" },
          metadata: { ui: { customTitle: "Character Sheet Recipe" } },
        },
      ],
      metadata: {
        groups: [
          {
            id: "group-character",
            title: "Character Build",
            color: "#88ccff",
            node_ids: ["character-recipe"],
            bounds: { x: -40, y: -40, width: 460, height: 320 },
          },
        ],
      },
    };
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/api/control/reference-media?")) {
        return jsonResponse({ ok: true, items: [], limit: 24, offset: 0, next_offset: null });
      }
      if (url.includes("/media/assistant/sessions?")) {
        return jsonResponse({ items: [] });
      }
      if (url.includes("/api/control/health")) {
        return jsonResponse({});
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CreativeAssistantPanel
        open
        workspaceKey="tab-selected"
        workflowId="workflow-1"
        workflowName="Assistant Graph"
        workflow={workflowWithSelection}
        selectedNodeIds={["character-recipe"]}
        references={[]}
        importImageFile={vi.fn()}
        onApplyWorkflow={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const selectionContext = await screen.findByLabelText("Selected canvas context");
    expect(selectionContext.textContent).toContain("Canvas selection");
    expect(selectionContext.textContent).toContain("Character Sheet Recipe");
    expect(selectionContext.textContent).toContain("prompt.recipe");
    expect(selectionContext.textContent).toContain("Editable: user_prompt and title");
    expect(selectionContext.textContent).toContain("Branch: Character Build");
  });

  it("renders compact graph inventory replies as readable lists", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/api/control/reference-media?")) {
        return jsonResponse({ ok: true, items: [], limit: 24, offset: 0, next_offset: null });
      }
      if (url.includes("/media/assistant/sessions?")) {
        return jsonResponse({
          items: [
            {
              assistant_session_id: "session-graph-format",
              owner_kind: "graph_workflow",
              owner_id: "workflow-1",
              provider_kind: "codex_local",
              status: "active",
              messages: [
                {
                  assistant_message_id: "message-graph-format",
                  assistant_session_id: "session-graph-format",
                  role: "assistant",
                  content_text:
                    "I see the graph `Sadis Adventures`. Storyboard-related nodes on the canvas: - `Character Sheet Ref` - `Storyboard 1 Recipe` - `Storyboard 1 GPT` Storyboard groups: - `Story Board 1` - `Story Board 2`",
                  content_json: {},
                },
              ],
            },
          ],
        });
      }
      if (url.includes("/api/control/health")) {
        return jsonResponse({});
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(
      <CreativeAssistantPanel
        open
        workspaceKey="tab-graph-format"
        workflowId="workflow-1"
        workflowName="Assistant Graph"
        workflow={workflow}
        latestRunId={null}
        references={[]}
        importImageFile={vi.fn()}
        onApplyWorkflow={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByText("Storyboard groups:")).toBeTruthy();
    const items = Array.from(container.querySelectorAll(".graph-assistant-message-content li")).map((item) => item.textContent);
    expect(items).toEqual([
      "`Character Sheet Ref`",
      "`Storyboard 1 Recipe`",
      "`Storyboard 1 GPT`",
      "`Story Board 1`",
      "`Story Board 2`",
    ]);
  });

  it("loads an existing workflow assistant session when opened", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/media/assistant/sessions?")) {
        return jsonResponse({
          items: [
            {
              assistant_session_id: "session-existing",
              owner_kind: "graph_workflow",
              owner_id: "workflow-1",
              provider_kind: "codex_local",
              status: "active",
              messages: [
                {
                  assistant_message_id: "message-existing",
                  assistant_session_id: "session-existing",
                  role: "user",
                  content_text: "Build a starter graph",
                },
              ],
              attachments: [],
            },
          ],
        });
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
        latestRunId="run-latest-1"
        references={[]}
        importImageFile={vi.fn()}
        onApplyWorkflow={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText("Build a starter graph")).toBeTruthy());
  });

  it("keeps a manually selected assistant mode after loading a graph-mode session", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/media/assistant/sessions?")) {
        return jsonResponse({
          items: [
            {
              assistant_session_id: "session-graph-mode",
              owner_kind: "graph_workflow",
              owner_id: "workflow-1",
              provider_kind: "codex_local",
              status: "active",
              messages: [
                {
                  assistant_message_id: "message-graph-mode",
                  assistant_session_id: "session-graph-mode",
                  role: "assistant",
                  content_text: "I can see this graph.",
                  content_json: { assistant_mode: "graph" },
                },
              ],
              attachments: [],
            },
          ],
        });
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CreativeAssistantPanel
        open
        workspaceKey="tab-manual-mode"
        workflowId="workflow-1"
        workflowName="Assistant Graph"
        workflow={workflow}
        latestRunId="run-latest-1"
        references={[]}
        importImageFile={vi.fn()}
        onApplyWorkflow={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByPlaceholderText("Graph mode: describe the graph workflow you want to build.")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /media presets/i }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Ask Media Assistant to analyze refs, suggest fields, or build a preset.")).toBeTruthy();
    });
  });

  it("renders legacy guided preset starters as human chat requests", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/media/assistant/sessions?")) {
        return jsonResponse({
          items: [
            {
              assistant_session_id: "session-existing",
              owner_kind: "graph_workflow",
              owner_id: "workflow-1",
              provider_kind: "codex_local",
              status: "active",
              messages: [
                {
                  assistant_message_id: "message-existing",
                  assistant_session_id: "session-existing",
                  role: "user",
                  content_text:
                    "Start preset loop: Image-to-Image. Use attached reference images as style sources only. Suggest the most relevant user-provided image input and one or two useful fields, then create an image-to-image test sandbox after I confirm.",
                  content_json: {},
                },
              ],
              attachments: [],
            },
          ],
        });
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
        latestRunId="run-latest-1"
        references={[]}
        importImageFile={vi.fn()}
        onApplyWorkflow={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText("Can you create an image-to-image media preset from these reference images?")).toBeTruthy());
    expect(screen.queryByText(/Start preset loop/i)).toBeNull();
  });

  it("keeps normal assistant replies compact and hides internal provider/debug wording", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/media/assistant/sessions?")) {
        return jsonResponse({
          items: [
            {
              assistant_session_id: "session-existing",
              owner_kind: "graph_workflow",
              owner_id: "workflow-1",
              provider_kind: "codex_local",
              status: "active",
              messages: [
                {
                  assistant_message_id: "message-assistant",
                  assistant_session_id: "session-existing",
                  role: "assistant",
                  content_text:
                    "This looks like `Travel Poster`; I would lock the style around: double exposure portrait, warm sunrise palette, editorial travel typography.\nprovider_thread_id=secret-thread\nSuggested fields: Destination, Poster Title. Image input: Portrait.",
                  content_json: { mode: "provider_chat", provider_thread_id: "secret-thread" },
                },
              ],
              attachments: [],
            },
          ],
        });
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
        latestRunId="run-latest-1"
        references={[]}
        importImageFile={vi.fn()}
        onApplyWorkflow={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText(/This looks like `Travel Poster`/i)).toBeTruthy());
    expect(screen.getByText(/I would use Destination and Poster Title as editable fields/i)).toBeTruthy();
    expect(screen.getByText(/For image-to-image, I would use Portrait as the image input/i)).toBeTruthy();
    expect(screen.queryByText(/Suggested setup:/i)).toBeNull();
    expect(screen.queryByText(/- Field: Destination/i)).toBeNull();
    expect(screen.queryByText(/- Image input: Portrait/i)).toBeNull();
    expect(screen.queryByText(/provider_thread_id/i)).toBeNull();
    expect(screen.queryByText(/secret-thread/i)).toBeNull();
    expect(screen.queryByText(/codex_local/i)).toBeNull();
  });

  it("shows state-aware preset loop quick actions with user-facing labels", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/media/assistant/sessions?")) {
        return jsonResponse({
          items: [
            {
              assistant_session_id: "session-existing",
              owner_kind: "graph_workflow",
              owner_id: "workflow-1",
              provider_kind: "codex_local",
              status: "active",
              messages: [
                {
                  assistant_message_id: "message-refine",
                  assistant_session_id: "session-existing",
                  role: "assistant",
                  content_text: "I can prepare a reviewable prompt update now; apply it from the workflow review when it looks right.",
                  content_json: { mode: "deterministic_preset_sandbox_refinement", suggested_action: "create_graph_plan" },
                },
                {
                  assistant_message_id: "message-saved",
                  assistant_session_id: "session-existing",
                  role: "assistant",
                  content_text: "Saved Media Preset: Travel Poster.",
                  content_json: {
                    activity_kind: "media_preset_saved",
                    saved_artifact: { kind: "media_preset", id: "preset-1", key: "travel_poster", label: "Travel Poster" },
                  },
                },
              ],
              attachments: [],
            },
          ],
        });
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
        latestRunId="run-latest-1"
        references={[]}
        importImageFile={vi.fn()}
        onApplyWorkflow={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /media presets/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /update prompt/i })).toBeTruthy());
    expect(screen.getByText("Test saved preset")).toBeTruthy();
  });

  it("offers save preset from a restored applied-plan assistant message", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes("/media/assistant/sessions?")) {
        return jsonResponse({
          items: [
            {
              assistant_session_id: "session-existing",
              owner_kind: "graph_workflow",
              owner_id: "workflow-1",
              provider_kind: "codex_local",
              status: "active",
              messages: [
                {
                  assistant_message_id: "message-applied",
                  assistant_session_id: "session-existing",
                  role: "assistant",
                  content_text: "I applied the reviewed plan to the graph. It has not been run yet.",
                },
              ],
              attachments: [],
            },
          ],
        });
      }
      if (url.endsWith("/media/assistant/sessions/session-existing/preset-saves")) {
        return jsonResponse({
          assistant_session_id: "session-existing",
          saved_preset: {
            preset: { preset_id: "preset-1", key: "approved_sandbox", label: "Approved Sandbox" },
          },
          session: {
            assistant_session_id: "session-existing",
            owner_kind: "graph_workflow",
            owner_id: "workflow-1",
            provider_kind: "codex_local",
            status: "active",
            messages: [],
            attachments: [],
          },
        });
      }
      if (url.endsWith("/media/graph/node-definitions/refresh")) {
        return jsonResponse({ items: [] });
      }
      return Promise.resolve(new Response(`not found ${url} ${init?.method ?? "GET"}`, { status: 404 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CreativeAssistantPanel
        open
        workspaceKey="tab-1"
        workflowId="workflow-1"
        workflowName="Assistant Graph"
        workflow={workflow}
        latestRunId="run-latest-1"
        references={[]}
        importImageFile={vi.fn()}
        onApplyWorkflow={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /media presets/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /save approved workflow as media preset/i })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /save approved workflow as media preset/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/media/assistant/sessions/session-existing/preset-saves"),
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const saveCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/media/assistant/sessions/session-existing/preset-saves"));
    const saveBody = JSON.parse(String(saveCall?.[1]?.body));
    expect(saveBody.message).toContain("approved workflow");
    expect(saveBody.run_id).toBe("run-latest-1");
  });

  it("starts guided preset loop lanes from Media Presets mode", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes("/api/control/health")) {
        return jsonResponse({ status: "ok", llm_providers: {} });
      }
      if (url.includes("/media/assistant/sessions?")) {
        return jsonResponse({ items: [] });
      }
      if (url.endsWith("/media/assistant/sessions")) {
        return jsonResponse({
          assistant_session_id: "session-1",
          owner_kind: "graph_workflow",
          owner_id: "workflow-1",
          provider_kind: "codex_local",
          status: "active",
          messages: [],
          attachments: [],
        });
      }
      if (url.endsWith("/media/assistant/sessions/session-1/messages")) {
        const body = JSON.parse(String(init?.body || "{}"));
        const isCreateSandbox = String(body.content_text || "").includes("text-to-image test graph now");
        return jsonResponse({
          assistant_session_id: "session-1",
          owner_kind: "graph_workflow",
          owner_id: "workflow-1",
          provider_kind: "codex_local",
          status: "active",
          summary_json: { preset_loop: { lane: "text_to_image", locked: true, source: "guided_loop_ui" } },
          messages: [
            {
              assistant_message_id: "message-user",
              assistant_session_id: "session-1",
              role: "user",
              content_text: body.content_text,
              content_json: { assistant_mode: "preset" },
            },
            {
              assistant_message_id: "message-assistant",
              assistant_session_id: "session-1",
              role: "assistant",
              content_text: isCreateSandbox
                ? "This looks like `Cinematic Double-Exposure Travel Poster`. I will prepare a text-to-image test graph."
                : "Locked to Text-to-Image. I will treat attached refs as style sources only, with no image input in the preset. Suggested fields: Scene / Subject and Style Notes. If that works, ask me to create the text-to-image test graph.",
              content_json: isCreateSandbox
                ? { mode: "provider_chat", suggested_action: "create_graph_plan", preset_loop_lane: "text_to_image" }
                : { mode: "deterministic_preset_loop_start", preset_loop_lane: "text_to_image" },
            },
          ],
          attachments: [],
        });
      }
      if (url.endsWith("/media/assistant/sessions/session-1/plans")) {
        return jsonResponse({
          ...planResponse,
          graph_plan: {
            ...planResponse.graph_plan,
            metadata: {
              template_id: "preset_style_t2i_sandbox_v1",
              template_mode: "text_to_image",
              template_slot_count: 0,
            },
          },
        });
      }
      if (url.endsWith("/media/assistant/plans/plan-1/apply")) {
        return jsonResponse({ ...planResponse, plan: { ...planResponse.plan, status: "applied" } });
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
        latestRunId="run-latest-1"
        references={[]}
        importImageFile={vi.fn()}
        onApplyWorkflow={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /media presets/i }));
    await waitFor(() => expect(screen.getByLabelText("Preset builder shortcuts")).toBeTruthy());
    expect(screen.getByRole("button", { name: /create text-to-image preset/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /create image-to-image preset/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /create both preset/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /create text-to-image preset/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/media/assistant/sessions/session-1/messages"),
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const messageCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/media/assistant/sessions/session-1/messages"));
    const messageBody = JSON.parse(String(messageCall?.[1]?.body));
    expect(messageBody).toMatchObject({
      content_text: "Can you create a text-to-image media preset from these reference images?",
      assistant_mode: "preset",
      metadata: { preset_loop_lane: "text_to_image", source: "guided_loop_ui" },
    });
    expect(messageBody.content_text).not.toContain("Start preset loop");
    expect(messageBody.content_text).not.toContain("test sandbox");
    expect(messageBody.content_text).not.toContain("temporary");
    expect(messageBody.content_text).not.toContain("runtime image input");
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/media/assistant/sessions/session-1/plans"))).toBe(false);
    const quickButton = await screen.findByRole("button", { name: /create graph/i });
    expect(screen.queryByLabelText("Preset builder shortcuts")).toBeNull();
    fireEvent.click(quickButton);

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).endsWith("/media/assistant/sessions/session-1/plans")),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).endsWith("/media/assistant/plans/plan-1/apply")),
      ).toBe(true),
    );
    expect(
      fetchMock.mock.calls.some(
        ([url], index) =>
          index > 0 &&
          String(url).endsWith("/media/assistant/sessions/session-1/messages") &&
          String((fetchMock.mock.calls[index]?.[1] as RequestInit | undefined)?.body || "").includes("text-to-image test graph now"),
      ),
    ).toBe(false);
    expect(screen.queryByText("Plan preview")).toBeNull();
    expect(screen.getByText("Test graph ready")).toBeTruthy();
  });

  it("offers a one-click sandbox action after locking the image-to-image preset lane", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes("/api/control/health")) {
        return jsonResponse({ status: "ok", llm_providers: {} });
      }
      if (url.includes("/media/assistant/sessions?")) {
        return jsonResponse({ items: [] });
      }
      if (url.endsWith("/media/assistant/sessions")) {
        return jsonResponse({
          assistant_session_id: "session-1",
          owner_kind: "graph_workflow",
          owner_id: "workflow-1",
          provider_kind: "codex_local",
          status: "active",
          messages: [],
          attachments: [],
        });
      }
      if (url.endsWith("/media/assistant/sessions/session-1/messages")) {
        const body = JSON.parse(String(init?.body || "{}"));
        return jsonResponse({
          assistant_session_id: "session-1",
          owner_kind: "graph_workflow",
          owner_id: "workflow-1",
          provider_kind: "codex_local",
          status: "active",
          summary_json: { preset_loop: { lane: "image_to_image", locked: true, source: "guided_loop_ui" } },
          messages: [
            {
              assistant_message_id: "message-user",
              assistant_session_id: "session-1",
              role: "user",
              content_text: body.content_text,
              content_json: { assistant_mode: "preset" },
            },
            {
              assistant_message_id: "message-assistant",
              assistant_session_id: "session-1",
              role: "assistant",
              content_text:
                "This looks like `Double-Exposure Travel Odyssey Poster`; I would lock the style around: digital photomontage travel poster; double-exposure portrait composite. Suggested setup:\n- Field: Location\n- Field: Poster Title\n- Image input: Person Reference\n\nCreate a test graph with this setup?",
              content_json: { mode: "deterministic_preset_loop_start", preset_loop_lane: "image_to_image" },
            },
          ],
          attachments: [],
        });
      }
      if (url.endsWith("/media/assistant/sessions/session-1/plans")) {
        return jsonResponse({
          ...planResponse,
          plan: { ...planResponse.plan, status: "draft" },
          graph_plan: {
            ...planResponse.graph_plan,
            metadata: {
              template_id: "preset_style_i2i_sandbox_v1",
              template_mode: "image_to_image",
              template_slot_count: 1,
            },
          },
          validation: {
            valid: false,
            errors: [{ code: "missing_media", message: "Load media needs an asset or reference media for this required input." }],
            warnings: [{ code: "disconnected_node", message: "Node is disconnected." }],
          },
        });
      }
      if (url.endsWith("/media/assistant/plans/plan-1/apply")) {
        return jsonResponse({ ...planResponse, plan: { ...planResponse.plan, status: "applied" } });
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
        latestRunId="run-latest-1"
        references={[]}
        importImageFile={vi.fn()}
        onApplyWorkflow={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /media presets/i }));
    await waitFor(() => expect(screen.getByLabelText("Preset builder shortcuts")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /create image-to-image preset/i }));
    const laneStartCall = await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url], index) =>
          index > 0 &&
          String(url).endsWith("/media/assistant/sessions/session-1/messages") &&
          String((fetchMock.mock.calls[index]?.[1] as RequestInit | undefined)?.body || "").includes(
            "Can you create an image-to-image media preset from these reference images?",
          ),
      );
      expect(call).toBeTruthy();
      return call;
    });
    const laneStartBody = JSON.parse(String(laneStartCall?.[1]?.body));
    expect(laneStartBody.content_text).not.toContain("Start preset loop");
    expect(laneStartBody.content_text).not.toContain("test sandbox");
    expect(laneStartBody.content_text).not.toContain("temporary");
    expect(laneStartBody.content_text).not.toContain("runtime image input");
    expect(laneStartBody.metadata).toMatchObject({ preset_loop_lane: "image_to_image", source: "guided_loop_ui" });
    const quickButton = await screen.findByRole("button", { name: /create graph/i });
    expect(screen.queryByLabelText("Preset builder shortcuts")).toBeNull();
    fireEvent.click(quickButton);

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).endsWith("/media/assistant/sessions/session-1/plans")),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).endsWith("/media/assistant/plans/plan-1/apply")),
      ).toBe(false),
    );
    expect(
      fetchMock.mock.calls.some(
        ([url], index) =>
          index > 0 &&
          String(url).endsWith("/media/assistant/sessions/session-1/messages") &&
          String((fetchMock.mock.calls[index]?.[1] as RequestInit | undefined)?.body || "").includes("suggested setup"),
      ),
    ).toBe(false);
    expect(screen.queryByText("Plan preview")).toBeNull();
    expect(screen.getByText("Choose missing media")).toBeTruthy();
    const invalidWorkflowDetails = screen.getByLabelText("Graph review details") as HTMLDetailsElement;
    expect(invalidWorkflowDetails.open).toBe(false);
    expect(screen.getByText("Details")).toBeTruthy();
    expect(screen.getByText("Choose the required media input before running this graph.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /add reviewed graph/i })).toBeNull();
  });

  it("plans and applies a reviewed graph change", async () => {
    const onApplyWorkflow = vi.fn();
    const onAssistantSessionChange = vi.fn();
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/media/assistant/sessions?")) {
        return jsonResponse({ items: [] });
      }
      if (url.endsWith("/media/assistant/sessions")) {
        return jsonResponse({
          assistant_session_id: "session-1",
          owner_kind: "graph_workflow",
          owner_id: "workflow-1",
          provider_kind: "codex_local",
          status: "active",
          messages: [],
          attachments: [],
        });
      }
      if (url.endsWith("/media/assistant/sessions/session-1/messages")) {
        return jsonResponse({
          assistant_session_id: "session-1",
          owner_kind: "graph_workflow",
          owner_id: "workflow-1",
          provider_kind: "codex_local",
          status: "active",
          messages: [
            {
              assistant_message_id: "message-user",
              assistant_session_id: "session-1",
              role: "user",
              content_text: "Create a reviewable text-to-image workflow",
              content_json: { assistant_mode: "graph" },
            },
            {
              assistant_message_id: "message-assistant",
              assistant_session_id: "session-1",
              role: "assistant",
              content_text: "I can prepare a reviewable graph plan.",
              content_json: { suggested_action: "create_graph_plan" },
            },
          ],
          attachments: [],
        });
      }
      if (url.endsWith("/media/assistant/sessions/session-1/plans")) {
        return jsonResponse(planResponse);
      }
      if (url.endsWith("/media/assistant/plans/plan-1/apply")) {
        return jsonResponse({ ...planResponse, plan: { ...planResponse.plan, status: "applied" } });
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
        latestRunId="run-latest-1"
        references={[]}
        importImageFile={vi.fn()}
        onAssistantSessionChange={onAssistantSessionChange}
        onApplyWorkflow={onApplyWorkflow}
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: /assistant message/i }), {
      target: { value: "Create a reviewable text-to-image workflow" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send chat message/i }));

    await waitFor(() => expect(screen.getByText("Graph ready")).toBeTruthy());
    const assistantThread = screen.getByLabelText("Assistant messages");
    const workflowReview = screen.getByLabelText("Graph review");
    expect(workflowReview).toBeTruthy();
    expect(workflowReview.classList.contains("graph-assistant-message")).toBe(true);
    expect(workflowReview.classList.contains("graph-assistant-plan")).toBe(false);
    expect(assistantThread.contains(workflowReview)).toBe(true);
    const workflowDetails = screen.getByLabelText("Graph review details") as HTMLDetailsElement;
    expect(workflowDetails.open).toBe(false);
    expect(screen.getByText("Details")).toBeTruthy();
    expect(screen.getByText("Text-to-image test graph")).toBeTruthy();
    expect(screen.getByText(/text to image · 0 image inputs/)).toBeTruthy();
    await waitFor(() => expect(onAssistantSessionChange).toHaveBeenCalledWith("session-1"));
    expect(screen.getByText("~6 cr · $0.03")).toBeTruthy();
    expect((screen.getByRole("textbox", { name: /assistant message/i }) as HTMLTextAreaElement).value).toBe("");
    const planCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/media/assistant/sessions/session-1/plans"));
    expect(JSON.parse(String(planCall?.[1]?.body))).toMatchObject({ run_id: "run-latest-1", assistant_mode: "graph" });

    fireEvent.click(screen.getByRole("button", { name: /add reviewed graph/i }));

    await waitFor(() =>
      expect(onApplyWorkflow).toHaveBeenCalledWith(plannedWorkflow, {
        baseWorkflow: workflow,
        highlightNodeIds: ["prompt", "preview"],
      }),
    );
    await waitFor(() => expect(screen.getByText("Graph added")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /add reviewed graph/i })).toBeNull();
  });

  it("creates and applies a clear graph request without exposing a review card first", async () => {
    const onApplyWorkflow = vi.fn();
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/media/assistant/sessions?")) {
        return jsonResponse({ items: [] });
      }
      if (url.endsWith("/media/assistant/sessions")) {
        return jsonResponse({
          assistant_session_id: "session-1",
          owner_kind: "graph_workflow",
          owner_id: "workflow-1",
          provider_kind: "codex_local",
          status: "active",
          messages: [],
          attachments: [],
        });
      }
      if (url.endsWith("/media/assistant/sessions/session-1/messages")) {
        return jsonResponse({
          assistant_session_id: "session-1",
          owner_kind: "graph_workflow",
          owner_id: "workflow-1",
          provider_kind: "codex_local",
          status: "active",
          messages: [
            {
              assistant_message_id: "message-user",
              assistant_session_id: "session-1",
              role: "user",
              content_text: "Create that Seed Dance graph for me",
              content_json: { assistant_mode: "graph" },
            },
            {
              assistant_message_id: "message-assistant",
              assistant_session_id: "session-1",
              role: "assistant",
              content_text: "I can create the graph from the latest storyboard.",
              content_json: { suggested_action: "create_graph_plan" },
            },
          ],
          attachments: [],
        });
      }
      if (url.endsWith("/media/assistant/sessions/session-1/plans")) {
        return jsonResponse(planResponse);
      }
      if (url.endsWith("/media/assistant/plans/plan-1/apply")) {
        return jsonResponse({ ...planResponse, plan: { ...planResponse.plan, status: "applied" } });
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CreativeAssistantPanel
        open
        workspaceKey="tab-auto-apply-graph"
        workflowId="workflow-1"
        workflowName="Assistant Graph"
        workflow={workflow}
        latestRunId={null}
        references={[]}
        importImageFile={vi.fn()}
        onApplyWorkflow={onApplyWorkflow}
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: /assistant message/i }), {
      target: { value: "Create that Seed Dance graph for me" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send chat message/i }));

    await waitFor(() =>
      expect(onApplyWorkflow).toHaveBeenCalledWith(plannedWorkflow, {
        baseWorkflow: workflow,
        highlightNodeIds: ["prompt", "preview"],
      }),
    );
    expect(screen.getByText("Graph added")).toBeTruthy();
    expect(screen.getByText("Here's your graph. I added the nodes to the canvas. Want adjustments, or should we review the prompts?")).toBeTruthy();
    expect(screen.queryByText("Graph ready")).toBeNull();
    expect(screen.queryByRole("button", { name: /add reviewed graph/i })).toBeNull();
  });

  it("does not offer Apply for no-op workflow review plans", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/media/assistant/sessions?")) {
        return jsonResponse({ items: [] });
      }
      if (url.endsWith("/media/assistant/sessions")) {
        return jsonResponse({
          assistant_session_id: "session-1",
          owner_kind: "graph_workflow",
          owner_id: "workflow-1",
          provider_kind: "codex_local",
          status: "active",
          messages: [],
          attachments: [],
        });
      }
      if (url.endsWith("/media/assistant/sessions/session-1/messages")) {
        return jsonResponse({
          assistant_session_id: "session-1",
          owner_kind: "graph_workflow",
          owner_id: "workflow-1",
          provider_kind: "codex_local",
          status: "active",
          messages: [
            {
              assistant_message_id: "message-user",
              assistant_session_id: "session-1",
              role: "user",
              content_text: "Build a graph to combine the approved story clips.",
              content_json: { assistant_mode: "graph" },
            },
            {
              assistant_message_id: "message-assistant",
              assistant_session_id: "session-1",
              role: "assistant",
              content_text: "I will check whether the clips are approved first.",
              content_json: { suggested_action: "create_graph_plan" },
            },
          ],
          attachments: [],
        });
      }
      if (url.endsWith("/media/assistant/sessions/session-1/plans")) {
        return jsonResponse(noOpPlanResponse);
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CreativeAssistantPanel
        open
        workspaceKey="tab-no-op-plan"
        workflowId="workflow-1"
        workflowName="Assistant Graph"
        workflow={workflow}
        latestRunId={null}
        references={[]}
        importImageFile={vi.fn()}
        onApplyWorkflow={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: /assistant message/i }), {
      target: { value: "Build a graph to combine the approved story clips." },
    });
    fireEvent.click(screen.getByRole("button", { name: /send chat message/i }));

    await waitFor(() => expect(screen.getByText("I need one thing first")).toBeTruthy());
    expect(screen.getByText(/I need at least two approved clips before I can stitch them/)).toBeTruthy();
    expect(screen.queryByText("No changes required")).toBeNull();
    expect(screen.queryByText("No canvas changes are required.")).toBeNull();
    expect(screen.queryByRole("button", { name: /add reviewed graph/i })).toBeNull();
  });

  it("does not auto-plan preset intake when the user asks for confirmation first", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/media/assistant/sessions?")) {
        return jsonResponse({ items: [] });
      }
      if (url.endsWith("/media/assistant/sessions")) {
        return jsonResponse({
          assistant_session_id: "session-1",
          owner_kind: "graph_workflow",
          owner_id: "workflow-1",
          provider_kind: "codex_local",
          status: "active",
          messages: [],
          attachments: [],
        });
      }
      if (url.endsWith("/media/assistant/sessions/session-1/messages")) {
        return jsonResponse({
          assistant_session_id: "session-1",
          owner_kind: "graph_workflow",
          owner_id: "workflow-1",
          provider_kind: "codex_local",
          status: "active",
          messages: [
            {
              assistant_message_id: "message-user",
              assistant_session_id: "session-1",
              role: "user",
              content_text:
                "Create both a text-to-image and image-to-image media preset from this reference image. For image-to-image use one input image for the main character or subject. Suggest fields, then ask before creating the test graph.",
              content_json: { assistant_mode: "preset" },
            },
            {
              assistant_message_id: "message-assistant",
              assistant_session_id: "session-1",
              role: "assistant",
              content_text:
                "This looks like `Sunny Giant-Perspective Alley Adventure`.\n\nSuggested setup:\n- Field: Main Character\n- Field: Companion Animal\n- Image input: Main Character / Subject\n\nCreate a test graph with this setup?",
              content_json: { suggested_action: null },
            },
          ],
          attachments: [],
        });
      }
      if (url.endsWith("/media/assistant/sessions/session-1/plans")) {
        return jsonResponse(planResponse);
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
        latestRunId={null}
        references={[]}
        importImageFile={vi.fn()}
        onApplyWorkflow={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /media presets/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /assistant message/i }), {
      target: {
        value:
          "Create both a text-to-image and image-to-image media preset from this reference image. For image-to-image use one input image for the main character or subject. Suggest fields, then ask before creating the test graph.",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /send chat message/i }));

    await waitFor(() => expect(screen.getByText(/Sunny Giant-Perspective Alley Adventure/)).toBeTruthy());
    expect(screen.getByRole("button", { name: /create graph/i })).toBeTruthy();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/media/assistant/sessions/session-1/plans"))).toBe(false);
    expect(screen.queryByText("Graph ready")).toBeNull();
  });

  it("does not auto-apply a quick-reply preset workflow when validation fails", async () => {
    const onApplyWorkflow = vi.fn();
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/media/assistant/sessions?")) {
        return jsonResponse({ items: [] });
      }
      if (url.endsWith("/media/assistant/sessions/session-1")) {
        return jsonResponse({
          assistant_session_id: "session-1",
          owner_kind: "graph_workflow",
          owner_id: "workflow-1",
          provider_kind: "codex_local",
          status: "active",
          messages: [
            {
              assistant_message_id: "message-assistant",
              assistant_session_id: "session-1",
              role: "assistant",
              content_text:
                "This looks like `Cinematic Double-Exposure Travel Poster`. Suggested setup: - Field: Destination - Field: Headline - Image input: Subject Image Create a test graph with this setup?",
              content_json: {},
            },
          ],
          attachments: [],
        });
      }
      if (url.endsWith("/media/assistant/sessions")) {
        return jsonResponse({
          assistant_session_id: "session-1",
          owner_kind: "graph_workflow",
          owner_id: "workflow-1",
          provider_kind: "codex_local",
          status: "active",
          messages: [],
          attachments: [],
        });
      }
      if (url.endsWith("/media/assistant/sessions/session-1/plans")) {
        return jsonResponse(failedPresetTestWorkflowPlanResponse);
      }
      if (url.endsWith("/media/assistant/plans/plan-1/apply")) {
        return jsonResponse({ ...failedPresetTestWorkflowPlanResponse, plan: { ...failedPresetTestWorkflowPlanResponse.plan, status: "applied" } });
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
        latestRunId={null}
        initialAssistantSessionId="session-1"
        references={[]}
        importImageFile={vi.fn()}
        onApplyWorkflow={onApplyWorkflow}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /media presets/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /create graph/i })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /create graph/i }));

    await waitFor(() => expect(screen.getByText("Choose missing media")).toBeTruthy());
    expect(screen.getByText("Choose the required media input before running this graph.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /add reviewed graph/i })).toBeNull();
    expect(onApplyWorkflow).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/media/assistant/plans/plan-1/apply"))).toBe(false);
  });

  it("saves an approved preset workflow from the applied workflow review", async () => {
    const onApplyWorkflow = vi.fn();
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/media/assistant/sessions?")) {
        return jsonResponse({ items: [] });
      }
      if (url.endsWith("/media/assistant/sessions")) {
        return jsonResponse({
          assistant_session_id: "session-1",
          owner_kind: "graph_workflow",
          owner_id: "workflow-1",
          provider_kind: "codex_local",
          status: "active",
          messages: [],
          attachments: [],
        });
      }
      if (url.endsWith("/media/assistant/sessions/session-1/messages")) {
        return jsonResponse({
          assistant_session_id: "session-1",
          owner_kind: "graph_workflow",
          owner_id: "workflow-1",
          provider_kind: "codex_local",
          status: "active",
          messages: [
            {
              assistant_message_id: "message-assistant",
              assistant_session_id: "session-1",
              role: "assistant",
              content_text: "I can save the approved Media Preset directly from Graph Studio.",
              content_json: { mode: "deterministic_preset_save_request", suggested_action: "save_media_preset" },
            },
          ],
          attachments: [],
        });
      }
      if (url.endsWith("/media/assistant/sessions/session-1/plans")) {
        return jsonResponse(planResponse);
      }
      if (url.endsWith("/media/assistant/plans/plan-1/apply")) {
        return jsonResponse({ ...planResponse, plan: { ...planResponse.plan, status: "applied" } });
      }
      if (url.endsWith("/media/assistant/sessions/session-1/preset-saves")) {
        return jsonResponse({
          capability: "save_media_preset",
          artifact_kind: "media_preset",
          created: true,
          message: "Saved Media Preset: Cinematic Double-Exposure Travel Poster.",
          record: {
            preset_id: "preset-1",
            key: "assistant_cinematic_double_exposure_travel_poster",
            label: "Cinematic Double-Exposure Travel Poster",
            status: "active",
            model_key: "gpt-image-2-image-to-image",
            prompt_template: "Create a double-exposure travel poster.",
            input_schema_json: [],
            input_slots_json: [],
          },
          assistant_session: {
            assistant_session_id: "session-1",
            owner_kind: "graph_workflow",
            owner_id: "workflow-1",
            provider_kind: "codex_local",
            status: "active",
            messages: [
              {
                assistant_message_id: "message-saved",
                assistant_session_id: "session-1",
                role: "system_summary",
                content_text: "Saved Media Preset: Cinematic Double-Exposure Travel Poster.",
                content_json: {
                  activity_kind: "media_preset_saved",
                  saved_artifact: {
                    kind: "media_preset",
                    id: "preset-1",
                    key: "assistant_cinematic_double_exposure_travel_poster",
                    label: "Cinematic Double-Exposure Travel Poster",
                  },
                },
              },
            ],
            attachments: [],
          },
        });
      }
      if (url.endsWith("/media/graph/node-definitions/refresh")) {
        return jsonResponse({ items: [] });
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
        latestRunId="run-latest-1"
        references={[]}
        importImageFile={vi.fn()}
        onApplyWorkflow={onApplyWorkflow}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /media presets/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /assistant message/i }), {
      target: { value: "Create an image-to-image test graph." },
    });
    fireEvent.click(screen.getByRole("button", { name: /send chat message/i }));
    await waitFor(() => expect(screen.getByText("Graph ready")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /add reviewed graph/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /save approved workflow as media preset/i })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /save approved workflow as media preset/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/media/assistant/sessions/session-1/preset-saves"),
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const saveCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/media/assistant/sessions/session-1/preset-saves"));
    const saveBody = JSON.parse(String(saveCall?.[1]?.body));
    expect(saveBody.message).toContain("approved workflow");
    expect(saveBody.run_id).toBe("run-latest-1");
    expect(screen.getByText("Media Preset saved")).toBeTruthy();
  });

  it("shows prompt field update plans as canvas changes", async () => {
    const onApplyWorkflow = vi.fn();
    const onUndoLastAssistantChange = vi.fn();
    const fieldUpdatePlan = {
      ...planResponse,
      graph_plan: {
        ...planResponse.graph_plan,
        summary: "Refine the existing preset test prompt.",
        operations: [{ op: "set_node_field", node_id: "prompt", fields: { text: "refined prompt" } }],
      },
      workflow: {
        ...plannedWorkflow,
        nodes: [{ ...plannedWorkflow.nodes[0], fields: { text: "refined prompt" } }],
      },
    };
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/media/assistant/sessions?")) {
        return jsonResponse({ items: [] });
      }
      if (url.endsWith("/media/assistant/sessions")) {
        return jsonResponse({
          assistant_session_id: "session-1",
          owner_kind: "graph_workflow",
          owner_id: "workflow-1",
          provider_kind: "codex_local",
          status: "active",
          messages: [],
          attachments: [],
        });
      }
      if (url.endsWith("/media/assistant/sessions/session-1/messages")) {
        return jsonResponse({
          assistant_session_id: "session-1",
          owner_kind: "graph_workflow",
          owner_id: "workflow-1",
          provider_kind: "codex_local",
          status: "active",
          messages: [
            {
              assistant_message_id: "message-user",
              assistant_session_id: "session-1",
              role: "user",
              content_text: "Refine the test prompt",
              content_json: { assistant_mode: "graph" },
            },
            {
              assistant_message_id: "message-assistant",
              assistant_session_id: "session-1",
              role: "assistant",
              content_text: "I can prepare a reviewable prompt update.",
              content_json: { suggested_action: "create_graph_plan" },
            },
          ],
          attachments: [],
        });
      }
      if (url.endsWith("/media/assistant/sessions/session-1/plans")) {
        return jsonResponse(fieldUpdatePlan);
      }
      if (url.endsWith("/media/assistant/plans/plan-1/apply")) {
        return jsonResponse({ ...fieldUpdatePlan, plan: { ...fieldUpdatePlan.plan, status: "applied" } });
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
        latestRunId="run-latest-1"
        references={[]}
        importImageFile={vi.fn()}
        onApplyWorkflow={onApplyWorkflow}
        onUndoLastAssistantChange={onUndoLastAssistantChange}
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: /assistant message/i }), {
      target: { value: "Refine the test prompt" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send chat message/i }));

    await waitFor(() => expect(screen.getByText("Refine the existing preset test prompt.")).toBeTruthy());
    expect(screen.getByTitle("Updates")).toBeTruthy();
    expect(screen.getByText("Update node fields")).toBeTruthy();
    expect(screen.queryByText("No canvas changes are required.")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /add reviewed graph/i }));

    await waitFor(() =>
      expect(onApplyWorkflow).toHaveBeenCalledWith(fieldUpdatePlan.workflow, {
        baseWorkflow: workflow,
        highlightNodeIds: ["prompt"],
      }),
    );
    await waitFor(() => expect(screen.getByText("Node updated")).toBeTruthy());
    expect(screen.getByText("Refine the existing preset test prompt.")).toBeTruthy();
    expect(screen.getByText("Changed: prompt: text")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /undo assistant node edit/i }));
    expect(onUndoLastAssistantChange).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /add reviewed graph/i })).toBeNull();
  });

  it("auto-creates a preset-mode prompt update plan when the user confirms refinement", async () => {
    const fieldUpdatePlan = {
      ...planResponse,
      graph_plan: {
        ...planResponse.graph_plan,
        summary: "Refine the existing preset test prompt.",
        operations: [{ op: "set_node_field", node_id: "prompt", fields: { text: "refined prompt" } }],
      },
      workflow: {
        ...plannedWorkflow,
        nodes: [{ ...plannedWorkflow.nodes[0], fields: { text: "refined prompt" } }],
      },
    };
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/media/assistant/sessions?")) {
        return jsonResponse({ items: [] });
      }
      if (url.endsWith("/media/assistant/sessions")) {
        return jsonResponse({
          assistant_session_id: "session-1",
          owner_kind: "graph_workflow",
          owner_id: "workflow-1",
          provider_kind: "codex_local",
          status: "active",
          messages: [],
          attachments: [],
        });
      }
      if (url.endsWith("/media/assistant/sessions/session-1/messages")) {
        return jsonResponse({
          assistant_session_id: "session-1",
          owner_kind: "graph_workflow",
          owner_id: "workflow-1",
          provider_kind: "codex_local",
          status: "active",
          messages: [
            {
              assistant_message_id: "message-user",
              assistant_session_id: "session-1",
              role: "user",
              content_text: "yes apply that prompt update to the current draft preset prompt then run it again",
              content_json: { assistant_mode: "preset" },
            },
            {
              assistant_message_id: "message-assistant",
              assistant_session_id: "session-1",
              role: "assistant",
              content_text: "I can prepare that reviewable prompt update now; apply it from the workflow review when it looks right.",
              content_json: { mode: "deterministic_preset_sandbox_refinement", suggested_action: "create_graph_plan" },
            },
          ],
          attachments: [],
        });
      }
      if (url.endsWith("/media/assistant/sessions/session-1/plans")) {
        return jsonResponse(fieldUpdatePlan);
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
        latestRunId="run-latest-1"
        references={[]}
        importImageFile={vi.fn()}
        onApplyWorkflow={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /media presets/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /assistant message/i }), {
      target: { value: "yes apply that prompt update to the current draft preset prompt then run it again" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send chat message/i }));

    await waitFor(() => expect(screen.getByText("Refine the existing preset test prompt.")).toBeTruthy());
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/media/assistant/sessions/session-1/plans"))).toBe(true);
    expect(screen.getByTitle("Updates")).toBeTruthy();
  });

  it("runs the current workflow when the user uses explicit run language", async () => {
    const onRunWorkflow = vi.fn();
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/media/assistant/sessions?")) {
        return jsonResponse({ items: [] });
      }
      if (url.endsWith("/media/assistant/sessions")) {
        return jsonResponse({
          assistant_session_id: "session-1",
          owner_kind: "graph_workflow",
          owner_id: "workflow-1",
          provider_kind: "codex_local",
          status: "active",
          messages: [],
          attachments: [],
        });
      }
      if (url.endsWith("/media/assistant/sessions/session-1/messages")) {
        return jsonResponse({
          assistant_session_id: "session-1",
          owner_kind: "graph_workflow",
          owner_id: "workflow-1",
          provider_kind: "codex_local",
          status: "active",
          messages: [
            {
              assistant_message_id: "message-user",
              assistant_session_id: "session-1",
              role: "user",
              content_text: "execute this",
              content_json: {},
            },
            {
              assistant_message_id: "message-assistant",
              assistant_session_id: "session-1",
              role: "assistant",
              content_text: "I will test the current workflow now.",
              content_json: {
                mode: "deterministic_test_run_request",
                suggested_action: "run_workflow",
                assistant_response_kind: "confirm_paid_or_mutating",
                run_approval_source: "prior_assistant_confirmation",
              },
            },
          ],
          attachments: [],
        });
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
        assistantMode="preset"
        references={[]}
        importImageFile={vi.fn()}
        onApplyWorkflow={vi.fn()}
        onRunWorkflow={onRunWorkflow}
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: /assistant message/i }), {
      target: { value: "execute this" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send chat message/i }));

    await waitFor(() => expect(onRunWorkflow).toHaveBeenCalledTimes(1));
  });

  it("auto-compares the latest completed preset run against attached references once", async () => {
    const sessionBeforeCompare = {
      assistant_session_id: "session-1",
      owner_kind: "graph_workflow",
      owner_id: "workflow-1",
      provider_kind: "codex_local",
      status: "active",
      messages: [],
      attachments: [
        {
          assistant_attachment_id: "attachment-1",
          assistant_session_id: "session-1",
          reference_id: "reference-1",
          kind: "reference_image",
          label: "style.jpg",
        },
      ],
    };
    const sessionAfterCompare = {
      ...sessionBeforeCompare,
      messages: [
        {
          assistant_message_id: "message-auto-user",
          assistant_session_id: "session-1",
          role: "user",
          content_text:
            "Compare the latest generated output against the attached reference style. Keep it short: what matches, what is missing, and whether to refine once or save the preset.",
          content_json: { metadata: { source: "auto_output_compare", auto_compare: true } },
        },
        {
          assistant_message_id: "message-auto-assistant",
          assistant_session_id: "session-1",
          role: "assistant",
          content_text:
            "I compared the latest output against the attached refs.\n- Matches: aged paper and ticket layout are close.\n- Improve: margin sketches need more density.\nWant me to refine and test again, or save this preset?",
          content_json: { mode: "provider_chat", output_aware: true, latest_run_id: "run-complete-1" },
        },
      ],
    };
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes("/media/assistant/sessions?")) {
        return jsonResponse({ items: [sessionBeforeCompare] });
      }
      if (url.endsWith("/media/assistant/sessions/session-1/messages")) {
        return jsonResponse(sessionAfterCompare);
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(
      <CreativeAssistantPanel
        open
        workspaceKey="tab-1"
        workflowId="workflow-1"
        workflowName="Assistant Graph"
        workflow={workflow}
        latestRunId="run-complete-1"
        latestRunStatus="running"
        references={[referenceImage]}
        importImageFile={vi.fn()}
        onApplyWorkflow={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /media presets/i }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/media/assistant/sessions?owner_kind=graph_workflow"))).toBe(true),
    );

    rerender(
      <CreativeAssistantPanel
        open
        workspaceKey="tab-1"
        workflowId="workflow-1"
        workflowName="Assistant Graph"
        workflow={workflow}
        latestRunId="run-complete-1"
        latestRunStatus="completed"
        references={[referenceImage]}
        importImageFile={vi.fn()}
        onApplyWorkflow={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText(/aged paper and ticket layout are close/i)).toBeTruthy());
    expect(screen.queryByText(/Compare the latest generated output against the attached reference style/i)).toBeNull();
    const messageCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/media/assistant/sessions/session-1/messages"));
    expect(messageCalls).toHaveLength(1);
    expect(JSON.parse(String(messageCalls[0][1]?.body))).toMatchObject({
      run_id: "run-complete-1",
      assistant_mode: "preset",
      metadata: { source: "auto_output_compare", auto_compare: true },
    });

    rerender(
      <CreativeAssistantPanel
        open
        workspaceKey="tab-1"
        workflowId="workflow-1"
        workflowName="Assistant Graph"
        workflow={workflow}
        latestRunId="run-complete-1"
        latestRunStatus="completed"
        references={[referenceImage]}
        importImageFile={vi.fn()}
        onApplyWorkflow={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/media/assistant/sessions/session-1/messages"))).toHaveLength(1));
  });

  it("does not auto-compare completed runs outside preset mode or without references", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/media/assistant/sessions?")) {
        return jsonResponse({
          items: [
            {
              assistant_session_id: "session-1",
              owner_kind: "graph_workflow",
              owner_id: "workflow-1",
              provider_kind: "codex_local",
              status: "active",
              messages: [],
              attachments: [],
            },
          ],
        });
      }
      if (url.endsWith("/media/assistant/sessions/session-1/messages")) {
        return jsonResponse({ assistant_session_id: "session-1", messages: [], attachments: [] });
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
        latestRunId="run-complete-1"
        latestRunStatus="completed"
        references={[]}
        importImageFile={vi.fn()}
        onApplyWorkflow={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/media/assistant/sessions?owner_kind=graph_workflow"))).toBe(true),
    );
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/media/assistant/sessions/session-1/messages"))).toBe(false);
  });

  it("does not auto-compare when the current run already has an output-aware assistant message", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/media/assistant/sessions?")) {
        return jsonResponse({
          items: [
            {
              assistant_session_id: "session-1",
              owner_kind: "graph_workflow",
              owner_id: "workflow-1",
              provider_kind: "codex_local",
              status: "active",
              messages: [
                {
                  assistant_message_id: "message-output-aware",
                  assistant_session_id: "session-1",
                  role: "assistant",
                  content_text: "I compared the latest output against the attached refs.",
                  content_json: { output_aware: true, latest_run_id: "run-complete-1" },
                },
              ],
              attachments: [
                {
                  assistant_attachment_id: "attachment-1",
                  assistant_session_id: "session-1",
                  reference_id: "reference-1",
                  kind: "reference_image",
                  label: "style.jpg",
                },
              ],
            },
          ],
        });
      }
      if (url.endsWith("/media/assistant/sessions/session-1/messages")) {
        return jsonResponse({ assistant_session_id: "session-1", messages: [], attachments: [] });
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
        latestRunId="run-complete-1"
        latestRunStatus="completed"
        references={[referenceImage]}
        importImageFile={vi.fn()}
        onApplyWorkflow={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /media presets/i }));
    await waitFor(() => expect(screen.getByText("I compared the latest output against the attached refs.")).toBeTruthy());
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/media/assistant/sessions/session-1/messages"))).toBe(false);
  });

  it("saves a Media Preset directly when the user approves the current result in chat", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/media/assistant/sessions?")) {
        return jsonResponse({ items: [] });
      }
      if (url.endsWith("/media/assistant/sessions")) {
        return jsonResponse({
          assistant_session_id: "session-1",
          owner_kind: "graph_workflow",
          owner_id: "workflow-1",
          provider_kind: "codex_local",
          status: "active",
          messages: [],
          attachments: [],
        });
      }
      if (url.endsWith("/media/assistant/sessions/session-1/messages")) {
        return jsonResponse({
          assistant_session_id: "session-1",
          owner_kind: "graph_workflow",
          owner_id: "workflow-1",
          provider_kind: "codex_local",
          status: "active",
          messages: [
            {
              assistant_message_id: "message-user",
              assistant_session_id: "session-1",
              role: "user",
              content_text:
                "This result is close enough. Create the official Media Preset now from this sandbox. Use the last generated image as the thumbnail. Keep one required Personal Reference image input and one Banner Text field.",
              content_json: {},
            },
            {
              assistant_message_id: "message-assistant",
              assistant_session_id: "session-1",
              role: "assistant",
              content_text: "I can save the approved Media Preset directly from Graph Studio.",
              content_json: { mode: "deterministic_preset_save_request", suggested_action: "save_media_preset" },
            },
          ],
          attachments: [],
        });
      }
      if (url.endsWith("/media/assistant/sessions/session-1/preset-saves")) {
        return jsonResponse({
          capability: "save_media_preset",
          artifact_kind: "media_preset",
          created: true,
          message: "Saved Media Preset: Skateboard Character.",
          record: {
            preset_id: "preset-1",
            key: "assistant_skateboard_character",
            label: "Skateboard Character",
            status: "active",
            model_key: "nano-banana-2",
            applies_to_models: ["nano-banana-2"],
            prompt_template: "Create a skater character.",
            input_schema_json: [],
            input_slots_json: [],
          },
          assistant_session: {
            assistant_session_id: "session-1",
            owner_kind: "graph_workflow",
            owner_id: "workflow-1",
            provider_kind: "codex_local",
            status: "active",
            messages: [
              {
                assistant_message_id: "message-user",
                assistant_session_id: "session-1",
                role: "user",
                content_text:
                  "This result is close enough. Create the official Media Preset now from this sandbox. Use the last generated image as the thumbnail. Keep one required Personal Reference image input and one Banner Text field.",
                content_json: {},
              },
              {
                assistant_message_id: "message-saved",
                assistant_session_id: "session-1",
                role: "system_summary",
                content_text: "Saved Media Preset: Skateboard Character.",
                content_json: {
                  activity_kind: "media_preset_saved",
                  saved_artifact: {
                    kind: "media_preset",
                    id: "preset-1",
                    key: "assistant_skateboard_character",
                    label: "Skateboard Character",
                  },
                },
              },
            ],
            attachments: [],
          },
        });
      }
      if (url.endsWith("/media/graph/node-definitions/refresh")) {
        return jsonResponse({ items: [] });
      }
      if (url.endsWith("/media/assistant/sessions/session-1/plans")) {
        return jsonResponse(planResponse);
      }
      if (url.endsWith("/media/assistant/plans/plan-1/apply")) {
        return jsonResponse({ ...planResponse, plan: { ...planResponse.plan, status: "applied" } });
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
        latestRunId="run-latest-1"
        reviewReturnTo="/graph-studio?tab=tab-1"
        references={[]}
        importImageFile={vi.fn()}
        onApplyWorkflow={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: /assistant message/i }), {
      target: {
        value:
          "This result is close enough. Create the official Media Preset now from this sandbox. Use the last generated image as the thumbnail. Keep one required Personal Reference image input and one Banner Text field.",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /send chat message/i }));

    await waitFor(() => expect(screen.getByText("Media Preset saved")).toBeTruthy());
    expect(screen.getByRole("button", { name: /use skateboard character in this graph/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /open skateboard character editor/i })).toBeTruthy();
    expect(openAssistantReviewUrlMock).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/media/assistant/sessions/session-1/plans"))).toBe(false);
    const saveCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/media/assistant/sessions/session-1/preset-saves"));
    expect(JSON.parse(String(saveCall?.[1]?.body))).toMatchObject({
      message:
        "This result is close enough. Create the official Media Preset now from this sandbox. Use the last generated image as the thumbnail. Keep one required Personal Reference image input and one Banner Text field.",
      run_id: "run-latest-1",
      workflow,
    });
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/media/graph/node-definitions/refresh"))).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /use skateboard character in this graph/i }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/media/assistant/sessions/session-1/plans"),
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const planCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/media/assistant/sessions/session-1/plans"));
    const planBody = JSON.parse(String(planCall?.[1]?.body));
    expect(planBody.message).toContain("saved Media Preset named Skateboard Character");
    expect(planBody.message).toContain("key assistant_skateboard_character");
    expect(planBody.message).toContain("clean replacement workflow");
    expect(planBody.workflow).toMatchObject({
      name: "Skateboard Character workflow",
      nodes: [],
      edges: [],
    });

    fireEvent.click(screen.getByRole("button", { name: /add reviewed graph/i }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/media/assistant/plans/plan-1/apply"),
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const applyCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/media/assistant/plans/plan-1/apply"));
    expect(JSON.parse(String(applyCall?.[1]?.body)).workflow).toMatchObject({
      name: "Skateboard Character workflow",
      nodes: [],
      edges: [],
    });

    fireEvent.click(screen.getByRole("button", { name: /open skateboard character editor/i }));
    expect(openAssistantReviewUrlMock).toHaveBeenCalledWith("/presets/preset-1?returnTo=%2Fgraph-studio%3Ftab%3Dtab-1");
  });

  it("routes temporary sandbox requests to graph planning instead of direct preset save", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/media/assistant/sessions?")) {
        return jsonResponse({ items: [] });
      }
      if (url.endsWith("/media/assistant/sessions")) {
        return jsonResponse({
          assistant_session_id: "session-1",
          owner_kind: "graph_workflow",
          owner_id: "workflow-1",
          provider_kind: "codex_local",
          status: "active",
          messages: [],
          attachments: [],
        });
      }
      if (url.endsWith("/media/assistant/sessions/session-1/messages")) {
        return jsonResponse({
          assistant_session_id: "session-1",
          owner_kind: "graph_workflow",
          owner_id: "workflow-1",
          provider_kind: "codex_local",
          status: "active",
          messages: [
            {
              assistant_message_id: "message-user",
              assistant_session_id: "session-1",
              role: "user",
              content_text: "yes keep the person image required and create the image-to-image test sandbox now",
              content_json: {},
            },
            {
              assistant_message_id: "message-assistant",
              assistant_session_id: "session-1",
              role: "assistant",
              content_text: "I can create the test sandbox graph for review.",
              content_json: { mode: "provider_chat", suggested_action: "save_media_preset" },
            },
          ],
          attachments: [],
        });
      }
      if (url.endsWith("/media/assistant/sessions/session-1/plans")) {
        return jsonResponse(planResponse);
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
        latestRunId={null}
        reviewReturnTo="/graph-studio?tab=tab-1"
        references={[]}
        importImageFile={vi.fn()}
        onApplyWorkflow={vi.fn()}
        onClose={vi.fn()}
        assistantMode="preset"
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: /assistant message/i }), {
      target: { value: "yes keep the person image required and create the temporary image to image sandbox now" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send chat message/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/media/assistant/sessions/session-1/plans"),
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/media/assistant/sessions/session-1/preset-saves"))).toBe(false);
  });

  it("saves a text-to-image Media Preset when the user asks to use the latest output as thumbnail", async () => {
    const saveRequest =
      "Save the text-to-image sandbox as a separate official Media Preset. No image inputs. Use the latest text-to-image output as the thumbnail.";
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/media/assistant/sessions?")) {
        return jsonResponse({ items: [] });
      }
      if (url.endsWith("/media/assistant/sessions")) {
        return jsonResponse({
          assistant_session_id: "session-1",
          owner_kind: "graph_workflow",
          owner_id: "workflow-1",
          provider_kind: "codex_local",
          status: "active",
          messages: [],
          attachments: [],
        });
      }
      if (url.endsWith("/media/assistant/sessions/session-1/messages")) {
        return jsonResponse({
          assistant_session_id: "session-1",
          owner_kind: "graph_workflow",
          owner_id: "workflow-1",
          provider_kind: "codex_local",
          status: "active",
          messages: [
            {
              assistant_message_id: "message-user",
              assistant_session_id: "session-1",
              role: "user",
              content_text: saveRequest,
              content_json: {},
            },
            {
              assistant_message_id: "message-assistant",
              assistant_session_id: "session-1",
              role: "assistant",
              content_text: "I can save the approved Media Preset directly from Graph Studio.",
              content_json: { mode: "deterministic_preset_save_request", suggested_action: "save_media_preset" },
            },
          ],
          attachments: [],
        });
      }
      if (url.endsWith("/media/assistant/sessions/session-1/preset-saves")) {
        return jsonResponse({
          capability: "save_media_preset",
          artifact_kind: "media_preset",
          created: true,
          message: "Saved Media Preset: Pop-Punk Grunge Poster Text.",
          record: {
            preset_id: "preset-t2i",
            key: "assistant_pop_punk_grunge_poster_text",
            label: "Pop-Punk Grunge Poster Text",
            status: "active",
            model_key: "gpt-image-2",
            applies_to_models: ["gpt-image-2"],
            prompt_template: "Create a pop-punk grunge poster.",
            input_schema_json: [],
            input_slots_json: [],
          },
          assistant_session: {
            assistant_session_id: "session-1",
            owner_kind: "graph_workflow",
            owner_id: "workflow-1",
            provider_kind: "codex_local",
            status: "active",
            messages: [
              {
                assistant_message_id: "message-user",
                assistant_session_id: "session-1",
                role: "user",
                content_text: saveRequest,
                content_json: {},
              },
              {
                assistant_message_id: "message-saved",
                assistant_session_id: "session-1",
                role: "system_summary",
                content_text: "Saved Media Preset: Pop-Punk Grunge Poster Text.",
                content_json: {
                  activity_kind: "media_preset_saved",
                  saved_artifact: {
                    kind: "media_preset",
                    id: "preset-t2i",
                    key: "assistant_pop_punk_grunge_poster_text",
                    label: "Pop-Punk Grunge Poster Text",
                  },
                },
              },
            ],
            attachments: [],
          },
        });
      }
      if (url.endsWith("/media/graph/node-definitions/refresh")) {
        return jsonResponse({ items: [] });
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
        latestRunId="run-t2i-1"
        reviewReturnTo="/graph-studio?tab=tab-1"
        references={[]}
        importImageFile={vi.fn()}
        onApplyWorkflow={vi.fn()}
        onClose={vi.fn()}
        assistantMode="preset"
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: /assistant message/i }), {
      target: { value: saveRequest },
    });
    fireEvent.click(screen.getByRole("button", { name: /send chat message/i }));

    await waitFor(() => expect(screen.getByText("Media Preset saved")).toBeTruthy());
    const saveCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/media/assistant/sessions/session-1/preset-saves"));
    expect(JSON.parse(String(saveCall?.[1]?.body))).toMatchObject({
      message: saveRequest,
      run_id: "run-t2i-1",
      workflow,
    });
  });

  it("does not auto-plan preset messages that ask for a question before sandbox", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/media/assistant/sessions?")) {
        return jsonResponse({ items: [] });
      }
      if (url.endsWith("/media/assistant/sessions")) {
        return jsonResponse({
          assistant_session_id: "session-1",
          owner_kind: "graph_workflow",
          owner_id: "workflow-1",
          provider_kind: "codex_local",
          status: "active",
          messages: [],
          attachments: [],
        });
      }
      if (url.endsWith("/media/assistant/sessions/session-1/messages")) {
        return jsonResponse({
          assistant_session_id: "session-1",
          owner_kind: "graph_workflow",
          owner_id: "workflow-1",
          provider_kind: "codex_local",
          status: "active",
          messages: [
            {
              assistant_message_id: "message-user",
              assistant_session_id: "session-1",
              role: "user",
              content_text: "suggest two useful fields and ask one short question before sandbox",
              content_json: {},
            },
            {
              assistant_message_id: "message-assistant",
              assistant_session_id: "session-1",
              role: "assistant",
              content_text: "Do you want the runtime image to be required?",
              content_json: { mode: "provider_chat", suggested_action: "create_graph_plan" },
            },
          ],
          attachments: [],
        });
      }
      if (url.endsWith("/media/assistant/sessions/session-1/plans")) {
        return jsonResponse(planResponse);
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
        onApplyWorkflow={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /media presets/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /assistant message/i }), {
      target: { value: "suggest two useful fields and ask one short question before sandbox" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send chat message/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/media/assistant/sessions/session-1/messages"),
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/media/assistant/sessions/session-1/plans"))).toBe(false);
  });

  it("does not open a Media Preset draft when the assistant asks for clarification", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/media/assistant/sessions?")) {
        return jsonResponse({ items: [] });
      }
      if (url.endsWith("/media/assistant/sessions")) {
        return jsonResponse({
          assistant_session_id: "session-1",
          owner_kind: "graph_workflow",
          owner_id: "workflow-1",
          provider_kind: "codex_local",
          status: "active",
          messages: [],
          attachments: [],
        });
      }
      if (url.endsWith("/media/assistant/sessions/session-1/messages")) {
        return jsonResponse({
          assistant_session_id: "session-1",
          owner_kind: "graph_workflow",
          owner_id: "workflow-1",
          provider_kind: "codex_local",
          status: "active",
          messages: [
            {
              assistant_message_id: "message-user",
              assistant_session_id: "session-1",
              role: "user",
              content_text: "Yeah let's create the media preset now based upon this",
              content_json: {},
            },
            {
              assistant_message_id: "message-assistant",
              assistant_session_id: "session-1",
              role: "assistant",
              content_text: "Do you want me to create it from the current sandbox or start a new preset?",
              content_json: { mode: "deterministic_clarify_action", suggested_action: "clarify" },
            },
          ],
          attachments: [],
        });
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
        latestRunId="run-latest-1"
        reviewReturnTo="/graph-studio?tab=tab-1"
        references={[]}
        importImageFile={vi.fn()}
        onApplyWorkflow={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: /assistant message/i }), {
      target: { value: "Yeah let's create the media preset now based upon this" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send chat message/i }));

    await waitFor(() => expect(screen.getByText(/do you want me to create it/i)).toBeTruthy());
    expect(openAssistantReviewUrlMock).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/media/assistant/sessions/session-1/preset-drafts"))).toBe(false);
  });

  it("saves a Prompt Recipe directly when the user approves it in recipe mode", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/media/assistant/sessions?")) {
        return jsonResponse({ items: [] });
      }
      if (url.endsWith("/media/assistant/sessions")) {
        return jsonResponse({
          assistant_session_id: "session-1",
          owner_kind: "graph_workflow",
          owner_id: "workflow-1",
          provider_kind: "codex_local",
          status: "active",
          messages: [],
          attachments: [],
        });
      }
      if (url.endsWith("/media/assistant/sessions/session-1/messages")) {
        return jsonResponse({
          assistant_session_id: "session-1",
          owner_kind: "graph_workflow",
          owner_id: "workflow-1",
          provider_kind: "codex_local",
          status: "active",
          messages: [
            {
              assistant_message_id: "message-user",
              assistant_session_id: "session-1",
              role: "user",
              content_text: "Save this prompt recipe now",
              content_json: {},
            },
            {
              assistant_message_id: "message-assistant",
              assistant_session_id: "session-1",
              role: "assistant",
              content_text: "I can save the approved Prompt Recipe directly from Graph Studio.",
              content_json: { mode: "deterministic_recipe_save_request", suggested_action: "save_prompt_recipe" },
            },
          ],
          attachments: [],
        });
      }
      if (url.endsWith("/media/assistant/sessions/session-1/recipe-saves")) {
        return jsonResponse({
          capability: "save_prompt_recipe",
          artifact_kind: "prompt_recipe",
          created: true,
          message: "Saved Prompt Recipe: Cinematic Portrait.",
          record: { recipe_id: "recipe-1", key: "assistant_cinematic_portrait", label: "Cinematic Portrait" },
          assistant_session: {
            assistant_session_id: "session-1",
            owner_kind: "graph_workflow",
            owner_id: "workflow-1",
            provider_kind: "codex_local",
            status: "active",
            messages: [
              {
                assistant_message_id: "message-user",
                assistant_session_id: "session-1",
                role: "user",
                content_text: "Save this prompt recipe now",
                content_json: {},
              },
              {
                assistant_message_id: "message-saved",
                assistant_session_id: "session-1",
                role: "system_summary",
                content_text: "Saved Prompt Recipe: Cinematic Portrait.",
                content_json: {
                  activity_kind: "prompt_recipe_saved",
                  saved_artifact: {
                    kind: "prompt_recipe",
                    id: "recipe-1",
                    key: "assistant_cinematic_portrait",
                    label: "Cinematic Portrait",
                  },
                },
              },
            ],
            attachments: [],
          },
        });
      }
      if (url.endsWith("/media/graph/node-definitions/refresh")) {
        return jsonResponse({ items: [] });
      }
      if (url.endsWith("/media/assistant/sessions/session-1/plans")) {
        return jsonResponse(planResponse);
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
        onApplyWorkflow={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Recipes" }));
    fireEvent.change(screen.getByRole("textbox", { name: /assistant message/i }), {
      target: { value: "Save this prompt recipe now" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send chat message/i }));

    await waitFor(() => expect(screen.getByText("Prompt Recipe saved")).toBeTruthy());
    expect(screen.getByRole("button", { name: /use cinematic portrait in this graph/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /open cinematic portrait editor/i })).toBeTruthy();
    expect(openAssistantReviewUrlMock).not.toHaveBeenCalled();
    const saveCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/media/assistant/sessions/session-1/recipe-saves"));
    expect(JSON.parse(String(saveCall?.[1]?.body))).toMatchObject({
      message: "Save this prompt recipe now",
      assistant_mode: "recipe",
    });

    fireEvent.click(screen.getByRole("button", { name: /use cinematic portrait in this graph/i }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/media/assistant/sessions/session-1/plans"),
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const planCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/media/assistant/sessions/session-1/plans"));
    expect(JSON.parse(String(planCall?.[1]?.body)).message).toContain("saved Prompt Recipe named Cinematic Portrait");
  });

  it("loads an explicit assistant session for a fresh standalone graph tab", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/media/assistant/sessions/session-standalone")) {
        return jsonResponse({
          assistant_session_id: "session-standalone",
          owner_kind: "standalone",
          owner_id: null,
          provider_kind: "codex_local",
          status: "active",
          messages: [],
          attachments: [
            {
              assistant_attachment_id: "attachment-1",
              assistant_session_id: "session-standalone",
              reference_id: "reference-1",
              kind: "image",
              label: "chr-sheet.jpg",
            },
          ],
        });
      }
      if (url.endsWith("/media/assistant/sessions/session-1/plans")) {
        return jsonResponse(planResponse);
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CreativeAssistantPanel
        open
        workspaceKey="tab-fresh"
        workflowId={null}
        workflowName="New workflow"
        workflow={{ ...workflow, workflow_id: null, name: "New workflow" }}
        initialAssistantSessionId="session-standalone"
        references={[{ ...referenceImage, original_filename: "chr-sheet.jpg" }]}
        importImageFile={vi.fn()}
        onApplyWorkflow={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/control/media/assistant/sessions/session-standalone",
        expect.objectContaining({ cache: "no-store" }),
      ),
    );
    expect(await screen.findByText("1 / 8")).toBeTruthy();
    expect(screen.getByTestId("graph-assistant-reference-thumb-attachment-1")).toBeTruthy();
  });

  it("switches to a newly requested assistant session in the same graph tab", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/media/assistant/sessions/session-old")) {
        return jsonResponse({
          assistant_session_id: "session-old",
          owner_kind: "standalone",
          owner_id: null,
          provider_kind: "codex_local",
          status: "active",
          messages: [
            {
              assistant_message_id: "message-old",
              assistant_session_id: "session-old",
              role: "user",
              content_text: "old assistant thread",
            },
          ],
          attachments: [],
        });
      }
      if (url.endsWith("/media/assistant/sessions/session-new")) {
        return jsonResponse({
          assistant_session_id: "session-new",
          owner_kind: "standalone",
          owner_id: null,
          provider_kind: "codex_local",
          status: "active",
          messages: [
            {
              assistant_message_id: "message-new",
              assistant_session_id: "session-new",
              role: "assistant",
              content_text: "new output-aware refinement",
            },
          ],
          attachments: [],
        });
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(
      <CreativeAssistantPanel
        open
        workspaceKey="tab-same"
        workflowId={null}
        workflowName="New workflow"
        workflow={{ ...workflow, workflow_id: null, name: "New workflow" }}
        initialAssistantSessionId="session-old"
        references={[]}
        importImageFile={vi.fn()}
        onApplyWorkflow={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText("old assistant thread")).toBeTruthy());

    rerender(
      <CreativeAssistantPanel
        open
        workspaceKey="tab-same"
        workflowId={null}
        workflowName="New workflow"
        workflow={{ ...workflow, workflow_id: null, name: "New workflow" }}
        initialAssistantSessionId="session-new"
        references={[]}
        importImageFile={vi.fn()}
        onApplyWorkflow={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText("new output-aware refinement")).toBeTruthy());
    expect(screen.queryByText("old assistant thread")).toBeNull();
  });

  it("clears the transcript when switching to a fresh graph tab without a session", async () => {
    const onAssistantSessionChange = vi.fn();
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/media/assistant/sessions/session-old")) {
        return jsonResponse({
          assistant_session_id: "session-old",
          owner_kind: "standalone",
          owner_id: null,
          provider_kind: "codex_local",
          status: "active",
          messages: [
            {
              assistant_message_id: "message-old",
              assistant_session_id: "session-old",
              role: "user",
              content_text: "old tab prompt",
            },
          ],
          attachments: [],
        });
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(
      <CreativeAssistantPanel
        open
        workspaceKey="tab-old"
        workflowId={null}
        workflowName="New workflow"
        workflow={{ ...workflow, workflow_id: null, name: "New workflow" }}
        initialAssistantSessionId="session-old"
        references={[]}
        importImageFile={vi.fn()}
        onAssistantSessionChange={onAssistantSessionChange}
        onApplyWorkflow={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText("old tab prompt")).toBeTruthy());
    onAssistantSessionChange.mockClear();

    rerender(
      <CreativeAssistantPanel
        open
        workspaceKey="tab-new"
        workflowId={null}
        workflowName="New workflow"
        workflow={{ ...workflow, workflow_id: null, name: "New workflow" }}
        initialAssistantSessionId={null}
        references={[]}
        importImageFile={vi.fn()}
        onAssistantSessionChange={onAssistantSessionChange}
        onApplyWorkflow={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.queryByText("old tab prompt")).toBeNull());
    expect(screen.getByText("Describe the graph you want. I can add it to the canvas when the request is clear.")).toBeTruthy();
    expect(onAssistantSessionChange).not.toHaveBeenCalledWith("session-old");
  });

  it("renders user and assistant chat bubbles after sending a message", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/media/assistant/sessions?")) {
        return jsonResponse({ items: [] });
      }
      if (url.endsWith("/media/assistant/sessions")) {
        return jsonResponse({
          assistant_session_id: "session-1",
          owner_kind: "graph_workflow",
          owner_id: "workflow-1",
          provider_kind: "codex_local",
          status: "active",
          messages: [],
          attachments: [],
        });
      }
      if (url.endsWith("/media/assistant/sessions/session-1/messages")) {
        return jsonResponse({
          assistant_session_id: "session-1",
          owner_kind: "graph_workflow",
          owner_id: "workflow-1",
          provider_kind: "codex_local",
          status: "active",
          messages: [
            {
              assistant_message_id: "message-user",
              assistant_session_id: "session-1",
              role: "user",
              content_text: "Help me with this image idea",
            },
            {
              assistant_message_id: "message-assistant",
              assistant_session_id: "session-1",
              role: "assistant",
              content_text: "I can help plan that workflow.",
            },
          ],
          attachments: [],
        });
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
        latestRunId="run-latest-1"
        references={[]}
        importImageFile={vi.fn()}
        onApplyWorkflow={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: /assistant message/i }), {
      target: { value: "Help me with this image idea" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send chat message/i }));

    await waitFor(() => expect(screen.getByText("I can help plan that workflow.")).toBeTruthy());
    expect(screen.getByText("Help me with this image idea")).toBeTruthy();
    expect(screen.getByText("You")).toBeTruthy();
    expect(screen.getAllByText("Media Assistant").length).toBeGreaterThan(0);
    const messageCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/media/assistant/sessions/session-1/messages"));
    expect(JSON.parse(String(messageCall?.[1]?.body))).toMatchObject({ run_id: "run-latest-1" });
  });

  it("renders compact preset-builder proposals in chat", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/media/assistant/sessions?")) {
        return jsonResponse({
          items: [
            {
              assistant_session_id: "session-existing",
              owner_kind: "graph_workflow",
              owner_id: "workflow-1",
              provider_kind: "codex_local",
              status: "active",
              messages: [
                {
                  assistant_message_id: "message-assistant",
                  assistant_session_id: "session-existing",
                  role: "assistant",
                  content_text:
                    "I can shape this into a Skateboard Character preset with face and body references plus one style notes field.",
                  content_json: {
                    assistant_mode: "preset",
                    preset_builder_proposal: {
                      title: "Skateboard Character",
                      visual_summary: { style: "Skateboard streetwear character render" },
                      preset_contract: {
                        image_slots: [
                          { key: "face_reference", label: "Face Reference", required: true },
                          { key: "body_reference", label: "Body Reference", required: true },
                        ],
                        fields: [{ key: "style_notes", label: "Style Notes", required: false }],
                      },
                      questions: ["Should the skateboard look stay fixed?"],
                    },
                  },
                },
              ],
              attachments: [],
            },
          ],
        });
      }
      if (url.endsWith("/media/assistant/sessions/session-1/plans")) {
        return jsonResponse(planResponse);
      }
      if (url.endsWith("/media/assistant/plans/plan-1/apply")) {
        return jsonResponse({ ...planResponse, plan: { ...planResponse.plan, status: "applied" } });
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
        onApplyWorkflow={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const details = await waitFor(() => screen.getByLabelText("Suggested preset setup") as HTMLDetailsElement);
    expect(details.open).toBe(false);
    expect(screen.getByText("Preset details")).toBeTruthy();
    expect(screen.getByText("Skateboard Character")).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("button", { name: /image-to-image/i })).toBeTruthy());
    expect(screen.getByRole("button", { name: /text-to-image/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /both/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /change fields/i })).toBeTruthy();
    fireEvent.click(screen.getByText("Preset details"));
    expect(details.open).toBe(true);
    expect(screen.getByText("Face Reference required")).toBeTruthy();
    expect(screen.getByText("Body Reference required")).toBeTruthy();
    expect(screen.getByText("Style Notes optional")).toBeTruthy();
    expect(screen.getByText("Should the skateboard look stay fixed?")).toBeTruthy();
  });

  it("does not render preset action chips for prompt-only reference answers", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/media/assistant/sessions?")) {
        return jsonResponse({
          items: [
            {
              assistant_session_id: "session-existing",
              owner_kind: "graph_workflow",
              owner_id: "workflow-1",
              provider_kind: "codex_local",
              status: "active",
              messages: [
                {
                  assistant_message_id: "message-assistant",
                  assistant_session_id: "session-existing",
                  role: "assistant",
                  content_text:
                    "Here is a full prompt from the attached reference style:\n\n```text\nRetro Monster Snack Poster: a screen-printed mascot poster with risograph grain, chunky rounded creature silhouette, and oversized snack prop.\n```",
                  content_json: {
                    assistant_mode: "preset",
                    mode: "reference_style_prompt_only",
                    preset_builder_proposal: {
                      title: "Retro Monster Snack Poster",
                      visual_summary: { style: "Screen-printed snack mascot poster" },
                      preset_contract: {
                        image_slots: [],
                        fields: [
                          { key: "creature_type", label: "Creature Type", required: true },
                          { key: "featured_snack", label: "Featured Snack", required: false },
                        ],
                      },
                    },
                  },
                },
              ],
              attachments: [],
            },
          ],
        });
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
        onApplyWorkflow={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText(/Here is a full prompt from the attached reference style/i)).toBeTruthy());
    expect(screen.getByText(/Retro Monster Snack Poster: a screen-printed mascot poster/i)).toBeTruthy();
    expect(screen.queryByLabelText("Suggested preset setup")).toBeNull();
    expect(screen.queryByRole("button", { name: /image-to-image/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /text-to-image/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^both$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /change fields/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /create graph/i })).toBeNull();
  });

  it("offers one-click preset save and prompt-update replies after comparison guidance", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/media/assistant/sessions?")) {
        return jsonResponse({
          items: [
            {
              assistant_session_id: "session-existing",
              owner_kind: "graph_workflow",
              owner_id: "workflow-1",
              provider_kind: "codex_local",
              status: "active",
              messages: [
                {
                  assistant_message_id: "message-save-ready",
                  assistant_session_id: "session-existing",
                  role: "assistant",
                  content_text:
                    "I compared the latest output against the attached refs.\n- Matches: color and framing are close.\nIf you approve it, tell me to create the Media Preset from this result.",
                  content_json: {},
                },
                {
                  assistant_message_id: "message-refine-ready",
                  assistant_session_id: "session-existing",
                  role: "assistant",
                  content_text:
                    "I compared the latest output against the attached refs.\n- Missing: the paper texture needs more grit.\nI can prepare a reviewable prompt update now; apply it from the workflow review, then test it again.",
                  content_json: { output_aware: true, latest_run_id: "run-complete-1" },
                },
              ],
              attachments: [],
            },
          ],
        });
      }
      if (url.endsWith("/media/assistant/sessions/session-1/plans")) {
        return jsonResponse(planResponse);
      }
      if (url.endsWith("/media/assistant/plans/plan-1/apply")) {
        return jsonResponse({ ...planResponse, plan: { ...planResponse.plan, status: "applied" } });
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
        onApplyWorkflow={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getAllByRole("button", { name: /save preset/i }).length).toBeGreaterThan(0));
    expect(screen.getByRole("button", { name: /refine \+ test again/i })).toBeTruthy();
  });

  it("auto-plans saved preset key workflow requests in preset mode", async () => {
    const request = "Create a graph workflow using saved Media Preset key shared_style_image.";
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/media/assistant/sessions?")) {
        return jsonResponse({ items: [] });
      }
      if (url.endsWith("/media/assistant/sessions")) {
        return jsonResponse({
          assistant_session_id: "session-1",
          owner_kind: "graph_workflow",
          owner_id: "workflow-1",
          provider_kind: "codex_local",
          status: "active",
          messages: [],
          attachments: [],
        });
      }
      if (url.endsWith("/media/assistant/sessions/session-1/messages")) {
        return jsonResponse({
          assistant_session_id: "session-1",
          owner_kind: "graph_workflow",
          owner_id: "workflow-1",
          provider_kind: "codex_local",
          status: "active",
          messages: [
            {
              assistant_message_id: "message-user",
              assistant_session_id: "session-1",
              role: "user",
              content_text: request,
              content_json: {},
            },
            {
              assistant_message_id: "message-assistant",
              assistant_session_id: "session-1",
              role: "assistant",
              content_text: "I will prepare a saved Media Preset test graph using the exact preset key/id you provided.",
              content_json: { mode: "deterministic_saved_preset_workflow_request", suggested_action: "create_graph_plan" },
            },
          ],
          attachments: [],
        });
      }
      if (url.endsWith("/media/assistant/sessions/session-1/plans")) {
        return jsonResponse({
          ...planResponse,
          graph_plan: {
            ...planResponse.graph_plan,
            metadata: {
              template_id: "saved_media_preset_test_v1",
              template_mode: "saved_preset_test",
              template_slot_count: 1,
            },
          },
        });
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
        onApplyWorkflow={vi.fn()}
        onClose={vi.fn()}
        assistantMode="preset"
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: /assistant message/i }), {
      target: { value: request },
    });
    fireEvent.click(screen.getByRole("button", { name: /send chat message/i }));

    await waitFor(() => expect(screen.getByText("Saved preset test graph")).toBeTruthy());
    const planCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/media/assistant/sessions/session-1/plans"));
    expect(JSON.parse(String(planCall?.[1]?.body))).toMatchObject({
      message: request,
      workflow: {
        workflow_id: null,
        name: "Saved Media Preset workflow",
        nodes: [],
        edges: [],
      },
    });
  });

  it("renders assistant activity separately from conversational chat", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/media/assistant/sessions?")) {
        return jsonResponse({
          items: [
            {
              assistant_session_id: "session-existing",
              owner_kind: "graph_workflow",
              owner_id: "workflow-1",
              provider_kind: "codex_local",
              status: "active",
              messages: [
                {
                  assistant_message_id: "message-user",
                  assistant_session_id: "session-existing",
                  role: "user",
                  content_text: "Build a saved preset workflow",
                  content_json: {},
                },
                {
                  assistant_message_id: "message-activity",
                  assistant_session_id: "session-existing",
                  role: "system_summary",
                  content_text: "I prepared a Media Preset draft for review. It has not been saved.",
                  content_json: {
                    activity_kind: "media_preset_draft_prepared",
                  },
                },
              ],
              attachments: [],
            },
          ],
        });
      }
      if (url.endsWith("/media/assistant/sessions/session-1/plans")) {
        return jsonResponse(planResponse);
      }
      if (url.endsWith("/media/assistant/plans/plan-1/apply")) {
        return jsonResponse({ ...planResponse, plan: { ...planResponse.plan, status: "applied" } });
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
        onApplyWorkflow={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText("Build a saved preset workflow")).toBeTruthy());
    expect(screen.getByText("Media Preset draft ready")).toBeTruthy();
    expect(screen.getByText("I prepared a Media Preset draft for review. It has not been saved.")).toBeTruthy();
  });

  it("does not render stale graph activity after a newer chat message", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/media/assistant/sessions?")) {
        return jsonResponse({
          items: [
            {
              assistant_session_id: "session-existing",
              owner_kind: "graph_workflow",
              owner_id: "workflow-1",
              provider_kind: "codex_local",
              status: "active",
              messages: [
                {
                  assistant_message_id: "message-user-build",
                  assistant_session_id: "session-existing",
                  role: "user",
                  content_text: "Build a graph",
                  content_json: {},
                },
                {
                  assistant_message_id: "message-activity",
                  assistant_session_id: "session-existing",
                  role: "system_summary",
                  content_text: "I applied the reviewed plan to the graph. It has not been run yet.",
                  content_json: {
                    activity_kind: "graph_plan_applied",
                  },
                },
                {
                  assistant_message_id: "message-user-chat",
                  assistant_session_id: "session-existing",
                  role: "user",
                  content_text: "Keep this chat text only and do not create a graph.",
                  content_json: {},
                },
              ],
              attachments: [],
            },
          ],
        });
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
        onApplyWorkflow={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText("Keep this chat text only and do not create a graph.")).toBeTruthy());
    expect(screen.queryByText("Plan applied")).toBeNull();
    expect(screen.queryByText("I applied the reviewed plan to the graph. It has not been run yet.")).toBeNull();
  });

  it("uses the shared image picker for existing reference images", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/media/assistant/sessions?")) {
        return jsonResponse({ items: [] });
      }
      if (url.endsWith("/media/assistant/sessions")) {
        return jsonResponse({
          assistant_session_id: "session-1",
          owner_kind: "graph_workflow",
          owner_id: "workflow-1",
          provider_kind: "codex_local",
          status: "active",
          messages: [],
          attachments: [],
        });
      }
      if (url.endsWith("/media/assistant/sessions/session-1/attachments")) {
        return jsonResponse({
          assistant_attachment_id: "attachment-1",
          assistant_session_id: "session-1",
          reference_id: "reference-1",
          kind: "image",
          label: "woman-reference.png",
        });
      }
      if (url.endsWith("/media/assistant/sessions/session-1/attachments/attachment-1")) {
        return jsonResponse({ ok: true });
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
        references={[referenceImage]}
        importImageFile={vi.fn()}
        onApplyWorkflow={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByRole("combobox", { name: /attach existing reference image/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /choose existing reference image/i }));

    expect(screen.getByRole("dialog", { name: /reference image picker/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /use woman-reference\.png/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/media/assistant/sessions/session-1/attachments"), expect.any(Object)));
    expect(await screen.findByRole("img", { name: "woman-reference.png" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /remove woman-reference\.png/i }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/media/assistant/sessions/session-1/attachments/attachment-1"),
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
    await waitFor(() => expect(screen.queryByRole("img", { name: "woman-reference.png" })).toBeNull());
  });

  it("starts a guided preset builder chat from attached reference images", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/api/control/reference-media?")) {
        return jsonResponse({ ok: true, items: [referenceImage], limit: 24, offset: 0, next_offset: null });
      }
      if (url.includes("/media/assistant/sessions?")) {
        return jsonResponse({ items: [] });
      }
      if (url.endsWith("/media/assistant/sessions")) {
        return jsonResponse({
          assistant_session_id: "session-1",
          owner_kind: "graph_workflow",
          owner_id: "workflow-1",
          provider_kind: "codex_local",
          status: "active",
          messages: [],
          attachments: [],
        });
      }
      if (url.endsWith("/media/assistant/sessions/session-1/attachments")) {
        return jsonResponse({
          assistant_attachment_id: "attachment-1",
          assistant_session_id: "session-1",
          reference_id: "reference-1",
          kind: "image",
          label: "woman-reference.png",
        });
      }
      if (url.endsWith("/media/assistant/sessions/session-1/messages")) {
        return jsonResponse({
          assistant_session_id: "session-1",
          owner_kind: "graph_workflow",
          owner_id: "workflow-1",
          provider_kind: "codex_local",
          status: "active",
          messages: [
            {
              assistant_message_id: "message-user",
              assistant_session_id: "session-1",
              role: "user",
              content_text: "I attached reference images and want to turn their visual style into a reusable Media Preset.",
              content_json: { source: "chat", assistant_mode: "preset" },
            },
            {
              assistant_message_id: "message-assistant",
              assistant_session_id: "session-1",
              role: "assistant",
              content_text: "Do you want this preset to use an image input, editable text fields, or both?",
              content_json: {
                reference_style_brief: {
                  status: "draft",
                  preset_direction: { title: "Grungy Cartoon Poster" },
                  visual_analysis: {
                    palette: ["mustard ochre and black ink palette"],
                    line_shape_language: ["thick scratchy outlines"],
                    composition: ["dense poster-room composition"],
                    texture_lighting: ["gritty paper texture"],
                  },
                },
                preset_builder_proposal: {
                  title: "Reference Style Preset",
                  preset_contract: {
                    image_slots: [],
                    fields: [{ key: "scene_brief", label: "Scene Brief", required: true }],
                  },
                },
              },
            },
          ],
          attachments: [
            {
              assistant_attachment_id: "attachment-1",
              assistant_session_id: "session-1",
              reference_id: "reference-1",
              kind: "image",
              label: "woman-reference.png",
            },
          ],
        });
      }
      if (url.endsWith("/media/assistant/sessions/session-1/plans")) {
        return jsonResponse(planResponse);
      }
      if (url.endsWith("/media/assistant/plans/plan-1/apply")) {
        return jsonResponse({ ...planResponse, plan: { ...planResponse.plan, status: "applied" } });
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
        references={[referenceImage]}
        importImageFile={vi.fn()}
        onApplyWorkflow={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /choose existing reference image/i }));
    fireEvent.click(screen.getByRole("button", { name: /use woman-reference\.png/i }));
    await screen.findByRole("img", { name: "woman-reference.png" });

    fireEvent.click(screen.getByRole("button", { name: /media presets/i }));
    fireEvent.click(await screen.findByRole("button", { name: /build preset from refs/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/media/assistant/sessions/session-1/messages"),
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const messageCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/media/assistant/sessions/session-1/messages"));
    expect(JSON.parse(String(messageCall?.[1]?.body))).toMatchObject({
      assistant_mode: "preset",
    });
    expect(JSON.parse(String(messageCall?.[1]?.body)).content_text).toContain("Guide me with short questions first");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/media/assistant/sessions/session-1/plans"))).toBe(false);
    expect(await screen.findByText(/Do you want this preset to use an image input/i)).toBeTruthy();
    expect(screen.queryByLabelText("Suggested preset setup")).toBeNull();
    expect(screen.queryByLabelText("Extracted style brief")).toBeNull();
    expect(screen.getByRole("button", { name: /text-to-image/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /image-to-image/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /change fields/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /create graph/i })).toBeNull();
    const firstMessageCallIndex = fetchMock.mock.calls.indexOf(messageCall!);
    fireEvent.click(screen.getByRole("button", { name: /text-to-image/i }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url], index) => index > firstMessageCallIndex && String(url).endsWith("/media/assistant/sessions/session-1/plans"),
        ),
      ).toBe(true),
    );
    expect(
      fetchMock.mock.calls.some(
        ([url], index) => index > firstMessageCallIndex && String(url).endsWith("/media/assistant/sessions/session-1/messages"),
      ),
    ).toBe(false);
    const quickReplyCall = fetchMock.mock.calls.find(
      ([url], index) => index > firstMessageCallIndex && String(url).endsWith("/media/assistant/sessions/session-1/plans"),
    );
    expect(JSON.parse(String(quickReplyCall?.[1]?.body)).message).toContain("text-to-image test graph");
    expect(JSON.parse(String(quickReplyCall?.[1]?.body)).message).toContain("Do not use any image input");
    expect(JSON.parse(String(quickReplyCall?.[1]?.body)).message).not.toContain("runtime image input");
    expect(JSON.parse(String(quickReplyCall?.[1]?.body)).message).not.toContain("temporary test graph");
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url], index) => index > firstMessageCallIndex && String(url).endsWith("/media/assistant/plans/plan-1/apply"),
        ),
      ).toBe(true),
    );
    expect(screen.queryByText("Plan preview")).toBeNull();
    expect(screen.getByText("Test graph ready")).toBeTruthy();
  });

  it("opens the existing reference picker from the empty reference strip", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/media/assistant/sessions?")) {
        return jsonResponse({ items: [] });
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
        references={[referenceImage]}
        importImageFile={vi.fn()}
        onApplyWorkflow={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /open reference image picker/i }));

    expect(screen.getByRole("dialog", { name: /reference image picker/i })).toBeTruthy();
    const referenceTile = screen.getByRole("button", { name: /use woman-reference\.png/i });
    expect(referenceTile.getAttribute("data-media-image-id")).toBe("reference-1");
    expect(referenceTile.getAttribute("data-media-image-source")).toBe("reference-image");
    expect(screen.getByRole("img", { name: "woman-reference.png" }).className).toContain("object-contain");
  });

  it("disables adding reference images at the assistant image limit", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/media/assistant/sessions?")) {
        return jsonResponse({
          items: [
            {
              assistant_session_id: "session-existing",
              owner_kind: "graph_workflow",
              owner_id: "workflow-1",
              provider_kind: "codex_local",
              status: "active",
              messages: [],
              attachments: Array.from({ length: 8 }, (_, index) => ({
                assistant_attachment_id: `attachment-${index}`,
                assistant_session_id: "session-existing",
                reference_id: "reference-1",
                kind: "image",
                label: `Reference ${index + 1}`,
              })),
            },
          ],
        });
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
        references={[referenceImage]}
        importImageFile={vi.fn()}
        onApplyWorkflow={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByText("8 / 8")).toBeTruthy();
    expect((screen.getByRole("button", { name: /choose existing reference image/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByLabelText(/upload reference image/i).getAttribute("aria-disabled")).toBe("true");
  });

  it("moves assistant modes into the header and keeps only Send in the composer", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/media/assistant/sessions?")) {
        return jsonResponse({ items: [] });
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
        onApplyWorkflow={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /media presets/i }).getAttribute("title")).toBe("Create, test, refine, and save Media Presets.");
    expect(screen.getByRole("button", { name: /recipes/i }).getAttribute("title")).toBe("Create, test, refine, and save Prompt Recipes.");
    expect(screen.getByRole("button", { name: /^graph$/i }).getAttribute("title")).toBe("Create or explore Graph Studio workflows.");
    expect(screen.getByRole("button", { name: /send chat message/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /create graph plan/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /create prompt recipe draft/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /create media preset draft/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /media presets/i }));
    expect(screen.getByPlaceholderText("Ask Media Assistant to analyze refs, suggest fields, or build a preset.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /recipes/i }));
    expect(screen.getByPlaceholderText("Recipe mode: describe the reusable prompt workflow.")).toBeTruthy();
  });
});
