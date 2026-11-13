import type { DragEvent } from "react";
import type {
  MediaAttachmentKind,
  StudioReferencePreview,
} from "@/lib/media-studio-helpers";
import type { AttachmentRecord } from "@/lib/media-studio-contract";

export type AttachmentPreviewBuilder = (
  attachment: AttachmentRecord | null | undefined,
  label: string,
  previewKey?: string,
) => StudioReferencePreview | null;

export type StudioAddFilesHandler = (
  fileList: FileList | File[] | null,
  options?: {
    role?: NonNullable<MediaAttachmentKind["role"]>;
    allowedKinds?: MediaAttachmentKind["kind"][];
    replaceAttachmentId?: string;
  },
) => void;

export type StudioFrameInputProps = {
  isDragActive: boolean;
  seedanceFirstFrameAttachment: AttachmentRecord | null;
  seedanceLastFrameAttachment: AttachmentRecord | null;
  buildAttachmentPreview: AttachmentPreviewBuilder;
  onSetDragActive: (value: boolean) => void;
  onSetFormWarning: (text: string) => void;
  onDropIntoSourceSlot: (
    event: DragEvent<HTMLDivElement | HTMLLabelElement>,
    slotIndex?: number,
  ) => void;
  onOpenPreview: (preview: StudioReferencePreview | null) => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onAddFiles: StudioAddFilesHandler;
  onResetFileInput: (input: HTMLInputElement | null) => void;
};

export function seedanceFrameDragHandlers(
  slotIndex: number,
  onSetDragActive: StudioFrameInputProps["onSetDragActive"],
  onDropIntoSourceSlot: StudioFrameInputProps["onDropIntoSourceSlot"],
) {
  return {
    onDragOver(event: DragEvent<HTMLDivElement | HTMLLabelElement>) {
      event.preventDefault();
      onSetDragActive(true);
    },
    onDragLeave: () => onSetDragActive(false),
    onDrop: (event: DragEvent<HTMLDivElement | HTMLLabelElement>) =>
      onDropIntoSourceSlot(event, slotIndex),
  };
}
