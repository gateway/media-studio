import { describe, expect, it } from "vitest";

import { estimateFromPricingSnapshot, resolveStudioPricingDisplay } from "@/lib/studio-pricing";

describe("studio-pricing", () => {
  it("applies multipliers and output count from the pricing snapshot", () => {
    const estimate = estimateFromPricingSnapshot(
      {
        rules: [
          {
            model_key: "nano-banana-2",
            base_credits: 8,
            base_cost_usd: 0.04,
            multipliers: {
              resolution: {
                "2k": 1.5,
              },
            },
          },
        ],
      },
      "nano-banana-2",
      { resolution: "2k" },
      3,
    );

    expect(estimate.estimatedCredits).toBe(36);
    expect(estimate.estimatedCostUsd).toBe(0.18);
  });

  it("prefers validation pricing over the local estimate when available", () => {
    const display = resolveStudioPricingDisplay(
      {
        pricing_summary: {
          total: {
            estimated_credits: 200,
            estimated_cost_usd: 1,
          },
        },
        preflight: {},
      } as never,
      { estimatedCredits: 36, estimatedCostUsd: 0.18 },
      1,
    );

    expect(display.estimatedCredits).toBe("200");
    expect(display.estimatedCostUsd).toBe("$1.00");
    expect(display.generatePriceLabel).toBe("$1.00");
  });

  it("recomputes the displayed total from per-output validation pricing when output count changes", () => {
    const display = resolveStudioPricingDisplay(
      {
        pricing_summary: {
          output_count: 1,
          per_output: {
            estimated_credits: 12,
            estimated_cost_usd: 0.06,
          },
          total: {
            estimated_credits: 12,
            estimated_cost_usd: 0.06,
          },
        },
        preflight: {},
      } as never,
      { estimatedCredits: 12, estimatedCostUsd: 0.06 },
      2,
    );

    expect(display.estimatedCredits).toBe("24");
    expect(display.estimatedCostUsd).toBe("$0.12");
    expect(display.generatePriceLabel).toBe("$0.12");
  });

  it("falls back to credits when usd is unavailable", () => {
    const display = resolveStudioPricingDisplay(
      {
        preflight: {
          estimated_cost_credits: 24,
        },
      } as never,
      { estimatedCredits: null, estimatedCostUsd: null },
      1,
    );

    expect(display.estimatedCredits).toBe("24");
    expect(display.estimatedCostUsd).toBeNull();
    expect(display.generatePriceLabel).toBe("24 credits");
  });
});
