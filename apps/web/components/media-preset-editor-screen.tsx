"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";

import {
  AdminButton,
  AdminInput,
  AdminTextarea,
  AdminToggle,
  adminButtonIconLabelClassName,
} from "@/components/admin-controls";
import { AdminActionNotice } from "@/components/admin-action-notice";
import { CollapsibleSubsection } from "@/components/collapsible-sections";
import {
  GeneratedThumbnailPickerDialog,
  type GeneratedThumbnailPickerItem,
} from "@/components/media/generated-thumbnail-picker-dialog";
import { generatedThumbnailPreviewUrl } from "@/components/media/generated-thumbnail-utils";
import { ThumbnailField } from "@/components/media/thumbnail-field";
import { Panel, PanelHeader } from "@/components/panel";
import { useAdminActionNotice } from "@/hooks/use-admin-action-notice";
import { invalidateGraphNodeDefinitions } from "@/lib/graph-node-definitions-sync";
import { compatibleStructuredImagePresetModels } from "@/lib/media-studio-helpers";
import type { MediaAsset, MediaModelSummary, MediaPreset } from "@/lib/types";
import { slugifyKey } from "@/lib/utils";

type PresetFieldInput = {
  id: string;
  key: string;
  label: string;
  placeholder: string;
  defaultValue: string;
  required: boolean;
};

type PresetImageSlotInput = {
  id: string;
  key: string;
  label: string;
  helpText: string;
  maxFiles: number;
  required: boolean;
};

type PresetFormState = {
  presetId: string | null;
  sourceKind: MediaPreset["source_kind"];
  baseBuiltinKey: string | null;
  key: string;
  label: string;
  description: string;
  status: "active" | "inactive";
  appliesToModels: string[];
  promptTemplate: string;
  notes: string;
  inputFields: PresetFieldInput[];
  imageSlots: PresetImageSlotInput[];
  thumbnailPath: string;
  thumbnailUrl: string;
};

type MediaPresetEditorScreenProps = {
  models: MediaModelSummary[];
  presets: MediaPreset[];
  initialPresetId?: string | null;
  initialModelKey?: string | null;
  initialReturnTo?: string | null;
  variant?: "default" | "studio";
};

function normalizeReturnToHref(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/presets";
  }
  return value;
}

