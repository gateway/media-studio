"use client";

import { ImageIcon } from "lucide-react";
import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";
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
  layout = "card",
  previewTitle,
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
  layout?: "card" | "tile" | "editorial";
  previewTitle?: string;
}) {
  const detailsId = useId();
  const tiled = layout === "tile";
  return (
    <MediaBrowserCard
      appearance="admin"
      className={cn(
        "media-browser-item",
        tiled && "media-browser-item-tile",
        layout === "editorial" && "media-browser-item-editorial",
      )}
      data-testid={testId}
    >
      <button
        type="button"
        className="media-browser-item-preview"
        onClick={onPreview}
        disabled={disabled}
        aria-label={previewLabel}
        aria-describedby={detailsId}
        title={previewTitle}
      >
        {previewUrl ? (
          <img
            src={previewUrl}
            alt={label}
            loading="lazy"
            decoding="async"
            className="media-browser-item-visual"
            onLoad={(event) => {
              const image = event.currentTarget;
              image.dataset.portrait = String(
                image.naturalHeight > image.naturalWidth,
              );
            }}
          />
        ) : (
          <span className="media-browser-item-placeholder">
            <ImageIcon aria-hidden="true" />
            <span>No preview</span>
          </span>
        )}
      </button>
      {tiled ? (
        <div className="media-browser-item-actions">{actions}</div>
      ) : null}
      <MediaBrowserItemBody
        id={detailsId}
        label={label}
        tiled={tiled}
        category={category}
        description={description}
        metadata={metadata}
        actions={actions}
      />
    </MediaBrowserCard>
  );
}

function MediaBrowserItemBody({
  id,
  label,
  tiled,
  category,
  description,
  metadata,
  actions,
}: {
  id: string;
  label: string;
  tiled: boolean;
  category?: string;
  description?: string;
  metadata: ReactNode;
  actions: ReactNode;
}) {
  return (
    <div id={id} className={cn("media-browser-item-body", tiled && "sr-only")}>
      <div className="media-browser-item-heading">
        <h3 title={label}>{label}</h3>
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
      {!tiled ? (
        <div className="media-browser-item-actions">{actions}</div>
      ) : null}
    </div>
  );
}
