import { NextResponse } from "next/server";
import { storePresetThumbnailBuffer } from "@/lib/preset-thumbnail-storage";

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

    const sourceBuffer = Buffer.from(await file.arrayBuffer());
    const stored = await storePresetThumbnailBuffer({
      sourceBuffer,
      presetLabel: presetLabel || file.name.replace(/\.[^.]+$/, ""),
      sourceName: file.name,
    });

    return NextResponse.json({
      ok: true,
      thumbnail_path: stored.thumbnail_path,
      thumbnail_url: stored.thumbnail_url,
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Unable to upload the preset thumbnail." }, { status: 500 });
  }
}
