"use client";

import { X } from "lucide-react";
import { useRef } from "react";

import { useDialogFocus } from "@/components/ui/use-dialog-focus";
import { OverlayShell } from "@/components/ui/surface-primitives";
import type { MediaAsset } from "@/lib/types";

type StudioLightboxProps = {
  selectedAsset: MediaAsset;
  selectedAssetDisplayVisual: string | null;
  selectedAssetPlaybackVisual: string | null;
  selectedAssetLightboxVisual: string | null;
  lightboxVideoRef: React.MutableRefObject<HTMLVideoElement | null>;
  onNavigate: (direction: 1 | -1) => boolean;
  onClose: () => void | Promise<void>;
};

export function StudioLightbox({
  selectedAsset,
  selectedAssetDisplayVisual,
  selectedAssetPlaybackVisual,
  selectedAssetLightboxVisual,
  lightboxVideoRef,
  onNavigate,
  onClose,
}: StudioLightboxProps) {
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  function closeLightbox() {
    Promise.resolve(onClose()).catch(console.error);
  }
  const panelRef = useDialogFocus(closeLightbox);

  function handleTouchStart(event: React.TouchEvent<HTMLDivElement>) {
    const touch = event.touches[0];
    if (!touch) {
      return;
    }
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  }

  function handleTouchEnd(event: React.TouchEvent<HTMLDivElement>) {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start) {
      return;
    }
    const touch = event.changedTouches[0];
    if (!touch) {
      return;
    }
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (Math.abs(deltaX) < 56 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.2) {
      return;
    }
    onNavigate(deltaX < 0 ? 1 : -1);
  }

  return (
    <OverlayShell
      backdropClassName="z-[140] bg-[rgba(4,6,5,0.96)]"
      panelClassName="flex min-h-dvh items-center justify-center border-0 bg-transparent shadow-none"
      innerClassName="p-0"
    >
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label="Full size media" tabIndex={-1} data-testid="studio-lightbox" className="studio-lightbox-root" onClick={closeLightbox}>
        <button
          type="button"
          onClick={closeLightbox}
          className="overlay-close-button absolute right-4 top-4 z-10 h-11 w-11 md:right-6 md:top-6"
          aria-label="Close media lightbox"
        >
          <X className="size-5" />
        </button>
        <div
          data-testid="studio-lightbox-swipe-surface"
          className="studio-lightbox-swipe-surface"
          onClick={(event) => event.stopPropagation()}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {selectedAsset.generation_kind === "video" && selectedAssetPlaybackVisual ? (
            <video
              ref={lightboxVideoRef}
              src={selectedAssetPlaybackVisual}
              controls
              autoPlay
              playsInline
              preload="metadata"
              poster={selectedAssetDisplayVisual ?? undefined}
              className="studio-lightbox-media"
            />
          ) : selectedAsset.generation_kind === "audio" && selectedAssetPlaybackVisual ? (
            <div className="studio-lightbox-audio-shell">
              {selectedAssetDisplayVisual ? (
                <img
                  src={selectedAssetDisplayVisual}
                  alt={selectedAsset.prompt_summary ?? "Selected audio artwork"}
                  loading="eager"
                  fetchPriority="high"
                  decoding="async"
                  className="studio-lightbox-audio-artwork"
                />
              ) : null}
              <audio
                src={selectedAssetPlaybackVisual}
                controls
                autoPlay
                preload="metadata"
                className="w-full"
                aria-label={selectedAsset.prompt_summary ?? "Selected audio artifact"}
              />
            </div>
          ) : selectedAssetLightboxVisual ? (
            <img
              src={selectedAssetLightboxVisual}
              alt={selectedAsset.prompt_summary ?? "Selected media artifact"}
              loading="eager"
              fetchPriority="high"
              decoding="async"
              className="studio-lightbox-media"
            />
          ) : null}
        </div>
      </div>
    </OverlayShell>
  );
}
