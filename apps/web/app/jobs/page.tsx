import Link from "next/link";
import { Clapperboard, Coins, LoaderCircle, SlidersHorizontal } from "lucide-react";

import { MediaBatchActions } from "@/app/jobs/media-batch-actions";
import { RuntimeControls } from "@/app/jobs/runtime-controls";
import { adminButtonClassName, adminDashedCardClassName, adminInsetCardClassName } from "@/components/admin-controls";
import { AdminNavButton } from "@/components/admin-nav-button";
import { Panel } from "@/components/panel";
import { StudioAdminShell } from "@/components/studio-admin-shell";
import { getMediaDashboardSnapshot, toControlApiProxyPath } from "@/lib/control-api";
import type { MediaAsset, MediaBatch, MediaJob } from "@/lib/types";
import { formatDateTime, truncate } from "@/lib/utils";

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

export default async function JobsPage() {
  const snapshot = await getMediaDashboardSnapshot();
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
  const adminThemeClassName =
    "grid min-w-0 gap-6 [--surface:rgba(17,20,19,0.9)] [--surface-muted:rgba(255,255,255,0.05)] [--surface-border:rgba(255,255,255,0.10)] [--surface-border-soft:rgba(255,255,255,0.08)] [--foreground:#f7f6f0] [--muted-strong:rgba(247,246,240,0.68)] [--accent-strong:rgba(208,255,72,0.94)] [--success:#bff36b] [--danger:#ffb5a6] [--shadow-soft:0_24px_60px_rgba(0,0,0,0.26)]";
  const mutedCardClassName = adminInsetCardClassName;
  const adminInsetClassName =
    "rounded-[16px] border border-[var(--surface-border-soft)] bg-[color:var(--surface-muted)]/82 px-3 py-3";

  return (
    <StudioAdminShell
      section="jobs"
      eyebrow="Studio Admin"
      title="Jobs"
      description="Follow queued runs, retries, and completed outputs in the same Studio admin theme used by the settings and model catalog."
    >
      <div className={adminThemeClassName}>
      <Panel>
        <div className="space-y-2">
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-[var(--accent-strong)]">
            Queue Health
          </p>
          <div>
            <h2 className="text-[1.35rem] font-semibold tracking-[-0.03em] text-[var(--foreground)]">
              {healthData?.runner_name ?? "Media Studio Runner"}
            </h2>
            <p className="mt-2 text-sm leading-7 text-[var(--muted-strong)]">
              This is the background Media Studio runner attached to the API. It owns queue pickup, provider polling, and final asset publishing.
            </p>
          </div>
        </div>
        <div className="mt-5">
          <div className={mutedCardClassName}>
            <div className="mb-3 flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-white/54">
              <LoaderCircle className={`size-3.5 ${runnerHealthy ? "" : "text-[var(--danger)]"}`} />
              Media Studio runner
            </div>
            <div className="grid gap-2 text-sm text-[var(--muted-strong)]">
              <div className={`flex items-center justify-between gap-3 ${adminInsetClassName}`}>
                <span>Runner status</span>
                <span className={`font-medium ${runnerHealthy ? "text-[var(--accent-strong)]" : "text-[var(--danger)]"}`}>
                  {runnerHealth === "healthy" ? "Healthy" : runnerHealth === "paused" ? "Paused" : "Needs attention"}
                </span>
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
                <div className={adminInsetClassName}>
                  <div className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-white/54">Last heartbeat</div>
                  <div className="mt-1 text-[var(--foreground)]">
                    {healthData?.last_scheduler_tick ? formatDateTime(healthData.last_scheduler_tick) : "Waiting"}
                  </div>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className={`flex items-center justify-between gap-3 ${adminInsetClassName}`}>
                  <span>Jobs running at once</span>
                  <span className="font-medium text-[var(--foreground)]">{Math.max(1, queueSettings?.max_concurrent_jobs ?? 10)}</span>
                </div>
                <div className={`flex items-center justify-between gap-3 ${adminInsetClassName}`}>
                  <span>Heartbeat age</span>
                  <span className="font-medium text-[var(--foreground)]">
                    {healthData?.heartbeat_age_seconds != null
                      ? `${healthData.heartbeat_age_seconds}s / ${healthData?.heartbeat_max_age_seconds ?? "?"}s`
                      : "Waiting"}
                  </span>
                </div>
              </div>
              <div className={`flex items-center justify-between gap-3 ${adminInsetClassName}`}>
                <span>Retry limit</span>
                <span className="font-medium text-[var(--foreground)]">{Math.max(1, queueSettings?.max_retry_attempts ?? 3)}</span>
              </div>
              {healthData?.issues?.length ? (
                <div className="rounded-[16px] border border-[rgba(175,79,64,0.18)] bg-[rgba(175,79,64,0.08)] px-3 py-3 text-sm text-[var(--danger)]">
                  {healthData.issues[0]}
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href="https://github.com/gateway/media-studio/blob/main/docs/runtime-and-supervision.md"
                  target="_blank"
                  rel="noreferrer"
                  className={adminButtonClassName({ variant: "subtle", size: "compact" })}
                >
                  Runtime setup docs
                </Link>
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
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-[var(--accent-strong)]">
                Queue
              </p>
              <div>
                <h2 className="text-[1.35rem] font-semibold tracking-[-0.03em] text-[var(--foreground)]">
                  Recent Jobs
                </h2>
                <p className="mt-2 text-sm leading-7 text-[var(--muted-strong)]">
                  Open a batch to inspect outputs, progress, prompt summary, and any failures tied to that run.
                </p>
              </div>
            </div>
            <div className="shrink-0">
              <AdminNavButton href="/models">
                Open Models
              </AdminNavButton>
            </div>
          </div>

          <div className="mt-5 grid gap-4">
            {batches.length ? (
              batches.map((batch) => {
                const jobs = [...(batch.jobs ?? [])].sort((left, right) => (left.batch_index ?? 1) - (right.batch_index ?? 1));

                return (
                  <div
                    key={batch.batch_id}
                    className="rounded-[24px] border border-[var(--surface-border-soft)] bg-[color:var(--surface-muted)]/82 px-4 py-4 shadow-[0_24px_60px_rgba(0,0,0,0.18)]"
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
          </div>
        </Panel>
      </section>
      </div>
    </StudioAdminShell>
  );
}
