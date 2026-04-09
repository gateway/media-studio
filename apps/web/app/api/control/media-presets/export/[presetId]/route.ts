import path from "node:path";

import JSZip from "jszip";
import { NextResponse } from "next/server";

import { getControlApiJson, mapPresetRecord } from "@/lib/control-api";
import {
  createPortablePresetBundleManifest,
  normalizePortablePresetPayload,
} from "@/lib/preset-sharing";
import { readPresetThumbnailBuffer } from "@/lib/preset-thumbnail-storage";
import { slugifyKey } from "@/lib/utils";

export async function GET(
  _request: Request,
  context: { params: Promise<{ presetId: string }> },
) {
  const { presetId } = await context.params;
  const result = await getControlApiJson<Array<Record<string, unknown>>>("/media/presets", "admin");

  if (!result.ok || !result.data) {
    return NextResponse.json({ ok: false, error: result.error ?? "Unable to load the media presets." }, { status: 502 });
  }

  const presets = result.data.map((preset) => mapPresetRecord(preset));
  const preset = presets.find((entry) => entry.preset_id === presetId) ?? null;
  if (!preset) {
    return NextResponse.json({ ok: false, error: "Preset not found." }, { status: 404 });
  }

  const zip = new JSZip();
  let thumbnailFileName: string | null = null;
  try {
    const thumbnailBuffer = await readPresetThumbnailBuffer(preset.thumbnail_path);
    if (thumbnailBuffer) {
      thumbnailFileName = `assets/${path.basename(String(preset.thumbnail_path ?? "").trim()) || "thumbnail.webp"}`;
      zip.file(thumbnailFileName, thumbnailBuffer);
    }
  } catch {
    thumbnailFileName = null;
  }

  const manifest = createPortablePresetBundleManifest({
    ...normalizePortablePresetPayload(preset),
    thumbnail: thumbnailFileName ? { file_name: thumbnailFileName } : null,
  });

  zip.file("manifest.json", JSON.stringify(manifest, null, 2));

  const bundleBuffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });

  const fileName = `${slugifyKey(preset.key || preset.label || "preset") || "preset"}.zip`;
  return new NextResponse(new Uint8Array(bundleBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
