"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";

import {
  AdminButton,
  adminButtonIconLabelClassName,
} from "@/components/admin-controls";
import { AdminActionNotice } from "@/components/admin-action-notice";
import {
  GeneratedThumbnailPickerDialog,
} from "@/components/media/generated-thumbnail-picker-dialog";
import { MediaPresetActionsPanel } from "@/components/media-presets/editor/media-preset-actions-panel";
import { MediaPresetAvailabilityPanel } from "@/components/media-presets/editor/media-preset-availability-panel";
import { MediaPresetBasicsPanel } from "@/components/media-presets/editor/media-preset-basics-panel";
import { MediaPresetImageSlotsPanel } from "@/components/media-presets/editor/media-preset-image-slots-panel";
import { MediaPresetPromptPanel } from "@/components/media-presets/editor/media-preset-prompt-panel";
import { MediaPresetTextFieldsPanel } from "@/components/media-presets/editor/media-preset-text-fields-panel";
import {
  buildPresetForm,
  normalizePresetEditorError,
  normalizePresetFieldKey,
} from "@/components/media-presets/editor/media-preset-editor-utils";
import type { PresetFormState } from "@/components/media-presets/editor/media-preset-editor-types";
import { useMediaPresetThumbnailPicker } from "@/components/media-presets/editor/use-media-preset-thumbnail-picker";
import { Panel, PanelHeader } from "@/components/panel";
import { useAdminActionNotice } from "@/hooks/use-admin-action-notice";
import {
  clearAssistantReviewDraft,
  fetchAssistantReviewDraft,
  readAssistantReviewDraft,
  type AssistantReviewDraft,
} from "@/lib/assistant-review-drafts";
import { invalidateGraphNodeDefinitions } from "@/lib/graph-node-definitions-sync";
import { compatibleStructuredImagePresetModels, presetImageInputPolicy } from "@/lib/media-studio-helpers";
import type { MediaModelSummary, MediaPreset } from "@/lib/types";
import { slugifyKey } from "@/lib/utils";

type MediaPresetEditorScreenProps = {
  models: MediaModelSummary[];
  presets: MediaPreset[];
  initialPresetId?: string | null;
  initialModelKey?: string | null;
  initialReturnTo?: string | null;
  initialAssistantDraftId?: string | null;
  initialAssistantSessionId?: string | null;
  initialAssistantMessageId?: string | null;
  variant?: "default" | "studio";
};

function normalizeReturnToHref(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/presets";
  }
  return value;
}


