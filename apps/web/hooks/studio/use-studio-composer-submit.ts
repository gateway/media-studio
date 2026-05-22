"use client";

import type { MutableRefObject } from "react";

import type { AttachmentRecord, ComposerStatusMessage } from "@/lib/media-studio-contract";
import {
  buildNormalizedStudioOptions,
  isCoarsePointerDevice,
  type MultiShotParseResult,
  type PresetSlotState,
  studioValidationReady,
  stripUnsupportedStudioOptions,
  type StructuredPresetImageSlot,
} from "@/lib/media-studio-helpers";
import { normalizeImageFileForUpload } from "@/lib/studio-composer-file-utils";
import { createOptimisticBatch } from "@/lib/studio-gallery";
import type {
  MediaBatch,
  MediaEnhancePreviewResponse,
  MediaJob,
  MediaModelSummary,
  MediaPreset,
  MediaValidationResponse,
} from "@/lib/types";

type BusyState = "idle" | "validate" | "submit";
type ComposerIntent = "validate" | "submit" | "enhance";

type UseStudioComposerSubmitOptions = {
  autoValidateTimerRef: MutableRefObject<number | null>;
  validationRequestIdRef: MutableRefObject<number>;
  currentModelEnabled: boolean;
  currentModel: MediaModelSummary | null;
  currentPreset: MediaPreset | null;
  currentPresetCompatibleWithModel: boolean;
  currentPresetDefaultOptions: Record<string, unknown> | null;
  selectedPresetId: string;
  modelKey: string;
  inferredInputPattern: string;
  optionValues: Record<string, unknown>;
  prompt: string;
  structuredPresetActive: boolean;
  structuredPresetPromptPreview: string;
  outputCount: number;
  selectedPromptIds: string[];
  seedanceComposer: boolean;
  effectiveSeedanceMode: string;
  multiShotsEnabled: boolean;
  multiShotScript: MultiShotParseResult;
  multiShotScriptError: string | null;
  presetRequirementError: string | null;
  projectId: string | null;
  presetInputValues: Record<string, string>;
  structuredPresetImageSlots: StructuredPresetImageSlot[];
  presetSlotStates: Record<string, PresetSlotState>;
  currentImageMaxBytes: number | null;
  sourceAssetId: string | number | null;
  attachments: AttachmentRecord[];
  enhanceSupportsImage: boolean;
  enhanceSupportsText: boolean;
  enhanceEnabledForModel: boolean;
  enhanceHasSavedSystemPrompt: boolean;
  enhanceConfiguredForModel: boolean;
  enhancementPreviewVisual: unknown;
  validationReady: boolean;
  maxConcurrentJobs: number;
  localBatches: MediaBatch[];
  setValidation: (value: MediaValidationResponse | null) => void;
  setFormMessage: React.Dispatch<React.SetStateAction<ComposerStatusMessage | null>>;
  setBusyState: (value: BusyState) => void;
  setEnhanceDialogOpen: (value: boolean) => void;
  setEnhancePreview: (value: MediaEnhancePreviewResponse | null) => void;
  setEnhanceError: (value: string | null) => void;
  setEnhanceBusy: (value: boolean) => void;
  setOptimisticBatches: React.Dispatch<React.SetStateAction<MediaBatch[]>>;
  setLocalJobs: React.Dispatch<React.SetStateAction<MediaJob[]>>;
  upsertBatch: (batch: MediaBatch) => void;
  setMobileComposerCollapsed: (value: boolean) => void;
  showActivity: (
    payload: { tone: "healthy" | "warning" | "danger"; message: string; spinning?: boolean },
    options?: { autoHideMs?: number },
  ) => void;
  showFloatingComposerBanner: (message: ComposerStatusMessage | null, autoHideMs?: number) => void;
  refreshCreditBalance: () => Promise<void>;
  pollJob: (jobId: string) => Promise<void>;
  pollBatch: (batchId: string) => Promise<void>;
};

