import { describe, expect, it, vi } from "vitest";

import { rankGraphNodeDefinitions } from "@/components/graph-studio/hooks/use-graph-node-search";
import { graphExecutionModeClass, graphExecutionModeLabel, normalizeGraphExecutionMode } from "@/components/graph-studio/utils/graph-node-execution";
import {
  computeGraphGroupBounds,
  graphGroupsForCanvas,
  moveGraphGroupBounds,
  moveGraphGroupNodes,
  pruneGraphGroupMembership,
  readGraphGroupsFromWorkflow,
  resizeGraphGroupBounds,
  serializeGraphGroups,
  syncGraphGroupMembership,
} from "@/components/graph-studio/utils/graph-groups";
import { assetIdsFromGraphRun, outputRefs } from "@/components/graph-studio/utils/graph-media-preview";
import { visibleGraphFields } from "@/components/graph-studio/utils/graph-node-fields";
import { computeGraphNodeLayout, graphEdgeStyleForPortType } from "@/components/graph-studio/utils/graph-node-layout";
import { visibleGraphInputPorts, visibleGraphOutputPorts } from "@/components/graph-studio/utils/graph-node-ports";
import { graphHandleDirection, graphPortIdFromHandle, inputGraphHandleId, outputGraphHandleId } from "@/components/graph-studio/utils/graph-port-handles";
import { graphPortAccepts } from "@/components/graph-studio/utils/graph-port-compatibility";
import { graphNodeHasTracingBorder, graphNodeStatusClass } from "@/components/graph-studio/utils/graph-node-status";
import { graphEstimateToolbarLabel, graphNodePricingLabel, graphPricingNeedsConfirmation } from "@/components/graph-studio/utils/graph-pricing";
import { graphReferenceBadgesForNodes } from "@/components/graph-studio/utils/graph-reference-badges";
import { buildGraphNodeHelpContent } from "@/components/graph-studio/utils/graph-node-help";
import { formatGraphRunEventForConsole, graphNodeActivitiesFromRunEvents } from "@/components/graph-studio/utils/graph-run-events";
import { contextMenuTargetNodeIds, executionModeForNodeIds, nextToggledExecutionMode, paneContextMenuTargetNodeIds } from "@/components/graph-studio/utils/graph-selection";
import { parseWorkflowImportText, sanitizeWorkflowForExport } from "@/components/graph-studio/utils/graph-workflow-transfer";
import type { StudioNode } from "@/components/graph-studio/types";
import type { GraphNodeDefinition } from "@/components/graph-studio/types";

