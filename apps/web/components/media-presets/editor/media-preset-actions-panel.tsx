"use client";

import { AdminButton, AdminTextarea } from "@/components/admin-controls";
import { AdminEditorActionBar } from "@/components/admin-editor-action-bar";
import type { PresetFormState } from "./media-preset-editor-types";

export function MediaPresetActionsPanel({
  form,
  className,
  isSaving,
  isExporting,
  onFormChange,
  onSave,
  onArchive,
  onExport,
}: {
  form: PresetFormState;
  className: string;
  isSaving: boolean;
  isExporting: boolean;
  onFormChange: (updater: (current: PresetFormState) => PresetFormState) => void;
  onSave: () => void;
  onArchive: () => void;
  onExport: () => void;
}) {
  return (
    <div className={className}>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
        <div>
          <div className="admin-label-muted">
            Notes
          </div>
          <AdminTextarea
            value={form.notes}
            onChange={(event) => onFormChange((current) => ({ ...current, notes: event.target.value }))}
            placeholder="Notes for operators, edge cases, or anything the next person should know."
            className="mt-3 min-h-[96px]"
          />
        </div>
        <AdminEditorActionBar className="grid w-full gap-3 sm:flex sm:w-auto sm:flex-wrap xl:justify-end">
          {form.presetId ? (
            <AdminButton
              onClick={onExport}
              disabled={isExporting}
              className="w-full sm:w-auto"
            >
              {isExporting ? "Exporting..." : "Export Preset"}
            </AdminButton>
          ) : null}
          <AdminButton
            onClick={onSave}
            disabled={isSaving}
            className="w-full sm:w-auto"
          >
            {form.presetId ? "Save preset" : "Create preset"}
          </AdminButton>
          {form.presetId ? (
            <AdminButton
              onClick={onArchive}
              variant="danger"
              className="w-full px-4 py-3 text-sm normal-case tracking-normal sm:w-auto"
            >
              Archive
            </AdminButton>
          ) : null}
        </AdminEditorActionBar>
      </div>
    </div>
  );
}
