"use client";

import { X } from "lucide-react";

import type { MediaAsset } from "@/lib/types";

type StudioLightboxProps = {
  selectedAsset: MediaAsset;
  selectedAssetDisplayVisual: string | null;
  selectedAssetPlaybackVisual: string | null;
  selectedAssetLightboxVisual: string | null;
  lightboxVideoRef: React.MutableRefObject<HTMLVideoElement | null>;
  onClose: () => void | Promise<void>;
};

export function StudioLightbox({
  selectedAsset,
  selectedAssetDisplayVisual,
  selectedAssetPlaybackVisual,
  selectedAssetLightboxVisual,
  lightboxVideoRef,
  onClose,
}: StudioLightboxProps) {
  return (
    <div data-testid="studio-lightbox" className="fixed inset-0 z-[140] bg-[rgba(4,6,5,0.96)]" onClick={() => void onClose()}>
      <button
        type="button"
        onClick={() => void onClose()}
        className="absolute right-4 top-4 z-10 flex h-11 w-11 items-center justify-center rounded-full border border-white/12 bg-black/24 text-white/82 transition hover:text-white md:right-6 md:top-6"
        aria-label="Close media lightbox"
      >
        <X className="size-5" />
      </button>
      <div className="flex h-full w-full items-center justify-center p-4 md:p-8" onClick={(event) => event.stopPropagation()}>
        {selectedAsset.generation_kind === "video" && selectedAssetPlaybackVisual ? (
          <video
            ref={lightboxVideoRef}
            src={selectedAssetPlaybackVisual}
            controls
            autoPlay
            playsInline
            preload="metadata"
            poster={selectedAssetDisplayVisual ?? undefined}
            className="max-h-full w-auto max-w-full rounded-[28px] object-contain shadow-[0_28px_90px_rgba(0,0,0,0.48)]"
          />
        ) : selectedAssetLightboxVisual ? (
          <img
            src={selectedAssetLightboxVisual}
            alt={selectedAsset.prompt_summary ?? "Selected media artifact"}
            loading="eager"
            fetchPriority="high"
            decoding="async"
            className="max-h-full w-auto max-w-full rounded-[28px] object-contain shadow-[0_28px_90px_rgba(0,0,0,0.48)]"
          />
        ) : null}
      </div>
    </div>
  );
}