export function useStudioComposerSubmit(options: UseStudioComposerSubmitOptions) {
  async function buildMediaFormData(intent: ComposerIntent) {
    const formData = new FormData();
    const includeEnhancementImages = intent !== "enhance" || options.enhanceSupportsImage;
    const normalizedOptions = buildNormalizedStudioOptions(
      options.currentModel,
      options.optionValues,
      options.currentPresetDefaultOptions,
    );
    const sanitizedOptions = stripUnsupportedStudioOptions(
      options.modelKey,
      options.inferredInputPattern,
      normalizedOptions,
    );
    const effectivePrompt = options.structuredPresetActive ? options.structuredPresetPromptPreview : options.prompt;
    formData.set("intent", intent);
    formData.set("model_key", options.modelKey);
    formData.set("prompt", effectivePrompt);
    formData.set("output_count", String(options.outputCount));
    formData.set("enhance", intent === "enhance" ? "true" : "false");
    formData.set("options", JSON.stringify(sanitizedOptions));
    formData.set("system_prompt_ids", JSON.stringify(options.selectedPromptIds));
    if (options.seedanceComposer) {
      formData.set("task_mode", options.effectiveSeedanceMode === "prompt_only" ? "text_to_video" : "reference_to_video");
    }
    if (options.multiShotsEnabled && options.multiShotScript.shots.length) {
      formData.set("multi_prompt", JSON.stringify(options.multiShotScript.shots));
    }
    if (options.currentPresetCompatibleWithModel && options.currentPreset) {
      if (options.currentPreset.source_kind === "builtin") {
        formData.set("preset_key", options.currentPreset.key);
      } else {
        formData.set("preset_id", options.currentPreset.preset_id ?? options.selectedPresetId);
      }
    }
    if (options.projectId) {
      formData.set("project_id", options.projectId);
    }
    if (options.structuredPresetActive) {
      formData.set("preset_inputs_json", JSON.stringify(options.presetInputValues));
      const presetSlotValues: Record<string, Array<Record<string, unknown>>> = {};
      for (const slot of options.structuredPresetImageSlots) {
        const slotState = options.presetSlotStates[slot.key];
        if (!slotState) {
          continue;
        }
        if (slotState.assetId && includeEnhancementImages) {
          presetSlotValues[slot.key] = [{ asset_id: slotState.assetId }];
          formData.set(`preset_slot_asset:${slot.key}`, String(slotState.assetId));
        }
        if (slotState.referenceId && includeEnhancementImages) {
          presetSlotValues[slot.key] = [{ reference_id: slotState.referenceId }];
        }
        if (slotState.file && includeEnhancementImages) {
          const preparedFile =
            options.currentImageMaxBytes && slotState.file.type.startsWith("image/")
              ? await normalizeImageFileForUpload(slotState.file, options.currentImageMaxBytes)
              : slotState.file;
          formData.append(`preset_slot_file:${slot.key}`, preparedFile);
        }
      }
      formData.set("preset_slot_values_json", JSON.stringify(presetSlotValues));
    }
    if (!options.structuredPresetActive && options.sourceAssetId && !options.seedanceComposer && includeEnhancementImages) {
      formData.set("source_asset_id", String(options.sourceAssetId));
    }
    if (!options.structuredPresetActive) {
      formData.set(
        "attachment_manifest",
        JSON.stringify(
          options.attachments.map((attachment) => ({
            id: attachment.id,
            kind: attachment.kind,
            role: attachment.role ?? null,
            duration_seconds: attachment.durationSeconds ?? null,
            reference_id: attachment.referenceId ?? null,
            has_file: Boolean(attachment.file),
          })),
        ),
      );
      if (includeEnhancementImages) {
        for (const attachment of options.attachments) {
          if (attachment.file) {
            const preparedFile =
              options.currentImageMaxBytes && attachment.kind === "images"
                ? await normalizeImageFileForUpload(attachment.file, options.currentImageMaxBytes)
                : attachment.file;
            formData.append("attachments", preparedFile);
          }
        }
      }
    }
    return formData;
  }

  async function requestEnhancementPreview() {
    if (
      (!options.structuredPresetActive && !options.prompt.trim() && !options.attachments.length && !options.sourceAssetId) ||
      (options.structuredPresetActive && !options.structuredPresetPromptPreview.trim())
    ) {
      options.setEnhanceDialogOpen(true);
      options.setEnhancePreview(null);
      options.setEnhanceError("Add a prompt or a source image before running Enhance.");
      return;
    }
    if (!options.enhanceEnabledForModel) {
      options.setEnhanceDialogOpen(true);
      options.setEnhancePreview(null);
      options.setEnhanceError("This model does not have enhancement enabled.");
      return;
    }
    if (!options.enhanceHasSavedSystemPrompt) {
      options.setEnhanceDialogOpen(true);
      options.setEnhancePreview(null);
      options.setEnhanceError("Save an enhancement system prompt in Models before using Enhance.");
      return;
    }
    if (!options.enhanceConfiguredForModel) {
      options.setEnhanceDialogOpen(true);
      options.setEnhancePreview(null);
      options.setEnhanceError("Set up prompt enhancement in Settings before using Enhance.");
      return;
    }
    if (!options.enhanceSupportsText && !options.enhancementPreviewVisual) {
      options.setEnhanceDialogOpen(true);
      options.setEnhancePreview(null);
      options.setEnhanceError("Add an image before running image-guided enhancement.");
      return;
    }
    if (options.multiShotScriptError) {
      options.setEnhanceDialogOpen(true);
      options.setEnhancePreview(null);
      options.setEnhanceError(options.multiShotScriptError);
      return;
    }
    if (options.presetRequirementError) {
      options.setEnhanceDialogOpen(true);
      options.setEnhancePreview(null);
      options.setEnhanceError(options.presetRequirementError);
      return;
    }
    options.setEnhanceDialogOpen(true);
    options.setEnhanceBusy(true);
    options.setEnhanceError(null);
    options.showActivity({ tone: "warning", message: "Building the enhancement preview.", spinning: true });
    const controller = new AbortController();
    const requestTimeout = window.setTimeout(() => controller.abort(), 90000);
    try {
      const response = await fetch("/api/control/media-enhance", {
        method: "POST",
        body: await buildMediaFormData("enhance"),
        signal: controller.signal,
      });
      const payload = (await response.json()) as { ok: false; error?: string } | { ok: true; preview?: MediaEnhancePreviewResponse };
      if (!response.ok || !payload.ok) {
        const errorMessage = "error" in payload ? payload.error ?? "Unable to enhance the prompt." : "Unable to enhance the prompt.";
        options.setEnhancePreview(null);
        options.setEnhanceError(errorMessage);
        options.showActivity({ tone: "danger", message: errorMessage }, { autoHideMs: 4200 });
        return;
      }
      options.setEnhancePreview(payload.preview ?? null);
      options.showActivity({ tone: "healthy", message: "Enhancement preview is ready." }, { autoHideMs: 2200 });
    } catch (error) {
      options.setEnhancePreview(null);
      const errorMessage =
        error instanceof DOMException && error.name === "AbortError"
          ? "Enhancement timed out. Check the provider in Settings and try again."
          : "Studio could not reach the enhancement preview route.";
      options.setEnhanceError(errorMessage);
      options.showActivity({ tone: "danger", message: errorMessage }, { autoHideMs: 4200 });
    } finally {
      window.clearTimeout(requestTimeout);
      options.setEnhanceBusy(false);
    }
  }

  function openEnhanceDialog() {
    options.setEnhanceDialogOpen(true);
    options.setEnhanceError(null);
    options.setEnhancePreview(null);
  }

  async function requestValidation({ silent = false }: { silent?: boolean } = {}) {
    if (options.autoValidateTimerRef.current) {
      window.clearTimeout(options.autoValidateTimerRef.current);
      options.autoValidateTimerRef.current = null;
    }
    if (!options.currentModelEnabled) {
      options.setValidation(null);
      if (!silent) {
        options.setFormMessage({ tone: "danger", text: "This model is disabled in Settings. Re-enable it before validating." });
      }
      return null;
    }
    if (
      (!options.structuredPresetActive && !options.prompt.trim() && !options.attachments.length && !options.sourceAssetId) ||
      (options.structuredPresetActive && !options.structuredPresetPromptPreview.trim())
    ) {
      options.setValidation(null);
      return null;
    }
    if (options.multiShotScriptError) {
      options.setValidation(null);
      if (!silent) {
        options.setFormMessage({ tone: "danger", text: options.multiShotScriptError });
      }
      return null;
    }
    if (options.presetRequirementError) {
      options.setValidation(null);
      if (!silent) {
        options.setFormMessage({ tone: "danger", text: options.presetRequirementError });
      }
      return null;
    }
    const requestId = options.validationRequestIdRef.current + 1;
    options.validationRequestIdRef.current = requestId;
    if (!silent) {
      options.setBusyState("validate");
      options.setFormMessage(null);
    }
    try {
      const response = await fetch("/api/control/media", {
        method: "POST",
        body: await buildMediaFormData("validate"),
      });
      const payload = (await response.json()) as
        | { ok: false; error?: string }
        | { ok: true; validation?: MediaValidationResponse; success?: string };
      if (requestId !== options.validationRequestIdRef.current) {
        return null;
      }
      if (!response.ok || !payload.ok) {
        if (!silent) {
          options.setFormMessage({
            tone: "danger",
            text: "error" in payload ? payload.error ?? "Media request failed." : "Media request failed.",
          });
        }
        return null;
      }
      options.setValidation(payload.validation ?? null);
      if (!silent) {
        options.setFormMessage({ tone: "healthy", text: payload.success ?? "Estimate ready." });
      }
      return payload.validation ?? null;
    } catch {
      if (!silent) {
        options.setFormMessage({ tone: "danger", text: "Studio could not reach the local media service." });
      }
      return null;
    } finally {
      if (!silent) {
        options.setBusyState("idle");
      }
    }
  }

  async function submitMedia(intent: "validate" | "submit") {
    if (!options.currentModelEnabled) {
      options.setFormMessage({ tone: "danger", text: "This model is disabled in Settings. Re-enable it before generating." });
      return;
    }
    if (intent === "validate") {
      await requestValidation({ silent: false });
      return;
    }
    options.showActivity(
      {
        tone: "warning",
        message: options.validationReady ? "Sending your render to Studio." : "Checking your request before submit.",
        spinning: true,
      },
      { autoHideMs: 2200 },
    );
    if (!options.validationReady) {
      const nextValidation = await requestValidation({ silent: false });
      if (!studioValidationReady(nextValidation)) {
        return;
      }
    }
    if (options.multiShotScriptError) {
      options.setFormMessage({ tone: "danger", text: options.multiShotScriptError });
      return;
    }
    if (options.presetRequirementError) {
      options.setFormMessage({ tone: "danger", text: options.presetRequirementError });
      return;
    }
    const optimisticBatch = createOptimisticBatch({
      modelKey: options.modelKey,
      taskMode: typeof options.currentModel?.task_modes?.[0] === "string" ? options.currentModel.task_modes[0] : null,
      requestedOutputs: Math.max(1, options.outputCount),
      sourceAssetId: options.sourceAssetId,
      requestedPresetKey: options.currentPreset?.key ?? null,
      promptSummary: ((options.structuredPresetActive ? options.structuredPresetPromptPreview : options.prompt).trim() || "Preparing media generation.").slice(0, 240),
      runningSlotsAvailable: Math.max(
        0,
        options.maxConcurrentJobs -
          options.localBatches.reduce(
            (sum, batch) =>
              sum + (batch.jobs ?? []).filter((job) => ["submitted", "running", "processing"].includes(job.status)).length,
            0,
          ),
      ),
    });
    options.setOptimisticBatches((current) => [optimisticBatch, ...current].slice(0, 6));
    options.showActivity({ tone: "warning", message: "Submitting the media job.", spinning: true });
    options.setBusyState(intent);
    options.setFormMessage(null);
    options.showFloatingComposerBanner({ tone: "warning", text: "Sending your render to Studio." }, 2400);
    try {
      const response = await fetch("/api/control/media", {
        method: "POST",
        body: await buildMediaFormData(intent),
      });
      const payload = (await response.json()) as
        | { ok: false; error?: string }
        | { ok: true; success?: string; jobId?: string | null; batchId?: string | null; job?: MediaJob | null; batch?: MediaBatch | null };
      if (!response.ok || !payload.ok) {
        options.setOptimisticBatches((current) => current.filter((batch) => batch.batch_id !== optimisticBatch.batch_id));
        const message = "error" in payload ? payload.error ?? "Media request failed." : "Media request failed.";
        options.setFormMessage({ tone: "danger", text: message });
        options.showFloatingComposerBanner({ tone: "danger", text: message }, 5600);
        options.showActivity({ tone: "danger", message }, { autoHideMs: 3200 });
        return;
      }
      options.setValidation(null);
      options.setOptimisticBatches((current) => current.filter((batch) => batch.batch_id !== optimisticBatch.batch_id));
      if (payload.job) {
        options.setLocalJobs((current) => [payload.job as MediaJob, ...current.filter((job) => job.job_id !== payload.job?.job_id)].slice(0, 12));
      }
      if (payload.batch) {
        const batch = payload.batch as MediaBatch;
        options.upsertBatch(batch);
        if (Array.isArray(batch.jobs) && batch.jobs.length) {
          options.setLocalJobs((current) => {
            const byId = new Map(current.map((job) => [job.job_id, job]));
            for (const job of batch.jobs ?? []) {
              byId.set(job.job_id, job);
            }
            return Array.from(byId.values()).sort((left, right) => right.created_at.localeCompare(left.created_at)).slice(0, 24);
          });
        }
      }
      const successText = payload.success ?? "Render queued. Studio will update this card automatically.";
      options.setFormMessage({ tone: "warning", text: successText });
      options.showFloatingComposerBanner({ tone: "warning", text: successText }, 2600);
      options.showActivity({ tone: "healthy", message: successText }, { autoHideMs: 2200 });
      if (isCoarsePointerDevice()) {
        options.setMobileComposerCollapsed(true);
      }
      void options.refreshCreditBalance();
      if (payload.batchId) {
        void options.pollBatch(payload.batchId);
      } else if (payload.jobId) {
        void options.pollJob(payload.jobId);
      }
    } catch {
      options.setOptimisticBatches((current) => current.filter((batch) => batch.batch_id !== optimisticBatch.batch_id));
      options.setFormMessage({ tone: "danger", text: "Studio could not reach the local media service." });
      options.showFloatingComposerBanner({ tone: "danger", text: "Studio could not reach the local media service." }, 5600);
      options.showActivity({ tone: "danger", message: "Studio could not reach the local media service." }, { autoHideMs: 3200 });
    } finally {
      options.setBusyState("idle");
    }
  }

  return {
    buildMediaFormData,
    requestEnhancementPreview,
    openEnhanceDialog,
    requestValidation,
    submitMedia,
  };
}
