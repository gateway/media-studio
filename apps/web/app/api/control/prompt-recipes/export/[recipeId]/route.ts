import path from "node:path";

import JSZip from "jszip";
import { NextResponse } from "next/server";

import { getControlApiJson, mapPromptRecipeRecord } from "@/lib/control-api";
import {
  createPortablePromptRecipeBundleManifest,
  normalizePortablePromptRecipePayload,
} from "@/lib/prompt-recipe-sharing";
import { readPromptRecipeThumbnailBuffer } from "@/lib/prompt-recipe-thumbnail-storage";
import { slugifyPromptRecipeKey } from "@/lib/prompt-recipes";

export async function GET(
  _request: Request,
  context: { params: Promise<{ recipeId: string }> },
) {
  const { recipeId } = await context.params;
  const result = await getControlApiJson<Array<Record<string, unknown>>>("/prompt-recipes?status=all", "admin");

  if (!result.ok || !result.data) {
    return NextResponse.json({ ok: false, error: result.error ?? "Unable to load the prompt recipes." }, { status: 502 });
  }

  const recipes = result.data.map((recipe) => mapPromptRecipeRecord(recipe));
  const recipe = recipes.find((entry) => entry.recipe_id === recipeId) ?? null;
  if (!recipe) {
    return NextResponse.json({ ok: false, error: "Prompt recipe not found." }, { status: 404 });
  }

  const zip = new JSZip();
  let thumbnailFileName: string | null = null;
  try {
    const thumbnailBuffer = await readPromptRecipeThumbnailBuffer(recipe.thumbnail_path);
    if (thumbnailBuffer) {
      thumbnailFileName = `assets/${path.basename(String(recipe.thumbnail_path ?? "").trim()) || "thumbnail.webp"}`;
      zip.file(thumbnailFileName, thumbnailBuffer);
    }
  } catch {
    thumbnailFileName = null;
  }

  const manifest = createPortablePromptRecipeBundleManifest({
    ...normalizePortablePromptRecipePayload(recipe),
    thumbnail: thumbnailFileName ? { file_name: thumbnailFileName } : null,
  });

  zip.file("manifest.json", JSON.stringify(manifest, null, 2));

  const bundleBuffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });

  const fileName = `${slugifyPromptRecipeKey(recipe.key || recipe.label || "prompt_recipe") || "prompt_recipe"}.zip`;
  return new NextResponse(new Uint8Array(bundleBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
