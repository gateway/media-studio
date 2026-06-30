"use client";

import { AdminTextarea } from "@/components/admin-controls";
import type { PresetFormState } from "./media-preset-editor-types";

export function MediaPresetPromptPanel({
  form,
  className,
  onFormChange,
}: {
  form: PresetFormState;
  className: string;
  onFormChange: (updater: (current: PresetFormState) => PresetFormState) => void;
}) {
  return (
    <div className={className}>
      <div className="admin-label-accent">
        Prompt Template
      </div>
      <p className="mt-2 text-sm leading-7 text-[var(--muted-strong)]">
        Use <span className="font-medium text-[var(--foreground)]">{"{{field_key}}"}</span> for text fields and{" "}
        <span className="font-medium text-[var(--foreground)]">{"[[image_slot_key]]"}</span> for image slots.
      </p>
      <div className="mt-4">
        <AdminTextarea
          value={form.promptTemplate}
          onChange={(event) => onFormChange((current) => ({ ...current, promptTemplate: event.target.value }))}
          placeholder="Write the final prompt template using {{field_key}} and [[image_slot_key]]."
          className="min-h-[180px] sm:min-h-[220px]"
        />
      </div>
      <div className="admin-summary-card mt-4 p-3.5 sm:p-4">
        <div className="admin-label-muted">
          Token rules
        </div>
        <div className="mt-3 space-y-3 text-sm leading-7 text-[var(--muted-strong)]">
          <p>Every configured text field must appear in the prompt template.</p>
          <p>Every configured image slot must appear in the prompt template.</p>
          <p>Unused fields or slots will block saving.</p>
        </div>
      </div>
    </div>
  );
}
