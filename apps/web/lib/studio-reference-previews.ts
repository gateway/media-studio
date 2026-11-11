import type { AttachmentRecord } from "@/lib/media-studio-contract";
import {
  mediaDisplayUrl,
  mediaInlineUrl,
  mediaPlaybackUrl,
  mediaThumbnailUrl,
} from "@/lib/studio-media-urls";
import type { MediaAsset } from "@/lib/types";
import type {
  OrderedImageInput,
  StudioReferencePreview,
} from "@/lib/media-studio-helpers";
import { videoMetadataLabels } from "@/lib/video-metadata";

function compactVideoMetadataLabel(input: {
  durationSeconds?: number | null;
  width?: number | null;
  height?: number | null;
}) {
  const labels = videoMetadataLabels({
    durationSeconds: input.durationSeconds ?? null,
    width: input.width ?? null,
    height: input.height ?? null,
  });
  return (
    [labels.durationLabel, labels.resolutionLabel]
      .filter(Boolean)
      .join(" · ") || null
  );
}

export function buildAttachmentPreview(
  attachment: AttachmentRecord | null | undefined,
  label: string,
  previewKey = label.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
): StudioReferencePreview | null {
  if (!attachment) return null;
  const { kind, previewUrl, referenceRecord } = attachment;
  const {
    stored_url: storedUrl,
    poster_url: posterUrl,
    thumb_url: thumbUrl,
    duration_seconds: durationSeconds,
    width,
    height,
  } = referenceRecord ?? {};
  const isVideo = kind === "videos";
  const url = isVideo ? (storedUrl ?? previewUrl) : (previewUrl ?? storedUrl);
  if (!url) {
    return null;
  }
  return {
    key: `attachment:${attachment.id ?? previewKey}`,
    label,
    url,
    kind,
    posterUrl: isVideo ? (posterUrl ?? thumbUrl ?? null) : undefined,
    metadataLabel: isVideo
      ? compactVideoMetadataLabel({
          durationSeconds: attachment.durationSeconds ?? durationSeconds,
          width: attachment.width ?? width,
          height: attachment.height ?? height,
        })
      : null,
  };
}

function seedanceReferenceLabel(attachment: AttachmentRecord) {
  return (
    attachment.file?.name ??
    attachment.referenceRecord?.original_filename ??
    "Reference"
  );
}

export function seedanceReferencePreview(
  attachment: AttachmentRecord,
  groupKey: string,
  buildPreview: typeof buildAttachmentPreview,
): StudioReferencePreview {
  const label = seedanceReferenceLabel(attachment);
  return (
    buildPreview(attachment, label, `${groupKey}-${attachment.id}`) ?? {
      key: `attachment:${attachment.id}`,
      label,
      url:
        attachment.previewUrl ?? attachment.referenceRecord?.stored_url ?? "",
      kind: attachment.kind,
      posterUrl: attachment.referenceRecord?.poster_url ?? null,
    }
  );
}

export function seedanceReferenceVisual(attachment: AttachmentRecord) {
  if (attachment.kind === "audios") return null;
  return (
    attachment.previewUrl ??
    attachment.referenceRecord?.thumb_url ??
    attachment.referenceRecord?.stored_url ??
    null
  );
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
  const posterUrl =
    kind === "videos"
      ? (mediaThumbnailUrl(asset) ?? mediaDisplayUrl(asset) ?? null)
      : null;
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
  return buildAttachmentPreview(
    slot.attachment as AttachmentRecord,
    label,
    key,
  );
}