const definitions: GraphNodeDefinition[] = [
  {
    type: "media.load_image",
    title: "Load Image",
    category: "Media",
    search_aliases: ["asset", "reference", "image"],
    source: { kind: "system" },
    ui: {
      default_size: { width: 280, height: 260 },
      min_size: { width: 260, height: 220 },
      max_size: { width: 860, height: 1200 },
      color: "green",
      accent: "green",
      icon: "image",
      preview: true,
    },
    ports: { inputs: [], outputs: [{ id: "image", label: "Image", type: "image" }] },
    fields: [],
  },
  {
    type: "image.transform",
    title: "Image Transform",
    category: "Image",
    search_aliases: ["resize", "scale", "crop", "pad", "convert", "metadata", "utility"],
    source: { kind: "system" },
    ui: {
      default_size: { width: 340, height: 460 },
      min_size: { width: 280, height: 360 },
      max_size: { width: 860, height: 1200 },
      color: "green",
      accent: "green",
      icon: "image",
      preview: false,
    },
    ports: {
      inputs: [{ id: "image", label: "Image", type: "image", accepts: ["image"] }],
      outputs: [
        { id: "image", label: "Image", type: "image" },
        { id: "metadata", label: "Metadata", type: "json" },
      ],
    },
    fields: [
      { id: "operation", label: "Operation", type: "select", default: "resize" },
      { id: "width", label: "Width", type: "integer" },
    ],
  },
  {
    type: "model.kie.nano_banana_pro",
    title: "Nano Banana Pro",
    category: "Models/Image",
    search_aliases: ["nano", "banana", "image"],
    source: { kind: "kie_model" },
    ui: {
      default_size: { width: 380, height: 560 },
      min_size: { width: 340, height: 440 },
      max_size: { width: 860, height: 1200 },
      color: "blue",
      accent: "blue",
      icon: "sparkles",
      preview: false,
    },
    ports: {
      inputs: [
        { id: "prompt", label: "Prompt", type: "text", accepts: ["text"] },
        { id: "image_refs", label: "Reference Images", type: "image", accepts: ["image"], array: true },
      ],
      outputs: [{ id: "image", label: "Image", type: "image" }],
    },
    fields: [{ id: "prompt", label: "Prompt", type: "textarea", connectable: true, port_type: "text" }],
  },
  {
    type: "debug.inspect",
    title: "Inspect",
    category: "Debug",
    search_aliases: ["json"],
    source: { kind: "system" },
    ui: {
      default_size: { width: 320, height: 280 },
      min_size: { width: 260, height: 220 },
      max_size: { width: 860, height: 1200 },
      color: "orange",
      accent: "orange",
      icon: "bug",
      preview: false,
    },
    ports: {
      inputs: [{ id: "value", label: "Value", type: "any", accepts: ["text", "image", "video", "audio", "asset", "job", "json"] }],
      outputs: [{ id: "json", label: "JSON", type: "json" }],
    },
    fields: [],
  },
  {
    type: "display.any",
    title: "Display Any",
    category: "Preview",
    search_aliases: ["display", "preview", "inspect", "view", "any", "json", "text", "media"],
    source: { kind: "system" },
    ui: {
      default_size: { width: 460, height: 520 },
      min_size: { width: 360, height: 320 },
      max_size: { width: 2400, height: 3200 },
      color: "blue",
      accent: "blue",
      icon: "info",
      preview: false,
    },
    ports: {
      inputs: [{ id: "value", label: "Value", type: "any", accepts: ["text", "image", "video", "audio", "asset", "reference_media", "job", "json", "any"], max: 1 }],
      outputs: [
        { id: "value", label: "Value", type: "any" },
        { id: "json", label: "JSON", type: "json" },
      ],
    },
    fields: [],
  },
  {
    type: "prompt.text",
    title: "Prompt Text",
    category: "Prompt",
    search_aliases: ["prompt", "text", "caption", "description", "input", "pass through"],
    source: { kind: "system" },
    ui: {
      default_size: { width: 340, height: 320 },
      min_size: { width: 260, height: 220 },
      max_size: { width: 860, height: 1200 },
      color: "text",
      accent: "purple",
      icon: "text",
      preview: false,
      connection_dependent_fields: { mode: "text" },
    },
    ports: {
      inputs: [{ id: "text", label: "Text", type: "text", accepts: ["text"], required: false, max: 1 }],
      outputs: [{ id: "text", label: "Text", type: "text" }],
    },
    fields: [
      { id: "mode", label: "Mode", type: "select", default: "replace", options: ["replace", "append", "prepend"] },
      { id: "text", label: "Prompt", type: "textarea", connectable: true, port_type: "text" },
    ],
  },
  {
    type: "prompt.llm",
    title: "LLM Prompt",
    category: "Prompt",
    search_aliases: ["llm", "openrouter", "codex", "vision", "image describe", "prompt enhance"],
    source: { kind: "external_llm", providers: ["studio_default", "openrouter", "codex_local", "local_openai"] },
    ui: {
      default_size: { width: 420, height: 720 },
      min_size: { width: 360, height: 560 },
      max_size: { width: 860, height: 1200 },
      color: "text",
      accent: "purple",
      icon: "sparkles",
      preview: false,
    },
    ports: {
      inputs: [
        { id: "user_prompt", label: "User Prompt", type: "text", accepts: ["text"] },
        { id: "image", label: "Image", type: "image", accepts: ["image"] },
      ],
      outputs: [
        { id: "text", label: "Text", type: "text" },
        { id: "metadata", label: "Metadata", type: "json", advanced: true },
      ],
    },
    fields: [
      { id: "mode", label: "Mode", type: "select", default: "rewrite_prompt" },
      { id: "provider", label: "Provider", type: "select", default: "studio_default" },
      { id: "model_id", label: "Model ID", type: "text", visible_if: { field: "provider", not_equals: "studio_default" } },
      { id: "system_prompt", label: "System Prompt", type: "textarea" },
      { id: "user_prompt", label: "User Prompt", type: "textarea", connectable: true, port_type: "text" },
    ],
  },
  {
    type: "prompt.recipe",
    title: "Prompt Recipe",
    category: "Prompt",
    search_aliases: ["prompt recipe", "recipe", "director", "analysis", "storyboard", "video director", "image director"],
    source: { kind: "external_llm", providers: ["studio_default", "openrouter", "codex_local", "local_openai"], recipe_backed: true },
    ui: {
      default_size: { width: 420, height: 760 },
      min_size: { width: 360, height: 560 },
      max_size: { width: 860, height: 1240 },
      color: "text",
      accent: "purple",
      icon: "sparkles",
      preview: false,
    },
    ports: {
      inputs: [
        { id: "user_prompt", label: "User Prompt", type: "text", accepts: ["text"] },
        { id: "image_refs", label: "Image Refs", type: "image", accepts: ["image"], array: true, max: 8 },
      ],
      outputs: [
        { id: "text", label: "Text", type: "text" },
        { id: "result", label: "Result", type: "json" },
      ],
    },
    fields: [
      { id: "recipe_category", label: "Recipe Category", type: "select", default: "all", options: [{ label: "All Categories", value: "all" }, { label: "Image", value: "image" }] },
      { id: "recipe_id", label: "Prompt Recipe", type: "prompt_recipe_picker", required: true },
    ],
  },
  {
    type: "internal.hidden_debug",
    title: "Internal Hidden Debug",
    category: "Debug",
    search_aliases: ["hidden", "debug"],
    source: { kind: "system", hidden_in_search: true },
    ui: {
      default_size: { width: 320, height: 280 },
      min_size: { width: 260, height: 220 },
      max_size: { width: 860, height: 1200 },
      color: "orange",
      accent: "orange",
      icon: "bug",
      preview: false,
    },
    ports: {
      inputs: [{ id: "value", label: "Value", type: "json", accepts: ["json"] }],
      outputs: [{ id: "json", label: "JSON", type: "json" }],
    },
    fields: [],
  },
  {
    type: "prompt.parse",
    title: "Prompt Parse",
    category: "Prompt",
    search_aliases: ["prompt parse", "split prompts", "fanout", "json parse"],
    source: { kind: "system" },
    ui: {
      default_size: { width: 340, height: 520 },
      min_size: { width: 280, height: 360 },
      max_size: { width: 640, height: 860 },
      color: "json",
      accent: "purple",
      icon: "json",
      preview: false,
    },
    ports: {
      inputs: [{ id: "result", label: "Result", type: "json", accepts: ["json"], required: true }],
      outputs: [
        { id: "prompt_1", label: "Prompt 1", type: "text" },
        { id: "prompt_2", label: "Prompt 2", type: "text" },
        { id: "result", label: "Result", type: "json" },
      ],
    },
    fields: [],
  },
  {
    type: "model.kie.kling_2_6_i2v",
    title: "Kling 2.6 Image to Video",
    category: "Models/Video",
    search_aliases: ["kling", "video", "i2v"],
    source: { kind: "kie_model", model_key: "kling-2.6-i2v", output_media_type: "video" },
    ui: {
      default_size: { width: 380, height: 560 },
      min_size: { width: 340, height: 440 },
      max_size: { width: 860, height: 1200 },
      color: "cyan",
      accent: "cyan",
      icon: "video",
      preview: false,
    },
    ports: {
      inputs: [
        { id: "prompt", label: "Prompt", type: "text", accepts: ["text"] },
        { id: "image_refs", label: "Reference Images", type: "image", accepts: ["image"], array: true, required: true },
      ],
      outputs: [{ id: "video", label: "Video", type: "video" }],
    },
    fields: [
      { id: "prompt", label: "Prompt", type: "textarea", connectable: true, port_type: "text" },
      { id: "duration", label: "Duration", type: "select", options: [5, 10], default: 5 },
    ],
  },
  {
    type: "media.save_video",
    title: "Save Video",
    category: "Media",
    search_aliases: ["save", "video", "output"],
    source: { kind: "system" },
    ui: {
      default_size: { width: 320, height: 400 },
      min_size: { width: 280, height: 340 },
      max_size: { width: 860, height: 1200 },
      color: "yellow",
      accent: "yellow",
      icon: "save",
      preview: true,
    },
    ports: {
      inputs: [
        { id: "video", label: "Video", type: "video", accepts: ["video"], required: true },
        { id: "audio", label: "Audio", type: "audio", accepts: ["audio"], required: false },
      ],
      outputs: [
        { id: "asset", label: "Asset", type: "asset" },
        { id: "video", label: "Video", type: "video" },
      ],
    },
    fields: [
      { id: "project_id", label: "Group", type: "select" },
      { id: "filename_prefix", label: "Filename Prefix", type: "text", default: "graph-video" },
      { id: "format", label: "Format", type: "select", default: "source_original", options: ["source_original", "mp4_h264_browser", "mp4_h265", "webm_vp9"] },
      { id: "codec", label: "Codec", type: "select", default: "auto", options: ["auto", "h264", "h265", "vp9"] },
      { id: "audio_policy", label: "Audio", type: "select", default: "keep_video_audio" },
      { id: "audio_fit", label: "Audio Fit", type: "select", default: "trim_to_video", visible_if: { field: "audio_policy", in: ["replace", "mix"] } },
      { id: "video_audio_volume", label: "Video Audio Volume", type: "float", default: 1, visible_if: { field: "audio_policy", equals: "mix" } },
    ],
  },
  {
    type: "media.load_audio",
    title: "Load Audio",
    category: "Media",
    search_aliases: ["reference", "input", "audio", "sound"],
    source: { kind: "system" },
    ui: {
      default_size: { width: 300, height: 220 },
      min_size: { width: 260, height: 220 },
      max_size: { width: 860, height: 1200 },
      color: "cyan",
      accent: "cyan",
      icon: "audio",
      preview: true,
    },
    ports: { inputs: [], outputs: [{ id: "audio", label: "Audio", type: "audio" }] },
    fields: [],
  },
  {
    type: "media.save_audio",
    title: "Save Audio",
    category: "Media",
    search_aliases: ["save", "output", "asset", "audio"],
    source: { kind: "system" },
    ui: {
      default_size: { width: 300, height: 320 },
      min_size: { width: 280, height: 300 },
      max_size: { width: 860, height: 1200 },
      color: "yellow",
      accent: "yellow",
      icon: "save",
      preview: true,
    },
    ports: {
      inputs: [{ id: "audio", label: "Audio", type: "audio", accepts: ["audio"], required: true }],
      outputs: [{ id: "asset", label: "Asset", type: "asset" }],
    },
    fields: [
      { id: "project_id", label: "Group", type: "select" },
      { id: "format", label: "Format", type: "select", default: "source_original", options: ["source_original", "mp3", "wav", "m4a_aac"] },
    ],
  },
  {
    type: "media.save_music_track",
    title: "Save Music Track",
    category: "Media",
    search_aliases: ["save", "output", "asset", "audio", "music", "song", "suno", "track"],
    source: { kind: "system" },
    ui: {
      default_size: { width: 340, height: 340 },
      min_size: { width: 280, height: 300 },
      max_size: { width: 860, height: 1200 },
      color: "yellow",
      accent: "yellow",
      icon: "audio",
      preview: true,
    },
    ports: {
      inputs: [{ id: "track", label: "Music Track", type: "music_track", accepts: ["music_track"], required: true }],
      outputs: [
        { id: "asset", label: "Asset", type: "asset" },
        { id: "audio", label: "Audio", type: "audio" },
      ],
    },
    fields: [{ id: "project_id", label: "Group", type: "select" }],
  },
  {
    type: "audio.transform",
    title: "Audio Transform",
    category: "Audio",
    search_aliases: ["audio", "sound", "trim", "convert", "normalize", "metadata", "utility"],
    source: { kind: "system" },
    ui: {
      default_size: { width: 320, height: 380 },
      min_size: { width: 280, height: 340 },
      max_size: { width: 860, height: 1200 },
      color: "cyan",
      accent: "cyan",
      icon: "audio",
      preview: false,
    },
    ports: {
      inputs: [{ id: "audio", label: "Audio", type: "audio", accepts: ["audio"], required: true }],
      outputs: [
        { id: "audio", label: "Audio", type: "audio" },
        { id: "metadata", label: "Metadata", type: "json" },
      ],
    },
    fields: [
      { id: "operation", label: "Operation", type: "select", default: "extract_metadata" },
      { id: "format", label: "Format", type: "select", default: "mp3", visible_if: { field: "operation", in: ["trim", "convert_format", "normalize"] } },
    ],
  },
  {
    type: "model.kie.seedance_2_0",
    title: "Seedance 2.0",
    category: "Models/Video",
    search_aliases: ["seedance", "video", "audio", "kie"],
    source: { kind: "kie_model", model_key: "seedance-2.0", output_media_type: "video" },
    ui: {
      default_size: { width: 380, height: 560 },
      min_size: { width: 340, height: 440 },
      max_size: { width: 860, height: 1200 },
      color: "cyan",
      accent: "cyan",
      icon: "video",
      preview: false,
    },
    ports: {
      inputs: [
        { id: "prompt", label: "Prompt", type: "text", accepts: ["text"] },
        { id: "start_frame", label: "Start Frame", type: "image", accepts: ["image"], max: 1 },
        { id: "end_frame", label: "End Frame", type: "image", accepts: ["image"], max: 1 },
        { id: "reference_images", label: "Reference Images", type: "image", accepts: ["image"], array: true },
        { id: "reference_videos", label: "Reference Videos", type: "video", accepts: ["video"], array: true },
        { id: "reference_audios", label: "Reference Audio", type: "audio", accepts: ["audio"], array: true },
      ],
      outputs: [{ id: "video", label: "Video", type: "video" }],
    },
    fields: [{ id: "prompt", label: "Prompt", type: "textarea", connectable: true, port_type: "text" }],
  },
  {
    type: "video.combine",
    title: "Video Combine",
    category: "Video",
    search_aliases: ["video", "combine", "concat", "merge", "transition"],
    source: { kind: "system" },
    ui: {
      default_size: { width: 360, height: 560 },
      min_size: { width: 320, height: 520 },
      max_size: { width: 860, height: 1200 },
      color: "cyan",
      accent: "cyan",
      icon: "video",
      preview: true,
    },
    ports: {
      inputs: Array.from({ length: 12 }, (_, index) => ({
        id: `video_${index + 1}`,
        label: `Video ${index + 1}`,
        type: "video",
        accepts: ["video"],
        required: index < 2,
        advanced: index >= 4,
      })),
      outputs: [
        { id: "video", label: "Video", type: "video" },
        { id: "metadata", label: "Metadata", type: "json" },
      ],
    },
    fields: [
      { id: "clip_count", label: "Clip Count", type: "integer", default: 4 },
      { id: "transition", label: "Transition", type: "select", default: "crossfade" },
      { id: "transition_duration_seconds", label: "Transition Seconds", type: "float", default: 0.5, visible_if: { field: "transition", not_equals: "hard_cut" } },
      { id: "resolution_policy", label: "Resolution", type: "select", default: "first_clip" },
      { id: "width", label: "Width", type: "integer", default: 1080, visible_if: { field: "resolution_policy", equals: "custom" } },
      { id: "height", label: "Height", type: "integer", default: 1920, visible_if: { field: "resolution_policy", equals: "custom" } },
    ],
  },
];

