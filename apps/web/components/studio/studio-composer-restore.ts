import type { Dispatch, SetStateAction } from "react";

import { findMediaAssetById } from "@/lib/studio-gallery";
import {
  type ComposerStatusMessage,
  type AttachmentRecord,
} from "@/lib/media-studio-contract";
import {
  buildStudioJobPrimaryInput,
  buildStudioJobReferenceInputs,
  buildStudioRetryRestorePlan,
  isSeedanceModel,
} from "@/lib/media-studio-helpers";
import type { MediaAsset } from "@/lib/types";

export type StudioRetryRestorePlan = ReturnType<typeof buildStudioRetryRestorePlan>;
export type StudioRetryPrimaryInput = ReturnType<typeof buildStudioJobPrimaryInput>;
export type StudioRetryReferenceInputs = ReturnType<typeof buildStudioJobReferenceInputs>;

type RestoreFileConfig = {
  role?: NonNullable<AttachmentRecord["role"]>;
  allowedKinds?: AttachmentRecord["kind"][];
  insertImageIndex?: number | null;
  replaceImageIndex?: number | null;
};

type RestoreRevealOptions = {
  focusPresetField?: boolean;
};

type RestoreComposerDependencies = {
  localAssets: MediaAsset[];
  favoriteAssets: MediaAsset[] | null;
  selectedProjectId: string | null;
  setSelectedProjectId: (value: string | null) => void;
  replaceStudioHistory: (projectId: string | null) => void;
  clearComposer: () => void;
  setModelKey: (value: string) => void;
  applyPresetSelection: (value: string, options?: { preferredModelKey?: string | null }) => void;
  setSelectedPresetId: (value: string) => void;
  setSelectedPromptIds: (value: string[]) => void;
  setPrompt: (value: string) => void;
  setOptionValues: (value: Record<string, unknown>) => void;
  setOutputCount: (value: number) => void;
  setValidation: (value: null) => void;
  setBusyState: (value: "idle") => void;
  setOpenPicker: (value: null) => void;
  setEnhanceDialogOpen: (value: boolean) => void;
  setEnhancePreview: (value: null) => void;
  setEnhanceError: (value: null) => void;
  setIsDragActive: (value: boolean) => void;
  clearSourceAsset: () => void;
  setPresetInputValues: (value: Record<string, string>) => void;
  stageSourceAsset: (asset: MediaAsset | null) => void;
  setLocalAssets: Dispatch<SetStateAction<MediaAsset[]>>;
  fetchAssetById: (assetId: string | number) => Promise<MediaAsset>;
  fetchReferenceFile?: typeof fetchReferenceFile;
  addRestoredFiles: (fileList: FileList | File[] | null, config?: RestoreFileConfig) => Promise<void> | void;
  addGalleryAssetAsAttachment: (
    asset: MediaAsset | null,
    role?: NonNullable<AttachmentRecord["role"]> | null,
    allowedKinds?: AttachmentRecord["kind"][],
    extraConfig?: {
      insertImageIndex?: number | null;
      replaceImageIndex?: number | null;
    },
  ) => Promise<void> | void;
  assignPresetSlotAsset: (slotKey: string, asset: MediaAsset | null) => void;
  assignPresetSlotFile: (slotKey: string, file: File | null) => void;
  setSelectedFailedJobId: (value: string | null) => void;
  setSelectedAssetId: (value: string | number | null) => void;
  setSelectedMediaLightboxOpen: (value: boolean) => void;
  setSelectedReferencePreview: (value: null) => void;
  setMobileComposerCollapsed: (value: boolean) => void;
  setFormMessage: (value: ComposerStatusMessage) => void;
  revealComposer: (options?: RestoreRevealOptions) => void;
};

export async function fetchReferenceFile(
  referenceUrl: string,
  label: string,
  kind: "images" | "videos" | "audios",
) {
  const response = await fetch(referenceUrl, { credentials: "same-origin" });
  if (!response.ok) {
    throw new Error(`Unable to reload ${label}.`);
  }
  const blob = await response.blob();
  const extension = kind === "videos" ? "mp4" : kind === "audios" ? "wav" : "png";
  const mimeType =
    blob.type ||
    (kind === "videos" ? "video/mp4" : kind === "audios" ? "audio/wav" : "image/png");
  return new File([blob], `${label}.${extension}`, { type: mimeType });
}

