"use client";

import type { Dispatch, SetStateAction } from "react";

import type { AttachmentRecord, ComposerStatusMessage } from "@/lib/media-studio-contract";
import {
  classifyFile,
  mediaDisplayUrl,
  mediaDownloadName,
  mediaDownloadUrl,
  mediaInlineUrl,
  mediaPlaybackUrl,
  mediaThumbnailUrl,
  type PresetSlotState,
} from "@/lib/media-studio-helpers";
import { buildAttachmentPreviewUrl } from "@/lib/studio-composer-file-utils";
import { applyAttachmentInsertOrReplace, buildStagedAttachments } from "@/lib/studio-attachment-staging";
import type { MediaAsset, MediaReference } from "@/lib/types";

type FileAddConfig = {
  role?: NonNullable<AttachmentRecord["role"]>;
  allowedKinds?: AttachmentRecord["kind"][];
  insertImageIndex?: number | null;
  replaceImageIndex?: number | null;
};

type UseStudioAttachmentsOptions = {
  seedanceComposer: boolean;
  seedanceFirstFrameAttachment: AttachmentRecord | null;
  seedanceLastFrameAttachment: AttachmentRecord | null;
  seedanceReferenceImages: AttachmentRecord[];
  seedanceReferenceVideos: AttachmentRecord[];
  seedanceReferenceAudios: AttachmentRecord[];
  maxImageInputs: number;
  maxVideoInputs: number;
  maxAudioInputs: number;
  stagedImageCount: number;
  stagedVideoCount: number;
  stagedAudioCount: number;
  setFormMessage: Dispatch<SetStateAction<ComposerStatusMessage | null>>;
  setAttachments: Dispatch<SetStateAction<AttachmentRecord[]>>;
  setPresetSlotStates: Dispatch<SetStateAction<Record<string, PresetSlotState>>>;
};