describe("graph node search", () => {
  it("ranks exact title matches before aliases and categories", () => {
    const results = rankGraphNodeDefinitions(definitions, "resize");
    expect(results[0].definition.type).toBe("image.transform");
  });

  it("filters by input, output, category, and source tokens", () => {
    expect(rankGraphNodeDefinitions(definitions, "i:image").map((item) => item.definition.type)).toContain("image.transform");
    expect(rankGraphNodeDefinitions(definitions, "o:json").map((item) => item.definition.type)).toEqual([
      "audio.transform",
      "display.any",
      "image.transform",
      "debug.inspect",
      "prompt.llm",
      "prompt.parse",
      "prompt.recipe",
      "video.combine",
    ]);
    expect(rankGraphNodeDefinitions(definitions, "c:models").map((item) => item.definition.type)).toEqual([
      "model.kie.kling_2_6_i2v",
      "model.kie.nano_banana_pro",
      "model.kie.seedance_2_0",
    ]);
    expect(rankGraphNodeDefinitions(definitions, "s:kie").map((item) => item.definition.type)).toEqual([
      "model.kie.kling_2_6_i2v",
      "model.kie.nano_banana_pro",
      "model.kie.seedance_2_0",
    ]);
  });

  it("filters compatible nodes when a wire is released on empty canvas", () => {
    const results = rankGraphNodeDefinitions(definitions, "", { from: "output", portType: "image", nodeId: "load", handleId: "image" }).map(
      (item) => item.definition.type,
    );
    expect(results).toContain("image.transform");
    expect(results).toContain("model.kie.nano_banana_pro");
    expect(results).not.toContain("media.load_image");
  });

  it("finds generated Kling video models and save-video nodes", () => {
    expect(rankGraphNodeDefinitions(definitions, "kling video")[0].definition.type).toBe("model.kie.kling_2_6_i2v");
    expect(rankGraphNodeDefinitions(definitions, "save video")[0].definition.type).toBe("media.save_video");
    expect(rankGraphNodeDefinitions(definitions, "combine video")[0].definition.type).toBe("video.combine");
    expect(rankGraphNodeDefinitions(definitions, "concat video")[0].definition.type).toBe("video.combine");
    expect(rankGraphNodeDefinitions(definitions, "merge video")[0].definition.type).toBe("video.combine");
    expect(rankGraphNodeDefinitions(definitions, "load audio")[0].definition.type).toBe("media.load_audio");
    expect(rankGraphNodeDefinitions(definitions, "save audio")[0].definition.type).toBe("media.save_audio");
    expect(rankGraphNodeDefinitions(definitions, "save music")[0].definition.type).toBe("media.save_music_track");
    expect(rankGraphNodeDefinitions(definitions, "audio transform")[0].definition.type).toBe("audio.transform");
    expect(rankGraphNodeDefinitions(definitions, "seedance audio")[0].definition.type).toBe("model.kie.seedance_2_0");
    expect(rankGraphNodeDefinitions(definitions, "o:video").map((item) => item.definition.type)).toContain("model.kie.kling_2_6_i2v");
    expect(rankGraphNodeDefinitions(definitions, "i:video").map((item) => item.definition.type)).toContain("media.save_video");
    expect(rankGraphNodeDefinitions(definitions, "i:video").map((item) => item.definition.type)).toContain("video.combine");
    expect(rankGraphNodeDefinitions(definitions, "i:audio").map((item) => item.definition.type)).toContain("media.save_audio");
    expect(rankGraphNodeDefinitions(definitions, "i:audio").map((item) => item.definition.type)).toContain("media.save_video");
    expect(rankGraphNodeDefinitions(definitions, "i:audio").map((item) => item.definition.type)).toContain("model.kie.seedance_2_0");
    expect(rankGraphNodeDefinitions(definitions, "i:music_track").map((item) => item.definition.type)).toContain("media.save_music_track");
  });

  it("finds the LLM prompt node by provider and vision aliases", () => {
    expect(rankGraphNodeDefinitions(definitions, "openrouter prompt")[0].definition.type).toBe("prompt.llm");
    expect(rankGraphNodeDefinitions(definitions, "vision prompt").map((item) => item.definition.type)).toContain("prompt.llm");
    expect(rankGraphNodeDefinitions(definitions, "image describe").map((item) => item.definition.type)).toContain("prompt.llm");
    expect(rankGraphNodeDefinitions(definitions, "pass through text").map((item) => item.definition.type)).toContain("prompt.text");
    expect(rankGraphNodeDefinitions(definitions, "o:text").map((item) => item.definition.type)).toContain("prompt.llm");
    expect(rankGraphNodeDefinitions(definitions, "o:text").map((item) => item.definition.type)).toContain("prompt.text");
    expect(rankGraphNodeDefinitions(definitions, "i:text").map((item) => item.definition.type)).toContain("prompt.text");
    expect(rankGraphNodeDefinitions(definitions, "i:image").map((item) => item.definition.type)).toContain("prompt.llm");
    expect(rankGraphNodeDefinitions(definitions, "prompt recipe")[0].definition.type).toBe("prompt.recipe");
    expect(rankGraphNodeDefinitions(definitions, "image prompt director").map((item) => item.definition.type)).toContain("prompt.recipe");
    expect(rankGraphNodeDefinitions(definitions, "prompt parse").map((item) => item.definition.type)).toContain("prompt.parse");
    expect(rankGraphNodeDefinitions(definitions, "display any")[0].definition.type).toBe("display.any");
    expect(rankGraphNodeDefinitions(definitions, "i:json").map((item) => item.definition.type)).toContain("display.any");
  });

  it("hides hidden internal definitions from node search", () => {
    expect(rankGraphNodeDefinitions(definitions, "hidden").map((item) => item.definition.type)).not.toContain("internal.hidden_debug");
  });
});

