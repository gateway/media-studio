import type { MediaAsset, MediaReference } from "@/lib/types";
import { isRecord } from "@/lib/utils";

import { toControlApiDataPreviewPath, toControlApiProxyPath } from "./media-paths";

export function mediaVariantUrl(
  asset: MediaAsset | null | undefined,
  variant: "original" | "web" | "thumb" | "poster",
) {
  if (!asset) {
    return null;
  }

  if (variant === "original") {
    return toControlApiProxyPath(asset.hero_original_url) ?? toControlApiDataPreviewPath(asset.hero_original_path);
  }
  if (variant === "web") {
    return toControlApiProxyPath(asset.hero_web_url) ?? toControlApiDataPreviewPath(asset.hero_web_path);
  }
  if (variant === "thumb") {
    return toControlApiProxyPath(asset.hero_thumb_url) ?? toControlApiDataPreviewPath(asset.hero_thumb_path);
  }
  return toControlApiProxyPath(asset.hero_poster_url) ?? toControlApiDataPreviewPath(asset.hero_poster_path);
}

export function mediaThumbnailUrl(asset?: MediaAsset | null) {
  if (asset?.generation_kind === "video") {
    return mediaVariantUrl(asset, "poster") ?? mediaVariantUrl(asset, "thumb");
  }
  return mediaVariantUrl(asset, "thumb") ?? mediaVariantUrl(asset, "web") ?? mediaVariantUrl(asset, "poster");
}

export function mediaDisplayUrl(asset?: MediaAsset | null) {
  if (asset?.generation_kind === "video") {
    return mediaThumbnailUrl(asset);
  }
  return mediaVariantUrl(asset, "web") ?? mediaVariantUrl(asset, "thumb") ?? mediaVariantUrl(asset, "poster");
}

export function referencePreviewUrl(reference: MediaReference | null | undefined) {
  if (!reference) {
    return null;
  }
  if (reference.kind === "video") {
    return reference.poster_url ?? reference.thumb_url ?? reference.stored_url ?? toControlApiDataPreviewPath(reference.poster_path ?? reference.thumb_path ?? reference.stored_path);
  }
  if (reference.kind === "audio") {
    return null;
  }
  return reference.thumb_url ?? reference.stored_url ?? toControlApiDataPreviewPath(reference.thumb_path ?? reference.stored_path);
}

export function referencePlaybackUrl(reference: MediaReference | null | undefined) {
  if (!reference) {
    return null;
  }
  return reference.stored_url ?? toControlApiDataPreviewPath(reference.stored_path);
}

export function mediaPlaybackUrl(asset?: MediaAsset | null) {
  if (asset?.generation_kind === "video") {
    return mediaVariantUrl(asset, "web") ?? asset.remote_output_url ?? mediaVariantUrl(asset, "original");
  }
  if (asset?.generation_kind === "audio") {
    return toControlApiProxyPath(asset.hero_original_url) ?? toControlApiDataPreviewPath(asset.hero_original_path) ?? asset.remote_output_url ?? null;
  }
  return null;
}

export function mediaPreviewUrl(asset?: MediaAsset | null) {
  return mediaDisplayUrl(asset);
}

export function prefetchAssetThumbs(assets: MediaAsset[], seenThumbUrls: Set<string>) {
  if (typeof window === "undefined") {
    return;
  }
  for (const asset of assets) {
    const thumbUrl = mediaThumbnailUrl(asset);
    if (!thumbUrl || seenThumbUrls.has(thumbUrl)) {
      continue;
    }
    seenThumbUrls.add(thumbUrl);
    const image = new Image();
    image.decoding = "async";
    image.loading = "eager";
    image.src = thumbUrl;
  }
}

export function mediaDownloadName(asset?: MediaAsset | null) {
  const payload = isRecord(asset?.payload) ? asset.payload : null;
  const firstOutput = Array.isArray(payload?.outputs) && payload.outputs.length > 0 && isRecord(payload.outputs[0]) ? payload.outputs[0] : null;
  const outputOriginalFilename = typeof firstOutput?.original_filename === "string" ? firstOutput.original_filename : null;
  const extensionSource =
    outputOriginalFilename ??
    asset?.hero_original_path ??
    asset?.hero_web_path ??
    asset?.hero_original_url ??
    asset?.hero_web_url ??
    asset?.hero_poster_url ??
    asset?.hero_thumb_url ??
    null;
  const normalizedExtensionSource = extensionSource?.split("?")[0]?.split("#")[0] ?? extensionSource ?? "";
  const extensionMatch = normalizedExtensionSource.match(/(\.[a-z0-9]+)$/i);
  const extension = extensionMatch?.[1]?.toLowerCase() ?? "";
  const options = isRecord(payload?.options) ? payload.options : null;
  const cleanPart = (value: unknown) =>
    typeof value === "string" && value.trim()
      ? value
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
      : "";
  const preferredParts = [
    asset?.job_id ? `ms-${cleanPart(asset.job_id).replace(/^job-/, "")}` : "",
    cleanPart(asset?.model_key),
    cleanPart(options?.resolution),
    cleanPart(options?.aspect_ratio),
  ].filter(Boolean);

  if (preferredParts.length) {
    return `${preferredParts.join("_")}${extension}`;
  }

  const candidate =
    asset?.hero_original_path ??
    asset?.hero_web_path ??
    asset?.hero_original_url ??
    asset?.hero_web_url ??
    asset?.hero_poster_url ??
    asset?.hero_thumb_url;

  if (!candidate) {
    return asset?.asset_id ? `media-asset-${asset.asset_id}` : "media-asset";
  }

  const normalized = candidate.split("?")[0]?.split("#")[0] ?? candidate;
  const segments = normalized.split("/").filter(Boolean);
  return segments.at(-1) ?? (asset?.asset_id ? `media-asset-${asset.asset_id}` : "media-asset");
}

export function mediaDownloadUrl(asset?: MediaAsset | null) {
  const originalUrl =
    toControlApiProxyPath(asset?.hero_original_url) ??
    toControlApiDataPreviewPath(asset?.hero_original_path) ??
    mediaPreviewUrl(asset);

  if (!originalUrl) {
    return null;
  }

  const downloadUrl = new URL(originalUrl, "http://dashboard.local");
  downloadUrl.searchParams.set("download", "1");
  downloadUrl.searchParams.set("filename", mediaDownloadName(asset));
  return `${downloadUrl.pathname}${downloadUrl.search}`;
}

export function mediaInlineUrl(asset?: MediaAsset | null) {
  const originalUrl =
    toControlApiProxyPath(asset?.hero_original_url) ??
    toControlApiDataPreviewPath(asset?.hero_original_path) ??
    mediaPreviewUrl(asset);

  if (!originalUrl) {
    return null;
  }

  const inlineUrl = new URL(originalUrl, "http://dashboard.local");
  inlineUrl.searchParams.set("inline", "1");
  return `${inlineUrl.pathname}${inlineUrl.search}`;
}
