import type { MediaAsset, MediaValidationResponse } from "@/lib/types";
import { formatCreditsAmount, formatUsdAmount, isRecord } from "@/lib/utils";
import type { AttachmentRecord } from "@/lib/media-studio-contract";

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

function multiplyPricingValue(value: unknown, multiplier: number) {
  const numericValue = pricingNumber(value);
  return numericValue != null ? numericValue * multiplier : null;
}

export function deriveStudioPricingOptions({
  modelKey,
  options,
  attachments = [],
  sourceAsset = null,
}: {
  modelKey: string | null | undefined;
  options: Record<string, unknown>;
  attachments?: Array<Pick<AttachmentRecord, "kind">>;
  sourceAsset?: Pick<MediaAsset, "generation_kind"> | null;
}) {
  const derived = { ...options };

  if (modelKey === "seedance-2.0") {
    const hasVideoInput =
      attachments.some((attachment) => attachment.kind === "videos") ||
      sourceAsset?.generation_kind === "video";
    const resolution = pricingOptionValue(options.resolution ?? "720p");
    derived.pricing_variant = `${resolution}_${hasVideoInput ? "with_video_input" : "no_video_input"}`;
  }

  return derived;
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
  outputCount: number,
) {
  const resolvedOutputCount = Math.max(1, outputCount || 1);
  const validationPricingSummary = isRecord(validation?.pricing_summary)
    ? (validation.pricing_summary as Record<string, unknown>)
    : isRecord(validation?.preflight?.pricing_summary)
      ? (validation.preflight.pricing_summary as Record<string, unknown>)
      : null;
  const validationOutputCount = pricingNumber(validationPricingSummary?.output_count);
  const validationPricingTotal = isRecord(validationPricingSummary?.total)
    ? (validationPricingSummary.total as Record<string, unknown>)
    : null;
  const validationPricingPerOutput = isRecord(validationPricingSummary?.per_output)
    ? (validationPricingSummary.per_output as Record<string, unknown>)
    : null;
  const preflightEstimatedCost = isRecord(validation?.preflight?.estimated_cost)
    ? (validation.preflight.estimated_cost as Record<string, unknown>)
    : null;
  const validationPricingMatchesOutputCount =
    validationOutputCount == null || validationOutputCount === resolvedOutputCount;
  const estimatedCreditsFromValidation = validationPricingMatchesOutputCount
    ? validationPricingTotal?.estimated_credits
    : multiplyPricingValue(validationPricingPerOutput?.estimated_credits, resolvedOutputCount);
  const estimatedCostUsdFromValidation = validationPricingMatchesOutputCount
    ? validationPricingTotal?.estimated_cost_usd
    : multiplyPricingValue(validationPricingPerOutput?.estimated_cost_usd, resolvedOutputCount);
  const estimatedCreditsValue =
    estimatedCreditsFromValidation ??
    localPricingEstimate.estimatedCredits ??
    validation?.preflight?.estimated_cost_credits ??
    preflightEstimatedCost?.estimated_credits;
  const estimatedCostUsdValue =
    estimatedCostUsdFromValidation ??
    localPricingEstimate.estimatedCostUsd ??
    preflightEstimatedCost?.estimated_cost_usd;
  const estimatedCredits = formatCreditsAmount(estimatedCreditsValue, { fallback: null });
  const estimatedCostUsd = formatUsdAmount(estimatedCostUsdValue, null, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return {
    estimatedCredits,
    estimatedCostUsd,
    generatePriceLabel: estimatedCostUsd ?? (estimatedCredits ? `${estimatedCredits} credits` : null),
  };
}
