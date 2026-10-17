import { estimateFromPricingSnapshot } from "@/lib/studio-pricing";
import type { MediaModelSummary } from "@/lib/types";
import { formatCreditsAmount, formatUsdAmount, isRecord } from "@/lib/utils";

export function formatAdjustmentMap(
  label: string,
  value: unknown,
  formatter: (entry: unknown) => string,
) {
  const record = isRecord(value) ? value : null;
  if (!record) {
    return [];
  }

  return Object.entries(record)
    .filter(([, optionMap]) => isRecord(optionMap))
    .map(([optionKey, optionMap]) => {
      const normalized = (isRecord(optionMap) ? optionMap : {}) as Record<string, unknown>;
      const parts = Object.entries(normalized).map(([choice, entryValue]) => `${choice}: ${formatter(entryValue)}`);
      return `${label} ${optionKey.replaceAll("_", " ")} -> ${parts.join(", ")}`;
    })
    .filter(Boolean);
}

export function formatPricingStatus(authoritative: boolean, status: string | null | undefined) {
  if (authoritative) {
    return "Authoritative";
  }
  return String(status ?? "unknown").replaceAll("_", " ");
}

function pricingChoiceValue(value: unknown) {
  if (value == null) {
    return "__missing__";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return String(value).toLowerCase();
}

function uniquePricingChoices(rule: Record<string, unknown>, optionKey: string) {
  const values = new Map<string, unknown>();
  for (const sourceKey of ["multipliers", "adders_credits", "adders_cost_usd"] as const) {
    const source = isRecord(rule[sourceKey]) ? (rule[sourceKey] as Record<string, unknown>) : null;
    const optionMap = source && isRecord(source[optionKey]) ? (source[optionKey] as Record<string, unknown>) : null;
    if (!optionMap) {
      continue;
    }
    for (const choice of Object.keys(optionMap)) {
      values.set(pricingChoiceValue(choice), choice);
    }
  }
  return Array.from(values.values());
}

function sortScenarioChoices(optionKey: string, values: unknown[]) {
  const numericDuration = optionKey === "duration";
  return [...values].sort((left, right) => {
    const leftText = String(left);
    const rightText = String(right);
    if (numericDuration) {
      const leftNumber = Number(leftText);
      const rightNumber = Number(rightText);
      if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
        return leftNumber - rightNumber;
      }
    }
    if (optionKey === "sound") {
      const leftRank = leftText === "true" ? 1 : 0;
      const rightRank = rightText === "true" ? 1 : 0;
      return leftRank - rightRank;
    }
    return leftText.localeCompare(rightText, undefined, { numeric: true, sensitivity: "base" });
  });
}

function formatScenarioChoice(optionKey: string, value: unknown) {
  if (optionKey === "sound") {
    return value === "true" || value === true ? "Audio on" : "Audio off";
  }
  if (optionKey === "duration") {
    return `${value}s`;
  }
  if (optionKey === "resolution") {
    return String(value);
  }
  return `${optionKey.replaceAll("_", " ")} ${String(value)}`;
}

function cartesianProduct(values: Array<Array<unknown>>) {
  return values.reduce<Array<Array<unknown>>>(
    (accumulator, current) =>
      accumulator.flatMap((entry) => current.map((value) => [...entry, value])),
    [[]],
  );
}

type PricingScenarioRow = {
  key: string;
  label: string;
  perOutputUsd: string | null;
  perOutputCredits: string | null;
  twoOutputUsd: string | null;
  twoOutputCredits: string | null;
};

export function buildPricingScenarioRows(rule: Record<string, unknown>, model: MediaModelSummary | null): PricingScenarioRow[] {
  const preferredKeys = ["duration", "sound", "resolution", "mode"];
  const scenarioKeys = preferredKeys.filter((optionKey) => uniquePricingChoices(rule, optionKey).length > 0).slice(0, 3);
  if (!scenarioKeys.length) {
    return [];
  }

  const choiceSets = scenarioKeys.map((optionKey) => sortScenarioChoices(optionKey, uniquePricingChoices(rule, optionKey)).slice(0, 2));
  const combos = cartesianProduct(choiceSets).slice(0, 6);
  const rows: PricingScenarioRow[] = [];
  const modelKey = String(rule.model_key ?? model?.key ?? "");

  for (const combo of combos) {
    const options = Object.fromEntries(combo.map((value, index) => [scenarioKeys[index], value]));
    const perOutput = estimateFromPricingSnapshot({ rules: [rule] }, modelKey, options, 1);
    const twoOutput = estimateFromPricingSnapshot({ rules: [rule] }, modelKey, options, 2);
    rows.push({
      key: JSON.stringify(options),
      label: combo.map((value, index) => formatScenarioChoice(scenarioKeys[index], value)).join(" • "),
      perOutputUsd: formatUsdAmount(perOutput.estimatedCostUsd),
      perOutputCredits: formatCreditsAmount(perOutput.estimatedCredits, { suffix: " credits" }),
      twoOutputUsd: formatUsdAmount(twoOutput.estimatedCostUsd),
      twoOutputCredits: formatCreditsAmount(twoOutput.estimatedCredits, { suffix: " credits" }),
    });
  }

  return rows;
}