export function useStudioAttachments({
  seedanceComposer,
  seedanceFirstFrameAttachment,
  seedanceLastFrameAttachment,
  seedanceReferenceImages,
  seedanceReferenceVideos,
  seedanceReferenceAudios,
  maxImageInputs,
  maxVideoInputs,
  maxAudioInputs,
  stagedImageCount,
  stagedVideoCount,
  stagedAudioCount,
  setFormMessage,
  setAttachments,
  setPresetSlotStates,
}: UseStudioAttachmentsOptions) {
  function remainingSeedanceCapacity(kind: AttachmentRecord["kind"], role: NonNullable<AttachmentRecord["role"]>) {
    if (role === "first_frame") {
      return kind === "images" && !seedanceFirstFrameAttachment ? 1 : 0;
    }
    if (role === "last_frame") {
      return kind === "images" && !seedanceLastFrameAttachment ? 1 : 0;
    }
    if (kind === "images") {
      return Math.max(0, maxImageInputs - seedanceReferenceImages.length);
    }
    if (kind === "videos") {
      return Math.max(0, maxVideoInputs - seedanceReferenceVideos.length);
    }
    return Math.max(0, maxAudioInputs - seedanceReferenceAudios.length);
  }

  async function addFiles(fileList: FileList | File[] | null, config: FileAddConfig = {}) {
    const incomingFiles = Array.from(fileList ?? []);
    if (!incomingFiles.length) {
      return;
    }
    const explicitRole = config.role ?? null;
    const insertImageIndex =
      explicitRole || seedanceComposer || config.insertImageIndex == null ? null : Math.max(0, config.insertImageIndex);
    const replaceImageIndex =
      explicitRole || seedanceComposer || config.replaceImageIndex == null ? null : Math.max(0, config.replaceImageIndex);
    const allowedKinds = new Set(config.allowedKinds ?? []);
    const imageReplacementAllowance = replaceImageIndex != null ? 1 : 0;
    let remainingImageCapacity = Math.max(0, maxImageInputs - stagedImageCount + imageReplacementAllowance);
    let remainingVideoCapacity = Math.max(0, maxVideoInputs - stagedVideoCount);
    let remainingAudioCapacity = Math.max(0, maxAudioInputs - stagedAudioCount);
    const acceptedFiles: File[] = [];
    const acceptedMetadata: Array<{
      role?: NonNullable<AttachmentRecord["role"]> | null;
      kind: AttachmentRecord["kind"];
    }> = [];
    const rejectedKinds = new Set<string>();
    for (const file of incomingFiles) {
      const kind = classifyFile(file);
      if (allowedKinds.size > 0 && !allowedKinds.has(kind)) {
        rejectedKinds.add(kind);
        continue;
      }
      if (seedanceComposer && explicitRole) {
        const remaining = remainingSeedanceCapacity(kind, explicitRole);
        const acceptedForRole = acceptedMetadata.filter(
          (item) => item.kind === kind && item.role === explicitRole,
        ).length;
        if (remaining - acceptedForRole <= 0) {
          rejectedKinds.add(kind);
          continue;
        }
        acceptedFiles.push(file);
        acceptedMetadata.push({ kind, role: explicitRole });
        continue;
      }
      if (kind === "images") {
        if (remainingImageCapacity <= 0) {
          rejectedKinds.add("images");
          continue;
        }
        remainingImageCapacity -= 1;
        acceptedFiles.push(file);
        acceptedMetadata.push({ kind });
        continue;
      }
      if (kind === "videos") {
        if (remainingVideoCapacity <= 0) {
          rejectedKinds.add("videos");
          continue;
        }
        remainingVideoCapacity -= 1;
        acceptedFiles.push(file);
        acceptedMetadata.push({ kind });
        continue;
      }
      if (remainingAudioCapacity <= 0) {
        rejectedKinds.add("audios");
        continue;
      }
      remainingAudioCapacity -= 1;
      acceptedFiles.push(file);
      acceptedMetadata.push({ kind });
    }
    if (!acceptedFiles.length) {
      if (rejectedKinds.size) {
        setFormMessage({
          tone: "warning",
          text: `This model cannot accept more ${Array.from(rejectedKinds).join(", ")} right now.`,
        });
      }
      return;
    }
    const previewUrls = await Promise.all(acceptedFiles.map((file) => buildAttachmentPreviewUrl(file)));
    const nextAttachments = buildStagedAttachments(
      acceptedFiles.map((file, index) => ({
        file,
        kind: acceptedMetadata[index]?.kind ?? classifyFile(file),
        role: acceptedMetadata[index]?.role ?? (seedanceComposer ? "reference" : null),
        previewUrl: previewUrls[index] ?? null,
      })),
    );
    setAttachments((current) =>
      applyAttachmentInsertOrReplace(current, nextAttachments, {
        insertImageIndex,
        replaceImageIndex,
      }),
    );
    if (rejectedKinds.size) {
      setFormMessage({
        tone: "warning",
        text: `Accepted what fit and skipped extra ${Array.from(rejectedKinds).join(", ")} beyond this model's limit.`,
      });
    }
  }

  async function addRestoredFiles(fileList: FileList | File[] | null, config: FileAddConfig = {}) {
    const incomingFiles = Array.from(fileList ?? []);
    if (!incomingFiles.length) {
      return;
    }
    const explicitRole = config.role ?? null;
    const insertImageIndex =
      explicitRole || seedanceComposer || config.insertImageIndex == null ? null : Math.max(0, config.insertImageIndex);
    const replaceImageIndex =
      explicitRole || seedanceComposer || config.replaceImageIndex == null ? null : Math.max(0, config.replaceImageIndex);
    const previewUrls = await Promise.all(incomingFiles.map((file) => buildAttachmentPreviewUrl(file)));
    const nextAttachments = buildStagedAttachments(
      incomingFiles.map((file, index) => ({
        file,
        kind: config.allowedKinds?.[0] ?? classifyFile(file),
        role: explicitRole ?? (seedanceComposer ? "reference" : null),
        previewUrl: previewUrls[index] ?? null,
      })),
    );
    setAttachments((current) =>
      applyAttachmentInsertOrReplace(current, nextAttachments, {
        insertImageIndex,
        replaceImageIndex,
      }),
    );
  }

  async function addGalleryAssetAsAttachment(
    asset: MediaAsset | null,
    role: NonNullable<AttachmentRecord["role"]> | null = null,
    allowedKinds?: AttachmentRecord["kind"][],
    extraConfig: {
      insertImageIndex?: number | null;
      replaceImageIndex?: number | null;
    } = {},
  ) {
    if (!asset) {
      setFormMessage({ tone: "danger", text: "The selected gallery asset could not be staged." });
      return;
    }
    const kind =
      asset.generation_kind === "video"
        ? ("videos" as const)
        : asset.generation_kind === "audio"
          ? ("audios" as const)
          : ("images" as const);
    if (allowedKinds?.length && !allowedKinds.includes(kind)) {
      setFormMessage({
        tone: "danger",
        text:
          kind === "videos"
            ? "Only video gallery cards can be staged in that slot."
            : kind === "audios"
              ? "Only audio gallery cards can be staged in that slot."
              : "Only image gallery cards can be staged in that slot.",
      });
      return;
    }
    const assetUrl =
      (kind === "videos" ? mediaPlaybackUrl(asset) : null) ??
      mediaInlineUrl(asset) ??
      mediaDownloadUrl(asset);
    if (!assetUrl) {
      setFormMessage({ tone: "danger", text: "The selected gallery asset could not be loaded." });
      return;
    }
    try {
      const response = await fetch(assetUrl, { credentials: "same-origin" });
      if (!response.ok) {
        throw new Error("Unable to fetch gallery asset.");
      }
      const blob = await response.blob();
      const file = new File([blob], mediaDownloadName(asset), {
        type:
          blob.type ||
          (kind === "videos" ? "video/mp4" : kind === "audios" ? "audio/wav" : "image/png"),
      });
      const addConfig =
        role != null || allowedKinds?.length
          ? {
              ...(role != null ? { role } : {}),
              ...(allowedKinds?.length ? { allowedKinds } : { allowedKinds: [kind] }),
              ...(extraConfig.insertImageIndex != null ? { insertImageIndex: extraConfig.insertImageIndex } : {}),
              ...(extraConfig.replaceImageIndex != null ? { replaceImageIndex: extraConfig.replaceImageIndex } : {}),
            }
          : {
              ...(extraConfig.insertImageIndex != null ? { insertImageIndex: extraConfig.insertImageIndex } : {}),
              ...(extraConfig.replaceImageIndex != null ? { replaceImageIndex: extraConfig.replaceImageIndex } : {}),
            };
      addFiles([file], addConfig);
    } catch {
      setFormMessage({ tone: "danger", text: "The selected gallery asset could not be staged in that slot." });
    }
  }

  function addReferenceMediaAsAttachment(reference: MediaReference | null, config: FileAddConfig = {}) {
    if (!reference) {
      return;
    }
    const kind =
      reference.kind === "video"
        ? ("videos" as const)
        : reference.kind === "audio"
          ? ("audios" as const)
          : ("images" as const);
    const allowedKinds = new Set(config.allowedKinds ?? []);
    if (allowedKinds.size > 0 && !allowedKinds.has(kind)) {
      setFormMessage({ tone: "warning", text: "That library item cannot be used in this slot." });
      return;
    }
    if (seedanceComposer && config.role) {
      if (remainingSeedanceCapacity(kind, config.role) <= 0) {
        setFormMessage({ tone: "warning", text: "This slot is already full." });
        return;
      }
    } else if (kind === "images" && stagedImageCount >= maxImageInputs) {
      if (config.replaceImageIndex == null) {
        setFormMessage({ tone: "warning", text: "This model cannot accept more images right now." });
        return;
      }
    } else if (kind === "videos" && stagedVideoCount >= maxVideoInputs) {
      setFormMessage({ tone: "warning", text: "This model cannot accept more videos right now." });
      return;
    } else if (kind === "audios" && stagedAudioCount >= maxAudioInputs) {
      setFormMessage({ tone: "warning", text: "This model cannot accept more audio right now." });
      return;
    }

    const [nextAttachment] = buildStagedAttachments([
      {
        file: null,
        kind,
        role: config.role ?? (seedanceComposer ? "reference" : null),
        previewUrl: reference.thumb_url ?? reference.poster_url ?? reference.stored_url ?? null,
        durationSeconds: reference.duration_seconds ?? null,
        referenceId: reference.reference_id,
        referenceRecord: reference,
      },
    ]);

    setAttachments((current) =>
      applyAttachmentInsertOrReplace(current, [nextAttachment], {
        insertImageIndex: kind === "images" ? config.insertImageIndex : null,
        replaceImageIndex: kind === "images" ? config.replaceImageIndex : null,
      }),
    );
  }

  function assignPresetSlotFile(slotKey: string, file: File | null) {
    setPresetSlotStates((current) => {
      const previous = current[slotKey];
      if (previous?.previewUrl && previous.file) {
        URL.revokeObjectURL(previous.previewUrl);
      }
      if (!file) {
        return {
          ...current,
          [slotKey]: { assetId: null, referenceId: null, referenceRecord: null, file: null, previewUrl: null },
        };
      }
      return {
        ...current,
        [slotKey]: {
          assetId: null,
          referenceId: null,
          referenceRecord: null,
          file,
          previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
        },
      };
    });
  }

  function assignPresetSlotAsset(slotKey: string, asset: MediaAsset | null) {
    if (!asset) {
      return;
    }
    if (asset.generation_kind !== "image") {
      setFormMessage({ tone: "danger", text: "Structured Nano Banana presets only accept image assets in image slots." });
      return;
    }
    setPresetSlotStates((current) => {
      const previous = current[slotKey];
      if (previous?.previewUrl && previous.file) {
        URL.revokeObjectURL(previous.previewUrl);
      }
      return {
        ...current,
        [slotKey]: {
          assetId: asset.asset_id,
          referenceId: null,
          referenceRecord: null,
          file: null,
          previewUrl: mediaThumbnailUrl(asset) ?? mediaDisplayUrl(asset),
        },
      };
    });
  }

  function assignPresetSlotReference(slotKey: string, reference: MediaReference | null) {
    if (!reference) {
      return;
    }
    if (reference.kind !== "image") {
      setFormMessage({ tone: "danger", text: "Structured Nano Banana presets only accept image references in image slots." });
      return;
    }
    setPresetSlotStates((current) => {
      const previous = current[slotKey];
      if (previous?.previewUrl && previous.file) {
        URL.revokeObjectURL(previous.previewUrl);
      }
      return {
        ...current,
        [slotKey]: {
          assetId: null,
          referenceId: reference.reference_id,
          referenceRecord: reference,
          file: null,
          previewUrl: reference.thumb_url ?? reference.stored_url ?? null,
        },
      };
    });
  }

  function clearPresetSlot(slotKey: string) {
    setPresetSlotStates((current) => {
      const previous = current[slotKey];
      if (previous?.previewUrl && previous.file) {
        URL.revokeObjectURL(previous.previewUrl);
      }
      return {
        ...current,
        [slotKey]: { assetId: null, referenceId: null, referenceRecord: null, file: null, previewUrl: null },
      };
    });
  }

  function removeAttachment(attachmentId: string) {
    setAttachments((current) => {
      const match = current.find((attachment) => attachment.id === attachmentId);
      if (match?.previewUrl && match.file) {
        URL.revokeObjectURL(match.previewUrl);
      }
      return current.filter((attachment) => attachment.id !== attachmentId);
    });
  }

  function clearPresetSlotStateValues() {
    setPresetSlotStates((current) => {
      for (const state of Object.values(current)) {
        if (state?.previewUrl && state.file) {
          URL.revokeObjectURL(state.previewUrl);
        }
      }
      return {};
    });
  }

  return {
    addFiles,
    addRestoredFiles,
    addGalleryAssetAsAttachment,
    addReferenceMediaAsAttachment,
    assignPresetSlotFile,
    assignPresetSlotAsset,
    assignPresetSlotReference,
    clearPresetSlot,
    removeAttachment,
    clearPresetSlotStateValues,
  };
}
