import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

const PROMPT_RECIPE_THUMBNAILS_DIR = path.resolve(process.cwd(), "..", "..", "data", "prompt-recipe-thumbnails");

export function safePromptRecipeThumbnailSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export async function storePromptRecipeThumbnailBuffer({
  sourceBuffer,
  recipeLabel,
}: {
  sourceBuffer: Buffer;
  recipeLabel: string;
  sourceName?: string | null;
}) {
  await mkdir(PROMPT_RECIPE_THUMBNAILS_DIR, { recursive: true });

  const baseName = safePromptRecipeThumbnailSlug(recipeLabel) || "prompt-recipe-thumbnail";
  const fileName = `${baseName}-${Date.now()}.webp`;
  const outputPath = path.join(PROMPT_RECIPE_THUMBNAILS_DIR, fileName);

  const optimizedBuffer = await sharp(sourceBuffer)
    .rotate()
    .resize(512, 512, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 80, effort: 4 })
    .toBuffer();

  await writeFile(outputPath, optimizedBuffer);

  return {
    fileName,
    outputPath,
    thumbnail_path: `prompt-recipe-thumbnails/${fileName}`,
    thumbnail_url: `/api/prompt-recipe-thumbnails/${fileName}`,
  };
}

export function resolvePromptRecipeThumbnailCandidatePaths(thumbnailPath: string | null | undefined) {
  const normalized = String(thumbnailPath ?? "").trim().replace(/^\/+/, "");
  if (!normalized) {
    return [];
  }
  const safePath = path.normalize(normalized).replace(/^(\.\.(\/|\\|$))+/, "").replace(/^prompt-recipe-thumbnails[\\/]/, "");
  if (!safePath || safePath.startsWith("..")) {
    return [];
  }
  return [path.join(PROMPT_RECIPE_THUMBNAILS_DIR, safePath)];
}

export async function readPromptRecipeThumbnailBuffer(thumbnailPath: string | null | undefined) {
  for (const absolutePath of resolvePromptRecipeThumbnailCandidatePaths(thumbnailPath)) {
    try {
      return await readFile(absolutePath);
    } catch {
      continue;
    }
  }
  return null;
}
