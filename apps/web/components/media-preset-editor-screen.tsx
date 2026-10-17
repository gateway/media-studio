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
import { ThumbnailField } from "@/components/media/thumbnail-field";
import { PanelHeader } from "@/components/panel";
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
  const [archived, setArchived] = useState(selectedPreset?.status === "archived");
  const [assistantWarnings, setAssistantWarnings] = useState<string[]>([]);
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
  const accentCardClassName = "surface-card-accent p-4 sm:p-5";
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
    if (!initialAssistantDraftId && (!initialAssistantSessionId || !initialAssistantMessageId)) {
      loadedAssistantDraftRef.current = false;
      return;
    }

    let cancelled = false;
    async function loadAssistantDraft() {
      let reviewDraft: AssistantReviewDraft | null = null;
      let loadFailed = false;
      try {
        reviewDraft = await fetchAssistantReviewDraft(initialAssistantSessionId, initialAssistantMessageId, "media_preset");
      } catch {
        loadFailed = true;
      }
      if (!reviewDraft && initialAssistantDraftId) {
        reviewDraft = readAssistantReviewDraft(initialAssistantDraftId, "media_preset");
      }
      if (cancelled) return;
      loadedAssistantDraftRef.current = true;
      if (!reviewDraft || reviewDraft.kind !== "media_preset") {
        showNotice("danger", loadFailed ? "Couldn’t load your assistant Media Preset draft. Check your connection and reload this page." : "The assistant Media Preset draft is no longer available. Ask the assistant to create it again.");
        return;
      }
      setPresetForm(buildPresetForm(reviewDraft.draft, defaultModelKey));
      setAssistantWarnings(reviewDraft.validationWarnings);
      showNotice("healthy", "Assistant Media Preset draft loaded. Review the fields and save when ready.");
      clearAssistantReviewDraft(initialAssistantDraftId);
    }

    void loadAssistantDraft();
    return () => {
      cancelled = true;
    };
  }, [defaultModelKey, initialAssistantDraftId, initialAssistantMessageId, initialAssistantSessionId, selectedPreset, showNotice]);

  async function savePreset() {
    if (archived || isSaving) return;
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
    try {
      const response = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as { ok?: boolean; error?: string; preset?: MediaPreset };
      if (!response.ok || result.ok === false || !result.preset) {
        showNotice("danger", response.status >= 400 && response.status < 500
          ? result.error ?? "Couldn’t save your Media Preset. Review its fields and try again."
          : "Couldn’t confirm whether your Media Preset was saved. Check the preset list before trying again.");
        return;
      }
      setPresetForm(buildPresetForm(result.preset, defaultModelKey));
      try {
        await invalidateGraphNodeDefinitions(presetForm.presetId ? "media-preset-updated" : "media-preset-created");
      } catch {
        showNotice("danger", "Media Preset saved. Reload the page to refresh the Graph node list.");
        return;
      }
      showNotice("healthy", presetForm.presetId ? "Preset updated." : "Preset created.");
      router.push(returnToPresetsHref);
    } catch {
      showNotice("danger", "Couldn’t confirm whether your Media Preset was saved. Check the preset list before trying again.");
    } finally {
      setIsSaving(false);
    }
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
    if (!presetForm.presetId || archived || isSaving) return;
    setIsSaving(true);
    try {
      const response = await fetch(`/api/control/media-presets/${presetForm.presetId}`, { method: "DELETE" });
      const result = (await response.json()) as { ok?: boolean; error?: string; preset?: MediaPreset };
      if (!response.ok || result.ok === false) {
        showNotice("danger", response.status >= 400 && response.status < 500
          ? result.error ?? "Couldn’t archive your preset. Check the preset list before trying again."
          : "Couldn’t confirm whether your preset was archived. Check the preset list before trying again.");
        return;
      }
      setArchived(true);
      setPresetForm((current) => ({ ...current, status: "inactive" }));
      try {
        await invalidateGraphNodeDefinitions("media-preset-archived");
      } catch {
        showNotice("danger", "Preset archived. Reload the page to refresh the Graph node list.");
        return;
      }
      showNotice("healthy", "Preset archived.");
      router.push(returnToPresetsHref);
    } catch {
      showNotice("danger", "Couldn’t confirm whether your preset was archived. Check the preset list before trying again.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-7">
      {message ? <AdminActionNotice tone={message.tone} text={message.text} /> : null}
      {assistantWarnings.length ? <section aria-label="Assistant draft review" className="callout-panel callout-panel-warning">
        <strong>Review before saving or testing</strong>
        <ul>{assistantWarnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
      </section> : null}

      <div className="admin-section-stack">
        <PanelHeader
          eyebrow="Preset Settings"
          title={presetForm.presetId ? presetForm.label || "Edit preset" : "Create preset"}
          action={
            <AdminButton variant="subtle" onClick={() => router.push(returnToPresetsHref)}>
              <span className={adminButtonIconLabelClassName}>
                <ArrowLeft className="size-3.5" />
                {returnActionLabel}
              </span>
            </AdminButton>
          }
        />

        <div className="admin-form-grid">
          <div className="admin-form-main">

            <MediaPresetBasicsPanel
              form={presetForm}
              className={accentCardClassName}
              presetNameInputRef={presetNameInputRef}
              onFormChange={setPresetForm}
            />

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
          </div>
          <aside className="admin-form-aside" aria-label="Preset preview and availability">

            <ThumbnailField
              label="Thumbnail"
              imageUrl={presetForm.thumbnailUrl}
              imageAlt={presetForm.label || "Preset thumbnail"}
              emptyLabel="No thumbnail"
              inputRef={thumbnailInputRef}
              isUploading={thumbnailPickerState.isUploadingThumbnail}
              isBrowsing={thumbnailPickerState.picker.loading}
              chooseLabel="Choose from generated images"
              browseLabel="Browse generated images"
              uploadLabel="Upload thumbnail"
              removeLabel="Remove thumbnail"
              onChoose={thumbnailPickerState.picker.openPicker}
              onUploadFile={(file) => void thumbnailPickerState.uploadThumbnail(file)}
              onRemove={() => setPresetForm((current) => ({ ...current, thumbnailPath: "", thumbnailUrl: "" }))}
              className={accentCardClassName}
            />

            <MediaPresetAvailabilityPanel
              form={presetForm}
              className={accentCardClassName}
              generatedPresetKey={generatedPresetKey}
              models={compatiblePresetModels}
              onFormChange={setPresetForm}
            />
          </aside>
          <div className="admin-span-full">

            <MediaPresetActionsPanel
              form={presetForm}
              className={accentCardClassName}
              isSaving={isSaving}
              archived={archived}
              isExporting={isExporting}
              onFormChange={setPresetForm}
              onExport={() => void exportPreset()}
              onSave={() => void savePreset()}
              onArchive={() => void archivePreset()}
            />
          </div>
        </div>
      </div>

      <GeneratedThumbnailPickerDialog
        open={thumbnailPickerState.picker.open}
        dialogLabel="Generated image thumbnails"
        title="Choose a thumbnail"
        description="Pick a recent generated image to use as this preset thumbnail."
        items={thumbnailPickerState.pickerItems}
        errorMessage={thumbnailPickerState.picker.error ? "Couldn’t load thumbnail images. Retry loading the image list." : null}
        errorDetails={thumbnailPickerState.picker.error}
        onRetry={thumbnailPickerState.picker.retry}
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
