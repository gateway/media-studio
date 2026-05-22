import { describe, expect, it } from "vitest";

import {
  llmCredentialSourceLabel,
  llmProviderBillingLabel,
  llmProviderLabel,
  llmProviderSummary,
} from "@/lib/llm-provider-metadata";

describe("llm provider metadata", () => {
  it("returns stable provider labels and billing copy", () => {
    expect(llmProviderLabel("codex_local")).toBe("Codex Local");
    expect(llmProviderBillingLabel("codex_local")).toContain("Included");
    expect(llmProviderLabel("openrouter")).toBe("OpenRouter");
    expect(llmProviderSummary("local_openai")).toContain("OpenAI-style API");
  });

  it("normalizes shared credential-source labels", () => {
    expect(llmCredentialSourceLabel("codex_local_login")).toBe("Uses local Codex login");
    expect(llmCredentialSourceLabel("env")).toBe("Uses environment configuration");
    expect(llmCredentialSourceLabel("stored")).toBe("Uses saved server configuration");
    expect(llmCredentialSourceLabel(null)).toBe("Not configured");
  });
});
