import { describe, expect, it } from "vitest";

import type { GraphNodeDefinition } from "../types";
import { resolveGraphNodeDefinition } from "./graph-effective-node-definition";

const staticDefinition: GraphNodeDefinition = {
  type: "utility.note",
  title: "Note",
  category: "Utility",
  ports: { inputs: [], outputs: [] },
  fields: [{ id: "note", label: "Note", type: "textarea" }],
};

const mediaPresetDefinition: GraphNodeDefinition = {
  type: "preset.render",
  title: "Media Preset",
  category: "Preset",
  source: {
    preset_catalog: [
      {
        preset_id: "preset-weathered",
        key: "weathered",
        label: "Weathered",
        model_key: "gpt-image-2-image-to-image",
        input_schema_json: [
          { key: "scene_setting", label: "Scene / Setting", required: true },
          { key: "surface_wear", label: "Surface Wear" },
        ],
        input_slots_json: [{ key: "character", label: "Character", required: true }],
      },
    ],
  },
  ports: {
    inputs: [{ id: "slot__character", label: "Character", type: "image" }],
    outputs: [{ id: "image", label: "Image", type: "image" }],
  },
  fields: [
    { id: "preset_id", label: "Media Preset", type: "preset_picker" },
    { id: "preset_model_key", label: "Model", type: "select" },
  ],
};

const promptRecipeDefinition: GraphNodeDefinition = {
  type: "prompt.recipe",
  title: "Prompt Recipe",
  category: "Prompt",
  ports: {
    inputs: [{ id: "image_refs", label: "Image References", type: "image", array: true }],
    outputs: [{ id: "text", label: "Text", type: "text" }],
  },
  fields: [
    { id: "recipe_category", label: "Category", type: "select" },
    { id: "recipe_id", label: "Recipe", type: "prompt_recipe_picker" },
  ],
};

describe("resolveGraphNodeDefinition", () => {
  it("returns static definitions unchanged", () => {
    expect(resolveGraphNodeDefinition(staticDefinition, {})).toBe(staticDefinition);
  });

  it("applies selected Media Preset dynamic fields", () => {
    const resolved = resolveGraphNodeDefinition(mediaPresetDefinition, {
      preset_id: "preset-weathered",
    });

    expect(resolved).not.toBe(mediaPresetDefinition);
    expect(resolved.fields.map((field) => field.id)).toEqual([
      "preset_id",
      "preset_model_key",
      "text__scene_setting",
      "text__surface_wear",
    ]);
  });

  it("keeps Prompt Recipe on the resolver path without changing its base shape", () => {
    const resolved = resolveGraphNodeDefinition(promptRecipeDefinition, {
      recipe_id: "recipe-storyboard",
    });

    expect(resolved).toBe(promptRecipeDefinition);
  });
});
