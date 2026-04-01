import { Coins, ExternalLink, RefreshCcw, Sparkles } from "lucide-react";

import {
  adminInsetCardClassName,
  adminInsetPanelClassName,
} from "@/components/admin-controls";
import { AdminNavButton } from "@/components/admin-nav-button";
import { Panel, PanelHeader } from "@/components/panel";
import { StatusPill } from "@/components/status-pill";
import { StudioAdminShell } from "@/components/studio-admin-shell";
import { getMediaDashboardSnapshot } from "@/lib/control-api";
import { formatDateTime } from "@/lib/utils";

const pricingSurfaceClassName =
  "grid min-w-0 gap-6 [--surface:rgba(17,20,19,0.9)] [--surface-muted:rgba(255,255,255,0.05)] [--surface-border:rgba(255,255,255,0.10)] [--surface-border-soft:rgba(255,255,255,0.08)] [--foreground:#f7f6f0] [--muted-strong:rgba(247,246,240,0.68)] [--accent-strong:rgba(208,255,72,0.94)] [--success:#bff36b] [--danger:#ffb5a6] [--warning:#f1b86a] [--shadow-soft:0_24px_60px_rgba(0,0,0,0.26)]";

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function formatUsd(value: unknown) {
  const amount = asNumber(value);
  if (amount == null) {
    return "n/a";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: amount < 1 ? 2 : 0,
    maximumFractionDigits: amount < 1 ? 2 : 2,
  }).format(amount);
}

