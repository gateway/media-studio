import { describe, expect, it } from "vitest";

import { deriveStudioPricingOptions, estimateFromPricingSnapshot, resolveStudioPricingDisplay } from "@/lib/studio-pricing";

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

  it("calculates GPT Image 2 observed resolution pricing from the snapshot", () => {
    const estimate = estimateFromPricingSnapshot(
      {
        rules: [
          {
            model_key: "gpt-image-2-text-to-image",
            pricing_status: "observed_site_pricing",
            base_credits: 6,
            base_cost_usd: 0.03,
            multipliers: {
              resolution: {
                "1k": 1,
                "2k": 10 / 6,
                "4k": 16 / 6,
              },
            },
          },
        ],
      },
      "gpt-image-2-text-to-image",
      { resolution: "4K" },
      2,
    );

    expect(estimate.estimatedCredits).toBeCloseTo(32);
    expect(estimate.estimatedCostUsd).toBeCloseTo(0.16);
  });

  it("derives Seedance pricing variants from staged video inputs", () => {
    const derived = deriveStudioPricingOptions({
      modelKey: "seedance-2.0",
      options: { duration: 8, resolution: "720p" },
      attachments: [{ kind: "videos" }] as never,
      sourceAsset: null,
    });

    expect(derived.pricing_variant).toBe("720p_with_video_input");
  });

  it("derives Kling 3.0 pricing variants from mode and sound", () => {
    const derived = deriveStudioPricingOptions({
      modelKey: "kling-3.0-t2v",
      options: { duration: 5, mode: "4K", sound: true },
    });

    expect(derived.pricing_variant).toBe("4k_true");
  });

  it("applies derived Seedance pricing variants to the local estimate", () => {
    const derived = deriveStudioPricingOptions({
      modelKey: "seedance-2.0",
      options: { duration: 8, resolution: "720p" },
      attachments: [{ kind: "videos" }] as never,
      sourceAsset: null,
    });

    const estimate = estimateFromPricingSnapshot(
      {
        rules: [
          {
            model_key: "seedance-2.0",
            base_credits: 19,
            base_cost_usd: 0.095,
            multipliers: {
              duration: {
                "8": 8,
              },
              pricing_variant: {
                "720p_with_video_input": 25 / 19,
              },
            },
          },
        ],
      },
      "seedance-2.0",
      derived,
      1,
    );

    expect(estimate.estimatedCredits).toBeCloseTo(200);
    expect(estimate.estimatedCostUsd).toBeCloseTo(1);
  });

  it("applies Kling 3.0 4K pricing variants to the local estimate", () => {
    const estimate = estimateFromPricingSnapshot(
      {
        rules: [
          {
            model_key: "kling-3.0-t2v",
            base_credits: 14,
            base_cost_usd: 0.07,
            multipliers: {
              duration: {
                "5": 5,
              },
              pricing_variant: {
                "4k_true": 67 / 14,
              },
            },
          },
        ],
      },
      "kling-3.0-t2v",
      { duration: 5, mode: "4K", sound: true },
      1,
    );

    expect(estimate.estimatedCredits).toBeCloseTo(335);
    expect(estimate.estimatedCostUsd).toBeCloseTo(1.675);
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
