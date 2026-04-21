import { Coins, ExternalLink, RefreshCcw, Sparkles } from "lucide-react";

import { PricingRefreshAction } from "@/app/pricing/pricing-refresh-action";
import { adminThemeLayoutClassName } from "@/components/admin-theme";
import {
  adminInsetCardClassName,
  adminInsetPanelClassName,
} from "@/components/admin-controls";
import { AdminNavButton } from "@/components/admin-nav-button";
import { Panel, PanelHeader } from "@/components/panel";
import { StudioAdminShell } from "@/components/studio-admin-shell";
import { CalloutPanel, SurfaceInset } from "@/components/ui/surface-primitives";
import { getMediaDashboardSnapshot } from "@/lib/control-api";
import { estimateFromPricingSnapshot } from "@/lib/studio-pricing";
import type { MediaModelSummary } from "@/lib/types";
import { formatCreditsAmount, formatDateTime, formatUsdAmount, isRecord, toFiniteNumber } from "@/lib/utils";

function formatAdjustmentMap(
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

function formatPricingStatus(authoritative: boolean, status: string | null | undefined) {
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

function buildPricingScenarioRows(rule: Record<string, unknown>, model: MediaModelSummary | null): PricingScenarioRow[] {
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

export default async function PricingPage() {
  const snapshot = await getMediaDashboardSnapshot();
  const pricing = snapshot.pricing.data;
  const models = snapshot.models.data?.models ?? [];
  const credits = snapshot.credits.data?.balance;
  const availableCredits =
    typeof credits?.available_credits === "number"
      ? credits.available_credits
      : typeof credits?.remaining_credits === "number"
        ? credits.remaining_credits
        : null;
  const rules = Array.isArray(pricing?.rules) ? pricing.rules : [];
  const sourceUrl = pricing?.source_url ?? null;
  const pricingStatus = pricing?.pricing_status ?? "unknown";
  const authoritative = Boolean(pricing?.is_authoritative);

  return (
    <StudioAdminShell
      section="pricing"
      eyebrow="Studio Admin"
      title="Pricing"
      description="Review the current KIE-backed pricing catalog, see how the Studio calculates request totals, and verify the same estimate snapshot that gets saved with submitted jobs."
    >
      <div className={adminThemeLayoutClassName}>
        <Panel>
          <PanelHeader
            eyebrow="Current Catalog"
            title="Live pricing context"
            description="Studio uses the normalized KIE catalog for model rules and server-side estimates for exact request totals. The Generate button updates when pricing-sensitive options change."
            action={
              <div className="flex flex-wrap items-center gap-2">
                <PricingRefreshAction />
                {sourceUrl ? (
                  <AdminNavButton href={sourceUrl} external size="compact">
                    Open source <ExternalLink className="ml-2 size-3.5" />
                  </AdminNavButton>
                ) : null}
              </div>
            }
          />
          <div className="mt-5 grid gap-3 lg:grid-cols-4">
            <SurfaceInset appearance="admin" className={adminInsetPanelClassName}>
              <div className="admin-label-muted">Catalog status</div>
              <div className="mt-3 text-lg font-semibold text-[var(--foreground)]">
                {formatPricingStatus(authoritative, pricingStatus)}
              </div>
            </SurfaceInset>
            <SurfaceInset appearance="admin" className={adminInsetPanelClassName}>
              <div className="admin-label-muted">Credits left</div>
              <div className="mt-3 text-2xl font-semibold text-[var(--foreground)]">
                {availableCredits != null ? availableCredits.toFixed(1) : "n/a"}
              </div>
            </SurfaceInset>
            <SurfaceInset appearance="admin" className={adminInsetPanelClassName}>
              <div className="admin-label-muted">Refreshed</div>
              <div className="mt-3 text-sm font-medium text-[var(--foreground)]">
                {pricing?.refreshed_at ? formatDateTime(pricing.refreshed_at) : "Unknown"}
              </div>
            </SurfaceInset>
            <SurfaceInset appearance="admin" className={adminInsetPanelClassName}>
              <div className="admin-label-muted">Models covered</div>
              <div className="mt-3 text-2xl font-semibold text-[var(--foreground)]">{rules.length}</div>
            </SurfaceInset>
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            <CalloutPanel appearance="admin" tone="accent" className={adminInsetCardClassName}>
              <div className="admin-icon-label-row admin-label-accent">
                <Coins className="size-3.5" />
                Estimate path
              </div>
              <p className="mt-3 text-sm leading-7 text-[var(--muted-strong)]">
                The Studio requests a server estimate for the exact model, prompt, and option set. That total is what shows in the
                Generate button before submit.
              </p>
            </CalloutPanel>
            <CalloutPanel appearance="admin" tone="accent" className={adminInsetCardClassName}>
              <div className="admin-icon-label-row admin-label-accent">
                <Sparkles className="size-3.5" />
                Saved snapshot
              </div>
              <p className="mt-3 text-sm leading-7 text-[var(--muted-strong)]">
                When a batch is submitted, the estimated total, per-output breakdown, and pricing metadata are saved with that batch so
                Jobs can show what the run was expected to cost.
              </p>
            </CalloutPanel>
            <CalloutPanel appearance="admin" tone="accent" className={adminInsetCardClassName}>
              <div className="admin-icon-label-row admin-label-accent">
                <RefreshCcw className="size-3.5" />
                Source
              </div>
              <p className="mt-3 text-sm leading-7 text-[var(--muted-strong)]">
                Current source: <span className="font-medium text-[var(--foreground)]">{pricing?.source ?? "unknown"}</span>
                {pricing?.cache_status ? (
                  <>
                    {" "}
                    with cache state{" "}
                    <span className="font-medium text-[var(--foreground)]">{pricing.cache_status.replaceAll("_", " ")}</span>.
                  </>
                ) : null}
              </p>
            </CalloutPanel>
          </div>
          {pricing?.notes?.length ? (
            <CalloutPanel appearance="admin" tone="muted" className="mt-4 text-sm leading-7 text-[var(--muted-strong)]">
              {pricing.notes[0]}
            </CalloutPanel>
          ) : null}
        </Panel>

        <Panel>
          <PanelHeader
            eyebrow="Model Pricing"
            title="Current rule set"
            description="Base request pricing comes from KIE, then the listed multipliers or adders are applied when those options are selected."
          />
          <div className="mt-5 grid gap-5">
            {rules.map((rule, index) => {
              const record = (isRecord(rule) ? rule : {}) as Record<string, unknown>;
              const model = models.find((entry) => entry.key === record.model_key) ?? null;
              const multiplierRows = formatAdjustmentMap("Multiplier", record.multipliers, (value) => {
                const amount = toFiniteNumber(value);
                return amount == null ? "n/a" : `${amount}x`;
              });
              const creditAdders = formatAdjustmentMap(
                "Credit add",
                record.adders_credits,
                (value) => formatCreditsAmount(value, { suffix: " credits" }) ?? "n/a",
              );
              const usdAdders = formatAdjustmentMap(
                "USD add",
                record.adders_cost_usd,
                (value) => formatUsdAmount(value) ?? "n/a",
              );
              const notes = Array.isArray(record.notes) ? record.notes.filter((value) => typeof value === "string") : [];
              const scenarioRows = buildPricingScenarioRows(record, model);

              return (
                <div
                  key={`${String(record.model_key ?? "rule")}-${index}`}
                  className="admin-pricing-model-card grid gap-4 p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-[1rem] font-semibold tracking-[-0.02em] text-[var(--foreground)]">
                        {String(record.model_key ?? "Unknown model")}
                      </div>
                      <div className="mt-1 text-sm text-[var(--muted-strong)]">
                        {[record.provider, record.interface_type, record.billing_unit].filter(Boolean).join(" • ") || "Request pricing"}
                      </div>
                    </div>
                    <div className="text-right text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted-strong)]">
                      Pricing status
                      <div className="mt-1 text-sm font-medium tracking-normal text-[var(--foreground)]">
                        {formatPricingStatus(authoritative, String(record.pricing_status ?? "unknown"))}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <SurfaceInset appearance="admin" className={adminInsetCardClassName}>
                      <div className="admin-label-muted">Base credits</div>
                      <div className="mt-2 text-xl font-semibold text-[var(--foreground)]">{formatCreditsAmount(record.base_credits, { suffix: " credits" })}</div>
                    </SurfaceInset>
                    <SurfaceInset appearance="admin" className={adminInsetCardClassName}>
                      <div className="admin-label-muted">Base USD</div>
                      <div className="mt-2 text-xl font-semibold text-[var(--foreground)]">{formatUsdAmount(record.base_cost_usd)}</div>
                    </SurfaceInset>
                  </div>

                  <div className="mt-4 grid gap-2 text-sm leading-7 text-[var(--muted-strong)]">
                    {[...multiplierRows, ...creditAdders, ...usdAdders].length ? (
                      [...multiplierRows, ...creditAdders, ...usdAdders].map((line) => (
                        <SurfaceInset key={line} appearance="admin" density="compact" className="px-3 py-2">
                          {line}
                        </SurfaceInset>
                      ))
                    ) : (
                      <CalloutPanel appearance="admin" tone="muted" className="px-3 py-2">
                        No option adjustments recorded for this rule.
                      </CalloutPanel>
                    )}
                    {notes.length ? (
                      <CalloutPanel appearance="admin" tone="muted" className="px-3 py-2">
                        {notes[0]}
                      </CalloutPanel>
                    ) : null}
                  </div>

                  {scenarioRows.length ? (
                    <div className="mt-4 grid gap-3">
                      <div className="admin-label-muted">Common scenarios</div>
                      <div className="grid gap-2">
                        {scenarioRows.map((row) => (
                          <SurfaceInset
                            key={row.key}
                            appearance="admin"
                            density="compact"
                            className="grid gap-2 px-3 py-3 text-sm text-[var(--muted-strong)] md:grid-cols-[minmax(0,1fr)_140px_140px]"
                          >
                            <div className="font-medium text-[var(--foreground)]">{row.label}</div>
                            <div>
                              <div className="text-[0.68rem] uppercase tracking-[0.12em] text-[var(--muted-strong)]">1 output</div>
                              <div className="mt-1 text-[var(--foreground)]">{row.perOutputUsd ?? row.perOutputCredits ?? "n/a"}</div>
                            </div>
                            <div>
                              <div className="text-[0.68rem] uppercase tracking-[0.12em] text-[var(--muted-strong)]">2 outputs</div>
                              <div className="mt-1 text-[var(--foreground)]">{row.twoOutputUsd ?? row.twoOutputCredits ?? "n/a"}</div>
                            </div>
                          </SurfaceInset>
                        ))}
                      </div>
                      <div className="text-xs leading-6 text-[var(--muted-strong)]">
                        These examples are computed from the current catalog rules. Studio multiplies the per-output estimate by the selected Outputs count at submit time.
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </Panel>
      </div>
    </StudioAdminShell>
  );
}
