import { describe, expect, it } from "vitest";

import { resolvePublishHandoffFeedback, STUDIO_POLL_INTERVAL_MS } from "@/hooks/studio/use-studio-polling";

describe("studio polling cadence", () => {
  it("uses the slower five-second poll interval", () => {
    expect(STUDIO_POLL_INTERVAL_MS).toBe(5000);
  });
});

describe("resolvePublishHandoffFeedback", () => {
  it("returns healthy job publish messaging when the asset is already in the gallery", () => {
    const feedback = resolvePublishHandoffFeedback("job", true);

    expect(feedback.activity).toEqual({
      tone: "healthy",
      message: "Render published. The gallery is refreshing.",
    });
    expect(feedback.activityAutoHideMs).toBe(2600);
    expect(feedback.finalMessage).toBe("Render completed and the gallery is refreshing.");
  });

  it("returns warning batch publish messaging when the gallery is still reconciling", () => {
    const feedback = resolvePublishHandoffFeedback("batch", false);

    expect(feedback.activity).toEqual({
      tone: "warning",
      message: "Batch finished, but Studio is still waiting for the media cards to appear.",
      spinning: true,
    });
    expect(feedback.activityAutoHideMs).toBe(4200);
    expect(feedback.finalMessage).toBe("Batch completed. Studio is still waiting for the media cards to appear.");
  });
});
