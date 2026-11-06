"use client";

import {
  AudioLines,
  Clapperboard,
  ImagePlus,
  type LucideIcon,
  Upload,
} from "lucide-react";

import { cn } from "@/lib/utils";

type StudioMediaSlotAddTileKind = "image" | "video" | "audio" | "mixed";

type StudioMediaSlotAddTileProps = {
  accept: string;
  multiple?: boolean;
  disabled?: boolean;
  isDragActive?: boolean;
  label?: string;
  inputLabel?: string;
  actionLabel?: React.ReactNode;
  mediaKind?: StudioMediaSlotAddTileKind;
  required?: boolean;
  testId?: string;
  wrapperClassName?: string;
  tileClassName?: string;
  plusIconClassName?: string;
  onDragOver?: (event: React.DragEvent<HTMLLabelElement>) => void;
  onDragLeave?: (event: React.DragEvent<HTMLLabelElement>) => void;
  onDrop?: (event: React.DragEvent<HTMLLabelElement>) => void;
  onPickFiles: (fileList: FileList | null, input: HTMLInputElement) => void;
};

function inferMediaKindFromAccept(accept: string): StudioMediaSlotAddTileKind {
  const normalized = accept.toLowerCase();
  const hasImage = normalized.includes("image/");
  const hasVideo = normalized.includes("video/");
  const hasAudio = normalized.includes("audio/");

  const presentKinds = [hasImage, hasVideo, hasAudio].filter(Boolean).length;
  if (presentKinds > 1) {
    return "mixed";
  }
  if (hasVideo) {
    return "video";
  }
  if (hasAudio) {
    return "audio";
  }
  return "image";
}

export function studioMediaSlotAddTileIcon(
  kind: StudioMediaSlotAddTileKind,
): LucideIcon {
  if (kind === "video") {
    return Clapperboard;
  }
  if (kind === "audio") {
    return AudioLines;
  }
  if (kind === "mixed") {
    return Upload;
  }
  return ImagePlus;
}

function fileInputClassName(label?: string) {
  return label ? "sr-only" : "hidden";
}

export function StudioMediaSlotAddTile({
  accept,
  multiple = false,
  disabled = false,
  isDragActive = false,
  label,
  inputLabel,
  actionLabel,
  mediaKind,
  required = false,
  testId,
  wrapperClassName,
  tileClassName,
  plusIconClassName,
  onDragOver,
  onDragLeave,
  onDrop,
  onPickFiles,
}: StudioMediaSlotAddTileProps) {
  const resolvedKind = mediaKind ?? inferMediaKindFromAccept(accept);
  const Icon = studioMediaSlotAddTileIcon(resolvedKind);

  function handleDragOver(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    event.stopPropagation();
    onDragOver?.(event);
  }

  function handleDragLeave(event: React.DragEvent<HTMLLabelElement>) {
    event.stopPropagation();
    onDragLeave?.(event);
  }

  function handleDrop(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    event.stopPropagation();
    onDrop?.(event);
  }

  return (
    <div className={cn("studio-media-slot-add-wrapper", wrapperClassName)}>
      {label ? <div className="studio-slot-label">{label}</div> : null}
      <label
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "studio-slot-tile",
          isDragActive ? "studio-slot-tile-drag-active" : "",
          disabled
            ? "cursor-not-allowed opacity-45 hover:border-white/10 hover:bg-white/[0.06]"
            : "",
          tileClassName,
        )}
      >
        {required ? (
          <span className="absolute left-2.5 top-2 text-[0.8rem] font-semibold leading-none text-[rgba(216,141,67,0.92)]">
            *
          </span>
        ) : null}
        <Icon className={cn("size-5.5", plusIconClassName)} />
        {actionLabel}
        <input
          type="file"
          multiple={multiple}
          accept={accept}
          data-testid={testId}
          aria-label={inputLabel}
          className={fileInputClassName(inputLabel)}
          disabled={disabled}
          onChange={(event) =>
            onPickFiles(event.target.files, event.currentTarget)
          }
        />
      </label>
    </div>
  );
}
