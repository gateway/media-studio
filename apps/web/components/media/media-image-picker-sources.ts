import { generatedThumbnailPreviewUrl } from "@/components/media/generated-thumbnail-utils";
import type { MediaAssetPickerItem, MediaReference } from "@/lib/types";
import type { MediaImagePickerItem, MediaImagePickerPage, MediaPickerMediaType } from "./media-image-picker-types";

function generatedMediaPreviewUrl(
  asset: MediaAssetPickerItem,
  mediaType: MediaPickerMediaType,
) {
  if (mediaType === "image") return generatedThumbnailPreviewUrl(asset);
  if (mediaType === "video") {
    return (
      asset.hero_poster_url ??
      asset.hero_thumb_url ??
      asset.hero_web_url ??
      asset.hero_original_url ??
      null
    );
  }
  return asset.hero_poster_url ?? asset.hero_thumb_url ?? null;
}

function generatedMediaFullUrl(asset: MediaAssetPickerItem) {
  return asset.hero_original_url ?? asset.hero_web_url ?? null;
}

function referenceMediaPreviewUrl(
  reference: MediaReference,
  mediaType: MediaPickerMediaType,
) {
  if (mediaType === "image") return reference.thumb_url ?? reference.stored_url ?? null;
  return reference.poster_url ?? reference.thumb_url ?? null;
}

function referenceMediaFullUrl(reference: MediaReference) {
  return reference.stored_url ?? null;
}

function mediaTypeMatches(
  actual: string | null | undefined,
  expected: MediaPickerMediaType,
) {
  return String(actual ?? expected).toLowerCase() === expected;
}

function nonNegativeNumber(value: unknown) {
  const next = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(next) || next < 0) return null;
  return next;
}

function basenameFromPath(value: string | null | undefined) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  const withoutQuery = trimmed.split(/[?#]/, 1)[0] ?? trimmed;
  const normalized = withoutQuery.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).pop() ?? normalized;
}

function extensionFromPath(value: string | null | undefined) {
  const filename = basenameFromPath(value);
  if (!filename || !filename.includes(".")) return null;
  const extension = filename.split(".").pop()?.trim().toLowerCase();
  return extension || null;
}

function normalizedFormatLabel(value: string | null | undefined) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  const subtype = raw.includes("/") ? raw.split("/").pop() ?? raw : raw;
  const compact = subtype.split(";")[0]?.replace(/^x-/, "").trim() ?? "";
  if (!compact) return null;
  if (compact === "mpeg" || compact === "mpga") return "MP3";
  if (compact === "wave") return "WAV";
  if (compact === "mp4") return "M4A";
  return compact.toUpperCase();
}

function audioFormatLabel(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const label = normalizedFormatLabel(value);
    if (label) return label;
  }
  return null;
}

