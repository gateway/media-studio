"use client";

import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";

import { AdminButton } from "@/components/admin-controls";
import {
  overlayBackdropClassName,
  overlayPanelClassName,
} from "@/components/ui/surfaces";
import type {
  MediaImagePickerFit,
  MediaImagePickerItem,
  MediaImagePickerPurpose,
} from "./media-image-picker-types";
import { MediaImagePickerGrid } from "./media-image-picker-grid";
import { MediaImagePickerPreview } from "./media-image-picker-preview";

type MediaImagePickerDialogProps = {
  open: boolean;
  eyebrow?: string;
  title: string;
  description?: string;
  dialogLabel: string;
  items: MediaImagePickerItem[];
  loading: boolean;
  loadingMore: boolean;
  nextOffset: number | null;
  selectionId: string | null;
  purpose?: MediaImagePickerPurpose;
  imageFit?: MediaImagePickerFit;
  zIndexClassName?: string;
  emptyMessage?: string;
  loadingMessage?: string;
  itemLabel?: string;
  onClose: () => void;
  onLoadMore: () => void;
  onSelectItem: (itemId: string) => void;
};

export function MediaImagePickerDialog({
  open,
  eyebrow = "Generated Images",
  title,
  description,
  dialogLabel,
  items,
  loading,
  loadingMore,
  nextOffset,
  selectionId,
  purpose = "thumbnail",
  imageFit,
  zIndexClassName = "z-[130]",
  emptyMessage = "No generated images are available yet.",
  loadingMessage = "Loading generated images...",
  itemLabel = "generated image",
  onClose,
  onLoadMore,
  onSelectItem,
}: MediaImagePickerDialogProps) {
  const descriptionId = useId();
  const statusId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const scrollRootRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const [previewItemId, setPreviewItemId] = useState<string | null>(null);
  const hasMore = nextOffset != null;
  const previewItem = previewItemId
    ? (items.find((item) => item.id === previewItemId) ?? null)
    : null;

  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    previousActiveElementRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const focusFrame = window.requestAnimationFrame(() => {
      panelRef.current?.focus({ preventScroll: true });
    });
    return () => {
      window.cancelAnimationFrame(focusFrame);
      previousActiveElementRef.current?.focus();
      previousActiveElementRef.current = null;
    };
  }, [open]);

  useEffect(() => {
    if (!open || loading || loadingMore || !hasMore) return;
    const root = scrollRootRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel || typeof IntersectionObserver === "undefined")
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onLoadMore();
        }
      },
      { root, rootMargin: "360px 0px 360px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loading, loadingMore, onLoadMore, open]);

  useEffect(() => {
    if (!open) {
      setPreviewItemId(null);
    }
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className={`${overlayBackdropClassName} ${zIndexClassName} flex items-center justify-center bg-[var(--surface-overlay-backdrop)] p-4`}
      role="presentation"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={dialogLabel}
        aria-describedby={
          description ? `${descriptionId} ${statusId}` : statusId
        }
        tabIndex={-1}
        className={`media-image-picker-dialog ${overlayPanelClassName}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="media-image-picker-header">
          <div className="grid gap-1">
            {eyebrow ? (
              <div className="admin-label-accent">{eyebrow}</div>
            ) : null}
            <h2 className="text-xl font-semibold text-[var(--foreground)]">
              {title}
            </h2>
            {description ? (
              <p
                id={descriptionId}
                className="text-sm text-[var(--muted-strong)]"
              >
                {description}
              </p>
            ) : null}
          </div>
          <AdminButton
            variant="subtle"
            size="compact"
            onClick={onClose}
            aria-label={`Close ${dialogLabel}`}
          >
            <X className="size-4" />
          </AdminButton>
        </div>

        <div className="media-image-picker-body">
          <div
            ref={scrollRootRef}
            className="scrollbar-none flex-1 overflow-y-auto px-5 py-5"
          >
            {loading && !items.length ? (
              <div className="admin-surface-inset flex min-h-60 items-center justify-center p-6 text-sm text-[var(--muted-strong)]">
                {loadingMessage}
              </div>
            ) : items.length ? (
              <>
                <MediaImagePickerGrid
                  items={items}
                  purpose={purpose}
                  imageFit={imageFit}
                  selectionId={selectionId}
                  onSelectItem={onSelectItem}
                  onPreviewItem={setPreviewItemId}
                />
                <div
                  ref={sentinelRef}
                  className="media-image-picker-sentinel min-h-8"
                >
                  <span
                    id={statusId}
                    className="sr-only"
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                  >
                    {loadingMore ? "Loading more images." : ""}
                  </span>
                </div>
              </>
            ) : (
              <div className="admin-surface-inset flex min-h-60 items-center justify-center p-6 text-sm text-[var(--muted-strong)]">
                {emptyMessage}
              </div>
            )}
          </div>

          <div className="media-image-picker-footer">
            <div className="media-image-picker-footer-count">
              Showing {items.length} {itemLabel}
              {items.length === 1 ? "" : "s"}.
            </div>
          </div>
        </div>
        {previewItem ? (
          <MediaImagePickerPreview
            item={previewItem}
            onClose={() => setPreviewItemId(null)}
          />
        ) : null}
      </div>
    </div>
  );
}
