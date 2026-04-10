import "server-only";

import { createHash } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { getReferenceMedia, registerReferenceMedia } from "@/lib/control-api";
import type { MediaReference } from "@/lib/types";

const controlApiDataRoot =
  process.env.MEDIA_STUDIO_DATA_ROOT ||
  path.join(/* turbopackIgnore: true */ process.cwd(), "data");
const REFERENCE_MEDIA_ROOT = path.join(controlApiDataRoot, "reference-media");
const REFERENCE_IMAGES_ROOT = path.join(REFERENCE_MEDIA_ROOT, "images");
const REFERENCE_VIDEOS_ROOT = path.join(REFERENCE_MEDIA_ROOT, "videos");
const REFERENCE_AUDIOS_ROOT = path.join(REFERENCE_MEDIA_ROOT, "audios");
const REFERENCE_THUMBS_ROOT = path.join(REFERENCE_MEDIA_ROOT, "thumbs");

function referenceKindFromMimeType(mimeType: string | null | undefined) {
  const normalized = String(mimeType ?? "").toLowerCase();
  if (normalized.startsWith("video/")) return "video" as const;
  if (normalized.startsWith("audio/")) return "audio" as const;
  return "image" as const;
}

function extensionFromSource(kind: "image" | "video" | "audio", sourceName: string | null | undefined, mimeType?: string | null) {
  const explicit = path.extname(sourceName ?? "").toLowerCase();
  if (explicit) {
    return explicit;
  }
  const normalizedMime = String(mimeType ?? "").toLowerCase();
  if (kind === "video" && normalizedMime.includes("mp4")) return ".mp4";
  if (kind === "audio" && normalizedMime.includes("wav")) return ".wav";
  if (kind === "audio" && normalizedMime.includes("mpeg")) return ".mp3";
  if (normalizedMime.includes("jpeg")) return ".jpg";
  if (normalizedMime.includes("png")) return ".png";
  if (normalizedMime.includes("webp")) return ".webp";
  return kind === "video" ? ".mp4" : kind === "audio" ? ".wav" : ".png";
}

function relativeDataPath(absolutePath: string) {
  return path.relative(controlApiDataRoot, absolutePath).replaceAll("\\", "/");
}

function referenceRootForKind(kind: "image" | "video" | "audio") {
  if (kind === "video") return REFERENCE_VIDEOS_ROOT;
  if (kind === "audio") return REFERENCE_AUDIOS_ROOT;
  return REFERENCE_IMAGES_ROOT;
}

export async function storeReferenceMediaBuffer({
  sourceBuffer,
  sourceName,
  sourceMimeType,
}: {
  sourceBuffer: Buffer;
  sourceName?: string | null;
  sourceMimeType?: string | null;
}) {
  const sha256 = createHash("sha256").update(sourceBuffer).digest("hex");
  const kind = referenceKindFromMimeType(sourceMimeType);
  const extension = extensionFromSource(kind, sourceName, sourceMimeType);
  const root = referenceRootForKind(kind);
  const originalAbsolutePath = path.join(root, `${sha256}${extension}`);

  await mkdir(root, { recursive: true });
  if (!(await stat(originalAbsolutePath).then(() => true).catch(() => false))) {
    await writeFile(originalAbsolutePath, sourceBuffer);
  }

  let width: number | null = null;
  let height: number | null = null;
  let thumbPath: string | null = null;

  if (kind === "image") {
    await mkdir(REFERENCE_THUMBS_ROOT, { recursive: true });
    const thumbAbsolutePath = path.join(REFERENCE_THUMBS_ROOT, `${sha256}.webp`);
    const image = sharp(sourceBuffer, { failOn: "none" }).rotate();
    const metadata = await image.metadata().catch(() => null);
    width = typeof metadata?.width === "number" ? metadata.width : null;
    height = typeof metadata?.height === "number" ? metadata.height : null;
    if (!(await stat(thumbAbsolutePath).then(() => true).catch(() => false))) {
      const thumbBuffer = await image
        .resize(512, 512, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 82, effort: 4 })
        .toBuffer();
      await writeFile(thumbAbsolutePath, thumbBuffer);
    }
    thumbPath = relativeDataPath(thumbAbsolutePath);
  }

  return {
    kind,
    original_filename: sourceName ?? null,
    stored_path: relativeDataPath(originalAbsolutePath),
    mime_type: sourceMimeType ?? null,
    file_size_bytes: sourceBuffer.byteLength,
    sha256,
    width,
    height,
    duration_seconds: null,
    thumb_path: thumbPath,
    poster_path: null,
    usage_count: 1,
    metadata_json: {},
  };
}

export async function registerReferenceMediaBuffer({
  sourceBuffer,
  sourceName,
  sourceMimeType,
}: {
  sourceBuffer: Buffer;
  sourceName?: string | null;
  sourceMimeType?: string | null;
}) {
  const stored = await storeReferenceMediaBuffer({ sourceBuffer, sourceName, sourceMimeType });
  const result = await registerReferenceMedia(stored);
  if (!result.ok || !result.data?.item) {
    throw new Error(result.error ?? "Unable to register reference media.");
  }
  return result.data.item;
}

export async function registerReferenceMediaFile(file: File) {
  const sourceBuffer = Buffer.from(await file.arrayBuffer());
  return registerReferenceMediaBuffer({
    sourceBuffer,
    sourceName: file.name,
    sourceMimeType: file.type || null,
  });
}

export async function resolveReferenceMedia(referenceId: string): Promise<MediaReference | null> {
  const result = await getReferenceMedia(referenceId);
  return result.data?.item ?? null;
}
