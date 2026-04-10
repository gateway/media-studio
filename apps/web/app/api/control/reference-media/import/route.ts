import { NextResponse } from "next/server";

import { registerReferenceMediaFile } from "@/lib/reference-media-storage";

export async function POST(request: Request) {
  const formData = await request.formData();
  const entry = formData.get("file");
  if (!(entry instanceof File) || !entry.size) {
    return NextResponse.json({ ok: false, error: "Choose a reference file to import." }, { status: 400 });
  }
  try {
    const item = await registerReferenceMediaFile(entry);
    return NextResponse.json({ ok: true, item });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to import the reference media." },
      { status: 500 },
    );
  }
}
