"use client";

import {
  CheckCircle2,
  FileText,
  GitBranch,
  Image as ImageIcon,
  Images,
  Layers3,
  LoaderCircle,
  MessageSquare,
  Minimize2,
  PackagePlus,
  PencilLine,
  Send,
  Sparkles,
  StopCircle,
  Undo2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ChangeEvent, DragEvent, ReactElement } from "react";

import type { AssistantPlanResponse, GraphError, GraphMediaPreview, GraphWorkflowPayload } from "./types";
import { type AssistantMode, useCreativeAssistant } from "./hooks/use-creative-assistant";
import { isTextEntryTarget, previewFromReference } from "./utils/graph-media-preview";
import { assistantPlanPricingLabel } from "./utils/graph-pricing";
import {
  fetchReferenceImagePickerPage,
  referenceImagePickerItem,
} from "@/components/media/media-image-picker-sources";
import { MediaImagePickerDialog } from "@/components/media/media-image-picker-dialog";
import type { MediaImagePickerItem } from "@/components/media/media-image-picker-types";
import { useMediaImagePickerPagination } from "@/components/media/use-media-image-picker-pagination";
import { StudioStagedMediaTile } from "@/components/studio/studio-staged-media-tile";
import type { MediaReference } from "@/lib/types";
import { ProductionPlanChecklist } from "./production-plan-checklist";

const ASSISTANT_IMAGE_REFERENCE_LIMIT = 8;
const PRESET_FROM_REFERENCES_STARTER =
  "I attached reference images and want to turn their visual style into a reusable Media Preset. I am not sure what image inputs or editable fields I need. Guide me with short questions first before creating a test graph.";
type AssistantSessionMessage = NonNullable<ReturnType<typeof useCreativeAssistant>["session"]>["messages"][number];
type PresetBuilderProposal = {
  title?: string;
  explicit_text_only?: boolean;
  reference_role?: string;
  visual_summary?: {
    style?: string;
    fixed_ingredients?: string[];
    variable_ingredients?: string[];
  };
  preset_contract?: {
    image_slots?: Array<{ key?: string; label?: string; required?: boolean }>;
    fields?: Array<{ key?: string; label?: string; required?: boolean }>;
  };
  questions?: string[];
};
type ReferenceStyleBrief = {
  status?: string;
  preset_direction?: {
    title?: string;
    one_line_summary?: string;
    target_model_mode?: string;
  };
  visual_analysis?: Record<string, string[]>;
  preset_contract?: {
    image_slots?: Array<{ key?: string; label?: string; required?: boolean }>;
    fields?: Array<{ key?: string; label?: string; required?: boolean }>;
  };
};
type AssistantQuickReply = {
  label: string;
  content: string;
};

