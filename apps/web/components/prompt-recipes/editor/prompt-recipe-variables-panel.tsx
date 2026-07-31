"use client";

import { Plus, Trash2 } from "lucide-react";

import { AdminButton, AdminField, AdminInput, AdminToggle } from "@/components/admin-controls";
import { SectionDisclosure } from "@/components/collapsible-sections";
import {
  PROMPT_RECIPE_FIELD_INPUT_KINDS,
  PROMPT_RECIPE_FIELD_REFERENCE_ROLES,
  PROMPT_RECIPE_RESERVED_VARIABLE_KEYS,
  normalizePromptRecipeCustomField,
  slugifyPromptRecipeKey,
  type PromptRecipeEditorDraft,
} from "@/lib/prompt-recipes";
import type { PromptRecipeCustomField, PromptRecipeFieldInputKind, PromptRecipeFieldReferenceRole, PromptRecipeVariable } from "@/lib/types";

const GRAPH_INPUT_LABELS: Record<string, string> = {
  none: "No graph input",
  text: "Text input",
  image: "Image input",
};

const REFERENCE_ROLE_LABELS: Record<string, string> = {
  none: "No reference role",
  character: "Character",
  environment: "Environment",
  prop: "Prop",
  style: "Style",
  additional: "Additional",
  generic: "Generic",
};