describe("graph node layout", () => {
  it("clamps stale saved node dimensions against definition constraints", () => {
    const layout = computeGraphNodeLayout(definitions[2], { style: { width: 120, height: 80 } });
    expect(layout.width).toBeGreaterThanOrEqual(340);
    expect(layout.height).toBeGreaterThanOrEqual(440);
  });

  it("uses a shared typed color map for graph edges", () => {
    expect(graphEdgeStyleForPortType("image").stroke).toBe("#b7f14f");
    expect(graphEdgeStyleForPortType("video").stroke).toBe("#60d2ff");
  });

  it("keeps image and video preview nodes large enough for usable media", () => {
    const loadImageLayout = computeGraphNodeLayout(definitions[0], { style: { width: 200, height: 180 } });
    const saveVideoDefinition = definitions.find((definition) => definition.type === "media.save_video");
    const combineVideoDefinition = definitions.find((definition) => definition.type === "video.combine");
    expect(saveVideoDefinition).toBeDefined();
    expect(combineVideoDefinition).toBeDefined();
    expect(loadImageLayout.width).toBeGreaterThanOrEqual(360);
    expect(loadImageLayout.height).toBeGreaterThanOrEqual(360);
    expect(computeGraphNodeLayout(saveVideoDefinition!, { style: { width: 280, height: 320 } }).width).toBeGreaterThanOrEqual(380);
    expect(computeGraphNodeLayout(combineVideoDefinition!, { style: { width: 300, height: 340 } }).height).toBeGreaterThanOrEqual(360);
  });

  it("shows only the requested split image outputs", () => {
    const splitDefinition: GraphNodeDefinition = {
      type: "image.split",
      title: "Split Images",
      category: "Image",
      source: { kind: "system" },
      ui: {
        default_size: { width: 320, height: 360 },
        min_size: { width: 260, height: 300 },
        max_size: { width: 860, height: 1200 },
        color: "green",
        accent: "green",
        icon: "image",
      },
      ports: {
        inputs: [{ id: "images", label: "Images", type: "image", array: true }],
        outputs: Array.from({ length: 25 }, (_, index) => ({
          id: `image_${index + 1}`,
          label: `Image ${index + 1}`,
          type: "image",
          advanced: true,
        })),
      },
      fields: [{ id: "outputs", label: "Outputs", type: "integer", default: 4 }],
    };
    expect(visibleGraphOutputPorts(splitDefinition, {}).map((port) => port.id)).toEqual(["image_1", "image_2", "image_3", "image_4"]);
    expect(visibleGraphOutputPorts(splitDefinition, { outputs: 2 }).map((port) => port.id)).toEqual(["image_1", "image_2"]);
  });

  it("shows only the requested video combine inputs", () => {
    const combineDefinition = definitions.find((definition) => definition.type === "video.combine");
    expect(combineDefinition).toBeDefined();
    expect(visibleGraphInputPorts(combineDefinition!, {}).map((port) => port.id)).toEqual(["video_1", "video_2", "video_3", "video_4"]);
    expect(visibleGraphInputPorts(combineDefinition!, { clip_count: 2 }).map((port) => port.id)).toEqual(["video_1", "video_2"]);
    expect(visibleGraphInputPorts(combineDefinition!, { clip_count: 6 }).map((port) => port.id)).toEqual([
      "video_1",
      "video_2",
      "video_3",
      "video_4",
      "video_5",
      "video_6",
    ]);
  });

  it("shows conditional video combine fields only when their controlling value needs them", () => {
    const combineDefinition = definitions.find((definition) => definition.type === "video.combine");
    expect(combineDefinition).toBeDefined();
    expect(visibleGraphFields(combineDefinition!, {}).map((field) => field.id)).toEqual([
      "clip_count",
      "transition",
      "transition_duration_seconds",
      "resolution_policy",
    ]);
    expect(visibleGraphFields(combineDefinition!, { resolution_policy: "custom" }).map((field) => field.id)).toContain("width");
    expect(visibleGraphFields(combineDefinition!, { resolution_policy: "custom" }).map((field) => field.id)).toContain("height");
    expect(visibleGraphFields(combineDefinition!, { transition: "hard_cut" }).map((field) => field.id)).not.toContain("transition_duration_seconds");
  });

  it("shows save-video mux fields and audio transform fields conditionally", () => {
    const saveVideoDefinition = definitions.find((definition) => definition.type === "media.save_video");
    const audioTransformDefinition = definitions.find((definition) => definition.type === "audio.transform");
    expect(saveVideoDefinition).toBeDefined();
    expect(audioTransformDefinition).toBeDefined();
    expect(visibleGraphFields(saveVideoDefinition!, {}).map((field) => field.id)).not.toContain("audio_fit");
    expect(visibleGraphFields(saveVideoDefinition!, { audio_policy: "replace" }).map((field) => field.id)).toContain("audio_fit");
    expect(visibleGraphFields(saveVideoDefinition!, { audio_policy: "mix" }).map((field) => field.id)).toContain("video_audio_volume");
    expect(visibleGraphFields(audioTransformDefinition!, {}).map((field) => field.id)).toEqual(["operation"]);
    expect(visibleGraphFields(audioTransformDefinition!, { operation: "normalize" }).map((field) => field.id)).toContain("format");
  });

  it("hides connection-dependent fields until the matching input is wired", () => {
    const promptDefinition = definitions.find((definition) => definition.type === "prompt.text");
    expect(promptDefinition).toBeDefined();

    expect(visibleGraphFields(promptDefinition!, {}).map((field) => field.id)).toEqual(["text"]);
    expect(visibleGraphFields(promptDefinition!, {}, ["text"]).map((field) => field.id)).toEqual(["mode", "text"]);
  });

  it("shows transform outputs based on selected operation", () => {
    expect(visibleGraphOutputPorts(definitions[1], {}).map((port) => port.id)).toEqual(["image"]);
    expect(visibleGraphOutputPorts(definitions[1], { operation: "extract_metadata" }).map((port) => port.id)).toEqual(["metadata"]);
    const videoExtractDefinition: GraphNodeDefinition = {
      type: "video.extract",
      title: "Video Extract",
      category: "Video",
      source: { kind: "system" },
      ports: {
        inputs: [{ id: "video", label: "Video", type: "video" }],
        outputs: [
          { id: "image", label: "Image", type: "image" },
          { id: "images", label: "Frames", type: "image", array: true },
          { id: "audio", label: "Audio", type: "audio" },
          { id: "metadata", label: "Metadata", type: "json" },
        ],
      },
      fields: [{ id: "operation", label: "Operation", type: "select", default: "poster_frame" }],
    };
    expect(visibleGraphOutputPorts(videoExtractDefinition, {}).map((port) => port.id)).toEqual(["image"]);
    expect(visibleGraphOutputPorts(videoExtractDefinition, { operation: "extract_frames" }).map((port) => port.id)).toEqual(["images"]);
    expect(visibleGraphOutputPorts(videoExtractDefinition, { operation: "extract_audio" }).map((port) => port.id)).toEqual(["audio"]);
    const audioTransformDefinition = definitions.find((definition) => definition.type === "audio.transform");
    expect(audioTransformDefinition).toBeDefined();
    expect(visibleGraphOutputPorts(audioTransformDefinition!, {}).map((port) => port.id)).toEqual(["metadata"]);
    expect(visibleGraphOutputPorts(audioTransformDefinition!, { operation: "trim" }).map((port) => port.id)).toEqual(["audio"]);
  });

  it("shows conditional model outputs only when their controlling field is enabled", () => {
    const seedanceDefinition: GraphNodeDefinition = {
      type: "model.kie.seedance_2_0",
      title: "Seedance 2.0",
      category: "Models/Video",
      source: { kind: "kie_model", model_key: "seedance-2.0", output_media_type: "video" },
      ports: {
        inputs: [],
        outputs: [
          { id: "video", label: "Video", type: "video" },
          { id: "image", label: "Last Frame", type: "image", visible_if: { field: "return_last_frame", equals: true } },
          { id: "job", label: "Job", type: "job", advanced: true },
        ],
      },
      fields: [{ id: "return_last_frame", label: "Output Last Frame", type: "boolean", default: false }],
    };

    expect(visibleGraphOutputPorts(seedanceDefinition, {}).map((port) => port.id)).toEqual(["video"]);
    expect(visibleGraphOutputPorts(seedanceDefinition, { return_last_frame: true }).map((port) => port.id)).toEqual(["video", "image"]);
  });
});

