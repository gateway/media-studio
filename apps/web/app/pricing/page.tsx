import { AlertTriangle, ChevronDown, Coins, ExternalLink, RefreshCcw, Sparkles } from "lucide-react";

import { PricingRuleRow } from "@/app/pricing/pricing-rule-row";
import { formatPricingStatus } from "@/app/pricing/pricing-rule-view";
import { PricingRefreshAction } from "@/app/pricing/pricing-refresh-action";
import {
  adminFeatureGridThreeClassName,
  adminMetricGridFourClassName,
  adminThemeLayoutClassName,
} from "@/components/admin-theme";
import { adminInsetCardClassName } from "@/components/admin-controls";
import { AdminNavButton } from "@/components/admin-nav-button";
import { PanelHeader } from "@/components/panel";
import { StudioAdminShell } from "@/components/studio-admin-shell";
import { CalloutPanel } from "@/components/ui/surface-primitives";
import { getMediaDashboardSnapshot } from "@/lib/control-api";
import { getPricingCoverageWarnings } from "@/lib/pricing-coverage";
import { formatDateTime, formatUsdAmount, isRecord } from "@/lib/utils";

function formatTokenPair(promptTokens: number | null | undefined, completionTokens: number | null | undefined) {
  const prompt = typeof promptTokens === "number" ? promptTokens : 0;
  const completion = typeof completionTokens === "number" ? completionTokens : 0;
  return `${prompt.toLocaleString()} in · ${completion.toLocaleString()} out`;
}

