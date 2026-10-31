"use client";

import { LogIn, LoaderCircle, Trash2 } from "lucide-react";

import { MediaBrowserItem } from "@/components/media/media-browser-item";
import { IconButton } from "@/components/ui/icon-button";
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
    <MediaBrowserItem
      testId={`studio-reference-library-item-${item.reference_id}`}
      label={label}
      previewUrl={previewUrl}
      previewLabel={`Preview ${label}`}
      onPreview={() => onPreview(item)}
      metadata={
        <>
          <div>
            {referenceDimensions(item)} ·{" "}
            {Math.max(1, Math.round(item.file_size_bytes / 1024))} KB
          </div>
          <div>
            Last used{" "}
            {item.last_used_at ? formatDateTime(item.last_used_at) : "never"}
          </div>
        </>
      }
      actions={
        <>
          <IconButton
            icon={LogIn}
            tone="primary"
            onClick={() => onSelect(item)}
            appearance="admin"
            size="compact"
            quiet
            disabled={deleting}
            aria-label={actionLabel ?? defaultActionLabel(kind)}
            title={actionLabel ?? defaultActionLabel(kind)}
          />
          <IconButton
            icon={deleting ? LoaderCircle : Trash2}
            onClick={() => onDelete(item.reference_id)}
            disabled={deleting}
            tone="danger"
            appearance="admin"
            size="compact"
            quiet
            iconClassName={deleting ? "animate-spin" : undefined}
            aria-label={`Delete ${label} from the library`}
            title="Delete from library"
          />
        </>
      }
    />
  );
}
