import type { MediaAttachmentKind, StudioReferencePreview } from "@/lib/media-studio-helpers";
import type { AttachmentRecord } from "@/lib/media-studio-contract";

export type AttachmentPreviewBuilder = (
  attachment: AttachmentRecord | null | undefined,
  label: string,
  previewKey?: string,
) => StudioReferencePreview | null;

export type StudioAddFilesHandler = (
  fileList: FileList | File[] | null,
  options?: { role?: NonNullable<MediaAttachmentKind["role"]>; allowedKinds?: MediaAttachmentKind["kind"][] },
) => void;
