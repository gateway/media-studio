import { describe, expect, it } from "vitest";

import type { GraphNodeDefinition } from "../types";
import {
  graphMediaPresetApplySelectionDefinition,
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
        compatible_models: [
          { value: "nano-banana-pro", label: "Nano Banana Pro" },
        ],
        default_model_key: "nano-banana-pro",
        default_options: { aspect_ratio: "4:3", resolution: "2K" },
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
        image_slots: [
          { key: "subject", label: "Subject", required: true, max_files: 2 },
        ],
        selection_summary: {
          title: "Portrait Preset",
          subtitle: "Media Preset",
          description: "Creates a portrait.",
          details: [
            "Model: Nano Banana Pro",
            "Image slots: 1",
            "Required images: Subject",
          ],
        },
      },
      {
        preset_id: "preset_infographic",
        key: "infographic",
        label: "Infographic Preset",
        description: "Creates an infographic from text.",
        compatible_models: [{ value: "gpt-image-2", label: "GPT Image 2" }],
        default_model_key: "gpt-image-2",
        text_fields: [
          {
            key: "brief",
            label: "Brief",
            required: true,
            display_help_text: "Required. Content brief.",
          },
        ],
        image_slots: [],
        selection_summary: {
          title: "Infographic Preset",
          subtitle: "Media Preset",
          description: "Creates an infographic from text.",
          details: [
            "Model: GPT Image 2",
            "Image slots: 0",
            "Required images: none",
          ],
        },
      },
    ],
    model_option_fields_by_model: {
      "nano-banana-pro": [
        {
          id: "option__aspect_ratio",
          option_key: "aspect_ratio",
          label: "Aspect Ratio",
          type: "select",
          options: ["1:1", "4:3", "16:9"],
        },
        {
          id: "option__resolution",
          option_key: "resolution",
          label: "Resolution",
          type: "select",
          options: ["1K", "2K", "4K"],
        },
      ],
    },
  },
  execution: {},
  limits: {},
  ui: {},
  ports: {
    inputs: [
      {
        id: "slot__subject",
        label: "Subject",
        type: "image",
        array: true,
        max: 2,
        visible_if: { field: "preset_id", in: ["preset_portrait"] },
      },
    ],
    outputs: [{ id: "image", label: "Image", type: "image" }],
  },
  fields: [
    { id: "preset_id", label: "Media Preset", type: "preset_picker" },
    {
      id: "preset_model_key",
      label: "Model",
      type: "select",
      options: [
        { value: "nano-banana-pro", label: "Nano Banana Pro" },
        { value: "gpt-image-2", label: "GPT Image 2" },
      ],
    },
    {
      id: "text__style",
      label: "Style",
      type: "text",
      visible_if: { field: "preset_id", in: ["preset_portrait"] },
    },
    {
      id: "text__brief",
      label: "Brief",
      type: "textarea",
      visible_if: { field: "preset_id", in: ["preset_infographic"] },
    },
  ],
};

