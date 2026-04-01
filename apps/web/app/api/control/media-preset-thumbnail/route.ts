import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";
import sharp from "sharp";

const PRESET_THUMBNAILS_DIR = path.resolve(process.cwd(), "..", "..", "data", "preset-thumbnails");

function safeSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const presetLabel = String(formData.get("presetLabel") ?? "").trim();

    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "Choose an image to upload." }, { status: 400 });
    }

    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ ok: false, error: "Thumbnail uploads must be image files." }, { status: 400 });
    }

    await mkdir(PRESET_THUMBNAILS_DIR, { recursive: true });

    const sourceBuffer = Buffer.from(await file.arrayBuffer());
    const baseName = safeSlug(presetLabel || file.name.replace(/\.[^.]+$/, "")) || "preset-thumbnail";
    const fileName = `${baseName}-${Date.now()}.webp`;
    const outputPath = path.join(PRESET_THUMBNAILS_DIR, fileName);

    const optimizedBuffer = await sharp(sourceBuffer)
      .rotate()
      .resize(512, 512, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80, effort: 4 })
      .toBuffer();

    await writeFile(outputPath, optimizedBuffer);

    return NextResponse.json({
      ok: true,
      thumbnail_path: `preset-thumbnails/${fileName}`,
      thumbnail_url: `/api/preset-thumbnails/${fileName}`,
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Unable to upload the preset thumbnail." }, { status: 500 });
  }
}
