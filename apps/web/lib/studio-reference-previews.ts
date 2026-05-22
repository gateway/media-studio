import type { AttachmentRecord } from "@/lib/media-studio-contract";
import {
  mediaDisplayUrl,
  mediaInlineUrl,
  mediaPlaybackUrl,
  mediaThumbnailUrl,
} from "@/lib/studio-media-urls";
import type { MediaAsset } from "@/lib/types";
import type { OrderedImageInput, StudioReferencePreview } from "@/lib/media-studio-helpers";

export function buildAttachmentPreview(
  attachment: AttachmentRecord | null | undefined,
  label: string,
  previewKey = label.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
): StudioReferencePreview | null {
  const url = attachment?.previewUrl ?? attachment?.referenceRecord?.stored_url ?? null;
  if (!url) {
    return null;
  }
  return {
    key: `attachment:${attachment?.id ?? previewKey}`,
    label,
    url,
    kind: attachment?.kind ?? "images",
    posterUrl: attachment?.kind === "videos" ? attachment?.referenceRecord?.poster_url ?? null : undefined,
  };
}

export function buildAssetReferencePreview(
  asset: MediaAsset | null | undefined,
  label: string,
): StudioReferencePreview | null {
  if (!asset) {
    return null;
  }
  const kind =
    asset.generation_kind === "video"
      ? ("videos" as const)
      : asset.generation_kind === "audio"
        ? ("audios" as const)
        : ("images" as const);
  const posterUrl = kind === "videos" ? mediaThumbnailUrl(asset) ?? mediaDisplayUrl(asset) ?? null : null;
  const url =
    (kind === "videos" ? mediaPlaybackUrl(asset) : null) ??
    mediaInlineUrl(asset) ??
    mediaDisplayUrl(asset) ??
    mediaThumbnailUrl(asset) ??
    null;
  if (!url) {
    return null;
  }
  return {
    key: `asset:${asset.asset_id}`,
    label,
    url,
    kind,
    posterUrl,
  };
}

export function orderedImageInputPreview(
  slot: OrderedImageInput | null,
  label: string,
  key: string,
): StudioReferencePreview | null {
  if (!slot) {
    return null;
  }
  if (slot.source === "asset") {
    return buildAssetReferencePreview(slot.asset, label);
  }
  if (slot.source === "reference") {
    return {
      key: `reference:${slot.reference.reference_id}:${key}`,
      label,
      url: slot.reference.stored_url ?? slot.previewUrl ?? "",
      kind: "images",
      posterUrl: null,
    };
  }
  return buildAttachmentPreview(slot.attachment as AttachmentRecord, label, key);
}
