import path from "node:path";

import JSZip from "jszip";
import { NextResponse } from "next/server";

import { getControlApiJson, mapPromptRecipeRecord, postControlApiJson } from "@/lib/control-api";
import {
  parsePortablePromptRecipeBundleManifest,
  resolvePromptRecipeImport,
} from "@/lib/prompt-recipe-sharing";
import { storePromptRecipeThumbnailBuffer } from "@/lib/prompt-recipe-thumbnail-storage";

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "Choose a prompt recipe bundle to import." }, { status: 400 });
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(Buffer.from(await file.arrayBuffer()));
  } catch {
    return NextResponse.json({ ok: false, error: "Prompt recipe imports must be valid ZIP bundles." }, { status: 400 });
  }

  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) {
    return NextResponse.json({ ok: false, error: "Prompt recipe bundle is missing manifest.json." }, { status: 400 });
  }

  let manifest;
  try {
    manifest = parsePortablePromptRecipeBundleManifest(JSON.parse(await manifestFile.async("text")));
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Prompt recipe bundle manifest is invalid." },
      { status: 400 },
    );
  }

  const recipesResult = await getControlApiJson<Array<Record<string, unknown>>>("/prompt-recipes?status=all", "admin");
  if (!recipesResult.ok || !recipesResult.data) {
    return NextResponse.json({ ok: false, error: recipesResult.error ?? "Unable to load the prompt recipes." }, { status: 502 });
  }

  const existingRecipes = recipesResult.data.map((recipe) => mapPromptRecipeRecord(recipe));
  const resolution = resolvePromptRecipeImport(existingRecipes, manifest.recipe);
  if (resolution.status === "skipped" || !resolution.payload) {
    return NextResponse.json({
      ok: true,
      status: resolution.status,
      message: resolution.message,
      recipe: null,
      duplicate_recipe_id: resolution.duplicateRecipeId,
    });
  }

  let thumbnailPath: string | null = null;
  let thumbnailUrl: string | null = null;
  const thumbnailFileName = manifest.recipe.thumbnail?.file_name ?? null;
  if (thumbnailFileName) {
    const thumbnailFile = zip.file(thumbnailFileName);
    if (!thumbnailFile) {
      return NextResponse.json({ ok: false, error: "Prompt recipe bundle thumbnail file is missing." }, { status: 400 });
    }
    const storedThumbnail = await storePromptRecipeThumbnailBuffer({
      sourceBuffer: Buffer.from(await thumbnailFile.async("uint8array")),
      recipeLabel: String(resolution.payload.label ?? manifest.recipe.label),
      sourceName: path.basename(thumbnailFileName),
    });
    thumbnailPath = storedThumbnail.thumbnail_path;
    thumbnailUrl = storedThumbnail.thumbnail_url;
  }

  const createResult = await postControlApiJson<Record<string, unknown>>(
    "/prompt-recipes",
    {
      ...resolution.payload,
      thumbnail_path: thumbnailPath,
      thumbnail_url: thumbnailUrl,
    },
    "admin",
  );
  if (!createResult.ok || !createResult.data) {
    return NextResponse.json({ ok: false, error: createResult.error ?? "Unable to import the prompt recipe." }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    status: resolution.status,
    message: resolution.message,
    recipe: mapPromptRecipeRecord(createResult.data),
    duplicate_recipe_id: resolution.duplicateRecipeId,
  });
}
