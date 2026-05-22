import { describe, expect, it } from "vitest";

import {
  defaultPromptRecipeVariables,
  detectInvalidPromptRecipeTokens,
  detectPromptRecipeVariables,
  promptRecipeDraftWarnings,
  slugifyPromptRecipeKey,
  validatePromptRecipeDraft,
} from "@/lib/prompt-recipes";

describe("prompt-recipes", () => {
  it("detects valid and invalid variable tokens", () => {
    expect(detectPromptRecipeVariables("Use {{user_prompt}} and {{ image_analysis }} then {{shot_count}}.")).toEqual([
      "image_analysis",
      "shot_count",
      "user_prompt",
    ]);
    expect(detectInvalidPromptRecipeTokens("Use {{Bad Token}} and {{valid_key}}.")).toEqual(["Bad Token"]);
  });

  it("slugifies keys for recipe storage", () => {
    expect(slugifyPromptRecipeKey("Video Director: Four Shots!")).toBe("video_director_four_shots");
  });

  it("enables reserved variables that are present in a template", () => {
    const variables = defaultPromptRecipeVariables("{{user_prompt}} {{duration_seconds}}");
    expect(variables.find((variable) => variable.key === "user_prompt")?.enabled).toBe(true);
    expect(variables.find((variable) => variable.key === "duration_seconds")?.enabled).toBe(true);
    expect(variables.find((variable) => variable.key === "source_prompt")?.enabled).toBe(false);
  });

  it("blocks duplicate custom fields and unknown variables when external variables are disabled", () => {
    const base = {
      key: "strict_recipe",
      label: "Strict Recipe",
      category: "utility",
      outputFormat: "single_prompt",
      template: "{{user_prompt}} {{not_defined}}",
      variables: [{ key: "user_prompt", label: "User Prompt", enabled: true, required: true }],
      customFields: [],
      imageInput: { enabled: false, required: false, mode: "none", analysis_variable: "image_analysis", max_files: 0 },
      imageAnalysisPrompt: "",
      rules: { allow_external_variables: false },
    };
    expect(validatePromptRecipeDraft(base)).toContain("Unknown variables");
    expect(
      validatePromptRecipeDraft({
        ...base,
        template: "{{user_prompt}}",
        customFields: [{ key: "user_prompt", label: "User Prompt", type: "text" }],
      }),
    ).toContain("conflicts");
  });

  it("blocks recipe image settings that would fail in graph runs", () => {
    const base = {
      key: "image_recipe",
      label: "Image Recipe",
      category: "image",
      outputFormat: "single_prompt",
      template: "Use {{user_prompt}} and {{image_analysis}} with [image reference 2].",
      variables: [
        { key: "user_prompt", label: "User Prompt", enabled: true, required: true },
        { key: "image_analysis", label: "Image Analysis", enabled: true },
      ],
      customFields: [],
      imageInput: { enabled: true, required: true, mode: "both", analysis_variable: "image_analysis", max_files: 1 },
      imageAnalysisPrompt: "Describe image reference 1.",
      rules: { allow_external_variables: true },
    };

    expect(validatePromptRecipeDraft(base)).toContain("image reference 2");
    expect(validatePromptRecipeDraft({ ...base, imageInput: { ...base.imageInput, max_files: 2 }, imageAnalysisPrompt: "" })).toContain(
      "Image Analysis Prompt",
    );
    expect(
      validatePromptRecipeDraft({
        ...base,
        imageInput: { enabled: false, required: false, mode: "none", analysis_variable: "image_analysis", max_files: 0 },
      }),
    ).toContain("image input is turned off");
    expect(validatePromptRecipeDraft({ ...base, imageInput: { ...base.imageInput, max_files: 2 } })).toBeNull();
  });

  it("blocks duplicate select custom field options", () => {
    expect(
      validatePromptRecipeDraft({
        key: "select_recipe",
        label: "Select Recipe",
        category: "utility",
        outputFormat: "single_prompt",
        template: "{{user_prompt}} {{mood}}",
        variables: [{ key: "user_prompt", label: "User Prompt", enabled: true, required: true }],
        customFields: [{ key: "mood", label: "Mood", type: "select", options: ["bright", "bright"] }],
        imageInput: { enabled: false, required: false, mode: "none", analysis_variable: "image_analysis", max_files: 0 },
        imageAnalysisPrompt: "",
        rules: { allow_external_variables: false },
      }),
    ).toContain("duplicate options");
  });

  it("returns non-blocking prompt recipe guidance warnings", () => {
    const warnings = promptRecipeDraftWarnings({
      template: "{{image_analysis}} {{external_style}}",
      variables: [
        { key: "image_analysis", label: "Image Analysis", enabled: true },
        { key: "source_prompt", label: "Source Prompt", enabled: true },
      ],
      customFields: [],
      imageInput: { enabled: false, required: false, mode: "none", analysis_variable: "image_analysis", max_files: 0 },
      imageAnalysisPrompt: "",
      rules: { allow_external_variables: true },
    });
    expect(warnings).toEqual(expect.arrayContaining([
      expect.stringContaining("source_prompt"),
      expect.stringContaining("external_style"),
      expect.stringContaining("image input is disabled"),
    ]));
  });
});
