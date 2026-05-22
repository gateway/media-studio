"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { adminThemeLayoutClassName, adminThemeLayoutOverflowClassName } from "@/components/admin-theme";
import { AdminActionNotice } from "@/components/admin-action-notice";
import { MediaModelAvailabilityPanel } from "@/components/media-models/media-model-availability-panel";
import { MediaModelSetupPanel } from "@/components/media-models/media-model-setup-panel";
import { MediaModelsQueueSettingsPanel } from "@/components/media-models/media-models-queue-settings-panel";
import { MediaModelSystemPromptPanel } from "@/components/media-models/media-model-system-prompt-panel";
import { MediaOutputFolderPanel } from "@/components/media-models/media-output-folder-panel";
import { MediaPresetsPanel } from "@/components/media-models/media-presets-panel";
import type { EnhancementProfileFormState } from "@/components/media-models/media-models-console-types";
import { StudioEnhancementSettingsPanel } from "@/components/settings/studio-enhancement-settings-panel";
import { useAdminActionNotice } from "@/hooks/use-admin-action-notice";
import { invalidateGraphNodeDefinitions } from "@/lib/graph-node-definitions-sync";
import {
  openMediaOutputsFolderRequest,
  saveEnhancementConfigRequest,
  saveGlobalQueueSettingsRequest,
  saveModelQueuePolicyRequest,
  upsertEnhancementConfigEntry,
  upsertQueuePolicyEntry,
} from "@/lib/media-model-admin";
import { STUDIO_NANO_MAX_OUTPUTS } from "@/lib/media-studio-helpers";
import type {
  MediaEnhancementConfig,
  MediaModelQueuePolicy,
  MediaModelSummary,
  MediaPreset,
  MediaQueueSettings,
} from "@/lib/types";
import { cn } from "@/lib/utils";

type MediaModelsConsoleProps = {
  models: MediaModelSummary[];
  presets: MediaPreset[];
  enhancementConfigs: MediaEnhancementConfig[];
  queueSettings?: MediaQueueSettings | null;
  queuePolicies?: MediaModelQueuePolicy[];
  initialSelectedModelKey?: string;
  variant?: "default" | "studio";
  sections?: {
    queue?: boolean;
    enhancementProvider?: boolean;
    modelHelper?: boolean;
    studioSettings?: boolean;
    modelPanel?: boolean;
    presets?: boolean;
  };
};

function emptyEnhancementProfileForm(modelKey: string): EnhancementProfileFormState {
  return {
    label: `${modelKey} enhancement`,
    status: "active",
    systemPrompt: "",
    imageAnalysisPrompt: "",
    supportsTextEnhancement: true,
    supportsImageAnalysis: false,
    notes: "",
  };
}

function isMobileControlDevice() {
  if (typeof navigator === "undefined" || typeof window === "undefined") {
    return false;
  }
  return window.matchMedia?.("(pointer: coarse)").matches || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
}

const MEDIA_OUTPUTS_PATH = process.env.NEXT_PUBLIC_MEDIA_STUDIO_OUTPUTS_PATH || "data/outputs";
const GLOBAL_ENHANCEMENT_CONFIG_KEY = "__studio_enhancement__";

