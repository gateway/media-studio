import { describe, expect, it } from "vitest";

import { buildChoiceList, resolveStudioOptions } from "@/lib/studio-options";
import type { MediaModelSummary, StudioDynamicOption } from "@/lib/types";

const model: MediaModelSummary = {
  key: "any-model",
  label: "Any model",
  provider_model: "any",
  task_modes: ["text_to_image"],
  studio_dynamic_options: [
    {
      key: "palette", type: "enum", allowed: ["bold", "muted"], default: "bold",
      ui_visible_when: { finish: "colored" },
    },
    {
      key: "accent", type: "enum", allowed: ["red", "blue"], default: "red",
      ui_visible_when: { palette: "bold" },
    },
    {
      key: "finish", type: "enum", allowed: ["colored", "plain"], default: "colored",
      ui_visible_when: { mode: "custom" },
      ui_choice_visible_when: { colored: { medium: "paint" } },
    },
    { key: "medium", type: "enum", allowed: ["paint", "ink"], default: "paint" },
    { key: "mode", type: "enum", allowed: ["basic", "custom"], default: "basic" },
  ] satisfies StudioDynamicOption[],
};

describe("Studio option dependencies", () => {
  const draft = { finish: "colored", palette: "bold", accent: "blue" };
  const preset = { mode: "custom", accent: "red" };

  it("follows upstream activity and effective choices in any catalog order", () => {
    const custom = resolveStudioOptions(model, draft, preset, "prompt_only");
    expect(custom.options).toEqual({ ...draft, mode: "custom", medium: "paint" });

    const ink = resolveStudioOptions(model, { ...draft, medium: "ink" }, preset, "prompt_only");
    expect(ink.options).toEqual({ finish: "plain", mode: "custom", medium: "ink" });
    expect(ink.entries.map(([key]) => key)).toEqual(["finish", "medium", "mode"]);
    expect(buildChoiceList("finish", ink.entries[0][1], ink.options.finish).map(({ value }) => value)).toEqual(["plain"]);

    const basic = resolveStudioOptions(model, { ...draft, mode: "basic" }, preset, "prompt_only");
    expect(basic.options).toEqual({ mode: "basic", medium: "paint" });
    expect(basic.entries.map(([key]) => key)).toEqual(["medium", "mode"]);
    expect(draft).toEqual({ finish: "colored", palette: "bold", accent: "blue" });
  });

  it("omits fields with no available choice, even when a dependent has a saved value", () => {
    const singleFinish = { ...model, studio_dynamic_options: model.studio_dynamic_options?.map((option) =>
      option.key === "finish" ? { ...option, allowed: ["colored"] } : option) };
    const resolved = resolveStudioOptions(singleFinish, { ...draft, medium: "ink" }, preset, "prompt_only");
    expect(resolved.options).toEqual({ mode: "custom", medium: "ink" });
    expect(resolved.entries.map(([key]) => key)).toEqual(["medium", "mode"]);
  });
});
