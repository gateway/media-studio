"use client";

import Image from "next/image";
import { X } from "lucide-react";

import { AdminButton } from "@/components/admin-controls";
import { overlayBackdropClassName, overlayPanelClassName } from "@/components/ui/surfaces";

export type GeneratedThumbnailPickerItem = {
  id: string;
  previewUrl: string | null;
  ariaLabel: string;
  alt?: string;
};

type GeneratedThumbnailPickerDialogProps = {
  open: boolean;
  eyebrow?: string;
  title: string;
  description?: string;
  dialogLabel: string;
  items: GeneratedThumbnailPickerItem[];
  loading: boolean;
  loadingMore: boolean;
  nextOffset: number | null;
  selectionId: string | null;
  zIndexClassName?: string;
  emptyMessage?: string;
  loadingMessage?: string;
  onClose: () => void;
  onLoadMore: () => void;
  onSelectItem: (itemId: string) => void;
};

export function GeneratedThumbnailPickerDialog({
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
  zIndexClassName = "z-[130]",
  emptyMessage = "No generated images are available yet.",
  loadingMessage = "Loading generated images...",
  onClose,
  onLoadMore,
  onSelectItem,
}: GeneratedThumbnailPickerDialogProps) {
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
        role="dialog"
        aria-modal="true"
        aria-label={dialogLabel}
        className={`${overlayPanelClassName} max-h-[88vh] w-full max-w-6xl overflow-hidden border border-[var(--surface-overlay-border)] bg-[var(--surface-card-bg)] p-0`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[var(--surface-border-soft)] px-5 py-4">
          <div className="grid gap-1">
            {eyebrow ? <div className="admin-label-accent">{eyebrow}</div> : null}
            <h2 className="text-xl font-semibold text-[var(--foreground)]">{title}</h2>
            {description ? <p className="text-sm text-[var(--muted-strong)]">{description}</p> : null}
          </div>
          <AdminButton variant="subtle" size="compact" onClick={onClose} aria-label={`Close ${dialogLabel}`}>
            <X className="size-4" />
          </AdminButton>
        </div>

        <div className="flex max-h-[calc(88vh-92px)] flex-col overflow-hidden">
          <div className="scrollbar-none flex-1 overflow-y-auto px-5 py-5">
            {loading ? (
              <div className="admin-surface-inset flex min-h-60 items-center justify-center p-6 text-sm text-[var(--muted-strong)]">
                {loadingMessage}
              </div>
            ) : items.length ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {items.map((item) => {
                  const selecting = selectionId === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className="group admin-surface-inset relative overflow-hidden p-3 text-left transition hover:border-[var(--surface-border)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-strong)] disabled:cursor-wait disabled:opacity-70"
                      onClick={() => onSelectItem(item.id)}
                      disabled={selecting}
                      aria-label={item.ariaLabel}
                    >
                      <div className="relative aspect-video overflow-hidden rounded-[var(--admin-radius-sm)] border border-[var(--surface-border-soft)] bg-[var(--surface-preview-bg)]">
                        {item.previewUrl ? (
                          <Image src={item.previewUrl} alt={item.alt ?? ""} fill sizes="480px" className="object-cover" />
                        ) : (
                          <div className="flex h-full items-center justify-center text-sm text-[var(--muted-strong)]">
                            No preview
                          </div>
                        )}
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-end bg-[var(--surface-overlay-panel)] px-3 py-2 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
                          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--foreground)]">
                            {selecting ? "Applying..." : "Use image"}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="admin-surface-inset flex min-h-60 items-center justify-center p-6 text-sm text-[var(--muted-strong)]">
                {emptyMessage}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--surface-border-soft)] px-5 py-4">
            <div className="text-sm text-[var(--muted-strong)]">
              Showing {items.length} generated image{items.length === 1 ? "" : "s"}.
            </div>
            <div className="flex flex-wrap gap-2">
              {nextOffset != null ? (
                <AdminButton variant="subtle" onClick={onLoadMore} disabled={loadingMore}>
                  {loadingMore ? "Loading..." : "Load more"}
                </AdminButton>
              ) : null}
              <AdminButton variant="subtle" onClick={onClose}>
                Close
              </AdminButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
