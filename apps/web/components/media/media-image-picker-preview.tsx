"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

import { AdminButton } from "@/components/admin-controls";
import type { MediaImagePickerItem } from "./media-image-picker-types";

type MediaImagePickerPreviewProps = {
  item: MediaImagePickerItem;
  onClose: () => void;
};

function dimensionsLabel(item: MediaImagePickerItem) {
  if (!item.width || !item.height) return null;
  return `${item.width}x${item.height}`;
}

export function MediaImagePickerPreview({
  item,
  onClose,
}: MediaImagePickerPreviewProps) {
  const mediaType = item.mediaType ?? "image";
  const mediaLabel = mediaType[0].toUpperCase() + mediaType.slice(1);
  const mediaUrl = item.fullUrl || (mediaType === "image" ? item.previewUrl : null);
  const label = item.alt || item.filename || `Selected ${mediaType} preview`;
  const dimensions = dimensionsLabel(item);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="media-image-picker-preview"
      role="dialog"
      aria-modal="false"
      aria-label={`${mediaLabel} preview`}
    >
      <div className="media-image-picker-preview-header">
        <div className="grid min-w-0 gap-1">
          <div className="admin-label-accent">{mediaLabel} Preview</div>
          <h3 className="truncate text-lg font-semibold text-[var(--foreground)]">
            {label}
          </h3>
          <p className="text-sm text-[var(--muted-strong)]">
            {dimensions ? `${dimensions} · ` : ""}Review the full {mediaType} before
            selecting it.
          </p>
        </div>
        <AdminButton
          variant="subtle"
          size="compact"
          onClick={onClose}
          aria-label={`Close ${mediaType} preview`}
        >
          <X className="size-4" />
        </AdminButton>
      </div>
      <div className="media-image-picker-preview-body">
        {mediaUrl ? mediaType === "video" ? (
          <video src={mediaUrl} controls playsInline preload="metadata" aria-label={label}
            className="max-h-full max-w-full object-contain" />
        ) : mediaType === "audio" ? (
          <audio src={mediaUrl} controls preload="metadata" aria-label={label} />
        ) : (
          <img
            src={mediaUrl}
            alt={item.alt ?? ""}
            className="max-h-full max-w-full object-contain"
            loading="eager"
            decoding="async"
          />
        ) : (
          <div className="text-sm text-[var(--muted-strong)]">
            No preview is available for this {mediaType}.
          </div>
        )}
      </div>
    </div>
  );
}