function audioMetadataString(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
) {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function generatedMediaFilename(
  asset: MediaAssetPickerItem,
  mediaType: MediaPickerMediaType,
) {
  const path =
    asset.hero_original_path ??
    asset.hero_web_path ??
    asset.hero_poster_path ??
    asset.hero_thumb_path ??
    null;
  if (mediaType === "audio") return basenameFromPath(path);
  return path;
}

function generatedProjectLabel(projectId: string | null | undefined) {
  const value = String(projectId ?? "").trim();
  return value || null;
}

function referenceProjectLabel(projectIds: string[] | null | undefined) {
  if (!Array.isArray(projectIds) || !projectIds.length) return null;
  if (projectIds.length === 1) return projectIds[0] ?? null;
  return `${projectIds.length} projects`;
}

function generatedMediaPickerItemSource(mediaType: MediaPickerMediaType) {
  return `generated-${mediaType}` as MediaImagePickerItem["source"];
}

function referenceMediaPickerItemSource(mediaType: MediaPickerMediaType) {
  return `reference-${mediaType}` as MediaImagePickerItem["source"];
}

export function generatedMediaPickerItem(
  asset: MediaAssetPickerItem | null | undefined,
  mediaType: MediaPickerMediaType,
): MediaImagePickerItem | null {
  if (!asset) return null;
  const id = String(asset.asset_id);
  const previewUrl = generatedMediaPreviewUrl(asset, mediaType);
  const fullUrl = generatedMediaFullUrl(asset);
  const durationSeconds = nonNegativeNumber(asset.duration_seconds);
  const filename = generatedMediaFilename(asset, mediaType);
  if (mediaType === "image" && !previewUrl) return null;
  return {
    id,
    source: generatedMediaPickerItemSource(mediaType),
    mediaType,
    previewUrl,
    fullUrl: fullUrl ?? previewUrl,
    ariaLabel: `Use generated ${mediaType} ${id}`,
    alt: asset.prompt_summary ?? `Generated ${mediaType} ${id}`,
    filename,
    width: asset.width ?? null,
    height: asset.height ?? null,
    durationSeconds,
    formatLabel:
      mediaType === "audio"
        ? audioFormatLabel(
            extensionFromPath(asset.hero_original_path),
            extensionFromPath(asset.hero_original_url),
            extensionFromPath(asset.hero_web_path),
            extensionFromPath(asset.hero_web_url),
            extensionFromPath(asset.hero_poster_path),
            extensionFromPath(asset.hero_poster_url),
            extensionFromPath(asset.hero_thumb_path),
            extensionFromPath(asset.hero_thumb_url),
          )
        : null,
    sourceLabel: "Generated",
    projectLabel: generatedProjectLabel(asset.project_id),
    trimReady: mediaType === "video" && durationSeconds != null && durationSeconds > 0,
    createdAt: asset.created_at ?? null,
  };
}

export function generatedImagePickerItem(asset: MediaAssetPickerItem | null | undefined): MediaImagePickerItem | null {
  return generatedMediaPickerItem(asset, "image");
}

export function referenceMediaPickerItem(
  reference: MediaReference | null | undefined,
  mediaType: MediaPickerMediaType,
): MediaImagePickerItem | null {
  if (!reference) return null;
  const previewUrl = referenceMediaPreviewUrl(reference, mediaType);
  const fullUrl = referenceMediaFullUrl(reference);
  const durationSeconds = nonNegativeNumber(reference.duration_seconds);
  const formatName = audioMetadataString(reference.metadata, "format_name");
  if (mediaType === "image" && !previewUrl) return null;
  return {
    id: reference.reference_id,
    source: referenceMediaPickerItemSource(mediaType),
    mediaType,
    previewUrl,
    fullUrl: fullUrl ?? previewUrl,
    ariaLabel: `Use ${reference.original_filename || `reference ${mediaType}`}`,
    alt: reference.original_filename || `Reference ${mediaType}`,
    filename: reference.original_filename ?? null,
    width: reference.width ?? null,
    height: reference.height ?? null,
    durationSeconds,
    formatLabel:
      mediaType === "audio"
        ? audioFormatLabel(
            formatName,
            reference.mime_type,
            extensionFromPath(reference.original_filename),
            extensionFromPath(reference.stored_path),
          )
        : null,
    sourceLabel: "Imported",
    projectLabel: referenceProjectLabel(reference.attached_project_ids),
    trimReady: mediaType === "video" && durationSeconds != null && durationSeconds > 0,
    createdAt: reference.created_at ?? null,
  };
}

export function referenceImagePickerItem(reference: MediaReference | null | undefined): MediaImagePickerItem | null {
  return referenceMediaPickerItem(reference, "image");
}

function mediaPickerPageUrl(pathname: string, params: Record<string, string | number | null | undefined>) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value == null) return;
    const normalized = String(value).trim();
    if (!normalized) return;
    query.set(key, normalized);
  });
  return `${pathname}?${query.toString()}`;
}

