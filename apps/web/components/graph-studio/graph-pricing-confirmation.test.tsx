// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GraphPricingConfirmation } from "@/components/graph-studio/graph-pricing-confirmation";
import {
  GRAPH_PRICING_CONFIRMATION_STORAGE_KEY,
  readSkipGraphPricingConfirmationPreference,
  writeSkipGraphPricingConfirmationPreference,
} from "@/components/graph-studio/utils/graph-pricing-preferences";
import { graphEstimateToolbarLabel, graphPricingNeedsConfirmation } from "@/components/graph-studio/utils/graph-pricing";

const storage = new Map<string, string>();
const localStorageMock = {
  getItem(key: string) {
    return storage.has(key) ? storage.get(key) ?? null : null;
  },
  setItem(key: string, value: string) {
    storage.set(key, String(value));
  },
  removeItem(key: string) {
    storage.delete(key);
  },
  clear() {
    storage.clear();
  },
};

Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  configurable: true,
});

afterEach(() => {
  cleanup();
  window.localStorage.removeItem(GRAPH_PRICING_CONFIRMATION_STORAGE_KEY);
});

describe("graph pricing confirmation", () => {
  it("passes through the opt-out flag when confirmed", () => {
    const onAnswer = vi.fn();
    render(
      <GraphPricingConfirmation
        state={{
          estimate: {
            pricing_summary: {
              total: { estimated_credits: null, estimated_cost_usd: 0.0184 },
              has_numeric_estimate: true,
              has_unknown_pricing: true,
            },
            nodes: {},
            warnings: [{ code: "unknown_external_llm_pricing", message: "Pricing is unknown." }],
          },
          resolve: vi.fn(),
        }}
        availableCredits={null}
        onAnswer={onAnswer}
      />,
    );

    fireEvent.click(screen.getByLabelText("Do not show this again"));
    fireEvent.click(screen.getByText("Run anyway"));

    expect(onAnswer).toHaveBeenCalledWith(true, true);
  });

  it("persists the skip preference in local storage", () => {
    expect(readSkipGraphPricingConfirmationPreference()).toBe(false);
    writeSkipGraphPricingConfirmationPreference(true);
    expect(readSkipGraphPricingConfirmationPreference()).toBe(true);
    writeSkipGraphPricingConfirmationPreference(false);
    expect(readSkipGraphPricingConfirmationPreference()).toBe(false);
  });

  it("treats subscription-backed Codex pricing as included with no confirmation gate", () => {
    const estimate = {
      pricing_summary: {
        total: { estimated_credits: null, estimated_cost_usd: null },
        has_numeric_estimate: false,
        has_unknown_pricing: false,
        pricing_status: "subscription_included",
      },
      nodes: {},
      warnings: [],
    };

    expect(graphEstimateToolbarLabel(estimate as never)).toBe("Graph included");
    expect(graphPricingNeedsConfirmation(estimate as never, null)).toBe(false);
  });

  it("uses a calmer pending label before the first estimate arrives", () => {
    expect(graphEstimateToolbarLabel(null)).toBe("Estimate pending");
  });
});
