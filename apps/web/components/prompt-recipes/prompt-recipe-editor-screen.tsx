"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";

import { AdminButton, adminButtonIconLabelClassName } from "@/components/admin-controls";
import { AdminEditorActionBar } from "@/components/admin-editor-action-bar";
import { adminSectionStackClassName } from "@/components/admin-theme";
import {
  clearAssistantReviewDraft,
  fetchAssistantReviewDraft,
  readAssistantReviewDraft,
  type AssistantReviewDraft,
} from "@/lib/assistant-review-drafts";
import { useSharedProviderModelCatalog } from "@/hooks/use-shared-provider-model-catalog";
import { PromptRecipeBasicsPanel } from "@/components/prompt-recipes/editor/prompt-recipe-basics-panel";
import { PromptRecipeContractPanel } from "@/components/prompt-recipes/editor/prompt-recipe-contract-panel";
import { PromptRecipeDraftAssistantPanel } from "@/components/prompt-recipes/editor/prompt-recipe-draft-assistant-panel";
import { PromptRecipeImageInputPanel } from "@/components/prompt-recipes/editor/prompt-recipe-image-input-panel";
import { PromptRecipeTemplatePanel } from "@/components/prompt-recipes/editor/prompt-recipe-template-panel";
import { PromptRecipeThumbnailPickerDialog } from "@/components/prompt-recipes/editor/prompt-recipe-thumbnail-picker-dialog";
import { PromptRecipeVariablesPanel } from "@/components/prompt-recipes/editor/prompt-recipe-variables-panel";
import { fetchGeneratedImagePickerPage } from "@/components/media/media-image-picker-sources";
import { useMediaImagePickerPagination } from "@/components/media/use-media-image-picker-pagination";
import type { SharedLlmProviderKind } from "@/lib/llm-provider-metadata";
import {
  filterProviderModels,
  providerCatalogLoadHint,
  providerCatalogSearchPlaceholder,
  providerCatalogStatusDetail,
} from "@/lib/llm-provider-models";
import { invalidateGraphNodeDefinitions } from "@/lib/graph-node-definitions-sync";
import {
  defaultPromptRecipeImageInput,
  detectPromptRecipeVariables,
  normalizePromptRecipeCustomField,
  normalizePromptRecipeVariables,
  slugifyPromptRecipeKey,
  type PromptRecipeEditorDraft,
  promptRecipeDraftWarnings,
  promptRecipeToDraft,
  validatePromptRecipeDraft,
} from "@/lib/prompt-recipes";
import type {
  MediaAssetPickerItem,
  PromptRecipe,
  PromptRecipeCustomField,
  PromptRecipeDraftPayload,
  PromptRecipeDraftResponse,
  PromptRecipeDraftingConfig,
  PromptRecipeVariable,
} from "@/lib/types";

type PromptRecipeEditorScreenProps = {
  recipes: PromptRecipe[];
  initialRecipeId?: string | null;
  initialReturnTo?: string | null;
  initialDraftingConfig?: PromptRecipeDraftingConfig | null;
  initialAssistantDraftId?: string | null;
  initialAssistantSessionId?: string | null;
  initialAssistantMessageId?: string | null;
};

function parseJsonObject(value: string, label: string) {
  try {
    const parsed = JSON.parse(value || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { value: null, error: `${label} must be a JSON object.` };
    }
    return { value: parsed as Record<string, unknown>, error: null };
  } catch {
    return { value: null, error: `${label} contains invalid JSON.` };
  }
}

function parseJsonObjectValue(value: string) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function stringifyJsonObject(value: Record<string, unknown>) {
  return JSON.stringify(value, null, 2);
}

