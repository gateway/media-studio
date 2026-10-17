import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { mapPromptRecipeDraftPayload, mapPromptRecipeRecord } from "@/lib/control-api";

describe("recipe record and draft mapping", () => {
  it("retains the complete empty record and draft defaults", () => {
    const common = {
      description: null, category: "utility", system_prompt_template: "",
      image_analysis_prompt: "", user_prompt_placeholder: "{{user_prompt}}", output_format: "single_prompt",
      output_contract_json: {}, output_contract: {}, input_variables_json: [], input_variables: [],
      custom_fields_json: [], custom_fields: [],
      image_input_json: { enabled: false, required: false, mode: "none", analysis_variable: "image_analysis", max_files: 0 },
      image_input: { enabled: false, required: false, mode: "none", analysis_variable: "image_analysis", max_files: 0 },
      validation_warnings_json: [], validation_warnings: [], default_options_json: {}, default_options: {},
      rules_json: {}, rules: {}, thumbnail_path: null, thumbnail_url: null, notes: "", source_kind: "custom", priority: 0,
    };
    expect(mapPromptRecipeRecord({})).toEqual({
      ...common, recipe_id: "undefined", key: "undefined", label: "undefined", status: "active",
      version: null, created_at: null, updated_at: null,
    });
    expect(mapPromptRecipeDraftPayload({})).toEqual({
      ...common, key: "", label: "", status: "inactive", version: "1",
    });
  });

  it.each([mapPromptRecipeRecord, mapPromptRecipeDraftPayload])("preserves alias precedence, reference identity and nullish fallback in %s", (map) => {
    for (const field of ["output_contract", "input_variables", "custom_fields", "image_input", "validation_warnings", "default_options", "rules"] as const) {
      const preferred = { unexpected: field };
      const fallback = [field];
      const result = map({ [`${field}_json`]: preferred, [field]: fallback });
      expect(result[field]).toBe(preferred);
      expect(result[`${field}_json`]).toBe(preferred);
      const nullish = map({ [`${field}_json`]: null, [field]: fallback });
      expect(nullish[field]).toBe(fallback);
      expect(nullish[`${field}_json`]).toBe(fallback);
      for (const malformed of [false, 0, ""]) {
        expect(map({ [`${field}_json`]: malformed, [field]: fallback })[field]).toBe(malformed);
      }
    }
  });

  it("keeps record coercion separate from draft defaults for malformed scalar fields", () => {
    const raw = {
      recipe_id: null, key: null, label: false, status: null, source_kind: 42, version: null,
      priority: "bad", category: 0, description: false, image_analysis_prompt: 0, notes: false,
      thumbnail_path: "", thumbnail_url: false, created_at: "created", updated_at: "updated",
    };
    const record = mapPromptRecipeRecord(raw);
    const draft = mapPromptRecipeDraftPayload(raw);
    expect(record).toMatchObject({
      recipe_id: "null", key: "null", label: "false", status: "active", source_kind: "42", version: null,
      created_at: "created", updated_at: "updated",
    });
    expect(draft).toMatchObject({ key: "", label: "false", status: "inactive", source_kind: 42, version: "1" });
    expect(draft).not.toHaveProperty("recipe_id");
    expect(draft).not.toHaveProperty("created_at");
    expect(draft).not.toHaveProperty("updated_at");
    for (const mapped of [record, draft]) {
      expect(mapped).toMatchObject({
        category: "0", description: false, image_analysis_prompt: 0, notes: false, thumbnail_path: "", thumbnail_url: false,
      });
      expect(mapped.priority).toBeNaN();
    }
  });
});
