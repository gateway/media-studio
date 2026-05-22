import { describe, expect, it } from "vitest";

import { graphVisibleFieldMetrics } from "@/components/graph-studio/utils/graph-node-fields";
import type { GraphNodeDefinition } from "@/components/graph-studio/types";

const definition: GraphNodeDefinition = {
  type: "prompt.recipe",
  title: "Prompt Recipe",
  description: "Run a saved prompt recipe.",
  category: "Prompt",
  fields: [
    { id: "recipe_category", label: "Recipe Category", type: "select", default: "all" },
    { id: "recipe_id", label: "Prompt Recipe", type: "prompt_recipe_picker", default: "" },
    { id: "user_prompt", label: "User Prompt", type: "textarea", default: "" },
    { id: "provider", label: "Provider", type: "select", default: "studio_default", advanced: true },
    { id: "temperature", label: "Temperature", type: "float", default: 0.35, advanced: true, visible_if: { field: "provider", not_equals: "codex_local" } },
  ],
  ports: { inputs: [], outputs: [] },
};

describe("graphVisibleFieldMetrics", () => {
  it("keeps advanced fields out of the collapsed layout count", () => {
    const metrics = graphVisibleFieldMetrics(definition, { recipe_id: "prompt-recipe-image-prompt-director" }, [], {
      advancedExpanded: false,
      extraLayoutRows: 2,
    });

    expect(metrics.primaryBodyFields.map((field) => field.id)).toEqual(["recipe_category", "recipe_id", "user_prompt"]);
    expect(metrics.advancedBodyFields.map((field) => field.id)).toEqual(["provider", "temperature"]);
    expect(metrics.layoutFieldCount).toBe(6);
    expect(metrics.textareaCount).toBe(1);
  });

  it("counts advanced fields once the section is expanded", () => {
    const metrics = graphVisibleFieldMetrics(definition, { recipe_id: "prompt-recipe-image-prompt-director" }, [], {
      advancedExpanded: true,
      extraLayoutRows: 2,
    });

    expect(metrics.layoutFieldCount).toBe(8);
    expect(metrics.textareaCount).toBe(1);
  });

  it("hides provider-managed runtime overrides for explicit codex local nodes", () => {
    const metrics = graphVisibleFieldMetrics(
      definition,
      { recipe_id: "prompt-recipe-image-prompt-director", provider: "codex_local" },
      [],
      {
        advancedExpanded: true,
        extraLayoutRows: 2,
      },
    );

    expect(metrics.advancedBodyFields.map((field) => field.id)).toEqual(["provider"]);
    expect(metrics.layoutFieldCount).toBe(7);
  });
});
