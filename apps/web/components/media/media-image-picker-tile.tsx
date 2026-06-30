"use client";

import { Eye, Image as ImageIcon, Music, Video } from "lucide-react";
import type { DragEvent, KeyboardEvent } from "react";

import type {
  MediaImagePickerFit,
  MediaImagePickerItem,
  MediaImagePickerPurpose,
} from "./media-image-picker-types";

type MediaImagePickerTileProps = {
  item: MediaImagePickerItem;
  index: number;
  purpose: MediaImagePickerPurpose;
  imageFit?: MediaImagePickerFit;
  selecting: boolean;
  onSelect: (itemId: string) => void;
  onPreview: (itemId: string) => void;
  onDrag?: (item: MediaImagePickerItem, event: DragEvent<HTMLButtonElement>) => void;
};

function resolvedFit(
  _purpose: MediaImagePickerPurpose,
  imageFit?: MediaImagePickerFit,
) {
  if (imageFit) return imageFit;
  return "contain";
}

function dimensionsLabel(item: MediaImagePickerItem) {
  if (!item.width || !item.height) return null;
  return `${item.width}x${item.height}`;
}

function mediaTypeLabel(item: MediaImagePickerItem) {
  if (item.mediaType === "video" || item.source?.endsWith("-video")) {
    return "video";
  }
  if (item.mediaType === "audio" || item.source?.endsWith("-audio")) {
    return "audio";
  }
  return "image";
}

function durationLabel(durationSeconds: number | null | undefined) {
  if (
    typeof durationSeconds !== "number" ||
    !Number.isFinite(durationSeconds)
  ) {
    return null;
  }
  if (durationSeconds < 60) {
    const rounded = Number.isInteger(durationSeconds)
      ? durationSeconds
      : Number(durationSeconds.toFixed(1));
    return `${rounded}s`;
  }
  const totalSeconds = Math.round(durationSeconds);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}m ${seconds}s`;
}

function greatestCommonDivisor(a: number, b: number): number {
  let nextA = Math.abs(Math.round(a));
  let nextB = Math.abs(Math.round(b));
  while (nextB) {
    const remainder = nextA % nextB;
    nextA = nextB;
    nextB = remainder;
  }
  return nextA || 1;
}

function aspectRatioLabel(item: MediaImagePickerItem) {
  if (!item.width || !item.height) return null;
  const divisor = greatestCommonDivisor(item.width, item.height);
  return `${Math.round(item.width / divisor)}:${Math.round(
    item.height / divisor,
  )}`;
}

function sourceLabel(item: MediaImagePickerItem) {
  if (item.sourceLabel) return item.sourceLabel;
  return item.source?.startsWith("reference-") ? "Imported" : "Generated";
}

export function MediaImagePickerTile({
  item,
  index,
  purpose,
  imageFit,
  selecting,
  onSelect,
  onPreview,
  onDrag,
}: MediaImagePickerTileProps) {
  const fit = resolvedFit(purpose, imageFit);
  const mediaType = mediaTypeLabel(item);
  const dimensions = dimensionsLabel(item);
  const duration = durationLabel(item.durationSeconds);
  const aspectRatio = aspectRatioLabel(item);
  const isVideo = mediaType === "video";
  const isAudio = mediaType === "audio";
  const showFilename =
    (purpose === "reference" || isAudio) && Boolean(item.filename);
  const showMetadata = showFilename || dimensions;
  const mediaDetails: Array<[string, string]> = [];
  if (isVideo) {
    if (duration) mediaDetails.push(["Duration", duration]);
    if (dimensions) mediaDetails.push(["Resolution", dimensions]);
    if (aspectRatio) mediaDetails.push(["Aspect", aspectRatio]);
    mediaDetails.push(["Source", sourceLabel(item)]);
    if (item.projectLabel) mediaDetails.push(["Project", item.projectLabel]);
    if (item.trimReady) mediaDetails.push(["Trim", "Ready for Trim Video"]);
  }
  if (isAudio) {
    if (duration) mediaDetails.push(["Duration", duration]);
    if (item.formatLabel) mediaDetails.push(["Format", item.formatLabel]);
    mediaDetails.push(["Source", sourceLabel(item)]);
    if (item.projectLabel) mediaDetails.push(["Project", item.projectLabel]);
  }
  const frameClassName =
    purpose === "reference" ? "aspect-square" : "aspect-video";
  const imageClassName = fit === "contain" ? "object-contain" : "object-cover";
  const EmptyPreviewIcon =
    mediaType === "video" ? Video : mediaType === "audio" ? Music : ImageIcon;

  function handleKeyboardSelect(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onSelect(item.id);
  }

  return (
    <div className="media-image-picker-tile-shell">
      <button
        type="button"
        className="media-image-picker-tile group block w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-strong)] disabled:cursor-wait disabled:opacity-70"
        data-media-image-id={item.id}
        data-media-image-source={item.source ?? purpose}
        onClick={() => onSelect(item.id)}
        onKeyDown={handleKeyboardSelect}
        draggable={Boolean(onDrag)}
        onDragStart={onDrag ? (event) => onDrag(item, event) : undefined}
        disabled={selecting}
        aria-label={item.ariaLabel}
      >
        <div className={`media-image-picker-tile-frame ${frameClassName}`}>
          {item.previewUrl ? (
            <img
              src={item.previewUrl}
              alt={item.alt ?? ""}
              className={`h-full w-full ${imageClassName} transition duration-300 group-hover:scale-[1.01]`}
              loading={index < 6 ? "eager" : "lazy"}
              decoding="async"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-sm text-[var(--muted-strong)]">
              <EmptyPreviewIcon className="size-5" aria-hidden="true" />
              <span className="sr-only">No preview</span>
            </div>
          )}
          <div className="media-image-picker-tile-action">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--foreground)]">
              {selecting ? "Applying..." : `Use ${mediaType}`}
            </span>
          </div>
        </div>
      </button>
      <button
        type="button"
        className="media-image-picker-preview-button"
        aria-label={`Preview ${mediaType} ${item.id}`}
        onClick={() => onPreview(item.id)}
      >
        <Eye className="size-4" aria-hidden="true" />
      </button>
      {showMetadata ? (
        <div className="media-image-picker-tile-meta">
          {showFilename ? (
            <div className="media-image-picker-tile-filename">
              {item.filename}
            </div>
          ) : (
            <div />
          )}
          {dimensions ? (
            <div className="media-image-picker-tile-dimensions">
              {dimensions}
            </div>
          ) : null}
        </div>
      ) : null}
      {mediaDetails.length ? (
        <dl className="media-image-picker-tile-detail-list">
          {mediaDetails.map(([label, value]) => (
            <div key={label} className="media-image-picker-tile-detail">
              <dt className="media-image-picker-tile-detail-label">{label}</dt>
              <dd className="media-image-picker-tile-detail-value">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
