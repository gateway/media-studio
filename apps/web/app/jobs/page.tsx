import Link from "next/link";
import { Clapperboard, Coins, LoaderCircle, SlidersHorizontal } from "lucide-react";

import { MediaBatchActions } from "@/app/jobs/media-batch-actions";
import { RuntimeControls } from "@/app/jobs/runtime-controls";
import {
  adminInsetCompactClassName,
  adminThemeLayoutClassName,
} from "@/components/admin-theme";
import {
  adminDashedCardClassName,
  adminInsetCardClassName,
  adminInsetPanelClassName,
} from "@/components/admin-controls";
import { AdminNavButton } from "@/components/admin-nav-button";
import { Panel, PanelHeader } from "@/components/panel";
import { StudioAdminShell } from "@/components/studio-admin-shell";
import { getMediaDashboardSnapshot, toControlApiProxyPath } from "@/lib/control-api";
import type { MediaAsset, MediaBatch, MediaJob } from "@/lib/types";
import { formatCreditsAmount, formatDateTime, formatUsdAmount, isRecord, toFiniteNumber, truncate } from "@/lib/utils";

const JOBS_PER_PAGE_OPTIONS = [20, 50, 100] as const;

function jobPreviewUrl(job: MediaJob, assets: MediaAsset[]) {
  const matchedAsset = assets.find((asset) => asset.job_id === job.job_id) ?? null;
  if (matchedAsset?.generation_kind === "video") {
    return (
      toControlApiProxyPath(matchedAsset?.hero_poster_url) ??
      toControlApiProxyPath(matchedAsset?.hero_thumb_url) ??
      null
    );
  }
  return (
    toControlApiProxyPath(matchedAsset?.hero_thumb_url) ??
    toControlApiProxyPath(matchedAsset?.hero_web_url) ??
    toControlApiProxyPath(matchedAsset?.hero_poster_url) ??
    null
  );
}

function batchPromptSummary(batch: MediaBatch) {
  const promptSummary = batch.request_summary?.prompt_summary;
  return typeof promptSummary === "string" && promptSummary.trim()
    ? promptSummary.trim()
    : "No prompt recorded for this batch.";
}

function batchAssetForJob(job: MediaJob, assets: MediaAsset[]) {
  return assets.find((asset) => asset.job_id === job.job_id) ?? null;
}

function batchPricingSummary(batch: MediaBatch) {
  const requestSummary = isRecord(batch.request_summary) ? batch.request_summary : null;
  const requestPricing = isRecord(requestSummary?.pricing_summary) ? requestSummary.pricing_summary : null;
  if (requestPricing) {
    return requestPricing;
  }

  for (const job of batch.jobs ?? []) {
    const preflight = isRecord(job.preflight) ? job.preflight : null;
    const pricing = isRecord(preflight?.pricing_summary) ? preflight.pricing_summary : null;
    if (pricing) {
      return pricing;
    }
  }

  return null;
}

