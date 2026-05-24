import { describe, expect, it } from "vitest";

import type { GraphNodeDefinition } from "../types";
import {
  graphMediaPresetFieldOverride,
  graphMediaPresetSelectionDefaults,
  graphMediaPresetSelectionSummary,
} from "./graph-media-preset";

const definition: GraphNodeDefinition = {
  type: "preset.render",
  title: "Media Preset",
  category: "Preset",
  source: {
    kind: "media_preset",
    preset_catalog: [
      {
        preset_id: "preset_portrait",
        key: "portrait",
        label: "Portrait Preset",
        description: "Creates a portrait.",
        compatible_models: [{ value: "nano-banana-pro", label: "Nano Banana Pro" }],
        default_model_key: "nano-banana-pro",
        text_fields: [
          {
            key: "style",
            label: "Style",
            required: true,
            default_value: "cinematic",
            placeholder: "Lighting and styling",
            display_help_text: "Required. Lighting and styling.",
          },
        ],
        choice_groups: [
          {
            key: "mood",
            label: "Mood",
            default_value: "calm",
            options: ["calm", "bold"],
          },
        ],
        image_slots: [{ key: "subject", label: "Subject", required: true, max_files: 2 }],
        selection_summary: {
          title: "Portrait Preset",
          subtitle: "Media Preset",
          description: "Creates a portrait.",
          details: ["Model: Nano Banana Pro", "Image slots: 1", "Required images: Subject"],
        },
      },
      {
        preset_id: "preset_infographic",
        key: "infographic",
        label: "Infographic Preset",
        description: "Creates an infographic from text.",
        compatible_models: [{ value: "gpt-image-2", label: "GPT Image 2" }],
        default_model_key: "gpt-image-2",
        text_fields: [{ key: "brief", label: "Brief", required: true, display_help_text: "Required. Content brief." }],
        choice_groups: [],
        image_slots: [],
        selection_summary: {
          title: "Infographic Preset",
          subtitle: "Media Preset",
          description: "Creates an infographic from text.",
          details: ["Model: GPT Image 2", "Image slots: 0", "Required images: none"],
        },
      },
    ],
  },
  execution: {},
  limits: {},
  ui: {},
  ports: {
    inputs: [
      { id: "slot__subject", label: "Subject", type: "image", array: true, max: 2, visible_if: { field: "preset_id", in: ["preset_portrait"] } },
    ],
    outputs: [{ id: "image", label: "Image", type: "image" }],
  },
  fields: [
    { id: "preset_id", label: "Media Preset", type: "preset_picker" },
    { id: "preset_model_key", label: "Model", type: "select", options: [{ value: "nano-banana-pro", label: "Nano Banana Pro" }, { value: "gpt-image-2", label: "GPT Image 2" }] },
    { id: "text__style", label: "Style", type: "text", visible_if: { field: "preset_id", in: ["preset_portrait"] } },
    { id: "choice__mood", label: "Mood", type: "select", visible_if: { field: "preset_id", in: ["preset_portrait"] } },
    { id: "text__brief", label: "Brief", type: "textarea", visible_if: { field: "preset_id", in: ["preset_infographic"] } },
  ],
};

describe("graph media preset helpers", () => {
  it("builds selected preset summaries and defaults", () => {
    const summary = graphMediaPresetSelectionSummary(definition, { preset_id: "preset_portrait" });
    expect(summary?.title).toBe("Portrait Preset");
    expect(summary?.details[2]).toContain("Subject");

    const defaults = graphMediaPresetSelectionDefaults(definition, "preset_portrait");
    expect(defaults?.preset_model_key).toBe("nano-banana-pro");
    expect(defaults?.text__style).toBe("cinematic");
    expect(defaults?.choice__mood).toBe("calm");
  });

  it("limits model options and field copy to the selected preset", () => {
    const modelOverride = graphMediaPresetFieldOverride(definition, { preset_id: "preset_infographic" }, definition.fields[1]);
    expect(modelOverride?.options).toEqual([{ value: "gpt-image-2", label: "GPT Image 2" }]);

    const fieldOverride = graphMediaPresetFieldOverride(definition, { preset_id: "preset_portrait" }, definition.fields[2]);
    expect(fieldOverride?.label).toBe("Style");
    expect(fieldOverride?.placeholder).toBe("Lighting and styling");
    expect(fieldOverride?.helpText).toContain("Required.");
  });
});
