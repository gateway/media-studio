"use client";
import { Maximize2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MediaAsset } from "@/lib/types";

type InspectorMediaProps = {
  asset: MediaAsset;
  displayVisual: string | null;
  playbackVisual: string | null;
  onOpenLightbox: () => void;
};

function AudioPreview({
  asset,
  displayVisual,
  playbackVisual,
}: InspectorMediaProps) {
  if (!playbackVisual) return <p>Audio preview unavailable</p>;
  const alt = asset.prompt_summary ?? "Selected audio artifact";
  return (
    <div className="studio-media-inspector-audio">
      {displayVisual ? (
        <img src={displayVisual} alt={alt} loading="eager" decoding="async" />
      ) : null}
      <audio
        src={playbackVisual}
        controls
        preload="metadata"
        aria-label={alt}
      />
    </div>
  );
}

function VisualPreview({
  asset,
  displayVisual,
  playbackVisual,
  onOpenLightbox,
}: InspectorMediaProps) {
  const alt = asset.prompt_summary ?? "Selected media artifact";
  const video = asset.generation_kind === "video";
  if (video && !playbackVisual) return <p>Video preview unavailable</p>;
  if (!displayVisual)
    return playbackVisual ? (
      <video
        src={playbackVisual}
        aria-label={alt}
        controls
        playsInline
        preload="metadata"
      />
    ) : (
      <p>Media preview unavailable</p>
    );
  return (
    <button
      type="button"
      data-testid="studio-open-lightbox"
      onClick={onOpenLightbox}
      className="studio-media-inspector-preview"
      aria-label={video ? "Open selected video" : "Open selected image"}
    >
      <img
        src={displayVisual}
        alt={alt}
        loading="eager"
        fetchPriority="high"
        decoding="async"
      />
      {video ? (
        <span className="studio-media-inspector-play">
          <Play className="size-8" />
        </span>
      ) : null}
    </button>
  );
}

export function StudioInspectorMedia(props: InspectorMediaProps) {
  const canPreview = [props.displayVisual, props.playbackVisual].some(Boolean);
  return (
    <div className="studio-media-inspector-media">
      <div className="studio-media-inspector-canvas">
        {props.asset.generation_kind === "audio" ? (
          <AudioPreview {...props} />
        ) : (
          <VisualPreview {...props} />
        )}
      </div>
      {canPreview ? (
        <Button
          appearance="admin"
          size="touch"
          variant="media-expand"
          onClick={props.onOpenLightbox}
          className="studio-media-inspector-full-size"
        >
          <Maximize2 className="size-5" />
          <span>Open full size</span>
        </Button>
      ) : null}
    </div>
  );
}
