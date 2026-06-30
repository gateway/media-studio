import { describe, expect, it } from "vitest";

import {
  latestAssistantResponseKind,
  resolveCreativeAssistantAutoAction,
  shouldAutoPlanAssistantMessage,
  type AssistantResponseKind,
  type AssistantMode,
} from "../utils/creative-assistant-intent";

function resolveAction(
  content: string,
  options: {
    assistantMode?: AssistantMode;
    suggestedAction?: string | null;
    responseKind?: AssistantResponseKind | null;
    runApprovalSource?: string | null;
    canRunWorkflow?: boolean;
  } = {},
) {
  return resolveCreativeAssistantAutoAction({
    content,
    assistantMode: options.assistantMode ?? "graph",
    suggestedAction: options.suggestedAction ?? null,
    responseKind: options.responseKind ?? null,
    runApprovalSource: options.runApprovalSource ?? null,
    canRunWorkflow: options.canRunWorkflow ?? false,
  });
}

describe("creative assistant intent routing", () => {
  it("auto-plans graph-oriented messages in graph mode", () => {
    expect(shouldAutoPlanAssistantMessage("Create a text-to-image graph with a preview node", "graph")).toBe(true);
    expect(resolveAction("Create a text-to-image graph with a preview node")).toBe("create_and_apply_graph_plan");
  });

  it("auto-applies direct graph requests when the assistant has offered a graph plan", () => {
    expect(
      resolveAction("Create that Seed Dance graph for me", {
        suggestedAction: "create_graph_plan",
      }),
    ).toBe("create_and_apply_graph_plan");
    expect(
      resolveAction("Add this workflow to the canvas", {
        suggestedAction: null,
      }),
    ).toBe("create_and_apply_graph_plan");
  });

  it("keeps regular chat messages conversational", () => {
    expect(shouldAutoPlanAssistantMessage("What do you think about this composition?", "graph")).toBe(false);
    expect(resolveAction("What do you think about this composition?")).toBe("chat");
  });

  it("keeps prompt-only story requests conversational even after a graph suggestion", () => {
    expect(
      resolveAction("Show me the full prompts from the latest storyboard", {
        suggestedAction: "create_graph_plan",
      }),
    ).toBe("chat");
  });

  it("keeps story planning conversational when graph creation is explicitly negated", () => {
    const storyRequest =
      "I want to build a short sci-fi fantasy story with Mira and Oren. Help me shape it, but do not build a graph yet.";

    expect(shouldAutoPlanAssistantMessage(storyRequest, "graph")).toBe(false);
    expect(resolveAction(storyRequest, { suggestedAction: "create_graph_plan" })).toBe("chat");
  });

  it("keeps broad no-create requests conversational even when a graph suggestion exists", () => {
    const storyRequest =
      "I use GPT Image 2 image-to-image for storyboard stills. What flow should the assistant build? Do not create, add, run, save, import, export, or submit anything.";
    const exactStoryboardRequest =
      "Create a 4-shot storyboard from the approved character sheet using GPT Image 2 image-to-image for storyboard stills. Do not create a graph, run, save, import, export, or submit anything.";

    expect(shouldAutoPlanAssistantMessage(storyRequest, "graph")).toBe(false);
    expect(resolveAction(storyRequest, { suggestedAction: "create_graph_plan" })).toBe("chat");
    expect(shouldAutoPlanAssistantMessage(exactStoryboardRequest, "graph")).toBe(false);
    expect(resolveAction(exactStoryboardRequest, { suggestedAction: "create_graph_plan" })).toBe("chat");
  });

  it("uses assistant response kind as an auto-action safety gate", () => {
    expect(
      resolveAction("Create that storyboard graph for me", {
        suggestedAction: "create_graph_plan",
        responseKind: "answer",
      }),
    ).toBe("chat");
    expect(
      resolveAction("Create that storyboard graph for me", {
        suggestedAction: "create_graph_plan",
        responseKind: "create_local",
      }),
    ).toBe("create_and_apply_graph_plan");
    expect(
      resolveAction("run it", {
        suggestedAction: "run_workflow",
        responseKind: "confirm_paid_or_mutating",
        runApprovalSource: "prior_assistant_confirmation",
        canRunWorkflow: true,
      }),
    ).toBe("run_workflow");
    expect(
      resolveAction("what do you recommend next?", {
        suggestedAction: "run_workflow",
        responseKind: "confirm_paid_or_mutating",
        canRunWorkflow: true,
      }),
    ).toBe("chat");
  });

  it("still plans an explicit story graph review when only run and save are negated", () => {
    const graphRequest = "Now build a reviewable Seed Dance graph plan from the latest 6-shot segment, but do not run it or save it.";

    expect(shouldAutoPlanAssistantMessage(graphRequest, "graph")).toBe(true);
    expect(resolveAction(graphRequest)).toBe("create_graph_plan");
  });

  it("keeps direct run requests conversational until the assistant has a run confirmation", () => {
    expect(resolveAction("run it", { canRunWorkflow: true })).toBe("chat");
    expect(resolveAction("Okay run it. Run the current graph exactly as it is.", { canRunWorkflow: true })).toBe("chat");
  });

  it("routes approved run requests to workflow execution when available", () => {
    expect(
      resolveAction("Okay run it. Run the current graph exactly as it is. This is approved as a paid provider run.", {
        suggestedAction: "run_workflow",
        responseKind: "confirm_paid_or_mutating",
        canRunWorkflow: true,
      }),
    ).toBe("run_workflow");
    expect(
      resolveAction("run it", {
        suggestedAction: "run_workflow",
        responseKind: "confirm_paid_or_mutating",
        canRunWorkflow: true,
      }),
    ).toBe("chat");
    expect(
      resolveAction("run it", {
        suggestedAction: "run_workflow",
        responseKind: "confirm_paid_or_mutating",
        runApprovalSource: "prior_assistant_confirmation",
        canRunWorkflow: true,
      }),
    ).toBe("run_workflow");
  });

  it("does not turn unavailable or negated run requests into graph plans", () => {
    expect(
      resolveAction("run the workflow", {
        suggestedAction: "run_workflow",
        responseKind: "confirm_paid_or_mutating",
        canRunWorkflow: false,
      }),
    ).toBe("chat");
    expect(
      resolveAction("Review the completed outputs and tell me how to improve them. Do not run anything.", {
        suggestedAction: "run_workflow",
        responseKind: "confirm_paid_or_mutating",
        canRunWorkflow: true,
      }),
    ).toBe("chat");
  });

  it("routes approved preset-save messages to the save endpoint only when suggested", () => {
    expect(
      resolveAction("Yeah let's create the media preset now based upon this", {
        assistantMode: "preset",
        suggestedAction: "save_media_preset",
      }),
    ).toBe("save_media_preset");
  });

  it("routes prompt recipe save confirmations to the recipe save endpoint", () => {
    expect(
      resolveAction("Looks good, create the prompt recipe now based on this", {
        assistantMode: "recipe",
        suggestedAction: "save_prompt_recipe",
      }),
    ).toBe("save_prompt_recipe");
  });

  it("does not auto-save recipe drafts when save is negated in an action list", () => {
    expect(
      resolveAction(
        "Create the actual Storyboard v2 Prompt Recipe draft now. Do not run, save, submit, upload, delete, import, or export anything.",
        {
          assistantMode: "recipe",
          suggestedAction: "save_prompt_recipe",
          responseKind: "confirm_paid_or_mutating",
        },
      ),
    ).toBe("create_prompt_recipe_draft");
    expect(
      resolveAction("Do not save yet. Create a reviewable Prompt Recipe draft from this storyboard prompt.", {
        assistantMode: "recipe",
        suggestedAction: "save_prompt_recipe",
      }),
    ).toBe("create_prompt_recipe_draft");
  });

  it("routes selected node field edits to local graph apply instead of recipe save", () => {
    expect(
      resolveAction("Update only the selected node USER PROMPT to make the character a futuristic cyborg. Do not run or save.", {
        assistantMode: "graph",
        suggestedAction: "create_graph_plan",
        responseKind: "create_local",
      }),
    ).toBe("create_and_apply_graph_plan");
    expect(
      resolveAction("Turn the current Prompt Recipe node into a cyborg character now. Do not save.", {
        assistantMode: "graph",
        suggestedAction: "save_prompt_recipe",
        responseKind: "confirm_paid_or_mutating",
      }),
    ).toBe("chat");
    expect(
      resolveAction("Let's try to create her as a new rogue wizard wearing all black with yoga pants and carrying a staff.", {
        assistantMode: "graph",
        suggestedAction: "create_graph_plan",
        responseKind: "create_local",
      }),
    ).toBe("create_and_apply_graph_plan");
  });

  it("infers local selected-node edits from assistant route metadata", () => {
    const responseKind = latestAssistantResponseKind({
      assistant_session_id: "session-1",
      owner_kind: "graph_workflow",
      owner_id: "workflow-1",
      provider_kind: "codex_local",
      status: "active",
      attachments: [],
      messages: [
        {
          assistant_message_id: "message-assistant",
          assistant_session_id: "session-1",
          role: "assistant",
          content_text: "I updated the selected node user prompt.",
          content_json: {
            mode: "deterministic_selected_node_field_edit",
            assistant_response_kind: "answer",
            suggested_action: "create_graph_plan",
          },
          created_at: "2026-06-29T00:00:00Z",
        },
      ],
    });

    expect(responseKind).toBe("create_local");
    expect(
      resolveAction("Can we create a chr for a sci-fi Westworld female chr as a cyborg gunslinder? Do not run or save.", {
        assistantMode: "graph",
        suggestedAction: "create_graph_plan",
        responseKind,
      }),
    ).toBe("create_and_apply_graph_plan");
  });

  it("routes preset draft confirmations to the draft review flow", () => {
    expect(
      resolveAction("Create a media preset now based on this direction", {
        assistantMode: "preset",
        suggestedAction: "create_media_preset_draft",
      }),
    ).toBe("create_media_preset_draft");
  });

  it("routes preset-mode prompt update confirmations to graph planning", () => {
    expect(
      resolveAction("yes apply that prompt update to the current draft preset prompt then run it again", {
        assistantMode: "preset",
      }),
    ).toBe("create_graph_plan");
  });

  it("routes saved preset workflow requests to graph planning", () => {
    expect(
      resolveAction("Use the saved preset key preset_sadi to create a replacement workflow", {
        assistantMode: "preset",
        suggestedAction: "create_graph_plan",
      }),
    ).toBe("create_graph_plan");
  });
});