function assistantMessagePayload(message: AssistantSessionMessage): Record<string, unknown> {
  const payload = message.content_json;
  if (!payload) return {};
  if (typeof payload === "string") {
    try {
      const parsed = JSON.parse(payload);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return typeof payload === "object" ? (payload as Record<string, unknown>) : {};
}

function inferAssistantModeFromSession(session: ReturnType<typeof useCreativeAssistant>["session"]): AssistantMode | null {
  if (!session) return null;
  for (let index = session.messages.length - 1; index >= 0; index -= 1) {
    const payload = assistantMessagePayload(session.messages[index]);
    const metadata = typeof payload.metadata === "object" && payload.metadata ? (payload.metadata as Record<string, unknown>) : {};
    const nextAction = payload.next_action && typeof payload.next_action === "object"
      ? payload.next_action as Record<string, unknown>
      : {};
    if (payload.capability === "preset_builder" || payload.capability === "draft_media_preset" || payload.capability === "save_media_preset") return "preset";
    if (payload.capability === "recipe_builder" || payload.capability === "draft_prompt_recipe" || payload.capability === "save_prompt_recipe") return "recipe";
    if (payload.capability === "graph_builder" || payload.capability === "general" || payload.capability === "story_project" || payload.capability === "run_debugger") return "graph";
    if (nextAction.kind === "save_media_preset" || payload.artifact_intent === "preset_draft") return "preset";
    if (nextAction.kind === "save_prompt_recipe" || payload.artifact_intent === "recipe_draft") return "recipe";
    if (payload.preset_loop_lane || metadata.preset_loop_lane || payload.output_aware === true) return "preset";
    if (payload.assistant_mode === "preset" || metadata.assistant_mode === "preset") return "preset";
    if (payload.assistant_mode === "recipe" || metadata.assistant_mode === "recipe") return "recipe";
    if (payload.assistant_mode === "graph" || metadata.assistant_mode === "graph") return "graph";
  }
  if (session.summary_json?.kernel_preset_draft || session.summary_json?.kernel_preset_proposal) return "preset";
  if (session.summary_json?.kernel_recipe_draft || session.summary_json?.kernel_recipe_proposal) return "recipe";
  return null;
}

const ASSISTANT_STATUS_COPY: Record<"sending" | "running" | "planning" | "draftingRecipe" | "draftingPreset" | "savingRecipe" | "savingPreset" | "applying" | "uploading" | "cancelling", string> = {
  sending: "Thinking through your request…",
  running: "Starting the confirmed graph run…",
  planning: "Building the graph…",
  draftingRecipe: "Drafting a Prompt Recipe for review…",
  draftingPreset: "Drafting a Media Preset for review…",
  savingRecipe: "Saving the approved Prompt Recipe…",
  savingPreset: "Saving the approved Media Preset…",
  applying: "Adding the graph…",
  uploading: "Attaching reference image…",
  cancelling: "Stopping the current assistant action…",
};
const ASSISTANT_SENDING_PROGRESS = [
  ASSISTANT_STATUS_COPY.sending,
  "Reviewing your request and the available Media Studio context…",
  "Still working through the details and next useful step…",
] as const;

function assistantLiveProgressText(progress: ReturnType<typeof useCreativeAssistant>["progress"]) {
  if (!progress?.active) return null;
  const elapsed = `${progress.elapsed_seconds} seconds elapsed`;
  if (progress.elapsed_seconds >= 120) {
    return `${progress.label} · ${elapsed}. This is taking longer than usual, but it is still working. You can stop it at any time.`;
  }
  if (progress.stage === "thinking") {
    return `${progress.label} ${elapsed}. No graph changes or runs have happened yet.`;
  }
  return `${progress.label} · ${elapsed}. Continuing…`;
}

const ASSISTANT_PLACEHOLDER = "Describe what you want to create, change, or understand.";
const ASSISTANT_EMPTY_COPY = "Ask about this workflow, build or edit a graph, or create a reusable Media Preset or Prompt Recipe.";

function isSystemActivityMessage(message: AssistantSessionMessage) {
  const payload = message.content_json ?? {};
  if (message.role === "system_summary" || message.role === "tool") return true;
  if (payload.review_draft || payload.plan_id || payload.activity_kind) return true;
  return (
    message.role === "assistant" &&
    (message.content_text.startsWith("I prepared a Prompt Recipe draft for review.") ||
      message.content_text.startsWith("I prepared a Media Preset draft for review.") ||
      message.content_text.startsWith("I applied the reviewed plan to the graph."))
  );
}

function isHiddenAssistantMessage(message: AssistantSessionMessage) {
  const payload = message.content_json ?? {};
  return (
    message.role === "user" &&
    payload.metadata &&
    typeof payload.metadata === "object" &&
    (payload.metadata as Record<string, unknown>).source === "auto_output_compare"
  );
}

function activityMessageTitle(message: AssistantSessionMessage) {
  const payload = message.content_json ?? {};
  switch (payload.activity_kind) {
    case "prompt_recipe_draft_prepared":
      return "Prompt Recipe draft ready";
    case "media_preset_draft_prepared":
      return "Media Preset draft ready";
    case "media_preset_saved":
      return "Media Preset saved";
    case "prompt_recipe_saved":
      return "Prompt Recipe saved";
    case "graph_plan_applied":
      return "Plan applied";
    default:
      return "Activity";
  }
}

function kernelToolActivity(message: AssistantSessionMessage) {
  if (message.content_json?.mode !== "assistant_kernel") return null;
  const kernelTurn = message.content_json.kernel_turn;
  if (!kernelTurn || typeof kernelTurn !== "object") return null;
  const trace = (kernelTurn as Record<string, unknown>).trace;
  if (!trace || typeof trace !== "object") return null;
  const toolCalls = (trace as Record<string, unknown>).tool_calls;
  if (!Array.isArray(toolCalls)) return null;
  for (let index = toolCalls.length - 1; index >= 0; index -= 1) {
    const call = toolCalls[index];
    if (!call || typeof call !== "object") continue;
    const activity = (call as Record<string, unknown>).activity;
    if (!activity || typeof activity !== "object") continue;
    if ((activity as Record<string, unknown>).tone === "error") continue;
    const label = (activity as Record<string, unknown>).label;
    if (typeof label === "string" && label.trim()) return label;
  }
  return null;
}

function collapseActivityMessages(messages: AssistantSessionMessage[]) {
  const seen = new Set<string>();
  const collapsed: AssistantSessionMessage[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const key = `${String(message.content_json?.activity_kind || "")}:${message.content_text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    collapsed.push(message);
  }
  return collapsed.reverse();
}

function presetBuilderProposal(message: AssistantSessionMessage): PresetBuilderProposal | null {
  if (isReferenceStylePromptOnlyMessage(message)) return null;
  const proposal = message.content_json?.preset_builder_proposal;
  if (!proposal || typeof proposal !== "object") return null;
  return proposal as PresetBuilderProposal;
}

function activePresetDraft(session: ReturnType<typeof useCreativeAssistant>["session"]): PresetBuilderProposal | null {
  const draft = session?.summary_json?.kernel_preset_draft;
  if (!draft || typeof draft !== "object") return null;
  const payload = draft as Record<string, unknown>;
  const rules = payload.rules_json && typeof payload.rules_json === "object" ? payload.rules_json as Record<string, unknown> : {};
  return {
    title: String(payload.label || "Preset draft"),
    explicit_text_only: rules.preset_lane === "text_to_image",
    preset_contract: {
      image_slots: Array.isArray(payload.input_slots_json)
        ? payload.input_slots_json as Array<{ key?: string; label?: string; required?: boolean }>
        : [],
      fields: Array.isArray(payload.input_schema_json)
        ? payload.input_schema_json as Array<{ key?: string; label?: string; required?: boolean }>
        : [],
    },
  };
}

function isReferenceStylePromptOnlyMessage(message: AssistantSessionMessage) {
  return assistantMessagePayload(message).mode === "reference_style_prompt_only";
}

function referenceStyleBrief(message: AssistantSessionMessage): ReferenceStyleBrief | null {
  const brief = message.content_json?.reference_style_brief;
  if (!brief || typeof brief !== "object") return null;
  return brief as ReferenceStyleBrief;
}

function proposalLabel(item: { key?: string; label?: string; required?: boolean }) {
  return `${item.label || item.key || "Input"}${item.required ? " required" : " optional"}`;
}

function formatAssistantList(items: string[]) {
  const cleaned = items.map((item) => item.trim()).filter(Boolean);
  if (!cleaned.length) return "";
  if (cleaned.length === 1) return cleaned[0];
  if (cleaned.length === 2) return `${cleaned[0]} and ${cleaned[1]}`;
  return `${cleaned.slice(0, -1).join(", ")}, and ${cleaned[cleaned.length - 1]}`;
}

function workflowGroups(workflow: GraphWorkflowPayload) {
  const groups = workflow.metadata?.groups;
  return Array.isArray(groups) ? groups.filter((group) => group && typeof group === "object") : [];
}

function graphNodeTitle(node: GraphWorkflowPayload["nodes"][number]) {
  const ui = node.metadata?.ui;
  const customTitle = ui && typeof ui === "object" ? String((ui as Record<string, unknown>).customTitle || "").trim() : "";
  return customTitle || node.type;
}

function editableFieldsForNode(node: GraphWorkflowPayload["nodes"][number]) {
  const fields = node.fields ?? {};
  const editable = ["title"];
  if (node.type === "prompt.recipe") {
    editable.unshift("user_prompt");
  } else if (node.type === "prompt.text") {
    editable.unshift("text");
  } else if (node.type.startsWith("model.")) {
    if ("aspect_ratio" in fields) editable.unshift("aspect_ratio");
    if ("resolution" in fields) editable.unshift("resolution");
  } else if ("prompt" in fields) {
    editable.unshift("prompt");
  } else if ("text" in fields) {
    editable.unshift("text");
  }
  return Array.from(new Set(editable));
}

function selectedNodeContext(workflow: GraphWorkflowPayload, selectedNodeIds?: string[]) {
  const selectedIds = Array.from(new Set((selectedNodeIds ?? []).filter(Boolean)));
  const selectedNodes = workflow.nodes.filter((node) => selectedIds.includes(node.id));
  if (!selectedNodes.length) return null;
  const groups = workflowGroups(workflow);
  const groupTitles = groups
    .filter((group) => {
      const nodeIds = Array.isArray((group as Record<string, unknown>).node_ids) ? ((group as Record<string, unknown>).node_ids as string[]) : [];
      return selectedNodes.some((node) => nodeIds.includes(node.id));
    })
    .map((group) => String((group as Record<string, unknown>).title || "").trim())
    .filter(Boolean);
  if (selectedNodes.length > 1) {
    return {
      title: `${selectedNodes.length} nodes selected`,
      type: "Multiple nodes",
      editable: ["choose one node for field edits"],
      groups: Array.from(new Set(groupTitles)),
    };
  }
  const [node] = selectedNodes;
  return {
    title: graphNodeTitle(node),
    type: node.type,
    editable: editableFieldsForNode(node),
    groups: Array.from(new Set(groupTitles)),
  };
}

function selectedContextSummary(context: NonNullable<ReturnType<typeof selectedNodeContext>>) {
  const parts = [context.title];
  if (context.type && context.type !== "Multiple nodes") parts.push(context.type);
  if (context.editable.length) {
    const editableText = formatAssistantList(context.editable);
    parts.push(editableText.startsWith("choose ") ? editableText : `Editable: ${editableText}`);
  }
  if (context.groups.length) {
    parts.push(`${context.groups.length === 1 ? "Branch" : "Branches"}: ${formatAssistantList(context.groups)}`);
  }
  return parts.filter(Boolean).join(" · ");
}

function fieldUpdateLabels(operations: AssistantPlanResponse["graph_plan"]["operations"], workflow: GraphWorkflowPayload) {
  const nodeTitles = new Map(workflow.nodes.map((node) => [node.id, graphNodeTitle(node)]));
  return operations
    .map((operation) => {
      const nodeId = String(operation["node_id"] || operation["node_ref"] || "").trim();
      const nodeTitle = nodeTitles.get(nodeId) || nodeId || "Selected node";
      if (operation["op"] === "set_node_title") return `${nodeTitle}: title`;
      const fields = operation["fields"];
      const fieldNames = fields && typeof fields === "object" ? Object.keys(fields as Record<string, unknown>) : [];
      return fieldNames.length ? `${nodeTitle}: ${fieldNames.join(", ")}` : `${nodeTitle}: fields`;
    })
    .filter(Boolean);
}

function savedArtifactLabel(message: AssistantSessionMessage) {
  const artifact = message.content_json?.saved_artifact;
  if (!artifact || typeof artifact !== "object") return "";
  const payload = artifact as Record<string, unknown>;
  return String(payload.label || payload.key || payload.id || "").trim();
}

function savedArtifactKind(message: AssistantSessionMessage) {
  const artifact = message.content_json?.saved_artifact;
  if (!artifact || typeof artifact !== "object") return "";
  return String((artifact as Record<string, unknown>).kind || "").trim();
}

function savedArtifactGraphAction(message: AssistantSessionMessage, graphOccupied: boolean) {
  const label = savedArtifactLabel(message);
  if (savedArtifactKind(message) === "media_preset") {
    return { ariaLabel: `Test ${label} in a clean graph`, label: "Test saved preset" };
  }
  return graphOccupied
    ? { ariaLabel: `Replace current graph with ${label}`, label: "Replace graph" }
    : { ariaLabel: `Create a clean graph with ${label}`, label: "Create graph" };
}

function isSavedArtifactActivityMessage(message: AssistantSessionMessage) {
  return Boolean(savedArtifactLabel(message));
}

function displayMessageText(message: AssistantSessionMessage) {
  return message.content_text || "";
}

function normalizeAssistantMarkdownLayout(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return trimmed
    .replace(/\s+(?=(?:[-*]\s+)(?:\*\*|`)?[A-Za-z0-9])/g, "\n")
    .replace(/\s+(?=(?:Storyboard groups|Storyboard nodes|Visible nodes|Image slot|Useful fields):)/gi, "\n\n")
    .replace(/\s+(?=(?:Shot|Scene)\s+\d{1,2}\s*[:.-])/gi, "\n")
    .replace(/\s+(?=\d{1,2}[.)]\s+(?:\*\*|`)?[A-Za-z0-9])/g, "\n");
}

function renderInlineAssistantMarkdown(text: string, keyPrefix: string) {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={`${keyPrefix}-strong-${index}`}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return <em key={`${keyPrefix}-em-${index}`}>{part.slice(1, -1)}</em>;
    }
    return part;
  });
}

function AssistantMessageContent({ text, normalizeLayout = true }: { text: string; normalizeLayout?: boolean }) {
  const normalized = normalizeLayout ? normalizeAssistantMarkdownLayout(text) : text;
  const lines = normalized.split("\n");
  const blocks: ReactElement[] = [];
  let paragraphLines: string[] = [];
  let listItems: string[] = [];
  let listKind: "ul" | "ol" | null = null;

  const flushParagraph = () => {
    if (!paragraphLines.length) return;
    const value = paragraphLines.join(" ").trim();
    if (value) {
      blocks.push(<p key={`p-${blocks.length}`}>{renderInlineAssistantMarkdown(value, `p-${blocks.length}`)}</p>);
    }
    paragraphLines = [];
  };
  const flushList = () => {
    if (!listItems.length || !listKind) return;
    const ListTag = listKind;
    blocks.push(
      <ListTag key={`list-${blocks.length}`}>
        {listItems.map((item, index) => (
          <li key={`${listKind}-${index}`}>{renderInlineAssistantMarkdown(item, `${listKind}-${index}`)}</li>
        ))}
      </ListTag>,
    );
    listItems = [];
    listKind = null;
  };

  lines.forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      return;
    }
    const unordered = line.match(/^[-*]\s+(.+)$/);
    const ordered = line.match(/^(?:(\d{1,2})[.)]\s+|(?:Shot|Scene)\s+\d{1,2}\s*[:.-]\s*)(.+)$/i);
    if (unordered) {
      flushParagraph();
      if (listKind !== "ul") flushList();
      listKind = "ul";
      listItems.push(unordered[1]);
      return;
    }
    if (ordered) {
      flushParagraph();
      if (listKind !== "ol") flushList();
      listKind = "ol";
      listItems.push(ordered[1] ? ordered[2] : line);
      return;
    }
    flushList();
    paragraphLines.push(line);
  });
  flushParagraph();
  flushList();

  return <div className="graph-assistant-message-content">{blocks.length ? blocks : <p>{text}</p>}</div>;
}

function presetBuilderQuickReplies(proposal: PresetBuilderProposal | null): AssistantQuickReply[] {
  if (!proposal) return [];
  const hasImageSlots = (proposal.preset_contract?.image_slots ?? []).length > 0;
  const wantsTextOnly = Boolean(proposal.explicit_text_only);
  const replies: AssistantQuickReply[] = [];
  if (hasImageSlots && !wantsTextOnly) {
    replies.push({
      label: "Create test graph",
      content:
        "Create the image-to-image test graph now. Use the suggested image input and editable fields from this setup. Treat attached reference images as style sources only and compile the style into the prompt.",
    });
    replies.push({
      label: "Text-to-image",
      content:
        "Create the text-to-image test graph now. Use the suggested editable fields from this setup. Do not use any image input. Treat attached reference images as style sources only and compile the style into the prompt.",
    });
    replies.push({
      label: "Both",
      content: "Let's make both text-to-image and image-to-image variants from this same style.",
    });
  } else {
    replies.push({
      label: "Create test graph",
      content:
        "Create the text-to-image test graph now. Use the suggested editable fields from this setup. Do not use any image input. Treat attached reference images as style sources only and compile the style into the prompt.",
    });
    replies.push({
      label: "Image-to-image",
      content: "Let's make this image-to-image instead. Suggest the best image input for this preset before creating the test graph.",
    });
  }
  replies.push({
    label: "Change fields",
    content: "I do not love those fields. Suggest different fields from the same reference image.",
  });
  return replies;
}

function templateDisplayLabel(templateId: string) {
  switch (templateId) {
    case "preset_style_t2i_sandbox_v1":
      return "Text-to-image test graph";
    case "preset_style_i2i_sandbox_v1":
      return "Image-to-image test graph";
    case "saved_media_preset_test_v1":
      return "Saved preset test graph";
    case "prompt_recipe_style_sandbox_v1":
      return "Prompt Recipe test graph";
    default:
      return templateId.replace(/_/g, " ").replace(/\bsandbox\b/gi, "test graph").replace(/\bv\d+\b/gi, "").trim();
  }
}

function normalizedGraphIssueMessage(issue: GraphError | string | null | undefined) {
  return (typeof issue === "string" ? issue : issue?.message || "").trim().toLowerCase();
}

function isMissingMediaIssue(issue: GraphError | string | null | undefined) {
  const code = typeof issue === "string" ? "" : issue?.code || "";
  const message = normalizedGraphIssueMessage(issue);
  return (
    code.includes("missing_media") ||
    code.includes("missing_required_media") ||
    message.includes("load media needs an asset") ||
    message.includes("requires an asset or reference media")
  );
}

function isOptionalEmptyMediaIssue(issue: GraphError | string | null | undefined) {
  const code = typeof issue === "string" ? "" : issue?.code || "";
  const message = normalizedGraphIssueMessage(issue);
  return code.includes("optional_media") || message.includes("empty load image") || message.includes("optional input") || message.includes("will be skipped");
}

function graphReviewNodeLabel(plan: AssistantPlanResponse, issue: GraphError | null | undefined) {
  if (!issue?.node_id) return "";
  const node = plan.workflow.nodes.find((item) => item.id === issue.node_id);
  if (!node) return "";
  const metadataUi = node.metadata?.["ui"];
  const ui = metadataUi && typeof metadataUi === "object" ? (metadataUi as Record<string, unknown>) : {};
  const fields = node.fields || {};
  const label =
    ui["customTitle"] ||
    ui["custom_title"] ||
    ui["title"] ||
    ui["label"] ||
    fields["title"] ||
    fields["label"] ||
    fields["name"];
  return typeof label === "string" && label.trim() ? label.trim() : node.type.replace(/\./g, " ");
}

function graphReviewIssueCopy(plan: AssistantPlanResponse, issue: GraphError) {
  const label = graphReviewNodeLabel(plan, issue);
  if (isMissingMediaIssue(issue)) {
    return label ? `Choose media for ${label} before running this graph.` : "Choose the required media input before running this graph.";
  }
  if (isOptionalEmptyMediaIssue(issue)) {
    return label ? `${label} is empty. It will be skipped unless you add media.` : "One optional media input is empty. It will be skipped unless you add media.";
  }
  return issue.message;
}

function graphPlanWarningCopy(warning: string) {
  if (isOptionalEmptyMediaIssue(warning)) {
    return "One optional media input is empty. It will be skipped unless you add media.";
  }
  return warning;
}

function planHasMissingMedia(plan: AssistantPlanResponse | null | undefined) {
  return Boolean(plan?.validation.errors.some((issue) => isMissingMediaIssue(issue)));
}

function planHasOptionalEmptyMedia(plan: AssistantPlanResponse | null | undefined) {
  return Boolean(
    plan?.validation.warnings.some((issue) => isOptionalEmptyMediaIssue(issue)) ||
      plan?.graph_plan.warnings.some((warning) => isOptionalEmptyMediaIssue(warning)),
  );
}

function planReviewTitle({
  appliedPresetWorkflow,
  planApplied,
  noCanvasChanges,
  valid,
  missingMedia = false,
  onlyFieldUpdates = false,
  onlyLayoutUpdates = false,
}: {
  appliedPresetWorkflow: boolean;
  planApplied: boolean;
  noCanvasChanges: boolean;
  valid: boolean;
  missingMedia?: boolean;
  onlyFieldUpdates?: boolean;
  onlyLayoutUpdates?: boolean;
}) {
  if (appliedPresetWorkflow) return "Test graph ready";
  if (missingMedia) return "Choose missing media";
  if (planApplied && onlyLayoutUpdates) return "Workflow layout updated";
  if (planApplied && onlyFieldUpdates) return "Node updated";
  if (planApplied) return "Graph added";
  if (noCanvasChanges) return "I need one thing first";
  if (onlyLayoutUpdates) return valid ? "Workflow layout ready" : "Workflow layout needs review";
  return valid ? "Graph ready" : "Graph needs review";
}

function noCanvasChangeSummary(plan: AssistantPlanResponse) {
  const templateId = typeof plan.graph_plan.metadata?.["template_id"] === "string" ? plan.graph_plan.metadata["template_id"] : "";
  if (templateId === "story_clip_combine_guard_v1") {
    return "I need at least two approved clips before I can stitch them. Approve the clips you want, then I can build the combine graph.";
  }
  return plan.graph_plan.summary.trim() || "Nothing needs to change on the canvas yet.";
}

function graphPlanPrimaryCopy(plan: AssistantPlanResponse, options: { missingMedia: boolean; onlyFieldUpdates: boolean; onlyLayoutUpdates: boolean }) {
  const { missingMedia, onlyFieldUpdates, onlyLayoutUpdates } = options;
  if (onlyLayoutUpdates) {
    return plan.graph_plan.summary.trim() || "I prepared a geometry-only workflow layout for review.";
  }
  if (onlyFieldUpdates) {
    return plan.graph_plan.summary.trim() || "I updated the selected node on the canvas.";
  }
  if (missingMedia) {
    return "I can build this graph, but one required media input needs a file before it can run.";
  }
  if (plan.validation.valid) {
    return "I built the graph plan. Review it, then add it when it looks right.";
  }
  return plan.graph_plan.summary.trim() || "I found something to review before this graph is added.";
}

export function CreativeAssistantPanel({
  open,
  workspaceKey,
  workflowId,
  workflowName,
  workflow,
  latestRunId,
  latestRunStatus,
  selectedNodeIds,
  selectedGroupIds,
  bottomOffset = 18,
  initialAssistantSessionId,
  reviewReturnTo,
  references,
  importImageFile,
  onBeforeReviewNavigate,
  onAssistantSessionChange,
  onApplyWorkflow,
  onUndoLastAssistantChange,
  onRunWorkflow,
  onOpenPreview,
  onClose,
  onEvent,
}: {
  open: boolean;
  workspaceKey: string;
  workflowId: string | null;
  workflowName: string;
  workflow: GraphWorkflowPayload;
  latestRunId?: string | null;
  latestRunStatus?: string | null;
  selectedNodeIds?: string[];
  selectedGroupIds?: string[];
  bottomOffset?: number;
  initialAssistantSessionId?: string | null;
  reviewReturnTo?: string;
  references: MediaReference[];
  importImageFile: (file: File) => Promise<MediaReference>;
  onBeforeReviewNavigate?: () => void;
  onAssistantSessionChange?: (assistantSessionId: string | null) => void;
  onApplyWorkflow: (workflow: GraphWorkflowPayload, options?: { highlightNodeIds?: string[] }) => Promise<void> | void;
  onUndoLastAssistantChange?: () => void;
  onRunWorkflow?: (assistantConfirmation?: { sessionId: string; token: string }) => Promise<unknown> | void;
  onOpenPreview?: (preview: GraphMediaPreview, collection?: GraphMediaPreview[]) => void;
  onClose: () => void;
  onEvent?: (message: string, tone?: "success" | "warning" | "error" | "muted") => void;
}) {
  const [assistantMode, setAssistantMode] = useState<AssistantMode>("graph");
  useEffect(() => {
    setAssistantMode("graph");
  }, [workspaceKey]);
  const assistant = useCreativeAssistant({
    workspaceKey,
    assistantMode,
    workflowId,
    workflowName,
    workflow,
    latestRunId,
    latestRunStatus,
    selectedNodeIds,
    selectedGroupIds,
    enabled: open,
    initialAssistantSessionId,
    reviewReturnTo,
    importImageFile,
    onBeforeReviewNavigate,
    onAssistantSessionChange,
    onApplyWorkflow,
    onRunWorkflow,
    onEvent,
  });
  const [sendingProgressStage, setSendingProgressStage] = useState(0);
  useEffect(() => {
    if (assistant.status !== "sending") {
      setSendingProgressStage(0);
      return;
    }
    setSendingProgressStage(0);
    const reviewingTimer = window.setTimeout(() => setSendingProgressStage(1), 8_000);
    const continuingTimer = window.setTimeout(() => setSendingProgressStage(2), 24_000);
    return () => {
      window.clearTimeout(reviewingTimer);
      window.clearTimeout(continuingTimer);
    };
  }, [assistant.status, workspaceKey]);
  useEffect(() => {
    const inferredMode = inferAssistantModeFromSession(assistant.session);
    if (!inferredMode) return;
    if (inferredMode !== assistantMode) {
      setAssistantMode(inferredMode);
    }
  }, [assistant.session, assistantMode]);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const initialAssistantSessionIdRef = useRef(initialAssistantSessionId);
  const [referenceSelectionId, setReferenceSelectionId] = useState<string | null>(null);
  const [localReferences, setLocalReferences] = useState<MediaReference[]>([]);
  const [minimized, setMinimized] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextEntryTarget(event.target)) return;
      if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey || event.key.toLowerCase() !== "m") return;
      event.preventDefault();
      setMinimized((current) => !current);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);
  const referencePicker = useMediaImagePickerPagination<MediaReference>({
    fetchPage: fetchReferenceImagePickerPage,
    getItemId: (reference) => reference.reference_id,
    onError: (error) => onEvent?.(error, "error"),
  });
  const imageAttachmentCount = (assistant.session?.attachments ?? []).filter(
    (attachment) => attachment.kind === "reference_image" || attachment.kind === "image",
  ).length;
  const atImageLimit = imageAttachmentCount >= ASSISTANT_IMAGE_REFERENCE_LIMIT;
  const imageReferences = useMemo(() => {
    const merged = new Map<string, MediaReference>();
    for (const reference of references) {
      if (reference.kind === "image") merged.set(reference.reference_id, reference);
    }
    for (const reference of referencePicker.items) {
      if (reference.kind === "image") merged.set(reference.reference_id, reference);
    }
    for (const reference of localReferences) {
      if (reference.kind === "image") merged.set(reference.reference_id, reference);
    }
    return Array.from(merged.values());
  }, [localReferences, referencePicker.items, references]);
  const referenceLookup = useMemo(() => new Map(imageReferences.map((reference) => [reference.reference_id, reference])), [imageReferences]);
  const referencePickerItems = useMemo<MediaImagePickerItem[]>(
    () =>
      imageReferences
        .map((reference) => referenceImagePickerItem(reference))
        .filter((item): item is MediaImagePickerItem => Boolean(item)),
    [imageReferences],
  );
  const attachedImages = useMemo(
    () =>
      (assistant.session?.attachments ?? [])
        .filter((attachment) => (attachment.kind === "reference_image" || attachment.kind === "image") && attachment.reference_id)
        .slice(0, 6)
        .map((attachment) => {
          const reference = referenceLookup.get(attachment.reference_id || "");
          return {
            id: attachment.assistant_attachment_id,
            label: attachment.label || reference?.original_filename || attachment.reference_id || "Reference image",
            previewUrl: reference?.thumb_url || reference?.stored_url || null,
            sourceUrl: reference?.stored_url || reference?.thumb_url || "",
            graphPreview: previewFromReference(reference),
          };
        }),
    [assistant.session?.attachments, referenceLookup],
  );
  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;
    scrollContainer.scrollTop = scrollContainer.scrollHeight;
  }, [
    assistant.draft,
    assistant.nextAction?.kind,
    assistant.plan?.plan.assistant_plan_id,
    assistant.plan?.plan.status,
    assistant.progress?.elapsed_seconds,
    assistant.progress?.label,
    assistant.session?.messages.length,
    assistant.status,
    open,
  ]);
  useEffect(() => {
    const previousAssistantSessionId = initialAssistantSessionIdRef.current;
    initialAssistantSessionIdRef.current = initialAssistantSessionId;
    if (!previousAssistantSessionId || initialAssistantSessionId) return;
    referencePicker.closePicker();
    setReferenceSelectionId(null);
    setLocalReferences([]);
  }, [initialAssistantSessionId, referencePicker.closePicker]);
  if (!open) return null;

  const attachFiles = async (files: FileList | null) => {
    if (atImageLimit) {
      onEvent?.(`Media Assistant accepts at most ${ASSISTANT_IMAGE_REFERENCE_LIMIT} image references.`, "warning");
      return;
    }
    const firstImage = Array.from(files ?? []).find((file) => file.type.startsWith("image/"));
    if (!firstImage) return;
    try {
      const reference = await importImageFile(firstImage);
      setLocalReferences((current) => [reference, ...current.filter((item) => item.reference_id !== reference.reference_id)]);
      referencePicker.prependItems([reference]);
      await assistant.attachReference(reference, firstImage.name);
    } catch (requestError) {
      const message = requestError instanceof Error && requestError.message ? requestError.message : "Unable to attach reference media.";
      onEvent?.(message, "error");
    }
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    void attachFiles(event.dataTransfer.files);
  };
  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    void attachFiles(event.target.files);
    event.target.value = "";
  };

  const plan = assistant.plan;
  const planApplied = plan?.plan.status === "applied";
  const planOperations = plan?.graph_plan.operations ?? [];
  const planMetadata = plan?.graph_plan.metadata ?? {};
  const arrangeOperations = planOperations.filter((operation) => operation["op"] === "arrange_workflow");
  const onlyArrangeOperations = arrangeOperations.length === 1 && planOperations.length === 1;
  const layoutDiff = typeof planMetadata["diff_summary"] === "object" && planMetadata["diff_summary"] !== null
    ? planMetadata["diff_summary"] as Record<string, unknown>
    : {};
  const movedNodeCount = Array.isArray(layoutDiff["nodes_moved"]) ? layoutDiff["nodes_moved"].length : null;
  const movedGroupCount = Array.isArray(layoutDiff["groups_repositioned"]) ? layoutDiff["groups_repositioned"].length : null;
  const arrangedNodeCount = movedNodeCount ?? plan?.workflow.nodes.length ?? 0;
  const arrangedGroupCount = movedGroupCount ?? 0;
  const planOperationCount = planOperations.length;
  const noCanvasChanges = Boolean(plan && planOperationCount === 0);
  const planMissingMedia = planHasMissingMedia(plan);
  const planOptionalEmptyMedia = planHasOptionalEmptyMedia(plan);
  const planStatusLabel = planApplied
    ? onlyArrangeOperations ? "Layout applied" : "Added to canvas"
    : plan && planOperationCount === 0
      ? "No changes required"
      : onlyArrangeOperations
        ? "Ready to tidy"
      : planMissingMedia
        ? "Needs media"
        : planOptionalEmptyMedia
          ? "Optional media skipped"
          : plan?.validation.valid
            ? "Ready to add"
            : "Needs review";
  const kernelGraphAction =
    assistant.nextAction?.kind === "confirm_graph" &&
    assistant.nextAction.proposal_id === plan?.plan.assistant_plan_id
      ? assistant.nextAction
      : null;
  const presetSaveAction =
    assistant.nextAction?.kind === "save_media_preset" &&
    assistant.nextAction.requires_confirmation
      ? assistant.nextAction
      : null;
  const verifiedPresetSaveAction =
    presetSaveAction?.payload?.save_mode === "verified" &&
    presetSaveAction.payload?.quality_state === "quality_verified"
      ? presetSaveAction
      : null;
  const unverifiedPresetSaveAction =
    presetSaveAction?.payload?.save_mode === "unverified" &&
    presetSaveAction.payload?.quality_state !== "quality_verified"
      ? presetSaveAction
      : null;
  const kernelPresetSaveAction = verifiedPresetSaveAction ?? unverifiedPresetSaveAction;
  const kernelRecipeSaveAction =
    assistant.nextAction?.kind === "save_prompt_recipe" && assistant.nextAction.requires_confirmation
      ? assistant.nextAction
      : null;
  const kernelRunAction =
    !assistant.runConfirmationNeedsRecheck &&
    assistant.nextAction?.kind === "run_workflow" && assistant.nextAction.requires_confirmation
      ? assistant.nextAction
      : null;
  const planActionLabel = kernelGraphAction?.label || (planMissingMedia ? "Add graph to choose media" : "Add graph");
  const planActionAriaLabel = kernelGraphAction?.label || (planMissingMedia ? "Add graph to choose media" : "Add reviewed graph");
  const planActionTitle = kernelGraphAction?.label || (planMissingMedia ? "Add the graph so you can choose the missing media on the canvas" : "Add the reviewed graph");
  const pricing = assistantPlanPricingLabel(plan?.pricing.pricing_summary.total);
  const liveProgressText = assistantLiveProgressText(assistant.progress);
  const busyText = assistant.status === "idle"
    ? null
    : liveProgressText ?? (
        assistant.status === "sending"
          ? ASSISTANT_SENDING_PROGRESS[sendingProgressStage]
          : ASSISTANT_STATUS_COPY[assistant.status]
      );
  const readOnlyProvider = Boolean(
    assistant.session?.provider_kind && assistant.session.provider_kind !== "codex_local",
  );
  const codexBlocker = !readOnlyProvider && assistant.providerReadiness.checked && !assistant.providerReadiness.ready;
  const sessionMessages = (assistant.session?.messages ?? []).filter((message) => !isHiddenAssistantMessage(message));
  const conversationalMessages = sessionMessages.filter((message) => !isSystemActivityMessage(message));
  const legacyPresetProposal = conversationalMessages
    .map((message) => presetBuilderProposal(message))
    .filter((proposal): proposal is PresetBuilderProposal => Boolean(proposal))
    .at(-1) ?? null;
  const latestConversationalMessageIndex = sessionMessages.reduce(
    (latestIndex, message, index) => (isSystemActivityMessage(message) ? latestIndex : index),
    -1,
  );
  const activityMessages = collapseActivityMessages(
    sessionMessages.filter(
      (message, index) => isSystemActivityMessage(message) && (isSavedArtifactActivityMessage(message) || index > latestConversationalMessageIndex),
    ),
  );
  const visibleActivityMessages = planApplied ? activityMessages.filter((message) => isSavedArtifactActivityMessage(message)) : activityMessages.slice(-1);
  const showPresetReferenceStarter = imageAttachmentCount > 0 && !conversationalMessages.length && !assistant.busy;
  const templateId = typeof planMetadata["template_id"] === "string" ? planMetadata["template_id"] : "";
  const templateMode = typeof planMetadata["template_mode"] === "string" ? planMetadata["template_mode"] : "";
  const templateSlotCount = typeof planMetadata["template_slot_count"] === "number" ? planMetadata["template_slot_count"] : null;
  const presetDraft = activePresetDraft(assistant.session);
  const presetActionProposal = presetDraft ?? legacyPresetProposal;
  const appliedPresetWorkflow = planApplied && (
    Boolean(presetActionProposal) || templateMode === "text_to_image" || templateMode === "image_to_image"
  );
  const runConfirmationConsumed = Boolean(
    assistant.session?.summary_json?.kernel_run_confirmation &&
    typeof assistant.session.summary_json.kernel_run_confirmation === "object" &&
    (assistant.session.summary_json.kernel_run_confirmation as Record<string, unknown>).consumed === true,
  );
  const planHasPrice = typeof plan?.pricing.pricing_summary.total?.estimated_credits === "number" ||
    typeof plan?.pricing.pricing_summary.total?.estimated_cost_usd === "number";
  const presetTestReady = appliedPresetWorkflow && Boolean(plan?.validation.valid) && planHasPrice;
  const presetImageInputNode = plan?.workflow.nodes.find((node) => node.type === "media.load_image") ?? null;
  const presetImageInputLabel = presetImageInputNode ? graphNodeTitle(presetImageInputNode) : "Image input";
  const presetImageInputSlot = presetDraft?.preset_contract?.image_slots?.find(
    (slot) => (slot.label || slot.key) === presetImageInputLabel,
  ) ?? presetDraft?.preset_contract?.image_slots?.[0];
  const presetImageInputRequired = Boolean(
    presetImageInputSlot?.required ?? (
      presetImageInputNode && plan?.validation.errors.some((issue) => issue.node_id === presetImageInputNode.id && isMissingMediaIssue(issue))
    ),
  );
  const appliedPresetNextStep = templateMode === "image_to_image" && presetImageInputRequired && planMissingMedia
    ? `Required image input: ${presetImageInputLabel}. Add it on the canvas before running a test.`
    : plan && !plan.validation.valid
      ? "Resolve the graph validation issue before running a test."
      : !planHasPrice
        ? "A current price is required before this test can be prepared to run."
        : templateMode === "text_to_image"
          ? "Your text-to-image test graph is on the canvas. No image input is needed. Run a test when you are ready."
          : templateMode === "image_to_image"
            ? `${presetImageInputRequired ? "Required" : "Optional"} image input: ${presetImageInputLabel}. ${presetImageInputRequired ? "It is ready; run a test when you are ready." : "You can add it on the canvas before running a test."}`
            : "Your test graph is on the canvas. Review its inputs, then run a test when you are ready.";
  const addNodeOperations = planOperations.filter((operation) => operation["op"] === "add_node" || operation["op"] === "add_note");
  const connectionOperations = planOperations.filter((operation) => operation["op"] === "connect_nodes");
  const groupOperations = planOperations.filter((operation) => operation["op"] === "group_nodes");
  const fieldUpdateOperations = planOperations.filter((operation) => operation["op"] === "set_node_field" || operation["op"] === "set_node_title");
  const onlyFieldUpdateOperations = fieldUpdateOperations.length > 0 && fieldUpdateOperations.length === planOperations.length;
  const selectedContext = selectedNodeContext(workflow, selectedNodeIds);
  const appliedFieldUpdateLabels = onlyFieldUpdateOperations ? fieldUpdateLabels(fieldUpdateOperations, workflow) : [];
  const hasExplicitOperations = planOperations.length > 0;
  const attachReferenceFromPicker = async (referenceId: string) => {
    if (atImageLimit) {
      onEvent?.(`Media Assistant accepts at most ${ASSISTANT_IMAGE_REFERENCE_LIMIT} image references.`, "warning");
      referencePicker.closePicker();
      return;
    }
    const reference = referenceLookup.get(referenceId);
    if (!reference) return;
    setReferenceSelectionId(referenceId);
    try {
      await assistant.attachReference(reference);
      referencePicker.closePicker();
    } finally {
      setReferenceSelectionId(null);
    }
  };

  if (minimized) {
    return (
      <aside
        className="graph-assistant-panel graph-assistant-panel-minimized"
        aria-label="Media assistant"
        style={{ "--graph-assistant-bottom": `${bottomOffset}px` } as CSSProperties}
      >
        <button
          type="button"
          className="graph-assistant-minimized-pill"
          onClick={() => setMinimized(false)}
          aria-label="Expand Media Assistant"
          aria-keyshortcuts="M"
          title="Expand Media Assistant (M)"
        >
          <MessageSquare size={16} aria-hidden="true" />
          <span>Media Assistant</span>
          {imageAttachmentCount ? <small>{imageAttachmentCount}</small> : null}
        </button>
      </aside>
    );
  }

  return (
    <>
      <aside
        className="graph-assistant-panel"
        aria-label="Media assistant"
        style={{ "--graph-assistant-bottom": `${bottomOffset}px` } as CSSProperties}
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
      >
        <div className="graph-assistant-top-row">
          <section className="graph-assistant-reference-strip studio-composer-input-panel">
            <div className="graph-assistant-strip-heading">
              <span className="studio-meta-label">Reference images</span>
              <div className="graph-assistant-strip-controls">
                <small>
                  {imageAttachmentCount ? `${imageAttachmentCount} / ${ASSISTANT_IMAGE_REFERENCE_LIMIT}` : `0 / ${ASSISTANT_IMAGE_REFERENCE_LIMIT}`}
                </small>
                <button type="button" onClick={() => setMinimized(true)} aria-label="Collapse Media Assistant" aria-keyshortcuts="M" title="Collapse Media Assistant (M)">
                  <Minimize2 size={14} aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="graph-assistant-reference-actions">
              <button
                type="button"
                className="graph-assistant-reference-icon-button graph-assistant-reference-library-button"
                title="Choose existing reference image"
                aria-label="Choose existing reference image"
                onClick={referencePicker.openPicker}
                disabled={assistant.busy || atImageLimit}
              >
                <Images size={18} aria-hidden="true" />
              </button>
              <label
                className="graph-assistant-reference-icon-button"
                title={atImageLimit ? `Maximum ${ASSISTANT_IMAGE_REFERENCE_LIMIT} reference images` : "Upload reference image"}
                aria-label="Upload reference image"
                aria-disabled={atImageLimit}
              >
                <ImageIcon size={20} aria-hidden="true" />
                <input type="file" accept="image/*" onChange={onFileChange} disabled={atImageLimit} />
              </label>
              <div className="graph-assistant-reference-list">
                {attachedImages.length ? (
                  attachedImages.map((image) => (
                    <StudioStagedMediaTile
                      key={image.id}
                      preview={{
                        key: `assistant:${image.id}`,
                        label: image.label,
                        url: image.sourceUrl,
                        kind: "images",
                      }}
                      visualUrl={image.previewUrl}
                      onOpenPreview={() => {
                        if (!image.graphPreview || !onOpenPreview) return;
                        const previews = attachedImages
                          .map((attachedImage) => attachedImage.graphPreview)
                          .filter((preview): preview is GraphMediaPreview => Boolean(preview));
                        onOpenPreview(image.graphPreview, previews);
                      }}
                      onRemove={() => void assistant.removeAttachment(image.id)}
                      className="graph-assistant-reference-thumb"
                      testId={`graph-assistant-reference-thumb-${image.id}`}
                    />
                  ))
                ) : (
                  <button
                    type="button"
                    className="graph-assistant-reference-empty"
                    aria-label="Open reference image picker"
                    title="Open reference image picker"
                    onClick={referencePicker.openPicker}
                    disabled={assistant.busy || atImageLimit}
                  />
                )}
              </div>
            </div>
          </section>
        </div>

        <section className="graph-assistant-composer-shell">
        <header className="graph-assistant-header">
          <div className="graph-assistant-title">
            <span>Media Assistant</span>
          </div>
          <div className="graph-assistant-header-actions">
            {assistant.cancellable ? (
              <button type="button" aria-label="Stop assistant request" title="Stop assistant request" onClick={() => void assistant.cancelAssistant()}>
                <StopCircle size={15} />
              </button>
            ) : null}
            <button type="button" aria-label="Close Media Assistant" title="Close" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </header>

        {selectedContext ? (
          <section className="graph-assistant-selection-context" aria-label="Selected canvas context">
            <span>Canvas selection</span>
            <strong title={selectedContextSummary(selectedContext)}>{selectedContextSummary(selectedContext)}</strong>
          </section>
        ) : null}

        <div ref={scrollContainerRef} className="graph-assistant-body">
          {assistant.session?.production_plan ? (
            <ProductionPlanChecklist plan={assistant.session.production_plan} />
          ) : null}
          <section className="graph-assistant-thread" aria-label="Assistant messages">
          {codexBlocker ? (
            <div className="graph-assistant-readiness" role="status">
              <strong>Codex Local needs setup for native chat.</strong>
              <span>
                {assistant.providerReadiness.commandAvailable
                  ? "Codex is installed, but Media Studio could not confirm a signed-in ChatGPT-backed Codex session."
                  : "Install Codex and sign in with ChatGPT to use native assistant chat."}
              </span>
              <a href="/setup">Open setup</a>
            </div>
          ) : null}
          {readOnlyProvider ? (
            <div className="graph-assistant-readiness" role="status">
              <strong>Read-only assistant chat.</strong>
              <span>Graph building and Media Studio actions need Codex Local.</span>
              <a href="/settings/llms">Open AI Settings</a>
            </div>
          ) : null}
          {conversationalMessages.length ? (
            conversationalMessages.map((message) => (
              <div className={`graph-assistant-message graph-assistant-message-${message.role}`} key={message.assistant_message_id}>
                <span>{message.role === "user" ? "You" : "Media Assistant"}</span>
                <AssistantMessageContent
                  text={displayMessageText(message)}
                  normalizeLayout={message.content_json?.mode !== "assistant_kernel"}
                />
                {message.role === "assistant" && kernelToolActivity(message) ? (
                  <div className="graph-assistant-activity-item" role="status" aria-label="Assistant tool activity">
                    <span>{kernelToolActivity(message)}</span>
                  </div>
                ) : null}
                {message.role === "assistant" && presetBuilderProposal(message) && !referenceStyleBrief(message) ? (
                  <details className="graph-assistant-preset-proposal" aria-label="Suggested preset setup">
                    <summary>
                      <strong>Preset details</strong>
                      <span>{presetBuilderProposal(message)?.title || "Suggested preset"}</span>
                    </summary>
                    {presetBuilderProposal(message)?.visual_summary?.style ? <small>{presetBuilderProposal(message)?.visual_summary?.style}</small> : null}
                    <dl>
                      <div>
                        <dt>Image inputs</dt>
                        <dd>
                          {(presetBuilderProposal(message)?.preset_contract?.image_slots ?? []).length
                            ? (
                                <ul className="graph-assistant-proposal-list">
                                  {(presetBuilderProposal(message)?.preset_contract?.image_slots ?? []).map((slot) => (
                                    <li key={proposalLabel(slot)}>{proposalLabel(slot)}</li>
                                  ))}
                                </ul>
                              )
                            : "None yet"}
                        </dd>
                      </div>
                      <div>
                        <dt>Suggested fields</dt>
                        <dd>
                          {(presetBuilderProposal(message)?.preset_contract?.fields ?? []).length
                            ? (
                                <ul className="graph-assistant-proposal-list">
                                  {(presetBuilderProposal(message)?.preset_contract?.fields ?? []).map((field) => (
                                    <li key={proposalLabel(field)}>{proposalLabel(field)}</li>
                                  ))}
                                </ul>
                              )
                            : "None"}
                        </dd>
                      </div>
                    </dl>
                    {(presetBuilderProposal(message)?.questions ?? []).length ? (
                      <ul>
                        {(presetBuilderProposal(message)?.questions ?? []).slice(0, 2).map((question) => (
                          <li key={question}>{question}</li>
                        ))}
                      </ul>
                    ) : null}
                  </details>
                ) : null}
              </div>
            ))
          ) : (
            <div className="graph-assistant-empty">
              {ASSISTANT_EMPTY_COPY}
              {showPresetReferenceStarter ? (
                <button
                  type="button"
                  className="graph-assistant-starter-button"
                  onClick={() => void assistant.sendContentMessage(PRESET_FROM_REFERENCES_STARTER, { skipAutoActions: true })}
                >
                  <Sparkles size={14} aria-hidden="true" />
                  <span>Build preset from refs</span>
                </button>
              ) : null}
            </div>
          )}
          {assistantMode === "preset" && presetActionProposal && !plan && !runConfirmationConsumed && (!assistant.nextAction || assistant.nextAction.kind === "none") ? (
            <section className="graph-assistant-message graph-assistant-message-assistant" aria-label="Media Preset draft actions">
              <strong>{presetActionProposal.title || "Preset draft"}</strong>
              <p>The validated draft is ready for a non-paid test graph review.</p>
              <div className="graph-assistant-card-actions graph-assistant-quick-replies" aria-label="Preset draft actions">
                {presetBuilderQuickReplies(presetActionProposal).map((reply, index) => (
                  <button
                    key={reply.label}
                    type="button"
                    className={index === 0 ? "graph-assistant-card-action-primary" : undefined}
                    disabled={assistant.busy}
                    onClick={() => void assistant.sendContentMessage(reply.content)}
                  >
                    <Sparkles size={13} aria-hidden="true" />
                    <span>{reply.label}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
          {busyText ? (
            <div
              className="graph-assistant-message graph-assistant-message-assistant graph-assistant-message-thinking"
              role="status"
              aria-label={assistant.status === "running" ? "Assistant run progress" : "Assistant progress"}
              aria-live="polite"
            >
              <span>Media Assistant</span>
              <div className="graph-assistant-thinking">
                <p>{busyText}</p>
                <i aria-hidden="true" />
                <i aria-hidden="true" />
                <i aria-hidden="true" />
              </div>
            </div>
          ) : null}
          {visibleActivityMessages.length ? (
            <section className="graph-assistant-activity-log" aria-label="Assistant activity">
              {visibleActivityMessages.map((message) => {
                const graphAction = savedArtifactGraphAction(message, Boolean(workflow.nodes.length));
                return (
                  <div className="graph-assistant-activity-item" key={message.assistant_message_id}>
                  <span>{activityMessageTitle(message)}</span>
                  <p>{message.content_text}</p>
                  {savedArtifactLabel(message) ? (
                    <div className="graph-assistant-card-actions graph-assistant-activity-actions">
                      <button
                        type="button"
                        disabled={assistant.busy}
                        onClick={() => void assistant.useSavedArtifactInGraph(message)}
                        aria-label={graphAction.ariaLabel}
                      >
                        <Sparkles size={13} aria-hidden="true" />
                        <span>{graphAction.label}</span>
                      </button>
                      <button
                        type="button"
                        disabled={assistant.busy}
                        onClick={() => assistant.openSavedArtifactEditor(message)}
                        aria-label={`Open ${savedArtifactLabel(message)} editor`}
                      >
                        <FileText size={13} aria-hidden="true" />
                        <span>Open editor</span>
                      </button>
                    </div>
                  ) : null}
                  </div>
                );
              })}
            </section>
          ) : null}

          {kernelPresetSaveAction ? (
            <section className="graph-assistant-message graph-assistant-message-assistant" aria-label="Media Preset save confirmation">
              <p>
                {verifiedPresetSaveAction
                  ? "This preset has completed visual review and is ready to save."
                  : "This draft has not been visually verified. Save it only if you accept the missing output proof."}
              </p>
              <div className="graph-assistant-card-actions">
                <button
                  type="button"
                  className={verifiedPresetSaveAction ? "graph-assistant-card-action-primary" : undefined}
                  disabled={assistant.busy}
                  onClick={() => void assistant.confirmPresetSave()}
                  aria-label={verifiedPresetSaveAction ? "Save confirmed Media Preset" : "Save unverified draft"}
                >
                  {assistant.status === "savingPreset" ? <LoaderCircle size={15} /> : <PackagePlus size={15} />}
                  <span>{kernelPresetSaveAction.label}</span>
                </button>
              </div>
            </section>
          ) : null}

          {kernelRecipeSaveAction ? (
            <section className="graph-assistant-message graph-assistant-message-assistant" aria-label="Prompt Recipe save confirmation">
              <p>The validated Prompt Recipe draft is ready to save.</p>
              <div className="graph-assistant-card-actions">
                <button
                  type="button"
                  className="graph-assistant-card-action-primary"
                  disabled={assistant.busy}
                  onClick={() => void assistant.confirmRecipeSave()}
                  aria-label="Save confirmed Prompt Recipe"
                >
                  {assistant.status === "savingRecipe" ? <LoaderCircle size={15} /> : <FileText size={15} />}
                  <span>{kernelRecipeSaveAction.label}</span>
                </button>
              </div>
            </section>
          ) : null}

          {kernelRunAction ? (
            <section className="graph-assistant-message graph-assistant-message-assistant" aria-label="Graph run confirmation">
              <p>Review the graph and pricing before starting the run.</p>
              <div className="graph-assistant-card-actions">
                <button
                  type="button"
                  className="graph-assistant-card-action-primary"
                  disabled={assistant.busy}
                  onClick={() => void assistant.confirmRunWorkflow()}
                  aria-label={kernelRunAction.label ?? undefined}
                >
                  <Sparkles size={15} aria-hidden="true" />
                  <span>{kernelRunAction.label}</span>
                </button>
              </div>
            </section>
          ) : null}

          {plan ? (
            <section
              className={`graph-assistant-message graph-assistant-message-assistant graph-assistant-message-plan ${
                planApplied ? "graph-assistant-plan-applied" : plan.validation.valid ? "graph-assistant-plan-valid" : "graph-assistant-plan-invalid"
              }`}
              aria-label={planApplied ? "Added graph status" : "Graph review"}
            >
            <div className="graph-assistant-plan-heading">
              {planApplied ? <CheckCircle2 size={15} /> : <Sparkles size={15} />}
              <strong>{planReviewTitle({ appliedPresetWorkflow: presetTestReady, planApplied, noCanvasChanges, valid: plan.validation.valid, missingMedia: planMissingMedia, onlyFieldUpdates: onlyFieldUpdateOperations, onlyLayoutUpdates: onlyArrangeOperations })}</strong>
              {!planApplied ? <small>{pricing}</small> : null}
            </div>
            <p>
              {appliedPresetWorkflow
                ? appliedPresetNextStep
                : planApplied && onlyArrangeOperations
                  ? plan.graph_plan.summary.trim() || "The workflow layout is updated without changing graph content."
                : planApplied && onlyFieldUpdateOperations
                  ? plan.graph_plan.summary.trim() || "I updated the selected node on the canvas. Want another adjustment?"
                : planApplied
                  ? "Here's your graph. I added the nodes to the canvas. Want adjustments, or should we review the prompts?"
                  : noCanvasChanges
                    ? noCanvasChangeSummary(plan)
                    : graphPlanPrimaryCopy(plan, { missingMedia: planMissingMedia, onlyFieldUpdates: onlyFieldUpdateOperations, onlyLayoutUpdates: onlyArrangeOperations })}
            </p>
            {planApplied && onlyFieldUpdateOperations && appliedFieldUpdateLabels.length ? (
              <p className="graph-assistant-edit-summary">Changed: {formatAssistantList(appliedFieldUpdateLabels)}</p>
            ) : null}
            {!planApplied && !noCanvasChanges ? (
              <details className="graph-assistant-plan-details" aria-label="Graph review details">
                <summary>
                  <span>{planStatusLabel}</span>
                  <small>Details</small>
                </summary>
                {templateId ? (
                  <p className="graph-assistant-template-proof">
                    Setup: <strong>{templateDisplayLabel(templateId)}</strong>
                    {templateMode ? ` · ${templateMode.replace(/_/g, " ")}` : ""}
                    {templateSlotCount !== null ? ` · ${templateSlotCount} image input${templateSlotCount === 1 ? "" : "s"}` : ""}
                  </p>
                ) : null}
                <dl>
                  <div>
                    <dt aria-label="Nodes" title="Nodes">
                      <PackagePlus size={13} aria-hidden="true" />
                      <span className="graph-assistant-plan-stat-label">Nodes</span>
                    </dt>
                    <dd>{onlyArrangeOperations ? arrangedNodeCount : hasExplicitOperations ? addNodeOperations.length : plan.workflow.nodes.length}</dd>
                  </div>
                  <div>
                    <dt aria-label="Connections" title="Connections">
                      <GitBranch size={13} aria-hidden="true" />
                      <span className="graph-assistant-plan-stat-label">Connections</span>
                    </dt>
                    <dd>{hasExplicitOperations ? connectionOperations.length : plan.workflow.edges.length}</dd>
                  </div>
                  <div>
                    <dt aria-label="Groups" title="Groups">
                      <Layers3 size={13} aria-hidden="true" />
                      <span className="graph-assistant-plan-stat-label">Groups</span>
                    </dt>
                    <dd>{onlyArrangeOperations ? arrangedGroupCount : groupOperations.length}</dd>
                  </div>
                  <div>
                    <dt aria-label="Updates" title="Updates">
                      <PencilLine size={13} aria-hidden="true" />
                      <span className="graph-assistant-plan-stat-label">Updates</span>
                    </dt>
                    <dd>{fieldUpdateOperations.length + arrangeOperations.length}</dd>
                  </div>
                </dl>
                <div className="graph-assistant-plan-operation-list">
                  {onlyArrangeOperations ? (
                    <span>
                      Arrange {arrangedNodeCount} node{arrangedNodeCount === 1 ? "" : "s"}
                      {arrangedGroupCount ? ` and ${arrangedGroupCount} group${arrangedGroupCount === 1 ? "" : "s"}` : ""}
                    </span>
                  ) : addNodeOperations.length ? (
                    <ul>
                      {addNodeOperations.slice(0, 5).map((operation, index) => (
                        <li key={`${String(operation["op"] || "operation")}-${String(operation["node_ref"] || operation["node_id"] || index)}`}>
                          {String(operation["title"] || operation["node_type"] || operation["node_ref"] || "Node")}
                        </li>
                      ))}
                    </ul>
                  ) : fieldUpdateOperations.length ? (
                    <ul>
                      {fieldUpdateOperations.slice(0, 5).map((operation, index) => (
                        <li key={`${String(operation["op"] || "operation")}-${String(operation["node_ref"] || operation["node_id"] || index)}`}>
                          {operation["op"] === "set_node_title" ? "Update node title" : "Update node fields"}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span>No canvas changes are required.</span>
                  )}
                </div>
                {plan.graph_plan.questions.length || plan.graph_plan.warnings.length || plan.validation.warnings.length ? (
                  <div className="graph-assistant-plan-operation-list">
                    <ul>
                      {plan.graph_plan.questions.slice(0, 2).map((question, index) => (
                        <li key={`question-${index}`}>{question}</li>
                      ))}
                      {plan.graph_plan.warnings.slice(0, 2).map((warning, index) => (
                        <li key={`plan-warning-${index}`}>{graphPlanWarningCopy(warning)}</li>
                      ))}
                      {plan.validation.warnings.slice(0, 2).map((warning, index) => (
                        <li key={`validation-warning-${index}`}>{graphReviewIssueCopy(plan, warning)}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </details>
            ) : null}
            {presetTestReady && !kernelRunAction ? (
              <div className="graph-assistant-card-actions">
                <button
                  type="button"
                  className="graph-assistant-card-action-primary"
                  disabled={assistant.busy}
                  onClick={() => void assistant.sendContentMessage(
                    "Please prepare this test graph to run. Check the current inputs and pricing, then ask me for confirmation before starting it.",
                  )}
                  aria-label="Run test"
                  title="Review inputs and pricing, then prepare this test run for confirmation"
                >
                  <Sparkles size={15} aria-hidden="true" />
                  <span>Run test</span>
                </button>
              </div>
            ) : null}
            {planApplied && (onlyFieldUpdateOperations || onlyArrangeOperations) && onUndoLastAssistantChange ? (
              <div className="graph-assistant-card-actions">
                <button
                  type="button"
                  disabled={assistant.busy}
                  onClick={() => {
                    onUndoLastAssistantChange();
                    onEvent?.("Assistant change undone.", "muted");
                  }}
                  aria-label={onlyArrangeOperations ? "Undo assistant layout" : "Undo assistant node edit"}
                  title={onlyArrangeOperations ? "Undo the last Assistant workflow layout" : "Undo the last assistant node edit"}
                >
                  <Undo2 size={13} aria-hidden="true" />
                  <span>Undo change</span>
                </button>
              </div>
            ) : null}
            {!planApplied && !noCanvasChanges && !hasExplicitOperations && plan.graph_plan.questions.length ? <p className="graph-assistant-warning">{plan.graph_plan.questions[0]}</p> : null}
            {!planApplied && !noCanvasChanges && !hasExplicitOperations && !plan.validation.errors.length && plan.graph_plan.warnings.length ? <p className="graph-assistant-warning">{graphPlanWarningCopy(plan.graph_plan.warnings[0])}</p> : null}
            {!planApplied && plan.validation.errors.length ? <p className="graph-assistant-error">{graphReviewIssueCopy(plan, plan.validation.errors[0])}</p> : null}
            {!planApplied && hasExplicitOperations && assistant.canApply ? (
              <div className="graph-assistant-card-actions">
                <button
                  type="button"
                  className="graph-assistant-card-action-primary"
                  onClick={() => void assistant.applyPlan()}
                  aria-label={planActionAriaLabel}
                  title={planActionTitle}
                >
                  {assistant.status === "applying" ? <LoaderCircle size={15} /> : <CheckCircle2 size={15} />}
                  <span>{planActionLabel}</span>
                </button>
              </div>
            ) : null}
            </section>
            ) : null}
          </section>
        </div>

        <footer className="graph-assistant-footer">
          {assistant.error ? <p className="graph-assistant-error">{assistant.error}</p> : null}
          {assistant.runConfirmationNeedsRecheck ? (
            <button
              type="button"
              className="graph-assistant-card-action-primary"
              disabled={assistant.busy}
              onClick={() => void assistant.sendContentMessage(
                "Please check the current graph and current pricing again, then ask me for confirmation before starting it.",
              )}
            >
              Recheck graph and pricing
            </button>
          ) : null}
          <div className="graph-assistant-compose-row">
            <textarea
              value={assistant.draft}
              placeholder={ASSISTANT_PLACEHOLDER}
              onChange={(event) => assistant.setDraft(event.target.value)}
              aria-label="Assistant message"
            />
            <div className="graph-assistant-actions">
              <button
                type="button"
                className="graph-assistant-action-button"
                disabled={!assistant.draft.trim() || assistant.busy}
                onClick={() => void assistant.sendMessage()}
                aria-label="Send chat message"
                title="Send chat message"
              >
                {assistant.status === "sending" ? <LoaderCircle size={15} /> : <Send size={15} />}
              </button>
            </div>
          </div>
        </footer>
        </section>
      </aside>
      <MediaImagePickerDialog
        open={referencePicker.open}
        eyebrow="Reference Images"
        title="Choose a reference image"
        dialogLabel="Reference image picker"
        items={referencePickerItems}
        loading={referencePicker.loading}
        loadingMore={referencePicker.loadingMore}
        nextOffset={referencePicker.nextOffset}
        selectionId={referenceSelectionId}
        purpose="reference"
        imageFit="contain"
        itemLabel="reference image"
        emptyMessage="No reference images are available yet."
        loadingMessage="Loading reference images..."
        onClose={referencePicker.closePicker}
        onLoadMore={referencePicker.loadNextPage}
        onSelectItem={(referenceId) => void attachReferenceFromPicker(referenceId)}
      />
    </>
  );
}
