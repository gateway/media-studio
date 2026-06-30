"use client";

import { AdminButton, AdminField, AdminInput, AdminToggleRow } from "@/components/admin-controls";
import { CollapsibleSubsection } from "@/components/collapsible-sections";
import { Panel, PanelHeader } from "@/components/panel";
import { StatusPill } from "@/components/status-pill";
import type { MediaQueueSettings } from "@/lib/types";

type MediaModelsQueueSettingsPanelProps = {
  queueSettings: MediaQueueSettings | null;
  isSaving: boolean;
  onQueueSettingsChange: (next: MediaQueueSettings) => void;
  onSave: () => void;
};

function nextQueueSettings(
  current: MediaQueueSettings | null,
  patch: Partial<MediaQueueSettings>,
): MediaQueueSettings {
  return {
    max_concurrent_jobs: current?.max_concurrent_jobs ?? 10,
    queue_enabled: current?.queue_enabled ?? true,
    default_poll_seconds: current?.default_poll_seconds ?? 6,
    max_retry_attempts: current?.max_retry_attempts ?? 3,
    max_concurrent_jobs_min: current?.max_concurrent_jobs_min,
    max_concurrent_jobs_max: current?.max_concurrent_jobs_max,
    default_poll_seconds_min: current?.default_poll_seconds_min,
    default_poll_seconds_max: current?.default_poll_seconds_max,
    max_retry_attempts_min: current?.max_retry_attempts_min,
    max_retry_attempts_max: current?.max_retry_attempts_max,
    created_at: current?.created_at ?? null,
    updated_at: current?.updated_at ?? null,
    ...patch,
  };
}

function boundedNumber(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(minimum, Number(value) || minimum), maximum);
}

export function MediaModelsQueueSettingsPanel({
  queueSettings,
  isSaving,
  onQueueSettingsChange,
  onSave,
}: MediaModelsQueueSettingsPanelProps) {
  const concurrentMin = Math.max(1, Number(queueSettings?.max_concurrent_jobs_min ?? 1));
  const concurrentMax = Math.max(concurrentMin, Number(queueSettings?.max_concurrent_jobs_max ?? queueSettings?.max_concurrent_jobs ?? concurrentMin));
  const pollMin = Math.max(1, Number(queueSettings?.default_poll_seconds_min ?? 1));
  const pollMax = Math.max(pollMin, Number(queueSettings?.default_poll_seconds_max ?? queueSettings?.default_poll_seconds ?? pollMin));
  const retryMin = Math.max(1, Number(queueSettings?.max_retry_attempts_min ?? 1));
  const retryMax = Math.max(retryMin, Number(queueSettings?.max_retry_attempts_max ?? queueSettings?.max_retry_attempts ?? retryMin));

  return (
    <Panel>
      <PanelHeader
        eyebrow="Queue"
        title="Queue Settings"
        description="Control how many jobs Studio can run at once and how often it checks for updates."
      />
      <div className="mt-5 max-w-[980px]">
        <CollapsibleSubsection
          title="Job Runner"
          description="Keep Studio processing queued generations in the background so new work starts automatically as space frees up."
          tone="media"
          defaultOpen={false}
          badge={<StatusPill label={queueSettings?.queue_enabled ? "Running" : "Paused"} tone={queueSettings?.queue_enabled ? "healthy" : "warning"} />}
          className="px-5 py-5"
          summaryClassName="flex-col items-start gap-3 sm:flex-row sm:items-start"
          titleClassName="admin-label-muted flex items-center gap-2"
          descriptionClassName="max-w-[760px]"
          bodyClassName="grid max-w-[760px] gap-3 border-t border-[var(--surface-border-soft)] pt-5"
        >
          <AdminToggleRow
            title="Run jobs automatically"
            checked={queueSettings?.queue_enabled ?? true}
            ariaLabel="Run jobs automatically"
            onToggle={() =>
              onQueueSettingsChange(
                nextQueueSettings(queueSettings, {
                  queue_enabled: !(queueSettings?.queue_enabled ?? true),
                }),
              )
            }
            className="max-w-[280px]"
          />
          <div className="grid gap-3 lg:grid-cols-[minmax(0,280px)_minmax(0,220px)] lg:items-end">
            <AdminField label="Jobs running at once">
              <AdminInput
                type="number"
                min={concurrentMin}
                max={concurrentMax}
                step={1}
                value={String(queueSettings?.max_concurrent_jobs ?? concurrentMax)}
                onChange={(event) =>
                  onQueueSettingsChange(
                    nextQueueSettings(queueSettings, {
                      max_concurrent_jobs: boundedNumber(Number(event.target.value), concurrentMin, concurrentMax),
                    }),
                  )
                }
              />
            </AdminField>
          </div>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,220px)_minmax(0,220px)]">
            <AdminField label="Check every">
              <AdminInput
                type="number"
                min={pollMin}
                max={pollMax}
                step={1}
                value={String(boundedNumber(Number(queueSettings?.default_poll_seconds ?? pollMin), pollMin, pollMax))}
                onChange={(event) =>
                  onQueueSettingsChange(
                    nextQueueSettings(queueSettings, {
                      default_poll_seconds: boundedNumber(Number(event.target.value), pollMin, pollMax),
                    }),
                  )
                }
              />
            </AdminField>
            <AdminField label="Retry limit">
              <AdminInput
                type="number"
                min={retryMin}
                max={retryMax}
                step={1}
                value={String(boundedNumber(Number(queueSettings?.max_retry_attempts ?? retryMin), retryMin, retryMax))}
                onChange={(event) =>
                  onQueueSettingsChange(
                    nextQueueSettings(queueSettings, {
                      max_retry_attempts: boundedNumber(Number(event.target.value), retryMin, retryMax),
                    }),
                  )
                }
              />
            </AdminField>
          </div>
          <div className="mt-1 flex flex-wrap gap-3">
            <AdminButton onClick={onSave} disabled={isSaving} size="compact">
              Save
            </AdminButton>
          </div>
        </CollapsibleSubsection>
      </div>
    </Panel>
  );
}
