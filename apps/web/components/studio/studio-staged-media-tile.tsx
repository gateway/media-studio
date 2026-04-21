"use client";

import { Image as ImageIcon, Play, Volume2, X } from "lucide-react";

import type { StudioReferencePreview } from "@/lib/media-studio-helpers";
import { cn } from "@/lib/utils";

type StudioStagedMediaTileProps = {
  preview: StudioReferencePreview;
  visualUrl?: string | null;
  footerLabel?: string | null;
  onOpenPreview: (preview: StudioReferencePreview) => void;
  onRemove?: () => void;
  replaceControl?: React.ReactNode;
  className?: string;
  tileClassName?: string;
  testId?: string;
};

export function StudioStagedMediaTile({
  preview,
  visualUrl,
  footerLabel,
  onOpenPreview,
  onRemove,
  replaceControl,
  className,
  tileClassName,
  testId,
}: StudioStagedMediaTileProps) {
  const mediaVisual = visualUrl ?? (preview.kind === "images" ? preview.url : preview.posterUrl ?? null);
  const videoPoster = preview.posterUrl ?? (visualUrl && visualUrl !== preview.url ? visualUrl : null);

  return (
    <div data-testid={testId} className={cn("group relative", className)}>
      <button
        type="button"
        onClick={() => onOpenPreview(preview)}
        className={cn("surface-preview-frame relative h-full w-full overflow-hidden text-left", tileClassName)}
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
              <span className="absolute inset-0 flex items-center justify-center bg-black/28">
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
              <span className="absolute inset-0 flex items-center justify-center bg-black/28">
                <Play className="size-4 text-white" />
              </span>
            </>
          ) : (
            <span className="flex h-full w-full items-center justify-center bg-white/[0.05] text-white/72">
              <Play className="size-5" />
            </span>
          )
        ) : preview.kind === "audios" ? (
          <span className="flex h-full w-full flex-col items-center justify-center gap-1 bg-white/[0.05] text-white/72">
            <Volume2 className="size-5" />
            <span className="text-[0.55rem] font-semibold uppercase tracking-[0.12em] text-white/58">Audio</span>
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
          <span className="flex h-full w-full items-center justify-center bg-white/[0.05] text-white/72">
            <ImageIcon className="size-5" />
          </span>
        )}
        {footerLabel ? (
          <div className="absolute inset-x-0 bottom-0 bg-black/45 px-2 py-1 text-[0.5rem] font-semibold uppercase leading-[1.15] tracking-[0.1em] text-white/92">
            {footerLabel}
          </div>
        ) : null}
      </button>
      {replaceControl ? <div className="absolute bottom-1.5 left-1.5 z-10">{replaceControl}</div> : null}
      {onRemove ? (
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onRemove();
          }}
          data-testid={testId ? `${testId}-remove` : undefined}
          className="studio-slot-utility-button absolute right-1.5 top-1.5 z-10 inline-flex h-8 w-8 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
          aria-label={`Remove ${preview.label}`}
          title={`Remove ${preview.label}`}
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