describe("graph port compatibility", () => {
  it("uses one accepts contract for typed ports and any ports", () => {
    expect(graphPortAccepts("image", { id: "value", label: "Value", type: "any" })).toBe(true);
    expect(graphPortAccepts("video", { id: "value", label: "Value", type: "json", accepts: ["any"] })).toBe(true);
    expect(graphPortAccepts("image", { id: "video", label: "Video", type: "video", accepts: ["video"] })).toBe(false);
    expect(graphPortAccepts("text", { id: "text", label: "Text", type: "text", accepts: ["text"] })).toBe(true);
  });

  it("keeps directional canvas handle ids separate from backend port ids", () => {
    expect(inputGraphHandleId("image")).toBe("in:image");
    expect(outputGraphHandleId("image")).toBe("out:image");
    expect(graphHandleDirection(inputGraphHandleId("image"))).toBe("input");
    expect(graphHandleDirection(outputGraphHandleId("image"))).toBe("output");
    expect(graphPortIdFromHandle(inputGraphHandleId("image"))).toBe("image");
    expect(graphPortIdFromHandle(outputGraphHandleId("image"))).toBe("image");
  });
});

describe("graph media preview helpers", () => {
  it("collects audio output refs for preview and run asset hydration", () => {
    expect(outputRefs({ audio: [{ asset_id: "asset_audio_1" }] })).toEqual([{ asset_id: "asset_audio_1" }]);
    expect(outputRefs({ value: [{ reference_id: "ref_image_1" }] })).toEqual([{ reference_id: "ref_image_1" }]);
    expect(assetIdsFromGraphRun({ output_snapshot_json: { audio: [{ asset_id: "asset_audio_2" }] }, nodes: [] })).toEqual(["asset_audio_2"]);
  });
});

