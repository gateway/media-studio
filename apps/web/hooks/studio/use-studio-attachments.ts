"use client";

import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import type {
  AttachmentRecord,
  ComposerStatusMessage,
} from "@/lib/media-studio-contract";
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
import {
  applyAttachmentInsertOrReplace,
  buildStagedAttachments,
} from "@/lib/studio-attachment-staging";
import type { MediaAsset, MediaReference } from "@/lib/types";
import { probeVideoMetadata } from "@/lib/video-metadata";

export type StudioAttachmentReplacement = {
  replaceAttachmentId?: string;
  claimSourceAsset?: () => boolean;
};

type FileAddConfig = StudioAttachmentReplacement & {
  role?: NonNullable<AttachmentRecord["role"]>;
  allowedKinds?: AttachmentRecord["kind"][];
  insertImageIndex?: number | null;
  replaceImageIndex?: number | null;
};

type LibraryAddConfig = FileAddConfig & { successMessage?: string };

function libraryStagingMessage(message?: string) {
  return message ?? "Reference loaded from the library.";
}

type UseStudioAttachmentsOptions = {
  attachments: AttachmentRecord[];
  seedanceComposer: boolean;
  maxImageInputs: number;
  maxVideoInputs: number;
  maxAudioInputs: number;
  stagedImageCount: number;
  stagedVideoCount: number;
  stagedAudioCount: number;
  setFormMessage: Dispatch<SetStateAction<ComposerStatusMessage | null>>;
  setAttachments: Dispatch<SetStateAction<AttachmentRecord[]>>;
  setPresetSlotStates: Dispatch<
    SetStateAction<Record<string, PresetSlotState>>
  >;
};

type PickedFileMetadata = {
  kind: AttachmentRecord["kind"];
  role?: AttachmentRecord["role"];
};

function orderedImageIndex(index: number | null | undefined, ignoreIndex: boolean) {
  return ignoreIndex || index == null ? null : Math.max(0, index);
}

function resolveFilePlacement(config: FileAddConfig, seedanceComposer: boolean) {
  const explicitRole = config.role ?? null;
  const ignoreImageIndex = Boolean(explicitRole) || seedanceComposer;
  return {
    explicitRole,
    insertImageIndex: orderedImageIndex(config.insertImageIndex, ignoreImageIndex),
    replaceImageIndex: orderedImageIndex(config.replaceImageIndex, ignoreImageIndex),
  };
}

type ProbedVideoAttachmentMetadata = {
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
};

const emptyProbedVideoAttachmentMetadata: ProbedVideoAttachmentMetadata = {
  durationSeconds: null,
  width: null,
  height: null,
};

async function probeVideoAttachmentMetadata(
  files: File[],
  metadata: Array<{ kind: AttachmentRecord["kind"] }>,
) {
  return Promise.all(
    files.map(async (file, index) => {
      if (metadata[index]?.kind !== "videos")
        return emptyProbedVideoAttachmentMetadata;
      try {
        const videoMetadata = await probeVideoMetadata(file);
        return {
          durationSeconds: videoMetadata.durationSeconds,
          width: videoMetadata.width,
          height: videoMetadata.height,
        };
      } catch {
        return emptyProbedVideoAttachmentMetadata;
      }
    }),
  );
}

async function decodePickedAttachments(
  files: File[],
  metadata: PickedFileMetadata[],
  defaultRole: AttachmentRecord["role"],
) {
  const [previewUrls, videoMetadata] = await Promise.all([
    Promise.all(files.map((file) => buildAttachmentPreviewUrl(file))),
    probeVideoAttachmentMetadata(files, metadata),
  ]);
  return buildStagedAttachments(
    files.map((file, index) => ({
      file,
      kind: metadata[index].kind,
      role: metadata[index].role ?? defaultRole,
      previewUrl: previewUrls[index],
      ...videoMetadata[index],
    })),
  );
}

function replacementAllowance(
  config: FileAddConfig,
  imageIndex?: number | null,
) {
  return Number(
    imageIndex != null ||
      Boolean(config.replaceAttachmentId || config.claimSourceAsset),
  );
}

function filePreviewObjectUrls(attachments: AttachmentRecord[]) {
  return attachments.flatMap(({ file, previewUrl }) =>
    file && previewUrl?.startsWith("blob:") ? [previewUrl] : [],
  );
}

function releaseFilePreviews(attachments: AttachmentRecord[]) {
  filePreviewObjectUrls(attachments).forEach((url) => URL.revokeObjectURL(url));
}

