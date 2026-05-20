"use client";

import { AdminButton, AdminField, AdminInput, AdminToggle } from "@/components/admin-controls";
import { CollapsibleSubsection } from "@/components/collapsible-sections";
import { Panel, PanelHeader } from "@/components/panel";
import { StatusPill } from "@/components/status-pill";
import type { MediaQueueSettings } from "@/lib/types";

const STUDIO_MAX_CONCURRENT_JOBS = 10;
const STUDIO_MAX_POLL_SECONDS = 300;
const STUDIO_MAX_RETRY_ATTEMPTS = 10;

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
    created_at: current?.created_at ?? null,
    updated_at: current?.updated_at ?? null,
    ...patch,
  };
}

export function MediaModelsQueueSettingsPanel({
  queueSettings,
  isSaving,
  onQueueSettingsChange,
  onSave,
}: MediaModelsQueueSettingsPanelProps) {
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
          <label className="admin-toggle-row max-w-[280px] text-sm">
            <span className="font-medium text-[var(--foreground)]">Run jobs automatically</span>
            <AdminToggle
              checked={queueSettings?.queue_enabled ?? true}
              ariaLabel="Run jobs automatically"
              onToggle={() =>
                onQueueSettingsChange(
                  nextQueueSettings(queueSettings, {
                    queue_enabled: !(queueSettings?.queue_enabled ?? true),
                  }),
                )
              }
            />
          </label>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,280px)_minmax(0,220px)] lg:items-end">
            <AdminField label="Jobs running at once">
              <AdminInput
                type="number"
                min={1}
                max={STUDIO_MAX_CONCURRENT_JOBS}
                step={1}
                value={String(queueSettings?.max_concurrent_jobs ?? 10)}
                onChange={(event) =>
                  onQueueSettingsChange(
                    nextQueueSettings(queueSettings, {
                      max_concurrent_jobs: Math.min(
                        Math.max(1, Number(event.target.value) || 1),
                        STUDIO_MAX_CONCURRENT_JOBS,
                      ),
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
                min={1}
                max={STUDIO_MAX_POLL_SECONDS}
                step={1}
                value={String(Math.max(1, Math.min(STUDIO_MAX_POLL_SECONDS, Number(queueSettings?.default_poll_seconds ?? 6))))}
                onChange={(event) =>
                  onQueueSettingsChange(
                    nextQueueSettings(queueSettings, {
                      default_poll_seconds: Math.min(
                        Math.max(1, Number(event.target.value) || 1),
                        STUDIO_MAX_POLL_SECONDS,
                      ),
                    }),
                  )
                }
              />
            </AdminField>
            <AdminField label="Retry limit">
              <AdminInput
                type="number"
                min={1}
                max={STUDIO_MAX_RETRY_ATTEMPTS}
                step={1}
                value={String(Math.max(1, Math.min(STUDIO_MAX_RETRY_ATTEMPTS, Number(queueSettings?.max_retry_attempts ?? 3))))}
                onChange={(event) =>
                  onQueueSettingsChange(
                    nextQueueSettings(queueSettings, {
                      max_retry_attempts: Math.min(
                        Math.max(1, Number(event.target.value) || 1),
                        STUDIO_MAX_RETRY_ATTEMPTS,
                      ),
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
