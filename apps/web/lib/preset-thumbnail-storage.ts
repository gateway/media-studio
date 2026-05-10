import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

const PRESET_THUMBNAILS_DIR = path.resolve(process.cwd(), "..", "..", "data", "preset-thumbnails");
const SHIPPED_PRESET_THUMBNAILS_DIR = path.resolve(
  process.cwd(),
  "..",
  "..",
  "apps",
  "api",
  "app",
  "seed_assets",
  "preset-thumbnails",
);

export function safePresetThumbnailSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function presetThumbnailExtension(sourceName: string | null | undefined) {
  const extension = path.extname(sourceName ?? "").toLowerCase();
  return extension === ".png" || extension === ".jpg" || extension === ".jpeg" || extension === ".webp" ? extension : ".webp";
}

export async function storePresetThumbnailBuffer({
  sourceBuffer,
  presetLabel,
  sourceName,
}: {
  sourceBuffer: Buffer;
  presetLabel: string;
  sourceName?: string | null;
}) {
  await mkdir(PRESET_THUMBNAILS_DIR, { recursive: true });

  const baseName = safePresetThumbnailSlug(presetLabel || (sourceName ?? "").replace(/\.[^.]+$/, "")) || "preset-thumbnail";
  const extension = presetThumbnailExtension(sourceName);
  const fileName = `${baseName}-${Date.now()}.webp`;
  const outputPath = path.join(PRESET_THUMBNAILS_DIR, fileName);

  const optimizedBuffer = await sharp(sourceBuffer)
    .rotate()
    .resize(512, 512, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 80, effort: 4 })
    .toBuffer();

  await writeFile(outputPath, optimizedBuffer);

  return {
    fileName,
    outputPath,
    thumbnail_path: `preset-thumbnails/${fileName}`,
    thumbnail_url: `/api/preset-thumbnails/${fileName}`,
    sourceExtension: extension,
  };
}

export function resolvePresetThumbnailAbsolutePath(thumbnailPath: string | null | undefined) {
  const candidatePaths = resolvePresetThumbnailCandidatePaths(thumbnailPath);
  return candidatePaths[0] ?? null;
}

export function resolvePresetThumbnailCandidatePaths(thumbnailPath: string | null | undefined) {
  const normalized = String(thumbnailPath ?? "").trim().replace(/^\/+/, "");
  if (!normalized) {
    return [];
  }
  const safePath = path.normalize(normalized).replace(/^(\.\.(\/|\\|$))+/, "").replace(/^preset-thumbnails[\\/]/, "");
  if (!safePath || safePath.startsWith("..")) {
    return [];
  }
  return [path.join(PRESET_THUMBNAILS_DIR, safePath), path.join(SHIPPED_PRESET_THUMBNAILS_DIR, safePath)];
}

export async function readPresetThumbnailBuffer(thumbnailPath: string | null | undefined) {
  for (const absolutePath of resolvePresetThumbnailCandidatePaths(thumbnailPath)) {
    try {
      return await readFile(absolutePath);
    } catch {
      continue;
    }
  }
  return null;
}
