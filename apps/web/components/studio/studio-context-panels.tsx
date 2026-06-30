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
                className="studio-context-card studio-context-card-light"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="studio-context-title">
                      {job.model_key ?? "Unknown model"}
                    </div>
                    <p className="studio-context-body mt-2">
                      {truncate(job.final_prompt_used || job.enhanced_prompt || job.raw_prompt || "No prompt recorded.", 160)}
                    </p>
                  </div>
                  <StatusPill label={job.status} tone={toneForStatus(job.status)} />
                </div>
                <div className="studio-context-meta-row">
                  <span>{formatDateTime(job.created_at)}</span>
                  <span>•</span>
                  <span>{job.provider_task_id ?? "local staging"}</span>
                </div>
              </div>
            ))
          ) : (
            <div className="studio-context-card studio-context-card-empty studio-context-body">
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
          <div className="studio-context-card">
            <div className="studio-context-kicker">Model</div>
            <div className="studio-context-value">
              {currentModel?.label ?? "No model selected"}
            </div>
          </div>
          <div className="studio-context-card">
            <div className="studio-context-kicker">
              Selected prompts
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {selectedPromptList.length ? (
                selectedPromptList.map((promptItem) => (
                  <span
                    key={promptItem.prompt_id}
                    className="studio-context-chip"
                  >
                    @{promptItem.key}
                  </span>
                ))
              ) : (
                <span className="studio-context-body">No system prompts selected yet.</span>
              )}
            </div>
          </div>
          <div className="studio-context-card">
            <div className="studio-context-kicker">Preflight</div>
            <div className="studio-context-body mt-2">
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
