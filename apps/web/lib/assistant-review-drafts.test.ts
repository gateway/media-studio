// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import { assistantReviewDraftUrl, assistantReviewReturnTarget, assistantReviewUrl } from "./assistant-review-drafts";

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("assistant review draft URLs", () => {
  it("uses the current page as the default return target", () => {
    window.history.replaceState(null, "", "/graph-studio?tab=tab-1");

    expect(assistantReviewUrl("/presets/new")).toBe("/presets/new?returnTo=%2Fgraph-studio%3Ftab%3Dtab-1");
  });

  it("overrides a stale return target when an explicit target is provided", () => {
    const url = assistantReviewUrl("/presets/new?assistantSession=session-1&returnTo=%2Fgraph-studio", "/graph-studio?tab=tab-2");

    expect(url).toBe("/presets/new?assistantSession=session-1&returnTo=%2Fgraph-studio%3Ftab%3Dtab-2");
  });

  it("adds assistant draft ids with the explicit graph tab return target", () => {
    const url = assistantReviewDraftUrl("/presets/prompt-recipes/new", "draft-1", "/graph-studio?tab=tab-3");

    expect(url).toBe("/presets/prompt-recipes/new?assistantDraft=draft-1&returnTo=%2Fgraph-studio%3Ftab%3Dtab-3");
  });

  it("preserves the graph tab while carrying the assistant session back to graph", () => {
    expect(assistantReviewReturnTarget("/graph-studio?tab=tab-4", "session-9")).toBe("/graph-studio?tab=tab-4&assistantSession=session-9");
  });
});
