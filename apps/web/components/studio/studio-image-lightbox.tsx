"use client";

import { X } from "lucide-react";

type StudioImageLightboxProps = {
  src: string;
  alt: string;
  onClose: () => void;
};

export function StudioImageLightbox({ src, alt, onClose }: StudioImageLightboxProps) {
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
        <img
          src={src}
          alt={alt}
          loading="eager"
          fetchPriority="high"
          decoding="async"
          className="max-h-full w-auto max-w-full rounded-[28px] object-contain shadow-[0_28px_90px_rgba(0,0,0,0.48)]"
        />
      </div>
    </div>
  );
}