export function PromptRecipeEditorScreen({
  recipes,
  initialRecipeId = null,
  initialReturnTo = null,
  initialDraftingConfig = null,
  initialAssistantDraftId = null,
  initialAssistantSessionId = null,
  initialAssistantMessageId = null,
}: PromptRecipeEditorScreenProps) {
  const router = useRouter();
  const selectedRecipe = useMemo(
    () => recipes.find((recipe) => recipe.recipe_id === initialRecipeId) ?? null,
    [initialRecipeId, recipes],
  );
  const [draft, setDraft] = useState<PromptRecipeEditorDraft>(() => promptRecipeToDraft(selectedRecipe));
  const [isSaving, setIsSaving] = useState(false);
  const [isGeneratingDraft, setIsGeneratingDraft] = useState(false);
  const [isUploadingThumbnail, setIsUploadingThumbnail] = useState(false);
  const [message, setMessage] = useState<{ tone: "healthy" | "danger"; text: string } | null>(null);
  const [draftIdea, setDraftIdea] = useState("");
  const [lastDraftWarnings, setLastDraftWarnings] = useState<string[]>(
    () => selectedRecipe?.validation_warnings_json ?? selectedRecipe?.validation_warnings ?? [],
  );
  const [draftOverrideProviderKind, setDraftOverrideProviderKind] = useState(
    (initialDraftingConfig?.provider_kind as SharedLlmProviderKind) ?? "openrouter",
  );
  const [draftOverrideModelId, setDraftOverrideModelId] = useState("");
  const [draftOverrideOpenRouterQuery, setDraftOverrideOpenRouterQuery] = useState("");
  const [draftingModelSummary, setDraftingModelSummary] = useState<string | null>(null);
  const [thumbnailAssetSelectionId, setThumbnailAssetSelectionId] = useState<string | null>(null);
  const thumbnailInputRef = useRef<HTMLInputElement | null>(null);
  const autoLoadedOverrideProviderKindsRef = useRef(new Set<SharedLlmProviderKind>());
  const loadedAssistantDraftRef = useRef(false);
  const { catalogs: draftingProviderCatalogs, loadProviderCatalog } = useSharedProviderModelCatalog();
  const thumbnailPicker = useMediaImagePickerPagination<MediaAssetPickerItem>({
    fetchPage: fetchGeneratedImagePickerPage,
    getItemId: (asset) => String(asset.asset_id),
    onError: (error) => setMessage({ tone: "danger", text: error }),
  });

  const generatedKey = draft.key || slugifyPromptRecipeKey(draft.label);
  const returnTo = initialReturnTo || "/presets?tab=prompt-recipes";
  const detectedVariables = detectPromptRecipeVariables(draft.template);
  const parsedRules = parseJsonObjectValue(draft.rulesText);
  const parsedDefaultOptions = parseJsonObjectValue(draft.defaultOptionsText);
  const draftWarnings = promptRecipeDraftWarnings({
    template: draft.template,
    variables: draft.variables,
    customFields: draft.customFields,
    imageInput: draft.imageInput,
    imageAnalysisPrompt: draft.imageAnalysisPrompt ?? "",
    rules: parsedRules,
  });
  const canUseSavedDraftingDefault =
    initialDraftingConfig?.enabled !== false && Boolean(initialDraftingConfig?.provider_model_id);
  const activeDraftOverride = draftOverrideModelId.trim();
  const visibleDraftOverrideOpenRouterCatalog = useMemo(
    () =>
      filterProviderModels(
        "openrouter",
        draftingProviderCatalogs.openrouter?.availableModels ?? [],
        draftOverrideOpenRouterQuery,
      ),
    [draftOverrideOpenRouterQuery, draftingProviderCatalogs.openrouter?.availableModels],
  );
  const activeDraftOverrideCatalog =
    draftOverrideProviderKind === "openrouter"
      ? visibleDraftOverrideOpenRouterCatalog
      : draftingProviderCatalogs[draftOverrideProviderKind]?.availableModels ?? [];
  const draftOverrideCatalogEntry = draftingProviderCatalogs[draftOverrideProviderKind] ?? null;
  const activeVariables = useMemo(
    () =>
      normalizePromptRecipeVariables(draft.variables, draft.template)
        .filter((variable) => variable.enabled)
        .map((variable) => ({ ...variable, token: `{{${variable.key}}}` })),
    [draft.template, draft.variables],
  );
  const activeCustomFields = useMemo(
    () =>
      draft.customFields
        .map(normalizePromptRecipeCustomField)
        .filter((field) => field.key.trim() || field.label.trim()),
    [draft.customFields],
  );
  const draftValidationError = validatePromptRecipeDraft({
    key: generatedKey,
    label: draft.label,
    category: draft.category,
    outputFormat: draft.outputFormat,
    template: draft.template,
    variables: activeVariables,
    customFields: activeCustomFields,
    imageInput: draft.imageInput,
    imageAnalysisPrompt: draft.imageAnalysisPrompt ?? "",
    rules: parsedRules,
  });

  useEffect(() => {
    if (loadedAssistantDraftRef.current || selectedRecipe) {
      return;
    }
    loadedAssistantDraftRef.current = true;
    if (!initialAssistantDraftId && (!initialAssistantSessionId || !initialAssistantMessageId)) {
      loadedAssistantDraftRef.current = false;
      return;
    }

    let cancelled = false;
    async function loadAssistantDraft() {
      let reviewDraft: AssistantReviewDraft | null = null;
      try {
        reviewDraft = await fetchAssistantReviewDraft(initialAssistantSessionId, initialAssistantMessageId, "prompt_recipe");
      } catch {
        reviewDraft = null;
      }
      if (!reviewDraft && initialAssistantDraftId) {
        reviewDraft = readAssistantReviewDraft(initialAssistantDraftId, "prompt_recipe");
      }
      if (cancelled) return;
      if (!reviewDraft || reviewDraft.kind !== "prompt_recipe") {
        setMessage({ tone: "danger", text: "The assistant Prompt Recipe draft is no longer available. Ask the assistant to create it again." });
        return;
      }
      setDraft(promptRecipeToDraft(reviewDraft.draft));
      setLastDraftWarnings(reviewDraft.validationWarnings);
      setMessage({ tone: "healthy", text: "Assistant Prompt Recipe draft loaded. Review the fields and save when ready." });
      clearAssistantReviewDraft(initialAssistantDraftId);
    }

    void loadAssistantDraft();
    return () => {
      cancelled = true;
    };
  }, [initialAssistantDraftId, initialAssistantMessageId, initialAssistantSessionId, selectedRecipe]);

  useEffect(() => {
    if (initialDraftingConfig?.enabled === false) {
      return;
    }
    if (draftOverrideCatalogEntry?.availableModels.length) {
      return;
    }
    if (autoLoadedOverrideProviderKindsRef.current.has(draftOverrideProviderKind)) {
      return;
    }
    autoLoadedOverrideProviderKindsRef.current.add(draftOverrideProviderKind);
    void loadProviderCatalog(draftOverrideProviderKind, { announce: false });
  }, [draftOverrideCatalogEntry?.availableModels.length, draftOverrideProviderKind, loadProviderCatalog]);

  async function generateDraft() {
    setIsGeneratingDraft(true);
    setMessage(null);
    setDraftingModelSummary(null);
    setLastDraftWarnings([]);
    try {
      const response = await fetch("/api/control/prompt-recipes/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idea: draftIdea,
          category: draft.category,
          output_format: draft.outputFormat,
          image_input_mode: draft.imageInput.mode,
          provider_kind: activeDraftOverride ? draftOverrideProviderKind : undefined,
          provider_model_id: activeDraftOverride || undefined,
        }),
      });
      const result = (await response.json()) as { ok?: boolean; error?: string } & PromptRecipeDraftResponse;
      if (!response.ok || result.ok === false || !result.draft) {
        setMessage({ tone: "danger", text: result.error ?? "Unable to generate the Prompt Recipe draft." });
        return;
      }
      setDraft(promptRecipeToDraft(result.draft as PromptRecipeDraftPayload));
      setLastDraftWarnings(
        Array.isArray(result.validation_warnings)
          ? result.validation_warnings
          : ((result.draft.validation_warnings_json ?? result.draft.validation_warnings ?? []) as string[]),
      );
      if (result.drafting_model?.provider_model_id) {
        setDraftingModelSummary(`${result.drafting_model.provider_kind}: ${result.drafting_model.provider_model_id}`);
      }
      setMessage({ tone: "healthy", text: "Draft generated. Review the fields and save when ready." });
    } catch {
      setMessage({ tone: "danger", text: "Unable to reach the Prompt Recipe drafting service." });
    } finally {
      setIsGeneratingDraft(false);
    }
  }

  function patchRules(patch: Record<string, unknown>) {
    setDraft((current) => ({ ...current, rulesText: stringifyJsonObject({ ...parseJsonObjectValue(current.rulesText), ...patch }) }));
  }

  function patchDefaultOptions(patch: Record<string, unknown>) {
    setDraft((current) => ({
      ...current,
      defaultOptionsText: stringifyJsonObject({ ...parseJsonObjectValue(current.defaultOptionsText), ...patch }),
    }));
  }

  async function saveRecipe() {
    setIsSaving(true);
    setMessage(null);
    const outputContract = parseJsonObject(draft.outputContractText, "Output contract");
    const defaultOptions = parseJsonObject(draft.defaultOptionsText, "Default options");
    const rules = parseJsonObject(draft.rulesText, "Rules");
    const jsonError = outputContract.error ?? defaultOptions.error ?? rules.error;
    if (jsonError) {
      setIsSaving(false);
      setMessage({ tone: "danger", text: jsonError });
      return;
    }
    const validationError = validatePromptRecipeDraft({
      key: generatedKey,
      label: draft.label,
      category: draft.category,
      outputFormat: draft.outputFormat,
      template: draft.template,
      variables: activeVariables,
      customFields: activeCustomFields,
      imageInput: draft.imageInput,
      imageAnalysisPrompt: draft.imageAnalysisPrompt ?? "",
      rules: rules.value ?? {},
    });
    if (validationError) {
      setIsSaving(false);
      setMessage({ tone: "danger", text: validationError });
      return;
    }
    const payload = {
      key: generatedKey,
      label: draft.label.trim(),
      description: draft.description?.trim() || "",
      category: draft.category,
      status: draft.status,
      system_prompt_template: draft.template,
      image_analysis_prompt: draft.imageAnalysisPrompt?.trim() || "",
      user_prompt_placeholder: draft.userPromptPlaceholder || "{{user_prompt}}",
      output_format: draft.outputFormat,
      output_contract_json: outputContract.value ?? {},
      input_variables: activeVariables,
      custom_fields: activeCustomFields,
      image_input: draft.imageInput,
      default_options_json: defaultOptions.value ?? {},
      rules: rules.value ?? {},
      thumbnail_path: draft.thumbnailPath || null,
      thumbnail_url: draft.thumbnailUrl || null,
      notes: draft.notes?.trim() || "",
      source_kind: draft.sourceKind === "builtin" ? "built_in_override" : draft.sourceKind,
      version: "1",
      priority: Number(draft.priority ?? 0),
    };
    const endpoint = draft.recipeId ? `/api/control/prompt-recipes/${draft.recipeId}` : "/api/control/prompt-recipes";
    try {
      const response = await fetch(endpoint, {
        method: draft.recipeId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as { ok?: boolean; error?: string; recipe?: PromptRecipe };
      if (!response.ok || result.ok === false || !result.recipe) {
        setMessage({ tone: "danger", text: result.error ?? "Unable to save the prompt recipe." });
        return;
      }
      await invalidateGraphNodeDefinitions(draft.recipeId ? "prompt-recipe-updated" : "prompt-recipe-created");
      setMessage({ tone: "healthy", text: draft.recipeId ? "Prompt recipe updated." : "Prompt recipe created." });
      router.push(returnTo);
    } catch {
      setMessage({ tone: "danger", text: "Unable to save the prompt recipe right now." });
    } finally {
      setIsSaving(false);
    }
  }

  async function archiveRecipe() {
    if (!draft.recipeId) {
      return;
    }
    setIsSaving(true);
    try {
      const response = await fetch(`/api/control/prompt-recipes/${draft.recipeId}`, { method: "DELETE" });
      const result = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || result.ok === false) {
        setMessage({ tone: "danger", text: result.error ?? "Unable to archive the prompt recipe." });
        return;
      }
      await invalidateGraphNodeDefinitions("prompt-recipe-archived");
      router.push(returnTo);
    } catch {
      setMessage({ tone: "danger", text: "Unable to archive the prompt recipe right now." });
    } finally {
      setIsSaving(false);
    }
  }

  async function uploadThumbnail(file: File) {
    setIsUploadingThumbnail(true);
    setMessage(null);
    const formData = new FormData();
    formData.set("file", file);
    formData.set("recipeLabel", draft.label || "prompt-recipe-thumbnail");
    try {
      const response = await fetch("/api/control/prompt-recipe-thumbnail", { method: "POST", body: formData });
      const result = (await response.json()) as {
        ok?: boolean;
        error?: string;
        thumbnail_path?: string;
        thumbnail_url?: string;
      };
      if (!response.ok || result.ok === false || !result.thumbnail_path || !result.thumbnail_url) {
        setMessage({ tone: "danger", text: result.error ?? "Unable to upload the prompt recipe thumbnail." });
        return;
      }
      setDraft((current) => ({ ...current, thumbnailPath: result.thumbnail_path ?? "", thumbnailUrl: result.thumbnail_url ?? "" }));
      setMessage({ tone: "healthy", text: "Thumbnail uploaded." });
    } catch {
      setMessage({ tone: "danger", text: "Unable to upload the prompt recipe thumbnail right now." });
    } finally {
      setIsUploadingThumbnail(false);
    }
  }

  async function applyThumbnailFromAsset(assetId: string | number) {
    setThumbnailAssetSelectionId(String(assetId));
    setMessage(null);
    try {
      const response = await fetch("/api/control/prompt-recipe-thumbnail/from-asset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asset_id: assetId,
          recipeLabel: draft.label || "prompt-recipe-thumbnail",
        }),
      });
      const result = (await response.json()) as {
        ok?: boolean;
        error?: string;
        thumbnail_path?: string;
        thumbnail_url?: string;
      };
      if (!response.ok || result.ok === false || !result.thumbnail_path || !result.thumbnail_url) {
        setMessage({ tone: "danger", text: result.error ?? "Unable to use that generated image as the recipe thumbnail." });
        return;
      }
      setDraft((current) => ({
        ...current,
        thumbnailPath: result.thumbnail_path ?? "",
        thumbnailUrl: result.thumbnail_url ?? "",
      }));
      thumbnailPicker.closePicker();
      setMessage({ tone: "healthy", text: "Thumbnail selected from generated images." });
    } catch {
      setMessage({ tone: "danger", text: "Unable to use that generated image as the recipe thumbnail right now." });
    } finally {
      setThumbnailAssetSelectionId(null);
    }
  }

  function updateVariable(key: string, patch: Partial<PromptRecipeVariable>) {
    setDraft((current) => ({
      ...current,
      variables: current.variables.map((variable) =>
        variable.key === key ? { ...variable, ...patch, token: `{{${variable.key}}}` } : variable,
      ),
    }));
  }

  function updateCustomField(index: number, patch: Partial<PromptRecipeCustomField>) {
    setDraft((current) => ({
      ...current,
      customFields: current.customFields.map((field, fieldIndex) =>
        fieldIndex === index ? normalizePromptRecipeCustomField({ ...field, ...patch }) : field,
      ),
    }));
  }

  return (
    <div className={adminSectionStackClassName}>
      {message ? (
        <div className={message.tone === "danger" ? "admin-live-notice-danger" : "admin-live-notice-success"}>
          {message.text}
        </div>
      ) : null}

      {!draft.recipeId ? (
        <PromptRecipeDraftAssistantPanel
          initialDraftingConfig={initialDraftingConfig}
          draftIdea={draftIdea}
          onDraftIdeaChange={setDraftIdea}
          providerKind={draftOverrideProviderKind}
          onProviderKindChange={(nextProviderKind) => {
            setDraftOverrideProviderKind(nextProviderKind);
            setDraftOverrideModelId("");
            setDraftOverrideOpenRouterQuery("");
          }}
          modelId={draftOverrideModelId}
          onModelIdChange={setDraftOverrideModelId}
          openRouterQuery={draftOverrideOpenRouterQuery}
          onOpenRouterQueryChange={setDraftOverrideOpenRouterQuery}
          activeCatalog={activeDraftOverrideCatalog}
          catalogEntry={draftOverrideCatalogEntry}
          onRefreshModels={() => {
            void loadProviderCatalog(draftOverrideProviderKind, {
              force: true,
              announce: false,
            });
          }}
          draftingModelSummary={draftingModelSummary}
          isGeneratingDraft={isGeneratingDraft}
          canUseSavedDraftingDefault={canUseSavedDraftingDefault}
          activeDraftOverride={activeDraftOverride}
          onGenerateDraft={() => {
            void generateDraft();
          }}
        />
      ) : null}

      <PromptRecipeBasicsPanel
        draft={draft}
        generatedKey={generatedKey}
        onDraftChange={setDraft}
        thumbnailInputRef={thumbnailInputRef}
        isUploadingThumbnail={isUploadingThumbnail}
        thumbnailAssetsLoading={thumbnailPicker.loading}
        onOpenGeneratedImages={thumbnailPicker.openPicker}
        onThumbnailUpload={(file) => {
          void uploadThumbnail(file);
        }}
        headerAction={
          <AdminButton variant="subtle" onClick={() => router.push(returnTo)}>
            <span className={adminButtonIconLabelClassName}>
              <ArrowLeft className="size-4" />
              Back to Prompt Recipes
            </span>
          </AdminButton>
        }
      />

      <PromptRecipeThumbnailPickerDialog
        open={thumbnailPicker.open}
        assets={thumbnailPicker.items}
        assetsLoading={thumbnailPicker.loading}
        assetsLoadingMore={thumbnailPicker.loadingMore}
        nextOffset={thumbnailPicker.nextOffset}
        selectionId={thumbnailAssetSelectionId}
        onClose={thumbnailPicker.closePicker}
        onLoadMore={thumbnailPicker.loadNextPage}
        onSelectAsset={(assetId) => {
          void applyThumbnailFromAsset(assetId);
        }}
      />

      <PromptRecipeTemplatePanel
        draft={draft}
        detectedVariables={detectedVariables}
        draftWarnings={draftWarnings}
        validationError={draftValidationError}
        lastDraftWarnings={lastDraftWarnings}
        onDraftChange={(updater) =>
          setDraft((current) => {
            const next = updater(current);
            return {
              ...next,
              variables: normalizePromptRecipeVariables(next.variables, next.template),
            };
          })
        }
      />

      <PromptRecipeImageInputPanel draft={draft} onDraftChange={setDraft} />

      <PromptRecipeVariablesPanel
        draft={draft}
        onUpdateVariable={updateVariable}
        onUpdateCustomField={updateCustomField}
        onDraftChange={setDraft}
      />

      <PromptRecipeContractPanel
        draft={draft}
        parsedDefaultOptions={parsedDefaultOptions}
        parsedRules={parsedRules}
        onPatchDefaultOptions={patchDefaultOptions}
        onPatchRules={patchRules}
        onDraftChange={setDraft}
      />

      <AdminEditorActionBar>
        {draft.recipeId ? (
          <AdminButton variant="danger" onClick={archiveRecipe} disabled={isSaving}>
            Archive
          </AdminButton>
        ) : null}
        <AdminButton variant="subtle" onClick={() => router.push(returnTo)}>
          Cancel
        </AdminButton>
        <AdminButton onClick={saveRecipe} disabled={isSaving}>
          {isSaving ? "Saving..." : "Save Prompt Recipe"}
        </AdminButton>
      </AdminEditorActionBar>
    </div>
  );
}
