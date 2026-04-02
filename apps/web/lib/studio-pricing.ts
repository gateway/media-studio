import type { MediaValidationResponse } from "@/lib/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pricingOptionValue(value: unknown) {
  if (value == null) {
    return "__missing__";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return String(value).toLowerCase();
}

function pricingNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function formatCredits(value: unknown) {
  if (typeof value === "number") {
    return value.toFixed(value % 1 === 0 ? 0 : 1);
  }
  if (typeof value === "string" && value) {
    return value;
  }
  return null;
}

function formatUsd(value: unknown) {
  if (typeof value === "number") {
    return `$${value.toFixed(2)}`;
  }
  if (typeof value === "string" && value) {
    return `$${value}`;
  }
  return null;
}

export function estimateFromPricingSnapshot(
  pricingSnapshot: Record<string, unknown> | null | undefined,
  modelKey: string | null | undefined,
  options: Record<string, unknown>,
  outputCount: number,
) {
  if (!modelKey || !isRecord(pricingSnapshot) || !Array.isArray(pricingSnapshot.rules)) {
    return { estimatedCredits: null, estimatedCostUsd: null };
  }

  const rule = pricingSnapshot.rules.find((entry) => isRecord(entry) && entry.model_key === modelKey);
  if (!isRecord(rule)) {
    return { estimatedCredits: null, estimatedCostUsd: null };
  }

  let estimatedCredits = pricingNumber(rule.base_credits);
  let estimatedCostUsd = pricingNumber(rule.base_cost_usd);

  const multipliers = isRecord(rule.multipliers) ? rule.multipliers : null;
  if (multipliers) {
    for (const [optionKey, valueMap] of Object.entries(multipliers)) {
      if (!isRecord(valueMap)) {
        continue;
      }
      const multiplier = pricingNumber(valueMap[pricingOptionValue(options[optionKey])]);
      if (multiplier == null) {
        continue;
      }
      if (estimatedCredits != null) {
        estimatedCredits *= multiplier;
      }
      if (estimatedCostUsd != null) {
        estimatedCostUsd *= multiplier;
      }
    }
  }

  const addersCredits = isRecord(rule.adders_credits) ? rule.adders_credits : null;
  if (addersCredits) {
    for (const [optionKey, valueMap] of Object.entries(addersCredits)) {
      if (!isRecord(valueMap)) {
        continue;
      }
      const creditAdder = pricingNumber(valueMap[pricingOptionValue(options[optionKey])]);
      if (creditAdder == null) {
        continue;
      }
      estimatedCredits = (estimatedCredits ?? 0) + creditAdder;
    }
  }

  const addersCostUsd = isRecord(rule.adders_cost_usd) ? rule.adders_cost_usd : null;
  if (addersCostUsd) {
    for (const [optionKey, valueMap] of Object.entries(addersCostUsd)) {
      if (!isRecord(valueMap)) {
        continue;
      }
      const costAdder = pricingNumber(valueMap[pricingOptionValue(options[optionKey])]);
      if (costAdder == null) {
        continue;
      }
      estimatedCostUsd = (estimatedCostUsd ?? 0) + costAdder;
    }
  }

  const resolvedOutputCount = Math.max(1, outputCount || 1);
  return {
    estimatedCredits: estimatedCredits != null ? estimatedCredits * resolvedOutputCount : null,
    estimatedCostUsd: estimatedCostUsd != null ? estimatedCostUsd * resolvedOutputCount : null,
  };
}

export function resolveStudioPricingDisplay(
  validation: MediaValidationResponse | null,
  localPricingEstimate: { estimatedCredits: number | null; estimatedCostUsd: number | null },
) {
  const validationPricingSummary = isRecord(validation?.pricing_summary)
    ? (validation.pricing_summary as Record<string, unknown>)
    : isRecord(validation?.preflight?.pricing_summary)
      ? (validation.preflight.pricing_summary as Record<string, unknown>)
      : null;
  const validationPricingTotal = isRecord(validationPricingSummary?.total)
    ? (validationPricingSummary.total as Record<string, unknown>)
    : null;
  const preflightEstimatedCost = isRecord(validation?.preflight?.estimated_cost)
    ? (validation.preflight.estimated_cost as Record<string, unknown>)
    : null;
  const estimatedCreditsValue =
    validationPricingTotal?.estimated_credits ??
    localPricingEstimate.estimatedCredits ??
    validation?.preflight?.estimated_cost_credits ??
    preflightEstimatedCost?.estimated_credits;
  const estimatedCostUsdValue =
    validationPricingTotal?.estimated_cost_usd ??
    localPricingEstimate.estimatedCostUsd ??
    preflightEstimatedCost?.estimated_cost_usd;
  const estimatedCredits = formatCredits(estimatedCreditsValue);
  const estimatedCostUsd = formatUsd(estimatedCostUsdValue);
  return {
    estimatedCredits,
    estimatedCostUsd,
    generatePriceLabel: estimatedCostUsd ?? (estimatedCredits ? `${estimatedCredits} credits` : null),
  };
}