export default async function PricingPage({
  searchParams,
}: {
  searchParams?: Promise<{ project?: string }>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
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
  const pricedModelCount = pricing?.priced_model_keys?.length ?? rules.length;
  const coverageWarnings = getPricingCoverageWarnings(pricing);
  const actualUsageSummary = snapshot.externalLlmUsageSummary.data?.summary ?? null;
  const actualUsageItems = snapshot.externalLlmUsage.data?.items ?? [];

  return (
    <StudioAdminShell
      section="pricing"
      currentProjectId={resolvedSearchParams.project ?? null}
      eyebrow="Studio Admin"
      title="Pricing"
      description="Review model estimates, available credits, and recorded AI usage."
    >
      <div className={adminThemeLayoutClassName}>
        <section aria-label="Pricing overview">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="admin-icon-label-row text-sm text-[var(--warning)]"><AlertTriangle className="size-4" />Estimates can change. Confirm KIE pricing before large runs.</p>
            <div className="flex flex-wrap items-center gap-2">
              <PricingRefreshAction />
              {sourceUrl ? <AdminNavButton href={sourceUrl} external size="compact" variant="subtle">Open source <ExternalLink className="size-3.5" /></AdminNavButton> : null}
            </div>
          </div>
          <dl className="admin-pricing-overview">
            <div><dt>Catalog status</dt><dd>{formatPricingStatus(authoritative, pricingStatus)}</dd></div>
            <div><dt>Credits left</dt><dd>{availableCredits != null ? availableCredits.toFixed(1) : "n/a"}</dd></div>
            <div><dt>Refreshed</dt><dd>{pricing?.refreshed_at ? formatDateTime(pricing.refreshed_at) : "Unknown"}</dd></div>
            <div><dt>Models covered</dt><dd>{pricedModelCount}</dd></div>
          </dl>

        </section>

        <section aria-labelledby="model-pricing-heading">
          <h2 className="admin-section-title" id="model-pricing-heading">Model estimates</h2>
          <p className="admin-pricing-explanation mt-2">Open a model for example totals and the rules behind them.</p>
          <div className="admin-data-list admin-pricing-list mt-5">
            <div className="admin-data-heading admin-pricing-columns"><span>Model</span><span>Billed per</span><span>Base credits</span><span>Base USD</span><span>Details</span></div>
            {rules.map((rule, index) => {
              const record = isRecord(rule) ? rule : {};
              const model = models.find((entry) => entry.key === record.model_key) ?? null;
              return <PricingRuleRow key={`${String(record.model_key ?? "rule")}-${index}`} rule={record} model={model} authoritative={authoritative} />;
            })}
            {!rules.length ? <CalloutPanel appearance="admin" tone="muted" className="px-4 py-5 text-sm">No model pricing is available. Refresh pricing to try again.</CalloutPanel> : null}
          </div>
        </section>
        <section className="admin-pricing-usage">
          <PanelHeader
            eyebrow="AI Model Usage"
            title="Observed token usage"
            description={`This shows successful text-model calls from OpenRouter and Codex Local. OpenRouter rows include spend; Codex Local rows are tracked as $0 because they use the signed-in local Codex account. Showing the latest ${actualUsageItems.length || 20} calls.`}
          />
          <div className={adminMetricGridFourClassName}>
            <div>
              <div className="admin-label-muted">Today</div>
              <div className="mt-3 text-2xl font-semibold text-[var(--foreground)]">
                {formatUsdAmount(actualUsageSummary?.today.cost_usd ?? null) ?? "n/a"}
              </div>
              <div className="mt-2 text-sm text-[var(--muted-strong)]">
                {formatTokenPair(actualUsageSummary?.today.prompt_tokens, actualUsageSummary?.today.completion_tokens)}
              </div>
              <div className="mt-1 text-xs text-[var(--muted-strong)]">
                {(actualUsageSummary?.today.total_tokens ?? 0).toLocaleString()} total tokens
              </div>
            </div>
            <div>
              <div className="admin-label-muted">Last 7d</div>
              <div className="mt-3 text-2xl font-semibold text-[var(--foreground)]">
                {formatUsdAmount(actualUsageSummary?.last_7d.cost_usd ?? null) ?? "n/a"}
              </div>
              <div className="mt-2 text-sm text-[var(--muted-strong)]">
                {formatTokenPair(actualUsageSummary?.last_7d.prompt_tokens, actualUsageSummary?.last_7d.completion_tokens)}
              </div>
              <div className="mt-1 text-xs text-[var(--muted-strong)]">
                {(actualUsageSummary?.last_7d.total_tokens ?? 0).toLocaleString()} total tokens
              </div>
            </div>
            <div>
              <div className="admin-label-muted">Last 30d</div>
              <div className="mt-3 text-2xl font-semibold text-[var(--foreground)]">
                {formatUsdAmount(actualUsageSummary?.last_30d.cost_usd ?? null) ?? "n/a"}
              </div>
              <div className="mt-2 text-sm text-[var(--muted-strong)]">
                {formatTokenPair(actualUsageSummary?.last_30d.prompt_tokens, actualUsageSummary?.last_30d.completion_tokens)}
              </div>
              <div className="mt-1 text-xs text-[var(--muted-strong)]">
                {(actualUsageSummary?.last_30d.total_tokens ?? 0).toLocaleString()} total tokens
              </div>
            </div>
            <div>
              <div className="admin-label-muted">Lifetime</div>
              <div className="mt-3 text-2xl font-semibold text-[var(--foreground)]">
                {formatUsdAmount(actualUsageSummary?.lifetime.cost_usd ?? null) ?? "n/a"}
              </div>
              <div className="mt-2 text-sm text-[var(--muted-strong)]">
                {formatTokenPair(actualUsageSummary?.lifetime.prompt_tokens, actualUsageSummary?.lifetime.completion_tokens)}
              </div>
              <div className="mt-1 text-xs text-[var(--muted-strong)]">
                {actualUsageSummary?.lifetime.event_count?.toLocaleString() ?? "0"} calls
              </div>
            </div>
          </div>
          <details className="admin-data-row mt-5"><summary className="admin-data-summary">Recent usage (latest 20 calls)</summary><div className="admin-data-body grid gap-2">
            {actualUsageItems.length ? (
              actualUsageItems.map((item) => (
                <div
                  key={item.usage_event_id}
                  className="grid gap-2 px-3 py-3 text-sm text-[var(--muted-strong)] md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_170px_140px]"
                >
                  <div>
                    <div className="font-medium text-[var(--foreground)]">
                      {item.source_kind.replaceAll("_", " ")}
                    </div>
                    <div className="mt-1 break-all text-xs">{item.provider_model_id}</div>
                  </div>
                  <div className="text-xs leading-6">
                    {item.workflow_id ? <div>workflow {item.workflow_id}</div> : null}
                    {item.node_id ? <div>node {item.node_id}</div> : null}
                    {!item.workflow_id && !item.node_id && item.model_key ? <div>model {item.model_key}</div> : null}
                  </div>
                  <div className="text-[var(--foreground)]">
                    {formatTokenPair(item.prompt_tokens, item.completion_tokens)}
                    <div className="mt-1 text-xs text-[var(--muted-strong)]">
                      {(item.total_tokens ?? 0).toLocaleString()} total
                    </div>
                  </div>
                  <div className="text-right font-medium text-[var(--foreground)]">
                    {formatUsdAmount(item.cost_usd ?? null) ?? "n/a"}
                    <div className="mt-1 text-xs font-normal text-[var(--muted-strong)]">
                      {item.created_at ? formatDateTime(item.created_at) : "Unknown time"}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <CalloutPanel appearance="admin" tone="muted" className={adminInsetCardClassName}>
                No AI model usage has been recorded yet.
              </CalloutPanel>
            )}
          </div></details>
        </section>

        <details className="admin-pricing-catalog-details">
            <summary>How estimates are saved · Source and coverage details<ChevronDown className="size-3.5" aria-hidden="true" /></summary>
            <div className="admin-data-body">
          <div className={adminFeatureGridThreeClassName}>
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
          {coverageWarnings.length ? (
            <div className="mt-4 grid gap-3">
              {coverageWarnings.map((warning) => (
                <CalloutPanel key={warning.key} appearance="admin" tone="warning" className={adminInsetCardClassName}>
                  <div className="admin-icon-label-row admin-label-muted">
                    <AlertTriangle className="size-3.5" />
                    {warning.title}
                  </div>
                  <p className="mt-3 text-sm leading-7 text-[var(--muted-strong)]">{warning.detail}</p>
                </CalloutPanel>
              ))}
            </div>
          ) : null}            </div>
        </details>
      </div>
    </StudioAdminShell>
  );
}