describe("graph media preset helpers", () => {
  it("builds selected preset summaries and defaults", () => {
    const summary = graphMediaPresetSelectionSummary(definition, {
      preset_id: "preset_portrait",
    });
    expect(summary?.title).toBe("Portrait Preset");
    expect(summary?.details[2]).toContain("Subject");

    const defaults = graphMediaPresetSelectionDefaults(
      definition,
      "preset_portrait",
    );
    expect(defaults?.preset_model_key).toBe("nano-banana-pro");
    expect(defaults?.option__aspect_ratio).toBe("4:3");
    expect(defaults?.option__resolution).toBe("2K");
    expect(defaults?.text__style).toBe("cinematic");
  });

  it("limits model options and field copy to the selected preset", () => {
    const modelOverride = graphMediaPresetFieldOverride(
      definition,
      { preset_id: "preset_infographic" },
      definition.fields[1],
    );
    expect(modelOverride?.options).toEqual([
      { value: "gpt-image-2", label: "GPT Image 2" },
    ]);

    const fieldOverride = graphMediaPresetFieldOverride(
      definition,
      { preset_id: "preset_portrait" },
      definition.fields[2],
    );
    expect(fieldOverride?.label).toBe("Style");
    expect(fieldOverride?.placeholder).toBe("Lighting and styling");
    expect(fieldOverride?.helpText).toContain("Required.");
  });

  it("derives selected preset fields from node-local hydrated schema", () => {
    const lazyDefinition: GraphNodeDefinition = {
      ...definition,
      source: { kind: "media_preset", lazy_catalog: true },
      fields: [
        { id: "preset_id", label: "Media Preset", type: "preset_picker" },
        { id: "preset_model_key", label: "Model", type: "select", options: [] },
      ],
    };
    const nodeFields = {
      preset_id: "preset_portrait",
      __preset_catalog_item_json: {
        preset_id: "preset_portrait",
        key: "portrait",
        label: "Portrait Preset",
        model_key: "nano-banana-pro",
        input_schema_json: [
          {
            key: "style",
            label: "Style",
            required: true,
            default_value: "cinematic",
          },
        ],
        input_slots_json: [
          { key: "subject", label: "Subject", required: true, max_files: 1 },
        ],
      },
    };

    const selectedDefinition = graphMediaPresetApplySelectionDefinition(
      lazyDefinition,
      nodeFields,
    );

    expect(selectedDefinition.fields.map((field) => field.id)).toContain(
      "text__style",
    );
    expect(
      graphMediaPresetSelectionSummary(lazyDefinition, nodeFields)?.title,
    ).toBe("Portrait Preset");
    expect(
      graphMediaPresetSelectionDefaults(
        lazyDefinition,
        "preset_portrait",
        nodeFields,
      )?.text__style,
    ).toBe("cinematic");
  });

  it("inserts selected model options before preset text fields without duplication", () => {
    const selectedDefinition = graphMediaPresetApplySelectionDefinition(
      definition,
      {
        preset_id: "preset_portrait",
        preset_model_key: "nano-banana-pro",
      },
    );

    expect(selectedDefinition.fields.map((field) => field.id)).toEqual([
      "preset_id",
      "preset_model_key",
      "option__aspect_ratio",
      "option__resolution",
      "text__style",
    ]);
    expect(
      selectedDefinition.fields.find(
        (field) => field.id === "option__aspect_ratio",
      )?.default,
    ).toBe("4:3");

    const rehydrated = graphMediaPresetApplySelectionDefinition(
      selectedDefinition,
      {
        preset_id: "preset_portrait",
        preset_model_key: "nano-banana-pro",
      },
    );
    expect(
      rehydrated.fields.filter((field) => field.id === "option__aspect_ratio"),
    ).toHaveLength(1);
    expect(
      rehydrated.fields.filter((field) => field.id === "option__resolution"),
    ).toHaveLength(1);
  });

  it("removes stale dynamic fields when the selected preset changes", () => {
    const portraitDefinition = graphMediaPresetApplySelectionDefinition(
      definition,
      {
        preset_id: "preset_portrait",
        preset_model_key: "nano-banana-pro",
      },
    );
    const portraitDefinitionWithLegacyDynamicField: GraphNodeDefinition = {
      ...portraitDefinition,
      fields: [
        ...portraitDefinition.fields,
        {
          id: "choice__mood",
          label: "Mood",
          type: "select",
          options: ["bright", "moody"],
        },
      ],
    };

    const infographicDefinition = graphMediaPresetApplySelectionDefinition(
      portraitDefinitionWithLegacyDynamicField,
      {
        preset_id: "preset_infographic",
        preset_model_key: "gpt-image-2",
      },
    );

    expect(infographicDefinition.fields.map((field) => field.id)).toEqual([
      "preset_id",
      "preset_model_key",
      "text__brief",
    ]);
  });
});
