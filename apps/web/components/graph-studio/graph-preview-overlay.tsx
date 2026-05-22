"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect } from "react";

import type { GraphMediaPreview } from "./types";

export function GraphPreviewOverlay({
  previews,
  index,
  onClose,
  onNavigate,
}: {
  previews: GraphMediaPreview[];
  index: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}) {
  const preview = previews[index] ?? null;
  const hasMultiple = previews.length > 1;

  useEffect(() => {
    if (!preview) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "ArrowLeft" && hasMultiple) {
        event.preventDefault();
        onNavigate((index - 1 + previews.length) % previews.length);
      } else if (event.key === "ArrowRight" && hasMultiple) {
        event.preventDefault();
        onNavigate((index + 1) % previews.length);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hasMultiple, index, onClose, onNavigate, preview, previews.length]);

  if (!preview) return null;
  return (
    <div className="graph-preview-overlay" data-testid="graph-preview-overlay" role="dialog" aria-label="Graph media preview" onClick={onClose}>
      <button className="graph-preview-close" type="button" aria-label="Close preview" onClick={onClose}>
        <X size={20} />
      </button>
      {hasMultiple ? (
        <>
          <button
            className="graph-preview-nav graph-preview-nav-previous"
            type="button"
            aria-label="Previous image"
            onClick={(event) => {
              event.stopPropagation();
              onNavigate((index - 1 + previews.length) % previews.length);
            }}
          >
            <ChevronLeft size={28} />
          </button>
          <button
            className="graph-preview-nav graph-preview-nav-next"
            type="button"
            aria-label="Next image"
            onClick={(event) => {
              event.stopPropagation();
              onNavigate((index + 1) % previews.length);
            }}
          >
            <ChevronRight size={28} />
          </button>
          <div className="graph-preview-count">
            {index + 1} / {previews.length}
          </div>
        </>
      ) : null}
      <div className="graph-preview-stage" onClick={(event) => event.stopPropagation()}>
        {preview.mediaType === "video" ? (
          <video src={preview.fullUrl ?? preview.url} poster={preview.posterUrl ?? undefined} controls autoPlay />
        ) : (
          <img src={preview.fullUrl ?? preview.url} alt={preview.label ?? "Graph media preview"} />
        )}
      </div>
    </div>
  );
}
