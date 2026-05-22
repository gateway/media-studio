"use client";

import { AdminField, AdminInput, AdminTextarea, AdminToggle } from "@/components/admin-controls";
import { Panel, PanelHeader } from "@/components/panel";
import { defaultPromptRecipeImageInput, type PromptRecipeEditorDraft } from "@/lib/prompt-recipes";

export function PromptRecipeImageInputPanel({
  draft,
  onDraftChange,
}: {
  draft: PromptRecipeEditorDraft;
  onDraftChange: (updater: (current: PromptRecipeEditorDraft) => PromptRecipeEditorDraft) => void;
}) {
  return (
    <Panel className="p-5 sm:p-6">
      <PanelHeader
        eyebrow="Image Input"
        title="Image analysis settings"
        description="Configure whether this recipe expects an image analysis pass before the final prompt is assembled."
      />
      <div className="mt-5 grid gap-4">
        <div className="admin-row-surface justify-between p-4">
          <div>
            <div className="font-semibold text-[var(--foreground)]">Enable image input</div>
            <div className="text-sm text-[var(--muted-strong)]">
              Future graph nodes can use this to require or analyze attached images.
            </div>
          </div>
          <AdminToggle
            checked={draft.imageInput.enabled}
            ariaLabel="Toggle image input"
            onToggle={() =>
              onDraftChange((current) => ({
                ...current,
                imageInput: current.imageInput.enabled
                  ? defaultPromptRecipeImageInput()
                  : { ...current.imageInput, enabled: true, mode: "analyze_then_inject", max_files: 1 },
              }))
            }
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <AdminField label="Required">
            <select
              value={draft.imageInput.required ? "yes" : "no"}
              onChange={(event) =>
                onDraftChange((current) => ({
                  ...current,
                  imageInput: { ...current.imageInput, required: event.target.value === "yes" },
                }))
              }
              className="admin-input text-sm"
            >
              <option value="no">Optional</option>
              <option value="yes">Required</option>
            </select>
          </AdminField>
          <AdminField label="Mode">
            <select
              value={draft.imageInput.mode}
              onChange={(event) =>
                onDraftChange((current) => ({
                  ...current,
                  imageInput: { ...current.imageInput, mode: event.target.value },
                }))
              }
              className="admin-input text-sm"
            >
              <option value="none">None</option>
              <option value="analyze_then_inject">Analyze then inject</option>
              <option value="direct_reference">Direct reference</option>
              <option value="both">Both</option>
            </select>
          </AdminField>
          <AdminField label="Max Files">
            <AdminInput
              type="number"
              min={0}
              value={draft.imageInput.max_files}
              onChange={(event) =>
                onDraftChange((current) => ({
                  ...current,
                  imageInput: { ...current.imageInput, max_files: Number(event.target.value) },
                }))
              }
            />
          </AdminField>
        </div>
        <AdminField label="Analysis Variable">
          <AdminInput
            value={draft.imageInput.analysis_variable}
            onChange={(event) =>
              onDraftChange((current) => ({
                ...current,
                imageInput: { ...current.imageInput, analysis_variable: event.target.value },
              }))
            }
          />
        </AdminField>
        <AdminField label="Image Analysis Prompt">
          <AdminTextarea
            rows={5}
            value={draft.imageAnalysisPrompt ?? ""}
            onChange={(event) =>
              onDraftChange((current) => ({
                ...current,
                imageAnalysisPrompt: event.target.value,
              }))
            }
          />
        </AdminField>
      </div>
    </Panel>
  );
}
