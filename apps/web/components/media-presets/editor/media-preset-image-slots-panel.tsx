"use client";

import { AdminButton, AdminInput, AdminToggle } from "@/components/admin-controls";
import { CollapsibleSubsection } from "@/components/collapsible-sections";
import type { PresetFormState } from "./media-preset-editor-types";
import {
  createPresetImageSlot,
  normalizePresetFieldKey,
  presetSlotKeyToken,
} from "./media-preset-editor-utils";

export function MediaPresetImageSlotsPanel({
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
            Reference image slots
          </div>
          <div className="mt-1 text-sm text-[var(--muted-strong)]">
            Each slot becomes one named image requirement in Studio.
          </div>
        </div>
        <AdminButton
          onClick={() =>
            onFormChange((current) => ({
              ...current,
              imageSlots: [...current.imageSlots, createPresetImageSlot()],
            }))
          }
          size="compact"
        >
          Add Image Slot
        </AdminButton>
      </div>
      {form.imageSlots.length ? (
        <div className="mt-4 grid gap-3">
          {form.imageSlots.map((slot, index) => (
            <CollapsibleSubsection
              key={slot.id}
              title={`Image slot ${index + 1}`}
              description="Define the slot key, label, help text, and whether the image is required."
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
                      imageSlots: current.imageSlots.filter((entry) => entry.id !== slot.id),
                    }))
                  }
                >
                  Remove
                </AdminButton>
              }
            >
              <div className="text-sm text-[var(--muted-strong)]">
                Use the slot key in the prompt as <span className="font-medium text-[var(--foreground)]">{presetSlotKeyToken(normalizePresetFieldKey(slot.key) || "image_slot_key")}</span>.
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <AdminInput
                  value={slot.key}
                  onChange={(event) =>
                    onFormChange((current) => ({
                      ...current,
                      imageSlots: current.imageSlots.map((entry) =>
                        entry.id === slot.id
                          ? { ...entry, key: normalizePresetFieldKey(event.target.value) }
                          : entry,
                      ),
                    }))
                  }
                  placeholder="slot key"
                />
                <AdminInput
                  value={slot.label}
                  onChange={(event) =>
                    onFormChange((current) => ({
                      ...current,
                      imageSlots: current.imageSlots.map((entry) =>
                        entry.id === slot.id ? { ...entry, label: event.target.value } : entry,
                      ),
                    }))
                  }
                  placeholder="Slot label"
                />
                <AdminInput
                  value={String(slot.maxFiles)}
                  onChange={(event) =>
                    onFormChange((current) => ({
                      ...current,
                      imageSlots: current.imageSlots.map((entry) =>
                        entry.id === slot.id
                          ? { ...entry, maxFiles: Math.max(1, Number(event.target.value) || 1) }
                          : entry,
                      ),
                    }))
                  }
                  placeholder="1"
                />
                <AdminInput
                  value={slot.helpText}
                  onChange={(event) =>
                    onFormChange((current) => ({
                      ...current,
                      imageSlots: current.imageSlots.map((entry) =>
                        entry.id === slot.id ? { ...entry, helpText: event.target.value } : entry,
                      ),
                    }))
                  }
                  placeholder="Help text shown to the operator"
                />
              </div>
              <label className="admin-toggle-row text-sm">
                <span>Required image</span>
                <AdminToggle
                  checked={slot.required}
                  ariaLabel={`Required image slot ${index + 1}`}
                  onToggle={() =>
                    onFormChange((current) => ({
                      ...current,
                      imageSlots: current.imageSlots.map((entry) =>
                        entry.id === slot.id ? { ...entry, required: !entry.required } : entry,
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
          No image slots configured yet.
        </div>
      )}
    </div>
  );
}