function useDecodedReplacementCleanup(attachments: AttachmentRecord[]) {
  const pending = useRef(
    new Map<
      symbol,
      {
        decoded: AttachmentRecord[];
        onComplete?: (committed: number) => void;
      }
    >(),
  );
  const mounted = useRef(true);
  const [checks, setChecks] = useState<symbol[]>([]);

  useEffect(() => {
    if (pending.current.size === 0) return;
    const committedUrls = new Set(
      attachments.map(({ previewUrl }) => previewUrl),
    );
    const committedIds = new Set(attachments.map(({ id }) => id));
    for (const key of checks) {
      const check = pending.current.get(key);
      if (!check) continue;
      pending.current.delete(key);
      for (const url of filePreviewObjectUrls(check.decoded)) {
        if (!committedUrls.has(url)) URL.revokeObjectURL(url);
      }
      check.onComplete?.(
        check.decoded.filter(({ id }) => committedIds.has(id)).length,
      );
    }
  }, [attachments, checks]);

  useEffect(() => {
    mounted.current = true;
    const unresolved = pending.current;
    return () => {
      mounted.current = false;
      for (const check of unresolved.values()) {
        releaseFilePreviews(check.decoded);
      }
      unresolved.clear();
    };
  }, []);

  function checkAfterCommit(
    decoded: AttachmentRecord[],
    onComplete?: (committed: number) => void,
  ) {
    if (!onComplete && !filePreviewObjectUrls(decoded).length) return;
    const unresolved = new Set(pending.current.keys());
    const check = Symbol();
    pending.current.set(check, { decoded, onComplete });
    // Check after commit even when the attachment update returns the same array.
    // Keep only lightweight keys in React state and release settled URLs from the map.
    setChecks((current) => [
      ...current.filter((key) => unresolved.has(key)),
      check,
    ]);
  }

  return { mounted, checkAfterCommit };
}

