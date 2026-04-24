import Link from "next/link";
import { Clapperboard, Coins, LoaderCircle, SlidersHorizontal } from "lucide-react";

import { JobsBatchCard } from "@/app/jobs/jobs-batch-card";
import { MediaBatchActions } from "@/app/jobs/media-batch-actions";
import { RuntimeControls } from "@/app/jobs/runtime-controls";
import {
  adminInsetCompactClassName,
  adminThemeLayoutClassName,
} from "@/components/admin-theme";
import {
  adminDashedCardClassName,
  adminInsetPanelClassName,
} from "@/components/admin-controls";
import { AdminNavButton } from "@/components/admin-nav-button";
import { Panel, PanelHeader } from "@/components/panel";
import { StudioAdminShell } from "@/components/studio-admin-shell";
import { CalloutPanel, EmptyState, SurfaceInset } from "@/components/ui/surface-primitives";
import { getMediaDashboardSnapshot, toControlApiProxyPath } from "@/lib/control-api";
import type { MediaAsset, MediaBatch, MediaJob } from "@/lib/types";
import { formatCreditsAmount, formatDateTime, formatUsdAmount, isRecord, toFiniteNumber, truncate } from "@/lib/utils";

const JOBS_PER_PAGE_OPTIONS = [20, 50, 100] as const;

