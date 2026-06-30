"use client";

import { AdminButton, AdminInput, AdminToggle } from "@/components/admin-controls";
import { CollapsibleSubsection } from "@/components/collapsible-sections";
import type { PresetFormState } from "./media-preset-editor-types";
import {
  createPresetFieldInput,
  normalizePresetFieldKey,
  presetFieldKeyToken,
} from "./media-preset-editor-utils";

export function MediaPresetTextFieldsPanel({
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
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="admin-label-muted">
            Text fields
          </div>
          <div className="mt-1 text-sm text-[var(--muted-strong)]">
            Single-line text fields only.
          </div>
        </div>
        <AdminButton
          onClick={() =>
            onFormChange((current) => ({
              ...current,
              inputFields: [...current.inputFields, createPresetFieldInput()],
            }))
          }
          size="compact"
        >
          Add Text Field
        </AdminButton>
      </div>
      {form.inputFields.length ? (
        <div className="mt-4 grid gap-3">
          {form.inputFields.map((field, index) => (
            <CollapsibleSubsection
              key={field.id}
              title={`Field ${index + 1}`}
              description="Define the key, label, placeholder, and whether the field is required."
              tone="media"
              defaultOpen
              className="px-4 py-4"
              bodyClassName="admin-form-stack border-t border-[var(--surface-border-soft)] pt-4"
              badge={
                <AdminButton
                  size="compact"
                  onClick={() =>
                    onFormChange((current) => ({
                      ...current,
                      inputFields: current.inputFields.filter((entry) => entry.id !== field.id),
                    }))
                  }
                >
                  Remove
                </AdminButton>
              }
            >
              <div className="text-sm text-[var(--muted-strong)]">
                Use the field key in the prompt as <span className="font-medium text-[var(--foreground)]">{presetFieldKeyToken(normalizePresetFieldKey(field.key) || "field_key")}</span>.
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <AdminInput
                  value={field.key}
                  onChange={(event) =>
                    onFormChange((current) => ({
                      ...current,
                      inputFields: current.inputFields.map((entry) =>
                        entry.id === field.id
                          ? { ...entry, key: normalizePresetFieldKey(event.target.value) }
                          : entry,
                      ),
                    }))
                  }
                  placeholder="field key"
                />
                <AdminInput
                  value={field.label}
                  onChange={(event) =>
                    onFormChange((current) => ({
                      ...current,
                      inputFields: current.inputFields.map((entry) =>
                        entry.id === field.id ? { ...entry, label: event.target.value } : entry,
                      ),
                    }))
                  }
                  placeholder="Field label"
                />
                <AdminInput
                  value={field.placeholder}
                  onChange={(event) =>
                    onFormChange((current) => ({
                      ...current,
                      inputFields: current.inputFields.map((entry) =>
                        entry.id === field.id ? { ...entry, placeholder: event.target.value } : entry,
                      ),
                    }))
                  }
                  placeholder="Placeholder text"
                />
                <AdminInput
                  value={field.defaultValue}
                  onChange={(event) =>
                    onFormChange((current) => ({
                      ...current,
                      inputFields: current.inputFields.map((entry) =>
                        entry.id === field.id ? { ...entry, defaultValue: event.target.value } : entry,
                      ),
                    }))
                  }
                  placeholder="Optional default value"
                />
              </div>
              <label className="admin-toggle-row text-sm">
                <span>Required field</span>
                <AdminToggle
                  checked={field.required}
                  ariaLabel={`Required field ${index + 1}`}
                  onToggle={() =>
                    onFormChange((current) => ({
                      ...current,
                      inputFields: current.inputFields.map((entry) =>
                        entry.id === field.id ? { ...entry, required: !entry.required } : entry,
                      ),
                    }))
                  }
                />
              </label>
            </CollapsibleSubsection>
          ))}
        </div>
      ) : (
        <div className="admin-empty-state mt-4 text-sm">
          No text fields configured yet.
        </div>
      )}
    </div>
  );
}