export function useStudioAttachments({
  attachments,
  seedanceComposer,
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
  const { mounted, checkAfterCommit } =
    useDecodedReplacementCleanup(attachments);

  function stagePickedAttachments(
    next: AttachmentRecord[],
    { claimSourceAsset, replaceAttachmentId }: FileAddConfig,
    insertImageIndex: number | null,
    replaceImageIndex: number | null,
    onComplete?: (committed: number) => void,
  ) {
    if (!mounted.current) {
      releaseFilePreviews(next);
      return;
    }
    if (claimSourceAsset) {
      if (claimSourceAsset()) {
        setAttachments((current) => [...next, ...current]);
        checkAfterCommit(next, onComplete);
      } else {
        releaseFilePreviews(next);
        onComplete?.(0);
      }
      return;
    }
    if (seedanceComposer && !replaceAttachmentId) {
      stageSeedanceAttachments(next, (committed) => {
        if (committed < next.length) {
          setFormMessage({
            tone: "warning",
            text: "Skipped files because the reference group or frame slot is full.",
          });
        }
      });
      return;
    }
    setAttachments((current) =>
      applyAttachmentInsertOrReplace(current, next, {
        insertImageIndex,
        replaceImageIndex,
        replaceAttachmentId,
      }),
    );
    if (replaceAttachmentId !== undefined) checkAfterCommit(next, onComplete);
  }

  function remainingSeedanceCapacity(
    kind: AttachmentRecord["kind"],
    role: NonNullable<AttachmentRecord["role"]>,
    current = attachments,
  ) {
    const count = current.filter(
      (attachment) => attachment.kind === kind && attachment.role === role,
    ).length;
    if (role !== "reference") {
      return Number(kind === "images" && count === 0);
    }
    const limit = {
      images: maxImageInputs,
      videos: maxVideoInputs,
      audios: maxAudioInputs,
    }[kind];
    return Math.max(0, limit - count);
  }

  function appendSeedanceAttachments(
    current: AttachmentRecord[],
    next: AttachmentRecord[],
  ) {
    return next.reduce((staged, item) => {
      if (
        item.role &&
        remainingSeedanceCapacity(item.kind, item.role, staged) === 0
      )
        return staged;
      return [...staged, item];
    }, current);
  }

  function stageSeedanceAttachments(
    next: AttachmentRecord[],
    onComplete: (committed: number) => void,
  ) {
    setAttachments((current) => appendSeedanceAttachments(current, next));
    checkAfterCommit(next, onComplete);
  }

  function remainingSeedanceTargetCapacity(
    kind: AttachmentRecord["kind"],
    role: NonNullable<AttachmentRecord["role"]>,
    replacementId?: string,
  ) {
    if (!replacementId) return remainingSeedanceCapacity(kind, role);
    // Replacing a staged item consumes only its place in the group or frame role.
    const replacement = attachments.find(({ id }) => id === replacementId);
    return Number(replacement?.kind === kind && replacement.role === role);
  }

  async function addFiles(
    fileList: FileList | File[] | null,
    config: FileAddConfig = {},
  ) {
    const incomingFiles = Array.from(fileList ?? []);
    if (!incomingFiles.length) return;
    const { explicitRole, insertImageIndex, replaceImageIndex } =
      resolveFilePlacement(config, seedanceComposer);
    const allowedKinds = new Set(config.allowedKinds ?? []);
    let remainingImageCapacity = Math.max(
      0,
      maxImageInputs -
        stagedImageCount +
        replacementAllowance(config, replaceImageIndex),
    );
    let remainingVideoCapacity = Math.max(
      0,
      maxVideoInputs - stagedVideoCount + replacementAllowance(config),
    );
    let remainingAudioCapacity = Math.max(0, maxAudioInputs - stagedAudioCount);
    const acceptedFiles: File[] = [];
    const acceptedMetadata: PickedFileMetadata[] = [];
    const rejectedKinds = new Set<string>();
    for (const file of incomingFiles) {
      const kind = classifyFile(file);
      if (allowedKinds.size > 0 && !allowedKinds.has(kind)) {
        rejectedKinds.add(kind);
        continue;
      }
      if (seedanceComposer && explicitRole) {
        const remaining = remainingSeedanceTargetCapacity(
          kind,
          explicitRole,
          config.replaceAttachmentId,
        );
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
    const nextAttachments = await decodePickedAttachments(
      acceptedFiles,
      acceptedMetadata,
      seedanceComposer ? "reference" : null,
    );
    stagePickedAttachments(
      nextAttachments,
      config,
      insertImageIndex,
      replaceImageIndex,
    );
    if (rejectedKinds.size) {
      setFormMessage({
        tone: "warning",
        text: `Accepted what fit and skipped extra ${Array.from(rejectedKinds).join(", ")} beyond this model's limit.`,
      });
    }
  }

  async function addRestoredFiles(
    fileList: FileList | File[] | null,
    config: FileAddConfig = {},
  ) {
    const incomingFiles = Array.from(fileList ?? []);
    if (!incomingFiles.length) return;
    const placement = resolveFilePlacement(config, seedanceComposer);
    const restoredMetadata = incomingFiles.map((file) => ({
      kind: config.allowedKinds?.[0] ?? classifyFile(file),
    }));
    const nextAttachments = await decodePickedAttachments(
      incomingFiles,
      restoredMetadata,
      placement.explicitRole ?? (seedanceComposer ? "reference" : null),
    );
    setAttachments((current) =>
      applyAttachmentInsertOrReplace(current, nextAttachments, {
        insertImageIndex: placement.insertImageIndex,
        replaceImageIndex: placement.replaceImageIndex,
      }),
    );
  }

  async function addGalleryAssetAsAttachment(
    asset: MediaAsset | null,
    role: NonNullable<AttachmentRecord["role"]> | null = null,
    allowedKinds?: AttachmentRecord["kind"][],
    placement: Pick<
      FileAddConfig,
      | "insertImageIndex"
      | "replaceImageIndex"
      | "replaceAttachmentId"
      | "claimSourceAsset"
    > = {},
  ) {
    if (!asset) {
      setFormMessage({
        tone: "danger",
        text: "The selected gallery asset could not be staged.",
      });
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
      setFormMessage({
        tone: "danger",
        text: "The selected gallery asset could not be loaded.",
      });
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
          (kind === "videos"
            ? "video/mp4"
            : kind === "audios"
              ? "audio/wav"
              : "image/png"),
      });
      await addFiles([file], {
        ...placement,
        ...(role != null ? { role } : {}),
        allowedKinds: allowedKinds?.length
          ? allowedKinds
          : role != null
            ? [kind]
            : undefined,
      });
    } catch {
      setFormMessage({
        tone: "danger",
        text: "The selected gallery asset could not be staged in that slot.",
      });
    }
  }

  function libraryCapacityWarning(
    kind: AttachmentRecord["kind"],
    config: LibraryAddConfig,
  ) {
    if (seedanceComposer && config.role) {
      return remainingSeedanceTargetCapacity(
        kind,
        config.role,
        config.replaceAttachmentId,
      ) > 0
        ? null
        : "This slot is already full.";
    }
    if (config.replaceAttachmentId || config.claimSourceAsset) return null;
    const atCapacity = {
      images:
        stagedImageCount >= maxImageInputs && config.replaceImageIndex == null,
      videos: stagedVideoCount >= maxVideoInputs,
      audios: stagedAudioCount >= maxAudioInputs,
    };
    const label = { images: "images", videos: "videos", audios: "audio" }[kind];
    return atCapacity[kind]
      ? `This model cannot accept more ${label} right now.`
      : null;
  }

  function addReferenceMediaAsAttachment(
    reference: MediaReference | null,
    config: LibraryAddConfig = {},
  ) {
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
      setFormMessage({
        tone: "warning",
        text: "That library item cannot be used in this slot.",
      });
      return;
    }
    const capacityWarning = libraryCapacityWarning(kind, config);
    if (capacityWarning) {
      setFormMessage({ tone: "warning", text: capacityWarning });
      return;
    }

    const [nextAttachment] = buildStagedAttachments([
      {
        file: null,
        kind,
        role: config.role ?? (seedanceComposer ? "reference" : null),
        previewUrl:
          reference.thumb_url ??
          reference.poster_url ??
          reference.stored_url ??
          null,
        durationSeconds: reference.duration_seconds ?? null,
        width: reference.width ?? null,
        height: reference.height ?? null,
        referenceId: reference.reference_id,
        referenceRecord: reference,
      },
    ]);

    stageLibraryAttachment(nextAttachment, config);
  }

  function stageLibraryAttachment(
    attachment: AttachmentRecord,
    config: LibraryAddConfig,
  ) {
    const reportSuccess = () =>
      setFormMessage({
        tone: "healthy",
        text: libraryStagingMessage(config.successMessage),
      });
    if (config.replaceAttachmentId || config.claimSourceAsset) {
      stagePickedAttachments([attachment], config, null, null, (committed) => {
        if (committed) reportSuccess();
        else
          setFormMessage({
            tone: "warning",
            text: "The reference to replace is no longer staged.",
          });
      });
      return;
    }
    if (seedanceComposer) {
      stageSeedanceAttachments([attachment], (committed) => {
        if (committed) reportSuccess();
        else
          setFormMessage({
            tone: "warning",
            text: "This slot is already full.",
          });
      });
      return;
    }
    setAttachments((current) =>
      applyAttachmentInsertOrReplace(current, [attachment], {
        insertImageIndex:
          attachment.kind === "images" ? config.insertImageIndex : null,
        replaceImageIndex:
          attachment.kind === "images" ? config.replaceImageIndex : null,
      }),
    );
    reportSuccess();
  }

  function updatePresetSlot(slotKey: string, next: () => PresetSlotState) {
    setPresetSlotStates((current) => {
      const previous = current[slotKey];
      if (previous?.previewUrl && previous.file) {
        URL.revokeObjectURL(previous.previewUrl);
      }
      return { ...current, [slotKey]: next() };
    });
  }

  function assignPresetSlotFile(slotKey: string, file: File | null) {
    updatePresetSlot(slotKey, () => ({
      assetId: null,
      referenceId: null,
      referenceRecord: null,
      file,
      previewUrl: file?.type.startsWith("image/") ? URL.createObjectURL(file) : null,
    }));
  }

  function assignPresetSlotAsset(slotKey: string, asset: MediaAsset | null) {
    if (!asset) {
      return;
    }
    if (asset.generation_kind !== "image") {
      setFormMessage({
        tone: "danger",
        text: "Structured Nano Banana presets only accept image assets in image slots.",
      });
      return;
    }
    updatePresetSlot(slotKey, () => ({
      assetId: asset.asset_id,
      referenceId: null,
      referenceRecord: null,
      file: null,
      previewUrl: mediaThumbnailUrl(asset) ?? mediaDisplayUrl(asset),
    }));
  }

  function assignPresetSlotReference(
    slotKey: string,
    reference: MediaReference | null,
  ) {
    if (!reference) {
      return;
    }
    if (reference.kind !== "image") {
      setFormMessage({
        tone: "danger",
        text: "Structured Nano Banana presets only accept image references in image slots.",
      });
      return;
    }
    updatePresetSlot(slotKey, () => ({
      assetId: null,
      referenceId: reference.reference_id,
      referenceRecord: reference,
      file: null,
      previewUrl: reference.thumb_url ?? reference.stored_url ?? null,
    }));
  }

  function clearPresetSlot(slotKey: string) {
    assignPresetSlotFile(slotKey, null);
  }

  function removeAttachment(attachmentId: string) {
    setAttachments((current) =>
      current.filter((attachment) => attachment.id !== attachmentId),
    );
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
