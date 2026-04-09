import path from "node:path";

import JSZip from "jszip";
import { NextResponse } from "next/server";

import { getControlApiJson, mapPresetRecord, postControlApiJson } from "@/lib/control-api";
import {
  parsePortablePresetBundleManifest,
  resolvePresetImport,
} from "@/lib/preset-sharing";
import { storePresetThumbnailBuffer } from "@/lib/preset-thumbnail-storage";

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "Choose a preset bundle to import." }, { status: 400 });
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(Buffer.from(await file.arrayBuffer()));
  } catch {
    return NextResponse.json({ ok: false, error: "Preset imports must be valid ZIP bundles." }, { status: 400 });
  }

  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) {
    return NextResponse.json({ ok: false, error: "Preset bundle is missing manifest.json." }, { status: 400 });
  }

  let manifest;
  try {
    manifest = parsePortablePresetBundleManifest(JSON.parse(await manifestFile.async("text")));
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Preset bundle manifest is invalid." },
      { status: 400 },
    );
  }

  const presetsResult = await getControlApiJson<Array<Record<string, unknown>>>("/media/presets", "admin");
  if (!presetsResult.ok || !presetsResult.data) {
    return NextResponse.json({ ok: false, error: presetsResult.error ?? "Unable to load the media presets." }, { status: 502 });
  }

  const existingPresets = presetsResult.data.map((preset) => mapPresetRecord(preset));
  const resolution = resolvePresetImport(existingPresets, manifest.preset);
  if (resolution.status === "skipped" || !resolution.payload) {
    return NextResponse.json({
      ok: true,
      status: resolution.status,
      message: resolution.message,
      preset: null,
      duplicate_preset_id: resolution.duplicatePresetId,
    });
  }

  let thumbnailPath: string | null = null;
  let thumbnailUrl: string | null = null;
  const thumbnailFileName = manifest.preset.thumbnail?.file_name ?? null;
  if (thumbnailFileName) {
    const thumbnailFile = zip.file(thumbnailFileName);
    if (!thumbnailFile) {
      return NextResponse.json({ ok: false, error: "Preset bundle thumbnail file is missing." }, { status: 400 });
    }
    const storedThumbnail = await storePresetThumbnailBuffer({
      sourceBuffer: Buffer.from(await thumbnailFile.async("uint8array")),
      presetLabel: String(resolution.payload.label ?? manifest.preset.label),
      sourceName: path.basename(thumbnailFileName),
    });
    thumbnailPath = storedThumbnail.thumbnail_path;
    thumbnailUrl = storedThumbnail.thumbnail_url;
  }

  const payload = {
    ...resolution.payload,
    thumbnail_path: thumbnailPath,
    thumbnail_url: thumbnailUrl,
  };
  const createResult = await postControlApiJson<Record<string, unknown>>("/media/presets", payload, "admin");
  if (!createResult.ok || !createResult.data) {
    return NextResponse.json({ ok: false, error: createResult.error ?? "Unable to import the preset." }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    status: resolution.status,
    message: resolution.message,
    preset: mapPresetRecord(createResult.data),
    duplicate_preset_id: resolution.duplicatePresetId,
  });
}
