"use client";

import { AdminToggle } from "@/components/admin-controls";
import { CollapsibleSubsection } from "@/components/collapsible-sections";
import { Panel, PanelHeader } from "@/components/panel";
import { StatusPill } from "@/components/status-pill";
import { SurfaceInset } from "@/components/ui/surface-primitives";
import type { MediaModelSummary } from "@/lib/types";

type MediaModelAvailabilityPanelProps = {
  rows: Array<{
    model: MediaModelSummary;
    enabled: boolean;
  }>;
  onToggleAvailability: (modelKey: string, enabled: boolean) => void;
};

export function MediaModelAvailabilityPanel({
  rows,
  onToggleAvailability,
}: MediaModelAvailabilityPanelProps) {
  const enabledModelCount = rows.filter((entry) => entry.enabled).length;
  const disabledModelCount = rows.length - enabledModelCount;

  return (
    <Panel>
      <PanelHeader
        eyebrow="Model Availability"
        title="Enable Or Disable Models"
        description="Turn individual models on or off for Studio without changing any saved jobs, outputs, or history."
      />
      <div className="mt-5 max-w-[980px]">
        <CollapsibleSubsection
          title="Model Availability"
          description="Expand this list to enable or disable any Studio model without changing saved jobs, outputs, or history."
          tone="media"
          defaultOpen={false}
          badge={
            <StatusPill
              label={`${enabledModelCount} enabled${disabledModelCount > 0 ? ` · ${disabledModelCount} disabled` : ""}`}
              tone={disabledModelCount > 0 ? "warning" : "healthy"}
            />
          }
          className="px-5 py-5"
          summaryClassName="flex-col items-start gap-3 sm:flex-row sm:items-start"
          titleClassName="admin-label-muted flex items-center gap-2"
          descriptionClassName="max-w-[760px]"
          bodyClassName="grid gap-3 border-t border-[var(--surface-border-soft)] pt-5"
        >
          <div className="grid gap-3">
            {rows.map(({ model, enabled }) => (
              <SurfaceInset
                key={`availability-${model.key}`}
                appearance="admin"
                density="compact"
                className="admin-row-surface"
              >
                <div className="min-w-0 grid gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="truncate text-sm font-medium text-[var(--foreground)]">{model.label}</div>
                    <StatusPill label={enabled ? "Enabled" : "Disabled"} tone={enabled ? "healthy" : "warning"} />
                  </div>
                  <div className="text-sm leading-6 text-[var(--muted-strong)]">
                    {model.key} · {(model.task_modes ?? []).length ? model.task_modes.join(", ").replaceAll("_", " ") : "No published task modes"}
                  </div>
                </div>
                <AdminToggle
                  checked={enabled}
                  ariaLabel={`${enabled ? "Disable" : "Enable"} ${model.label}`}
                  onToggle={() => onToggleAvailability(model.key, !enabled)}
                />
              </SurfaceInset>
            ))}
          </div>
        </CollapsibleSubsection>
      </div>
    </Panel>
  );
}