export function MediaModelsConsole({
  models,
  presets,
  enhancementConfigs,
  queueSettings,
  queuePolicies = [],
  initialSelectedModelKey,
  variant = "default",
  sections,
}: MediaModelsConsoleProps) {
  const router = useRouter();
  const [selectedModelKey, setSelectedModelKey] = useState(initialSelectedModelKey ?? models[0]?.key ?? "nano-banana-2");
  const [selectedEnhancementModelKey, setSelectedEnhancementModelKey] = useState(models[0]?.key ?? "nano-banana-2");
  const [localPresets, setLocalPresets] = useState<MediaPreset[]>(presets);
  const [localEnhancementConfigs, setLocalEnhancementConfigs] = useState<MediaEnhancementConfig[]>(enhancementConfigs);
  const [enhancementProfileForm, setEnhancementProfileForm] = useState<EnhancementProfileFormState>(
    emptyEnhancementProfileForm(models[0]?.key ?? "nano-banana-2"),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [isImportingPreset, setIsImportingPreset] = useState(false);
  const [mobileControlDevice, setMobileControlDevice] = useState(false);
  const [localQueueSettings, setLocalQueueSettings] = useState<MediaQueueSettings | null>(queueSettings ?? null);
  const [localQueuePolicies, setLocalQueuePolicies] = useState<MediaModelQueuePolicy[]>(queuePolicies);
  const { notice: message, showNotice, clearNotice } = useAdminActionNotice();
  const presetImportInputRef = useRef<HTMLInputElement | null>(null);
  const presetsSignature = useMemo(() => JSON.stringify(presets), [presets]);
  const enhancementConfigsSignature = useMemo(() => JSON.stringify(enhancementConfigs), [enhancementConfigs]);
  const queueSettingsSignature = useMemo(() => JSON.stringify(queueSettings ?? null), [queueSettings]);
  const queuePoliciesSignature = useMemo(() => JSON.stringify(queuePolicies), [queuePolicies]);

  const selectedModel = models.find((model) => model.key === selectedModelKey) ?? models[0] ?? null;
  const globalEnhancementConfig =
    localEnhancementConfigs.find((config) => config.model_key === GLOBAL_ENHANCEMENT_CONFIG_KEY) ??
    localEnhancementConfigs.find((config) => config.provider_model_id || (config.provider_kind && config.provider_kind !== "builtin")) ??
    null;
  const currentModelEnhancementConfig =
    localEnhancementConfigs.find((config) => config.model_key === selectedEnhancementModelKey) ?? null;
  const currentQueuePolicy = localQueuePolicies.find((policy) => policy.model_key === selectedModelKey) ?? null;
  const modelAvailabilityRows = useMemo(
    () =>
      models.map((model) => {
        const policy = localQueuePolicies.find((entry) => entry.model_key === model.key) ?? null;
        return {
          model,
          policy,
          enabled: policy?.enabled ?? true,
        };
      }),
    [localQueuePolicies, models],
  );
  const isStudio = variant === "studio";
  const visibleSections = {
    queue: sections?.queue ?? true,
    enhancementProvider: sections?.enhancementProvider ?? true,
    modelHelper: sections?.modelHelper ?? true,
    studioSettings: sections?.studioSettings ?? true,
    modelPanel: sections?.modelPanel ?? true,
    presets: sections?.presets ?? true,
  };
  const rootClassName = isStudio ? adminThemeLayoutOverflowClassName : adminThemeLayoutClassName;

  useEffect(() => {
    if (!initialSelectedModelKey) {
      return;
    }
    if (!models.some((model) => model.key === initialSelectedModelKey)) {
      return;
    }
    setSelectedModelKey(initialSelectedModelKey);
  }, [initialSelectedModelKey, models]);

  useEffect(() => {
    setSelectedEnhancementModelKey(selectedModelKey);
  }, [selectedModelKey]);

  useEffect(() => {
    setLocalPresets((current) => (JSON.stringify(current) === presetsSignature ? current : presets));
  }, [presets, presetsSignature]);

  useEffect(() => {
    setLocalEnhancementConfigs((current) => (JSON.stringify(current) === enhancementConfigsSignature ? current : enhancementConfigs));
  }, [enhancementConfigs, enhancementConfigsSignature]);

  useEffect(() => {
    setLocalQueueSettings((current) => (JSON.stringify(current) === queueSettingsSignature ? current : queueSettings ?? null));
  }, [queueSettings, queueSettingsSignature]);

  useEffect(() => {
    setLocalQueuePolicies((current) => (JSON.stringify(current) === queuePoliciesSignature ? current : queuePolicies));
  }, [queuePolicies, queuePoliciesSignature]);

  useEffect(() => {
    setMobileControlDevice(isMobileControlDevice());
  }, []);

  useEffect(() => {
    if (currentModelEnhancementConfig) {
      setEnhancementProfileForm({
        label: currentModelEnhancementConfig.label ?? `${selectedEnhancementModelKey} enhancement`,
        status: currentModelEnhancementConfig.status ?? "active",
        systemPrompt: currentModelEnhancementConfig.system_prompt ?? "",
        imageAnalysisPrompt: currentModelEnhancementConfig.image_analysis_prompt ?? "",
        supportsTextEnhancement: currentModelEnhancementConfig.supports_text_enhancement,
        supportsImageAnalysis: currentModelEnhancementConfig.supports_image_analysis,
        notes: currentModelEnhancementConfig.notes ?? "",
      });
    } else {
      setEnhancementProfileForm(emptyEnhancementProfileForm(selectedEnhancementModelKey));
    }
    clearNotice();
  }, [clearNotice, currentModelEnhancementConfig, selectedEnhancementModelKey]);

  async function importPresetBundle(file: File) {
    setIsImportingPreset(true);
    clearNotice();
    try {
      const formData = new FormData();
      formData.set("file", file);
      const response = await fetch("/api/control/media-presets/import", {
        method: "POST",
        body: formData,
      });
      const result = (await response.json()) as {
        ok?: boolean;
        error?: string;
        message?: string;
        status?: "skipped" | "created" | "copied";
        preset?: MediaPreset | null;
      };
      if (!response.ok || result.ok === false) {
        showNotice("danger", result.error ?? "Unable to import the preset.");
        return;
      }
      await invalidateGraphNodeDefinitions("media-preset-imported");
      if (result.preset) {
        const importedPreset = result.preset;
        setLocalPresets((current) => {
          const next = current.filter((preset) => preset.preset_id !== importedPreset.preset_id);
          return [importedPreset, ...next];
        });
      }
      showNotice("healthy", result.message ?? "Preset imported.");
      router.refresh();
    } catch {
      showNotice("danger", "Unable to import the preset.");
    } finally {
      setIsImportingPreset(false);
      if (presetImportInputRef.current) {
        presetImportInputRef.current.value = "";
      }
    }
  }

  async function saveModelEnhancementProfile() {
    setIsSaving(true);
    const existingConfig = localEnhancementConfigs.find((config) => config.model_key === selectedEnhancementModelKey) ?? null;
    const payload = {
      model_key: selectedEnhancementModelKey,
      label: enhancementProfileForm.label || `${selectedEnhancementModelKey} enhancement`,
      status: enhancementProfileForm.status,
      helper_profile: existingConfig?.helper_profile ?? globalEnhancementConfig?.helper_profile ?? "midctx-64k-no-thinking-q3-prefill",
      provider_kind: existingConfig?.provider_kind ?? "builtin",
      provider_label: existingConfig?.provider_label ?? null,
      provider_model_id: existingConfig?.provider_model_id ?? null,
      provider_supports_images: existingConfig?.provider_supports_images ?? false,
      provider_status: existingConfig?.provider_status ?? null,
      provider_last_tested_at: existingConfig?.provider_last_tested_at ?? null,
      provider_capabilities_json: existingConfig?.provider_capabilities_json ?? {},
      system_prompt: enhancementProfileForm.systemPrompt,
      image_analysis_prompt: enhancementProfileForm.imageAnalysisPrompt || null,
      supports_text_enhancement: enhancementProfileForm.supportsTextEnhancement,
      supports_image_analysis: enhancementProfileForm.supportsImageAnalysis,
      notes: enhancementProfileForm.notes || null,
    };
    const endpoint = existingConfig
      ? `/api/control/media-enhancement-configs/${selectedEnhancementModelKey}`
      : "/api/control/media-enhancement-configs";
    const method = existingConfig ? "PATCH" : "POST";
    const result = await saveEnhancementConfigRequest({ endpoint, method, payload });
    setIsSaving(false);
    if (!result.ok || !result.config) {
      showNotice("danger", result.error ?? "Unable to save the model enhancement profile.");
      return;
    }
    setLocalEnhancementConfigs((current) => upsertEnhancementConfigEntry(current, result.config as MediaEnhancementConfig));
    showNotice("healthy", `Model helper saved for ${selectedEnhancementModelKey}.`);
  }

  async function openMediaOutputsFolder() {
    clearNotice();
    const result = await openMediaOutputsFolderRequest();
    if (!result.ok) {
      showNotice("danger", result.error ?? "Unable to open the media outputs folder.");
      return;
    }
    showNotice("healthy", "Media output folder opened.");
  }

  async function saveGlobalQueueSettings(settings: MediaQueueSettings) {
    setIsSaving(true);
    const result = await saveGlobalQueueSettingsRequest(settings);
    setIsSaving(false);
    if (!result.ok || !result.settings) {
      showNotice("danger", result.error ?? "Unable to update the queue settings.");
      return;
    }
    setLocalQueueSettings(result.settings);
    showNotice("healthy", "Queue settings saved.");
  }

  async function saveModelQueuePolicy(maxOutputsPerRun: number) {
    const clampedValue = Math.min(Math.max(1, maxOutputsPerRun), STUDIO_NANO_MAX_OUTPUTS);
    const enabled = currentQueuePolicy?.enabled ?? true;
    setIsSaving(true);
    const result = await saveModelQueuePolicyRequest(selectedModelKey, enabled, clampedValue);
    setIsSaving(false);
    if (!result.ok || !result.policy) {
      showNotice("danger", result.error ?? "Unable to update the model queue policy.");
      return;
    }
    setLocalQueuePolicies((current) => upsertQueuePolicyEntry(current, result.policy as MediaModelQueuePolicy));
    showNotice("healthy", "Model settings saved.");
  }

  async function saveModelAvailability(modelKey: string, enabled: boolean) {
    const policy = localQueuePolicies.find((entry) => entry.model_key === modelKey) ?? null;
    const maxOutputsPerRun = policy?.max_outputs_per_run ?? 1;
    setIsSaving(true);
    const result = await saveModelQueuePolicyRequest(modelKey, enabled, maxOutputsPerRun);
    setIsSaving(false);
    if (!result.ok || !result.policy) {
      showNotice("danger", result.error ?? "Unable to update the model availability.");
      return;
    }
    setLocalQueuePolicies((current) => upsertQueuePolicyEntry(current, result.policy as MediaModelQueuePolicy));
    showNotice("healthy", enabled ? "Model enabled." : "Model disabled.");
  }

  return (
    <div className={rootClassName}>
      {message ? <AdminActionNotice tone={message.tone} text={message.text} /> : null}
      <input
        ref={presetImportInputRef}
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        onChange={(event) => {
          const selectedFile = event.target.files?.[0] ?? null;
          if (selectedFile) {
            void importPresetBundle(selectedFile);
          }
        }}
      />
      {message ? (
        <div
          className={cn(
            "admin-live-notice sr-only",
            message.tone === "healthy" ? "admin-live-notice-success" : "admin-live-notice-danger",
          )}
        >
          {message.text}
        </div>
      ) : null}

      {visibleSections.queue ? (
        <MediaModelsQueueSettingsPanel
          queueSettings={localQueueSettings}
          isSaving={isSaving}
          onQueueSettingsChange={setLocalQueueSettings}
          onSave={() =>
            void saveGlobalQueueSettings({
              max_concurrent_jobs: localQueueSettings?.max_concurrent_jobs ?? 10,
              queue_enabled: localQueueSettings?.queue_enabled ?? true,
              default_poll_seconds: localQueueSettings?.default_poll_seconds ?? 6,
              max_retry_attempts: localQueueSettings?.max_retry_attempts ?? 3,
              created_at: localQueueSettings?.created_at ?? null,
              updated_at: localQueueSettings?.updated_at ?? null,
            })
          }
        />
      ) : null}

      {visibleSections.enhancementProvider ? <StudioEnhancementSettingsPanel initialConfigs={localEnhancementConfigs} /> : null}

      {visibleSections.studioSettings ? (
        <MediaOutputFolderPanel
          mediaOutputsPath={MEDIA_OUTPUTS_PATH}
          mobileControlDevice={mobileControlDevice}
          onOpen={() => void openMediaOutputsFolder()}
        />
      ) : null}

      {visibleSections.queue && !visibleSections.modelPanel ? (
        <MediaModelAvailabilityPanel
          rows={modelAvailabilityRows}
          onToggleAvailability={(modelKey, enabled) => void saveModelAvailability(modelKey, enabled)}
        />
      ) : null}

      {visibleSections.modelPanel ? (
        <MediaModelSetupPanel
          models={models}
          selectedModelKey={selectedModelKey}
          onSelectedModelKeyChange={setSelectedModelKey}
          selectedModel={selectedModel}
          currentQueuePolicy={currentQueuePolicy}
          isSaving={isSaving}
          onToggleAvailability={() => void saveModelAvailability(selectedModelKey, !(currentQueuePolicy?.enabled ?? true))}
          onMaxOutputsChange={(nextValue) =>
            setLocalQueuePolicies((current) => {
              const next = current.filter((entry) => entry.model_key !== selectedModelKey);
              next.push({
                model_key: selectedModelKey,
                enabled: currentQueuePolicy?.enabled ?? true,
                max_outputs_per_run: nextValue,
                created_at: currentQueuePolicy?.created_at ?? null,
                updated_at: currentQueuePolicy?.updated_at ?? null,
              });
              return next.sort((left, right) => left.model_key.localeCompare(right.model_key));
            })
          }
          onSaveQueuePolicy={() => void saveModelQueuePolicy(currentQueuePolicy?.max_outputs_per_run ?? 1)}
        />
      ) : null}

      {visibleSections.modelHelper ? (
        <MediaModelSystemPromptPanel
          form={enhancementProfileForm}
          onChange={(patch) => setEnhancementProfileForm((current) => ({ ...current, ...patch }))}
          onSave={() => void saveModelEnhancementProfile()}
        />
      ) : null}

      {visibleSections.presets ? (
        <MediaPresetsPanel
          presets={localPresets}
          isImporting={isImportingPreset}
          onImportClick={() => presetImportInputRef.current?.click()}
        />
      ) : null}

      {isSaving ? <div className="text-xs uppercase tracking-[0.12em] text-[var(--muted-strong)]">Saving model media settings...</div> : null}
    </div>
  );
}
