import { describe, expect, it } from "vitest";

import type { GraphNodeDefinition } from "../types";
import {
  graphPromptRecipeFieldOverride,
  graphPromptRecipeFilteredOptions,
  graphPromptRecipeImageWarning,
  graphPromptRecipeSelectionDefaults,
  graphPromptRecipeSelectionSummary,
} from "./graph-prompt-recipe";

const definition: GraphNodeDefinition = {
  type: "prompt.recipe",
  title: "Prompt Recipe",
  category: "Prompt",
  description: "Generic prompt recipe node",
  source: {
    kind: "external_llm",
    recipe_backed: true,
    recipe_catalog: [
      {
        recipe_id: "prompt-recipe-image-prompt-director",
        key: "image-prompt-director",
        label: "Image Prompt Director",
        label_with_category: "Image • Image Prompt Director",
        description: "Creates one polished image prompt.",
        category: "image",
        category_label: "Image",
        output_format: "single_prompt",
        output_format_label: "single prompt",
        image_input: { enabled: true, required: false, mode: "both", max_files: 4 },
        default_options: { temperature: 0.25, max_output_tokens: 900 },
        input_variables: [
          {
            key: "user_prompt",
            label: "User Prompt",
            required: true,
            description: "Creative direction supplied by the user.",
            display_placeholder: "Creative direction supplied by the user.",
            display_help_text: "Required. Creative direction supplied by the user.",
          },
          {
            key: "style_direction",
            label: "Style Direction",
            required: false,
            default_value: "cinematic realism",
            description: "Short style or genre direction.",
            display_placeholder: "Short style or genre direction.",
            display_help_text: "Optional. Short style or genre direction.",
          },
        ],
        custom_fields: [],
        selection_summary: {
          title: "Image Prompt Director",
          subtitle: "Image • single prompt",
          description: "Creates one polished image prompt.",
          details: ["Images: optional, up to 4", "Outputs: Text is the final prompt; Result is canonical JSON.", "Open Prompt Recipes to inspect the full system prompt."],
        },
      },
      {
        recipe_id: "prompt-recipe-video-director-multi-shot-json",
        key: "video-director-multi-shot-json",
        label: "Video Director - Multi Shot JSON",
        label_with_category: "Video • Video Director - Multi Shot JSON",
        description: "Creates multiple video prompts.",
        category: "video",
        category_label: "Video",
        output_format: "structured_shot_sequence",
        output_format_label: "structured shot sequence",
        image_input: { enabled: true, required: false, mode: "both", max_files: 2 },
        default_options: { temperature: 0.2, max_output_tokens: 1200 },
        input_variables: [
          {
            key: "shot_count",
            label: "Shot Count",
            required: false,
            default_value: "4",
            description: "Number of prompts to create.",
            display_placeholder: "Number of prompts to create.",
            display_help_text: "Optional. Number of prompts to create.",
          },
        ],
        custom_fields: [],
        selection_summary: {
          title: "Video Director - Multi Shot JSON",
          subtitle: "Video • structured shot sequence",
          description: "Creates multiple video prompts.",
          details: ["Images: optional, up to 2", "Outputs: Text is a readable summary; Result is canonical JSON.", "Open Prompt Recipes to inspect the full system prompt."],
        },
      },
      {
        recipe_id: "prompt-recipe-archived",
        key: "archived-recipe",
        label: "Archived Recipe",
        label_with_category: "Utility • Archived Recipe",
        description: "No longer active.",
        category: "utility",
        category_label: "Utility",
        status: "archived",
        output_format: "single_prompt",
        output_format_label: "single prompt",
        image_input: { enabled: false, required: false, mode: "none", max_files: 0 },
        default_options: {},
        input_variables: [
          {
            key: "source_prompt",
            label: "Source Prompt",
            required: true,
            description: "Existing prompt text.",
            display_placeholder: "Existing prompt text.",
            display_help_text: "Required. Existing prompt text.",
          },
        ],
        custom_fields: [],
        selection_summary: {
          title: "Archived Recipe",
          subtitle: "Utility • single prompt",
          description: "No longer active.",
          details: ["Status: archived", "Images: none", "Outputs: Text is the final prompt; Result is canonical JSON.", "Open Prompt Recipes to inspect the full system prompt."],
        },
      },
    ],
  },
  execution: {},
  limits: {},
  ui: { default_size: { width: 420, height: 760 }, min_size: { width: 360, height: 560 }, max_size: { width: 860, height: 1240 }, color: "text", accent: "purple", icon: "sparkles", preview: false, field_layout: "stack" },
  ports: { inputs: [], outputs: [] },
  fields: [
    { id: "recipe_category", label: "Recipe Category", type: "select", default: "all", options: [{ label: "All Categories", value: "all" }, { label: "Image", value: "image" }, { label: "Video", value: "video" }] },
    {
      id: "recipe_id",
      label: "Prompt Recipe",
      type: "prompt_recipe_picker",
      options: [
        { label: "Image Prompt Director", label_with_category: "Image • Image Prompt Director", value: "prompt-recipe-image-prompt-director", category: "image" },
        { label: "Video Director - Multi Shot JSON", label_with_category: "Video • Video Director - Multi Shot JSON", value: "prompt-recipe-video-director-multi-shot-json", category: "video" },
      ],
    },
    { id: "user_prompt", label: "User Prompt", type: "textarea", visible_if: { field: "recipe_id", in: ["prompt-recipe-image-prompt-director"] } },
    { id: "style_direction", label: "Style Direction", type: "textarea", visible_if: { field: "recipe_id", in: ["prompt-recipe-image-prompt-director"] } },
    { id: "shot_count", label: "Shot Count", type: "text", visible_if: { field: "recipe_id", in: ["prompt-recipe-video-director-multi-shot-json"] } },
  ],
};

