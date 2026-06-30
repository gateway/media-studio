"use client";

export type MediaImagePickerPurpose = "reference" | "thumbnail" | "cover";

export type MediaImagePickerFit = "contain" | "cover";

export type MediaPickerMediaType = "image" | "video" | "audio";

export type MediaImagePickerItem = {
  id: string;
  source?:
    | "generated-image"
    | "reference-image"
    | "generated-video"
    | "reference-video"
    | "generated-audio"
    | "reference-audio";
  mediaType?: MediaPickerMediaType;
  previewUrl: string | null;
  fullUrl?: string | null;
  ariaLabel: string;
  alt?: string;
  filename?: string | null;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
  formatLabel?: string | null;
  sourceLabel?: string | null;
  projectLabel?: string | null;
  trimReady?: boolean | null;
  createdAt?: string | null;
};

export type MediaImagePickerPage<T> = {
  items: T[];
  nextOffset: number | null;
};
