"use client";

import { AudioLines, Clapperboard, Image as ImageIcon, type LucideIcon, Upload } from "lucide-react";

import { cn } from "@/lib/utils";

type StudioMediaSlotAddTileKind = "image" | "video" | "audio" | "mixed";

type StudioMediaSlotAddTileProps = {
  accept: string;
  multiple?: boolean;
  disabled?: boolean;
  isDragActive?: boolean;
  label?: string;
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

export function studioMediaSlotAddTileIcon(kind: StudioMediaSlotAddTileKind): LucideIcon {
  if (kind === "video") {
    return Clapperboard;
  }
  if (kind === "audio") {
    return AudioLines;
  }
  if (kind === "mixed") {
    return Upload;
  }
  return ImageIcon;
}

export function StudioMediaSlotAddTile({
  accept,
  multiple = false,
  disabled = false,
  isDragActive = false,
  label,
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
    <div className={cn("flex shrink-0 flex-col gap-2", wrapperClassName)}>
      {label ? (
        <div className="text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-white/46">{label}</div>
      ) : null}
      <label
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "relative flex h-[82px] w-[82px] cursor-pointer items-center justify-center rounded-[24px] border border-white/10 bg-white/[0.06] text-white/82 transition hover:border-[rgba(216,141,67,0.28)] hover:bg-white/[0.09]",
          isDragActive ? "border-[rgba(216,141,67,0.42)] bg-[rgba(24,28,26,0.95)]" : "",
          disabled ? "cursor-not-allowed opacity-45 hover:border-white/10 hover:bg-white/[0.06]" : "",
          tileClassName,
        )}
      >
        {required ? (
          <span className="absolute left-2.5 top-2 text-[0.8rem] font-semibold leading-none text-[rgba(216,141,67,0.92)]">
            *
          </span>
        ) : null}
        <Icon className={cn("size-5.5", plusIconClassName)} />
        <input
          type="file"
          multiple={multiple}
          accept={accept}
          data-testid={testId}
          className="hidden"
          disabled={disabled}
          onChange={(event) => onPickFiles(event.target.files, event.currentTarget)}
        />
      </label>
    </div>
  );
}