export default async function JobsPage({
  searchParams,
}: {
  searchParams?: Promise<{ page?: string; perPage?: string }>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const requestedPerPage = resolvedSearchParams.perPage?.trim().toLowerCase();
  const perPage =
    requestedPerPage === "all"
      ? "all"
      : JOBS_PER_PAGE_OPTIONS.includes(Number(resolvedSearchParams.perPage) as (typeof JOBS_PER_PAGE_OPTIONS)[number])
        ? (Number(resolvedSearchParams.perPage) as (typeof JOBS_PER_PAGE_OPTIONS)[number])
        : 20;
  const requestedPage = Number(resolvedSearchParams.page ?? "1");
  const currentPage = perPage === "all" ? 1 : Number.isFinite(requestedPage) ? Math.max(1, requestedPage) : 1;
  const pageStart = perPage === "all" ? 0 : (currentPage - 1) * perPage;
  const snapshot = await getMediaDashboardSnapshot({
    batchesLimit: perPage === "all" ? 500 : perPage,
    batchesOffset: pageStart,
  });
  const batches = (snapshot.batches.data?.batches ?? []).filter((batch) => batch.status !== "cancelled");
  const assets = (snapshot.assets.data?.assets ?? []).filter((asset) => !asset.hidden_from_dashboard && !asset.dismissed_at);
  const queueSettings = snapshot.queueSettings.data?.settings ?? null;
  const credits = snapshot.credits.data?.balance;
  const availableCredits =
    typeof credits?.available_credits === "number"
      ? credits.available_credits
      : typeof credits?.remaining_credits === "number"
        ? credits.remaining_credits
        : null;
  const recentQueuedCount = batches.reduce((sum, batch) => sum + Math.max(0, batch.queued_count ?? 0), 0);
  const recentRunningCount = batches.reduce((sum, batch) => sum + Math.max(0, batch.running_count ?? 0), 0);
  const healthData = snapshot.status.data as
    | {
        supervisor?: string | null;
        runner_name?: string | null;
        runner_mode?: string | null;
        runner_attached_to?: string | null;
        runner_process_name?: string | null;
        runner_launch_mode?: string | null;
        runner_active?: boolean;
        runner_health?: string | null;
        heartbeat_age_seconds?: number | null;
        heartbeat_max_age_seconds?: number | null;
        queue_enabled?: boolean;
        queued_jobs?: number;
        running_jobs?: number;
        last_scheduler_tick?: string | null;
        issues?: string[];
      }
    | undefined;
  const runnerHealth = healthData?.runner_health ?? (healthData?.queue_enabled ? "needs_attention" : "paused");
  const runnerHealthy = runnerHealth === "healthy";
  const totalBatches = Number(snapshot.batches.data?.total ?? batches.length);
  const totalPages = perPage === "all" ? 1 : Math.max(1, Math.ceil(totalBatches / perPage));
  const normalizedPage = perPage === "all" ? 1 : Math.min(currentPage, totalPages);
  const normalizedPageStart = perPage === "all" ? 0 : (normalizedPage - 1) * perPage;
  const visibleBatches = batches;
  const pageWindowStart = Math.max(1, normalizedPage - 2);
  const pageWindowEnd = Math.min(totalPages, normalizedPage + 2);
  const visiblePageNumbers = Array.from(
    { length: Math.max(0, pageWindowEnd - pageWindowStart + 1) },
    (_, index) => pageWindowStart + index,
  );
  const mutedCardClassName = adminInsetPanelClassName;
  const adminInsetClassName = adminInsetCompactClassName;
  const buildJobsHref = ({
    page,
    perPageOverride,
  }: {
    page?: number;
    perPageOverride?: typeof perPage;
  }) => {
    const params = new URLSearchParams();
    const nextPerPage = perPageOverride ?? perPage;
    if (nextPerPage === "all") {
      params.set("perPage", "all");
    } else if (nextPerPage !== 20) {
      params.set("perPage", String(nextPerPage));
    }
    const nextPage = nextPerPage === "all" ? 1 : Math.max(1, page ?? normalizedPage);
    if (nextPage > 1) {
      params.set("page", String(nextPage));
    }
    const query = params.toString();
    return query ? `/jobs?${query}` : "/jobs";
  };

  return (
    <StudioAdminShell
      section="jobs"
      eyebrow="Studio Admin"
      title="Jobs"
      description="Follow queued runs, retries, completed outputs, and the saved estimate snapshot captured when each batch was submitted."
    >
      <div className={adminThemeLayoutClassName}>
      <Panel>
        <PanelHeader
          eyebrow="Queue Health"
          title={healthData?.runner_name ?? "Media Studio Runner"}
          description="This is the background Media Studio runner attached to the API. It owns queue pickup, provider polling, and final asset publishing."
        />
        <div className="mt-5">
          <div className={mutedCardClassName}>
            <div className="mb-3 flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-white/54">
              <LoaderCircle className={`size-3.5 ${runnerHealthy ? "" : "text-[var(--danger)]"}`} />
              Media Studio runner
            </div>
            <div className="grid gap-2 text-sm text-[var(--muted-strong)]">
              <div className={`grid gap-2 sm:grid-cols-2 ${adminInsetClassName}`}>
                <div className="grid gap-1">
                  <span className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-white/54">
                    Last heartbeat
                  </span>
                  <span className="font-medium text-[var(--foreground)]">
                    {healthData?.last_scheduler_tick ? formatDateTime(healthData.last_scheduler_tick) : "Waiting"}
                  </span>
                </div>
                <div className="grid justify-items-end gap-1 text-right">
                  <span className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-white/54">
                    Runner status
                  </span>
                  <span className={`font-medium ${runnerHealthy ? "text-[var(--accent-strong)]" : "text-[var(--danger)]"}`}>
                    {runnerHealth === "healthy" ? "Healthy" : runnerHealth === "paused" ? "Paused" : "Needs attention"}
                  </span>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
                <div className={adminInsetClassName}>
                  <div className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-white/54">Attached to</div>
                  <div className="mt-1 text-[var(--foreground)]">{healthData?.runner_attached_to ?? "Media Studio API"}</div>
                </div>
                <div className={adminInsetClassName}>
                  <div className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-white/54">Mode</div>
                  <div className="mt-1 text-[var(--foreground)] capitalize">{healthData?.runner_mode ?? "embedded"}</div>
                </div>
                <div className={adminInsetClassName}>
                  <div className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-white/54">Launch</div>
                  <div className="mt-1 text-[var(--foreground)]">
                    {healthData?.runner_launch_mode === "supervised"
                      ? (healthData?.supervisor ?? "Supervised")
                      : "Manual"}
                  </div>
                </div>
                <div className={adminInsetClassName}>
                  <div className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-white/54">Process</div>
                  <div className="mt-1 font-mono text-[var(--foreground)]">{healthData?.runner_process_name ?? "media-studio-runner"}</div>
                </div>
                <div className={adminInsetClassName}>
                  <div className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-white/54">Running</div>
                  <div className="mt-1 text-[var(--foreground)]">{healthData?.running_jobs ?? recentRunningCount}</div>
                </div>
                <div className={adminInsetClassName}>
                  <div className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-white/54">Queued</div>
                  <div className="mt-1 text-[var(--foreground)]">{healthData?.queued_jobs ?? recentQueuedCount}</div>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <div className={`flex items-center justify-between gap-3 ${adminInsetClassName}`}>
                  <span>Jobs running at once</span>
                  <span className="font-medium text-[var(--foreground)]">{Math.max(1, queueSettings?.max_concurrent_jobs ?? 10)}</span>
                </div>
                <div className={`flex items-center justify-between gap-3 ${adminInsetClassName}`}>
                  <span>Retry limit</span>
                  <span className="font-medium text-[var(--foreground)]">{Math.max(1, queueSettings?.max_retry_attempts ?? 3)}</span>
                </div>
                <div className={`flex items-center justify-between gap-3 ${adminInsetClassName}`}>
                  <span>Heartbeat</span>
                  <span className="font-medium text-[var(--foreground)]">
                    {healthData?.heartbeat_age_seconds != null
                      ? `${healthData.heartbeat_age_seconds}s / ${healthData?.heartbeat_max_age_seconds ?? "?"}s`
                      : "Waiting"}
                  </span>
                </div>
              </div>
              {healthData?.issues?.length ? (
                <div className="rounded-[16px] border border-[rgba(175,79,64,0.18)] bg-[rgba(175,79,64,0.08)] px-3 py-3 text-sm text-[var(--danger)]">
                  {healthData.issues[0]}
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-3">
                <AdminNavButton
                  href="https://github.com/gateway/media-studio/blob/main/docs/runtime-and-supervision.md"
                  external
                  variant="primary"
                  size="compact"
                >
                  Runtime setup docs
                </AdminNavButton>
              </div>
              <RuntimeControls />
              {availableCredits != null ? (
                <div className={`flex items-center justify-between gap-3 ${adminInsetClassName}`}>
                  <span className="inline-flex items-center gap-2 text-[var(--foreground)]">
                    <Coins className="size-4 text-[var(--accent-strong)]" />
                    Credits left
                  </span>
                  <span className="font-medium text-[var(--accent-strong)]">{availableCredits.toFixed(1)}</span>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </Panel>

      <section id="recent-runs">
        <Panel>
          <PanelHeader
            eyebrow="Queue"
            title="Recent Jobs"
            description="Open a batch to inspect outputs, progress, prompt summary, and any failures tied to that run."
            action={<AdminNavButton href="/models">Open Models</AdminNavButton>}
          />

          <div className="mt-5 grid gap-4">
            <div className={`${adminInsetClassName} text-sm leading-6 text-[var(--muted-strong)]`}>
              <div>
                Showing{" "}
                <span className="font-medium text-[var(--foreground)]">
                  {totalBatches === 0 ? 0 : pageStart + 1}
                  {perPage === "all" ? "" : `-${Math.min(totalBatches, normalizedPageStart + perPage)}`}
                </span>{" "}
                of <span className="font-medium text-[var(--foreground)]">{totalBatches}</span> jobs.
              </div>
            </div>

            {visibleBatches.length ? (
              visibleBatches.map((batch) => {
                const jobs = [...(batch.jobs ?? [])].sort((left, right) => (left.batch_index ?? 1) - (right.batch_index ?? 1));
                const pricingSummary = batchPricingSummary(batch);
                const totalPricing = isRecord(pricingSummary?.total) ? pricingSummary.total : null;
                const perOutputPricing = isRecord(pricingSummary?.per_output) ? pricingSummary.per_output : null;
                const savedOutputCount = toFiniteNumber(pricingSummary?.output_count);

                return (
                  <div
                    key={batch.batch_id}
                    className={adminInsetPanelClassName}
                  >
                    <div className="grid gap-4">
                      <div className="flex flex-col gap-2">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 space-y-2">
                            <h3 className="text-[0.98rem] font-semibold tracking-[0.02em] text-[var(--foreground)]">
                              {batch.model_key ?? "Unknown model"}
                            </h3>
                            <p className="max-w-none pr-4 text-sm leading-6 text-[var(--muted-strong)]">
                              {truncate(batchPromptSummary(batch), 180)}
                            </p>
                          </div>
                          <div className="flex flex-col items-end gap-2">
                            <div className="text-right text-xs uppercase tracking-[0.14em] text-[var(--muted-strong)]">
                              <div>{formatDateTime(batch.created_at)}</div>
                              <div className="mt-1">{truncate(batch.batch_id, 20)}</div>
                            </div>
                            <MediaBatchActions
                              batchId={batch.batch_id}
                              canCancelQueued={batch.queued_count > 0 && (batch.status === "queued" || batch.status === "processing")}
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <div className="inline-flex items-center gap-2 text-sm text-[var(--muted-strong)]">
                            <Clapperboard className="size-4 text-[var(--accent-strong)]" />
                            <span>{batch.status === "processing" ? "Processing" : batch.status.replaceAll("_", " ")}</span>
                          </div>
                          <div className="flex flex-wrap gap-3 text-xs uppercase tracking-[0.12em] text-[var(--muted-strong)]">
                            <span>{batch.queued_count} queued</span>
                            <span>{batch.running_count} processing</span>
                            <span>{batch.failed_count} failed</span>
                          </div>
                          {pricingSummary ? (
                            <div className={`${adminInsetClassName} grid gap-3 lg:grid-cols-4`}>
                              <div className="grid gap-1">
                                <span className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-white/54">
                                  Estimated total
                                </span>
                                <span className="text-[var(--foreground)]">
                                  {formatUsdAmount(totalPricing?.estimated_cost_usd)}{" "}
                                  <span className="text-[var(--muted-strong)]">/ {formatCreditsAmount(totalPricing?.estimated_credits)} credits</span>
                                </span>
                              </div>
                              <div className="grid gap-1">
                                <span className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-white/54">
                                  Per output
                                </span>
                                <span className="text-[var(--foreground)]">
                                  {formatUsdAmount(perOutputPricing?.estimated_cost_usd)}{" "}
                                  <span className="text-[var(--muted-strong)]">/ {formatCreditsAmount(perOutputPricing?.estimated_credits)} credits</span>
                                </span>
                              </div>
                              <div className="grid gap-1">
                                <span className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-white/54">
                                  Outputs
                                </span>
                                <span className="text-[var(--foreground)]">{savedOutputCount ?? batch.requested_outputs}</span>
                              </div>
                              <div className="grid gap-1">
                                <span className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-white/54">
                                  Pricing source
                                </span>
                                <span className="text-[var(--foreground)]">
                                  {String(pricingSummary.pricing_source_kind ?? pricingSummary.pricing_status ?? "saved snapshot").replaceAll("_", " ")}
                                </span>
                              </div>
                            </div>
                          ) : null}
                          <div className="flex flex-wrap gap-3 pt-2">
                            {jobs.map((job) => {
                              const childPreview = jobPreviewUrl(job, assets);
                              const asset = batchAssetForJob(job, assets);
                              const studioHref = asset ? `/studio?asset=${encodeURIComponent(String(asset.asset_id))}` : null;
                              return (
                                <Link
                                  key={`${job.job_id}-inline-preview`}
                                  href={studioHref ?? "/studio"}
                                  className="overflow-hidden rounded-[18px] border border-[var(--surface-border-soft)] bg-[linear-gradient(135deg,rgba(208,255,72,0.08),rgba(255,255,255,0.03))] transition hover:border-[rgba(208,255,72,0.24)]"
                                  title={`Open output ${job.batch_index ?? 1}`}
                                >
                                  {childPreview ? (
                                    <img
                                      src={childPreview}
                                      alt={`Output ${job.batch_index ?? 1}`}
                                      loading="lazy"
                                      decoding="async"
                                      className="h-[84px] w-[84px] object-cover"
                                    />
                                  ) : (
                                    <div className="flex h-[84px] w-[84px] items-center justify-center px-2 text-center text-[0.62rem] font-medium uppercase tracking-[0.12em] text-[var(--muted-strong)]">
                                      Output {job.batch_index ?? 1}
                                    </div>
                                  )}
                                </Link>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>

                    {jobs.some((job) => Boolean(job.error)) ? (
                      <div className="mt-4 grid gap-3">
                        {jobs
                          .filter((job) => Boolean(job.error))
                          .map((job) => (
                            <div key={`${job.job_id}-error`} className={mutedCardClassName}>
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="text-sm text-[var(--foreground)]">Output {job.batch_index ?? 1}</div>
                                <div className="text-xs uppercase tracking-[0.12em] text-white/42">
                                  {formatDateTime(job.updated_at)}
                                </div>
                              </div>
                              <div className="mt-3 rounded-[14px] border border-[rgba(175,79,64,0.18)] bg-[rgba(175,79,64,0.08)] px-3 py-2 text-sm text-[var(--danger)]">
                                {job.error}
                              </div>
                            </div>
                          ))}
                      </div>
                    ) : null}
                  </div>
                );
              })
            ) : (
              <div className={`${adminDashedCardClassName} py-8 leading-7`}>
                No media batches are published to the dashboard yet.
              </div>
            )}

            {totalBatches > 0 ? (
              <div className={`${adminInsetClassName} flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-white/54">
                    Show
                  </span>
                  {JOBS_PER_PAGE_OPTIONS.map((option) => (
                    <AdminNavButton
                      key={option}
                      href={buildJobsHref({ page: 1, perPageOverride: option })}
                      variant={perPage === option ? "primary" : "subtle"}
                      size="compact"
                    >
                      {option}
                    </AdminNavButton>
                  ))}
                  <AdminNavButton
                    href={buildJobsHref({ page: 1, perPageOverride: "all" })}
                    variant={perPage === "all" ? "primary" : "subtle"}
                    size="compact"
                  >
                    All
                  </AdminNavButton>
                </div>

                {perPage !== "all" && totalPages > 1 ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="mr-1 text-sm text-[var(--muted-strong)]">
                      Page <span className="font-medium text-[var(--foreground)]">{normalizedPage}</span> of{" "}
                      <span className="font-medium text-[var(--foreground)]">{totalPages}</span>
                    </span>
                    <AdminNavButton
                      href={buildJobsHref({ page: Math.max(1, normalizedPage - 1) })}
                      variant="subtle"
                      size="compact"
                    >
                      Previous
                    </AdminNavButton>
                    {visiblePageNumbers.map((pageNumber) => (
                      <AdminNavButton
                        key={pageNumber}
                        href={buildJobsHref({ page: pageNumber })}
                        variant={pageNumber === normalizedPage ? "primary" : "subtle"}
                        size="compact"
                      >
                        {pageNumber}
                      </AdminNavButton>
                    ))}
                    <AdminNavButton
                      href={buildJobsHref({ page: Math.min(totalPages, normalizedPage + 1) })}
                      variant="subtle"
                      size="compact"
                    >
                      Next
                    </AdminNavButton>
                  </div>
                ) : (
                  <div className="text-sm text-[var(--muted-strong)]">
                    Showing all <span className="font-medium text-[var(--foreground)]">{totalBatches}</span> jobs.
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </Panel>
      </section>
      </div>
    </StudioAdminShell>
  );
}
