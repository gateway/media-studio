"use client";

import { X } from "lucide-react";
import { useDialogFocus } from "@/components/ui/use-dialog-focus";

type StudioImageLightboxProps = {
  src: string;
  alt: string;
  kind?: "images" | "videos" | "audios";
  posterSrc?: string | null;
  onClose: () => void;
};

export function StudioImageLightbox({
  src,
  alt,
  kind = "images",
  posterSrc,
  onClose,
}: StudioImageLightboxProps) {
  const panelRef = useDialogFocus(onClose);

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Preview ${alt}`}
      tabIndex={-1}
      data-testid="studio-image-lightbox"
      className="studio-lightbox-root studio-reference-lightbox-root"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <button
        type="button"
        onClick={onClose}
        className="studio-reference-lightbox-close"
        aria-label="Close reference image lightbox"
      >
        <X className="size-5" />
      </button>
      <div
        className="studio-lightbox-swipe-surface"
        onClick={(event) => event.stopPropagation()}
      >
        {kind === "videos" ? (
          <video
            src={src}
            controls
            autoPlay
            playsInline
            preload="metadata"
            poster={posterSrc ?? undefined}
            className="studio-lightbox-media"
          />
        ) : kind === "audios" ? (
          <div className="studio-reference-lightbox-audio-panel">
            <div className="studio-reference-lightbox-audio-kicker">
              Audio Reference
            </div>
            <div className="studio-reference-lightbox-audio-title">{alt}</div>
            <audio
              src={src}
              controls
              autoPlay
              preload="metadata"
              className="studio-reference-lightbox-audio-control"
            />
          </div>
        ) : (
          <img
            src={src}
            alt={alt}
            loading="eager"
            fetchPriority="high"
            decoding="async"
            className="studio-lightbox-media"
          />
        )}
      </div>
    </div>
  );
}