describe("graph prompt recipe helpers", () => {
  it("filters recipe picker options by selected category", () => {
    const recipeField = definition.fields[1];
    expect(graphPromptRecipeFilteredOptions(recipeField, { recipe_category: "video" }).map((item) => String((item as { value: unknown }).value))).toEqual([
      "prompt-recipe-video-director-multi-shot-json",
    ]);
  });

  it("returns selected recipe field help and placeholders", () => {
    const override = graphPromptRecipeFieldOverride(definition, { recipe_id: "prompt-recipe-image-prompt-director" }, definition.fields[2]);
    expect(override?.label).toBe("User Prompt");
    expect(override?.helpText).toContain("Required.");
    expect(override?.helpText).toContain("Creative direction supplied by the user.");
  });

  it("builds selection summary and defaults from the selected recipe", () => {
    const summary = graphPromptRecipeSelectionSummary(definition, { recipe_id: "prompt-recipe-image-prompt-director" });
    expect(summary?.title).toBe("Image Prompt Director");
    expect(summary?.subtitle).toContain("Image");
    expect(summary?.details[0]).toContain("up to 4");
    expect(summary?.details[1]).toContain("Text is the final prompt");

    const defaults = graphPromptRecipeSelectionDefaults(definition, "prompt-recipe-image-prompt-director");
    expect(defaults?.recipe_category).toBe("image");
    expect(defaults?.style_direction).toBe("cinematic realism");
    expect(defaults?.temperature).toBeUndefined();
    expect(defaults?.max_tokens).toBeUndefined();
  });

  it("warns when an image-capable recipe has no connected image reference input", () => {
    expect(graphPromptRecipeImageWarning(definition, { recipe_id: "prompt-recipe-image-prompt-director" }, [])).toBe(
      "This recipe can look at images, but no images are connected to Image References.",
    );
    expect(graphPromptRecipeImageWarning(definition, { recipe_id: "prompt-recipe-image-prompt-director" }, ["image_refs"])).toBeNull();
    expect(graphPromptRecipeImageWarning(definition, { recipe_id: "prompt-recipe-archived" }, [])).toBeNull();
  });

  it("shows inactive recipe status for compatibility-loaded selections", () => {
    const summary = graphPromptRecipeSelectionSummary(definition, { recipe_id: "prompt-recipe-archived" });
    expect(summary?.title).toBe("Archived Recipe");
    expect(summary?.details[0]).toContain("archived");
  });

  it("describes readable text for structured recipe outputs", () => {
    const summary = graphPromptRecipeSelectionSummary(definition, { recipe_id: "prompt-recipe-video-director-multi-shot-json" });
    expect(summary?.details[1]).toContain("readable summary");
    expect(summary?.details[1]).toContain("canonical JSON");
  });
});
