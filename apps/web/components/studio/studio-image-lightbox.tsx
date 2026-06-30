"use client";

import { X } from "lucide-react";
import { useEffect } from "react";

type StudioImageLightboxProps = {
  src: string;
  alt: string;
  kind?: "images" | "videos" | "audios";
  posterSrc?: string | null;
  onClose: () => void;
};

export function StudioImageLightbox({ src, alt, kind = "images", posterSrc, onClose }: StudioImageLightboxProps) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      data-testid="studio-image-lightbox"
      className="studio-lightbox-root studio-reference-lightbox-root"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        className="studio-reference-lightbox-close"
        aria-label="Close reference image lightbox"
      >
        <X className="size-5" />
      </button>
      <div className="studio-lightbox-swipe-surface" onClick={(event) => event.stopPropagation()}>
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
            <div className="studio-reference-lightbox-audio-kicker">Audio Reference</div>
            <div className="studio-reference-lightbox-audio-title">{alt}</div>
            <audio src={src} controls autoPlay preload="metadata" className="studio-reference-lightbox-audio-control" />
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