export function generatedMediaPickerPageUrl(
  mediaType: MediaPickerMediaType,
  offset: number,
  query?: string | null,
  limit = 24,
  projectId?: string | null,
) {
  return mediaPickerPageUrl("/api/control/media-assets", {
    limit,
    offset,
    generation_kind: mediaType,
    view: "picker",
    q: query,
    project_id: projectId,
  });
}

export function generatedImagePickerPageUrl(
  offset: number,
  query?: string | null,
  limit = 24,
  projectId?: string | null,
) {
  return generatedMediaPickerPageUrl("image", offset, query, limit, projectId);
}

export function referenceMediaPickerPageUrl(
  mediaType: MediaPickerMediaType,
  offset: number,
  query?: string | null,
  limit = 24,
  projectId?: string | null,
) {
  return mediaPickerPageUrl("/api/control/reference-media", {
    limit,
    offset,
    kind: mediaType,
    q: query,
    project_id: projectId,
  });
}

export function referenceImagePickerPageUrl(
  offset: number,
  query?: string | null,
  limit = 24,
  projectId?: string | null,
) {
  return referenceMediaPickerPageUrl("image", offset, query, limit, projectId);
}

export async function fetchGeneratedMediaPickerPage(
  mediaType: MediaPickerMediaType,
  offset: number,
  query?: string | null,
  projectId?: string | null,
  limit = 24,
): Promise<MediaImagePickerPage<MediaAssetPickerItem>> {
  const response = await fetch(
    generatedMediaPickerPageUrl(mediaType, offset, query, limit, projectId),
  );
  const result = (await response.json()) as {
    ok?: boolean;
    error?: string;
    assets?: MediaAssetPickerItem[];
    next_offset?: number | null;
  };
  if (!response.ok || result.ok === false || !Array.isArray(result.assets)) {
    throw new Error(result.error ?? "Unable to load generated images.");
  }
  return {
    items: result.assets.filter(
      (asset) =>
        mediaTypeMatches(asset.generation_kind, mediaType) &&
        (mediaType === "image"
          ? Boolean(generatedThumbnailPreviewUrl(asset))
          : Boolean(generatedMediaFullUrl(asset) ?? generatedMediaPreviewUrl(asset, mediaType))),
    ),
    nextOffset: typeof result.next_offset === "number" ? result.next_offset : null,
  };
}

export async function fetchGeneratedImagePickerPage(
  offset: number,
  query?: string | null,
  projectId?: string | null,
  limit = 24,
): Promise<MediaImagePickerPage<MediaAssetPickerItem>> {
  return fetchGeneratedMediaPickerPage("image", offset, query, projectId, limit);
}

export async function fetchReferenceMediaPickerPage(
  mediaType: MediaPickerMediaType,
  offset: number,
  query?: string | null,
  projectId?: string | null,
  limit = 24,
): Promise<MediaImagePickerPage<MediaReference>> {
  const response = await fetch(
    referenceMediaPickerPageUrl(mediaType, offset, query, limit, projectId),
  );
  const result = (await response.json()) as {
    ok?: boolean;
    error?: string;
    items?: MediaReference[];
    next_offset?: number | null;
  };
  if (!response.ok || result.ok === false || !Array.isArray(result.items)) {
    throw new Error(result.error ?? "Unable to load reference images.");
  }
  return {
    items: result.items.filter(
      (reference) =>
        reference.kind === mediaType &&
        (mediaType === "image"
          ? Boolean(reference.thumb_url ?? reference.stored_url)
          : Boolean(referenceMediaFullUrl(reference) ?? referenceMediaPreviewUrl(reference, mediaType))),
    ),
    nextOffset: typeof result.next_offset === "number" ? result.next_offset : null,
  };
}

export async function fetchReferenceImagePickerPage(
  offset: number,
  query?: string | null,
  projectId?: string | null,
  limit = 24,
): Promise<MediaImagePickerPage<MediaReference>> {
  return fetchReferenceMediaPickerPage("image", offset, query, projectId, limit);
}