describe("graph node status visuals", () => {
  it("animates only actively running nodes", () => {
    expect(graphNodeHasTracingBorder("running")).toBe(true);
    expect(graphNodeHasTracingBorder("queued")).toBe(false);
    expect(graphNodeHasTracingBorder("cached")).toBe(false);
    expect(graphNodeHasTracingBorder("bypassed")).toBe(false);
    expect(graphNodeHasTracingBorder("completed")).toBe(false);
    expect(graphNodeHasTracingBorder("failed")).toBe(false);
  });

  it("normalizes unknown statuses to a stable class", () => {
    expect(graphNodeStatusClass("queued")).toBe("graph-node-queued");
    expect(graphNodeStatusClass("something-new")).toBe("graph-node-unknown");
  });
});

describe("graph pricing helpers", () => {
  it("formats node and graph estimates and marks unknown pricing", () => {
    const estimate = {
      pricing_summary: { total: { estimated_credits: 110, estimated_cost_usd: 0.55 }, has_numeric_estimate: true, has_unknown_pricing: false },
      nodes: {
        model: { node_id: "model", node_type: "model.kie.nano_banana_pro", pricing_summary: { total: { estimated_credits: 10, estimated_cost_usd: 0.05 }, has_numeric_estimate: true } },
      },
      warnings: [],
    };
    expect(graphEstimateToolbarLabel(estimate)).toBe("Graph ≈110 cr · $0.55");
    expect(graphNodePricingLabel(estimate.nodes.model)).toBe("≈10 cr · $0.05");
    expect(graphPricingNeedsConfirmation(estimate, 200)).toBe(false);
    expect(graphPricingNeedsConfirmation(estimate, 50)).toBe(true);
    expect(graphNodePricingLabel({ ...estimate.nodes.model, warnings: [{ code: "missing_model_pricing", message: "missing" }] })).toBe("price ?");
    expect(graphPricingNeedsConfirmation({ ...estimate, pricing_summary: { ...estimate.pricing_summary, has_unknown_pricing: true } }, 200)).toBe(true);
  });

  it("renders usd-only external estimates without fake credits", () => {
    const estimate = {
      pricing_summary: {
        total: { estimated_credits: null, estimated_cost_usd: 0.0184 },
        has_numeric_estimate: true,
        has_unknown_pricing: false,
        is_authoritative: false,
        pricing_status: "estimated_external_llm",
      },
      nodes: {
        recipe: {
          node_id: "recipe",
          node_type: "prompt.recipe",
          pricing_summary: {
            total: { estimated_credits: null, estimated_cost_usd: 0.0184 },
            has_numeric_estimate: true,
            pricing_status: "estimated_external_llm",
          },
        },
      },
      warnings: [],
    };
    expect(graphEstimateToolbarLabel(estimate)).toBe("Graph $0.02 estimated");
    expect(graphNodePricingLabel(estimate.nodes.recipe)).toBe("$0.02");
    expect(graphPricingNeedsConfirmation(estimate, 200)).toBe(false);
  });
});

describe("graph node execution metadata", () => {
  it("normalizes and labels selective execution modes", () => {
    expect(normalizeGraphExecutionMode("frozen")).toBe("frozen");
    expect(normalizeGraphExecutionMode("unexpected")).toBe("enabled");
    expect(graphExecutionModeLabel("bypassed")).toBe("Bypassed");
    expect(graphExecutionModeLabel("frozen")).toBe("Muted");
    expect(graphExecutionModeLabel("muted")).toBe("Disabled");
    expect(graphExecutionModeClass("muted")).toBe("graph-node-execution-muted");
  });
});

describe("graph selection behavior", () => {
  const selectionNodes = [
    {
      id: "a",
      selected: true,
      data: { executionMode: "bypassed" },
    },
    {
      id: "b",
      selected: true,
      data: { executionMode: "bypassed" },
    },
    {
      id: "c",
      selected: false,
      data: { executionMode: "enabled" },
    },
  ] as StudioNode[];

  it("targets all selected nodes when right-clicking a selected node", () => {
    expect(contextMenuTargetNodeIds(selectionNodes, "a")).toEqual(["a", "b"]);
  });

  it("targets only the clicked node when right-clicking outside the selection", () => {
    expect(contextMenuTargetNodeIds(selectionNodes, "c")).toEqual(["c"]);
  });

  it("targets selected nodes from pane right-click before opening node search", () => {
    expect(paneContextMenuTargetNodeIds(selectionNodes)).toEqual(["a", "b"]);
    expect(paneContextMenuTargetNodeIds(selectionNodes.map((node) => ({ ...node, selected: false })))).toEqual([]);
  });

  it("toggles selected execution modes like Comfy-style selected node actions", () => {
    expect(nextToggledExecutionMode(selectionNodes, ["a", "b"], "bypassed")).toBe("enabled");
    expect(nextToggledExecutionMode(selectionNodes, ["a", "c"], "frozen")).toBe("frozen");
    expect(executionModeForNodeIds(selectionNodes, ["a", "b"])).toBe("bypassed");
    expect(executionModeForNodeIds(selectionNodes, ["a", "c"])).toBe("enabled");
  });
});

