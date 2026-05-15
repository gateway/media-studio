import type { GraphEstimateResponse, GraphNodePricingEstimate } from "../types";

export function formatGraphCredits(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "unknown";
  return value >= 100 ? Math.round(value).toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function formatGraphUsd(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return null;
  if (value === 0) return "$0";
  if (Math.abs(value) < 0.01) return `<$0.01`;
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function graphCreditUsdLabel(summary: GraphNodePricingEstimate["pricing_summary"] | GraphEstimateResponse["pricing_summary"]) {
  const credits = `≈${formatGraphCredits(summary.total?.estimated_credits)} cr`;
  const usd = formatGraphUsd(summary.total?.estimated_cost_usd);
  return usd ? `${credits} · ${usd}` : credits;
}

export function graphNodePricingLabel(estimate?: GraphNodePricingEstimate | null) {
  if (!estimate) return null;
  const summary = estimate.pricing_summary ?? {};
  if (estimate.warnings?.some((warning) => warning.code === "missing_model_pricing") || !summary.has_numeric_estimate) return "price ?";
  return graphCreditUsdLabel(summary);
}

export function graphEstimateToolbarLabel(estimate?: GraphEstimateResponse | null) {
  if (!estimate) return "Estimate unavailable";
  const summary = estimate.pricing_summary ?? {};
  const suffix = summary.has_unknown_pricing ? " + unknown" : summary.is_stale ? " stale" : "";
  return `Graph ${graphCreditUsdLabel(summary)}${suffix}`;
}

export function graphPricingNeedsConfirmation(estimate: GraphEstimateResponse | null | undefined, availableCredits: number | null | undefined) {
  if (!estimate) return false;
  const summary = estimate.pricing_summary ?? {};
  const totalCredits = summary.total?.estimated_credits;
  return Boolean(summary.has_unknown_pricing || (availableCredits != null && totalCredits != null && totalCredits > availableCredits));
}

export function graphPricingWarningLabel(estimate: GraphEstimateResponse | null | undefined) {
  if (!estimate) return null;
  if (estimate.pricing_summary?.has_unknown_pricing) return "Unknown model pricing";
  if (estimate.pricing_summary?.is_stale) return "Pricing stale";
  if (estimate.warnings?.length) return `${estimate.warnings.length} estimate warning${estimate.warnings.length === 1 ? "" : "s"}`;
  return null;
}
