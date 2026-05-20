"use client";

import { AdminField, AdminInput, AdminTextarea, AdminToggle } from "@/components/admin-controls";
import { SectionDisclosure } from "@/components/collapsible-sections";
import type { PromptRecipeEditorDraft } from "@/lib/prompt-recipes";

export function PromptRecipeContractPanel({
  draft,
  parsedDefaultOptions,
  parsedRules,
  onPatchDefaultOptions,
  onPatchRules,
  onDraftChange,
}: {
  draft: PromptRecipeEditorDraft;
  parsedDefaultOptions: Record<string, unknown>;
  parsedRules: Record<string, unknown>;
  onPatchDefaultOptions: (patch: Record<string, unknown>) => void;
  onPatchRules: (patch: Record<string, unknown>) => void;
  onDraftChange: (updater: (current: PromptRecipeEditorDraft) => PromptRecipeEditorDraft) => void;
}) {
  return (
    <section className="surface-card text-[var(--foreground)] px-0 py-0">
      <SectionDisclosure
        title="Output contract and runtime defaults"
        description="Stored metadata for future graph-node ingestion. JSON is validated before save."
        summary="Runtime defaults, rules, contract JSON, and editor notes"
        detail="Collapse this unless you are shaping the execution contract or advanced defaults."
        defaultOpen={false}
        className="px-5 py-5 sm:px-6 sm:py-6"
        bodyClassName="grid gap-4"
      >
        <div className="admin-surface-accent grid gap-4 p-4 sm:p-5">
          <div className="admin-label-accent">Common Runtime Options</div>
          <div className="grid gap-3 md:grid-cols-3">
            <AdminField label="Temperature">
              <AdminInput
                type="number"
                min={0}
                max={2}
                step={0.05}
                value={Number(parsedDefaultOptions.temperature ?? 0.4)}
                onChange={(event) => onPatchDefaultOptions({ temperature: Number(event.target.value) })}
              />
            </AdminField>
            <AdminField label="Max Output Tokens">
              <AdminInput
                type="number"
                min={1}
                value={Number(parsedDefaultOptions.max_output_tokens ?? 1500)}
                onChange={(event) => onPatchDefaultOptions({ max_output_tokens: Number(event.target.value) })}
              />
            </AdminField>
            <AdminField label="Strict Output">
              <select
                value={parsedDefaultOptions.strict_output === false ? "no" : "yes"}
                onChange={(event) => onPatchDefaultOptions({ strict_output: event.target.value === "yes" })}
                className="admin-input text-sm"
              >
                <option value="yes">Strict</option>
                <option value="no">Flexible</option>
              </select>
            </AdminField>
          </div>
        </div>
        <div className="admin-surface-accent grid gap-4 p-4 sm:p-5">
          <div className="admin-label-accent">Common Rules</div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {[
              { key: "return_only_final_output", label: "Final output only", defaultValue: true },
              { key: "allow_markdown", label: "Allow markdown", defaultValue: false },
              { key: "allow_json", label: "Allow JSON", defaultValue: false },
              { key: "validate_json_output", label: "Validate JSON later", defaultValue: false },
              { key: "allow_external_variables", label: "External variables", defaultValue: true },
            ].map(({ key, label, defaultValue }) => (
              <div key={key} className="admin-row-surface justify-between gap-3 p-3">
                <span className="text-sm font-semibold text-[var(--foreground)]">{label}</span>
                <AdminToggle
                  checked={Boolean(parsedRules[key] ?? defaultValue)}
                  ariaLabel={`Toggle ${label}`}
                  onToggle={() => onPatchRules({ [key]: !Boolean(parsedRules[key] ?? defaultValue) })}
                />
              </div>
            ))}
          </div>
        </div>
        <AdminField label="Output Contract JSON">
          <AdminTextarea
            rows={7}
            value={draft.outputContractText}
            onChange={(event) =>
              onDraftChange((current) => ({
                ...current,
                outputContractText: event.target.value,
              }))
            }
            spellCheck={false}
          />
        </AdminField>
        <AdminField label="Default Options JSON">
          <AdminTextarea
            rows={5}
            value={draft.defaultOptionsText}
            onChange={(event) =>
              onDraftChange((current) => ({
                ...current,
                defaultOptionsText: event.target.value,
              }))
            }
            spellCheck={false}
          />
        </AdminField>
        <AdminField label="Rules JSON">
          <AdminTextarea
            rows={5}
            value={draft.rulesText}
            onChange={(event) =>
              onDraftChange((current) => ({
                ...current,
                rulesText: event.target.value,
              }))
            }
            spellCheck={false}
          />
        </AdminField>
        <AdminField label="Notes">
          <AdminTextarea
            rows={4}
            value={draft.notes ?? ""}
            onChange={(event) =>
              onDraftChange((current) => ({
                ...current,
                notes: event.target.value,
              }))
            }
          />
        </AdminField>
      </SectionDisclosure>
    </section>
  );
}
