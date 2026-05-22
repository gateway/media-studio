"use client";

import { Panel, PanelHeader } from "@/components/panel";
import { StatusPill } from "@/components/status-pill";
import { toneForStatus } from "@/lib/media-studio-helpers";
import type { MediaJob, MediaModelSummary, MediaSystemPrompt, MediaValidationResponse } from "@/lib/types";
import { formatDateTime, truncate } from "@/lib/utils";

type StudioContextPanelsProps = {
  localJobs: MediaJob[];
  currentModel: MediaModelSummary | null;
  selectedPromptList: MediaSystemPrompt[];
  validation: MediaValidationResponse | null;
};

export function StudioContextPanels({
  localJobs,
  currentModel,
  selectedPromptList,
  validation,
}: StudioContextPanelsProps) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_360px]">
      <Panel>
        <PanelHeader
          eyebrow="Queue"
          title="Recent jobs"
          description="The stage above is the operator-facing create surface. This queue keeps the current Control API job state visible while runs are moving."
        />
        <div className="mt-5 grid gap-3">
          {localJobs.length ? (
            localJobs.slice(0, 6).map((job) => (
              <div
                key={job.job_id}
                className="rounded-[22px] border border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.78)] px-4 py-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium tracking-[-0.02em] text-[var(--foreground)]">
                      {job.model_key ?? "Unknown model"}
                    </div>
                    <p className="mt-2 text-sm leading-7 text-[var(--muted-strong)]">
                      {truncate(job.final_prompt_used || job.enhanced_prompt || job.raw_prompt || "No prompt recorded.", 160)}
                    </p>
                  </div>
                  <StatusPill label={job.status} tone={toneForStatus(job.status)} />
                </div>
                <div className="mt-4 flex flex-wrap gap-2 text-xs uppercase tracking-[0.14em] text-[var(--muted-strong)]">
                  <span>{formatDateTime(job.created_at)}</span>
                  <span>•</span>
                  <span>{job.provider_task_id ?? "local staging"}</span>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-[22px] border border-dashed border-white/10 bg-[rgba(12,15,14,0.94)] px-4 py-4 text-sm leading-7 text-[var(--muted-strong)]">
              No media jobs are stored yet.
            </div>
          )}
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          eyebrow="Lineage"
          title="Current create context"
          description="A compact view of the prompt strategy currently staged in the bottom dock."
        />
        <div className="mt-5 grid gap-3">
          <div className="rounded-[20px] border border-white/10 bg-[rgba(12,15,14,0.94)] px-4 py-4">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent-strong)]">Model</div>
            <div className="mt-2 text-lg font-semibold tracking-[-0.03em] text-[var(--foreground)]">
              {currentModel?.label ?? "No model selected"}
            </div>
          </div>
          <div className="rounded-[20px] border border-white/10 bg-[rgba(12,15,14,0.94)] px-4 py-4">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent-strong)]">
              Selected prompts
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {selectedPromptList.length ? (
                selectedPromptList.map((promptItem) => (
                  <span
                    key={promptItem.prompt_id}
                    className="rounded-full border border-[rgba(208,255,72,0.24)] bg-[rgba(208,255,72,0.12)] px-3 py-2 text-xs uppercase tracking-[0.12em] text-[var(--accent-strong)]"
                  >
                    @{promptItem.key}
                  </span>
                ))
              ) : (
                <span className="text-sm leading-7 text-[var(--muted-strong)]">No system prompts selected yet.</span>
              )}
            </div>
          </div>
          <div className="rounded-[20px] border border-white/10 bg-[rgba(12,15,14,0.94)] px-4 py-4">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent-strong)]">Preflight</div>
            <div className="mt-2 text-sm leading-7 text-[var(--muted-strong)]">
              {validation?.resolved_system_prompt?.rendered_system_prompt
                ? String(validation.resolved_system_prompt.rendered_system_prompt)
                : "Run preflight to see the rendered system prompt and resolved options before submit."}
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
}
