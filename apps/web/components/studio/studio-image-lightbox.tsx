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
    <div data-testid="studio-image-lightbox" className="fixed inset-0 z-[140] bg-[rgba(4,6,5,0.96)]" onClick={onClose}>
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 z-10 flex h-11 w-11 items-center justify-center rounded-full border border-white/12 bg-black/24 text-white/82 transition hover:text-white md:right-6 md:top-6"
        aria-label="Close reference image lightbox"
      >
        <X className="size-5" />
      </button>
      <div className="flex h-full w-full items-center justify-center p-4 md:p-8" onClick={(event) => event.stopPropagation()}>
        {kind === "videos" ? (
          <video
            src={src}
            controls
            autoPlay
            playsInline
            preload="metadata"
            poster={posterSrc ?? undefined}
            className="max-h-full w-auto max-w-full rounded-[28px] object-contain shadow-[0_28px_90px_rgba(0,0,0,0.48)]"
          />
        ) : kind === "audios" ? (
          <div className="w-full max-w-[32rem] rounded-[28px] border border-white/12 bg-[rgba(10,12,11,0.88)] p-6 shadow-[0_28px_90px_rgba(0,0,0,0.48)]">
            <div className="text-sm font-semibold uppercase tracking-[0.18em] text-white/48">Audio Reference</div>
            <div className="mt-3 text-lg font-medium text-white/92">{alt}</div>
            <audio src={src} controls autoPlay preload="metadata" className="mt-5 w-full" />
          </div>
        ) : (
          <img
            src={src}
            alt={alt}
            loading="eager"
            fetchPriority="high"
            decoding="async"
            className="max-h-full w-auto max-w-full rounded-[28px] object-contain shadow-[0_28px_90px_rgba(0,0,0,0.48)]"
          />
        )}
      </div>
    </div>
  );
}