export default async function JobsPage({
  searchParams,
}: {
  searchParams?: Promise<{ page?: string; perPage?: string; project?: string }>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const currentProjectId = resolvedSearchParams.project?.trim() || null;
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
    if (currentProjectId) {
      params.set("project", currentProjectId);
    }
    const query = params.toString();
    return query ? `/jobs?${query}` : "/jobs";
  };

  return (
    <StudioAdminShell
      section="jobs"
      currentProjectId={currentProjectId}
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
          <SurfaceInset appearance="admin" className={mutedCardClassName}>
            <div className="admin-icon-label-row admin-label-muted mb-3">
              <LoaderCircle className={`size-3.5 ${runnerHealthy ? "" : "text-[var(--danger)]"}`} />
              Media Studio runner
            </div>
            <div className="grid gap-2 text-sm text-[var(--muted-strong)]">
              <SurfaceInset appearance="admin" density="compact" className={`grid gap-2 sm:grid-cols-2 ${adminInsetClassName}`}>
                <div className="grid gap-1">
                  <span className="admin-label-muted">Last heartbeat</span>
                  <span className="font-medium text-[var(--foreground)]">
                    {healthData?.last_scheduler_tick ? formatDateTime(healthData.last_scheduler_tick) : "Waiting"}
                  </span>
                </div>
                <div className="grid justify-items-end gap-1 text-right">
                  <span className="admin-label-muted">Runner status</span>
                    <span className={`font-medium ${runnerHealthy ? "text-[var(--accent-strong)]" : "text-[var(--danger)]"}`}>
                      {runnerHealth === "healthy" ? "Healthy" : runnerHealth === "paused" ? "Paused" : "Needs attention"}
                    </span>
                  </div>
              </SurfaceInset>
              <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
                <SurfaceInset appearance="admin" density="compact" className={adminInsetClassName}>
                  <div className="admin-label-muted">Attached to</div>
                  <div className="mt-1 text-[var(--foreground)]">{healthData?.runner_attached_to ?? "Media Studio API"}</div>
                </SurfaceInset>
                <SurfaceInset appearance="admin" density="compact" className={adminInsetClassName}>
                  <div className="admin-label-muted">Mode</div>
                  <div className="mt-1 text-[var(--foreground)] capitalize">{healthData?.runner_mode ?? "embedded"}</div>
                </SurfaceInset>
                <SurfaceInset appearance="admin" density="compact" className={adminInsetClassName}>
                  <div className="admin-label-muted">Launch</div>
                  <div className="mt-1 text-[var(--foreground)]">
                    {healthData?.runner_launch_mode === "supervised"
                      ? (healthData?.supervisor ?? "Supervised")
                      : "Manual"}
                  </div>
                </SurfaceInset>
                <SurfaceInset appearance="admin" density="compact" className={adminInsetClassName}>
                  <div className="admin-label-muted">Process</div>
                  <div className="mt-1 font-mono text-[var(--foreground)]">{healthData?.runner_process_name ?? "media-studio-runner"}</div>
                </SurfaceInset>
                <SurfaceInset appearance="admin" density="compact" className={adminInsetClassName}>
                  <div className="admin-label-muted">Running</div>
                  <div className="mt-1 text-[var(--foreground)]">{healthData?.running_jobs ?? recentRunningCount}</div>
                </SurfaceInset>
                <SurfaceInset appearance="admin" density="compact" className={adminInsetClassName}>
                  <div className="admin-label-muted">Queued</div>
                  <div className="mt-1 text-[var(--foreground)]">{healthData?.queued_jobs ?? recentQueuedCount}</div>
                </SurfaceInset>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <SurfaceInset appearance="admin" density="compact" className={`flex items-center justify-between gap-3 ${adminInsetClassName}`}>
                  <span>Jobs running at once</span>
                  <span className="font-medium text-[var(--foreground)]">{Math.max(1, queueSettings?.max_concurrent_jobs ?? 10)}</span>
                </SurfaceInset>
                <SurfaceInset appearance="admin" density="compact" className={`flex items-center justify-between gap-3 ${adminInsetClassName}`}>
                  <span>Retry limit</span>
                  <span className="font-medium text-[var(--foreground)]">{Math.max(1, queueSettings?.max_retry_attempts ?? 3)}</span>
                </SurfaceInset>
                <SurfaceInset appearance="admin" density="compact" className={`flex items-center justify-between gap-3 ${adminInsetClassName}`}>
                  <span>Heartbeat</span>
                  <span className="font-medium text-[var(--foreground)]">
                    {healthData?.heartbeat_age_seconds != null
                      ? `${healthData.heartbeat_age_seconds}s / ${healthData?.heartbeat_max_age_seconds ?? "?"}s`
                      : "Waiting"}
                  </span>
                </SurfaceInset>
              </div>
              {healthData?.issues?.length ? (
                <CalloutPanel appearance="admin" tone="danger" className="px-3 py-3 text-sm text-[var(--danger)]">
                  {healthData.issues[0]}
                </CalloutPanel>
              ) : null}
              <RuntimeControls />
              {availableCredits != null ? (
                <SurfaceInset appearance="admin" density="compact" className={`flex items-center justify-between gap-3 ${adminInsetClassName}`}>
                  <span className="inline-flex items-center gap-2 text-[var(--foreground)]">
                    <Coins className="size-4 text-[var(--accent-strong)]" />
                    Credits left
                  </span>
                  <span className="font-medium text-[var(--accent-strong)]">{availableCredits.toFixed(1)}</span>
                </SurfaceInset>
              ) : null}
            </div>
          </SurfaceInset>
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

          <div className="mt-5 grid gap-5">
            <SurfaceInset appearance="admin" density="compact" className={`${adminInsetClassName} text-sm leading-6 text-[var(--muted-strong)]`}>
              <div>
                Showing{" "}
                <span className="font-medium text-[var(--foreground)]">
                  {totalBatches === 0 ? 0 : pageStart + 1}
                  {perPage === "all" ? "" : `-${Math.min(totalBatches, normalizedPageStart + perPage)}`}
                </span>{" "}
                of <span className="font-medium text-[var(--foreground)]">{totalBatches}</span> jobs.
              </div>
            </SurfaceInset>

            {visibleBatches.length ? (
              visibleBatches.map((batch) => {
                const relatedAssets = assets.filter((asset) =>
                  (batch.jobs ?? []).some((job) => job.job_id === asset.job_id),
                );
                return <JobsBatchCard key={batch.batch_id} batch={batch} assets={relatedAssets} />;
              })
            ) : (
              <EmptyState
                appearance="admin"
                className={`${adminDashedCardClassName} py-8`}
                eyebrow="Queue"
                title="No media batches yet"
                description="No media batches are published to the dashboard yet."
              />
            )}

            {totalBatches > 0 ? (
              <SurfaceInset appearance="admin" density="compact" className={`${adminInsetClassName} flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="admin-label-muted">Show</span>
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
              </SurfaceInset>
            ) : null}
          </div>
        </Panel>
      </section>
      </div>
    </StudioAdminShell>
  );
}
