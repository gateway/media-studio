import { NextResponse } from "next/server";

import { postControlApiJson, mapEnhancePreviewResponseRecord } from "@/lib/control-api";
import type { MediaEnhancePreviewResponse } from "@/lib/types";

import { buildMediaPayloadFromFormData } from "../media/shared";

export async function POST(request: Request) {
  const formData = await request.formData();
  const { payload, modelKey } = await buildMediaPayloadFromFormData(formData);

  if (!modelKey) {
    return NextResponse.json({ ok: false, error: "Choose a model before enhancing the prompt." }, { status: 400 });
  }

  payload.enhance = true;

  const result = await postControlApiJson<Record<string, unknown>>("/media/enhance/preview", payload, "read");

  if (!result.ok || !result.data) {
    return NextResponse.json({ ok: false, error: result.error ?? "Unable to enhance the prompt." }, { status: 502 });
  }

  return NextResponse.json({ ok: true, preview: mapEnhancePreviewResponseRecord(result.data) as MediaEnhancePreviewResponse });
}