describe("graph workflow transfer", () => {
  it("sanitizes exported workflows without dropping safe UI metadata", () => {
    const payload = sanitizeWorkflowForExport(
      {
        schema_version: 1,
        workflow_id: "workflow_1",
        name: "Export Test",
        nodes: [
          {
            id: "node_1",
            type: "media.load_image",
            position: { x: 1, y: 2 },
            fields: {
              reference_id: "ref_123",
              api_key: "should-not-export",
              local_path: "/Users/example/image.png",
            },
            metadata: { ui: { customTitle: "Source", nodeColor: "#17231d" }, execution: { mode: "frozen" } },
          },
        ],
        edges: [],
        metadata: {
          groups: [
            {
              id: "group_1",
              title: "Inputs",
              color: "purple",
              node_ids: ["node_1"],
              bounds: { x: 0, y: 0, width: 420, height: 300 },
              execution: { mode: "muted" },
            },
          ],
        },
      },
      definitions,
    );
    expect(payload.kind).toBe("media-studio.graph.workflow");
    expect(payload.workflow.nodes[0].metadata?.ui).toMatchObject({ customTitle: "Source", nodeColor: "#17231d" });
    expect(payload.workflow.nodes[0].metadata?.execution).toMatchObject({ mode: "frozen" });
    expect(payload.workflow.metadata?.groups).toEqual([
      {
        id: "group_1",
        title: "Inputs",
        color: "purple",
        node_ids: ["node_1"],
        bounds: { x: 0, y: 0, width: 420, height: 300 },
        execution: { mode: "muted" },
      },
    ]);
    expect(payload.workflow.nodes[0].fields.api_key).toBeUndefined();
    expect(payload.workflow.nodes[0].fields.local_path).toBe("");
    expect(payload.warnings.length).toBeGreaterThan(0);
  });

  it("imports exported JSON as an unsaved workflow", () => {
    const exported = sanitizeWorkflowForExport(
      {
        schema_version: 1,
        workflow_id: "workflow_1",
        name: "Shared Workflow",
        nodes: [],
        edges: [],
      },
      definitions,
    );
    const result = parseWorkflowImportText(JSON.stringify(exported));
    expect(result.workflow.workflow_id).toBeNull();
    expect(result.workflow.name).toBe("Imported: Shared Workflow");
  });
});

describe("graph groups", () => {
  it("computes bounds and serializes persisted group metadata", () => {
    const nodes = [
      { id: "a", position: { x: 100, y: 120 }, style: { width: 200, height: 160 }, data: { executionMode: "frozen" } },
      { id: "b", position: { x: 420, y: 260 }, style: { width: 180, height: 140 }, data: { executionMode: "frozen" } },
    ] as StudioNode[];
    expect(computeGraphGroupBounds(nodes, ["a", "b"])).toMatchObject({ x: 58, y: 78, width: 584, height: 364 });
    expect(
      serializeGraphGroups(
        [
          {
            id: "group_1",
            title: "Branch",
            color: "blue",
            node_ids: ["a", "b"],
            bounds: { x: 0, y: 0, width: 1, height: 1 },
            execution: { mode: "frozen" },
          },
        ],
        nodes,
      ),
    ).toEqual([
      {
        id: "group_1",
        title: "Branch",
        color: "blue",
        node_ids: ["a", "b"],
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        execution: { mode: "frozen" },
      },
    ]);
  });

  it("derives displayed and persisted group execution mode from member nodes", () => {
    const nodes = [
      { id: "a", position: { x: 100, y: 120 }, style: { width: 200, height: 160 }, data: { executionMode: "enabled" } },
      { id: "b", position: { x: 420, y: 260 }, style: { width: 180, height: 140 }, data: { executionMode: "enabled" } },
    ] as StudioNode[];
    const groups = [
      {
        id: "group_1",
        title: "Branch",
        color: "blue",
        node_ids: ["a", "b"],
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        execution: { mode: "frozen" as const },
      },
    ];

    expect(graphGroupsForCanvas(groups, nodes)[0].execution).toEqual({ mode: "enabled" });
    expect(serializeGraphGroups(groups, nodes)[0].execution).toEqual({ mode: "enabled" });
  });

  it("reads persisted groups from workflow metadata and normalizes invalid execution modes", () => {
    const groups = readGraphGroupsFromWorkflow({
      schema_version: 1,
      name: "Grouped",
      nodes: [],
      edges: [],
      metadata: {
        groups: [
          {
            id: "group_1",
            title: "Saved group",
            color: "gold",
            node_ids: ["a", "b"],
            bounds: { x: 1, y: 2, width: 300, height: 200 },
            execution: { mode: "unexpected" },
          },
        ],
      },
    });
    expect(groups[0]).toMatchObject({
      id: "group_1",
      title: "Saved group",
      color: "gold",
      execution: { mode: "enabled" },
    });
  });

  it("moves grouped nodes and bounds together", () => {
    const nodes = [
      { id: "a", position: { x: 10, y: 20 }, data: {} },
      { id: "b", position: { x: 90, y: 120 }, data: {} },
      { id: "outside", position: { x: 500, y: 500 }, data: {} },
    ] as StudioNode[];
    const group = { id: "group_1", title: "Branch", color: "green", node_ids: ["a", "b"], bounds: { x: 0, y: 0, width: 220, height: 220 }, execution: { mode: "enabled" as const } };
    expect(moveGraphGroupNodes(nodes, group, { x: 25, y: -10 }).map((node) => [node.id, node.position])).toEqual([
      ["a", { x: 35, y: 10 }],
      ["b", { x: 115, y: 110 }],
      ["outside", { x: 500, y: 500 }],
    ]);
    expect(moveGraphGroupBounds([group], "group_1", { x: 25, y: -10 })[0].bounds).toEqual({ x: 25, y: -10, width: 220, height: 220 });
    expect(resizeGraphGroupBounds([group], "group_1", { width: 40, height: 55 })[0].bounds).toEqual({ x: 0, y: 0, width: 260, height: 275 });
    expect(resizeGraphGroupBounds([group], "group_1", { width: -200, height: -200 })[0].bounds).toEqual({ x: 0, y: 0, width: 180, height: 180 });
  });

  it("syncs membership with any node touching group bounds", () => {
    const nodes = [
      { id: "inside", position: { x: 20, y: 20 }, style: { width: 80, height: 80 }, data: {} },
      { id: "touching", position: { x: 220, y: 40 }, style: { width: 80, height: 80 }, data: {} },
      { id: "outside", position: { x: 420, y: 20 }, style: { width: 80, height: 80 }, data: {} },
    ] as StudioNode[];
    const group = {
      id: "group_1",
      title: "Branch",
      color: "green",
      node_ids: ["inside"],
      bounds: { x: 0, y: 0, width: 220, height: 220 },
      execution: { mode: "enabled" as const },
    };
    expect(syncGraphGroupMembership([group], nodes)[0].node_ids).toEqual(["inside", "touching"]);
  });

  it("removes nodes from group membership once they move completely off persisted bounds", () => {
    const nodes = [
      { id: "inside", position: { x: 20, y: 20 }, style: { width: 80, height: 80 }, data: {} },
      { id: "outside", position: { x: 420, y: 20 }, style: { width: 80, height: 80 }, data: {} },
    ] as StudioNode[];
    const group = {
      id: "group_1",
      title: "Branch",
      color: "green",
      node_ids: ["inside", "outside"],
      bounds: { x: 0, y: 0, width: 220, height: 220 },
      execution: { mode: "enabled" as const },
    };
    expect(pruneGraphGroupMembership([group], nodes)[0].node_ids).toEqual(["inside"]);
  });
});

