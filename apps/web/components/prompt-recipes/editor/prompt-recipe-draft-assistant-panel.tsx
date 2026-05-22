"use client";

import Link from "next/link";

import { AdminButton, AdminField, AdminInput, AdminTextarea, adminButtonClassName } from "@/components/admin-controls";
import { SectionDisclosure } from "@/components/collapsible-sections";
import { Panel } from "@/components/panel";
import {
  providerCatalogLoadHint,
  providerCatalogStatusDetail,
  providerCatalogSearchPlaceholder,
  providerModelChoices,
  sharedProviderKindOptions,
  type SharedProviderCatalogState,
} from "@/lib/llm-provider-models";
import { SETTINGS_LLM_ROUTE, type SharedLlmProviderKind } from "@/lib/llm-provider-metadata";
import type { PromptRecipeDraftingConfig } from "@/lib/types";

export function PromptRecipeDraftAssistantPanel({
  initialDraftingConfig,
  draftIdea,
  onDraftIdeaChange,
  providerKind,
  onProviderKindChange,
  modelId,
  onModelIdChange,
  openRouterQuery,
  onOpenRouterQueryChange,
  activeCatalog,
  catalogEntry,
  onRefreshModels,
  draftingModelSummary,
  isGeneratingDraft,
  canUseSavedDraftingDefault,
  activeDraftOverride,
  onGenerateDraft,
}: {
  initialDraftingConfig: PromptRecipeDraftingConfig | null;
  draftIdea: string;
  onDraftIdeaChange: (value: string) => void;
  providerKind: SharedLlmProviderKind;
  onProviderKindChange: (providerKind: SharedLlmProviderKind) => void;
  modelId: string;
  onModelIdChange: (modelId: string) => void;
  openRouterQuery: string;
  onOpenRouterQueryChange: (value: string) => void;
  activeCatalog: import("@/lib/types").MediaEnhancementProviderModel[];
  catalogEntry: SharedProviderCatalogState | null;
  onRefreshModels: () => void;
  draftingModelSummary: string | null;
  isGeneratingDraft: boolean;
  canUseSavedDraftingDefault: boolean;
  activeDraftOverride: string;
  onGenerateDraft: () => void;
}) {
  const draftingEnabled = initialDraftingConfig?.enabled !== false;
  return (
    <Panel className="p-0">
      <SectionDisclosure
        title="Generate from an idea"
        description="Describe the recipe you want. Media Studio will draft a save-compatible Prompt Recipe, populate this editor, and wait for you to review and save it manually."
        summary={
          !draftingEnabled
            ? "Recipe drafts are off."
            : initialDraftingConfig?.provider_model_id
            ? `Saved default: ${initialDraftingConfig.provider_kind}: ${initialDraftingConfig.provider_model_id}`
            : "Saved default not configured."
        }
        detail="Uses the current editor hints for category, output format, and image-input mode."
        defaultOpen={false}
        className="rounded-[var(--admin-radius)]"
      >
        <div className="admin-label-accent mb-4">Draft Assistant</div>
        {!draftingEnabled ? (
          <div className="grid gap-4">
            <div className="admin-surface-inset p-4 text-sm leading-6 text-[var(--muted-strong)]">
              Recipe drafts are turned off in AI Settings. Turn them on there before using this assistant.
            </div>
            <div className="flex flex-wrap justify-end gap-3">
              <Link href={SETTINGS_LLM_ROUTE} className={adminButtonClassName({ variant: "subtle" })}>
                Open AI Settings
              </Link>
            </div>
          </div>
        ) : (
        <div className="grid gap-4">
          <AdminField label="Recipe idea">
            <AdminTextarea
              rows={6}
              value={draftIdea}
              onChange={(event) => onDraftIdeaChange(event.target.value)}
              placeholder="Example: Create a video director recipe that takes a user scene prompt and returns four JSON video prompts for a cinematic action sequence."
            />
          </AdminField>
          <div className="grid gap-3 md:grid-cols-3">
            <AdminField label="Saved default">
              <div className="admin-input flex min-h-11 items-center text-sm text-[var(--muted-strong)]">
                {initialDraftingConfig?.provider_model_id
                  ? `${initialDraftingConfig.provider_kind}: ${initialDraftingConfig.provider_model_id}`
                  : "Not configured"}
              </div>
            </AdminField>
            <AdminField label="Override provider">
              <select
                value={providerKind}
                onChange={(event) => onProviderKindChange(event.target.value as SharedLlmProviderKind)}
                className="admin-input text-sm"
              >
                {sharedProviderKindOptions().map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </AdminField>
            <AdminField label="Override model">
              <select
                value={modelId}
                onChange={(event) => onModelIdChange(event.target.value)}
                className="admin-input text-sm"
              >
                <option value="">Leave blank to use the saved default</option>
                {providerModelChoices(providerKind, activeCatalog)
                  .filter((option) => option.value)
                  .map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
              </select>
            </AdminField>
          </div>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <AdminField label={providerKind === "openrouter" ? "Model search" : "Detected models"}>
              {providerKind === "openrouter" ? (
                <AdminInput
                  value={openRouterQuery}
                  onChange={(event) => onOpenRouterQueryChange(event.target.value)}
                  placeholder={providerCatalogSearchPlaceholder("openrouter")}
                />
              ) : (
                <div className="admin-input flex min-h-11 items-center text-sm text-[var(--muted-strong)]">
                  {providerCatalogLoadHint(providerKind)}
                </div>
              )}
            </AdminField>
            <div className="flex items-end">
              <AdminButton variant="subtle" onClick={onRefreshModels}>
                Refresh models
              </AdminButton>
            </div>
          </div>
          <div className="admin-surface-inset p-3 text-sm text-[var(--muted-strong)]">
            {catalogEntry ? providerCatalogStatusDetail(providerKind, catalogEntry) : providerCatalogLoadHint(providerKind)}
          </div>
          <div className="admin-surface-inset p-3 text-sm text-[var(--muted-strong)]">
            Draft generation uses the current editor hints for category, output format, and image-input mode. Codex Local runs are subscription-backed and do not show a Media Studio dollar estimate.
          </div>
          {draftingModelSummary ? (
            <div className="admin-surface-inset p-3 text-sm text-[var(--muted-strong)]">
              <span className="font-semibold text-[var(--foreground)]">Last draft model: </span>
              {draftingModelSummary}
            </div>
          ) : null}
          <div className="flex flex-wrap justify-end gap-3">
            <AdminButton
              onClick={onGenerateDraft}
              disabled={isGeneratingDraft || !draftIdea.trim() || (!canUseSavedDraftingDefault && !activeDraftOverride)}
            >
              {isGeneratingDraft ? "Generating..." : "Generate Draft"}
            </AdminButton>
          </div>
        </div>
        )}
      </SectionDisclosure>
    </Panel>
  );
}
