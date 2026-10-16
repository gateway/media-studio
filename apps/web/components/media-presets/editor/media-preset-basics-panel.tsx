"use client";

import { useState, type RefObject } from "react";

import { AdminField, AdminInput, AdminSelect, AdminTextarea } from "@/components/admin-controls";
import { MEDIA_PRESET_CATEGORY_OPTIONS } from "@/lib/media-preset-categories";
import type { PresetFormState } from "./media-preset-editor-types";

export function MediaPresetBasicsPanel({
  form,
  className,
  presetNameInputRef,
  onFormChange,
}: {
  form: PresetFormState;
  className: string;
  presetNameInputRef: RefObject<HTMLInputElement | null>;
  onFormChange: (updater: (current: PresetFormState) => PresetFormState) => void;
}) {
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  return (
    <div className={className}>
      <div className="mb-4">
        <div className="admin-label-accent">
          Preset Basics
        </div>
        <p className="mt-2 text-sm leading-7 text-[var(--muted-strong)]">
          Define the operator-facing identity for this preset first, then configure how it should appear in Studio.
        </p>
      </div>
      <div className="grid gap-3">
        <AdminField label="Name">
        <AdminInput
          ref={presetNameInputRef}
          value={form.label}
          onChange={(event) =>
            onFormChange((current) => ({
              ...current,
              label: event.target.value,
              key: current.presetId ? current.key : "",
            }))
          }
          placeholder="Preset name"
        />
        </AdminField>
        <AdminField label="Description">
        <AdminTextarea
          value={form.description}
          onChange={(event) => onFormChange((current) => ({ ...current, description: event.target.value }))}
          placeholder="Short description of what this preset does"
          className="min-h-[96px] sm:min-h-[108px]"
        />
        </AdminField>
        <div className="grid gap-2">
          <div className="admin-field-label">Category</div>
          <AdminSelect
            pickerId="media-preset-category"
            open={categoryPickerOpen}
            onToggle={() => setCategoryPickerOpen((value) => !value)}
            value={form.category}
            choices={[...MEDIA_PRESET_CATEGORY_OPTIONS]}
            onSelect={(value) => {
              onFormChange((current) => ({ ...current, category: value }));
              setCategoryPickerOpen(false);
            }}
          />
        </div>

      </div>
    </div>
  );
}
