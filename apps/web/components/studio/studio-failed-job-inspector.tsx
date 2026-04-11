"use client";

import { AlertTriangle, Image as ImageIcon, RotateCcw, Trash2, X } from "lucide-react";

import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { overlayBackdropClassName, overlayPanelClassName, softPanelClassName } from "@/components/ui/surfaces";
import type { StudioReferencePreview } from "@/lib/media-studio-helpers";
import type { MediaJob } from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";

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
    <div data-testid="studio-failed-job-inspector" className={cn(overlayBackdropClassName, "z-[120] bg-[rgba(6,8,7,0.86)]")}>
      <div className="min-h-dvh p-0 lg:p-6">
        <div className={cn("grid min-h-dvh content-start gap-4 px-3 pb-6 pt-3 [touch-action:pan-y] lg:h-[calc(100dvh-3rem)] lg:min-h-0 lg:max-h-[calc(100dvh-3rem)] lg:grid-cols-[minmax(0,1fr)_360px] lg:overflow-hidden lg:rounded-[34px] lg:px-6 lg:pb-6 lg:pt-6", overlayPanelClassName)}>
          <div className="grid min-h-0 content-start gap-4 lg:grid-rows-[minmax(0,1fr)_auto]">
            <div className="relative overflow-hidden rounded-[30px] bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.08),transparent_55%),linear-gradient(180deg,#111514,#181d1b)]">
              <IconButton
                icon={X}
                onClick={onClose}
                className="absolute right-4 top-4 z-10 bg-black/24 text-white/78 hover:text-white"
                aria-label="Close failed job inspector"
              />
              <div className="flex min-h-[48vh] items-center justify-center p-4 sm:p-6 lg:h-full">
                <div className="grid max-w-[24rem] gap-4 rounded-[28px] border border-[rgba(255,139,139,0.18)] bg-[rgba(40,16,14,0.42)] px-6 py-8 text-center text-white/78">
                  <div className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-full border border-[rgba(255,139,139,0.24)] bg-[rgba(255,139,139,0.1)] text-[#ff8b8b]">
                    <AlertTriangle className="size-7" />
                  </div>
                  <div>
                    <div className="text-base font-semibold text-white">Failed media job</div>
                    <p className="mt-2 text-sm leading-7 text-white/64">
                      No output image was published for this failed job. The saved prompt and provider error are still available below.
                    </p>
                  </div>
                </div>
              </div>
              <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between p-4">
                <div className="pointer-events-auto flex items-center gap-2" />
                <div className="pointer-events-auto flex items-center gap-2">
                  <IconButton
                    icon={Trash2}
                    data-testid="studio-failed-job-remove"
                    onClick={onDismiss}
                    tone="danger"
                    className="h-11 w-11 bg-[rgba(40,16,14,0.76)] text-[#ffb5a6] shadow-[0_18px_40px_rgba(0,0,0,0.32)]"
                    aria-label="Remove failed media card"
                    title="Remove failed media card"
                  />
                </div>
              </div>
            </div>
            <div className={cn("p-4 text-white", softPanelClassName)}>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-white/54">Prompt</div>
              </div>
              <div className="max-h-[14rem] overflow-y-auto rounded-[18px] border border-white/7 bg-black/16 px-4 py-3 pr-2">
                <p className="whitespace-pre-wrap text-sm leading-7 text-white/78">
                  {prompt ?? "No prompt text was stored for this failed job."}
                </p>
              </div>
            </div>
          </div>
          <div className="grid min-h-0 gap-4 rounded-[28px] bg-[rgba(255,255,255,0.04)] p-4 text-white lg:grid lg:overflow-y-auto lg:p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-white/54">Failed job</div>
                <div className="mt-1 text-sm text-white/76">
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
              className="h-9 w-fit self-start rounded-full gap-2 text-[#172200]"
            >
              <RotateCcw className="size-4" />
              Retry in Studio
            </Button>
            <div className="min-w-0 rounded-[22px] border border-[rgba(255,139,139,0.16)] bg-[rgba(73,20,20,0.24)] p-4">
              <div className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-[#ffb8b8]">Provider Error</div>
              <p className="mt-3 whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-sm leading-7 text-white/84">
                {job.error ?? "The media provider did not return a more specific failure message."}
              </p>
            </div>
            {imageReferences.length ? (
              <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
                <div className="flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-white/54">
                  <ImageIcon className="size-3.5 text-[rgba(208,255,72,0.88)]" />
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
                      <span className="overflow-hidden rounded-[16px] border border-white/10 bg-black/18">
                        <img
                          src={reference.url}
                          alt={reference.label}
                          className="h-[5.5rem] w-[5.5rem] object-cover"
                          loading="lazy"
                          decoding="async"
                        />
                      </span>
                      <span className="line-clamp-2 text-xs leading-5 text-white/70">{reference.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="grid gap-2 rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
              <div className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] items-start gap-3 rounded-[16px] bg-white/[0.03] px-3 py-3">
                <span className="pt-0.5 text-sm text-white/56">Job ID</span>
                <span className="min-w-0 break-words text-right text-sm font-medium text-white/92 [overflow-wrap:anywhere]">
                  {job.job_id}
                </span>
              </div>
              <div className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] items-start gap-3 rounded-[16px] bg-white/[0.03] px-3 py-3">
                <span className="pt-0.5 text-sm text-white/56">Provider Task</span>
                <span className="min-w-0 break-words text-right text-sm font-medium text-white/92 [overflow-wrap:anywhere]">
                  {job.provider_task_id ?? "Not assigned"}
                </span>
              </div>
              <div className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] items-start gap-3 rounded-[16px] bg-white/[0.03] px-3 py-3">
                <span className="pt-0.5 text-sm text-white/56">Mode</span>
                <span className="min-w-0 break-words text-right text-sm font-medium text-white/92 [overflow-wrap:anywhere]">
                  {job.task_mode ?? "Unknown"}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
