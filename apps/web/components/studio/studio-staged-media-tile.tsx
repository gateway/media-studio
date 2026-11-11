"use client";

import { Image as ImageIcon, ImagePlus, Play, Volume2, X } from "lucide-react";
import type { HTMLAttributes } from "react";

import {
  studioPreviewFallbackClassName,
  studioPreviewOverlayClassName,
} from "@/components/studio/studio-theme";
import type { StudioReferencePreview } from "@/lib/media-studio-helpers";
import { cn } from "@/lib/utils";

type StudioStagedMediaTileProps = {
  preview: StudioReferencePreview;
  visualUrl?: string | null;
  footerLabel?: string | null;
  positionBadge?: React.ReactNode;
  previewBadge?: React.ReactNode;
  onOpenPreview: (preview: StudioReferencePreview) => void;
  onRemove?: () => void;
  replaceControl?: React.ReactNode;
  className?: string;
  tileClassName?: string;
  testId?: string;
  dropTarget?: Pick<
    HTMLAttributes<HTMLDivElement>,
    "onDragOver" | "onDragLeave" | "onDrop"
  >;
};

export function StudioStagedMediaTile({
  preview,
  visualUrl,
  footerLabel,
  positionBadge,
  previewBadge,
  onOpenPreview,
  onRemove,
  replaceControl,
  className,
  tileClassName,
  testId,
  dropTarget,
}: StudioStagedMediaTileProps) {
  const mediaVisual =
    visualUrl ??
    (preview.kind === "images" ? preview.url : (preview.posterUrl ?? null));
  const videoPoster =
    preview.posterUrl ??
    (visualUrl && visualUrl !== preview.url ? visualUrl : null);

  return (
    <div
      {...dropTarget}
      data-testid={testId}
      className={cn("group relative", className)}
    >
      <button
        type="button"
        onClick={() => onOpenPreview(preview)}
        className={cn(
          "surface-preview-frame relative h-full w-full overflow-hidden text-left",
          tileClassName,
        )}
        title={preview.label}
      >
        {preview.kind === "videos" ? (
          videoPoster ? (
            <>
              <img
                src={videoPoster}
                alt={preview.label}
                loading="eager"
                fetchPriority="high"
                decoding="async"
                className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
              />
              <span className={studioPreviewOverlayClassName()}>
                <Play className="size-4 text-white" />
              </span>
            </>
          ) : preview.url ? (
            <>
              <video
                src={preview.url}
                muted
                playsInline
                preload="metadata"
                className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
              />
              <span className={studioPreviewOverlayClassName()}>
                <Play className="size-4 text-white" />
              </span>
            </>
          ) : (
            <span className={studioPreviewFallbackClassName()}>
              <Play className="size-5" />
            </span>
          )
        ) : preview.kind === "audios" ? (
          <span
            className={studioPreviewFallbackClassName({
              className: "flex-col gap-1",
            })}
          >
            <Volume2 className="size-5" />
            <span className="text-[0.55rem] font-semibold uppercase tracking-[0.12em] text-[var(--text-dim)]">
              Audio
            </span>
          </span>
        ) : mediaVisual ? (
          <img
            src={mediaVisual}
            alt={preview.label}
            loading="eager"
            fetchPriority="high"
            decoding="async"
            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
          />
        ) : (
          <span className={studioPreviewFallbackClassName()}>
            <ImageIcon className="size-5" />
          </span>
        )}
        {previewBadge}
        {footerLabel ? (
          <div className="absolute inset-x-0 bottom-0 bg-black/45 px-2 py-1 text-[0.5rem] font-semibold uppercase leading-[1.15] tracking-[0.1em] text-white/92">
            {footerLabel}
          </div>
        ) : null}
      </button>
      {positionBadge}
      {replaceControl ? (
        <div className="studio-staged-media-replace absolute z-10">
          {replaceControl}
        </div>
      ) : null}
      {onRemove ? (
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onRemove();
          }}
          data-testid={testId ? `${testId}-remove` : undefined}
          className="studio-staged-media-remove studio-slot-utility-button absolute right-1.5 top-1.5 z-10 inline-flex h-8 w-8 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
          aria-label={`Remove ${preview.label}`}
          title={`Remove ${preview.label}`}
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

export function StudioStagedMediaReplaceControl({
  label,
  accept,
  testId,
  onPickFiles,
}: {
  label: string;
  accept: string;
  testId?: string;
  onPickFiles: (files: FileList, input: HTMLInputElement) => void;
}) {
  return (
    <label
      className="studio-staged-media-replace-input studio-slot-utility-button inline-flex h-8 w-8 cursor-pointer items-center justify-center"
      title={label}
    >
      <ImagePlus aria-hidden="true" className="size-3.5" />
      <input
        type="file"
        accept={accept}
        data-testid={testId}
        aria-label={label}
        className="sr-only"
        onChange={({ currentTarget }) => {
          if (currentTarget.files?.length)
            onPickFiles(currentTarget.files, currentTarget);
        }}
      />
    </label>
  );
}
