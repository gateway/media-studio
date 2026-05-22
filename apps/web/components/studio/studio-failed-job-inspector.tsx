"use client";

import { AlertTriangle, Image as ImageIcon, RotateCcw, Trash2, X } from "lucide-react";

import { StatusPill } from "@/components/status-pill";
import { StudioStatusCallout } from "@/components/studio/studio-status-callout";
import {
  studioCaptionClassName,
  studioMetaValueClassName,
  studioPreviewFallbackClassName,
} from "@/components/studio/studio-theme";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { CalloutPanel, OverlayShell, PropertyStack, PropertyStackItem, SurfaceCard, SurfaceInset } from "@/components/ui/surface-primitives";
import type { StudioReferencePreview } from "@/lib/media-studio-helpers";
import type { MediaJob } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

type StudioFailedJobInspectorProps = {
  job: MediaJob;
  prompt: string | null;
  imageReferences: StudioReferencePreview[];
  onClose: () => void;
  onDismiss: () => void;
  onRetry: () => void;
  onOpenReference: (reference: StudioReferencePreview) => void;
  statusLabel: string;
};

export function StudioFailedJobInspector({
  job,
  prompt,
  imageReferences,
  onClose,
  onDismiss,
  onRetry,
  onOpenReference,
  statusLabel,
}: StudioFailedJobInspectorProps) {
  return (
    <OverlayShell
      backdropClassName="studio-inspector-backdrop z-[120]"
      innerClassName="min-h-dvh p-0 lg:p-6"
      panelClassName="grid min-h-dvh content-start gap-4 px-3 pb-6 pt-3 [touch-action:pan-y] lg:h-[calc(100dvh-3rem)] lg:min-h-0 lg:max-h-[calc(100dvh-3rem)] lg:grid-cols-[minmax(0,1fr)_360px] lg:overflow-hidden lg:px-6 lg:pb-6 lg:pt-6"
    >
        <div data-testid="studio-failed-job-inspector" className="contents">
          <div className="grid min-h-0 content-start gap-4 lg:grid-rows-[minmax(0,1fr)_auto]">
            <div className="studio-inspector-workspace relative overflow-hidden rounded-[30px]">
              <IconButton
                icon={X}
                onClick={onClose}
                className="studio-inspector-close-button absolute right-4 top-4 z-10"
                aria-label="Close failed job inspector"
              />
              <div className="flex min-h-[48vh] items-center justify-center p-4 sm:p-6 lg:h-full">
                <StudioStatusCallout
                  tone="danger"
                  title="Failed media job"
                  description="No output image was published for this failed job. The saved prompt and provider error are still available below."
                  icon={(
                    <div className="studio-failed-icon-shell mx-auto inline-flex h-16 w-16 items-center justify-center rounded-full">
                      <AlertTriangle className="size-7" />
                    </div>
                  )}
                  className="max-w-[24rem] rounded-[28px] px-6 py-8"
                />
              </div>
              <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between p-4">
                <div className="pointer-events-auto flex items-center gap-2" />
                <div className="pointer-events-auto flex items-center gap-2">
                  <IconButton
                    icon={Trash2}
                    data-testid="studio-failed-job-remove"
                    onClick={onDismiss}
                    tone="danger"
                    className="studio-danger-icon-button h-11 w-11"
                    aria-label="Remove failed media card"
                    title="Remove failed media card"
                  />
                </div>
              </div>
            </div>
            <SurfaceCard appearance="studio" density="compact" className="p-4 text-[var(--text-primary)]">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="surface-label-muted">Prompt</div>
              </div>
              <SurfaceInset appearance="studio" density="compact" className="studio-inspector-prompt-scroll max-h-[14rem] overflow-y-auto rounded-[18px] pr-2">
                <p className="whitespace-pre-wrap text-sm leading-7 text-[var(--text-muted)]">
                  {prompt ?? "No prompt text was stored for this failed job."}
                </p>
              </SurfaceInset>
            </SurfaceCard>
          </div>
          <div className="studio-inspector-panel grid min-h-0 gap-4 rounded-[28px] p-4 lg:grid lg:overflow-y-auto lg:p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="surface-label-muted">Failed job</div>
                <div className={studioMetaValueClassName({ className: "mt-1 text-sm text-[var(--text-muted)]" })}>
                  {job.model_key ?? "Unknown model"} • {formatDateTime(job.created_at)}
                </div>
              </div>
              <StatusPill label={statusLabel} tone="danger" />
            </div>
            <Button
              data-testid="studio-failed-job-retry"
              onClick={onRetry}
              variant="primary"
              size="compact"
              className="studio-project-primary-text h-9 w-fit self-start rounded-full gap-2"
            >
              <RotateCcw className="size-4" />
              Retry in Studio
            </Button>
            <CalloutPanel tone="danger" className="min-w-0 rounded-[22px]">
              <div className="studio-danger-label text-[0.72rem] font-semibold uppercase tracking-[0.16em]">Provider Error</div>
              <p className="mt-3 whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-sm leading-7 text-[var(--text-primary)]">
                {job.error ?? "The media provider did not return a more specific failure message."}
              </p>
            </CalloutPanel>
            {imageReferences.length ? (
              <SurfaceInset appearance="studio" density="compact" className="rounded-[22px]">
                <div className="flex items-center gap-2 surface-label-muted">
                  <ImageIcon className="size-3.5 text-[var(--accent-strong)]" />
                  References
                </div>
                <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
                  {imageReferences.map((reference) => (
                    <button
                      key={reference.key}
                      type="button"
                      onClick={() => onOpenReference(reference)}
                      className="grid w-[5.5rem] shrink-0 gap-2 text-left transition hover:opacity-95"
                    >
                      <span className={studioPreviewFallbackClassName({ className: "overflow-hidden rounded-[16px] border border-[var(--border-soft)]" })}>
                        <img
                          src={reference.url}
                          alt={reference.label}
                          className="h-[5.5rem] w-[5.5rem] object-cover"
                          loading="lazy"
                          decoding="async"
                        />
                      </span>
                      <span className={studioCaptionClassName({ className: "line-clamp-2 text-xs leading-5" })}>{reference.label}</span>
                    </button>
                  ))}
                </div>
              </SurfaceInset>
            ) : null}
            <PropertyStack appearance="studio" className="rounded-[22px]">
              <PropertyStackItem appearance="studio" label="Job ID" value={job.job_id} valueClassName="break-words text-right [overflow-wrap:anywhere]" />
              <PropertyStackItem appearance="studio" label="Provider Task" value={job.provider_task_id ?? "Not assigned"} valueClassName="break-words text-right [overflow-wrap:anywhere]" />
              <PropertyStackItem appearance="studio" label="Mode" value={job.task_mode ?? "Unknown"} valueClassName="break-words text-right [overflow-wrap:anywhere]" />
            </PropertyStack>
          </div>
        </div>
    </OverlayShell>
  );
}
