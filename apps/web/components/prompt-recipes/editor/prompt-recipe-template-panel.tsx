"use client";

import { AdminField, AdminTextarea } from "@/components/admin-controls";
import { Panel, PanelHeader } from "@/components/panel";
import { PROMPT_RECIPE_OUTPUT_FORMATS, type PromptRecipeEditorDraft } from "@/lib/prompt-recipes";

export function PromptRecipeTemplatePanel({
  draft,
  detectedVariables,
  draftWarnings,
  validationError,
  lastDraftWarnings,
  onDraftChange,
}: {
  draft: PromptRecipeEditorDraft;
  detectedVariables: string[];
  draftWarnings: string[];
  validationError: string | null;
  lastDraftWarnings: string[];
  onDraftChange: (updater: (current: PromptRecipeEditorDraft) => PromptRecipeEditorDraft) => void;
}) {
  return (
    <Panel className="p-5 sm:p-6">
      <PanelHeader
        eyebrow="Prompt Template"
        title="System prompt"
        description="Use {{variable_key}} tokens for values that future graph nodes can inject."
      />
      <div className="mt-5 grid gap-4">
        <AdminField label="System Prompt Template">
          <AdminTextarea
            rows={14}
            value={draft.template}
            onChange={(event) =>
              onDraftChange((current) => ({
                ...current,
                template: event.target.value,
              }))
            }
          />
        </AdminField>
        <div className="admin-surface-inset p-3 text-sm text-[var(--muted-strong)]">
          <span className="font-semibold text-[var(--foreground)]">Detected variables: </span>
          {detectedVariables.length ? detectedVariables.join(", ") : "none"}
        </div>
        {validationError ? (
          <div className="admin-danger-callout p-3 text-sm">
            <div className="font-semibold text-[var(--foreground)]">Fix before saving</div>
            <p className="mt-2 text-[var(--muted-strong)]">{validationError}</p>
          </div>
        ) : null}
        {draftWarnings.length ? (
          <div className="admin-danger-callout p-3 text-sm">
            <div className="font-semibold text-[var(--foreground)]">Validation guidance</div>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[var(--muted-strong)]">
              {draftWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {lastDraftWarnings.length ? (
          <div className="admin-surface-inset p-3 text-sm">
            <div className="font-semibold text-[var(--foreground)]">Server draft review</div>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[var(--muted-strong)]">
              {lastDraftWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <AdminField label="Output Format">
          <select
            value={draft.outputFormat}
            onChange={(event) =>
              onDraftChange((current) => ({
                ...current,
                outputFormat: event.target.value,
              }))
            }
            className="admin-input text-sm"
          >
            {PROMPT_RECIPE_OUTPUT_FORMATS.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </AdminField>
      </div>
    </Panel>
  );
}