async function restorePrimaryInput(
  sourceAssetId: string | number | null | undefined,
  primaryInput: StudioRetryPrimaryInput,
  dependencies: RestoreComposerDependencies,
) {
  let restoredPrimaryInput = false;

  if (sourceAssetId != null) {
    const localSourceAsset = findMediaAssetById(sourceAssetId, dependencies.localAssets, dependencies.favoriteAssets);
    if (localSourceAsset) {
      dependencies.stageSourceAsset(localSourceAsset);
      restoredPrimaryInput = true;
    } else {
      try {
        const loadedSourceAsset = await dependencies.fetchAssetById(sourceAssetId);
        dependencies.setLocalAssets((current) => [
          loadedSourceAsset,
          ...current.filter((asset) => asset.asset_id !== loadedSourceAsset.asset_id),
        ]);
        dependencies.stageSourceAsset(loadedSourceAsset);
        restoredPrimaryInput = true;
      } catch {
        // Fall through to file-backed restore below.
      }
    }
  }

  if (!restoredPrimaryInput && primaryInput) {
    // Some completed jobs only preserve the primary media inside normalized request payloads.
    // Restore those back into the same ordered slot contract before handling references.
    if (primaryInput.assetId != null) {
      const localPrimaryAsset = findMediaAssetById(primaryInput.assetId, dependencies.localAssets, dependencies.favoriteAssets);
      if (localPrimaryAsset) {
        if (primaryInput.role) {
          await dependencies.addGalleryAssetAsAttachment(localPrimaryAsset, primaryInput.role, [primaryInput.kind]);
        } else {
          dependencies.stageSourceAsset(localPrimaryAsset);
        }
        restoredPrimaryInput = true;
      }
    }

    if (!restoredPrimaryInput && primaryInput.url) {
      try {
        const primaryFile = await (dependencies.fetchReferenceFile ?? fetchReferenceFile)(
          primaryInput.url,
          "source-image",
          primaryInput.kind,
        );
        await dependencies.addRestoredFiles([primaryFile], {
          role: primaryInput.role ?? undefined,
          allowedKinds: [primaryInput.kind],
          insertImageIndex: primaryInput.role == null && primaryInput.kind === "images" ? 0 : null,
          replaceImageIndex: primaryInput.role == null && primaryInput.kind === "images" ? 0 : null,
        });
        restoredPrimaryInput = true;
      } catch {
        // Keep the composer open even if the source cannot be refetched.
      }
    }
  }

  return restoredPrimaryInput;
}

async function restorePresetSlotInputs(
  plan: StudioRetryRestorePlan,
  dependencies: RestoreComposerDependencies,
) {
  if (!plan?.targetPreset) {
    return;
  }

  for (const slotRestore of plan.presetSlotRestores ?? []) {
    if (slotRestore.assetId != null) {
      const asset = findMediaAssetById(slotRestore.assetId, dependencies.localAssets, dependencies.favoriteAssets);
      if (asset) {
        dependencies.assignPresetSlotAsset(slotRestore.slotKey, asset);
        continue;
      }
    }
    if (slotRestore.url) {
      try {
        const file = await (dependencies.fetchReferenceFile ?? fetchReferenceFile)(slotRestore.url, slotRestore.label, "images");
        dependencies.assignPresetSlotFile(slotRestore.slotKey, file);
      } catch {
        // Skip unavailable preset slot media.
      }
    }
  }
}

async function restoreReferenceInputs(
  referenceInputs: StudioRetryReferenceInputs,
  preserveReferenceRoles: boolean,
  dependencies: RestoreComposerDependencies,
) {
  let genericImageInsertIndex = 0;
  for (const reference of referenceInputs ?? []) {
    const restoreRole =
      preserveReferenceRoles || reference.role !== "reference" ? reference.role : null;
    const shouldUseOrderedImageInsert = !preserveReferenceRoles && reference.kind === "images" && reference.role === "reference";
    if (reference.assetId != null) {
      const asset = findMediaAssetById(reference.assetId, dependencies.localAssets, dependencies.favoriteAssets);
      if (asset) {
        await dependencies.addGalleryAssetAsAttachment(asset, restoreRole, [reference.kind], {
          insertImageIndex: shouldUseOrderedImageInsert ? genericImageInsertIndex : null,
          replaceImageIndex: null,
        });
        if (shouldUseOrderedImageInsert) {
          genericImageInsertIndex += 1;
        }
        continue;
      }
    }
    try {
      const file = await (dependencies.fetchReferenceFile ?? fetchReferenceFile)(
        reference.url,
        reference.label,
        reference.kind,
      );
      await dependencies.addRestoredFiles([file], {
        role: restoreRole ?? undefined,
        allowedKinds: [reference.kind],
        insertImageIndex: shouldUseOrderedImageInsert ? genericImageInsertIndex : null,
        replaceImageIndex: null,
      });
      if (shouldUseOrderedImageInsert) {
        genericImageInsertIndex += 1;
      }
    } catch {
      // Missing references should not block the main restore flow.
    }
  }
}

