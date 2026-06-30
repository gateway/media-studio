"use client";

import { AdminToggle } from "@/components/admin-controls";
import type { MediaModelSummary } from "@/lib/types";
import type { PresetFormState } from "./media-preset-editor-types";

export function MediaPresetAvailabilityPanel({
  form,
  className,
  generatedPresetKey,
  models,
  onFormChange,
}: {
  form: PresetFormState;
  className: string;
  generatedPresetKey: string;
  models: MediaModelSummary[];
  onFormChange: (updater: (current: PresetFormState) => PresetFormState) => void;
}) {
  return (
    <div className={className}>
      <div className="admin-label-accent">
        Availability
      </div>
      <div className="mt-4 grid gap-4">
        <div className="grid gap-3 lg:grid-cols-2">
          <label className="admin-toggle-row text-sm">
            <span>Enable this preset</span>
            <AdminToggle
              checked={form.status === "active"}
              ariaLabel="Enable this preset"
              onToggle={() =>
                onFormChange((current) => ({
                  ...current,
                  status: current.status === "active" ? "inactive" : "active",
                }))
              }
            />
          </label>

          <div className="admin-summary-card text-sm">
            <div className="admin-label-muted">
              Snapshot
            </div>
            <div className="mt-2 leading-6 text-[var(--foreground)]">
              {generatedPresetKey || "pending key"} · {form.inputFields.length} text field{form.inputFields.length === 1 ? "" : "s"} · {form.imageSlots.length} image slot{form.imageSlots.length === 1 ? "" : "s"}
            </div>
          </div>
        </div>

        <div className="grid gap-2">
          <div className="admin-label-muted">
            Available in
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {models.map((model) => (
              <label
                key={model.key}
                className="admin-toggle-row text-sm"
              >
                <span>{model.label}</span>
                <AdminToggle
                  checked={form.appliesToModels.includes(model.key)}
                  ariaLabel={`Use preset in ${model.label}`}
                  onToggle={() =>
                    onFormChange((current) => ({
                      ...current,
                      appliesToModels: current.appliesToModels.includes(model.key)
                        ? current.appliesToModels.filter((value) => value !== model.key)
                        : Array.from(new Set([...current.appliesToModels, model.key])),
                    }))
                  }
                />
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
