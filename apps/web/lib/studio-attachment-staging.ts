import { insertImageAttachments } from "@/lib/media-studio-helpers";
import type { AttachmentRecord } from "@/lib/media-studio-contract";
import type { MediaReference } from "@/lib/types";

type AttachmentMaterializeInput = {
  file: File | null;
  kind: AttachmentRecord["kind"];
  role?: NonNullable<AttachmentRecord["role"]> | null;
  previewUrl: string | null;
  durationSeconds?: number | null;
  referenceId?: string | null;
  referenceRecord?: MediaReference | null;
};

type AttachmentPlacement = {
  insertImageIndex?: number | null;
  replaceImageIndex?: number | null;
};

export function buildStagedAttachments(
  inputs: AttachmentMaterializeInput[],
  idFactory: () => string = () => crypto.randomUUID?.() ?? Math.random().toString(36).slice(2),
) {
  return inputs.map((input) => ({
    id: `${input.file?.name ?? input.referenceId ?? input.kind}-${input.file?.size ?? 0}-${idFactory()}`,
    file: input.file,
    kind: input.kind,
    role: input.role ?? null,
    previewUrl: input.previewUrl,
    durationSeconds: input.durationSeconds ?? null,
    referenceId: input.referenceId ?? null,
    referenceRecord: input.referenceRecord ?? null,
  })) satisfies AttachmentRecord[];
}

export function applyAttachmentInsertOrReplace(
  current: AttachmentRecord[],
  next: AttachmentRecord[],
  placement: AttachmentPlacement = {},
) {
  // Ordered image positions are computed against image attachments only, so mixed media
  // attachments keep their relative ordering while image slots are inserted or replaced.
  const normalizedReplaceIndex = placement.replaceImageIndex != null ? Math.max(0, placement.replaceImageIndex) : null;
  const normalizedInsertIndex = placement.insertImageIndex != null ? Math.max(0, placement.insertImageIndex) : null;

  let nextCurrent = current;
  if (normalizedReplaceIndex != null) {
    let imageIndex = 0;
    let removed = false;
    nextCurrent = current.filter((attachment) => {
      if (!removed && attachment.kind === "images" && !attachment.role && imageIndex++ === normalizedReplaceIndex) {
        removed = true;
        return false;
      }
      return true;
    });
  }

  return normalizedInsertIndex != null
    ? insertImageAttachments(nextCurrent, next, normalizedInsertIndex)
    : [...nextCurrent, ...next];
}
