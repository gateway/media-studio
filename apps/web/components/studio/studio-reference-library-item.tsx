"use client";

import { Image as ImageIcon, LoaderCircle, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { MediaBrowserCard } from "@/components/ui/surface-primitives";
import type { MediaReference } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

type StudioReferenceLibraryItemProps = {
  item: MediaReference;
  kind: "image" | "video" | "audio" | "all";
  actionLabel?: string;
  deleting: boolean;
  onPreview: (item: MediaReference) => void;
  onSelect: (item: MediaReference) => void;
  onDelete: (referenceId: string) => void;
};

function referenceDimensions(item: MediaReference) {
  if (!item.width || !item.height) return "Unknown size";
  return `${item.width}x${item.height}`;
}

function defaultActionLabel(kind: StudioReferenceLibraryItemProps["kind"]) {
  if (kind === "all") return "Use reference";
  if (kind === "video") return "Use video";
  if (kind === "audio") return "Use audio";
  return "Use image";
}

export function StudioReferenceLibraryItem({
  item,
  kind,
  actionLabel,
  deleting,
  onPreview,
  onSelect,
  onDelete,
}: StudioReferenceLibraryItemProps) {
  const previewUrl = item.thumb_url ?? item.stored_url ?? null;
  const label = item.original_filename ?? item.reference_id;

  return (
    <MediaBrowserCard
      data-testid={`studio-reference-library-item-${item.reference_id}`}
      appearance="studio"
      className="studio-reference-library-item"
    >
      <button
        type="button"
        onClick={() => onPreview(item)}
        className="media-browser-card-thumbnail group relative aspect-square text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-strong)]"
        aria-label={`Preview ${label}`}
      >
        {previewUrl ? (
          <img
            src={previewUrl}
            alt={label}
            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-white/58">
            <ImageIcon className="size-4" aria-hidden="true" />
            <span className="sr-only">No preview available for {label}</span>
          </div>
        )}
      </button>
      <div className="media-browser-card-copy">
        <div className="media-browser-card-title truncate">
          {label}
        </div>
        <div className="media-browser-card-description">
          {referenceDimensions(item)} · {Math.max(1, Math.round(item.file_size_bytes / 1024))} KB
        </div>
      </div>
      <div className="media-browser-card-actions">
        <Button
          onClick={() => onSelect(item)}
          variant="primary"
          size="compact"
          className="h-8 min-w-0 rounded-full px-3 text-[0.62rem] tracking-[0.12em]"
        >
          {actionLabel ?? defaultActionLabel(kind)}
        </Button>
        <IconButton
          icon={deleting ? LoaderCircle : Trash2}
          onClick={() => onDelete(item.reference_id)}
          disabled={deleting}
          tone="danger"
          iconClassName={deleting ? "animate-spin" : undefined}
          className="h-8 w-8 rounded-full"
          aria-label={`Delete ${label} from the library`}
          title="Delete from library"
        />
      </div>
      <div className="media-browser-card-meta">
        Last used {item.last_used_at ? formatDateTime(item.last_used_at) : "never"}
      </div>
    </MediaBrowserCard>
  );
}