export async function restoreComposerFromPlan({
  plan,
  fallbackPrimaryInput,
  fallbackReferenceInputs,
  sourceAssetId,
  missingModelMessage,
  successMessage,
  partialFailureMessage,
  closeAssetInspector = false,
  closeFailedJobInspector = false,
  dependencies,
}: {
  plan: StudioRetryRestorePlan;
  fallbackPrimaryInput?: StudioRetryPrimaryInput;
  fallbackReferenceInputs?: StudioRetryReferenceInputs;
  sourceAssetId?: string | number | null;
  missingModelMessage: string;
  successMessage: string;
  partialFailureMessage: string;
  closeAssetInspector?: boolean;
  closeFailedJobInspector?: boolean;
  dependencies: RestoreComposerDependencies;
}) {
  const targetModel = plan?.targetModel ?? null;
  if (!targetModel) {
    dependencies.setFormMessage({ tone: "danger", text: missingModelMessage });
    return;
  }

  const targetPreset = plan?.targetPreset ?? null;
  const targetProjectId = plan?.projectId ?? null;

  dependencies.clearComposer();
  if (targetProjectId !== dependencies.selectedProjectId) {
    dependencies.setSelectedProjectId(targetProjectId);
    dependencies.replaceStudioHistory(targetProjectId);
  }
  dependencies.setModelKey(targetModel.key);
  if (targetPreset) {
    dependencies.applyPresetSelection(targetPreset.preset_id ?? targetPreset.key, {
      preferredModelKey: targetModel.key,
    });
  } else {
    dependencies.setSelectedPresetId("");
  }
  dependencies.setSelectedPromptIds(plan?.selectedPromptIds ?? []);
  dependencies.setPrompt(plan?.prompt ?? "");
  dependencies.setOptionValues(plan?.optionValues ?? {});
  dependencies.setOutputCount(plan?.outputCount ?? 1);
  dependencies.setValidation(null);
  dependencies.setBusyState("idle");
  dependencies.setOpenPicker(null);
  dependencies.setEnhanceDialogOpen(false);
  dependencies.setEnhancePreview(null);
  dependencies.setEnhanceError(null);
  dependencies.setIsDragActive(false);
  dependencies.clearSourceAsset();

  if (closeFailedJobInspector) {
    dependencies.setSelectedFailedJobId(null);
  }
  if (closeAssetInspector) {
    dependencies.setSelectedAssetId(null);
    dependencies.setSelectedMediaLightboxOpen(false);
    dependencies.setSelectedReferencePreview(null);
  }
  dependencies.setMobileComposerCollapsed(false);

  await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
  dependencies.setPresetInputValues(plan?.presetInputValues ?? {});

  const restoredPrimaryInput = await restorePrimaryInput(
    sourceAssetId,
    plan?.primaryInput ?? fallbackPrimaryInput ?? null,
    dependencies,
  );

  await restorePresetSlotInputs(plan, dependencies);
  await restoreReferenceInputs(
    plan?.referenceInputs ?? fallbackReferenceInputs ?? [],
    isSeedanceModel(targetModel.key),
    dependencies,
  );

  // A missing primary input is the one restore failure that should downgrade the
  // final message. Reference/preset misses stay non-blocking so the user can still
  // land back in the composer with the recoverable parts of the request intact.
  dependencies.setFormMessage({
    tone: restoredPrimaryInput ? "warning" : "danger",
    text: restoredPrimaryInput ? successMessage : partialFailureMessage,
  });
  dependencies.revealComposer({ focusPresetField: Boolean(targetPreset) });
}