describe("graph run event display", () => {
  const node = { id: "model_1", data: { customTitle: "Nano branch", definition: { title: "Nano Banana Pro" } } } as StudioNode;

  it("formats provider events as human-readable console lines", () => {
    expect(
      formatGraphRunEventForConsole(
        { event_type: "kie.polling", node_id: "model_1", payload_json: { job_id: "job_abcdef123456789" } } as any,
        [node],
      ),
    ).toBe("Rendering: Nano branch - Provider job job_abcdef12");
  });

  it("shows completion metrics without raw event names", () => {
    expect(
      formatGraphRunEventForConsole(
        { event_type: "node.completed", node_id: "model_1", payload_json: { metrics: { output_ref_count: 4, duration_seconds: 1.234 } } } as any,
        [node],
      ),
    ).toBe("Completed: Nano branch - 1.23s");
  });

  it("uses the latest node event over the broad run node status", () => {
    expect(
      graphNodeActivitiesFromRunEvents(
        [{ event_type: "kie.submitted", node_id: "model_1", payload_json: {} } as any],
        { nodes: [{ node_id: "model_1", status: "running" }] } as any,
      ).model_1,
    ).toMatchObject({ label: "Submitted", detail: "Provider job created", tone: "active" });
  });

  it("labels frozen skipped nodes as muted instead of disabled", () => {
    expect(
      formatGraphRunEventForConsole(
        { event_type: "node.skipped", node_id: "model_1", payload_json: { execution_mode: "frozen", reason: "missing_cached_output" } } as any,
        [node],
      ),
    ).toBe("Muted: Nano branch - No cached output");

    expect(
      graphNodeActivitiesFromRunEvents([], {
        nodes: [{ node_id: "model_1", status: "skipped", metrics_json: { execution_mode: "frozen", skip_reason: "missing_cached_output" } }],
      } as any).model_1,
    ).toMatchObject({ label: "Muted", detail: "No cached output", tone: "muted" });
  });
});

describe("graph reference badges", () => {
  it("labels ordered media refs from current array input edge order", () => {
    const loadDefinition = definitions.find((definition) => definition.type === "media.load_image")!;
    const modelDefinition = definitions.find((definition) => definition.type === "model.kie.nano_banana_pro")!;
    const nodes = [
      { id: "face", type: "graphNode", position: { x: 0, y: 0 }, data: { definition: loadDefinition, fields: {}, onFieldChange: vi.fn() } },
      { id: "body", type: "graphNode", position: { x: 0, y: 220 }, data: { definition: loadDefinition, fields: {}, onFieldChange: vi.fn() } },
      { id: "model", type: "graphNode", position: { x: 360, y: 0 }, data: { definition: modelDefinition, fields: {}, onFieldChange: vi.fn() } },
    ] as unknown as StudioNode[];
    const badges = graphReferenceBadgesForNodes(nodes, [
      { id: "edge-body", source: "body", sourceHandle: "out:image", target: "model", targetHandle: "in:image_refs" },
      { id: "edge-face", source: "face", sourceHandle: "out:image", target: "model", targetHandle: "in:image_refs" },
    ] as never);
    expect(badges.get("body")?.[0]).toMatchObject({ label: "image reference 1", token: "[image reference 1]", targetTitle: "Nano Banana Pro" });
    expect(badges.get("face")?.[0]).toMatchObject({ label: "image reference 2", token: "[image reference 2]", targetPortId: "image_refs" });
  });

  it("does not label single media inputs as ordered refs", () => {
    const loadDefinition = definitions.find((definition) => definition.type === "media.load_image")!;
    const transformDefinition = definitions.find((definition) => definition.type === "image.transform")!;
    const nodes = [
      { id: "load", type: "graphNode", position: { x: 0, y: 0 }, data: { definition: loadDefinition, fields: {}, onFieldChange: vi.fn() } },
      { id: "transform", type: "graphNode", position: { x: 360, y: 0 }, data: { definition: transformDefinition, fields: {}, onFieldChange: vi.fn() } },
    ] as unknown as StudioNode[];
    const badges = graphReferenceBadgesForNodes(nodes, [{ id: "edge", source: "load", sourceHandle: "out:image", target: "transform", targetHandle: "in:image" }] as never);
    expect(badges.get("load")).toBeUndefined();
  });
});

describe("graph node help content", () => {
  it("summarizes KIE model contracts from definition metadata", () => {
    const help = buildGraphNodeHelpContent({
      type: "model.kie.nano_banana_pro",
      title: "Nano Banana Pro",
      category: "Models/Image",
      source: { kind: "kie_model", output_media_type: "image", task_modes: ["text_to_image", "image_edit"] },
      limits: { output_count: { default: 1, max: 1 } },
      ports: {
        inputs: [
          { id: "prompt", label: "Prompt", type: "text" },
          { id: "image_refs", label: "Reference Images", type: "image", array: true, max: 8 },
        ],
        outputs: [{ id: "image", label: "Image", type: "image" }],
      },
      fields: [
        { id: "prompt", label: "Prompt", type: "textarea" },
        { id: "aspect_ratio", label: "Aspect Ratio", type: "select", options: ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9", "auto"] },
        { id: "resolution", label: "Resolution", type: "select", options: ["1K", "2K", "4K"] },
      ],
    });
    expect(help.summary).toBe("Image model for text to image or image edit.");
    expect(help.lines).toContain("Inputs: prompt, up to 8 reference images.");
    expect(help.lines).toContain("Outputs: 1 image.");
    expect(help.lines.join(" ")).toContain("Aspect Ratio 11 options incl.");
    expect(help.lines.join(" ")).toContain("Resolution 1K, 2K, 4K");
  });
});