function PromptRecipeGraphInputFields({
  inputKind,
  referenceRole,
  onChange,
}: {
  inputKind: PromptRecipeFieldInputKind | undefined;
  referenceRole: PromptRecipeFieldReferenceRole | undefined;
  onChange: (patch: { input_kind?: PromptRecipeFieldInputKind; reference_role?: PromptRecipeFieldReferenceRole }) => void;
}) {
  return (
    <>
      <AdminField label="Graph Input">
        <select
          value={inputKind ?? "none"}
          onChange={(event) => {
            const nextInputKind = event.target.value as PromptRecipeFieldInputKind;
            onChange({
              input_kind: nextInputKind,
              reference_role: nextInputKind === "image" ? referenceRole ?? "none" : "none",
            });
          }}
          className="admin-input text-sm"
        >
          {PROMPT_RECIPE_FIELD_INPUT_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {GRAPH_INPUT_LABELS[kind]}
            </option>
          ))}
        </select>
      </AdminField>
      {inputKind === "image" ? (
        <AdminField label="Reference Role">
          <select
            value={referenceRole ?? "none"}
            onChange={(event) => onChange({ reference_role: event.target.value as PromptRecipeFieldReferenceRole })}
            className="admin-input text-sm"
          >
            {PROMPT_RECIPE_FIELD_REFERENCE_ROLES.map((role) => (
              <option key={role} value={role}>
                {REFERENCE_ROLE_LABELS[role]}
              </option>
            ))}
          </select>
        </AdminField>
      ) : null}
    </>
  );
}

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
  const customFields = draft.customFields ?? [];
  const recipeVariables = draft.variables.filter((variable) => !PROMPT_RECIPE_RESERVED_VARIABLE_KEYS.has(variable.key));
  const reservedVariables = draft.variables.filter((variable) => PROMPT_RECIPE_RESERVED_VARIABLE_KEYS.has(variable.key));
  const recipeFieldCount = customFields.length + recipeVariables.length;
  const graphBackedRecipeFieldCount =
    customFields.filter((field) => field.input_kind && field.input_kind !== "none").length +
    recipeVariables.filter((variable) => variable.input_kind && variable.input_kind !== "none").length;

  return (
    <section className="surface-card grid gap-5 px-5 py-5 text-[var(--foreground)] sm:px-6 sm:py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <h2 className="text-[1.2rem] font-semibold tracking-[-0.03em] text-[var(--foreground)]">Recipe fields</h2>
          <p className="max-w-3xl text-[0.94rem] leading-6 text-[var(--muted-strong)]">
            These are the user-facing fields unique to this recipe. Use Graph Input only when a field should accept an upstream node value.
          </p>
          <div className="text-base font-semibold text-[var(--foreground)]">
            {recipeFieldCount} recipe fields
            {graphBackedRecipeFieldCount ? ` · ${graphBackedRecipeFieldCount} graph-backed` : ""}
          </div>
        </div>
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

      <div className="grid gap-3">
        {recipeFieldCount ? (
          <>
            {recipeVariables.map((variable) => (
              <div key={variable.key} className="admin-surface-inset grid gap-3 p-4">
                <div className="grid gap-3 md:grid-cols-5">
                  <AdminField label="Key">
                    <AdminInput value={variable.key} disabled />
                  </AdminField>
                  <AdminField label="Label">
                    <AdminInput value={variable.label} onChange={(event) => onUpdateVariable(variable.key, { label: event.target.value })} />
                  </AdminField>
                  <AdminField label="Default Value">
                    <AdminInput value={String(variable.default_value ?? "")} onChange={(event) => onUpdateVariable(variable.key, { default_value: event.target.value })} />
                  </AdminField>
                  <AdminField label="Required">
                    <select
                      value={variable.required ? "yes" : "no"}
                      onChange={(event) => onUpdateVariable(variable.key, { required: event.target.value === "yes" })}
                      className="admin-input text-sm"
                    >
                      <option value="no">Optional</option>
                      <option value="yes">Required</option>
                    </select>
                  </AdminField>
                  <PromptRecipeGraphInputFields
                    inputKind={variable.input_kind}
                    referenceRole={variable.reference_role}
                    onChange={(patch) => onUpdateVariable(variable.key, patch)}
                  />
                </div>
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_64px] md:items-end">
                  <AdminField label="Description">
                    <AdminInput value={variable.description ?? ""} onChange={(event) => onUpdateVariable(variable.key, { description: event.target.value })} />
                  </AdminField>
                  <div className="flex justify-end">
                    <AdminToggle checked={Boolean(variable.enabled)} ariaLabel={`Toggle ${variable.key}`} onToggle={() => onUpdateVariable(variable.key, { enabled: !variable.enabled })} />
                  </div>
                </div>
              </div>
            ))}
            {customFields.map((field, index) => (
              <div key={index} className="admin-surface-inset grid gap-3 p-4">
                <div className="grid gap-3 md:grid-cols-5">
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
                  <PromptRecipeGraphInputFields
                    inputKind={field.input_kind}
                    referenceRole={field.reference_role}
                    onChange={(patch) => onUpdateCustomField(index, patch)}
                  />
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
          </>
        ) : (
          <div className="admin-surface-inset p-4 text-sm leading-6 text-[var(--muted-strong)]">
            No recipe fields yet. Add fields when this recipe needs user-facing options beyond the standard prompt input.
          </div>
        )}
      </div>

      <SectionDisclosure
        title="Advanced graph inputs"
        description="Reserved variables cover common graph inputs shared across Prompt Recipe nodes."
        summary={`${reservedVariables.length} reserved inputs`}
        detail="Most recipes should leave this collapsed unless you are changing low-level graph wiring."
        defaultOpen={false}
        className="px-0 py-0"
        bodyClassName="grid gap-4"
      >
        <p className="text-sm text-[var(--muted-strong)]">
          These controls create field-level handles for shared graph variables such as source prompt, previous output, or continuation text. They are separate from this recipe&apos;s user-facing custom fields.
        </p>
        <div className="grid gap-3">
          {reservedVariables.map((variable) => (
            <div key={variable.key} className="admin-surface-inset grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_minmax(150px,180px)_minmax(150px,180px)_minmax(112px,140px)_64px] md:items-center">
              <div>
                <div className="font-semibold text-[var(--foreground)]">{variable.label}</div>
                <div className="text-sm text-[var(--muted-strong)]">
                  {`{{${variable.key}}}`} {variable.description ? `- ${variable.description}` : ""}
                </div>
              </div>
              <PromptRecipeGraphInputFields
                inputKind={variable.input_kind}
                referenceRole={variable.reference_role}
                onChange={(patch) => onUpdateVariable(variable.key, patch)}
              />
              {variable.input_kind !== "image" ? <div className="hidden md:block" aria-hidden="true" /> : null}
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
      </SectionDisclosure>
    </section>
  );
}