export function MediaPresetEditorScreen({
  models,
  presets,
  initialPresetId = null,
  initialModelKey = null,
  initialReturnTo = null,
  initialAssistantDraftId = null,
  initialAssistantSessionId = null,
  initialAssistantMessageId = null,
  variant = "studio",
}: MediaPresetEditorScreenProps) {
  const router = useRouter();
  const selectedPreset = useMemo(
    () => presets.find((preset) => preset.preset_id === initialPresetId) ?? null,
    [initialPresetId, presets],
  );
  const defaultModelKey = initialModelKey ?? selectedPreset?.model_key ?? "nano-banana-2";
  const [presetForm, setPresetForm] = useState<PresetFormState>(() => buildPresetForm(selectedPreset, defaultModelKey));
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const { notice: message, showNotice } = useAdminActionNotice();
  const presetNameInputRef = useRef<HTMLInputElement | null>(null);
  const thumbnailInputRef = useRef<HTMLInputElement | null>(null);
  const loadedAssistantDraftRef = useRef(false);

  const generatedPresetKey = presetForm.key || slugifyKey(presetForm.label);
  const presetImagePolicy = presetImageInputPolicy({ input_slots_json: presetForm.imageSlots } as never);
  const compatiblePresetModels = compatibleStructuredImagePresetModels(models, presetImagePolicy);
  const returnToPresetsHref = normalizeReturnToHref(initialReturnTo);
  const returnActionLabel = returnToPresetsHref === "/studio" ? "Back to Studio" : "Back to presets";
  const accentCardClassName = "admin-surface-accent p-4 sm:p-5";
  const thumbnailPickerState = useMediaPresetThumbnailPicker({
    presetLabel: presetForm.label,
    showNotice,
    onThumbnailChange: ({ thumbnailPath, thumbnailUrl }) =>
      setPresetForm((current) => ({
        ...current,
        thumbnailPath,
        thumbnailUrl,
      })),
  });

  useEffect(() => {
    if (loadedAssistantDraftRef.current || selectedPreset) {
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
        reviewDraft = await fetchAssistantReviewDraft(initialAssistantSessionId, initialAssistantMessageId, "media_preset");
      } catch {
        reviewDraft = null;
      }
      if (!reviewDraft && initialAssistantDraftId) {
        reviewDraft = readAssistantReviewDraft(initialAssistantDraftId, "media_preset");
      }
      if (cancelled) return;
      if (!reviewDraft || reviewDraft.kind !== "media_preset") {
        showNotice("danger", "The assistant Media Preset draft is no longer available. Ask the assistant to create it again.");
        return;
      }
      setPresetForm(buildPresetForm(reviewDraft.draft, defaultModelKey));
      showNotice("healthy", "Assistant Media Preset draft loaded. Review the fields and save when ready.");
      clearAssistantReviewDraft(initialAssistantDraftId);
    }

    void loadAssistantDraft();
    return () => {
      cancelled = true;
    };
  }, [defaultModelKey, initialAssistantDraftId, initialAssistantMessageId, initialAssistantSessionId, selectedPreset, showNotice]);

  async function savePreset() {
    setIsSaving(true);
    const resolvedKey = generatedPresetKey;
    const presetError = normalizePresetEditorError(presetForm);
    if (!resolvedKey || presetError) {
      setIsSaving(false);
      showNotice("danger", presetError ?? "Preset name is required.");
      return;
    }
    const compatibleModelKeys = new Set(compatiblePresetModels.map((model) => model.key));
    const scopedModels = Array.from(new Set(presetForm.appliesToModels)).filter((value) => compatibleModelKeys.has(value));
    if (!scopedModels.length) {
      setIsSaving(false);
      showNotice("danger", "Select at least one compatible image model for this preset.");
      return;
    }
    const payload = {
      key: resolvedKey,
      label: presetForm.label.trim(),
      description: presetForm.description.trim() || null,
      category: presetForm.category,
      status: presetForm.status,
      model_key: scopedModels[0],
      source_kind: presetForm.sourceKind,
      base_builtin_key: presetForm.baseBuiltinKey,
      applies_to_models: scopedModels,
      applies_to_task_modes: [],
      applies_to_input_patterns: [],
      prompt_template: presetForm.promptTemplate.trim(),
      system_prompt_template: null,
      default_options_json: {},
      input_schema_json: presetForm.inputFields.map((field) => ({
        key: normalizePresetFieldKey(field.key),
        label: field.label.trim(),
        placeholder: field.placeholder.trim(),
        default_value: field.defaultValue.trim(),
        required: field.required,
      })),
      input_slots_json: presetForm.imageSlots.map((slot) => ({
        key: normalizePresetFieldKey(slot.key),
        label: slot.label.trim(),
        help_text: slot.helpText.trim(),
        required: slot.required,
        max_files: 1,
      })),
      thumbnail_path: presetForm.thumbnailPath.trim() || null,
      thumbnail_url: presetForm.thumbnailUrl.trim() || null,
      notes: presetForm.notes.trim() || null,
      requires_image: presetForm.imageSlots.length > 0,
      requires_video: false,
      requires_audio: false,
    };

    const endpoint = presetForm.presetId
      ? `/api/control/media-presets/${presetForm.presetId}`
      : "/api/control/media-presets";
    const method = presetForm.presetId ? "PATCH" : "POST";
    const response = await fetch(endpoint, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = (await response.json()) as { ok?: boolean; error?: string; preset?: MediaPreset };
    if (!response.ok || result.ok === false || !result.preset) {
      setIsSaving(false);
      showNotice("danger", result.error ?? "Unable to save the preset.");
      return;
    }
    await invalidateGraphNodeDefinitions(presetForm.presetId ? "media-preset-updated" : "media-preset-created");
    setPresetForm(buildPresetForm(result.preset, defaultModelKey));
    setIsSaving(false);
    showNotice("healthy", presetForm.presetId ? "Preset updated." : "Preset created.");
    router.push(returnToPresetsHref);
  }

  async function exportPreset() {
    if (!presetForm.presetId) {
      return;
    }
    setIsExporting(true);
    showNotice("healthy", "Preparing preset export...", 4000);
    try {
      const response = await fetch(`/api/control/media-presets/export/${presetForm.presetId}`);
      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as { error?: string } | null;
        showNotice("danger", result?.error ?? "Unable to export the preset.");
        return;
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const downloadLink = document.createElement("a");
      const disposition = response.headers.get("content-disposition") ?? "";
      const fileNameMatch = disposition.match(/filename=\"?([^"]+)\"?/i);
      downloadLink.href = objectUrl;
      downloadLink.download = fileNameMatch?.[1] ?? `${generatedPresetKey || "preset"}.zip`;
      showNotice("healthy", "Preset exported.");
      document.body.appendChild(downloadLink);
      downloadLink.click();
      downloadLink.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch {
      showNotice("danger", "Unable to export the preset.");
    } finally {
      setIsExporting(false);
    }
  }

  async function archivePreset() {
    if (!presetForm.presetId) {
      return;
    }
    setIsSaving(true);
    const response = await fetch(`/api/control/media-presets/${presetForm.presetId}`, { method: "DELETE" });
    const result = (await response.json()) as { ok?: boolean; error?: string; preset?: MediaPreset };
    if (!response.ok || result.ok === false) {
      setIsSaving(false);
      showNotice("danger", result.error ?? "Unable to archive the preset.");
      return;
    }
    await invalidateGraphNodeDefinitions("media-preset-archived");
    setIsSaving(false);
    showNotice("healthy", "Preset archived.");
    router.push(returnToPresetsHref);
  }

  return (
    <div className="space-y-7">
      {message ? <AdminActionNotice tone={message.tone} text={message.text} /> : null}

      <Panel>
        <PanelHeader
          eyebrow="Preset Settings"
          title={presetForm.presetId ? presetForm.label || "Edit preset" : "Create preset"}
          description="Define the preset basics, scope, prompt template, and structured inputs using the same admin system as the Studio admin pages."
          action={
            <AdminButton variant="subtle" onClick={() => router.push(returnToPresetsHref)}>
              <span className={adminButtonIconLabelClassName}>
                <ArrowLeft className="size-3.5" />
                {returnActionLabel}
              </span>
            </AdminButton>
          }
        />

        <div className="mt-5 grid gap-5">
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
            <MediaPresetBasicsPanel
              form={presetForm}
              className={accentCardClassName}
              presetNameInputRef={presetNameInputRef}
              thumbnailInputRef={thumbnailInputRef}
              isUploadingThumbnail={thumbnailPickerState.isUploadingThumbnail}
              thumbnailAssetsLoading={thumbnailPickerState.picker.loading}
              onFormChange={setPresetForm}
              onOpenGeneratedImages={thumbnailPickerState.picker.openPicker}
              onThumbnailUpload={(file) => void thumbnailPickerState.uploadThumbnail(file)}
              onRemoveThumbnail={() => setPresetForm((current) => ({ ...current, thumbnailPath: "", thumbnailUrl: "" }))}
            />

            <div className="grid gap-5">
              <MediaPresetAvailabilityPanel
                form={presetForm}
                className={accentCardClassName}
                generatedPresetKey={generatedPresetKey}
                models={compatiblePresetModels}
                onFormChange={setPresetForm}
              />
            </div>
          </div>

          <MediaPresetPromptPanel
            form={presetForm}
            className={accentCardClassName}
            onFormChange={setPresetForm}
          />

          <MediaPresetTextFieldsPanel
            form={presetForm}
            className={accentCardClassName}
            onFormChange={setPresetForm}
          />

          <MediaPresetImageSlotsPanel
            form={presetForm}
            className={accentCardClassName}
            onFormChange={setPresetForm}
          />

          <MediaPresetActionsPanel
            form={presetForm}
            className={accentCardClassName}
            isSaving={isSaving}
            isExporting={isExporting}
            onFormChange={setPresetForm}
            onExport={() => void exportPreset()}
            onSave={() => void savePreset()}
            onArchive={() => void archivePreset()}
          />
        </div>
      </Panel>

      <GeneratedThumbnailPickerDialog
        open={thumbnailPickerState.picker.open}
        dialogLabel="Generated image thumbnails"
        title="Choose a thumbnail"
        description="Pick a recent generated image to use as this preset thumbnail."
        items={thumbnailPickerState.pickerItems}
        loading={thumbnailPickerState.picker.loading}
        loadingMore={thumbnailPickerState.picker.loadingMore}
        nextOffset={thumbnailPickerState.picker.nextOffset}
        selectionId={thumbnailPickerState.thumbnailAssetSelectionId}
        onClose={thumbnailPickerState.picker.closePicker}
        onLoadMore={thumbnailPickerState.picker.loadNextPage}
        onSelectItem={(assetId) => void thumbnailPickerState.applyThumbnailFromAsset(assetId)}
      />
    </div>
  );
}
