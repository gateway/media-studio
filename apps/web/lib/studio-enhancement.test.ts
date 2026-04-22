import { describe, expect, it } from "vitest";

import { hasSavedEnhancementSystemPrompt } from "@/lib/studio-enhancement";

describe("hasSavedEnhancementSystemPrompt", () => {
  it("prefers the model-level enhancement system prompt", () => {
    expect(
      hasSavedEnhancementSystemPrompt(
        { system_prompt: "Rewrite this model prompt." },
        { system_prompt: "" },
      ),
    ).toBe(true);
  });

  it("falls back to the global enhancement system prompt", () => {
    expect(
      hasSavedEnhancementSystemPrompt(
        { system_prompt: "" },
        { system_prompt: "Global enhancement prompt." },
      ),
    ).toBe(true);
  });

  it("returns false when neither prompt is saved", () => {
    expect(
      hasSavedEnhancementSystemPrompt(
        { system_prompt: "   " },
        { system_prompt: "" },
      ),
    ).toBe(false);
  });
});
