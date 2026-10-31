"use client";

import { ImageIcon } from "lucide-react";
import type { ReactNode } from "react";
import { MediaBrowserCard } from "@/components/ui/surface-primitives";

export function MediaBrowserItem({
  label,
  previewUrl,
  previewLabel,
  onPreview,
  disabled = false,
  actions,
  category,
  description,
  metadata,
  testId,
}: {
  label: string;
  previewUrl?: string | null;
  previewLabel: string;
  onPreview: () => void;
  disabled?: boolean;
  actions: ReactNode;
  category?: string;
  description?: string;
  metadata: ReactNode;
  testId: string;
}) {
  return (
    <MediaBrowserCard
      appearance="admin"
      className="media-browser-item"
      data-testid={testId}
    >
      <button
        type="button"
        className="media-browser-item-preview"
        onClick={onPreview}
        disabled={disabled}
        aria-label={previewLabel}
      >
        {previewUrl ? (
          <img src={previewUrl} alt={label} loading="lazy" decoding="async" />
        ) : (
          <span className="media-browser-item-placeholder">
            <ImageIcon aria-hidden="true" />
            <span>No preview</span>
          </span>
        )}
      </button>
      <div className="media-browser-item-body">
        <div className="media-browser-item-heading">
          <h3 title={label}>{label}</h3>
          <div className="media-browser-item-actions">{actions}</div>
        </div>
        {category ? (
          <div className="media-browser-item-category">{category}</div>
        ) : null}
        {description ? (
          <p className="media-browser-item-description" title={description}>
            {description}
          </p>
        ) : null}
        <div className="media-browser-item-metadata">{metadata}</div>
      </div>
    </MediaBrowserCard>
  );
}
