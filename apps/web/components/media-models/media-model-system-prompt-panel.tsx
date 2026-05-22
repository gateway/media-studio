"use client";

import { AdminButton, AdminTextarea, AdminToggle } from "@/components/admin-controls";
import { CollapsibleSubsection } from "@/components/collapsible-sections";
import { Panel, PanelHeader } from "@/components/panel";
import type { EnhancementProfileFormState } from "@/components/media-models/media-models-console-types";

type MediaModelSystemPromptPanelProps = {
  form: EnhancementProfileFormState;
  onChange: (patch: Partial<EnhancementProfileFormState>) => void;
  onSave: () => void;
};

export function MediaModelSystemPromptPanel({
  form,
  onChange,
  onSave,
}: MediaModelSystemPromptPanelProps) {
  return (
    <Panel>
      <PanelHeader
        eyebrow="System Prompt"
        title="System Prompt"
        description="Define how Enhance should rewrite prompts for the selected model."
      />
      <div className="mt-5">
        <CollapsibleSubsection
          title="Prompt Instructions"
          description="Use this section to teach Enhance how prompts should be rewritten for this model so the final prompt matches how the model performs best."
          tone="media"
          defaultOpen={false}
          className="px-5 py-5"
          summaryClassName="flex-col items-start gap-3 sm:flex-row sm:items-center"
          titleClassName="text-[0.78rem] tracking-[0.16em]"
          descriptionClassName="max-w-3xl"
          bodyClassName="border-t border-[var(--surface-border-soft)] pt-5"
        >
          <div className="grid max-w-[860px] gap-2">
            <div className="admin-label-muted">Prompt rewrite instructions</div>
            <div className="text-sm leading-6 text-[var(--muted-strong)]">
              Add the system prompt you want to use for this model, based on the model specs, research, and prompt guides you trust. Use <span className="font-medium text-[var(--foreground)]">{"{user_prompt}"}</span> anywhere you want Studio to inject the operator&apos;s prompt before it is sent to the LLM for prompt enhancement.
            </div>
            <AdminTextarea
              value={form.systemPrompt}
              onChange={(event) => onChange({ systemPrompt: event.target.value })}
              placeholder="Explain how prompts should be rewritten for this model."
              className="min-h-[160px]"
            />
          </div>
          <div className="mt-4 grid max-w-[860px] gap-2">
            <div className="admin-label-muted">Image understanding instructions</div>
            <div className="text-sm leading-6 text-[var(--muted-strong)]">
              Explain how an attached image should be read and combined with the written prompt when building the final prompt.
            </div>
            <AdminTextarea
              value={form.imageAnalysisPrompt}
              onChange={(event) => onChange({ imageAnalysisPrompt: event.target.value })}
              placeholder="Explain how the image should be interpreted for this model."
              className="min-h-[96px]"
            />
          </div>
          <div className="mt-4 grid max-w-[860px] gap-3 lg:grid-cols-2">
            <label className="admin-toggle-row text-sm">
              <span>Rewrite prompts for this model</span>
              <AdminToggle
                checked={form.supportsTextEnhancement}
                ariaLabel="Rewrite prompts for this model"
                onToggle={() => onChange({ supportsTextEnhancement: !form.supportsTextEnhancement })}
              />
            </label>
            <label className="admin-toggle-row text-sm">
              <span>Use attached images to guide enhancement</span>
              <AdminToggle
                checked={form.supportsImageAnalysis}
                ariaLabel="Use attached images during enhancement"
                onToggle={() => onChange({ supportsImageAnalysis: !form.supportsImageAnalysis })}
              />
            </label>
          </div>
          <div className="mt-4 max-w-[860px]">
            <AdminTextarea
              value={form.notes}
              onChange={(event) => onChange({ notes: event.target.value })}
              placeholder="Optional notes for this model"
              className="min-h-[84px]"
            />
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <AdminButton onClick={onSave}>Save system prompt</AdminButton>
          </div>
        </CollapsibleSubsection>
      </div>
    </Panel>
  );
}
