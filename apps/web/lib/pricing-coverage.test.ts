import { describe, expect, it } from "vitest";

import { getPricingCoverageWarnings } from "@/lib/pricing-coverage";

describe("pricing coverage warnings", () => {
  it("surfaces stale, refresh, missing model, and unmapped row warnings", () => {
    const warnings = getPricingCoverageWarnings({
      rules: [],
      is_stale: true,
      refresh_error: "network unavailable",
      missing_model_keys: ["gpt-image-2-text-to-image"],
      unmapped_source_rows: [
        {
          label: "seedance fast 480p",
          credits: 4,
          cost_usd: 0.02,
        },
      ],
    });

    expect(warnings.map((warning) => warning.title)).toEqual([
      "Refresh failed",
      "Pricing snapshot is stale",
      "Missing model pricing",
      "Unmapped KIE pricing rows",
    ]);
    expect(warnings[2].detail).toContain("gpt-image-2-text-to-image");
    expect(warnings[3].detail).toContain("seedance fast 480p - 4 credits - $0.02");
  });
});