function createLocalId(prefix: string) {
  const randomValue =
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${randomValue}`;
}

function createPresetFieldInput(): PresetFieldInput {
  return {
    id: createLocalId("preset-field"),
    key: "",
    label: "",
    placeholder: "",
    defaultValue: "",
    required: true,
  };
}

function createPresetImageSlot(): PresetImageSlotInput {
  return {
    id: createLocalId("preset-slot"),
    key: "",
    label: "",
    helpText: "",
    maxFiles: 1,
    required: true,
  };
}

function normalizePresetFieldKey(value: string) {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function presetFieldKeyToken(key: string) {
  return `{{${key}}}`;
}

function presetSlotKeyToken(key: string) {
  return `[[${key}]]`;
}

function emptyPresetForm(defaultModelKey: string | null | undefined): PresetFormState {
  return {
    presetId: null,
    sourceKind: "custom",
    baseBuiltinKey: null,
    key: "",
    label: "",
    description: "",
    status: "active",
    appliesToModels:
      defaultModelKey === "nano-banana-pro" ? ["nano-banana-pro"] : ["nano-banana-2"],
    promptTemplate: "",
    notes: "",
    inputFields: [],
    imageSlots: [],
    thumbnailPath: "",
    thumbnailUrl: "",
  };
}

function buildPresetForm(preset: MediaPreset | null | undefined, defaultModelKey: string | null | undefined) {
  if (!preset) {
    return emptyPresetForm(defaultModelKey);
  }
  return {
    presetId: preset.preset_id,
    sourceKind: preset.source_kind,
    baseBuiltinKey: preset.base_builtin_key ?? null,
    key: preset.key,
    label: preset.label,
    description: preset.description ?? "",
    status: preset.status === "archived" ? "inactive" : (preset.status as "active" | "inactive"),
    appliesToModels: preset.applies_to_models?.length
      ? preset.applies_to_models
      : preset.model_key
        ? [preset.model_key]
        : ["nano-banana-2"],
    promptTemplate: preset.prompt_template ?? "",
    notes: preset.notes ?? "",
    inputFields: ((preset.input_schema_json as Array<Record<string, unknown>> | undefined) ?? []).map((field) => ({
      id: createLocalId("preset-field"),
      key: String(field.key ?? ""),
      label: String(field.label ?? ""),
      placeholder: String(field.placeholder ?? ""),
      defaultValue: String(field.default_value ?? ""),
      required: Boolean(field.required ?? true),
    })),
    imageSlots: ((preset.input_slots_json as Array<Record<string, unknown>> | undefined) ?? []).map((slot) => ({
      id: createLocalId("preset-slot"),
      key: String(slot.key ?? slot.slot ?? ""),
      label: String(slot.label ?? ""),
      helpText: String(slot.help_text ?? ""),
      maxFiles: Number(slot.max_files ?? 1) || 1,
      required: Boolean(slot.required ?? true),
    })),
    thumbnailPath: preset.thumbnail_path ?? "",
    thumbnailUrl: preset.thumbnail_url ?? "",
  };
}

function normalizePresetEditorError(form: PresetFormState) {
  if (!form.label.trim()) {
    return "Preset name is required.";
  }
  if (!form.promptTemplate.trim()) {
    return "Prompt text is required.";
  }
  const fieldKeys = form.inputFields.map((field) => normalizePresetFieldKey(field.key)).filter(Boolean);
  const slotKeys = form.imageSlots.map((slot) => normalizePresetFieldKey(slot.key)).filter(Boolean);
  if (new Set(fieldKeys).size !== fieldKeys.length) {
    return "Text field keys must be unique.";
  }
  if (new Set(slotKeys).size !== slotKeys.length) {
    return "Image slot keys must be unique.";
  }
  if (form.inputFields.some((field) => !normalizePresetFieldKey(field.key) || !field.label.trim())) {
    return "Each text field needs a key and a label.";
  }
  if (form.imageSlots.some((slot) => !normalizePresetFieldKey(slot.key) || !slot.label.trim())) {
    return "Each image slot needs a key and a label.";
  }

  const promptFieldRefs = new Set(
    Array.from(form.promptTemplate.matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g)).map((match) => match[1]),
  );
  const promptSlotRefs = new Set(
    Array.from(form.promptTemplate.matchAll(/\[\[([a-zA-Z0-9_]+)\]\]/g)).map((match) => match[1]),
  );
  const normalizedFieldKeys = new Set(fieldKeys);
  const normalizedSlotKeys = new Set(slotKeys);
  const missingFieldRefs = Array.from(promptFieldRefs).filter((key) => !normalizedFieldKeys.has(key));
  const missingSlotRefs = Array.from(promptSlotRefs).filter((key) => !normalizedSlotKeys.has(key));
  const unusedFields = fieldKeys.filter((key) => !promptFieldRefs.has(key));
  const unusedSlots = slotKeys.filter((key) => !promptSlotRefs.has(key));

  if (missingFieldRefs.length) {
    return `Prompt is missing configured text field definitions for: ${missingFieldRefs
      .map((key) => presetFieldKeyToken(key))
      .join(", ")}`;
  }
  if (missingSlotRefs.length) {
    return `Prompt is missing configured image slot definitions for: ${missingSlotRefs
      .map((key) => presetSlotKeyToken(key))
      .join(", ")}`;
  }
  if (unusedFields.length) {
    return `Configured text fields are not referenced in the prompt: ${unusedFields
      .map((key) => presetFieldKeyToken(key))
      .join(", ")}`;
  }
  if (unusedSlots.length) {
    return `Configured image slots are not referenced in the prompt: ${unusedSlots
      .map((key) => presetSlotKeyToken(key))
      .join(", ")}`;
  }
  return null;
}

export function MediaPresetEditorScreen({
  models,
  presets,
  initialPresetId = null,
  initialModelKey = null,
  initialReturnTo = null,
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
  const [isUploadingThumbnail, setIsUploadingThumbnail] = useState(false);
  const [thumbnailPickerOpen, setThumbnailPickerOpen] = useState(false);
  const [thumbnailAssets, setThumbnailAssets] = useState<MediaAsset[]>([]);
  const [thumbnailAssetsLoading, setThumbnailAssetsLoading] = useState(false);
  const [thumbnailAssetsLoadingMore, setThumbnailAssetsLoadingMore] = useState(false);
  const [thumbnailAssetsNextOffset, setThumbnailAssetsNextOffset] = useState<number | null>(0);
  const [thumbnailAssetSelectionId, setThumbnailAssetSelectionId] = useState<string | null>(null);
  const { notice: message, showNotice } = useAdminActionNotice();
  const presetNameInputRef = useRef<HTMLInputElement | null>(null);
  const thumbnailInputRef = useRef<HTMLInputElement | null>(null);

  const generatedPresetKey = presetForm.key || slugifyKey(presetForm.label);
  const requiresImagePresetModel = presetForm.imageSlots.some((slot) => slot.required);
  const compatiblePresetModels = compatibleStructuredImagePresetModels(models, requiresImagePresetModel);
  const returnToPresetsHref = normalizeReturnToHref(initialReturnTo);
  const returnActionLabel = returnToPresetsHref === "/studio" ? "Back to Studio" : "Back to presets";
  const accentCardClassName = "admin-surface-accent p-4 sm:p-5";
  const thumbnailPickerItems: GeneratedThumbnailPickerItem[] = thumbnailAssets.map((asset) => {
    const id = String(asset.asset_id);
    return {
      id,
      previewUrl: generatedThumbnailPreviewUrl(asset),
      ariaLabel: `Use generated image ${id} as preset thumbnail`,
    };
  });

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
      choice_groups_json: [],
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

  async function uploadThumbnail(file: File) {
    setIsUploadingThumbnail(true);
    const formData = new FormData();
    formData.set("file", file);
    formData.set("presetLabel", presetForm.label || "preset-thumbnail");

    const response = await fetch("/api/control/media-preset-thumbnail", {
      method: "POST",
      body: formData,
    });
    const result = (await response.json()) as {
      ok?: boolean;
      error?: string;
      thumbnail_path?: string;
      thumbnail_url?: string;
    };

    setIsUploadingThumbnail(false);
    if (!response.ok || result.ok === false || !result.thumbnail_url || !result.thumbnail_path) {
      showNotice("danger", result.error ?? "Unable to upload the preset thumbnail.");
      return;
    }

    setPresetForm((current) => ({
      ...current,
      thumbnailPath: result.thumbnail_path ?? current.thumbnailPath,
      thumbnailUrl: result.thumbnail_url ?? current.thumbnailUrl,
    }));
    showNotice("healthy", "Thumbnail uploaded.");
  }

  async function loadThumbnailAssets({ append = false }: { append?: boolean } = {}) {
    const nextOffset = append ? thumbnailAssetsNextOffset : 0;
    if (append && nextOffset == null) {
      return;
    }
    if (append) {
      setThumbnailAssetsLoadingMore(true);
    } else {
      setThumbnailAssetsLoading(true);
      setThumbnailAssetsNextOffset(null);
      setThumbnailPickerOpen(true);
    }
    try {
      const response = await fetch(
        `/api/control/media-assets?limit=24&offset=${append ? nextOffset ?? 0 : 0}&generation_kind=image`,
      );
      const result = (await response.json()) as {
        ok?: boolean;
        error?: string;
        assets?: MediaAsset[];
        next_offset?: number | null;
      };
      if (!response.ok || result.ok === false || !Array.isArray(result.assets)) {
        showNotice("danger", result.error ?? "Unable to load generated images for thumbnail selection.");
        return;
      }
      const nextAssets = result.assets.filter((asset) => Boolean(generatedThumbnailPreviewUrl(asset)));
      setThumbnailAssets((current) => {
        if (!append) {
          return nextAssets;
        }
        const seen = new Set(current.map((asset) => String(asset.asset_id)));
        return current.concat(nextAssets.filter((asset) => !seen.has(String(asset.asset_id))));
      });
      setThumbnailAssetsNextOffset(typeof result.next_offset === "number" ? result.next_offset : null);
    } catch {
      showNotice("danger", "Unable to load generated images for thumbnail selection right now.");
    } finally {
      if (append) {
        setThumbnailAssetsLoadingMore(false);
      } else {
        setThumbnailAssetsLoading(false);
      }
    }
  }

  async function applyThumbnailFromAsset(assetId: string | number) {
    setThumbnailAssetSelectionId(String(assetId));
    try {
      const response = await fetch("/api/control/media-preset-thumbnail/from-asset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asset_id: assetId,
          presetLabel: presetForm.label || "preset-thumbnail",
        }),
      });
      const result = (await response.json()) as {
        ok?: boolean;
        error?: string;
        thumbnail_path?: string;
        thumbnail_url?: string;
      };
      if (!response.ok || result.ok === false || !result.thumbnail_path || !result.thumbnail_url) {
        showNotice("danger", result.error ?? "Unable to use that generated image as the preset thumbnail.");
        return;
      }
      setPresetForm((current) => ({
        ...current,
        thumbnailPath: result.thumbnail_path ?? "",
        thumbnailUrl: result.thumbnail_url ?? "",
      }));
      setThumbnailPickerOpen(false);
      showNotice("healthy", "Thumbnail selected from generated images.");
    } catch {
      showNotice("danger", "Unable to use that generated image as the preset thumbnail right now.");
    } finally {
      setThumbnailAssetSelectionId(null);
    }
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
            <div className={accentCardClassName}>
              <div className="mb-4">
                <div className="admin-label-accent">
                  Preset Basics
                </div>
                <p className="mt-2 text-sm leading-7 text-[var(--muted-strong)]">
                  Define the operator-facing identity for this preset first, then configure how it should appear in Studio.
                </p>
              </div>
              <div className="grid gap-3">
                <AdminInput
                  ref={presetNameInputRef}
                  value={presetForm.label}
                  onChange={(event) =>
                    setPresetForm((current) => ({
                      ...current,
                      label: event.target.value,
                      key: current.presetId ? current.key : "",
                    }))
                  }
                  placeholder="Preset name"
                />
                <AdminTextarea
                  value={presetForm.description}
                  onChange={(event) => setPresetForm((current) => ({ ...current, description: event.target.value }))}
                  placeholder="Short description of what this preset does"
                  className="min-h-[96px] sm:min-h-[108px]"
                />
                <ThumbnailField
                  label="Thumbnail"
                  imageUrl={presetForm.thumbnailUrl}
                  imageAlt={presetForm.label || "Preset thumbnail"}
                  emptyLabel="No thumbnail"
                  inputRef={thumbnailInputRef}
                  isUploading={isUploadingThumbnail}
                  isBrowsing={thumbnailAssetsLoading}
                  chooseLabel="Choose from generated images"
                  browseLabel="Browse generated images"
                  uploadLabel="Upload thumbnail"
                  removeLabel="Remove thumbnail"
                  onChoose={() => void loadThumbnailAssets()}
                  onUploadFile={(file) => void uploadThumbnail(file)}
                  onRemove={() => setPresetForm((current) => ({ ...current, thumbnailPath: "", thumbnailUrl: "" }))}
                  surface={false}
                />
              </div>
            </div>

            <div className="grid gap-5">
              <div className={accentCardClassName}>
                <div className="admin-label-accent">
                  Availability
                </div>
                <div className="mt-4 grid gap-4">
                  <div className="grid gap-3 lg:grid-cols-2">
                    <label className="admin-toggle-row text-sm">
                      <span>Enable this preset</span>
                      <AdminToggle
                        checked={presetForm.status === "active"}
                        ariaLabel="Enable this preset"
                        onToggle={() =>
                          setPresetForm((current) => ({
                            ...current,
                            status: current.status === "active" ? "inactive" : "active",
                          }))
                        }
                      />
                    </label>

                    <div className="admin-summary-card text-sm">
                      <div className="admin-label-muted">
                        Snapshot
                      </div>
                      <div className="mt-2 leading-6 text-[var(--foreground)]">
                        {generatedPresetKey || "pending key"} · {presetForm.inputFields.length} text field{presetForm.inputFields.length === 1 ? "" : "s"} · {presetForm.imageSlots.length} image slot{presetForm.imageSlots.length === 1 ? "" : "s"}
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-2">
                    <div className="admin-label-muted">
                      Available in
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {compatiblePresetModels.map((model) => (
                        <label
                          key={model.key}
                          className="admin-toggle-row text-sm"
                        >
                          <span>{model.label}</span>
                          <AdminToggle
                            checked={presetForm.appliesToModels.includes(model.key)}
                            ariaLabel={`Use preset in ${model.label}`}
                            onToggle={() =>
                              setPresetForm((current) => ({
                                ...current,
                                appliesToModels: current.appliesToModels.includes(model.key)
                                  ? current.appliesToModels.filter((value) => value !== model.key)
                                  : Array.from(new Set([...current.appliesToModels, model.key])),
                              }))
                            }
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className={accentCardClassName}>
            <div className="admin-label-accent">
              Prompt Template
            </div>
            <p className="mt-2 text-sm leading-7 text-[var(--muted-strong)]">
              Use <span className="font-medium text-[var(--foreground)]">{"{{field_key}}"}</span> for text fields and{" "}
              <span className="font-medium text-[var(--foreground)]">{"[[image_slot_key]]"}</span> for image slots.
            </p>
            <div className="mt-4">
              <AdminTextarea
                value={presetForm.promptTemplate}
                onChange={(event) => setPresetForm((current) => ({ ...current, promptTemplate: event.target.value }))}
                placeholder="Write the final prompt template using {{field_key}} and [[image_slot_key]]."
                className="min-h-[180px] sm:min-h-[220px]"
              />
            </div>
            <div className="admin-summary-card mt-4 p-3.5 sm:p-4">
              <div className="admin-label-muted">
                Token rules
              </div>
              <div className="mt-3 space-y-3 text-sm leading-7 text-[var(--muted-strong)]">
                <p>Every configured text field must appear in the prompt template.</p>
                <p>Every configured image slot must appear in the prompt template.</p>
                <p>Unused fields or slots will block saving.</p>
              </div>
            </div>
          </div>

          <div className={accentCardClassName}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="admin-label-muted">
                  Text fields
                </div>
                <div className="mt-1 text-sm text-[var(--muted-strong)]">
                  Single-line text fields only.
                </div>
              </div>
              <AdminButton
                onClick={() =>
                  setPresetForm((current) => ({
                    ...current,
                    inputFields: [...current.inputFields, createPresetFieldInput()],
                  }))
                }
                size="compact"
              >
                Add Text Field
              </AdminButton>
            </div>
            {presetForm.inputFields.length ? (
              <div className="mt-4 grid gap-3">
                {presetForm.inputFields.map((field, index) => (
                  <CollapsibleSubsection
                    key={field.id}
                    title={`Field ${index + 1}`}
                    description="Define the key, label, placeholder, and whether the field is required."
                    tone="media"
                    defaultOpen
                    className="px-4 py-4"
                    bodyClassName="admin-form-stack border-t border-[var(--surface-border-soft)] pt-4"
                    badge={
                      <AdminButton
                        size="compact"
                        onClick={() =>
                          setPresetForm((current) => ({
                            ...current,
                            inputFields: current.inputFields.filter((entry) => entry.id !== field.id),
                          }))
                        }
                      >
                        Remove
                      </AdminButton>
                    }
                  >
                    <div className="text-sm text-[var(--muted-strong)]">
                      Use the field key in the prompt as <span className="font-medium text-[var(--foreground)]">{presetFieldKeyToken(normalizePresetFieldKey(field.key) || "field_key")}</span>.
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <AdminInput
                        value={field.key}
                        onChange={(event) =>
                          setPresetForm((current) => ({
                            ...current,
                            inputFields: current.inputFields.map((entry) =>
                              entry.id === field.id
                                ? { ...entry, key: normalizePresetFieldKey(event.target.value) }
                                : entry,
                            ),
                          }))
                        }
                        placeholder="field key"
                      />
                      <AdminInput
                        value={field.label}
                        onChange={(event) =>
                          setPresetForm((current) => ({
                            ...current,
                            inputFields: current.inputFields.map((entry) =>
                              entry.id === field.id ? { ...entry, label: event.target.value } : entry,
                            ),
                          }))
                        }
                        placeholder="Field label"
                      />
                      <AdminInput
                        value={field.placeholder}
                        onChange={(event) =>
                          setPresetForm((current) => ({
                            ...current,
                            inputFields: current.inputFields.map((entry) =>
                              entry.id === field.id ? { ...entry, placeholder: event.target.value } : entry,
                            ),
                          }))
                        }
                        placeholder="Placeholder text"
                      />
                      <AdminInput
                        value={field.defaultValue}
                        onChange={(event) =>
                          setPresetForm((current) => ({
                            ...current,
                            inputFields: current.inputFields.map((entry) =>
                              entry.id === field.id ? { ...entry, defaultValue: event.target.value } : entry,
                            ),
                          }))
                        }
                        placeholder="Optional default value"
                      />
                    </div>
                    <label className="admin-toggle-row text-sm">
                      <span>Required field</span>
                      <AdminToggle
                        checked={field.required}
                        ariaLabel={`Required field ${index + 1}`}
                        onToggle={() =>
                          setPresetForm((current) => ({
                            ...current,
                            inputFields: current.inputFields.map((entry) =>
                              entry.id === field.id ? { ...entry, required: !entry.required } : entry,
                            ),
                          }))
                        }
                      />
                    </label>
                  </CollapsibleSubsection>
                ))}
              </div>
            ) : (
              <div className="admin-empty-state mt-4 text-sm">
                No text fields configured yet.
              </div>
            )}
          </div>

          <div className={accentCardClassName}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="admin-label-muted">
                  Reference image slots
                </div>
                <div className="mt-1 text-sm text-[var(--muted-strong)]">
                  Each slot becomes one named image requirement in Studio.
                </div>
              </div>
              <AdminButton
                onClick={() =>
                  setPresetForm((current) => ({
                    ...current,
                    imageSlots: [...current.imageSlots, createPresetImageSlot()],
                  }))
                }
                size="compact"
              >
                Add Image Slot
              </AdminButton>
            </div>
            {presetForm.imageSlots.length ? (
              <div className="mt-4 grid gap-3">
                {presetForm.imageSlots.map((slot, index) => (
                  <CollapsibleSubsection
                    key={slot.id}
                    title={`Image slot ${index + 1}`}
                    description="Define the slot key, label, help text, and whether the image is required."
                    tone="media"
                    defaultOpen
                    className="px-4 py-4"
                    bodyClassName="admin-form-stack border-t border-[var(--surface-border-soft)] pt-4"
                    badge={
                      <AdminButton
                        size="compact"
                        onClick={() =>
                          setPresetForm((current) => ({
                            ...current,
                            imageSlots: current.imageSlots.filter((entry) => entry.id !== slot.id),
                          }))
                        }
                      >
                        Remove
                      </AdminButton>
                    }
                  >
                    <div className="text-sm text-[var(--muted-strong)]">
                      Use the slot key in the prompt as <span className="font-medium text-[var(--foreground)]">{presetSlotKeyToken(normalizePresetFieldKey(slot.key) || "image_slot_key")}</span>.
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <AdminInput
                        value={slot.key}
                        onChange={(event) =>
                          setPresetForm((current) => ({
                            ...current,
                            imageSlots: current.imageSlots.map((entry) =>
                              entry.id === slot.id
                                ? { ...entry, key: normalizePresetFieldKey(event.target.value) }
                                : entry,
                            ),
                          }))
                        }
                        placeholder="slot key"
                      />
                      <AdminInput
                        value={slot.label}
                        onChange={(event) =>
                          setPresetForm((current) => ({
                            ...current,
                            imageSlots: current.imageSlots.map((entry) =>
                              entry.id === slot.id ? { ...entry, label: event.target.value } : entry,
                            ),
                          }))
                        }
                        placeholder="Slot label"
                      />
                      <AdminInput
                        value={String(slot.maxFiles)}
                        onChange={(event) =>
                          setPresetForm((current) => ({
                            ...current,
                            imageSlots: current.imageSlots.map((entry) =>
                              entry.id === slot.id
                                ? { ...entry, maxFiles: Math.max(1, Number(event.target.value) || 1) }
                                : entry,
                            ),
                          }))
                        }
                        placeholder="1"
                      />
                      <AdminInput
                        value={slot.helpText}
                        onChange={(event) =>
                          setPresetForm((current) => ({
                            ...current,
                            imageSlots: current.imageSlots.map((entry) =>
                              entry.id === slot.id ? { ...entry, helpText: event.target.value } : entry,
                            ),
                          }))
                        }
                        placeholder="Help text shown to the operator"
                      />
                    </div>
                    <label className="admin-toggle-row text-sm">
                      <span>Required image</span>
                      <AdminToggle
                        checked={slot.required}
                        ariaLabel={`Required image slot ${index + 1}`}
                        onToggle={() =>
                          setPresetForm((current) => ({
                            ...current,
                            imageSlots: current.imageSlots.map((entry) =>
                              entry.id === slot.id ? { ...entry, required: !entry.required } : entry,
                            ),
                          }))
                        }
                      />
                    </label>
                  </CollapsibleSubsection>
                ))}
              </div>
            ) : (
              <div className="admin-empty-state mt-4 text-sm">
                No image slots configured yet.
              </div>
            )}
          </div>

          <div className={accentCardClassName}>
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
              <div>
                <div className="admin-label-muted">
                  Notes
                </div>
                <AdminTextarea
                  value={presetForm.notes}
                  onChange={(event) => setPresetForm((current) => ({ ...current, notes: event.target.value }))}
                  placeholder="Notes for operators, edge cases, or anything the next person should know."
                  className="mt-3 min-h-[96px]"
                />
              </div>
              <div className="grid w-full gap-3 sm:flex sm:w-auto sm:flex-wrap xl:justify-end">
                {presetForm.presetId ? (
                  <AdminButton
                    onClick={() => void exportPreset()}
                    disabled={isExporting}
                    className="w-full sm:w-auto"
                  >
                    {isExporting ? "Exporting..." : "Export Preset"}
                  </AdminButton>
                ) : null}
                <AdminButton
                  onClick={() => void savePreset()}
                  disabled={isSaving}
                  className="w-full sm:w-auto"
                >
                  {presetForm.presetId ? "Save preset" : "Create preset"}
                </AdminButton>
                {presetForm.presetId ? (
                  <AdminButton
                    onClick={() => void archivePreset()}
                    variant="danger"
                    className="w-full px-4 py-3 text-sm normal-case tracking-normal sm:w-auto"
                  >
                    Archive
                  </AdminButton>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </Panel>

      <GeneratedThumbnailPickerDialog
        open={thumbnailPickerOpen}
        dialogLabel="Generated image thumbnails"
        title="Choose a thumbnail"
        description="Pick a recent generated image to use as this preset thumbnail."
        items={thumbnailPickerItems}
        loading={thumbnailAssetsLoading}
        loadingMore={thumbnailAssetsLoadingMore}
        nextOffset={thumbnailAssetsNextOffset}
        selectionId={thumbnailAssetSelectionId}
        onClose={() => setThumbnailPickerOpen(false)}
        onLoadMore={() => void loadThumbnailAssets({ append: true })}
        onSelectItem={(assetId) => void applyThumbnailFromAsset(assetId)}
      />
    </div>
  );
}
