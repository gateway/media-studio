import type { MediaPricingResponse } from "@/lib/types";

export type PricingCoverageWarning = {
  key: string;
  title: string;
  detail: string;
};

export function getPricingCoverageWarnings(pricing: MediaPricingResponse | null | undefined): PricingCoverageWarning[] {
  if (!pricing) {
    return [];
  }

  const warnings: PricingCoverageWarning[] = [];
  if (pricing.refresh_error) {
    warnings.push({
      key: "refresh-error",
      title: "Refresh failed",
      detail: pricing.refresh_error,
    });
  }

  if (pricing.is_stale) {
    warnings.push({
      key: "stale-snapshot",
      title: "Pricing snapshot is stale",
      detail: "Studio is using the cached pricing snapshot until a refresh succeeds.",
    });
  }

  const missingModelKeys = pricing.missing_model_keys ?? [];
  if (missingModelKeys.length) {
    warnings.push({
      key: "missing-model-pricing",
      title: "Missing model pricing",
      detail: compactList(missingModelKeys, 6),
    });
  }

  const unmappedRows = pricing.unmapped_source_rows ?? [];
  if (unmappedRows.length) {
    warnings.push({
      key: "unmapped-source-rows",
      title: "Unmapped KIE pricing rows",
      detail: compactList(unmappedRows.map(describeUnmappedPricingRow), 4),
    });
  }

  return warnings;
}

export function describeUnmappedPricingRow(row: Record<string, unknown>): string {
  const label = stringValue(row.label) ?? stringValue(row.description) ?? stringValue(row.row_label);
  const credits = numberValue(row.credits);
  const costUsd = numberValue(row.cost_usd);
  const parts = [label ?? "Unknown row"];
  if (credits != null) {
    parts.push(`${credits} credits`);
  }
  if (costUsd != null) {
    parts.push(`$${costUsd.toFixed(2)}`);
  }
  return parts.join(" - ");
}

function compactList(values: string[], max: number): string {
  const visible = values.slice(0, max);
  const hidden = values.length - visible.length;
  return hidden > 0 ? `${visible.join(", ")} and ${hidden} more` : visible.join(", ");
}

function stringValue(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