function formatCredits(value: unknown) {
  const amount = asNumber(value);
  if (amount == null) {
    return "n/a";
  }
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: amount % 1 === 0 ? 0 : 1 }).format(amount)} credits`;
}

function formatAdjustmentMap(
  label: string,
  value: unknown,
  formatter: (entry: unknown) => string,
) {
  const record = asRecord(value);
  if (!record) {
    return [];
  }

  return Object.entries(record)
    .filter(([, optionMap]) => asRecord(optionMap))
    .map(([optionKey, optionMap]) => {
      const normalized = asRecord(optionMap) ?? {};
      const parts = Object.entries(normalized).map(([choice, entryValue]) => `${choice}: ${formatter(entryValue)}`);
      return `${label} ${optionKey.replaceAll("_", " ")} -> ${parts.join(", ")}`;
    })
    .filter(Boolean);
}

function toneForPricing(authoritative: boolean, status: string | null | undefined) {
  if (authoritative) {
    return "healthy" as const;
  }
  if (status === "unknown") {
    return "danger" as const;
  }
  return "warning" as const;
}

export default async function PricingPage() {
  const snapshot = await getMediaDashboardSnapshot();
  const pricing = snapshot.pricing.data;
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
      <div className={pricingSurfaceClassName}>
        <Panel>
          <PanelHeader
            eyebrow="Current Catalog"
            title="Live pricing context"
            description="Studio uses the normalized KIE catalog for model rules and server-side estimates for exact request totals. The Generate button updates when pricing-sensitive options change."
            action={
              sourceUrl ? (
                <AdminNavButton href={sourceUrl} external size="compact">
                  Open source <ExternalLink className="ml-2 size-3.5" />
                </AdminNavButton>
              ) : null
            }
          />
          <div className="mt-5 grid gap-3 lg:grid-cols-4">
            <div className={adminInsetPanelClassName}>
              <div className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-white/54">Catalog status</div>
              <div className="mt-3 flex items-center gap-3">
                <StatusPill
                  label={authoritative ? "authoritative" : pricingStatus.replaceAll("_", " ")}
                  tone={toneForPricing(authoritative, pricingStatus)}
                />
              </div>
            </div>
            <div className={adminInsetPanelClassName}>
              <div className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-white/54">Credits left</div>
              <div className="mt-3 text-2xl font-semibold text-[var(--foreground)]">
                {availableCredits != null ? availableCredits.toFixed(1) : "n/a"}
              </div>
            </div>
            <div className={adminInsetPanelClassName}>
              <div className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-white/54">Refreshed</div>
              <div className="mt-3 text-sm font-medium text-[var(--foreground)]">
                {pricing?.refreshed_at ? formatDateTime(pricing.refreshed_at) : "Unknown"}
              </div>
            </div>
            <div className={adminInsetPanelClassName}>
              <div className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-white/54">Models covered</div>
              <div className="mt-3 text-2xl font-semibold text-[var(--foreground)]">{rules.length}</div>
            </div>
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            <div className={adminInsetCardClassName}>
              <div className="flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-[var(--accent-strong)]">
                <Coins className="size-3.5" />
                Estimate path
              </div>
              <p className="mt-3 text-sm leading-7 text-[var(--muted-strong)]">
                The Studio requests a server estimate for the exact model, prompt, and option set. That total is what shows in the
                Generate button before submit.
              </p>
            </div>
            <div className={adminInsetCardClassName}>
              <div className="flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-[var(--accent-strong)]">
                <Sparkles className="size-3.5" />
                Saved snapshot
              </div>
              <p className="mt-3 text-sm leading-7 text-[var(--muted-strong)]">
                When a batch is submitted, the estimated total, per-output breakdown, and pricing metadata are saved with that batch so
                Jobs can show what the run was expected to cost.
              </p>
            </div>
            <div className={adminInsetCardClassName}>
              <div className="flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-[var(--accent-strong)]">
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
            </div>
          </div>
          {pricing?.notes?.length ? (
            <div className="mt-4 rounded-[20px] border border-[var(--surface-border-soft)] bg-[color:var(--surface-muted)]/82 px-4 py-4 text-sm leading-7 text-[var(--muted-strong)]">
              {pricing.notes[0]}
            </div>
          ) : null}
        </Panel>

        <Panel>
          <PanelHeader
            eyebrow="Model Pricing"
            title="Current rule set"
            description="Base request pricing comes from KIE, then the listed multipliers or adders are applied when those options are selected."
          />
          <div className="mt-5 grid gap-4 xl:grid-cols-2">
            {rules.map((rule, index) => {
              const record = asRecord(rule) ?? {};
              const multiplierRows = formatAdjustmentMap("Multiplier", record.multipliers, (value) => {
                const amount = asNumber(value);
                return amount == null ? "n/a" : `${amount}x`;
              });
              const creditAdders = formatAdjustmentMap("Credit add", record.adders_credits, (value) => formatCredits(value));
              const usdAdders = formatAdjustmentMap("USD add", record.adders_cost_usd, (value) => formatUsd(value));
              const notes = Array.isArray(record.notes) ? record.notes.filter((value) => typeof value === "string") : [];

              return (
                <div key={`${String(record.model_key ?? "rule")}-${index}`} className={adminInsetPanelClassName}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-[1rem] font-semibold tracking-[-0.02em] text-[var(--foreground)]">
                        {String(record.model_key ?? "Unknown model")}
                      </div>
                      <div className="mt-1 text-sm text-[var(--muted-strong)]">
                        {[record.provider, record.interface_type, record.billing_unit].filter(Boolean).join(" • ") || "Request pricing"}
                      </div>
                    </div>
                    <StatusPill
                      label={String(record.pricing_status ?? "unknown").replaceAll("_", " ")}
                      tone={toneForPricing(authoritative, String(record.pricing_status ?? "unknown"))}
                    />
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className={adminInsetCardClassName}>
                      <div className="text-[0.72rem] uppercase tracking-[0.14em] text-[var(--muted-strong)]">Base credits</div>
                      <div className="mt-2 text-xl font-semibold text-[var(--foreground)]">{formatCredits(record.base_credits)}</div>
                    </div>
                    <div className={adminInsetCardClassName}>
                      <div className="text-[0.72rem] uppercase tracking-[0.14em] text-[var(--muted-strong)]">Base USD</div>
                      <div className="mt-2 text-xl font-semibold text-[var(--foreground)]">{formatUsd(record.base_cost_usd)}</div>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-2 text-sm leading-7 text-[var(--muted-strong)]">
                    {[...multiplierRows, ...creditAdders, ...usdAdders].length ? (
                      [...multiplierRows, ...creditAdders, ...usdAdders].map((line) => (
                        <div key={line} className="rounded-[16px] border border-[var(--surface-border-soft)] bg-[color:var(--surface-muted)]/82 px-3 py-2">
                          {line}
                        </div>
                      ))
                    ) : (
                      <div className="rounded-[16px] border border-[var(--surface-border-soft)] bg-[color:var(--surface-muted)]/82 px-3 py-2">
                        No option adjustments recorded for this rule.
                      </div>
                    )}
                    {notes.length ? (
                      <div className="rounded-[16px] border border-[var(--surface-border-soft)] bg-[color:var(--surface-muted)]/82 px-3 py-2">
                        {notes[0]}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>
    </StudioAdminShell>
  );
}
