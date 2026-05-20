"use client";

import { Plus, Trash2 } from "lucide-react";

import { AdminButton, AdminField, AdminInput, AdminToggle } from "@/components/admin-controls";
import { SectionDisclosure } from "@/components/collapsible-sections";
import { normalizePromptRecipeCustomField, slugifyPromptRecipeKey, type PromptRecipeEditorDraft } from "@/lib/prompt-recipes";
import type { PromptRecipeCustomField, PromptRecipeVariable } from "@/lib/types";

export function PromptRecipeVariablesPanel({
  draft,
  onUpdateVariable,
  onUpdateCustomField,
  onDraftChange,
}: {
  draft: PromptRecipeEditorDraft;
  onUpdateVariable: (key: string, patch: Partial<PromptRecipeVariable>) => void;
  onUpdateCustomField: (index: number, patch: Partial<PromptRecipeCustomField>) => void;
  onDraftChange: (updater: (current: PromptRecipeEditorDraft) => PromptRecipeEditorDraft) => void;
}) {
  return (
    <section className="surface-card text-[var(--foreground)] px-0 py-0">
      <SectionDisclosure
        title="Reserved inputs and custom fields"
        description="Reserved variables cover common graph inputs. Custom fields are additional values unique to this recipe."
        summary={`${draft.variables.length} reserved inputs and ${(draft.customFields ?? []).length} custom fields`}
        detail="Collapse this unless you are shaping the recipe contract."
        defaultOpen={false}
        className="px-5 py-5 sm:px-6 sm:py-6"
        bodyClassName="grid gap-6"
      >
        <div className="grid gap-3">
          {draft.variables.map((variable) => (
            <div key={variable.key} className="admin-surface-inset grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_minmax(112px,140px)_64px] md:items-center">
              <div>
                <div className="font-semibold text-[var(--foreground)]">{variable.label}</div>
                <div className="text-sm text-[var(--muted-strong)]">
                  {`{{${variable.key}}}`} {variable.description ? `- ${variable.description}` : ""}
                </div>
              </div>
              <label className="flex items-center justify-end gap-2 whitespace-nowrap text-right text-sm text-[var(--muted-strong)]">
                <input type="checkbox" checked={Boolean(variable.required)} onChange={(event) => onUpdateVariable(variable.key, { required: event.target.checked })} />
                Required
              </label>
              <div className="flex justify-end">
                <AdminToggle checked={Boolean(variable.enabled)} ariaLabel={`Toggle ${variable.key}`} onToggle={() => onUpdateVariable(variable.key, { enabled: !variable.enabled })} />
              </div>
            </div>
          ))}
        </div>

        <div className="grid gap-3">
          <div className="flex items-center justify-between gap-3">
            <div className="admin-label-accent">Custom Fields</div>
            <AdminButton
              variant="subtle"
              size="compact"
              onClick={() =>
                onDraftChange((current) => ({
                  ...current,
                  customFields: [...current.customFields, normalizePromptRecipeCustomField({ type: "text" })],
                }))
              }
            >
              <Plus className="size-3.5" />
              Add Field
            </AdminButton>
          </div>
          {draft.customFields.map((field, index) => (
            <div key={index} className="admin-surface-inset grid gap-3 p-4">
              <div className="grid gap-3 md:grid-cols-4">
                <AdminField label="Key">
                  <AdminInput value={field.key} onChange={(event) => onUpdateCustomField(index, { key: slugifyPromptRecipeKey(event.target.value) })} />
                </AdminField>
                <AdminField label="Label">
                  <AdminInput value={field.label} onChange={(event) => onUpdateCustomField(index, { label: event.target.value })} />
                </AdminField>
                <AdminField label="Type">
                  <select value={field.type} onChange={(event) => onUpdateCustomField(index, { type: event.target.value })} className="admin-input text-sm">
                    <option value="text">Text</option>
                    <option value="textarea">Textarea</option>
                    <option value="number">Number</option>
                    <option value="select">Select</option>
                    <option value="boolean">Boolean</option>
                  </select>
                </AdminField>
                <AdminField label="Required">
                  <select value={field.required ? "yes" : "no"} onChange={(event) => onUpdateCustomField(index, { required: event.target.value === "yes" })} className="admin-input text-sm">
                    <option value="no">Optional</option>
                    <option value="yes">Required</option>
                  </select>
                </AdminField>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <AdminField label="Placeholder">
                  <AdminInput value={field.placeholder ?? ""} onChange={(event) => onUpdateCustomField(index, { placeholder: event.target.value })} />
                </AdminField>
                <AdminField label="Default Value">
                  <AdminInput value={String(field.default_value ?? "")} onChange={(event) => onUpdateCustomField(index, { default_value: event.target.value })} />
                </AdminField>
                <AdminField label="Options">
                  <AdminInput value={(field.options ?? []).join(", ")} onChange={(event) => onUpdateCustomField(index, { options: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} />
                </AdminField>
              </div>
              <div className="flex justify-end">
                <AdminButton
                  variant="danger"
                  size="compact"
                  onClick={() =>
                    onDraftChange((current) => ({
                      ...current,
                      customFields: current.customFields.filter((_, fieldIndex) => fieldIndex !== index),
                    }))
                  }
                >
                  <Trash2 className="size-3.5" />
                  Remove Field
                </AdminButton>
              </div>
            </div>
          ))}
        </div>
      </SectionDisclosure>
    </section>
  );
}
